import type { RuntimeSessionHistory, SessionHistoryQuery } from "@ontomato/contracts/session-history";
import { ServiceLogStore, withServiceLogContext, getServiceLogContext, updateServiceLogContext } from "@ontomato/service-logging";
import { runtimeLogging, runtimeLogger, runtimeDiagnostic } from "./logging";
import { ArtifactFiles } from "./files";
import { SessionSandbox } from "./sandbox";
import { mkdir, chmod, readFile } from "node:fs/promises";
import { CodeExecutor } from "./code";
import { signalUid, type WorkerPolicy } from "./worker";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import {
  runtimeStartRunRequestSchema,
  type RuntimeStartRunRequest,
  type RuntimeRunSnapshot,
  type RuntimeSessionSnapshot,
  type RuntimeRun,
} from "@ontomato/contracts/agent-runtime";
import {
  runtimeMessageSchema,
  runtimeAssistantMessageSchema,
  runtimeSystemMessageSchema,
  runtimeUserMessageSchema,
  runtimeToolResultMessageSchema,
  runtimeToolCallSchema,
  type RuntimeMessage,
} from "@ontomato/contracts/agent-runtime-messages";
import { runtimeAssistantStreamEventSchema } from "@ontomato/contracts/agent-runtime-messages";
import type {
  RuntimeAgentEvent,
  RuntimeEventEnvelope,
  RuntimeStreamFrame,
} from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import { runAgentLoopContinue } from "./core/pi/agent-loop";
import type { AgentEvent } from "./core/pi/types";
import { RuntimeStore, digest, canonical, type Scope } from "./store";
import {
  SkillRegistry,
  skillCatalog,
  type RuntimeHost,
  type InstalledSkill,
} from "./skills";
import {
  piModel,
  modelStream,
  completeSummary,
  recoverContext,
} from "./model";
import { RuntimeError, safeMessage } from "./errors";
import { contextTokens, cutPoint, serializeConversation } from "./compaction";
import { connectMcp } from "./tools";
import { RuntimeMcpServices } from "./mcp";
import { RuntimeModelSettings } from "./model-settings";
import { modelKeySealKey } from "@ontomato/contracts/model-key-seal";

type Subscriber = (frame: RuntimeStreamFrame) => void;
interface Active {
  scope: Scope;
  run: RuntimeRun;
  controller: AbortController;
  done: Promise<void>;
  frames: RuntimeEventEnvelope[];
  lostThrough: number;
  pending: Map<string, RuntimeMessage>;
  currentMessageId?: string;
  turnIndex: number;
  subscribers: Set<Subscriber>;
  sandbox?: SessionSandbox;
  outputBaseline: Map<string, string>;
}
export interface RuntimeOptions {
  store: RuntimeStore;
  worker?: WorkerPolicy;
  root: string;
  hosts: RuntimeHost[];
  modelRuntimeToken?: string;
  modelSeed?: { baseUrl?: string; apiKey?: string; modelName?: string };
  eventBufferSize?: number;
}

/** Only the wire profile is persisted; provider diagnostics are deliberately not part of it. */
function projectMessage(message: Message): RuntimeMessage {
  const shape =
    message.role === "assistant"
      ? runtimeAssistantMessageSchema.shape
      : message.role === "system"
        ? runtimeSystemMessageSchema.shape
        : message.role === "user"
          ? runtimeUserMessageSchema.shape
          : runtimeToolResultMessageSchema.shape;
  return runtimeMessageSchema.parse(
    JSON.parse(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(message).filter(([key]) => key in shape),
        ),
      ),
    ),
  );
}
function key(scope: Scope, id: string) {
  return canonical([scope.hostId, scope.domainId, id]);
}

