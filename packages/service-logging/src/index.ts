import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import path from "node:path";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import Transport from "winston-transport";
import { serviceLogFormat as format, type ServiceLogEvent } from "@ontomato/contracts/service-logging";
import { getServiceLogContext } from "./context";
import { normalizeEvent, formatLine, exceptionStack } from "./format";
import type { ServiceLogStore } from "./postgres";

export * from "./context";
export * from "./format";
export * from "./postgres";
export type { ServiceLogEvent, ServiceLogContext, ServiceLogPage } from "@ontomato/contracts/service-logging";

const EVENT = Symbol("serviceLogEvent"), LOCAL = Symbol("localLogOnly");
type Info = winston.Logform.TransformableInfo & { [EVENT]?: ServiceLogEvent & { line: string }; [LOCAL]?: boolean };
const policy = format.defaults.postgres;

/** Winston owns fan-out and file I/O; this transport owns only the best-effort PG queue. */
class PostgresTransport extends Transport {
  private queue: Array<ServiceLogEvent & { line: string }> = [];
  private inFlight?: Promise<void>;
  private resumeAt = 0;
  private dropped = 0;
  private lastWarning = 0;
  private stopping = false;
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly store: ServiceLogStore, private readonly warn: (message: string) => void) {
    super();
    this.timer = setInterval(() => void this.flush(), policy.nodeFlushIntervalMs).unref();
  }
  log(info: Info, callback: () => void): void {
    if (!info[LOCAL] && info[EVENT] && !this.stopping) {
      if (this.queue.length >= policy.queueRecords) this.drop(1);
      else this.queue.push(info[EVENT]);
      if (this.queue.length >= policy.batchRows) void this.flush();
    }
    callback();
  }
  private drop(count: number): void {
    this.dropped += count;
    if (Date.now() - this.lastWarning >= 60000) {
      this.warn(`PG log copy dropped: ${this.dropped} records; stdout and file logging continue`);
      this.dropped = 0; this.lastWarning = Date.now();
    }
  }
  private flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.queue.length || Date.now() < this.resumeAt) return Promise.resolve();
    const batch = this.queue.splice(0, policy.batchRows);
    this.inFlight = this.store.write(batch).catch(() => {
      this.drop(batch.length); this.resumeAt = Date.now() + policy.reconnectIntervalMs;
    }).finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }
  async drain(): Promise<void> {
    this.stopping = true; clearInterval(this.timer);
    const deadline = Date.now() + policy.shutdownTimeoutMs;
    while ((this.inFlight || this.queue.length) && Date.now() < deadline && (this.inFlight || Date.now() >= this.resumeAt)) await this.flush();
    if (this.queue.length) { this.drop(this.queue.length); this.queue.length = 0; }
  }
  close(): void { this.stopping = true; clearInterval(this.timer); }
}

export function createServiceLogging(service: string) {
  if (!format.services.includes(service)) throw new Error("Unknown logging service");
  const levels = Object.fromEntries([...format.levels].reverse().map((value, index) => [value.toLowerCase(), index]));
  let instanceId = process.env.ONTOMATO_INSTANCE_ID || `${hostname()}:${process.pid}`;
  let file: DailyRotateFile | undefined, sink: PostgresTransport | undefined;
  let store: ServiceLogStore | undefined;
  let lastWarning = 0;
  let closed = false;
  const logger = winston.createLogger({
    levels, level: format.defaults.level.toLowerCase(),
    format: winston.format((info: Info) => {
      const context = getServiceLogContext();
      const exception = info instanceof Error ? info : info.error instanceof Error ? info.error : (info[Symbol.for("splat")] as unknown[] | undefined)?.find((value) => value instanceof Error) as Error | undefined;
      const metadata = info as Record<string, unknown>;
      const event = normalizeEvent({
        id: randomUUID(), time: new Date().toISOString(), level: info.level.toUpperCase(),
        service, module: typeof metadata.module === "string" ? metadata.module : "app", instanceId,
        correlationId: context.correlationId ?? null, domainId: context.domainId ?? null,
        userId: context.userId ?? null, runId: context.runId ?? null, sessionId: context.sessionId ?? null,
        kind: metadata.kind === "http" || metadata.kind === "downstream" ? metadata.kind : "app",
        message: typeof info.message === "string" ? info.message : "event",
        ...Object.fromEntries([...format.httpFields, ...format.downstreamFields].filter((key) => metadata[key] !== undefined)
          .map((key) => [key, metadata[key]])),
        errorName: exception?.name ?? (typeof info.name === "string" ? info.name : typeof metadata.error === "string" ? "Error" : null),
        errorCode: typeof metadata.code === "string" ? metadata.code : null,
        stack: exception ? exceptionStack(exception) : typeof info.stack === "string" ? info.stack : typeof metadata.error === "string" ? metadata.error : null,
      });
      const line = formatLine(event);
      return { level: info.level, message: event.message, [Symbol.for("level")]: info[Symbol.for("level")],
        [Symbol.for("message")]: line, [EVENT]: { ...event, line }, [LOCAL]: info[LOCAL] };
    })(),
    transports: [new winston.transports.Console({ stderrLevels: [], consoleWarnLevels: [], eol: format.newline })],
    exitOnError: false,
  });
  const warn = (message: string) => {
    if (closed || Date.now() - lastWarning < 60000) return;
    lastWarning = Date.now();
    logger.log({ level: "warn", module: "logging", message, [LOCAL]: true });
  };
  logger.on("error", () => warn("A logging transport failed; remaining transports continue"));
  return {
    logger,
    subscribe(listener: (record: ServiceLogEvent & { line: string }) => void): () => void {
      const receive = (info: Info) => {
        if (info[EVENT] && logger.isLevelEnabled(info.level)) {
          try { listener(info[EVENT]); } catch { /* A disconnected log reader cannot fail the producer. */ }
        }
      };
      logger.on("data", receive);
      return () => { logger.off("data", receive); };
    },
    module(name: string): winston.Logger { return logger.child({ module: name }); },
    warn,
    initialize(options: { directory: string; level?: string; instanceId?: string }): void {
      if (options.instanceId) instanceId = options.instanceId;
      const level = options.level?.toLowerCase();
      if (level && level in levels) logger.level = level;
      if (file) return;
      try {
      file = new DailyRotateFile({ dirname: options.directory, filename: `${service}-%DATE%.log`,
        datePattern: "YYYY-MM-DD", utc: true, maxSize: format.defaults.file.maxBytes,
        maxFiles: format.defaults.file.maxFilesIncludingActive, zippedArchive: false,
        auditFile: path.join(options.directory, `.${service}-rotation.json`),
        createSymlink: process.platform !== "win32", symlinkName: `${service}.log`, eol: format.newline });
      file.on("error", () => warn("Service log file output failed; remaining transports continue"));
      logger.add(file);
      } catch { warn("Service log file output could not be initialized; remaining transports continue"); }
    },
    attach(database: ServiceLogStore): void {
      if (sink) return;
      store = database; database.start(); sink = new PostgresTransport(database, warn); logger.add(sink);
    },
    async close(): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fileFinished = file ? new Promise<void>((done) => file!.once("finish", done)) : Promise.resolve();
      const shutdown = async () => {
        await sink?.drain();
        logger.close();
        await fileFinished;
        await store?.close();
      };
      try {
        await Promise.race([shutdown(), new Promise<void>((done) => { timer = setTimeout(done, policy.shutdownTimeoutMs); })]);
      } finally {
        closed = true;
        clearTimeout(timer);
        logger.close();
        void store?.close().catch(() => {});
      }
    },
  };
}
