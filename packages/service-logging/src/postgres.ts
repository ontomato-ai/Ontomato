import pg from "pg";
import { z } from "zod";
import {
  serviceLogFormat as format, serviceLogQuerySchema, serviceLogTimestampSchema, type ServiceLogEvent,
  type ServiceLogPage, type ServiceLogQuery, type ServiceLogRecord,
} from "@ontomato/contracts/service-logging";

const policy = format.defaults.postgres;
const columns = ["id", "time", "level", "module", "instance_id", "correlation_id", "domain_id", "user_id", "run_id", "session_id", "line"];
const keys = ["id", "time", "level", "module", "instanceId", "correlationId", "domainId", "userId", "runId", "sessionId", "line"] as const;
const filters = { correlationId: "correlation_id", runId: "run_id", sessionId: "session_id", domainId: "domain_id", userId: "user_id", instanceId: "instance_id", module: "module" } as const;
const cursorSchema = z.object({ time: serviceLogTimestampSchema, id: z.string().uuid(), from: serviceLogTimestampSchema, to: serviceLogTimestampSchema }).strict();

export class LogQueryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function normalizeLogQuery(input: unknown, now = Date.now()) {
  try {
    const query = serviceLogQuerySchema.parse(input);
    const cursor = query.cursor ? cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"))) : null;
    const to = query.to ?? cursor?.to ?? new Date(now).toISOString();
    const from = query.from ?? cursor?.from ?? new Date(Date.parse(to) - format.defaults.query.defaultWindowMs).toISOString();
    if ((cursor && (Date.parse(cursor.time) < Date.parse(from) || Date.parse(cursor.time) >= Date.parse(to))) || Date.parse(from) >= Date.parse(to) || (cursor && (cursor.from !== from || cursor.to !== to))) throw new Error("Invalid window");
    return { ...query, from, to, cursor };
  } catch { throw new LogQueryError(400, "INVALID_LOG_QUERY", "Invalid log query"); }
}

