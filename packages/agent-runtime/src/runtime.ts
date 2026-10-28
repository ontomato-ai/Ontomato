import { mkdir, chmod } from "node:fs/promises";
import { CodeExecutor } from "./code";
import { removeWorkerFiles, type WorkerPolicy } from "./worker";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
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
import type { RuntimeArtifactOutput } from "@ontomato/contracts/agent-runtime-artifacts";
import type {
  RuntimeAgentEvent,
  RuntimeEventEnvelope,
  RuntimeStreamFrame,
} from "@ontomato/contracts/agent-runtime-events";
import type { RuntimeTerminalStatus } from "@ontomato/contracts/agent-runtime-values";
import { runAgentLoopContinue } from "./core/pi/agent-loop";
import type { AgentEvent, AgentTool } from "./core/pi/types";
import { RuntimeStore, digest, canonical, type Scope } from "./store";
import {
  SkillRegistry,
  executeSkill,
  type RuntimeHost,
  type InstalledSkill,
} from "./skills";
import {
  resolveModel,
  piModel,
  modelStream,
  completeSummary,
  recoverContext,
} from "./model";
import { RuntimeError, safeMessage } from "./errors";
import { contextTokens, cutPoint, serializeConversation } from "./compaction";
import { workspaceTools, connectMcp, type McpConnection } from "./tools";

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
  drafts: Map<string, RuntimeArtifactOutput[]>;
  secrets: string[];
}
export interface RuntimeOptions {
  store: RuntimeStore;
  worker?: WorkerPolicy;
  root: string;
  hosts: RuntimeHost[];
  ontologyUrl: string;
  modelRuntimeToken?: string;
  eventBufferSize?: number;
  maxArtifactBytes?: number;
  mcpServers?: McpConnection[];
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
  readonly registry: SkillRegistry;
  readonly code: CodeExecutor;
  readonly worker: WorkerPolicy;
  private active = new Map<string, Active>();
  private locks = new Map<string, Promise<unknown>>();
  constructor(readonly options: RuntimeOptions) {
    this.store = options.store;
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
    this.code = new CodeExecutor(
      this.store,
      this.registry,
      path.join(options.root, "executions"),
      this.worker,
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
    await this.store.initialize();
    await this.store.recover();
    await mkdir(this.options.root, { recursive: true, mode: 0o711 });
    await chmod(this.options.root, 0o711);
    await removeWorkerFiles(path.join(this.options.root, "invocations"));
    await mkdir(path.join(this.options.root, "invocations"), { mode: 0o711 });
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
    const bindings = {
      skillBindings: request.privateContext.skillBindings.map(
        ({ credential: _credential, ...binding }) => binding,
      ),
      python: request.privateContext.python
        ? (({ credential: _credential, ...binding }) => binding)(
            request.privateContext.python,
          )
        : undefined,
    };
    const fingerprint = digest({
      sessionId,
      ...request,
      privateContext: bindings,
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
        error: null,
      };
      let skills: InstalledSkill[] = [];
      if (!admitted.rowCount) {
        skills = await Promise.all(
          request.definition.skills.map((ref) =>
            this.registry.resolve(host, scope.domainId, ref),
          ),
        );
        const context = request.definition.contextSkill;
        if (
          context &&
          !skills.some((s) => canonical(s.skill) === canonical(context))
        )
          skills.push(
            await this.registry.resolve(host, scope.domainId, context),
          );
        const names = skills.flatMap((s) =>
          s.manifest.tools.map((t) => t.name),
        );
        if (new Set(names).size !== names.length)
          throw new RuntimeError(
            400,
            "INVALID_REQUEST",
            "Exposed tool names must be unique",
          );
        for (const skill of skills)
          if (
            !request.privateContext.skillBindings.some(
              (b) => canonical(b.skill) === canonical(skill.skill),
            )
          )
            throw new RuntimeError(
              400,
              "INVALID_REQUEST",
              "Missing private skill binding",
            );
        if (
          context &&
          !skills.find((s) => canonical(s.skill) === canonical(context))
            ?.manifest.contextEntry
        )
          throw new RuntimeError(
            400,
            "INVALID_REQUEST",
            "Context entry is not declared",
          );
      }
      const accepted = await this.store.admit(
        scope,
        run,
        fingerprint,
        request.input,
      );
      if (accepted.replayed) return accepted;
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
        drafts: new Map(),
        secrets: [
          host.token,
          this.options.modelRuntimeToken,
          ...[
            request.privateContext.modelCredential,
            ...request.privateContext.skillBindings.map((b) => b.credential),
            request.privateContext.python?.credential,
          ].flatMap((c) => (c && c.kind !== "none" ? [c.value] : [])),
        ].filter((v): v is string => Boolean(v)),
      };
      this.active.set(key(scope, runId), active);
      // The first execution begins after this admission lock is released, never on a read/retry.
      active.done = Promise.resolve()
        .then(() => this.execute(active, request, skills))
        .finally(() => this.active.delete(key(scope, runId)));
      void active.done.catch(() =>
        process.stderr.write(
          "Runtime persistence failed; run will be interrupted on restart\n",
        ),
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
  private async emit(
    active: Active,
    event: RuntimeAgentEvent,
    outputs: RuntimeArtifactOutput[] = [],
  ) {
    return this.locked(active.scope, active.run.sessionId, async () => {
      const envelope = await this.store.append(
        active.scope,
        active.run.id,
        event,
        outputs,
        this.options.maxArtifactBytes,
      );
      if (event.type === "message_end") active.pending.delete(event.messageId);
      this.publish(active, envelope);
      return envelope;
    });
  }
  private async receive(active: Active, event: AgentEvent) {
    // Provider failures may echo request headers. Scrub known private values before journaling.
    const clean = (value: unknown): unknown =>
      typeof value === "string"
        ? active.secrets.reduce(
            (text, secret) => text.split(secret).join("[redacted]"),
            value,
          )
        : Array.isArray(value)
          ? value.map(clean)
          : value && typeof value === "object"
            ? Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, clean(v)]),
              )
            : value;
    // Keep the original tool-result details object for the PI message's committed artifact IDs.
    const originalResult =
      event.type === "tool_execution_end" ? event.result : undefined;
    event = clean(event) as AgentEvent;
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
      const output = active.drafts.get(event.toolCallId) ?? [];
      active.drafts.delete(event.toolCallId);
      const envelope = await this.emit(
        active,
        { ...event, result },
        event.isError ? [] : output,
      );
      // PI creates the toolResult message after the awaited sink, so it sees committed IDs.
      event.result.details = result.details;
      if (originalResult) originalResult.details = result.details;
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
    const signal = controller.signal;
    let status: RuntimeTerminalStatus = "completed";
    let failure: RuntimeRun["error"] = null;
    let closeMcp = async () => {};
    try {
      const config = await resolveModel({
        baseUrl: this.options.ontologyUrl,
        runtimeToken: this.options.modelRuntimeToken,
        request,
        correlationId: run.correlationId,
        signal,
      });
      active.secrets.push(...config.apiKeys.filter(Boolean));
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
      const tools: AgentTool[] = skills
        .filter((s) =>
          request.definition.skills.some(
            (ref) => canonical(ref) === canonical(s.skill),
          ),
        )
        .flatMap((skill) =>
          skill.manifest.tools.map((tool) => ({
            name: tool.name,
            label: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as TSchema,
            execute: async (
              toolCallId: string,
              args: unknown,
              toolSignal?: AbortSignal,
              onUpdate?: (value: any) => void,
            ) => {
              const output = await executeSkill({
                policy: this.worker,
                assetRoot: path.join(this.options.root, "invocations"),
                skill,
                input: {
                  protocolVersion: 1,
                  kind: "tool",
                  toolName: tool.name,
                  arguments: args as Record<string, never>,
                },
                scope,
                sessionId: run.sessionId,
                runId: run.id,
                toolCallId,
                correlationId: run.correlationId,
                request,
                workspace: path.join(
                  this.options.root,
                  "workspaces",
                  digest(scope),
                  run.id,
                ),
                signal: toolSignal ?? signal,
                progress: (value) =>
                  onUpdate?.({
                    content: [{ type: "text", text: value.text }],
                    details: {},
                  }),
              });
              if (output.type === "error")
                return {
                  content: [
                    { type: "text" as const, text: output.error.message },
                  ],
                  details: {},
                  isError: true,
                };
              if (output.type !== "result")
                throw new Error("Invalid tool result kind");
              active.drafts.set(toolCallId, output.artifacts);
              return {
                content: [{ type: "text" as const, text: output.text }],
                details: {},
                structuredContent: output.data,
              };
            },
          })),
        );
      const workspace = path.join(
        this.options.root,
        "workspaces",
        digest(scope),
        run.id,
      );
      await mkdir(path.dirname(workspace), { recursive: true, mode: 0o711 });
      await chmod(path.dirname(workspace), 0o711);
      await chmod(path.dirname(path.dirname(workspace)), 0o711);
      for (const file of request.initialFiles ?? []) {
        const write = workspaceTools(workspace).find(
          (tool) => tool.name === "workspace_write",
        )!;
        await write.execute(
          "initial-file",
          { path: file.path, text: file.content },
          signal,
        );
      }
      if (request.definition.builtinTools.python) {
        if (!request.privateContext.python)
          throw new Error("Python binding is required");
        const host = this.options.hosts.find((h) => h.id === scope.hostId)!;
        tools.push(
          this.code.tool(
            host,
            scope,
            run.id,
            run.correlationId,
            workspace,
            request.privateContext.python,
          ),
        );
      }
      if (request.definition.builtinTools.workspaceFiles)
        tools.push(...workspaceTools(workspace));
      const mcp = await connectMcp(
        this.options.mcpServers ?? [],
        request.definition.externalMcp.map((ref) => ref.serverId),
        scope.hostId,
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
            let dynamic = "";
            if (request.definition.contextSkill) {
              const skill = skills.find(
                (s) =>
                  canonical(s.skill) ===
                  canonical(request.definition.contextSkill),
              )!;
              const result = await executeSkill({
                policy: this.worker,
                assetRoot: path.join(this.options.root, "invocations"),
                skill,
                input: { protocolVersion: 1, kind: "context" },
                scope,
                sessionId: run.sessionId,
                runId: run.id,
                correlationId: run.correlationId,
                request,
                workspace: path.join(
                  this.options.root,
                  "workspaces",
                  digest(scope),
                  run.id,
                ),
                signal,
              });
              if (result.type !== "context_result")
                throw new Error(
                  result.type === "error"
                    ? result.error.message
                    : "Invalid context output",
                );
              dynamic = result.systemContext;
            }
            const system = [
              request.definition.systemPrompt,
              ...skills.map((s) => s.instructions),
              dynamic,
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
      const last = (await this.store.messages(scope, run.sessionId)).at(
        -1,
      )?.message;
      if (last?.role === "assistant" && last.stopReason === "error")
        throw new Error(last.errorMessage || "Model request failed");
      if (signal.aborted) status = "cancelled";
    } catch (error) {
      status = signal.aborted ? "cancelled" : "failed";

      if (!signal.aborted)
        failure = {
          code: error instanceof RuntimeError ? error.code : "RUN_FAILED",
          message: active.secrets.reduce(
            (text, secret) => text.split(secret).join("[redacted]"),
            safeMessage(error),
          ),
        };
    }
    await closeMcp();
    await this.locked(scope, run.sessionId, async () => {
      active.pending.clear();
      this.publish(
        active,
        await this.store.finish(scope, run.id, status, failure),
      );
    });
  }
  private async snapshotUnlocked(
    scope: Scope,
    runId: string,
  ): Promise<RuntimeRunSnapshot> {
    const state = await this.store.run(scope, runId);
    const active = this.active.get(key(scope, runId));
    const events = await this.store.events(scope, runId);
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
      messages: (await this.store.messages(scope, state.run.sessionId)).filter(
        (r) => r.runId === runId,
      ),
      pendingMessages: active
        ? [...active.pending].map(([id, message]) => ({
            id,
            message: structuredClone(message),
          }))
        : [],
      toolExecutions: [...tools.values()],
      artifacts: await this.store.artifacts(scope, runId),
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
    await this.code.cancelRun(scope, id);
    await active?.done;
    return { run: (await this.store.run(scope, id)).run };
  }
  async close() {
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.done));
    await this.code.close();
    await this.store.close();
  }
}
