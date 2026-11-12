import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { z } from "zod";
import { agentChannelCommandSchema, agentDeliverySchema, agentProviderAcknowledgementSchema, agentDirectorySchema, type AgentRunIntent, type AgentRunContext, type AgentExecutionRef, type AgentSessionRef, type AgentInput, type AgentNotification, type AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { runtimeStartRunRequestSchema, type RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type { ChannelAgentTask } from "@ontomato/contracts/agent-tasks";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentTool } from "./core/pi/types";
import type { AgentRuntime } from "./runtime";
import type { Scope } from "./store";
import { ChannelStore } from "./channel-store";
import { RuntimeError, safeMessage } from "./errors";
import { runtimeLogger, runtimeDiagnostic } from "./logging";

export interface AgentProvider { id: string; hostId: string; url: string; token: string }
type Listener = () => void;
export class AgentChannel {
  readonly facts: ChannelStore;
  /** PI returns the same queued object; preserve its receipt identity in the event sink. */
  readonly inputIds = new WeakMap<object, string>();
  private listeners = new Map<string, Set<Listener>>();
  constructor(readonly runtime: AgentRuntime) { this.facts = new ChannelStore(runtime.store); }
  provider(id: string) {
    const provider = this.runtime.options.agentProviders?.find(p => p.id === id);
    if (!provider) throw new RuntimeError(404, "PROVIDER_NOT_REGISTERED", "Agent provider is not registered");
    return provider;
  }
  scope(ref: AgentSessionRef, domainId: string): Scope { return { hostId: this.provider(ref.providerId).hostId, domainId }; }
  private async post(port: { url: string; token: string }, path: string, body: unknown, domainId: string) {
    const response = await fetch(port.url.replace(/\/$/, "") + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": port.token, "X-Domain-Id": domainId },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok) {
      const failure = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).parse(value);
      throw new RuntimeError(response.status, failure.error.code, failure.error.message);
    }
    return value;
  }
  async callback(intent: AgentRunIntent, action: "settle" | "read" | "cancel") {
    const value = await this.post(this.provider(intent.session.providerId), "/" + action, { execution: { session: intent.session, runId: intent.id }, actor: intent.channel.actor }, intent.channel.actor.domainId);
    return action === "read" ? value : agentProviderAcknowledgementSchema.parse(value);
  }
  private changed(scope: Scope, sessionId: string) { for (const listener of this.listeners.get(JSON.stringify([scope,sessionId])) ?? []) listener(); }
  private announce(intent: AgentRunIntent) {
    const domain = intent.channel.actor.domainId;
    const sessions = new Map([intent.session,intent.channel.root.session,...(intent.channel.requestedBy ? [intent.channel.requestedBy.session] : [])].map(session => [JSON.stringify([session.providerId,session.sessionId]),session]));
    for (const session of sessions.values()) this.changed(this.scope(session,domain),session.sessionId);
  }
  subscribe(scope: Scope, sessionId: string, listener: Listener) {
    const id = JSON.stringify([scope,sessionId]), set = this.listeners.get(id) ?? new Set<Listener>();
    set.add(listener); this.listeners.set(id, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(id); };
  }
  async request(scope: Scope, sessionId: string, runId: string, channel: AgentRunContext, input: AgentInput, language: string, context?: AgentRunIntent["context"]) {
    if (scope.domainId !== channel.actor.domainId || this.provider(channel.agent.providerId).hostId !== scope.hostId)
      throw new RuntimeError(403, "CROSS_DOMAIN", "Agent identity and target must belong to the current domain and provider");
    let replay: RuntimeRun | undefined;
    const intent = await this.runtime.locked(scope, sessionId, async () => {
      const existing = (await this.runtime.store.pool.query(`SELECT intent FROM ${this.runtime.store.table("admissions")} WHERE host_id=$1 AND domain_id=$2 AND key=$3`, [scope.hostId,scope.domainId,runId])).rows[0];
      if (existing) {
        const original = existing.intent as AgentRunIntent;
        if (original.session.sessionId !== sessionId) throw new RuntimeError(409,"IDEMPOTENCY_CONFLICT","Run belongs to another session");
        if (original.status === "starting") throw new RuntimeError(409,"SESSION_BUSY","Execution is preparing");
        if (original.status === "failed" || original.status === "cancelled") throw new RuntimeError(409,"RUN_CLOSED",original.error ?? "Execution intent is closed");
        const source = (await this.runtime.store.messages(scope,sessionId)).find(row => row.id === original.inputId)!.message;
        if (source.role !== input.role || JSON.stringify(source.content) !== JSON.stringify(input.content)) throw new RuntimeError(409,"IDEMPOTENCY_CONFLICT","Run input changed");
        replay = (await this.runtime.store.run(scope,runId)).run;
        return original;
      }
      const session = await this.runtime.store.session(scope, sessionId);
      if (session.activeRunId || await this.facts.preparing(scope, sessionId)) throw new RuntimeError(409, "SESSION_BUSY", "Session already has an execution intent");
      const binding = await this.facts.binding(scope, sessionId);
      if (binding.agent.agentId !== channel.agent.agentId) throw new RuntimeError(409, "AGENT_CHANGED", "Session belongs to another agent");
      await this.facts.bind(scope, sessionId, { ...binding, actor: channel.actor, context });
      const record = await this.facts.receive(scope, sessionId, input);
      return this.facts.reserve(scope, sessionId, runId, record.id, channel, { language,context });
    });
    if (replay) return { run: replay, replayed: true };
    this.announce(intent);
    await this.prepare(intent);
    return { run: (await this.runtime.store.run(scope, runId)).run, replayed: false };
  }
  async prepare(intent: AgentRunIntent) {
    const scope = this.scope(intent.session, intent.channel.actor.domainId);
    let hostPrepared = false;
    try {
      const input = (await this.facts.pending(scope, intent.session.sessionId)).find(row => row.id === intent.inputId)!.message as AgentInput;
      const request: AgentPrepareRequest = { mode: "run", language: intent.language, agent: intent.channel.agent, sessionId: intent.session.sessionId, runId: intent.id, actor: intent.channel.actor, input, authority: intent.channel.authority, context: intent.context };
      const prepared = runtimeStartRunRequestSchema.parse(await this.post(this.provider(intent.session.providerId), "/prepare", request, scope.domainId));
      hostPrepared = true;
      const authority = prepared.authority ?? intent.channel.authority;
      const inherited = intent.channel.authority;
      if (inherited.executionKind === "build-test" && authority.executionKind !== "build-test") throw new RuntimeError(403,"BUILD_TEST_FORBIDDEN","A provider cannot change build-test authority to live");
      if (inherited.classNames.length && (!authority.classNames.length || authority.classNames.some(name => !inherited.classNames.includes(name)))) throw new RuntimeError(403,"SCOPE_EXPANDED","A provider cannot expand the delegated class scope");
      const channel = { ...intent.channel, authority };
      const host = this.runtime.options.hosts.find(host => host.id === scope.hostId)!;
      await this.runtime.start(host, scope, intent.session.sessionId, intent.id, intent.id, { ...prepared, language: intent.language, input, channel }, true);
      this.announce(intent);
    } catch (error) {
      let failure = safeMessage(error);
      if (hostPrepared) {
        try { await this.callback(intent,"cancel"); }
        catch (closing) { failure += `; host cancellation failed: ${safeMessage(closing)}`; }
      }
      await this.runtime.locked(scope, intent.session.sessionId, async () => {
        const current = await this.facts.intent(scope, intent.id);
        current.status = current.cancelled ? "cancelled" : "failed";
        current.error = failure;
        await this.facts.update(scope, current);
      });
      this.announce(intent);
      await this.notify(scope, intent.id);
      throw error;
    }
  }
  private launch(intent: AgentRunIntent) {
    if (intent.cancelled) return;
    void this.prepare(intent).catch(error => runtimeLogger.error("Agent preparation failed", runtimeDiagnostic(error)));
  }
  /** All addressed inputs use this path, irrespective of whether they carry a result or a question. */
  async deliver(target: AgentSessionRef, actor: AgentRunContext["actor"], input: AgentNotification, requestedBy?: AgentExecutionRef) {
    const scope = this.scope(target, actor.domainId);
    let next: AgentRunIntent | undefined;
    const record = await this.runtime.locked(scope, target.sessionId, async () => {
      const binding = await this.facts.binding(scope, target.sessionId);
      if (binding.actor.domainId !== actor.domainId) throw new RuntimeError(403, "CROSS_DOMAIN", "Cross-domain messages are forbidden");
      const received = await this.facts.receive(scope, target.sessionId, input);
      const session = await this.runtime.store.session(scope, target.sessionId);
      if (session.activeRunId) {
        await this.runtime.notificationReceived(scope, session.activeRunId, received);
      } else if (!await this.facts.preparing(scope, target.sessionId)) {
        const previous = await this.facts.latest(scope,target.sessionId);
        const sender = await this.facts.intent(this.scope(input.source.session,scope.domainId),input.source.runId);
        if (sender.cancelled || (previous.cancelled && !requestedBy)) return received;
        const latest = previous.channel;
        const runId = randomUUID();
        const requesterRun = requestedBy ? (await this.runtime.store.run(this.scope(requestedBy.session, actor.domainId),requestedBy.runId)).run : null;
        const requester = requesterRun?.channel;
        const channel: AgentRunContext = { agent: binding.agent, actor: requestedBy ? actor : latest.actor, authority: requester?.authority ?? latest.authority,
          requestedBy: requestedBy ?? latest.requestedBy,
          root: requester?.root ?? latest.root };
        const language = requesterRun?.language ?? previous.language;
        next = await this.facts.reserve(scope, target.sessionId, runId, received.id, channel, { language,context: binding.context });
        if (requestedBy) await this.facts.bind(scope,target.sessionId,{ ...binding,actor });
      }
      return received;
    });
    this.changed(scope,target.sessionId);
    if (next) this.launch(next);
    return { messageId: record.id, taskId: next?.id ?? null, sessionRef: target };
  }
  /** Called while holding the same session lock as store.finish. No callback is made here. */
  async nextLocked(scope: Scope, run: RuntimeRun): Promise<AgentRunIntent | undefined> {
    if (!run.channel) return;
    const intent = await this.facts.intent(scope, run.id);
    intent.status = run.stopReason === "aborted" ? "cancelled" : run.stopReason === "error" ? "failed" : "completed";
    intent.error = run.errorMessage;
    await this.facts.update(scope, intent);
    if (intent.cancelled) return;
    const rows = await this.facts.pending(scope, run.sessionId);
    if (!rows.length) return;
    return this.facts.reserve(scope, run.sessionId, randomUUID(), rows[0].id, run.channel, { language: intent.language,context: intent.context });
  }
  async stopped(scope: Scope, run: RuntimeRun, next?: AgentRunIntent) {
    if (!run.channel) return;
    const intent = await this.facts.intent(scope, run.id);
    try {
      await this.callback(intent, "settle");
      await this.notify(scope, run.id);
    } catch (error) {
      intent.error = safeMessage(error); intent.status = "failed";
      await this.facts.update(scope, intent);
      this.announce(intent);
      await this.notify(scope,run.id);
      throw error;
    } finally { if (next) this.launch(next); }
  }
  private async notify(scope: Scope, runId: string) {
    const intent = await this.facts.intent(scope, runId);
    this.announce(intent);
    const parent = intent.channel.requestedBy;
    if (!parent || intent.cancelled) return;
    const delivery = intent.status === "failed" || intent.status === "cancelled"
      ? { status: intent.status, summary: intent.error ?? intent.status }
      : agentDeliverySchema.parse(await this.callback(intent, "read"));
    if (delivery.status === "running" || delivery.status === "starting") return;
    await this.deliver(parent.session, intent.channel.actor, { role: "notification", kind: "agent-result", source: { session: intent.session, runId }, outcome: delivery.status, content: delivery.summary, timestamp: Date.now() });
  }
  async followUp(scope: Scope, run: RuntimeRun): Promise<Message[]> {
    const pending = await this.runtime.locked(scope, run.sessionId, async () => {
      if ((await this.facts.intent(scope,run.id)).cancelled) { this.runtime.seal(scope,run.id); return []; }
      const rows = await this.facts.pending(scope, run.sessionId);
      if (!rows.length) this.runtime.seal(scope, run.id);
      return rows;
    });
    if (!pending.length) return [];
    try {
      for (const row of pending) {
        const channel = run.channel!;
        agentProviderAcknowledgementSchema.parse(await this.post(this.provider(channel.agent.providerId), "/prepare", { mode: "steer", language: run.language, agent: channel.agent, actor: channel.actor, sessionId: run.sessionId, runId: run.id, input: row.message, authority: channel.authority }, scope.domainId));
      }
    } finally {
      await this.runtime.locked(scope, run.sessionId, () => this.facts.consume(scope, run.sessionId, run.id, pending.map(row => row.id)));
    }
    return pending.map(row => { const message = row.message as unknown as Message; this.inputIds.set(message, row.id); return message; });
  }
  tool(scope: Scope, run: RuntimeRun): AgentTool {
    return {
      name: "agent", label: "Agent", description: "Communicate with authorized agents. list discovers provider/agent references; start creates an independent child session and returns immediately. send addresses your creator or a child; any addressed input wakes an idle session or is consumed at a safe boundary. Questions include a default assumption and do not stop your work. read inspects an execution; cancel cancels it and its delegated descendants.",
      parameters: Type.Object({ op: Type.String(), agent: Type.Optional(Type.Object({ providerId: Type.String(), agentId: Type.String() })), session: Type.Optional(Type.Object({ providerId: Type.String(), sessionId: Type.String() })), message: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()), query: Type.Optional(Type.String()), title: Type.Optional(Type.String()), context: Type.Optional(Type.Record(Type.String(), Type.Unknown())), view: Type.Optional(Type.String()), cursor: Type.Optional(Type.Number()), limit: Type.Optional(Type.Number()), kind: Type.Optional(Type.String()), replyTo: Type.Optional(Type.String()), defaultAssumption: Type.Optional(Type.String()) }),
      execute: async (_id, raw) => { const value = await this.execute(scope, run, raw); return { content: [{ type: "text", text: JSON.stringify(value) }], details: {} }; },
    };
  }
  async execute(scope: Scope, run: RuntimeRun, raw: unknown): Promise<unknown> {
    const command = agentChannelCommandSchema.parse(raw);
    const channel = run.channel;
    if (!channel) throw new RuntimeError(403, "ACTOR_REQUIRED", "The host did not supply an agent caller");
    const source: AgentExecutionRef = { session: { providerId: channel.agent.providerId, sessionId: run.sessionId }, runId: run.id };
    if (command.op === "list") {
      const directories = await Promise.all((this.runtime.options.agentProviders ?? []).map(async provider => {
        const result = agentDirectorySchema.parse(await this.post(provider,"/list",{ providerId: provider.id,actor: channel.actor },scope.domainId));
        if (result.agents.some(entry => entry.ref.providerId !== provider.id)) throw new RuntimeError(502,"INVALID_PROVIDER_DIRECTORY","A provider must list only its own agents");
        return result.agents;
      }));
      return { agents: directories.flat().filter(entry => !command.query || `${entry.name} ${entry.description}`.toLowerCase().includes(command.query.toLowerCase())) };
    }
    if (command.op === "start") {
      const target = { providerId: command.agent.providerId, sessionId: randomUUID() }, targetScope = this.scope(target, scope.domainId);
      const intent = await this.runtime.locked(targetScope, target.sessionId, () => this.facts.reserve(targetScope, target.sessionId, randomUUID(), randomUUID(),
        { agent: command.agent, actor: channel.actor, authority: channel.authority, requestedBy: source, root: channel.root },
        { language: run.language,context: command.context, title: command.title, create: { binding: { agent: command.agent, actor: channel.actor, parent: source, context: command.context },
          input: { role: "notification", kind: "agent-message", source, content: command.message, timestamp: Date.now() } } }));
      this.announce(intent); this.launch(intent);
      return { taskId: intent.id, sessionRef: target, status: intent.status };
    }
    if (command.op === "send") {
      const binding = await this.facts.binding(this.scope(command.session, scope.domainId), command.session.sessionId);
      const own = await this.facts.binding(scope, run.sessionId);
      const child = binding.parent?.session.providerId === source.session.providerId && binding.parent.session.sessionId === run.sessionId;
      const parent = own.parent?.session.providerId === command.session.providerId && own.parent.session.sessionId === command.session.sessionId;
      if (!child && !parent) throw new RuntimeError(403, "FORBIDDEN", "Messages may only address your creator or a session you created");
      return this.deliver(command.session, channel.actor, { role: "notification", kind: command.kind ?? "agent-message", source, content: command.message, timestamp: Date.now(), replyTo: command.replyTo, defaultAssumption: command.defaultAssumption }, child ? source : undefined);
    }
    const entry = await this.facts.task(scope.domainId,command.taskId);
    if (!entry || !await this.accessible(entry.intent,source.session,scope.domainId)) throw new RuntimeError(403, "FORBIDDEN", "Execution is outside your delegation tree");
    if (command.op === "cancel") { await this.cancel(entry.scope, entry.intent); return { taskId: command.taskId, accepted: true }; }
    const intent = entry.intent;
    if (intent.status === "starting" || intent.status === "failed" || intent.status === "cancelled") return { taskId: intent.id, status: intent.status, error: intent.error };
    const result = agentDeliverySchema.parse(await this.callback(intent, "read"));
    if (command.view !== "messages") return { taskId: intent.id, ...result };
    const messages = (await this.runtime.store.messages(entry.scope, intent.session.sessionId)).filter(row => row.runId === intent.id && row.message.role !== "system" && row.messageSeq > (command.cursor ?? 0)).slice(0, command.limit ?? 50);
    return { taskId: intent.id, ...result, messages, cursor: messages.at(-1)?.messageSeq ?? command.cursor ?? 0 };
  }
  private async accessible(intent: AgentRunIntent, source: AgentSessionRef, domainId: string) {
    const sameSession = (ref: AgentSessionRef) => ref.providerId === source.providerId && ref.sessionId === source.sessionId;
    if (sameSession(intent.session)) return true;
    let current = intent;
    while (current.channel.requestedBy) {
      const parent = current.channel.requestedBy;
      if (sameSession(parent.session)) return true;
      current = await this.facts.intent(this.scope(parent.session,domainId),parent.runId);
    }
    return false;
  }
  async cancel(scope: Scope, intent: AgentRunIntent) {
    const descendants: Array<{ scope: Scope; intent: AgentRunIntent }> = [];
    const seal = async (scope: Scope, candidate: AgentRunIntent) => {
      const children = await this.runtime.locked(scope,candidate.session.sessionId,async () => {
        const current = await this.facts.intent(scope,candidate.id);
        current.cancelled = true;
        if (current.status === "starting") current.status = "cancelled";
        await this.facts.update(scope,current);
        descendants.push({ scope,intent: current });
        return this.facts.children(scope.domainId,{ session: current.session,runId: current.id });
      });
      for (const child of children) await seal(child.scope,child.intent);
    };
    await seal(scope,intent);
    const failures: unknown[] = [];
    for (const entry of descendants.reverse()) {
      try { if (entry.intent.status !== "starting" && entry.intent.status !== "cancelled") await this.callback(entry.intent, "cancel"); }
      catch (error) { failures.push(error); }
      try { if (entry.intent.status === "running") await this.runtime.cancel(entry.scope, entry.intent.id, true); }
      catch (error) { failures.push(error); }
    }
    for (const entry of descendants) this.announce(entry.intent);
    if (failures.length) throw new AggregateError(failures,"One or more agent hosts rejected cancellation settlement");
  }
  async process(scope: Scope, sessionId: string, taskId: string) {
    const task = (await this.tasks(scope, sessionId)).tasks.find(task => task.id === taskId);
    if (!task || task.process.mode !== "inline") throw new RuntimeError(404, "NOT_FOUND", "Task process not found");
    return { scope: this.scope(task.sessionRef, scope.domainId), runId: task.runId };
  }
  async tasks(scope: Scope, sessionId: string) {
    await this.runtime.store.session(scope, sessionId);
    const sessions = (this.runtime.options.agentProviders ?? []).filter(provider => provider.hostId === scope.hostId).map(provider => ({ providerId: provider.id,sessionId }));
    const roots = await this.facts.descendants(scope.domainId,sessions);
    const own = (source: AgentExecutionRef) => sessions.some(session => session.providerId === source.session.providerId && session.sessionId === source.session.sessionId);
    const tasks: ChannelAgentTask[] = [];
    for (const { intent,rootRunId } of roots) {
      const requestedBy = intent.channel.requestedBy!;
      const delivery = intent.status === "starting" || intent.status === "failed" || intent.status === "cancelled" ? null : agentDeliverySchema.parse(await this.callback(intent, "read"));
      const input = (await this.runtime.store.messages(this.scope(intent.session,scope.domainId),intent.session.sessionId)).find(row => row.id === intent.inputId)!.message;
      tasks.push({ id: intent.id, kind: "agent", root: { sessionId, runId: rootRunId }, requestedBy, parentTaskId: own(requestedBy) ? null : requestedBy.runId,
        title: intent.title ?? (typeof input.content === "string" ? input.content.split("\n")[0] : intent.channel.agent.agentId), status: delivery?.status ?? intent.status, error: intent.error ? { code: "AGENT_EXECUTION_FAILED", message: intent.error } : null,
        createdAt: intent.createdAt, agentRef: intent.channel.agent, sessionRef: intent.session, runId: intent.id, process: delivery?.process ?? { mode: "none" }, results: delivery?.results ?? [] });
    }
    return { sessionId, tasks, qualityResults: [], preparationFailures: await this.facts.preparationFailures(scope,sessionId), notifications: (await this.runtime.store.messages(scope, sessionId)).filter(row => row.message.role === "notification") };
  }
}