export class AgentRuntime {
  readonly store: RuntimeStore;
  readonly logs: ServiceLogStore;
  readonly registry: SkillRegistry;
  readonly code: CodeExecutor;
  readonly worker: WorkerPolicy;
  readonly files: ArtifactFiles;
  readonly mcp: RuntimeMcpServices;
  readonly models: RuntimeModelSettings;
  private active = new Map<string, Active>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly options: RuntimeOptions) {
    modelKeySealKey(options.modelRuntimeToken);
    this.store = options.store;
    this.logs = new ServiceLogStore("agent-runtime", this.store.connectionString, this.store.schema, runtimeLogging.warn);
    this.mcp = new RuntimeMcpServices(this.store);
    this.models = new RuntimeModelSettings(this.store, options.modelRuntimeToken, options.modelSeed);
    this.worker = {
      ...(options.worker ?? {
        development: process.env.NODE_ENV === "test",
        python: process.env.AGENT_RUNTIME_PYTHON || "python3",
      }),
      uidStatePath: path.join(options.root, "worker-next-uid"),
    };
    this.registry = new SkillRegistry(
      this.store,
      path.join(options.root, "skills"),
    );
    this.files = new ArtifactFiles(path.join(options.root, "artifacts"));
    this.code = new CodeExecutor(
      this.store,
      this.registry,
      path.join(options.root, "executions"),
      this.worker,
      this.files,
    );
  }
  private async locked<T>(
    scope: Scope,
    sessionId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const id = key(scope, sessionId);
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  async initialize() {
    runtimeLogging.initialize({ directory: process.env.AGENT_RUNTIME_LOG_DIR || path.join(this.options.root, "logs"), level: process.env.LOG_LEVEL });
    await this.store.initialize();
    runtimeLogging.attach(this.logs);
    if (!this.worker.development) {
      const rows = (
        await this.store.pool.query(
          `SELECT worker_uid FROM ${this.store.table("sessions")} WHERE worker_uid IS NOT NULL`,
        )
      ).rows;
      if (rows.length) {
        const next = Number(await readFile(this.worker.uidStatePath!, "utf8"));
        if (
          !Number.isSafeInteger(next) ||
          rows.some((r) => Number(r.worker_uid) >= next)
        )
          throw new Error(
            "Session UID allocation state is missing or inconsistent",
          );
        for (const row of rows) signalUid(Number(row.worker_uid), "SIGKILL");
      }
    }
    await this.store.recover();
    await mkdir(this.options.root, { recursive: true, mode: 0o711 });
    await chmod(this.options.root, 0o711);
    await this.code.initialize();
  }
  async start(
    host: RuntimeHost,
    scope: Scope,
    sessionId: string,
    runId: string,
    correlationId: string,
    body: unknown,
  ) {
    const request = runtimeStartRunRequestSchema.parse(body);
    const fingerprint = digest({
      sessionId,
      ...request,
      environment: {
        values: request.environment.values,
        secretNames: Object.keys(request.environment.secrets).sort(),
      },
    });
    return this.locked(scope, sessionId, async () => {
      // Admission retries must work even when a dependency is unavailable or the version was unmounted.
      const admitted = await this.store.pool.query(
        `SELECT 1 FROM ${this.store.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND key=$3`,
        [scope.hostId, scope.domainId, runId],
      );
      const run: RuntimeRun = {
        id: runId,
        sessionId,
        domainId: scope.domainId,
        status: "running",
        correlationId,
        language: request.language,
        definition: request.definition,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        stopReason: null,
        errorMessage: null,
        resolvedSkills: [],
        environment: {
          values: request.environment.values,
          secretNames: Object.keys(request.environment.secrets).sort(),
        },
      };
      let skills: InstalledSkill[] = [];
      if (!admitted.rowCount) {
        skills = await Promise.all(
          request.definition.skills.map((ref) =>
            this.registry.resolve(host, scope.domainId, ref),
          ),
        );
        if (new Set(skills.map((s) => s.skill.name)).size !== skills.length)
          throw new RuntimeError(
            400,
            "INVALID_REQUEST",
            "Skill names must be unique within a run",
          );
        run.resolvedSkills = skills.map(
          ({ directory: _directory, ...registered }) => registered,
        );
      }
      const accepted = await this.store.admit(
        scope,
        run,
        fingerprint,
        request.input,
      );
      if (accepted.replayed) {
        const persisted = await this.store.pool.query(`SELECT log_context FROM ${this.store.table("runs")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [scope.hostId, scope.domainId, runId]);
        updateServiceLogContext({ userId: persisted.rows[0]?.log_context?.userId ?? null });
        updateServiceLogContext({ correlationId: accepted.run.correlationId, runId: accepted.run.id, sessionId: accepted.run.sessionId });
        return accepted;
      }
      const logContext = { correlationId: run.correlationId, domainId: scope.domainId,
        userId: getServiceLogContext().userId ?? null, runId: run.id, sessionId: run.sessionId };
      updateServiceLogContext(logContext);
      const active: Active = {
        scope,
        run,
        controller: new AbortController(),
        done: Promise.resolve(),
        frames: await this.store.events(scope, runId),
        lostThrough: 0,
        pending: new Map(),
        turnIndex: -1,
        subscribers: new Set(),
        outputBaseline: new Map(),
      };
      this.active.set(key(scope, runId), active);
      // The first execution begins after this admission lock is released, never on a read/retry.
      active.done = Promise.resolve()
        .then(() => withServiceLogContext(logContext, () => this.execute(active, request, skills)))
        .finally(() => this.active.delete(key(scope, runId)));
      void active.done.catch(() =>
        withServiceLogContext(logContext, () => runtimeLogger.error("Runtime persistence failed; run will be interrupted on restart")),
      );
      return accepted;
    });
  }
  private publish(active: Active, envelope: RuntimeEventEnvelope) {
    active.frames.push(envelope);
    if (active.frames.length > (this.options.eventBufferSize ?? 512))
      active.lostThrough = active.frames.shift()!.cursor.seq;
    for (const subscriber of active.subscribers) {
      try {
        subscriber({ type: "event", envelope });
      } catch {
        active.subscribers.delete(subscriber);
      }
    }
    if (envelope.event.type === "agent_end") active.subscribers.clear();
  }
  private async emit(active: Active, event: RuntimeAgentEvent) {
    return this.locked(active.scope, active.run.sessionId, async () => {
      const envelope = await this.store.append(
        active.scope,
        active.run.id,
        event,
      );
      if (event.type === "message_end") active.pending.delete(event.messageId);
      this.publish(active, envelope);
      return envelope;
    });
  }
  private async receive(active: Active, event: AgentEvent) {
    if (event.type === "agent_end" || event.type === "agent_start") return;
    if (event.type === "turn_start") {
      active.turnIndex++;
      return this.emit(active, {
        type: "turn_start",
        turnIndex: active.turnIndex,
      });
    }
    if (event.type === "turn_end")
      return this.emit(active, {
        type: "turn_end",
        turnIndex: active.turnIndex,
        message: projectMessage(event.message as Message),
        toolResults: event.toolResults.map(
          (m) =>
            projectMessage(m) as Extract<
              RuntimeMessage,
              { role: "toolResult" }
            >,
        ),
      });
    if (event.type === "message_start") {
      const id = randomUUID();
      active.currentMessageId = id;
      const message = projectMessage(event.message as Message);
      if (message.role === "assistant" && message.stopReason === "pending")
        message.content = [];
      return this.locked(active.scope, active.run.sessionId, async () => {
        const envelope = await this.store.append(active.scope, active.run.id, {
          type: "message_start",
          messageId: id,
          message,
        });
        active.pending.set(id, structuredClone(message));
        this.publish(active, envelope);
      });
    }
    if (event.type === "message_update") {
      const id = active.currentMessageId!;
      const original = event.assistantMessageEvent;
      const wire = runtimeAssistantStreamEventSchema.parse(
        Object.fromEntries(
          Object.entries(original).filter(([k]) =>
            ["type", "contentIndex", "delta", "reason"].includes(k),
          ),
        ),
      );
      return this.locked(active.scope, active.run.sessionId, async () => {
        const envelope = await this.store.append(active.scope, active.run.id, {
          type: "message_update",
          messageId: id,
          assistantMessageEvent: wire,
        });
        const partial = active.pending.get(id);
        if (partial?.role === "assistant" && "contentIndex" in original) {
          const index = original.contentIndex;
          if (original.type === "text_start")
            partial.content[index] = { type: "text", text: "" };
          if (original.type === "thinking_start")
            partial.content[index] = { type: "thinking", thinking: "" };
          const block = partial.content[index];
          if (original.type === "text_delta" && block?.type === "text")
            block.text += original.delta;
          if (original.type === "thinking_delta" && block?.type === "thinking")
            block.thinking += original.delta;
          if (original.type === "toolcall_start") {
            const call = original.partial.content[index];
            if (call?.type === "toolCall")
              partial.content[index] = {
                type: "toolCall",
                id: call.id,
                name: call.name,
                arguments: {},
              };
          }
          if (original.type === "toolcall_end")
            partial.content[index] = runtimeToolCallSchema.parse(
              structuredClone(original.toolCall),
            );
        }
        this.publish(active, envelope);
      });
    }
    if (event.type === "message_end")
      return this.emit(active, {
        type: "message_end",
        messageId: active.currentMessageId!,
        messageSeq: 0,
        message: projectMessage(event.message as Message),
      });
    if (event.type === "tool_execution_end") {
      const result = {
        content: event.result.content,
        details: {
          artifactIds: [] as string[],
          ...(event.result.structuredContent === undefined
            ? {}
            : { data: event.result.structuredContent }),
        },
      };
      result.details.artifactIds = await this.collect(active, event.toolCallId);
      const envelope = await this.emit(active, { ...event, result });
      event.result.details = result.details;
      return envelope;
    }
    if (event.type === "tool_execution_update")
      return this.emit(active, {
        type: "tool_execution_update",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        partialResult: {
          text:
            event.partialResult.content
              ?.map((p: { text?: string }) => p.text ?? "")
              .join("") ?? "",
        },
      });
    return this.emit(active, event as RuntimeAgentEvent);
  }
  private async execute(
    active: Active,
    request: RuntimeStartRunRequest,
    skills: InstalledSkill[],
  ) {
    const { scope, run, controller } = active;
    runtimeLogger.info("run started");
    const signal = controller.signal;
    let reason: RuntimeStopReason | undefined;
    let failure: string | null = null;
    let closeMcp = async () => {};
    try {
      const mcpConfigs = await this.mcp.resolve(scope, request.definition.externalMcp.map((ref) => ref.id));
      const config = await this.models.resolve(scope.domainId, request.definition.modelRole);
      const rows = await this.store.messages(scope, run.sessionId);
      const summaryRow = (
        await this.store.pool.query(
          `SELECT * FROM ${this.store.table("compactions")} WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 ORDER BY covered_seq DESC LIMIT 1`,
          [scope.hostId, scope.domainId, run.sessionId],
        )
      ).rows[0];
      let summary: string | undefined = summaryRow?.summary;
      let covered = Number(summaryRow?.covered_seq ?? 0);
      let usageResetAt = summaryRow
        ? new Date(summaryRow.created_at).getTime()
        : 0;
      const previous = rows
        .filter((r) => r.messageSeq > covered)
        .map((r) => r.message as Message);
      const messages = recoverContext(previous);
      if (summary)
        messages.unshift({
          role: "user",
          content: `Previous conversation summary:\n${summary}`,
          timestamp: Date.now(),
        });
      const sandbox = new SessionSandbox(
        this.store,
        this.options.root,
        this.worker,
        scope,
        run.sessionId,
      );
      const uid = await sandbox.prepare(skills);
      active.sandbox = sandbox;
      for (const file of await this.files.scan(sandbox.workspace))
        active.outputBaseline.set(file.path, file.sha256);
      const tools = await sandbox.start(
        uid,
        run.id,
        run.correlationId,
        request,
        skills,
      );
      const mcp = await connectMcp(
        mcpConfigs,
        run.correlationId,
        signal,
      );
      closeMcp = mcp.close;
      tools.push(...mcp.tools);
      if (new Set(tools.map((t) => t.name)).size !== tools.length)
        throw new Error("Exposed tool names must be unique");
      const model = piModel(config);
      await runAgentLoopContinue(
        { messages, tools },
        {
          model,
          toolExecution: "sequential",
          convertToLlm: (m) => m as Message[],
          prepareRequest: async ({ context }) => {
            signal.throwIfAborted();
            const system = [
              request.definition.systemPrompt,
              skillCatalog(sandbox.workspace, skills),
            ]
              .filter(Boolean)
              .join("\n\n");
            const raw = (
              await this.store.messages(scope, run.sessionId)
            ).filter(
              (r) => r.messageSeq > covered && r.message.role !== "system",
            );
            let effective = recoverContext(
              raw.map((r) => r.message as Message),
            );
            if (summary)
              effective.unshift({
                role: "user",
                content: `Previous conversation summary:\n${summary}`,
                timestamp: Date.now(),
              });
            const estimate = contextTokens(
              effective,
              system,
              tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
              usageResetAt,
            );
            if (estimate >= config.contextWindow * 0.8) {
              const cut = cutPoint(
                raw.map((r) => r.message as Message),
                config.contextWindow,
              );
              if (cut > 0) {
                try {
                  const source = raw.slice(0, cut);
                  const prompt = `<conversation>\n${serializeConversation(source.map((r) => r.message as Message))}\n</conversation>\n${summary ? `<previous-summary>\n${summary}\n</previous-summary>\n` : ""}${summary ? request.definition.compaction.updatePrompt : request.definition.compaction.summarizePrompt}`;
                  const next = await completeSummary(
                    modelStream(
                      config,
                      this.store,
                      scope,
                      run.id,
                      run.correlationId,
                      "compaction",
                    ),
                    model,
                    normalizeContext({
                      systemPrompt: request.definition.compaction.systemPrompt,
                      messages: [
                        {
                          role: "user",
                          content: prompt,
                          timestamp: Date.now(),
                        },
                      ],
                    }),
                    signal,
                    Math.floor(
                      0.8 *
                        Math.min(
                          16384,
                          Math.max(1, Math.floor(config.contextWindow * 0.2)),
                        ),
                    ),
                  );
                  const nextCovered = source.at(-1)!.messageSeq;
                  await this.store.pool.query(
                    `INSERT INTO ${this.store.table("compactions")} (host_id,domain_id,session_id,covered_seq,summary) VALUES($1,$2,$3,$4,$5)`,
                    [
                      scope.hostId,
                      scope.domainId,
                      run.sessionId,
                      nextCovered,
                      next,
                    ],
                  );
                  covered = nextCovered;
                  summary = next;
                  usageResetAt = Date.now();
                  effective = [
                    {
                      role: "user",
                      content: `Previous conversation summary:\n${summary}`,
                      timestamp: Date.now(),
                    },
                    ...recoverContext(
                      raw.slice(cut).map((r) => r.message as Message),
                    ),
                  ];
                } catch {
                  signal.throwIfAborted();
                }
              }
            }
            const prepared: Message = {
              role: "system",
              content: system,
              toolsAdded: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
              timestamp: Date.now(),
            };
            await this.receive(active, {
              type: "message_start",
              message: prepared,
            });
            await this.receive(active, {
              type: "message_end",
              message: prepared,
            });
            return {
              context: { ...context, messages: [prepared, ...effective] },
            };
          },
        },
        async (event) => {
          await this.receive(active, event);
        },
        signal,
        modelStream(
          config,
          this.store,
          scope,
          run.id,
          run.correlationId,
          "conversation",
        ),
      );
      if (signal.aborted) {
        reason = "aborted";
        failure = "Run cancelled";
      }
    } catch (error) {
      if (!signal.aborted) runtimeLogger.error("run execution failed", runtimeDiagnostic(error));
      reason = signal.aborted ? "aborted" : "error";
      failure = signal.aborted ? "Run cancelled" : safeMessage(error);
    }
    await closeMcp();
    await active.sandbox?.stop();
    try {
      await this.collect(active, null);
    } catch (error) {
      reason = "error";
      failure = safeMessage(error);
    }
    runtimeLogger.info(reason === "error" ? "run failed" : "run completed");
    await this.locked(scope, run.sessionId, async () => {
      active.pending.clear();
      const before = (await this.store.run(scope, run.id)).seq;
      await this.store.finish(scope, run.id, reason, failure);
      for (const envelope of await this.store.events(scope, run.id))
        if (envelope.cursor.seq > before) this.publish(active, envelope);
    });
  }
  private async collect(active: Active, toolCallId: string | null) {
    const sandbox = active.sandbox;
    if (!sandbox) return [];
    return this.files.withLock(async () => {
      const ids: string[] = [];
      const current = await this.files.scan(sandbox.workspace);
      const paths = new Set(current.map((f) => f.path));
      for (const name of active.outputBaseline.keys())
        if (!paths.has(name)) active.outputBaseline.delete(name);
      for (const file of current) {
        if (active.outputBaseline.get(file.path) === file.sha256) continue;
        await this.locked(active.scope, active.run.sessionId, async () => {
          const event = await this.store.registerArtifact(
            active.scope,
            active.run.id,
            toolCallId,
            file,
          );
          if (event.event.type !== "artifact_registered")
            throw new Error("Invalid artifact event");
          ids.push(event.event.artifact.id);
          this.publish(active, event);
        });
        active.outputBaseline.set(file.path, file.sha256);
      }
      return ids;
    });
  }
  async deleteSession(scope: Scope, id: string) {
    await this.files.withLock(() =>
      this.locked(scope, id, async () => {
        const hashes = (
          await this.store.pool.query(
            `SELECT DISTINCT sha256 FROM ${this.store.table("artifacts")} WHERE host_id=$1 AND domain_id=$2 AND session_id=$3`,
            [scope.hostId, scope.domainId, id],
          )
        ).rows;
        await this.store.deleteSession(scope, id);
        await new SessionSandbox(
          this.store,
          this.options.root,
          this.worker,
          scope,
          id,
        ).remove();
        for (const { sha256 } of hashes) {
          const referenced = (
            await this.store.pool.query(
              `SELECT EXISTS(SELECT 1 FROM ${this.store.table("artifacts")} WHERE sha256=$1) OR EXISTS(SELECT 1 FROM ${this.store.table("code_executions")} c, jsonb_each(c.outputs) o WHERE o.value->>'sha256'=$1) AS present`,
              [sha256],
            )
          ).rows[0].present;
          if (!referenced) await this.files.remove(sha256);
        }
      }),
    );
  }
  private async snapshotUnlocked(
    scope: Scope,
    runId: string,
    includeHistory = true,
  ): Promise<RuntimeRunSnapshot> {
    const state = await this.store.run(scope, runId);
    const active = this.active.get(key(scope, runId));
    const events = await this.store.toolEvents(scope, runId, !includeHistory);
    const tools = new Map<
      string,
      RuntimeRunSnapshot["toolExecutions"][number]
    >();
    for (const { event } of events) {
      if (event.type === "tool_execution_start")
        tools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: "running",
          result: null,
        });
      if (event.type === "tool_execution_end")
        tools.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: tools.get(event.toolCallId)?.args ?? {},
          status: event.isError ? "failed" : "completed",
          result: event.result,
        });
    }
    if (state.run.status !== "running")
      for (const tool of tools.values())
        if (tool.status === "running") tool.status = "unknown";
    return {
      run: state.run,
      cursor: { runId, seq: state.seq, streamId: state.streamId },
      messages: includeHistory ? await this.store.messages(scope, state.run.sessionId, undefined, runId) : [],
      pendingMessages: active
        ? [...active.pending].map(([id, message]) => ({
            id,
            message: structuredClone(message),
          }))
        : [],
      toolExecutions: [...tools.values()],
      artifacts: includeHistory ? await this.store.artifacts(scope, runId) : [],
    };
  }
  async snapshot(scope: Scope, runId: string) {
    const { run } = await this.store.run(scope, runId);
    return this.locked(scope, run.sessionId, () =>
      this.snapshotUnlocked(scope, runId),
    );
  }
  async session(
    scope: Scope,
    sessionId: string,
  ): Promise<RuntimeSessionSnapshot> {
    return this.locked(scope, sessionId, async () => {
      const session = await this.store.session(scope, sessionId);
      return {
        session,
        messages: await this.store.messages(scope, sessionId),
        latestRun: session.latestRunId
          ? await this.snapshotUnlocked(scope, session.latestRunId)
          : null,
      };
    });
  }
  async history(scope: Scope, sessionId: string, query: SessionHistoryQuery): Promise<RuntimeSessionHistory> {
    return this.locked(scope, sessionId, async () => {
      const session = await this.store.session(scope, sessionId);
      const window = await this.store.historyWindow(scope, sessionId, query);
      const ids = new Set(window.messages.map(message => message.runId));
      if (query.runId) {
        const selected = await this.store.run(scope, query.runId);
        if (selected.run.sessionId !== sessionId) throw new RuntimeError(404, "NOT_FOUND", "Run not found");
        ids.add(query.runId);
      }
      const runs = await this.store.historyRuns(scope, [...new Set([...ids, ...(session.latestRunId ? [session.latestRunId] : [])])]);
      const currentRun = runs.find(run => run.id === session.latestRunId) ?? null;
      let latestRun: RuntimeSessionHistory["latestRun"] = null;
      if (!query.before && !query.through && session.latestRunId) {
        const snapshot = await this.snapshotUnlocked(scope, session.latestRunId, false);
        ids.add(session.latestRunId);
        latestRun = {
          ...snapshot,
          run: currentRun!,
          pendingMessages: snapshot.pendingMessages.filter(entry => entry.message.role !== "system"),
        };
      }
      return { session: { ...session, latestRun: currentRun }, ...window, runs: runs.filter(run => ids.has(run.id)), latestRun };
    });
  }
  async subscribe(
    scope: Scope,
    runId: string,
    afterSeq: number,
    streamId: string,
    subscriber: Subscriber,
  ): Promise<() => void> {
    const { run } = await this.store.run(scope, runId);
    return this.locked(scope, run.sessionId, async () => {
      const state = await this.store.run(scope, runId);
      const active = this.active.get(key(scope, runId));
      if (afterSeq > state.seq)
        throw new RuntimeError(
          400,
          "INVALID_REQUEST",
          "Cursor is in the future",
        );
      if (
        streamId !== state.streamId ||
        (!active && afterSeq < state.seq) ||
        (active && afterSeq < active.lostThrough)
      ) {
        subscriber({
          type: "snapshot_required",
          runId,
          reason:
            streamId !== state.streamId ? "stream_replaced" : "buffer_lost",
        });
        return () => {};
      }
      if (active) {
        for (const envelope of active.frames)
          if (envelope.cursor.seq > afterSeq)
            subscriber({ type: "event", envelope });
        if (state.run.status === "running") active.subscribers.add(subscriber);
      }
      return () => {
        active?.subscribers.delete(subscriber);
      };
    });
  }
  async closeRunIntent(scope: Scope, sessionId: string, runId: string) {
    const admitted = await this.locked(scope, sessionId, async () => {
      await this.store.session(scope, sessionId);
      return this.store.closeAdmission(scope, runId, "run", sessionId);
    });
    // Run settlement takes the session lock; never await it while holding that lock.
    if (admitted) await this.cancel(scope, runId);
  }
  async cancel(scope: Scope, id: string) {
    await this.store.run(scope, id);
    const active = this.active.get(key(scope, id));
    active?.controller.abort();
    await active?.done;
    return { run: (await this.store.run(scope, id)).run };
  }
  async close() {
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
    await this.code.close();
    await runtimeLogging.close();
    await this.store.close();
  }
}
