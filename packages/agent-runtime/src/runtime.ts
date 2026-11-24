import { AgentChannel, type AgentProvider } from "./channel";
import { processLanguageInstruction } from "./process-language";
import { agentChannelCommandSchema, agentNotificationSchema, type AgentRunIntent } from "@ontomato/contracts/agent-channel";
import { BUILD_TEST_UNSUPPORTED } from "@ontomato/contracts/build-tests";
import type { RuntimePresentationCallback } from "@ontomato/contracts/agent-presentation";
import { Workspaces } from "./workspaces";
import type { RuntimeSessionHistory, SessionHistoryQuery } from "@ontomato/contracts/session-history";
import { ServiceLogStore, withServiceLogContext, getServiceLogContext, updateServiceLogContext } from "@ontomato/service-logging";
import { runtimeLogging, runtimeLogger, runtimeDiagnostic } from "./logging";
import { ArtifactFiles } from "./files";
import type { BusinessCallbackDispatcher } from "./business-callback";
import type { RuntimeBusinessCallbacks } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { SessionSandbox } from "./sandbox";
import { SessionEngines, type SessionEngineSandboxFactory } from "./session-engines";
import { HarnessRegistry } from "./adapters/registry";
import { piPlugin } from "./adapters/pi";
import type { HarnessEvent, HarnessPlugin, HarnessSession } from "./adapters/contract";
import { mkdir, chmod, readFile, writeFile, rename } from "node:fs/promises";
import { CodeExecutor } from "./code";
import { signalUid, assertWorkerPolicy, type WorkerPolicy } from "./worker";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { bindPlatformTools, usesEngineTools, type BoundPlatformTools } from "./platform-tools";
import path from "node:path";
import type { TSchema } from "typebox";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import { runAgentLoopContinue } from "./core/pi/agent-loop";
import type { AgentEvent, AgentTool } from "./core/pi/types";
import { contextTokens, cutPoint, serializeConversation } from "./compaction";
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
  runtimeAssistantStreamEventSchema,
  runtimeSettledMessageSchema,
  type RuntimeMessage,
  type RuntimeToolResultMessage,
} from "@ontomato/contracts/agent-runtime-messages";
import { runtimeRunDetailSchema } from "@ontomato/contracts/agent-runtime-details";
import type {
  RuntimeAgentEvent,
  RuntimeEventEnvelope,
  RuntimeSessionRunFrame,
  RuntimeStreamFrame,
  RuntimeToolResult,
} from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeJsonObject, RuntimeStopReason } from "@ontomato/contracts/agent-runtime-values";
import { RuntimeStore, digest, canonical, type Scope } from "./store";
import {
  SkillRegistry,
  skillCatalog,
  type RuntimeHost,
  type InstalledSkill,
} from "./skills";
import { piModel, litellmEntry, modelStream, completeSummary, recoverContext, type ResolvedChatModel } from "./model";
import type { ModelGatewayClient } from "./gateway-client";
import { RuntimeError, safeMessage } from "./errors";
import { connectMcp } from "./tools";
import { RuntimeMcpServices } from "./mcp";
import { RuntimeModelSettings } from "./model-settings";
import { modelKeySealKey } from "@ontomato/contracts/model-key-seal";

type Subscriber = (frame: RuntimeStreamFrame) => void;
type SessionRunSubscriber = (frame: RuntimeSessionRunFrame) => void;
interface Active {
  scope: Scope;
  run: RuntimeRun;
  controller: AbortController;
  done: Promise<void>;
  frames: RuntimeEventEnvelope[];
  lostThrough: number;
  pending: Map<string, RuntimeMessage>;
  messageIds: Map<string, string>;
  turnMessage?: RuntimeMessage;
  turnToolResults: RuntimeToolResultMessage[];
  toolResults: Map<string, RuntimeToolResult>;
  sentInputs: Map<string, { message: RuntimeMessage; context: string | null }>;
  engine?: HarnessSession;
  inputPump?: Promise<void>;
  inputPending: boolean;
  readonly steering: AbortController;
  inputError?: Error;
  skillCommands: Set<Promise<unknown>>;
  businessCallbacks: RuntimeBusinessCallbacks | undefined;
  turnIndex: number;
  subscribers: Set<Subscriber>;
  workspace?: string;
  currentMessageId?: string;
  outputBaseline: Map<string, string>;
  toolCalls: number;
  toolShapes: Map<string, number>;
  // Arguments of the tool calls in progress: the end event does not carry them.
  toolArgs: Map<string, unknown>;
  sealed: boolean;
  channelSecret?: string;
}
/** Aborts a run on its own behalf with the reason the stop notice reports. */
class RunStop extends Error {}
const stopMessage = (signal: AbortSignal) =>
  signal.reason instanceof RunStop ? signal.reason.message : "Run cancelled";
/** Digits and whitespace are noise for a command that only drifts a line number or an ID. */
const shape = (value: string) => value.replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** Adapts engine-neutral bound platform tools to the legacy in-process PI agent loop. */
function toPiAgentTools(bound: BoundPlatformTools): AgentTool[] {
  return bound.tools.map((tool) => ({
    name: tool.declaration.name,
    label: tool.label,
    description: tool.declaration.description,
    parameters: tool.declaration.parameters as unknown as TSchema,
    ...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
    ...(tool.replay ? { replay: tool.replay } : {}),
    async execute(toolCallId, args, signal, onUpdate) {
      const outcome = await bound.invoke({
        toolCallId,
        toolName: tool.declaration.name,
        args: (args ?? {}) as RuntimeJsonObject,
        signal: signal ?? new AbortController().signal,
        onUpdate: (partial) => {
          onUpdate?.({
            content: [{ type: "text", text: partial.text }],
            details: {},
            ...(partial.data !== undefined ? { structuredContent: partial.data } : {}),
          });
        },
      });
      return {
        content: outcome.result.content,
        details: outcome.result.details,
        ...(outcome.result.details.data !== undefined
          ? { structuredContent: outcome.result.details.data }
          : {}),
        isError: outcome.isError,
      };
    },
  }));
}