/** A service instantiates only its own store using its existing connection configuration. */
export class ServiceLogStore {
  private readonly pool: pg.Pool;
  readonly table: string;
  private ready = false;
  private closed = false;
  private closing?: Promise<void>;
  private initializing?: Promise<void>;
  private retry?: ReturnType<typeof setTimeout>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  constructor(readonly service: string, connectionString: string, schema: string,
    private readonly warn: (message: string) => void) {
    const name = (format.tables as Record<string, string>)[service];
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(schema)) throw new Error("Invalid log table owner");
    this.table = `"${schema}"."${name}"`;
    this.pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 1000,
      statement_timeout: 2000, query_timeout: 2500, idleTimeoutMillis: 30000, allowExitOnIdle: true });
    this.pool.on("error", () => this.warn("Service log database connection failed"));
  }

  start(): void {
    if (this.closed || this.initializing || this.ready) return;
    this.initializing = this.initialize().catch(() => {
      this.warn("Service log table is unavailable; stdout and file logging continue");
      if (!this.closed) this.retry = setTimeout(() => this.start(), policy.reconnectIntervalMs).unref();
    }).finally(() => { this.initializing = undefined; });
  }
  private async initialize(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (
      id uuid PRIMARY KEY, time timestamptz NOT NULL, level varchar(5) NOT NULL,
      module text NOT NULL, instance_id text, correlation_id text, domain_id text,
      user_id text, run_id text, session_id text, line text NOT NULL
      CHECK(octet_length(line) < ${format.limits.lineBytesIncludingLf}))`);
    const indexPrefix = (format.tables as Record<string, string>)[this.service];
    for (const field of ["time", "correlation_id", "run_id", "session_id", "level"]) {
      await this.pool.query(`CREATE INDEX IF NOT EXISTS "${indexPrefix}_${field}" ON ${this.table}
        (${field === "time" ? "time,id" : `${field},time,id`})`);
    }
    this.ready = true;
    if (this.closed) return;
    this.cleanupTimer = setInterval(() => void this.cleanup(), policy.cleanupIntervalMs).unref();
    void this.cleanup();
  }
  async write(records: Array<ServiceLogEvent & { line: string }>): Promise<void> {
    if (!this.ready || this.closed) throw new Error("Log store unavailable");
    const values: unknown[] = [];
    const rows = records.map((record) => `(${keys.map((key) => {
      values.push(record[key] ?? null); return `$${values.length}`;
    }).join(",")})`);
    await this.pool.query(`INSERT INTO ${this.table} (${columns.join(",")}) VALUES ${rows.join(",")}`, values);
  }
  async query(input: ServiceLogQuery | unknown): Promise<ServiceLogPage> {
    const query = normalizeLogQuery(input);
    if (!this.ready || this.closed) throw new LogQueryError(503, "LOG_STORE_UNAVAILABLE", "Service log store is unavailable");
    const values: unknown[] = [query.from, query.to];
    const conditions = ["time >= $1", "time < $2"];
    for (const [key, column] of Object.entries(filters)) {
      const value = query[key as keyof typeof filters];
      if (value !== undefined) { values.push(value); conditions.push(`${column}=$${values.length}`); }
    }
    if (query.minLevel) {
      values.push(format.levels.slice(format.levels.indexOf(query.minLevel)));
      conditions.push(`level=ANY($${values.length}::text[])`);
    }
    if (query.cursor) {
      values.push(query.cursor.time, query.cursor.id);
      conditions.push(`(time,id)>($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(query.limit + 1);
    try {
      const result = await this.pool.query(`SELECT ${columns.join(",")} FROM ${this.table}
        WHERE ${conditions.join(" AND ")} ORDER BY time,id LIMIT $${values.length}`, values);
      const more = result.rows.length > query.limit;
      const records: ServiceLogRecord[] = result.rows.slice(0, query.limit).map((row) => ({
        id: row.id, time: row.time.toISOString(), level: row.level, module: row.module,
        instanceId: row.instance_id, correlationId: row.correlation_id, domainId: row.domain_id,
        userId: row.user_id, runId: row.run_id, sessionId: row.session_id, line: row.line,
      }));
      const last = records.at(-1);
      return { service: this.service, window: { from: query.from, to: query.to }, records,
        nextCursor: more && last ? Buffer.from(JSON.stringify({ time: last.time, id: last.id, from: query.from, to: query.to })).toString("base64url") : null,
        storage: { mode: "best-effort", retentionDays: policy.retentionDays } };
    } catch (error) {
      const code = typeof error === "object" && error ? String((error as { code?: string }).code ?? "") : "";
      const unavailable = /^(08|53|57|ECONN|EHOST|ENET|ETIMEDOUT)/u.test(code) || code === "42P01" || !code;
      throw new LogQueryError(unavailable ? 503 : 500,
        unavailable ? "LOG_STORE_UNAVAILABLE" : "LOG_QUERY_FAILED",
        unavailable ? "Service log store is unavailable" : "Service log query failed");
    }
  }
  private async cleanup(): Promise<void> {
    if (this.cleaning || this.closed || !this.ready) return;
    this.cleaning = true;
    try {
      let removed: number;
      do {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const lock = await client.query("SELECT pg_try_advisory_xact_lock(hashtext($1)) AS owned", [this.table + ":retention"]);
          if (!lock.rows[0].owned) { await client.query("ROLLBACK"); return; }
          const result = await client.query(`DELETE FROM ${this.table} WHERE id IN (
            SELECT id FROM ${this.table} WHERE time < now() - ($1 * interval '1 day') ORDER BY time,id LIMIT $2)`,
          [policy.retentionDays, policy.deleteBatchRows]);
          removed = result.rowCount ?? 0;
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        finally { client.release(); }
        await new Promise<void>((done) => setImmediate(done));
      } while (!this.closed && removed === policy.deleteBatchRows);
    } catch { this.warn("Service log retention cleanup failed; it will retry on the next tick"); }
    finally { this.cleaning = false; }
  }
  close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.retry); clearInterval(this.cleanupTimer);
    return this.closing ??= this.pool.end();
  }
}