export interface RuntimeOptions {
  store: RuntimeStore;
  /** Every model call goes through this gateway; its leases are the only credentials the loop holds. */
  gateway: ModelGatewayClient;
  worker?: WorkerPolicy;
  root: string;
  hosts: RuntimeHost[];
  channelCommandBaseUrl: string;
  modelRuntimeToken?: string;
  modelSeed?: { baseUrl?: string; apiKey?: string; modelName?: string };
  eventBufferSize?: number;
  agentProviders?: AgentProvider[];
  engineRegistry?: HarnessRegistry;
  openEngineSandbox?: SessionEngineSandboxFactory;
}

/** Only the wire profile is persisted; provider diagnostics are deliberately not part of it. */
function projectMessage(message: Message | RuntimeMessage): RuntimeMessage {
  if (message.role === "notification") return agentNotificationSchema.parse(message);
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
  readonly channel: AgentChannel;
  readonly workspaces: Workspaces;
  readonly store: RuntimeStore;
  readonly logs: ServiceLogStore;
  readonly registry: SkillRegistry;
  readonly code: CodeExecutor;
  readonly worker: WorkerPolicy;
  readonly files: ArtifactFiles;
  readonly mcp: RuntimeMcpServices;
  readonly models: RuntimeModelSettings;
  readonly gateway: ModelGatewayClient;
  private readonly sessionEngines: SessionEngines;
  private active = new Map<string, Active>();
  private locks = new Map<string, Promise<unknown>>();
  private waiters = new Map<string, Set<() => void>>();
  private sessionRunSubscribers = new Map<string, Set<SessionRunSubscriber>>();
  constructor(readonly options: RuntimeOptions) {
    modelKeySealKey(options.modelRuntimeToken);
    this.store = options.store;
    this.channel = new AgentChannel(this);
    this.logs = new ServiceLogStore("agent-runtime", this.store.connectionString, this.store.schema, runtimeLogging.warn);
    this.mcp = new RuntimeMcpServices(this.store);
    this.models = new RuntimeModelSettings(this.store, options.modelRuntimeToken, options.modelSeed);
    this.gateway = options.gateway;
    this.sessionEngines = new SessionEngines(
      this.store, options.root, this.gateway, options.engineRegistry ?? new HarnessRegistry([piPlugin]),
      options.openEngineSandbox, this.locked.bind(this), this,
      error => runtimeLogger.error("Session engine release failed", runtimeDiagnostic(error)),
    );
    this.worker = {
      ...(options.worker ?? {
        development: process.env.NODE_ENV === "test",
        python: process.env.AGENT_RUNTIME_PYTHON || "python3",
      }),
      uidStatePath: path.join(options.root, "worker-next-uid"),
    };
    this.workspaces = new Workspaces(this.store, options.root, this.worker);
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
  async locked<T>(
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
    await this.models.initialize();
    runtimeLogging.attach(this.logs);
    if (!this.worker.development) {
      const rows = (
        await this.store.pool.query(
          `SELECT worker_uid FROM ${this.store.table("sessions")} WHERE worker_uid IS NOT NULL UNION SELECT worker_uid FROM ${this.store.table("workspaces")}`,
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
    await this.workspaces.recover();
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
    reserved = false,
  ) {
    const { presentationCallback, ...request } = runtimeStartRunRequestSchema.parse(body);
    const fingerprint = digest({
      sessionId,
      ...request,
      businessCallbacks: request.businessCallbacks && Object.fromEntries(
        Object.entries(request.businessCallbacks).map(([name, callback]) => [name, callback.baseUrl]),
      ),
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
      let config: ResolvedChatModel | undefined;
      let plugin: HarnessPlugin | undefined;
      let engineRef: string | null = null;
      let skills: InstalledSkill[] = [];
      // Read-only checks for unusable dependencies belong before admission, so a new run fails with
      // 422/503 instead of starting and reporting the same problem as a stopped run.
      if (!admitted.rowCount || reserved) {
        if (this.options.openEngineSandbox) {
          const binding = await this.store.sessionEngine(scope, sessionId);
          plugin = this.sessionEngines.plugin(binding.engine ?? request.definition.engine ?? piPlugin.id);
          engineRef = binding.engineRef;
          if (this.sessionEngines.needsOpen(scope, sessionId))
            config = await this.models.resolve(scope.domainId, request.definition.modelId);
        } else {
          config = await this.models.resolve(scope.domainId, request.definition.modelId);
          assertWorkerPolicy(this.worker);
        }
        skills = await Promise.all(
          request.definition.skills.map((version) =>
            this.registry.resolve(host, scope.domainId, version),
          ),
        );
        if (new Set(skills.map((s) => s.skill.name)).size !== skills.length)
          throw new RuntimeError(
            400,
            "INVALID_REQUEST",
            "Skill names must be unique within a run",
          );
      }
      const run: RuntimeRun = {
        id: runId,
        sessionId,
        domainId: scope.domainId,
        status: "running",
        correlationId,
        language: request.language,
        definition: request.definition,
        channel: request.channel,
        executionUserId: request.executionActor?.userId ?? null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        stopReason: null,
        errorMessage: null,
        answerMessageId: null,
        workspaceCommit: null,
        resolvedSkills: skills.map(
          ({ directory: _directory, ...registered }) => registered,
        ),
        environment: {
          values: request.environment.values,
          secretNames: Object.keys(request.environment.secrets).sort(),
        },
      };
      const accepted = await this.store.admit(
        scope,
        run,
        fingerprint,
        request.input,
        reserved,
        plugin?.id,
      );
      if (accepted.replayed) {
        const persisted = await this.store.pool.query(`SELECT log_context FROM ${this.store.table("runs")} WHERE host_id=$1 AND domain_id=$2 AND id=$3`, [scope.hostId, scope.domainId, runId]);
        updateServiceLogContext({ userId: persisted.rows[0]?.log_context?.userId ?? null });
        updateServiceLogContext({ correlationId: accepted.run.correlationId, runId: accepted.run.id, sessionId: accepted.run.sessionId });
        return accepted;
      }
      this.sessionEngines.admitted(scope, sessionId);
      // The admission is committed and this is not a retry: the session has a new run.
      this.publishSessionRun(scope, { type: "run_started", sessionId, runId });
      const logContext = { correlationId: run.correlationId, domainId: scope.domainId,
        userId: getServiceLogContext().userId ?? null, runId: run.id, sessionId: run.sessionId };
      updateServiceLogContext(logContext);
      const active: Active = {
        scope,
        run,
        controller: new AbortController(),
        done: Promise.resolve(),
        frames: [],
        lostThrough: 0,
        pending: new Map(),
        messageIds: new Map(),
        turnToolResults: [],
        toolResults: new Map(),
        sentInputs: new Map(),
        inputPending: false,
        steering: new AbortController(),
        skillCommands: new Set(),
        businessCallbacks: request.businessCallbacks,
        turnIndex: -1,
        subscribers: new Set(),
        outputBaseline: new Map(),
        toolCalls: 0,
        toolShapes: new Map(),
        toolArgs: new Map(),
        sealed: false,
      };
      // Register before any further await so a cancel that follows the admission response always
      // finds this run instead of returning it still running.
      this.active.set(key(scope, runId), active);
      // Load the admitted events while this admission still holds the session lock, so the first
      // subscriber always sees a complete replay buffer instead of an empty one.
      const loading = this.store.events(scope, runId).then((frames) => {
        active.frames = frames;
      });
      // The first execution begins after this admission lock is released, never on a read/retry.
      active.done = (async () => {
        await loading;
        const presentation = reserved ? presentationCallback : undefined;
        await withServiceLogContext(logContext, () => plugin
          ? this.execute(active, plugin, engineRef, config, accepted.inputId!, request, skills, presentation)
          : this.executeLegacy(active, config!, request, skills, presentation));
      })().finally(() => this.active.delete(key(scope, runId)));
      void active.done.catch(() =>
        withServiceLogContext(logContext, () => runtimeLogger.error("Runtime execution finalization failed")),
      );
      try {
        await loading;
      } catch (error) {
        this.active.delete(key(scope, runId));
        throw error;
      }
      return { run: accepted.run, replayed: false };
    });
  }
  async importAgentFile(scope:Scope,runId:string,taskId:string,file:{id:string;name:string},data:Buffer) {
    const workspace=this.active.get(key(scope,runId))!.workspace!;
    const relative=path.posix.join("outputs","agents",taskId,`${file.id}-${file.name}`),destination=path.join(workspace,relative),temporary=destination+`.${randomUUID()}.download`;
    await mkdir(path.dirname(destination),{recursive:true});
    await writeFile(temporary,data);await rename(temporary,destination);
    return relative;
  }
  async updateHostContext(scope: Scope,runId: string,context: string) {
    const active=this.active.get(key(scope,runId))!;
    active.run.definition.context=context;
    await this.store.pool.query(`UPDATE ${this.store.table("runs")} SET run=jsonb_set(run,'{definition,context}',$4::jsonb) WHERE host_id=$1 AND domain_id=$2 AND id=$3`,[scope.hostId,scope.domainId,runId,JSON.stringify(context)]);
  }
  seal(scope: Scope, runId: string) { this.active.get(key(scope, runId))!.sealed = true; }
  acceptsInput(scope: Scope, runId: string) { const active=this.active.get(key(scope,runId));return !!active && !active.sealed; }
  private channelCommandUrl(scope: Scope, runId: string): string {
    return `${this.options.channelCommandBaseUrl.replace(/\/$/, "")}/v1/channel/hosts/${encodeURIComponent(scope.hostId)}/domains/${encodeURIComponent(scope.domainId)}/runs/${encodeURIComponent(runId)}/commands`;
  }
  async runChannelCommand(
    scope: Scope,
    runId: string,
    credential: string | undefined,
    runHeader: string | undefined,
    executionContextHeader: string | undefined,
    body: unknown,
  ) {
    if (!credential || runHeader !== runId)
      throw new RuntimeError(401, "UNAUTHENTICATED", "Valid run callback credential and run ID are required");
    const active = this.active.get(key(scope, runId));
    if (!active)
      throw new RuntimeError(409, "RUN_CLOSED", "Run is closed");
    const expected = active.channelSecret ? Buffer.from(active.channelSecret) : null;
    const supplied = Buffer.from(credential);
    if (!expected || expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new RuntimeError(401, "UNAUTHENTICATED", "Invalid run callback credential");
    if (active.sealed || active.controller.signal.aborted || active.run.status !== "running")
      throw new RuntimeError(409, "RUN_CLOSED", "Run is closed");
    if (executionContextHeader !== undefined)
      throw new RuntimeError(422, BUILD_TEST_UNSUPPORTED, "The agent channel is not available in a build-test execution");
    return this.channel.execute(active.scope, active.run, agentChannelCommandSchema.parse(body));
  }
  private activeForSkillCallback(scope: Scope, sessionId: string, credential: string | undefined) {
    const runId = this.sessionEngines.callbackRun(scope, sessionId, credential);
    const active = this.active.get(key(scope, runId))!;
    if (active.sealed || active.controller.signal.aborted)
      throw new RuntimeError(409, "RUN_CLOSED", "No active run accepts skill commands");
    updateServiceLogContext({ domainId: scope.domainId, runId, sessionId, userId: active.run.executionUserId ?? null });
    return active;
  }

  private async trackSkillCommand<T>(active: Active, command: Promise<T>): Promise<T> {
    active.skillCommands.add(command);
    try {
      return await command;
    } finally {
      active.skillCommands.delete(command);
    }
  }

  async sessionChannelCommand(scope: Scope, sessionId: string, credential: string | undefined, executionContext: string | undefined, body: unknown) {
    const active = this.activeForSkillCallback(scope, sessionId, credential);
    const { run, controller } = active;
    if (executionContext !== undefined || run.channel?.authority.executionKind === "build-test")
      throw new RuntimeError(422, BUILD_TEST_UNSUPPORTED, "The agent channel is not available in a build-test execution");
    if (!run.channel || !usesEngineTools(run.definition))
      throw new RuntimeError(403, "FORBIDDEN", "Skill commands are not authorized for this run");
    return this.trackSkillCommand(active, this.channel.execute(scope, run, agentChannelCommandSchema.parse(body), controller.signal));
  }

  readonly withBusinessCallback: BusinessCallbackDispatcher["withBusinessCallback"] = async (scope, sessionId, kind, credential, forward) => {
    const active = this.activeForSkillCallback(scope, sessionId, credential);
    const target = active.businessCallbacks?.[kind];
    if (!target || !usesEngineTools(active.run.definition))
      throw new RuntimeError(403, "FORBIDDEN", "Business callback is not authorized for this run");
    await this.trackSkillCommand(active, forward(target, active.run.id, active.controller.signal));
  };

  async questionsChanged(scope: Scope, sessionId: string) {
    await this.locked(scope,sessionId,async()=>{
      const session=await this.store.session(scope,sessionId);
      if(!session.activeRunId) return;
      const active=this.active.get(key(scope,session.activeRunId))!;
      const envelope=await this.store.append(scope,session.activeRunId,{type:"pending_questions_changed",pendingQuestions:await this.channel.facts.pendingQuestions(scope,sessionId)});
      this.publish(active,envelope);
    });
  }
  async inputReceived(scope: Scope, runId: string, row: import("./store").MessageRow) {
    const active = this.active.get(key(scope, runId));
    if (!active || active.sealed) return;
    const envelope = await this.store.append(scope, runId, { type: "input_received", messageId: row.id, messageSeq: row.messageSeq, message: row.message as import("@ontomato/contracts/agent-channel").AgentInput });
    this.publish(active, envelope);
    if (this.options.openEngineSandbox) this.pushInputs(active);
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
  publishSessionRun(scope: Scope, frame: RuntimeSessionRunFrame) {
    const id = canonical([scope.hostId, scope.domainId]);
    for (const subscriber of this.sessionRunSubscribers.get(id) ?? [])
      subscriber(frame);
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
  private async receive(active: Active, event: HarnessEvent, beginTurn: (turn: number) => void) {
    if (event.type === "turn_start") {
      active.turnIndex++;
      active.turnMessage = undefined;
      active.turnToolResults = [];
      beginTurn(active.turnIndex);
      await this.emit(active, { type: "turn_start", turnIndex: active.turnIndex });
      return;
    }
    if (event.type === "turn_end") {
      if (active.turnMessage) await this.emit(active, {
        type: "turn_end", turnIndex: active.turnIndex,
        message: active.turnMessage, toolResults: active.turnToolResults,
      });
      return;
    }
    if (event.type === "message_start") {
      const id = randomUUID();
      active.messageIds.set(event.nativeId, id);
      const message = structuredClone(event.message);
      if (message.role === "assistant" && message.stopReason === "pending") message.content = [];
      await this.locked(active.scope, active.run.sessionId, async () => {
        const envelope = await this.store.append(active.scope, active.run.id, { type: "message_start", messageId: id, message });
        active.pending.set(id, structuredClone(message));
        this.publish(active, envelope);
      });
      return;
    }
    if (event.type === "message_update") {
      const id = this.platformMessageId(active, event.nativeId);
      const change = event.assistantMessageEvent;
      const { type } = change;
      const wire = runtimeAssistantStreamEventSchema.parse({
        type,
        ...("contentIndex" in change ? { contentIndex: change.contentIndex } : {}),
        ...("delta" in change ? { delta: change.delta } : {}),
        ...("reason" in change ? { reason: change.reason } : {}),
      });
      await this.locked(active.scope, active.run.sessionId, async () => {
        const envelope = await this.store.append(active.scope, active.run.id, {
          type: "message_update", messageId: id, assistantMessageEvent: wire,
        });
        const partial = active.pending.get(id);
        if (partial?.role === "assistant" && "contentIndex" in change) {
          const index = change.contentIndex;
          const block = partial.content[index];
          switch (change.type) {
            case "text_start": partial.content[index] = { type: "text", text: "" }; break;
            case "thinking_start": partial.content[index] = { type: "thinking", thinking: "" }; break;
            case "text_delta": if (block?.type === "text") block.text += change.delta; break;
            case "thinking_delta": if (block?.type === "thinking") block.thinking += change.delta; break;
            case "text_end": partial.content[index] = { type: "text", text: change.content }; break;
            case "thinking_end": partial.content[index] = { type: "thinking", thinking: change.content }; break;
            case "toolcall_start":
              partial.content[index] = { type: "toolCall", id: change.id, name: change.toolName, arguments: {} };
              break;
            case "toolcall_end": partial.content[index] = change.toolCall; break;
          }
        }
        this.publish(active, envelope);
      });
      return;
    }
    if (event.type === "message_end") {
      const id = this.platformMessageId(active, event.nativeId);
      const source = event.message;
      const message = runtimeSettledMessageSchema.parse(source.role === "toolResult"
        ? { ...source, details: active.toolResults.get(source.toolCallId)?.details, outcome: source.isError ? "failure" : "success" }
        : source);
      if (message.role === "assistant") active.turnMessage = message;
      if (message.role === "toolResult") active.turnToolResults.push(message);
      await this.emit(active, { type: "message_end", messageId: id, messageSeq: 0, contextSeq: null, message });
      return;
    }
    if (event.type === "tool_execution_end") {
      const result = {
        content: event.result.content,
        details: { ...event.result.details, artifactIds: await this.collect(active, event.toolCallId) },
      };
      if (!active.toolArgs.has(event.toolCallId)) throw new Error("Tool ended without a recorded start");
      await this.emit(active, { ...event, result, outcome: event.isError ? "failure" : "success" });
      active.toolResults.set(event.toolCallId, result);
      const args = active.toolArgs.get(event.toolCallId);
      active.toolArgs.delete(event.toolCallId);
      this.enforceToolCallPolicy(active, event.toolName, args);
      return;
    }
    if (event.type === "tool_execution_start") active.toolArgs.set(event.toolCallId, event.args);
    if (event.type === "run_detail") {
      const detail = event.detail.scope === "message"
        ? { ...event.detail, ref: this.platformMessageId(active, event.detail.ref!) }
        : event.detail;
      await this.emit(active, { type: "run_detail", detail: runtimeRunDetailSchema.parse(detail) });
      return;
    }
    if (event.type === "usage_updated") {
      const { nativeId, ...usage } = event.usage;
      await this.emit(active, {
        type: "usage_updated",
        usage: { ...usage, messageId: nativeId === null ? null : this.platformMessageId(active, nativeId) },
      });
      return;
    }
    await this.emit(active, event);
  }

  private platformMessageId(active: Active, nativeId: string) {
    const id = active.messageIds.get(nativeId);
    if (!id) throw new Error("Engine referenced a message before its start");
    return id;
  }

  private pushInputs(active: Active) {
    active.inputPending = true;
    if (!active.engine || active.inputPump || active.sealed) return;
    active.inputPump = this.sendInputs(active).catch(error => {
      if (!active.sealed && !active.controller.signal.aborted) {
        active.inputError = new Error(safeMessage(error));
        active.controller.abort(active.inputError);
      }
    }).finally(() => { active.inputPump = undefined; });
  }

  private async sendInputs(active: Active) {
    const { scope, run } = active;
    const signal = AbortSignal.any([active.controller.signal, active.steering.signal]);
    while (active.inputPending && !active.sealed && !signal.aborted) {
      active.inputPending = false;
      const pending = await this.locked(scope, run.sessionId, async () => {
        if ((await this.channel.facts.intent(scope, run.id)).cancelled) return [];
        return this.channel.facts.pending(scope, run.sessionId, undefined, run.id);
      });
      for (const row of pending) {
        if (active.sealed || signal.aborted) return;
        if (active.sentInputs.has(row.id)) continue;
        const input = await this.channel.prepareSteer(scope, run, row, signal);
        if (active.sealed || signal.aborted) return;
        active.sentInputs.set(row.id, { message: row.message, context: input.context });
        const receipt = await active.engine!.steer(input);
        if (!receipt.accepted) {
          active.sentInputs.delete(row.id);
          active.sealed = true;
          return;
        }
      }
    }
  }

  private async consumed(active: Active, inputId: string) {
    const { scope, run } = active;
    await this.locked(scope, run.sessionId, async () => {
      const input = active.sentInputs.get(inputId);
      if (!input) throw new Error("Engine acknowledged an input that was not sent");
      const envelope = await this.store.append(scope, run.id, {
        type: "message_end", messageId: inputId, messageSeq: 0, contextSeq: null, message: input.message,
      }, true);
      active.sentInputs.delete(inputId);
      if (input.context !== null) await this.updateHostContext(scope, run.id, input.context);
      this.publish(active, envelope);
    });
  }

  private async previousContext(scope: Scope, sessionId: string) {
    const rows = await this.store.contextMessages(scope, sessionId);
    if (!rows.length) return null;
    const { rows: [summary] } = await this.store.pool.query(
      `SELECT covered_seq,summary FROM ${this.store.table("compactions")}
       WHERE host_id=$1 AND domain_id=$2 AND session_id=$3 ORDER BY covered_seq DESC LIMIT 1`,
      [scope.hostId, scope.domainId, sessionId],
    );
    const messages = await Promise.all(rows
      .filter(row => row.contextSeq! > Number(summary?.covered_seq ?? 0) && row.message.role !== "system")
      .map(row => this.channel.modelMessage(scope.domainId, row.message)));
    if (summary) messages.unshift({
      role: "user", timestamp: Date.now(), content: `Previous conversation summary:\n${summary.summary}`,
    });
    return messages;
  }

  /** Counted after the call is recorded; aborting from the event sink lets the loop end and settle normally. */
  private enforceToolCallPolicy(active: Active, toolName: string, args: unknown) {
    const policy = active.run.definition.toolCallPolicy;
    if (!policy || active.controller.signal.aborted) return;
    active.toolCalls++;
    const key = shape(toolName) + ":" + shape(JSON.stringify(args ?? null));
    const same = (active.toolShapes.get(key) ?? 0) + 1;
    active.toolShapes.set(key, same);
    if (active.toolCalls > policy.maxCalls)
      active.controller.abort(new RunStop(`Stopped after more than ${policy.maxCalls} tool calls`));
    else if (same >= policy.maxSameShape)
      active.controller.abort(new RunStop(`Stopped after ${same} repeated ${toolName} calls without progress`));
  }
  private async execute(
    active: Active,
    plugin: HarnessPlugin,
    engineRef: string | null,
    config: ResolvedChatModel | undefined,
    openingInputId: string,
    request: RuntimeStartRunRequest,
    skills: InstalledSkill[],
    presentationCallback?: RuntimePresentationCallback,
  ) {
    const { scope, run, controller } = active;
    const signal = controller.signal;
    let reason: RuntimeStopReason = "error";
    let failure: string | null;
    let closeMcp: (() => Promise<void>) | undefined;
    try {
      signal.throwIfAborted();
      runtimeLogger.info("run started");
      const engineTools = usesEngineTools(request.definition);
      const mcp = await connectMcp(engineTools
        ? await this.mcp.resolve(scope, request.definition.externalMcp.map(ref => ref.id))
        : [], run.correlationId, signal);
      closeMcp = mcp.close;
      const bound = bindPlatformTools({
        runId: run.id,
        request,
        mcpTools: mcp.tools,
        channelTool: run.channel ? this.channel.tool(scope, run) : undefined,
        presentationCallback,
        authorize: () => signal.throwIfAborted(),
        onClose: mcp.close,
      });
      closeMcp = () => bound.close();
      const engine = await this.sessionEngines.open(scope, run.sessionId, {
        plugin, engineRef,
        config: () => config ? Promise.resolve(config) : this.models.resolve(scope.domainId, request.definition.modelId),
        skills: skills.map(skill => ({ name: skill.skill.name, directory: skill.directory })),
        language: run.language,
        limits: request.definition.sandbox.limits,
        tools: bound.declarations,
        engineTools: bound.engineTools,
        signal,
        previousContext: () => this.previousContext(scope, run.sessionId),
        prompt: () => ({
          system: [request.definition.systemPrompt, processLanguageInstruction(run.language)].filter(Boolean).join("\n\n"),
        }),
      });
      active.workspace = engine.sandbox.hostWorkspace;
      for (const file of await this.files.scan(active.workspace))
        active.outputBaseline.set(file.path, file.sha256);
      signal.throwIfAborted();
      const input = await this.channel.modelMessage(scope.domainId, request.input);
      active.sentInputs.set(openingInputId, { message: request.input, context: null });
      this.sessionEngines.beginRun(scope, run.sessionId, run.id);
      const pending = engine.handle.startTurn({
        runId: run.id,
        context: run.definition.context ?? null,
        inputs: [{ id: openingInputId, message: input, context: null }],
        host: {
          emit: event => this.receive(active, event, turn => bound.beginTurn(turn)),
          invokeTool: call => bound.invoke({ ...call, signal: AbortSignal.any([signal, call.signal]) }),
          consumed: id => this.consumed(active, id),
        },
      }, signal);
      active.engine = engine.handle;
      if (run.channel) this.pushInputs(active);
      const result = await pending;
      reason = active.inputError ? "error" : signal.aborted ? "aborted" : result.stopReason;
      failure = active.inputError?.message ?? (signal.aborted ? stopMessage(signal) : result.errorMessage);
    } catch (error) {
      if (!signal.aborted) runtimeLogger.error("run execution failed", runtimeDiagnostic(error));
      reason = signal.aborted ? "aborted" : "error";
      failure = signal.aborted ? stopMessage(signal) : safeMessage(error);
    } finally {
      active.sealed = true;
      active.steering.abort();
      this.sessionEngines.endRun(scope, run.sessionId);
    }
    const cleanup = async () => {
      try {
        await active.inputPump;
        await Promise.allSettled(active.skillCommands);
        await closeMcp?.();
      } finally {
        if (reason === "aborted" || reason === "error")
          await this.sessionEngines.release(scope, run.sessionId);
      }
    };
    try {
      await cleanup();
    } catch (error) {
      runtimeLogger.error("Run resource release failed", runtimeDiagnostic(error));
    }
    try {
      await this.collect(active, null);
    } catch (error) {
      if (reason !== "aborted") {
        reason = "error";
        failure = safeMessage(error);
      }
    }
    await this.settle(active, reason, failure);
  }
  // The current app has no session-engine factory until the coordinated engine switch.
  private async receiveLegacy(active: Active, event: AgentEvent) {
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
      const id = this.channel.inputIds.get(event.message) ?? randomUUID();
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
        contextSeq: null,
        message: projectMessage(event.message as Message),
      });
    if (event.type === "tool_execution_end") {
      if (process.env.NODE_ENV === "development" && event.durationMs !== undefined) {
        runtimeLogger.info("Query timing tool execution", {
          kind: "downstream", target: event.toolName,
          durationMs: event.durationMs, outcome: event.isError ? "failure" : "success",
        });
      }
      const result = {
        content: event.result.content,
        details: {
          artifactIds: [] as string[],
          ...(event.result.structuredContent === undefined
            ? {}
            : { data: event.result.structuredContent }),
        },
      };
      const collectionStarted = performance.now();
      result.details.artifactIds = await this.collect(active, event.toolCallId);
      if (process.env.NODE_ENV === "development") {
        runtimeLogger.info("Query timing tool artifact collection", {
          kind: "downstream", target: event.toolName,
          durationMs: Math.round(performance.now() - collectionStarted), outcome: "success",
        });
      }
      const envelope = await this.emit(active, { ...event, result });
      event.result.details = result.details;
      const args = active.toolArgs.get(event.toolCallId);
      active.toolArgs.delete(event.toolCallId);
      this.enforceToolCallPolicy(active, event.toolName, args);
      return envelope;
    }
    if (event.type === "tool_execution_start") active.toolArgs.set(event.toolCallId, event.args);
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
  private async executeLegacy(
    active: Active,
    config: ResolvedChatModel,
    request: RuntimeStartRunRequest,
    skills: InstalledSkill[],
    presentationCallback?: RuntimePresentationCallback,
  ) {
    const { scope, run, controller } = active;
    const signal = controller.signal;
    if (signal.aborted) {
      await this.settle(active, "aborted", stopMessage(signal));
      return;
    }
    runtimeLogger.info("run started");
    let reason: RuntimeStopReason | undefined;
    let failure: string | null = null;
    let closeMcp = async () => {};
    const lease = await this.gateway.lease({ [config.name]: litellmEntry(config) });
    let sandbox: SessionSandbox | undefined;
    try {
      const engineTools = usesEngineTools(request.definition);
      const mcpConfigs = engineTools
        ? await this.mcp.resolve(scope, request.definition.externalMcp.map((ref) => ref.id))
        : [];
      const rows = await this.store.contextMessages(scope, run.sessionId);
      // Admission commits the opening input first in context order, before any safe-boundary consumption.
      const openingMessageId = rows.find(row => row.runId === run.id)!.id;
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
      const previous = await Promise.all(rows
        .filter((r) => r.messageSeq > covered && r.runId !== null)
        .map((r) => this.channel.modelMessage(scope.domainId,r.message)));
      const messages = recoverContext(previous as Message[]);
      if (summary)
        messages.unshift({
          role: "user",
          content: `Previous conversation summary:\n${summary}`,
          timestamp: Date.now(),
        });
      sandbox = new SessionSandbox(
        this.store,
        this.options.root,
        this.worker,
        scope,
        run.sessionId,
      );
      const uid = await sandbox.prepare(skills);
      active.workspace = sandbox.workspace;
      for (const file of await this.files.scan(sandbox.workspace))
        active.outputBaseline.set(file.path, file.sha256);
      let channelEnv: { commandUrl: string; callbackSecret: string } | undefined;
      if (engineTools && run.channel) {
        active.channelSecret = randomBytes(32).toString("base64url");
        channelEnv = {
          commandUrl: this.channelCommandUrl(scope, run.id),
          callbackSecret: active.channelSecret,
        };
      }
      const engineToolList = !engineTools ? [] : await sandbox.start(
        uid,
        run.id,
        run.correlationId,
        request,
        skills,
        channelEnv,
      );
      const mcp = await connectMcp(
        engineTools ? mcpConfigs : [],
        run.correlationId,
        signal,
      );
      closeMcp = mcp.close;
      const boundTools = bindPlatformTools({
        runId: run.id,
        request,
        mcpTools: mcp.tools,
        channelTool: run.channel ? this.channel.tool(scope, run) : undefined,
        presentationCallback,
        authorize: () => {
          signal.throwIfAborted();
        },
        onClose: mcp.close,
      });
      closeMcp = () => boundTools.close();
      const tools: AgentTool[] = [
        ...engineToolList,
        ...toPiAgentTools(boundTools),
      ];
      if (new Set(tools.map((t) => t.name)).size !== tools.length)
        throw new Error("Exposed tool names must be unique");
      const model = piModel(config, lease);
      await runAgentLoopContinue(
        { messages, tools },
        {
          model,
          toolExecution: "sequential",
          beforeToolCall: presentationCallback
            ? async ({ assistantMessage }) => {
                boundTools.beginTurn(assistantMessage);
                return undefined;
              }
            : undefined,
          convertToLlm: (m) => Promise.all(m.map(message => this.channel.modelMessage(scope.domainId,message as RuntimeMessage))) as unknown as Promise<Message[]>,
          getFollowUpMessages: run.channel ? () => this.channel.followUp(scope, run) : undefined,
          getSteeringMessages: run.channel ? () => this.channel.steering(scope,run) : undefined,
          prepareRequest: async ({ context }) => {
            signal.throwIfAborted();
            const system = [
              request.definition.systemPrompt,
              request.definition.context,
              skillCatalog(active.workspace!, skills),
              processLanguageInstruction(request.language),
            ]
              .filter(Boolean)
              .join("\n\n");
            const raw = (
              await this.store.contextMessages(scope, run.sessionId)
            ).filter(
              (r) => r.messageSeq > covered && r.runId !== null && r.message.role !== "system",
            );
            const projected = await this.channel.modelMessagesForRun(scope, run, openingMessageId, raw);
            let effective = recoverContext(projected);
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
                projected,
                config.contextWindow,
              );
              if (cut > 0) {
                try {
                  const source = raw.slice(0, cut);
                  // Summaries survive the round. Use the original delivery text as their source.
                  const summaryMessages = await Promise.all(source.map((row, index) =>
                    row.message.role === "notification" && row.message.kind === "agent-result"
                      ? this.channel.modelMessage(scope.domainId, row.message)
                      : projected[index]!,
                  ));
                  const prompt = `<conversation>\n${serializeConversation(summaryMessages as Message[])}\n</conversation>\n${summary ? `<previous-summary>\n${summary}\n</previous-summary>\n` : ""}${summary ? request.definition.compaction.updatePrompt : request.definition.compaction.summarizePrompt}`;
                  const next = await completeSummary(
                    modelStream(
                      config,
                      lease,
                      this.store,
                      scope,
                      run.id,
                      run.correlationId,
                      "compaction",
                      request.language,
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
                      projected.slice(cut),
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
            return {
              context: { ...context, messages: [prepared, ...effective] },
            };
          },
        },
        async (event) => {
          await this.receiveLegacy(active, event);
        },
        signal,
        modelStream(
          config,
          lease,
          this.store,
          scope,
          run.id,
          run.correlationId,
          "conversation",
          request.language,
        ),
      );
      if (signal.aborted) {
        reason = "aborted";
        failure = stopMessage(signal);
      }
    } catch (error) {
      if (!signal.aborted) runtimeLogger.error("run execution failed", runtimeDiagnostic(error));
      reason = signal.aborted ? "aborted" : "error";
      failure = signal.aborted ? stopMessage(signal) : safeMessage(error);
    }
    await closeMcp();
    await sandbox?.stop();
    try {
      await this.collect(active, null);
    } catch (error) {
      reason = "error";
      failure = safeMessage(error);
    }
    // The run's model calls are over: revoke the lease before the run's stop is committed, cancelled runs included.
    await this.gateway.release(lease);
    await this.settle(active, reason, failure);
  }
  private async settle(
    active: Active,
    reason: RuntimeStopReason | undefined,
    failure: string | null,
  ) {
    const { scope, run } = active;
    let workspaceCommit: string | null = null;
    try {
      workspaceCommit = await this.workspaces.saveSession(scope, run.sessionId, run.id);
    } catch (error) {
      reason = "error";
      failure = safeMessage(error);
    }
    runtimeLogger.info(reason === "error" ? "run failed" : "run completed");
    let next: AgentRunIntent | undefined;
    await this.locked(scope, run.sessionId, async () => {
      active.sealed = true;
      active.pending.clear();
      const before = (await this.store.run(scope, run.id)).seq;
      await this.store.finish(scope, run.id, reason, failure, workspaceCommit);
      this.sessionEngines.idle(scope, run.sessionId);
      // The lifecycle notice follows the finish commit, independently of subsequent intent preparation.
      this.publishSessionRun(scope, { type: "run_stopped", sessionId: run.sessionId, runId: run.id });
      const stopped = (await this.store.run(scope, run.id)).run;
      next = await this.channel.nextLocked(scope, stopped);
      for (const envelope of await this.store.events(scope, run.id))
        if (envelope.cursor.seq > before) this.publish(active, envelope);
    });
    await this.channel.stopped(scope, (await this.store.run(scope, run.id)).run, next);
    // The stop is committed: wake everyone waiting for it.
    for (const wake of this.waiters.get(key(scope, run.id)) ?? []) wake();
  }
  private async collect(active: Active, toolCallId: string | null) {
    if (!active.workspace) return [];
    const workspace = active.workspace;
    return this.files.withLock(async () => {
      const ids: string[] = [];
      const current = await this.files.scan(workspace);
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
        await this.sessionEngines.remove(scope, id);
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
    const presentation = (await this.store.runPresentation(scope, [runId])).get(runId);
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
          status:
            event.outcome === "unknown"
              ? "unknown"
              : event.outcome === "failure"
                ? "failed"
                : event.outcome === "success"
                  ? "completed"
                  : event.isError
                    ? "failed"
                    : "completed",
          result: event.result,
        });
    }
    if (state.run.status !== "running")
      for (const tool of tools.values())
        if (tool.status === "running") tool.status = "unknown";
    return {
      run: state.run,
      pendingQuestions: await this.channel.facts.pendingQuestions(scope,state.run.sessionId),
      cursor: { runId, seq: state.seq, streamId: state.streamId },
      messages: includeHistory ? await this.store.messages(scope, state.run.sessionId, undefined, runId) : await this.store.consumedInputs(scope,state.run.sessionId,runId),
      pendingMessages: active
        ? [...active.pending].map(([id, message]) => ({
            id,
            message: structuredClone(message),
          }))
        : [],
      toolExecutions: [...tools.values()],
      artifacts: includeHistory ? await this.store.artifacts(scope, runId) : [],
      ...presentation,
    };
  }
  /**
   * The run's lifecycle view, read without events or the session lock. With a wait it returns once the
   * stop is committed, or still running at the timeout or when the caller goes away.
   */
  async runStatus(scope: Scope, runId: string, wait?: { timeoutMs: number; signal: AbortSignal }) {
    if (!wait) return this.store.runView(scope, runId);
    const id = key(scope, runId);
    let wake!: () => void;
    const woken = new Promise<void>((resolve) => (wake = resolve));
    // Register before reading, so a stop committed between the read and the wait still wakes this caller.
    const waiting = this.waiters.get(id) ?? new Set<() => void>();
    waiting.add(wake);
    this.waiters.set(id, waiting);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const current = await this.store.runView(scope, runId);
      if (current.status === "stopped") return current;
      wait.signal.addEventListener("abort", wake, { once: true });
      timer = setTimeout(wake, wait.timeoutMs);
      await woken;
      return await this.store.runView(scope, runId);
    } finally {
      clearTimeout(timer);
      wait.signal.removeEventListener("abort", wake);
      waiting.delete(wake);
      if (!waiting.size && this.waiters.get(id) === waiting) this.waiters.delete(id);
    }
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
        pendingQuestions: await this.channel.facts.pendingQuestions(scope,sessionId),
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
      const ids = new Set(window.messages.flatMap(message => message.runId ? [message.runId] : []));
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
      const presentation = await this.store.runPresentation(scope, [...ids].filter(id => id !== latestRun?.run.id));
      return {
        pendingQuestions: await this.channel.facts.pendingQuestions(scope,sessionId),
        session: { ...session, latestRun: currentRun }, ...window,
        runs: runs.filter(run => ids.has(run.id)).map(run => ({ ...run, ...presentation.get(run.id) })),
        latestRun,
      };
    });
  }
  /**
   * A process-local lifecycle subscription for one host/domain scope. Registering first
   * and then answering `ready` means every later change is delivered on this subscription.
   */
  subscribeSessionRuns(scope: Scope, subscriber: SessionRunSubscriber) {
    const id = canonical([scope.hostId, scope.domainId]);
    const subscribers =
      this.sessionRunSubscribers.get(id) ?? new Set<SessionRunSubscriber>();
    subscribers.add(subscriber);
    this.sessionRunSubscribers.set(id, subscribers);
    subscriber({ type: "ready" });
    return () => {
      subscribers.delete(subscriber);
      if (!subscribers.size) this.sessionRunSubscribers.delete(id);
    };
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
    const entry = (await this.store.pool.query(`SELECT intent FROM ${this.store.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND key=$3`,[scope.hostId,scope.domainId,runId])).rows[0];
    if (entry?.intent) {
      const intent = await this.channel.facts.intent(scope,runId);
      if (intent.session.sessionId !== sessionId) throw new RuntimeError(404,"NOT_FOUND","Run not found");
      await this.channel.cancel(scope,intent); return;
    }
    const admitted = await this.locked(scope, sessionId, async () => {
      await this.store.session(scope, sessionId);
      return this.store.closeAdmission(scope, runId, "run", sessionId);
    });
    // Run settlement takes the session lock; never await it while holding that lock.
    if (admitted) await this.cancel(scope, runId);
  }
  async cancel(scope: Scope, id: string, executionOnly = false) {
    const { run } = await this.store.run(scope, id);
    if (run.channel && !executionOnly) {
      await this.channel.cancel(scope, await this.channel.facts.intent(scope,id));
      return { run: (await this.store.run(scope,id)).run };
    }
    const active = this.active.get(key(scope, id));
    active?.controller.abort();
    await active?.done;
    return { run: (await this.store.run(scope, id)).run };
  }
  async close() {
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
    await this.sessionEngines.close();
    await this.code.close();
    await runtimeLogging.close();
    await this.store.close();
  }
}
