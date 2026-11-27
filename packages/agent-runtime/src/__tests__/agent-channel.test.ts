import { agentTasksSnapshotSchema } from "@ontomato/contracts/agent-tasks";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { MID_ROUND_RESULT_NOTIFICATION_FACT } from "@ontomato/contracts/agent-visibility";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChannel } from "../channel";
import { ChannelStore } from "../channel-store";
import { AgentRuntime } from "../runtime";
import { openSkillCallback } from "../skill-callback";
import { SessionEngines } from "../session-engines";
import { createRuntimeHttp } from "../http";
import { ArtifactFiles } from "../files";
import { canonical, RuntimeStore, type MessageRow } from "../store";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeRun, RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import type { AgentInput, AgentNotification, AgentPrepareRequest, AgentRunContext, AgentRunIntent, AgentSessionRef } from "@ontomato/contracts/agent-channel";
import type { AddressInfo } from "node:net";
const sessionId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", inputId = "33333333-3333-4333-8333-333333333333";
const scope = { hostId: "test-host", domainId: "a" };
const source = { session: { providerId: "registered-custom", sessionId }, runId };
const context = { agent: { providerId: "registered-custom", agentId: "reviewer" }, actor: { id: runId, domainId: "a" }, authority: { classNames: ["Orders"], executionKind: "live" as const }, requestedBy: null, root: source };
const run = { id: runId, language: "en", sessionId, channel: context } as RuntimeRun;
const notification: AgentNotification = { role: "notification", kind: "agent-answer", replyTo: inputId, source, content: "Use the confirmed period", timestamp: 1 };
afterEach(() => { vi.unstubAllGlobals(); });
function channel() {
  let locked = false;
  const runtime = { options: { agentProviders: [{ id: "registered-custom", hostId: scope.hostId, url: "http://provider.test/channel", token: "service" }] }, store: { messages: vi.fn(async () => []), readOpenAdmission: vi.fn(async () => undefined) },
    importAgentFile: vi.fn(async () => "outputs/agents/delivered.dataset.json"),
    locked: async (_scope: unknown, _session: unknown, fn: () => Promise<unknown>) => { locked = true; try { return await fn(); } finally { locked = false; } },
    questionsChanged: vi.fn(async()=>{}),
    publishSessionRun: vi.fn(),
  } as unknown as AgentRuntime;
  const port = new AgentChannel(runtime);
  port.remember(context,{token:"initiating-token",apiKey:null});
  vi.spyOn(port.facts,"intent").mockResolvedValue({ id: runId, session: source.session, channel: context, inputId, status: "running", language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false });
  vi.spyOn(port.facts,"questions").mockResolvedValue([]);
  vi.spyOn(port.facts,"question").mockResolvedValue({...notification, kind: "agent-question", content: "Which period?"});
  vi.spyOn(port.facts,"pendingQuestions").mockResolvedValue([]);
  vi.spyOn(port.facts,"queuedRuns").mockResolvedValue([]);
  vi.spyOn(port.facts,"waiting").mockResolvedValue(null);
  vi.spyOn(port.facts,"claimNext").mockResolvedValue(undefined);
  return { runtime, channel: port, locked: () => locked };
}

const humanChannel = { ...context, userRecipient: { session: source.session, actor: context.actor } };
const browserBinding = { viewId: "55555555-5555-4555-8555-555555555555" };
const initiatingCredential = { token: "initiating-token", apiKey: null };
const userInput = { role: "user", content: "Show a page", timestamp: 1 } as const;
const receipt = (message: AgentInput): MessageRow => ({ id: inputId, runId: null, messageSeq: 8, contextSeq: null, message });

function presentationAdmission(activeRunId: string | null = null) {
  const { runtime, channel: port } = channel();
  const receipts = new Map<string, MessageRow & { sessionId: string; intentId: string | null }>();
  const intents = new Map<string, AgentRunIntent>();
  const prepares: AgentPrepareRequest[] = [];
  runtime.options.hosts = [{ id: scope.hostId, token: "fixture-host-token", providers: [context.agent.providerId] }];
  Object.assign(runtime, { channel: port });
  runtime.store.session = vi.fn().mockResolvedValue({ activeRunId });
  runtime.acceptsInput = vi.fn().mockReturnValue(false);
  const starts = vi.fn<Parameters<AgentRuntime["start"]>, ReturnType<AgentRuntime["start"]>>();
  runtime.start = starts;
  vi.spyOn(port.facts, "receipt").mockImplementation(async (_scope, id) => receipts.get(id) ?? null);
  vi.spyOn(port.facts, "binding").mockResolvedValue({ agent: context.agent, actor: context.actor, parent: null });
  let seq = 0;
  vi.spyOn(port.facts, "receive").mockImplementation(async (_scope, sessionId, message, options) => {
    const id = options?.id ?? inputId;
    const receipt = { id, sessionId, intentId: options?.intentId ?? null, runId: null, messageSeq: ++seq, contextSeq: null, message };
    receipts.set(id, receipt);
    return receipt;
  });
  vi.spyOn(port.facts, "pending").mockImplementation(async (_scope, _sessionId, _mode, runId) =>
    [...receipts.values()]
      .filter(row => row.runId === null && (!runId || !row.intentId || row.intentId === runId))
      .sort((a, b) => a.messageSeq - b.messageSeq));
  vi.spyOn(port.facts, "reserve").mockImplementation(async (_scope, sessionId, id, inputId, channel, options) => {
    const intent: AgentRunIntent = {
      id, session: { providerId: channel.agent.providerId, sessionId }, channel, inputId,
      language: options.language, context: options.context, status: "starting", createdAt: new Date(0).toISOString(),
      error: null, cancelled: false, executionUserId: options.executionUserId,
    };
    intents.set(id, intent);
    receipts.get(inputId)!.intentId = id;
    return intent;
  });
  vi.mocked(port.facts.intent).mockImplementation(async (_scope, id) => intents.get(id)!);
  const nextIntent = () => [...intents.values()].find(intent => intent.status === "starting");
  const tailIntent = () => [...intents.values()].filter(intent => intent.status === "starting").at(-1);
  vi.mocked(port.facts.waiting).mockImplementation(async () => tailIntent()?.id ?? null);
  vi.mocked(port.facts.claimNext).mockImplementation(async () => nextIntent());
  vi.spyOn(port.facts, "update").mockResolvedValue();
  vi.spyOn(port.facts, "closePending").mockResolvedValue();
  vi.spyOn(port.facts, "children").mockResolvedValue([]);
  vi.spyOn(port.facts, "hasRun").mockResolvedValue(false);
  const callback = { url: "http://provider.test/display", credential: "one-run-callback" };
  vi.stubGlobal("fetch", async (_url: string, init: NonNullable<Parameters<typeof globalThis.fetch>[1]>) => {
    const request = JSON.parse(String(init.body)) as AgentPrepareRequest;
    prepares.push(request);
    const prepared: RuntimeStartRunRequest = {
      language: request.language, input: request.input,
      definition: { systemPrompt: "", modelId: null, skills: [], externalMcp: [],
        sandbox: { limits: codeLimitsSchema.parse({ memoryBytes: 1_000_000_000, wallTimeMs: 60_000, cpuSeconds: 60 }) } },
      presentationCallback: callback,
    };
    return Response.json(prepared);
  });
  const submit = (input: AgentInput = userInput, channel: AgentRunContext = humanChannel) =>
    port.request(scope, sessionId, runId, channel, input, "en", { workspaceId: sessionId },
      initiatingCredential, undefined, browserBinding);
  return { runtime, port, prepares, starts, callback, intents, receipts, submit };
}

it.each([
  { bound: "account-E", provider: "account-E", starts: true },
  { bound: "account-E", provider: "account-F", starts: false },
  { bound: null, provider: "account-F", starts: false },
  { bound: null, provider: null, starts: true },
])("starts a continued run only as the account it is bound to (bound $bound, provider $provider)", async ({ bound, provider, starts: started }) => {
  const { port, prepares, starts, intents, submit } = presentationAdmission();
  let chosen: string | null = "account-F";
  const answer = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    if (!url.endsWith("/prepare")) return Response.json({ accepted: true });
    const prepared = await (await answer(url, init)).json();
    return Response.json({ ...prepared, executionActor: chosen === null ? null : { userId: chosen, domainId: scope.domainId } });
  });
  // A person's message opens the run: nothing is bound, so the provider chooses and the run starts as its choice.
  await submit();
  expect(prepares[0]).not.toHaveProperty("executionActor");
  expect(starts.mock.calls[0]?.[5]).toMatchObject({ executionActor: { userId: "account-F" } });
  // A continued run carries the account it is bound to; the provider is told it and must keep it.
  chosen = provider;
  intents.set(runId, { ...intents.get(runId)!, executionUserId: bound, status: "starting", error: null });
  const prepared = port.prepare(intents.get(runId)!);
  if (started) await prepared;
  else await expect(prepared).rejects.toMatchObject({ status: 403, code: "EXECUTION_ACCOUNT_CHANGED" });
  expect(prepares.at(-1)!.executionActor).toEqual(bound === null ? null : { userId: bound, domainId: scope.domainId });
  expect(starts).toHaveBeenCalledTimes(started ? 2 : 1);
  if (started) expect((starts.mock.calls[1]?.[5] as RuntimeStartRunRequest).executionActor ?? null).toEqual(bound === null ? null : { userId: bound, domainId: scope.domainId });
});

it("passes the direct root binding to prepare once and keeps it out of intent context and later preparation", async () => {
  const { port, prepares, starts, callback, intents, submit } = presentationAdmission();
  await submit();
  expect(prepares[0]).toMatchObject({ presentationBinding: browserBinding, context: { workspaceId: sessionId } });
  expect(intents.get(runId)).not.toHaveProperty("presentationBinding");
  expect(intents.get(runId)?.context).toEqual({ workspaceId: sessionId });
  expect(starts.mock.calls[0]?.[5]).toMatchObject({ presentationCallback: callback });
  expect(await submit()).toMatchObject({ replayed: true });
  expect(prepares).toHaveLength(1);
  await port.prepare(intents.get(runId)!);
  expect(prepares.at(-1)).not.toHaveProperty("presentationBinding");
  expect((starts.mock.calls.at(-1)?.[5] as RuntimeStartRunRequest).presentationCallback).toBeUndefined();
});

it.each(["delegated", "notification"] as const)("omits a supplied binding on %s prepare", async (kind) => {
  const { prepares, starts, intents, submit } = presentationAdmission();
  const parent = { session: source.session, runId: inputId };
  intents.set(inputId, { id: inputId, session: source.session, channel: context, language: "en", inputId,
    status: "running", createdAt: new Date(0).toISOString(), error: null, cancelled: false });
  if (kind === "delegated") await submit(userInput, { ...humanChannel, requestedBy: parent });
  else await submit({ role: "notification", kind: "agent-message", source: { kind: "external" }, content: "Continue work", timestamp: 2 });
  expect(prepares).toHaveLength(1);
  expect(prepares[0]).not.toHaveProperty("presentationBinding");
  expect((starts.mock.calls[0]?.[5] as RuntimeStartRunRequest).presentationCallback).toBeUndefined();
});

it.each(["cancel", "stop"] as const)("drops a queued binding on %s before later preparation", async (action) => {
  const queued = presentationAdmission(inputId);
  expect(await queued.submit()).toMatchObject({ delivery: { status: "starting" } });
  expect(queued.prepares).toHaveLength(0);
  const pending = queued.intents.get(runId)!;
  if (action === "cancel") await queued.port.cancel(scope, pending);
  else await queued.port.stopModel(scope, runId);
  await queued.port.prepare(pending);
  expect(queued.prepares).toHaveLength(1);
  expect(queued.prepares[0]).not.toHaveProperty("presentationBinding");
});

it.each([200, 404])("cancels only admitted executions when the child host returns %i", async hostStatus => {
  const { runtime, channel: port } = channel();
  const parent = await port.facts.intent(scope, runId);
  const child = (id: string, status: AgentRunIntent["status"]): AgentRunIntent => ({
    ...parent, id, session: { ...parent.session, sessionId: id }, status,
    channel: { ...parent.channel, requestedBy: source },
  });
  const preparing = child(sessionId, "starting");
  const rejected = child(inputId, "failed");
  const running = child("44444444-4444-4444-8444-444444444444", "running");
  const failedAfterAdmission = child("55555555-5555-4555-8555-555555555555", "failed");
  const children = [preparing, rejected, running, failedAfterAdmission];
  const intents = new Map([parent, ...children].map(intent => [intent.id, intent]));
  const admitted = new Set([parent.id, running.id, failedAfterAdmission.id]);
  vi.mocked(port.facts.intent).mockImplementation(async (_scope, id) => intents.get(id)!);
  vi.spyOn(port.facts, "children").mockImplementation(async (_domain, execution) =>
    execution.runId === parent.id ? children.map(intent => ({ scope, intent })) : []);
  vi.spyOn(port.facts, "hasRun").mockImplementation(async (_scope, id) => admitted.has(id));
  vi.spyOn(port.facts, "closePending").mockResolvedValue();
  vi.spyOn(port.facts, "update").mockResolvedValue();
  runtime.cancel = vi.fn();

  const hostCancellations: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(new URL(url).pathname).toBe("/channel/cancel");
    const { execution } = JSON.parse(String(init.body));
    hostCancellations.push(execution.runId);
    if (execution.runId === running.id && hostStatus === 404) {
      return Response.json({ error: { code: "NOT_FOUND", message: "Hosted execution is missing" } }, { status: hostStatus });
    }
    return Response.json({ accepted: true });
  });

  const result = port.cancel(scope, parent);
  if (hostStatus === 200) await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toMatchObject({
    name: "AggregateError",
    errors: [expect.objectContaining({ status: 404, code: "NOT_FOUND", message: "Hosted execution is missing" })],
  });

  expect(new Set(hostCancellations)).toEqual(admitted);
  expect(runtime.cancel).toHaveBeenCalledWith(scope, running.id, true);
  expect(runtime.cancel).toHaveBeenCalledWith(scope, parent.id, true);
  expect(preparing).toMatchObject({ status: "cancelled", cancelled: true });
  expect(rejected.cancelled).toBe(true);
});

it("cannot prepare a bound run again after its delivery has settled", async () => {
  const settled = presentationAdmission();
  await settled.submit();
  const finished = settled.intents.get(runId)!;
  finished.status = "completed";
  vi.spyOn(settled.port, "callback").mockResolvedValue({
    status: "completed", settled: true, summary: "", process: { mode: "none" }, results: [], files: [],
  });
  await settled.port.stopped(scope, { ...run, channel: humanChannel });
  await expect(settled.port.prepare(finished)).rejects.toMatchObject({ code: "CALLER_CREDENTIAL_INVALID" });
  expect(settled.prepares).toHaveLength(1);
});

it("drops a submitted presentation binding at the credentialFrom HTTP entry", async () => {
  const { runtime, channel: port } = channel();
  runtime.options.hosts = [{ id: scope.hostId, token: "fixture-host-token", providers: [context.agent.providerId] }];
  Object.assign(runtime, { channel: port });
  const original = await port.facts.intent(scope, runId);
  vi.spyOn(port.facts, "task").mockResolvedValue({ scope, intent: { ...original, channel: humanChannel } });
  const request = vi.spyOn(port, "request").mockResolvedValue({} as Awaited<ReturnType<AgentChannel["request"]>>);
  const server = createRuntimeHttp(runtime).listen(0, "127.0.0.1");
  await new Promise<void>(done => server.once("listening", done));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/channel/sessions/${sessionId}/runs`;
    const response = await fetch(url, {
      method: "POST", headers: { authorization: "Bearer fixture-host-token", "Content-Type": "application/json",
        "x-domain-id": scope.domainId, "x-correlation-id": "fixture", "idempotency-key": inputId },
      body: JSON.stringify({ channel: humanChannel, input: userInput, language: "en",
        credentialFrom: runId, presentationBinding: browserBinding }),
    });
    expect(response.status).toBe(202);
    expect(request.mock.calls[0]?.at(-1)).toBeUndefined();
  } finally {
    await new Promise<void>(done => server.close(() => done()));
  }
});

it("accepts a delegated process cursor from the URL and rejects invalid cursor queries", async () => {
  const streamId = "55555555-5555-4555-8555-555555555555";
  const taskId = inputId;
  const targetScope = { ...scope, hostId: "child-host" };
  const process = vi.fn().mockResolvedValue({ scope: targetScope, runId });
  const subscribe = vi.fn(async () => () => {});
  const runtime = {
    options: { hosts: [{ id: scope.hostId, token: "fixture-host-token" }] },
    channel: { process },
    subscribe,
  } as unknown as AgentRuntime;
  const server = createRuntimeHttp(runtime).listen(0, "127.0.0.1");
  await new Promise<void>(done => server.once("listening", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/channel/sessions/${sessionId}/tasks/${taskId}/process/events`;
  const request = (query: string) => fetch(`${url}?${query}`, {
    headers: { authorization: "Bearer fixture-host-token", "x-domain-id": scope.domainId, "x-correlation-id": "fixture" },
  });
  try {
    const valid = await request(`afterSeq=3&streamId=${streamId}`);
    expect(valid.status).toBe(200);
    expect(valid.headers.get("content-type")).toContain("text/event-stream");
    expect(process).toHaveBeenCalledWith(scope, sessionId, taskId);
    expect(subscribe).toHaveBeenCalledWith(targetScope, runId, 3, streamId, expect.any(Function));
    await valid.body!.cancel();

    subscribe.mockClear();
    for (const query of [
      `afterSeq=-1&streamId=${streamId}`, `afterSeq=3.5&streamId=${streamId}`,
      `afterSeq=&streamId=${streamId}`, `afterSeq=3&afterSeq=4&streamId=${streamId}`,
      "afterSeq=3&streamId=invalid",
    ]) {
      const invalid = await request(query);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    }
    expect(subscribe).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

it("a registered provider sees typed inputs outside the lock; PI keeps their receipt identity", async () => {
  const { channel: port, locked } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, intentId: null, messageSeq: 8, contextSeq: null, message: notification }]);
  const fetch = vi.fn(async (_url: unknown, init: { body?: string }) => {
    expect(locked()).toBe(false);
    expect(JSON.parse(init.body as string)).toMatchObject({ mode: "steer", input: notification, agent: context.agent, actor: context.actor });
    expect(init).toMatchObject({headers:expect.objectContaining({tk:"initiating-token"})});
    return Response.json({ accepted: true });
  });
  vi.stubGlobal("fetch", fetch);
  expect(await port.prepareSteer(scope, run, receipt(notification))).toMatchObject({ id: inputId });
  expect(fetch.mock.calls[0][0]).toBe("http://provider.test/channel/prepare");
});
it("does not turn a provider refusal into model input or an empty success", async () => {
  const { channel: port } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, intentId: null, messageSeq: 8, contextSeq: null, message: notification }]);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "CALLER_EXPIRED", message: "Caller expired" } }, { status: 403 })));
  await expect(port.prepareSteer(scope, run, receipt(notification))).rejects.toMatchObject({ code: "CALLER_EXPIRED" });
});
it("rejects an unrelated recipient before receiving an input or calling a provider", async () => {
  const { channel: port } = channel();
  vi.spyOn(port.facts, "binding").mockResolvedValue({ agent: context.agent, actor: context.actor, parent: null });
  const receive = vi.spyOn(port.facts, "receive");
  await expect(port.execute(scope, run, { op: "send", session: source.session, message: "Do work" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(receive).not.toHaveBeenCalled();
});
it("a later parent run can read work its conversation delegated in an earlier run", async () => {
  const { channel: port } = channel();
  const child = { id: inputId, session: { providerId: source.session.providerId, sessionId: inputId }, channel: { ...context, root: { ...source,runId: "44444444-4444-4444-8444-444444444444" }, requestedBy: { ...source, runId: "44444444-4444-4444-8444-444444444444" } }, inputId, status: "completed" as const, language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false };
  vi.spyOn(port.facts, "task").mockResolvedValue({ scope,intent: child });
  vi.spyOn(port, "callback").mockResolvedValue({ status: "completed", summary: "Saved", process: { mode: "none" }, results: [],files:[],settled:true });
  await expect(port.execute(scope,run,{ op: "read",taskId: inputId })).resolves.toMatchObject({ taskId: inputId,status: "completed" });
});

it("wakes the idle delegating execution on its original chain after a later run has finished", async () => {
  const { runtime, channel: port } = channel();
  const origin = await port.facts.intent(scope, runId);
  const laterRunId = "44444444-4444-4444-8444-444444444444";
  const later = {
    ...origin, id: laterRunId, status: "completed" as const, language: "en",
    channel: { ...context, actor: { ...context.actor, id: laterRunId }, root: { ...source, runId: laterRunId } },
  };
  const delegatingRun = {
    ...origin, status: "completed" as const, language: "zh-CN",
    executionUserId: "recipient-executor", context: { workspaceId: sessionId },
  };
  const child = {
    ...origin, id: inputId, session: { ...source.session, sessionId: inputId }, status: "completed" as const,
    channel: { ...context, requestedBy: source }, executionUserId: "child-executor",
  };
  runtime.store.session = vi.fn().mockResolvedValue({ activeRunId: null, latestRunId: laterRunId });
  vi.mocked(port.facts.intent).mockImplementation(async (_scope, id) => id === child.id ? child : delegatingRun);
  vi.spyOn(port.facts, "latest").mockResolvedValue(later);
  vi.spyOn(port.facts, "binding").mockResolvedValue({ agent: context.agent, actor: context.actor, parent: null });
  vi.spyOn(port.facts, "delivered").mockResolvedValue(undefined);
  vi.spyOn(port.facts, "receive").mockImplementation(async (_scope, _session, message) =>
    ({ id: inputId, runId: null, messageSeq: 3, contextSeq: null, message }));
  vi.spyOn(port.facts, "reserve").mockImplementation(async (_scope, _session, id, inputId, channel, options) =>
    ({ ...origin, id, inputId, channel, status: "starting", ...options }));
  vi.spyOn(port, "callback").mockResolvedValue({
    status: "completed", summary: "Saved", process: { mode: "none" }, results: [], files: [], settled: true,
  });
  const prepare = vi.spyOn(port, "prepare").mockResolvedValue();

  await port.changed(scope, child.id, "delivery");

  expect(prepare).toHaveBeenCalledTimes(1);
  const [wake] = prepare.mock.calls[0];
  expect(wake.id).not.toBe(delegatingRun.id);
  expect(wake).toMatchObject({
    channel: delegatingRun.channel, language: delegatingRun.language,
    executionUserId: delegatingRun.executionUserId, context: delegatingRun.context,
  });
  expect(port.credential(wake.channel)).toEqual({ token: "initiating-token", apiKey: null });
});

it("message reads expose conversation progress without transferring the child's system prompt", async () => {
  const { runtime,channel: port } = channel();
  const child = { id: inputId, session: { providerId: source.session.providerId,sessionId: inputId },channel: { ...context,requestedBy: source },inputId,language: "en",status: "completed" as const,createdAt: new Date(0).toISOString(),error: null,cancelled: false };
  vi.spyOn(port.facts,"task").mockResolvedValue({ scope,intent: child });
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],files:[{id:inputId,name:"delivered.dataset.json",mediaType:"application/json",href:"/file"}],settled:true });
  vi.spyOn(port,"file").mockResolvedValue(new Response("original dataset"));
  vi.spyOn(runtime.store,"messages").mockResolvedValue([
    { id: runId,runId: inputId,messageSeq: 1, contextSeq: null,message: { role: "system",content: "Private host instructions",timestamp: 1 } },
    { id: inputId,runId: inputId,messageSeq: 2, contextSeq: null,message: notification },
  ]);
  const result = await port.execute(scope,run,{ op: "read",taskId: inputId,view: "messages",files:true }) as { messages: Array<{ id: string }>;downloaded:unknown[] };
  expect(result.messages.map(message => message.id)).toEqual([inputId]);
  expect(result.downloaded).toEqual([{id:inputId,path:"outputs/agents/delivered.dataset.json",taskId:inputId}]);
});

it("does not prepare a child intent cancelled concurrently with its admission", async () => {
  const { channel: port } = channel();
  const pending = vi.spyOn(port.facts,"pending").mockResolvedValue([]);
  vi.spyOn(port.facts,"reserve").mockImplementation(async (_scope,sessionId,id,inputId,channel,options) => ({ id,session: { providerId: channel.agent.providerId,sessionId },channel,language: options.language,inputId,status: "cancelled",createdAt: new Date(0).toISOString(),error: null,cancelled: true }));
  await expect(port.execute(scope,run,{ op: "start",agent: context.agent,message: "Inspect knowledge" })).resolves.toMatchObject({ status: "cancelled" });
  expect(pending).not.toHaveBeenCalled();
});


it("authorizes a deep task by reading only the requested intent and its ancestors", async () => {
  const { channel: port } = channel();
  const middleId = "44444444-4444-4444-8444-444444444444";
  const middle = { id: middleId,session: { providerId: source.session.providerId,sessionId: middleId },channel: { ...context,requestedBy: source },inputId: middleId,language: "en",status: "completed" as const,createdAt: new Date(0).toISOString(),error: null,cancelled: false };
  const child = { ...middle,id: inputId,session: { ...middle.session,sessionId: inputId },channel: { ...context,requestedBy: { session: middle.session,runId: middleId } } };
  const task = vi.spyOn(port.facts,"task").mockResolvedValue({ scope,intent: child });
  vi.mocked(port.facts.intent).mockResolvedValue(middle);
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],files:[],settled:true });
  await expect(port.execute(scope,run,{ op: "read",taskId: inputId })).resolves.toMatchObject({ taskId: inputId });
  expect(task).toHaveBeenCalledWith(scope.domainId,inputId);
  expect(port.facts.intent).toHaveBeenCalledTimes(1);
  expect(port.facts.intent).toHaveBeenCalledWith(scope,middleId);
});

it.each(["read","cancel"])("rejects %s outside the caller's delegation chain before provider access", async op => {
  const { channel: port } = channel();
  const unrelated = { id: inputId,session: { ...source.session,sessionId: inputId },channel: context,inputId,language: "en",status: "completed" as const,createdAt: new Date(0).toISOString(),error: null,cancelled: false };
  vi.spyOn(port.facts,"task").mockResolvedValue({ scope,intent: unrelated });
  const callback = vi.spyOn(port,"callback");
  await expect(port.execute(scope,run,{ op,taskId: inputId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(callback).not.toHaveBeenCalled();
});

it("merges each registered provider's own list directly and then applies the query", async () => {
  const { runtime,channel: port } = channel();
  runtime.options.agentProviders!.push({ id: "another-provider",hostId: "another-host",url: "http://another.test/channel",token: "another-service" });
  const fetch = vi.fn(async (_url: unknown,init: { body?: string }) => {
    const body = JSON.parse(init.body!);
    expect(body.actor).toEqual(context.actor);
    return Response.json({ agents: [{ ref: { providerId: body.providerId,agentId: "agent" },name: body.providerId === "registered-custom" ? "Reviewer" : "Writer",description: "" }] });
  });
  vi.stubGlobal("fetch",fetch);
  await expect(port.execute(scope,run,{ op: "list",query: "review" })).resolves.toEqual({ agents: [{ ref: { providerId: "registered-custom",agentId: "agent" },name: "Reviewer",description: "" }] });
  expect(fetch.mock.calls.map(call => call[0])).toEqual(["http://provider.test/channel/list","http://another.test/channel/list"]);
});

it("projects only the conversation subtree returned by the store, retaining its root reply", async () => {
  const { runtime,channel: port } = channel();
  const middleId = "44444444-4444-4444-8444-444444444444";
  const middle = { id: middleId,session: { providerId: source.session.providerId,sessionId: middleId },channel: { ...context,requestedBy: source },inputId: middleId,language: "en",status: "completed" as const,createdAt: new Date(0).toISOString(),error: null,cancelled: false };
  const child = { ...middle,id: inputId,inputId,session: { ...middle.session,sessionId: inputId },channel: { ...context,requestedBy: { session: middle.session,runId: middleId } } };
  runtime.store.session = vi.fn(async () => ({ id: sessionId,domainId: scope.domainId,activeRunId: null,latestRunId: runId,createdAt: new Date(0).toISOString(),updatedAt: new Date(0).toISOString() }));
  const descendants = vi.spyOn(port.facts,"descendants").mockResolvedValue([{ scope,intent: middle,rootRunId: runId },{ scope,intent: child,rootRunId: runId }]);
  vi.spyOn(port.facts,"preparationFailures").mockResolvedValue([]);
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],files:[],settled:true });
  vi.spyOn(runtime.store,"messages").mockImplementation(async (_scope,id) => id === sessionId ? [] : [{ id,runId: id,messageSeq: 1, contextSeq: null,message: notification }]);
  const result = await port.tasks(scope,sessionId);
  expect(descendants).toHaveBeenCalledWith(scope.domainId,[source.session]);
  expect(result.tasks.map(task => ({ id: task.id,root: task.root,parentTaskId: task.parentTaskId }))).toEqual([
    { id: middleId,root: { sessionId,runId },parentTaskId: null },
    { id: inputId,root: { sessionId,runId },parentTaskId: middleId },
  ]);
});

it("ordinary busy send refuses before receipt, while replyTo selects steering automatically",async()=>{
  const {runtime,channel:port}=channel();
  runtime.store.session=vi.fn().mockResolvedValue({activeRunId:runId});
  const target={...source.session,sessionId:inputId};
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:source});
  const receive=vi.spyOn(port.facts,"receive");
  await expect(port.deliver(target,context.actor,{...notification,kind:"agent-message",replyTo:undefined},{senderAuthority:context.authority})).rejects.toMatchObject({code:"SESSION_BUSY"});
  expect(receive).not.toHaveBeenCalled();
  vi.spyOn(port.facts,"question").mockResolvedValue({...notification,kind:"agent-question",source:{session:target,runId:inputId}});
  const deliver=vi.spyOn(port,"deliver").mockResolvedValue({messageId:inputId,taskId:null,sessionRef:target});
  await port.execute(scope,run,{op:"send",session:target,message:"Confirmed",replyTo:inputId});
  expect(deliver).toHaveBeenCalledWith(target,context.actor,expect.objectContaining({kind:"agent-answer",replyTo:inputId}),expect.objectContaining({steer:true}));
});
it("a question without a creator is output on its own run and does not stop it",async()=>{
  const {runtime,channel:port}=channel();runtime.inputReceived=vi.fn();
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:null});
  const receive=vi.spyOn(port.facts,"receive").mockResolvedValue({id:inputId,runId,messageSeq:8, contextSeq: null,message:notification});
  await expect(port.execute(scope,run,{op:"send",session:"parent",message:"Which period?",needsInput:true,defaultAssumption:"Current year"})).resolves.toMatchObject({questionId:inputId,taskId:runId,recipient:"caller"});
  expect(receive).toHaveBeenCalledWith(scope,sessionId,expect.objectContaining({kind:"agent-question",defaultAssumption:"Current year"}),{outputRunId:runId});
});
it("fails explicitly after runtime memory is lost and never passes a missing credential to prepare",async()=>{
  const {runtime}=channel(),port=new AgentChannel(runtime);
  vi.spyOn(port.facts,"intent").mockResolvedValue({id:runId,session:source.session,channel:context,inputId,status:"running",language:"en",createdAt:new Date(0).toISOString(),error:null,cancelled:false});
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,intentId:null,messageSeq:8, contextSeq: null,message:notification}]);const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(port.prepareSteer(scope, run, receipt(notification))).rejects.toMatchObject({code:"CALLER_CREDENTIAL_INVALID",message:expect.stringContaining("please start again")});
  expect(fetch).not.toHaveBeenCalled();
});
it("retains only the root credential until delegated business attachments finish, then drops it",async()=>{
  const {runtime,channel:port}=channel();
  const child={id:inputId,session:{...source.session,sessionId:inputId},channel:{...context,requestedBy:source},inputId,language:"en",status:"running" as const,createdAt:new Date(0).toISOString(),error:null,cancelled:false};
  const reserve=vi.spyOn(port.facts,"reserve").mockResolvedValue(child);vi.spyOn(port,"prepare").mockResolvedValue();
  await port.execute(scope,run,{op:"start",agent:context.agent,message:"Inspect"});
  expect(runtime.publishSessionRun).toHaveBeenCalledWith(scope, {
    type: "delegated_changed", sessionId, runId,
  });
  expect(JSON.stringify(reserve.mock.calls)).not.toContain("initiating-token");
  vi.mocked(port.facts.intent).mockImplementation(async (_scope,id) => id===child.id ? {...child,status:"completed"} : {...child,id:runId,session:source.session,channel:context});
  const projection={status:"completed",summary:"Done",process:{mode:"none"},results:[],files:[]};
  const read=vi.spyOn(port,"callback").mockResolvedValue({...projection,settled:false});
  vi.spyOn(port,"deliver").mockResolvedValue({messageId:inputId,taskId:null,sessionRef:source.session});
  await port.changed(scope,inputId,"delivery");expect(port.credential(context).token).toBe("initiating-token");
  read.mockResolvedValue({...projection,settled:true});
  await port.changed(scope,inputId,"quality");expect(()=>port.credential(context)).toThrow("please start again");
});

it("turns an expired initiating credential into an explicit restart instruction",async()=>{
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,intentId:null,messageSeq:8, contextSeq: null,message:notification}]);
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({success:false},{status:401})));
  await expect(port.prepareSteer(scope, run, receipt(notification))).rejects.toMatchObject({code:"CALLER_CREDENTIAL_INVALID",message:expect.stringContaining("please start again")});
});

it("projects the original question, default and reply as one context message for steering and a new round",async()=>{
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,intentId:null,messageSeq:8, contextSeq: null,message:notification}]);
  vi.spyOn(port.facts,"question").mockResolvedValue({role:"notification",kind:"agent-question",source,content:"Which period?",defaultAssumption:"Current year",timestamp:0});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({accepted:true})));
  const { message: inserted, id } = await port.prepareSteer(scope, run, receipt(notification));
  const nextRound=await port.modelMessage(scope.domainId,notification);
  expect(inserted).toEqual(nextRound);expect(inserted.role).toBe("user");
  expect(inserted.content).toContain("Question:\nWhich period?\nDefault assumption:\nCurrent year\nAnswer:\nUse the confirmed period");
  expect(notification.content).toBe("Use the confirmed period");expect(id).toBe(inputId);
  expect(port.facts.question).toHaveBeenCalledWith(scope.domainId,inputId);
});

const deliveredResult = {
  role: "notification",
  kind: "agent-result",
  source: { session: { ...source.session, sessionId: inputId }, runId: inputId },
  content: "Retrieval completed",
  timestamp: 2,
} as const;
const deliveryRow: MessageRow = {
  id: inputId, runId, messageSeq: 8, contextSeq: 8, message: deliveredResult,
};
const humanRun = { ...run, channel: humanChannel };

it("adds the fact once when rebuilding a direct human round after consuming a delivery", async () => {
  const { channel: port } = channel();
  const original = await port.modelMessage(scope.domainId, deliveredResult);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ accepted: true })));
  const project = async () => (await port.prepareSteer(scope, humanRun, deliveryRow)).message;
  const first = await project();
  expect(first.content).toBe(`${original.content}\n${MID_ROUND_RESULT_NOTIFICATION_FACT}`);
  expect(await project()).toEqual(first);
  expect(deliveryRow.message.content).toBe("Retrieval completed");
});

it("leaves deliveries to a delegated round unchanged even with a human recipient", async () => {
  const { channel: port } = channel();
  const delegatedRun = { ...humanRun, channel: { ...humanChannel, requestedBy: deliveredResult.source } };
  const original = await port.modelMessage(scope.domainId, deliveredResult);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ accepted: true })));
  expect((await port.prepareSteer(scope, delegatedRun, deliveryRow)).message).toEqual(original);
});

it.each(["native","external"])("forwards %s caller language to each provider without translating its directory",async kind=>{
  const {channel:port}=channel();
  const fetch=vi.fn(async (_url:unknown,init:{body?:string})=>{
    expect(JSON.parse(init.body!).language).toBe("zh-CN");
    return Response.json({agents:[{ref:context.agent,name:"取数员",description:"提供方说明"}]});
  });vi.stubGlobal("fetch",fetch);
  const caller=kind==="native"?{...run,language:"zh-CN"}:{kind:"external" as const,actor:context.actor,authority:context.authority,language:"zh-CN",credential:{token:"initiating-token",apiKey:null}};
  await expect(port.execute(scope,caller,{op:"list"})).resolves.toMatchObject({agents:[{name:"取数员",description:"提供方说明"}]});
});

it("imports provider dataset bytes into the caller's ordinary output snapshots",async()=>{
  const workspace=await mkdtemp(path.join(os.tmpdir(),"agent-delivery-"));
  try {
    await mkdir(path.join(workspace,"outputs"));
    const receiver={active:new Map([[canonical([scope.hostId,scope.domainId,runId]),{workspace}]])} as unknown as AgentRuntime;
    const bytes=Buffer.from(JSON.stringify({schema:"workbench.dataset.v2",execution:{receiptId:inputId},rows:[[0,false,null]]}));
    const delivered=await AgentRuntime.prototype.importAgentFile.call(receiver,scope,runId,inputId,{id:inputId,name:inputId+".dataset.json"},bytes);
    const files=new ArtifactFiles(path.join(workspace,"blobs"));
    const [snapshot]=await files.scan(workspace);
    expect(snapshot.path).toBe(delivered);
    expect(delivered).toMatch(/^outputs\/agents\/.*\.dataset\.json$/);
    expect(await files.read(snapshot)).toEqual(bytes);
    expect(await readFile(path.join(workspace,delivered))).toEqual(bytes);
  } finally { await rm(workspace,{recursive:true,force:true}); }
});

it.each(["running","preparing"])("web input joins the %s execution and reaches the shared steer preparation",async phase=>{
  const {runtime,channel:port}=channel();
  const message={role:"user" as const,content:"Use the current period",timestamp:2};
  const record={id:inputId,runId:null,intentId:null,messageSeq:9,contextSeq:null,message};
  runtime.store.session=vi.fn().mockResolvedValue({activeRunId:phase==="running"?runId:null});
  runtime.acceptsInput=vi.fn(()=>phase==="running");runtime.inputReceived=vi.fn();
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:null});
  vi.spyOn(port.facts,"receipt").mockResolvedValue(null);
  vi.mocked(port.facts.waiting).mockResolvedValue(phase==="preparing"?runId:null);
  vi.spyOn(port.facts,"receive").mockResolvedValue(record);
  const reserve=vi.spyOn(port.facts,"reserve");
  const result=await port.request(scope,sessionId,inputId,context,message,"en",undefined,{token:"initiating-token",apiKey:null});
  expect(result.delivery).toMatchObject({runId,delivery:"steer",status:phase==="running"?"running":"starting"});
  expect(reserve).not.toHaveBeenCalled();
  vi.spyOn(port.facts,"pending").mockResolvedValue([record]);
  const fetch=vi.fn(async(_url:unknown,init:{body?:string})=>{expect(JSON.parse(init.body!)).toMatchObject({mode:"steer",inputId,input:message,runId});return Response.json({accepted:true});});
  vi.stubGlobal("fetch",fetch);
  expect(await port.prepareSteer(scope, run, record)).toMatchObject({ id: inputId, message });
});

it("web input after sealing reserves one next intent without preparing against the closing run",async()=>{
  const {runtime,channel:port}=channel();
  runtime.store.session=vi.fn().mockResolvedValue({activeRunId:runId});runtime.acceptsInput=vi.fn(()=>false);
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:null});
  vi.spyOn(port.facts,"receipt").mockResolvedValue(null);
  vi.spyOn(port.facts,"receive").mockResolvedValue({id:inputId,runId:null,messageSeq:9,contextSeq:null,message:{role:"user",content:"New period",timestamp:2}});
  const next={id:inputId,session:source.session,channel:{...context,root:{...source,runId:inputId}},inputId,status:"starting" as const,language:"en",createdAt:new Date(0).toISOString(),error:null,cancelled:false};
  const reserve=vi.spyOn(port.facts,"reserve").mockResolvedValue(next),prepare=vi.spyOn(port,"prepare").mockResolvedValue();
  const result=await port.request(scope,sessionId,inputId,next.channel,{role:"user",content:"New period",timestamp:2},"en",undefined,{token:"initiating-token",apiKey:null});
  expect(result.delivery).toMatchObject({delivery:"run",runId:inputId,status:"starting"});
  expect(prepare).not.toHaveBeenCalled();
  vi.spyOn(port.facts,"update").mockResolvedValue();vi.mocked(port.facts.claimNext).mockResolvedValue(next);
  vi.mocked(port.facts.intent).mockImplementation(async(_scope,id)=>id===inputId?next:{...next,id:runId,channel:context,status:"running"});
  expect(await port.nextLocked(scope,{...run,stopReason:"stop",errorMessage:null})).toBe(next);
  expect(reserve).toHaveBeenCalledTimes(1);
});

it("keeps the run's fixed executor while its actor and credential remain the initiator", async () => {
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,intentId:null,messageSeq:8,contextSeq:null,message:notification}]);
  const prepared=vi.fn(async (_url:unknown,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
    const body=JSON.parse(String(init.body));
    expect(body.actor).toEqual(context.actor);
    expect(body.executionActor).toEqual({userId:"executor",domainId:scope.domainId});
    expect(body.input.source).toEqual(notification.source);
    expect(body).not.toHaveProperty("executionCredentials");
    expect(init.headers).toMatchObject({tk:"initiating-token"});
    return Response.json({accepted:true});
  });vi.stubGlobal("fetch",prepared);
  const fixed={...run,executionUserId:"executor"};
  await port.prepareSteer(scope, fixed, receipt(notification));
  expect(notification).not.toHaveProperty("executionActor");
});

it("keeps a selected user equal to the initiator distinct from null self mode",async()=>{
 const {channel:port}=channel();
 vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,intentId:null,messageSeq:8,contextSeq:null,message:notification}]);
 const actors:unknown[]=[];
 vi.stubGlobal("fetch",vi.fn(async (_url:unknown,init:NonNullable<Parameters<typeof fetch>[1]>)=>{actors.push(JSON.parse(String(init.body)).executionActor);return Response.json({accepted:true});}));
 await port.prepareSteer(scope, {...run,executionUserId:null}, receipt(notification));
 await port.prepareSteer(scope, {...run,executionUserId:"initiator-user"}, receipt(notification));
 expect(actors).toEqual([null,{userId:"initiator-user",domainId:"a"}]);
});

it.each(["running","completed"] as const)("delivers a %s child's service question to its declared human, never its parent agent or model input",async status=>{
 const {runtime,channel:port}=channel();
 const recipient={session:source.session,actor:context.actor};
 const child={id:inputId,session:{...source.session,sessionId:inputId},inputId,language:"en",status,cancelled:false,error:null,createdAt:new Date(0).toISOString(),channel:{...context,requestedBy:source,userRecipient:recipient}};
 vi.mocked(port.facts.intent).mockResolvedValue(child);
 vi.spyOn(port.facts,"receipt").mockResolvedValue(null);
 const receive=vi.spyOn(port.facts,"receive").mockResolvedValue({id:runId,runId,messageSeq:2,contextSeq:null,message:notification});
 const deliver=vi.spyOn(port,"deliver");
 const question={source:{session:child.session,runId:inputId},message:"Run this task?",defaultAssumption:"Do not execute",options:[{label:"No",isDefault:true},{label:"Yes"}]};
 expect(await port.userQuestion(scope,runId,question)).toEqual({questionId:runId,source:question.source,recipient});
 expect(receive).toHaveBeenCalledWith(scope,sessionId,expect.objectContaining({recipient:"user",source:question.source}),{id:runId,outputRunId:source.runId});
 expect(deliver).not.toHaveBeenCalled();expect(runtime.questionsChanged).toHaveBeenCalledWith(scope,sessionId);
 vi.mocked(port.facts.intent).mockResolvedValue({...child,channel:context});
 await expect(port.userQuestion(scope,runId,question)).rejects.toMatchObject({code:"USER_SESSION_UNAVAILABLE"});
});

it("records a real option and forwards the ordinary user answer outside the receiving lock without waking the root",async()=>{
 const {runtime,channel:port,locked}=channel();
 const question:AgentNotification={role:"notification",kind:"agent-question",recipient:"user",source:{session:{...source.session,sessionId:inputId},runId:inputId},content:"Execute?",defaultAssumption:"No",options:[{label:"No",isDefault:true},{label:"Yes"}],timestamp:1};
 vi.spyOn(port.facts,"question").mockResolvedValue(question);
 vi.spyOn(port.facts,"userQuestion").mockResolvedValue({scope,sessionId,record:{id:inputId,runId,messageSeq:2,contextSeq:null,message:question}});
 vi.spyOn(port.facts,"pendingQuestions").mockResolvedValue([{requestId:inputId,source:question.source as typeof source,message:"Execute?",defaultAssumption:"No",options:question.options}]);
 vi.spyOn(port.facts,"receipt").mockResolvedValue(null);
 const receive=vi.spyOn(port.facts,"receive").mockImplementation(async(_scope,_session,message,options)=>({id:options!.id!,runId,messageSeq:3,contextSeq:null,message}));
 const deliver=vi.spyOn(port,"deliver").mockImplementation(async(ref,_actor,message)=>{
   expect(locked()).toBe(false);expect(ref).toEqual((question.source as typeof source).session);
   expect(message).toMatchObject({source:{kind:"user"},selectedOption:1,respondent:context.actor,answerId:runId,replyTo:inputId});
   return {sessionRef:ref,messageId:inputId,taskId:null};
 });
 const prepare=vi.spyOn(port,"prepare");
 const input:AgentNotification={...notification,source:{kind:"user"},selectedOption:1};
 expect(await port.request(scope,sessionId,runId,context,input,"en",undefined,{token:"new-human-credential",apiKey:null})).toMatchObject({delivery:{delivery:"receipt",status:"completed"}});
 expect(deliver).toHaveBeenCalledTimes(1);expect(prepare).not.toHaveBeenCalled();
 expect(receive).toHaveBeenCalledWith(scope,sessionId,expect.objectContaining({respondent:context.actor}),{id:runId,outputRunId:runId});
 expect(runtime.questionsChanged).toHaveBeenCalled();
 const saved=await receive.mock.results[0].value;
 vi.mocked(port.facts.receipt).mockResolvedValue({...saved,sessionId,intentId:null});
 const laterActor={...context.actor,id:inputId};
 const replay=await port.request(scope,sessionId,runId,{...context,actor:laterActor},input,"en",undefined,{token:"new-human-credential",apiKey:null});
 expect(replay.replayed).toBe(true);expect(replay.input.message).toMatchObject({respondent:context.actor});
 await expect(port.request(scope,sessionId,runId,{...context,actor:laterActor},{...input,selectedOption:0},"en",undefined,{token:"new-human-credential",apiKey:null})).rejects.toMatchObject({code:"IDEMPOTENCY_CONFLICT"});
});

it("wakes an idle questioning session for the ordinary user answer with the human's fresh actor",async()=>{
 const {runtime,channel:port}=channel();
 runtime.store.session=vi.fn().mockResolvedValue({activeRunId:null});
 const fresh={id:inputId,domainId:"a"};
 vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:null});
 vi.spyOn(port.facts,"receive").mockResolvedValue({id:inputId,runId:null,messageSeq:3,contextSeq:null,message:{...notification,source:{kind:"user"}}});
 const previous={id:runId,session:source.session,channel:context,inputId,language:"en",status:"completed" as const,createdAt:new Date(0).toISOString(),error:null,cancelled:false};
 vi.spyOn(port.facts,"latest").mockResolvedValue(previous);
 const reserve=vi.spyOn(port.facts,"reserve").mockImplementation(async(_scope,_session,id,inputId,channel)=>({...previous,id,inputId,channel,status:"starting"}));
 const prepare=vi.spyOn(port,"prepare").mockResolvedValue();
 await port.deliver(source.session,fresh,{...notification,source:{kind:"user"},selectedOption:1,answerId:inputId},{steer:true,senderAuthority:context.authority});
 expect(reserve.mock.calls[0][4]).toMatchObject({actor:fresh,root:source});expect(prepare).toHaveBeenCalledTimes(1);
});

it.each([
 {recipient:"user"},{selectedOption:1},{respondent:context.actor},{answerId:inputId},
])("rejects host-only provenance in an agent/CLI send: %j",async fields=>{
 const {channel:port}=channel();
 const receive=vi.spyOn(port.facts,"receive");
 await expect(port.execute(scope,run,{op:"send",session:"parent",message:"Approved",replyTo:inputId,...fields})).rejects.toMatchObject({name:"ZodError"});
 expect(receive).not.toHaveBeenCalled();
});
it("parses a task-stream notification with no invented pending-question property",()=>{
 expect(agentTasksSnapshotSchema.parse({sessionId,tasks:[],qualityResults:[],pendingQuestions:[],notifications:[{
   id:inputId,runId,messageSeq:1,contextSeq:null,message:notification,
 }]}).notifications?.[0].message).toEqual(notification);
});

it("authenticates the session command, uses its active run, delegates a preview run as itself and refuses late calls", async () => {
  const { channel: port } = channel();
  const workspace = await mkdtemp(path.join(os.tmpdir(), "channel-cmd-"));
  const activeRun: RuntimeRun = { ...run, status: "running", executionUserId: "exec-user", channel: humanChannel };
  const secret = "session-channel-secret";
  const active = { scope, run: activeRun, controller: new AbortController(), sealed: false, workspace, skillCommands: new Set() };
  const session = { runId: runId as string | undefined, credential: Buffer.from(secret) };
  const runtime = Object.assign(Object.create(AgentRuntime.prototype), {
    channel: port,
    active: new Map([[canonical([scope.hostId, scope.domainId, runId]), active]]),
    sessionEngines: Object.assign(Object.create(SessionEngines.prototype), {
      live: new Map([[canonical([scope.hostId, scope.domainId, sessionId, "live"]), session]]),
    }),
  }) as AgentRuntime;
  const listener = await openSkillCallback({
    sessionChannelCommand: (...args) => runtime.sessionChannelCommand(...args),
    async withBusinessCallback() {},
  });
  const baseUrl = `http://${listener.endpoint.host}:${listener.endpoint.port}`;
  const commandUrl = (host = scope.hostId, domain = scope.domainId, id = sessionId) =>
    `${baseUrl}/v1/channel/hosts/${host}/domains/${domain}/sessions/${id}/commands`;
  const post = (url: string, headers: Record<string, string>, body: unknown = { op: "list" }) => fetch(url, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  const credential = { "X-Ontomato-Callback-Credential": secret };
  try {
    expect((await post(commandUrl(), {})).status).toBe(401);
    expect((await post(commandUrl("other-host"), credential)).status).toBe(401);
    expect((await post(commandUrl(scope.hostId, "other-domain"), credential)).status).toBe(401);
    expect((await post(commandUrl(), { "X-Ontomato-Callback-Credential": "wrong-secret" })).status).toBe(401);
    expect((await post(commandUrl(), credential, { op: "list", caller: "forged" })).status).toBe(400);

    // 6. Live run start via script channel inherits requestedBy/root/userRecipient and can be read/cancelled natively
    const childId = inputId;
    const childIntent: AgentRunIntent = {
      id: childId,
      session: { providerId: "registered-custom", sessionId: childId },
      channel: { ...humanChannel, requestedBy: source },
      language: "en",
      inputId: childId,
      status: "running",
      createdAt: new Date(0).toISOString(),
      error: null,
      cancelled: false,
    };
    const reserve = vi.spyOn(port.facts, "reserve").mockResolvedValue(childIntent);
    vi.spyOn(port, "prepare").mockResolvedValue();
    // What a caller says about its execution context is not its identity: the run's channel is.
    const started = await post(commandUrl(), {
      "X-Ontomato-Callback-Credential": secret,
      "X-Ontomato-Run-Id": runId,
      "X-Ontomato-Execution-Context": "{\"kind\":\"preview\"}",
    }, { op: "start", agent: context.agent, message: "Count active rows" });
    expect(started.status).toBe(200);
    const startedBody = await started.json();
    expect(startedBody).toEqual({
      taskId: childId,
      sessionRef: { providerId: context.agent.providerId, sessionId: expect.any(String) },
      status: "running",
    });
    expect(reserve.mock.calls[0]?.[4]).toMatchObject({
      requestedBy: source,
      root: context.root,
      actor: context.actor,
      authority: context.authority,
      userRecipient: humanChannel.userRecipient,
    });

    const cancel = vi.spyOn(port, "cancel").mockResolvedValue();
    vi.spyOn(port.facts, "task").mockResolvedValue({ scope, intent: childIntent });
    vi.mocked(port.facts.intent).mockImplementation(async (_scope, id) =>
      id === childId ? childIntent : { id: runId, session: source.session, channel: humanChannel, inputId, status: "running", language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false },
    );
    await port.execute(scope, activeRun, { op: "cancel", taskId: childId });
    expect(cancel).toHaveBeenCalledWith(scope, childIntent);

    // 7. A preview run delegates as itself: the agent it starts inherits the same preview authority
    const previewAuthority = { ...humanChannel.authority, executionKind: "preview" as const };
    active.run = { ...activeRun, channel: { ...humanChannel, authority: previewAuthority } };
    reserve.mockClear();
    const previewStart = await post(commandUrl(), {
      "X-Ontomato-Callback-Credential": secret,
      "X-Ontomato-Run-Id": runId,
    }, { op: "start", agent: context.agent, message: "Count active rows" });
    expect(previewStart.status).toBe(200);
    expect(reserve.mock.calls[0]?.[4]).toMatchObject({ requestedBy: source, authority: previewAuthority });

    active.sealed = true;
    expect((await post(commandUrl(), credential)).status).toBe(409);
    session.runId = undefined;
    expect((await post(commandUrl(), credential)).status).toBe(409);
  } finally {
    await listener.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

const nextRunId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const followUpId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function currentRun(channel: AgentRunContext, status: "starting" | "running") {
  const fixture = presentationAdmission(status === "running" ? runId : null);
  const { runtime, port, intents } = fixture;
  const activeRun = { ...run, status: "running" as const, channel };
  intents.set(runId, {
    id: runId, session: source.session, channel, inputId, status, language: "en",
    createdAt: new Date(0).toISOString(), error: null, cancelled: false,
  });
  const active = { scope, run: activeRun, sealed: false, controller: new AbortController() };
  Object.assign(runtime, {
    active: new Map(status === "running" ? [[canonical([scope.hostId, scope.domainId, runId]), active]] : []),
    acceptsInput: AgentRuntime.prototype.acceptsInput,
    inputReceived: vi.fn(),
  });
  const send = (id: string, channel: AgentRunContext, input: AgentInput) =>
    port.request(scope, sessionId, id, { ...channel, root: { session: source.session, runId: id } },
      input, "en", undefined, initiatingCredential, undefined, browserBinding);
  const finish = () => port.nextLocked(scope, { ...activeRun, status: "stopped", stopReason: "stop", errorMessage: null });
  return { ...fixture, runtime, port, send, finish, activeRun };
}

it("runs a channel command after queuing human input and keeps that input out of the background run", async () => {
  const { port, send, finish, activeRun, prepares } = currentRun(context, "running");

  expect((await send(nextRunId, humanChannel, userInput)).delivery).toMatchObject({
    runId: nextRunId, delivery: "run", status: "starting",
  });
  expect(prepares).toEqual([]);

  const directory = { agents: [{ ref: context.agent, name: "Reviewer", description: "Reviews results" }] };
  const prepare = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: Parameters<typeof fetch>[1]) =>
    url.endsWith("/list") ? Response.json(directory) : prepare(url, init));
  await expect(port.execute(scope, activeRun, { op: "list" })).resolves.toMatchObject(directory);
  expect(await port.facts.pending(scope, sessionId, undefined, activeRun.id)).toEqual([]);

  await port.prepare((await finish())!);
  expect(prepares[0]).toMatchObject({
    runId: nextRunId, input: userInput, userRecipient: humanChannel.userRecipient, presentationBinding: browserBinding,
  });
});

it("queues unattended requests and keeps subsequent human input in the running human turn", async () => {
  const { port, send, finish, activeRun, prepares } = currentRun(humanChannel, "running");
  const unattended = { ...userInput, content: "Run the external analysis" };
  expect((await send(nextRunId, context, unattended)).delivery).toMatchObject({
    runId: nextRunId, delivery: "run", status: "starting",
  });

  expect((await send(followUpId, humanChannel, userInput)).delivery).toMatchObject({
    runId, delivery: "steer", status: "running",
  });
  const prepare = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) =>
    JSON.parse(String(init.body)).mode === "steer" ? Response.json({ accepted: true }) : prepare(url, init));
  expect((await port.facts.pending(scope, sessionId, undefined, activeRun.id)).map(row => row.message)).toEqual([userInput]);

  await port.prepare((await finish())!);
  expect(prepares[0]).toMatchObject({ runId: nextRunId, input: unattended, userRecipient: null });
});

it("queues a preview's message as its own preview run instead of steering a running live turn", async () => {
  const { port, send, finish, prepares } = currentRun(humanChannel, "running");
  const preview = { ...humanChannel, authority: { ...humanChannel.authority, executionKind: "preview" as const } };
  expect((await send(nextRunId, preview, userInput)).delivery).toMatchObject({ runId: nextRunId, delivery: "run", status: "starting" });
  // A live message from the same person still steers the live turn.
  expect((await send(followUpId, humanChannel, { ...userInput, content: "And last month?" })).delivery)
    .toMatchObject({ runId, delivery: "steer", status: "running" });
  const prepare = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) =>
    JSON.parse(String(init.body)).mode === "steer" ? Response.json({ accepted: true }) : prepare(url, init));
  await port.prepare((await finish())!);
  expect(prepares[0]).toMatchObject({ runId: nextRunId, input: userInput, authority: preview.authority });
});

it("lets a preview stop only a preview's run, and a live run stop as before", async () => {
  const { channel: port } = channel();
  const cancel = vi.spyOn(port, "cancel").mockResolvedValue();
  const preview = { ...context, authority: { ...context.authority, executionKind: "preview" as const } };
  const task = (channel: AgentRunContext) => ({ scope, intent: { id: inputId, session: source.session, channel, inputId, status: "running" as const,
    language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false } });
  vi.spyOn(port.facts, "task").mockResolvedValue(task(context));
  await expect(port.execute(scope, { ...run, channel: preview }, { op: "cancel", taskId: inputId }))
    .rejects.toMatchObject({ status: 422, code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验" });
  expect(cancel).not.toHaveBeenCalled();
  await expect(port.execute(scope, run, { op: "cancel", taskId: inputId })).resolves.toMatchObject({ accepted: true });
  vi.mocked(port.facts.task).mockResolvedValue(task(preview));
  await expect(port.execute(scope, { ...run, channel: preview }, { op: "cancel", taskId: inputId })).resolves.toMatchObject({ accepted: true });
  expect(cancel).toHaveBeenCalledTimes(2);
});

describe("an input runs with its sender's identity, never its recipient's", () => {
  const previewRunId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const childId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const questionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const childSession = { providerId: "registered-custom", sessionId: childId };
  const humanSession = "abababab-abab-4bab-8bab-abababababab";
  const previewAuthority = { ...humanChannel.authority, executionKind: "preview" as const };
  const intentOf = (id: string, session: AgentSessionRef, channel: AgentRunContext, status: AgentRunIntent["status"]): AgentRunIntent =>
    ({ id, session, channel, inputId: id, status, language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false });
  function live() {
    // The conversation's live turn is running. Its child was settled as a preview by its provider, and an earlier preview
    // turn of the same conversation is waiting for an answer.
    const fixture = currentRun(humanChannel, "running");
    const { port, intents } = fixture;
    const previewChannel = { ...humanChannel, authority: previewAuthority, root: { session: source.session, runId: previewRunId } };
    intents.set(previewRunId, intentOf(previewRunId, source.session, previewChannel, "completed"));
    const childChannel = { ...humanChannel, authority: previewAuthority, requestedBy: { session: source.session, runId } };
    intents.set(childId, intentOf(childId, childSession, childChannel, "completed"));
    vi.spyOn(port.facts, "delivered").mockResolvedValue(undefined);
    vi.mocked(port.facts.binding).mockImplementation(async (_scope, id) => ({
      agent: context.agent, actor: context.actor, parent: id === childId ? { session: source.session, runId } : null,
    }));
    const childRun = { ...run, id: childId, sessionId: childId, status: "running" as const, channel: childChannel };
    return { ...fixture, childRun, previewChannel };
  }
  const queuedAs = (fixture: ReturnType<typeof live>, taskId: string | null) => {
    expect(taskId).not.toBeNull();
    expect(taskId).not.toBe(runId);
    expect(fixture.runtime.inputReceived).not.toHaveBeenCalled();
    return fixture.intents.get(taskId!)!.channel.authority.executionKind;
  };

  it("queues a preview child's result to its live creator as a preview run, with the creator's classes", async () => {
    const fixture = live();
    const delivered = await fixture.port.deliver(source.session, context.actor, {
      role: "notification", kind: "agent-result", source: { session: childSession, runId: childId },
      outcome: "completed", content: "3 rows", timestamp: 2,
    }, { resultRecipientRunId: runId, senderAuthority: previewAuthority });
    expect(queuedAs(fixture, delivered.taskId)).toBe("preview");
    expect(fixture.intents.get(delivered.taskId!)!.channel.authority.classNames).toEqual(humanChannel.authority.classNames);
  });

  it("queues a preview child's message to its live creator as a preview run, never steering the creator", async () => {
    const fixture = live();
    const sent = await fixture.port.execute(scope, fixture.childRun, { op: "send", session: "parent", message: "Which period?", steer: true });
    expect(queuedAs(fixture, (sent as { taskId: string | null }).taskId)).toBe("preview");
  });

  it("refuses a preview's answer to a live run's question before anything is written, on every route", async () => {
    const fixture = live();
    const receive = vi.mocked(fixture.port.facts.receive);
    const question = { role: "notification" as const, kind: "agent-question" as const, source: { session: source.session, runId },
      content: "Which period?", defaultAssumption: "This year", timestamp: 1 };
    const answer = { role: "notification" as const, kind: "agent-answer" as const, replyTo: questionId, source: { kind: "user" as const },
      content: "Last year", timestamp: 2 };
    const refused = { status: 422, code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验" };
    const previewHuman = { ...humanChannel, authority: previewAuthority };
    // A human, from a preview, answering the question the live run sent to them.
    vi.mocked(fixture.port.facts.question).mockResolvedValue({ ...question, recipient: "user" });
    vi.spyOn(fixture.port.facts, "userQuestion").mockResolvedValue({ scope, sessionId: humanSession,
      record: { id: questionId, runId, messageSeq: 1, contextSeq: null, message: { ...question, recipient: "user" } } });
    await expect(fixture.port.request(scope, humanSession, nextRunId, previewHuman, answer, "en", undefined, initiatingCredential))
      .rejects.toMatchObject(refused);
    // The conversation's own user, from a preview, answering the live run's question in that conversation.
    vi.mocked(fixture.port.facts.question).mockResolvedValue(question);
    vi.mocked(fixture.port.facts.pendingQuestions).mockResolvedValue([{ requestId: questionId, source: question.source,
      message: question.content, defaultAssumption: question.defaultAssumption }]);
    await expect(fixture.port.request(scope, sessionId, nextRunId, previewHuman, answer, "en", undefined, initiatingCredential))
      .rejects.toMatchObject(refused);
    // A preview run answering the question its live child asked it.
    fixture.intents.get(childId)!.channel.authority = humanChannel.authority;
    vi.mocked(fixture.port.facts.question).mockResolvedValue({ ...question, source: { session: childSession, runId: childId } });
    vi.mocked(fixture.port.facts.binding).mockImplementation(async (_scope, id) => ({
      agent: context.agent, actor: context.actor, parent: id === childId ? { session: source.session, runId: previewRunId } : null,
    }));
    const previewRun = { ...run, id: previewRunId, status: "running" as const, channel: fixture.previewChannel };
    Object.assign(fixture.runtime.store, { run: vi.fn(async () => ({ run: previewRun })) });
    await expect(fixture.port.execute(scope, previewRun, { op: "send", session: childSession, message: "Last year", replyTo: questionId }))
      .rejects.toMatchObject(refused);
    expect(receive).not.toHaveBeenCalled();
    expect(fixture.runtime.inputReceived).not.toHaveBeenCalled();
  });

  it("gives a live answer to the preview that asked, as that preview's input", async () => {
    const fixture = live();
    const delivered = await fixture.port.deliver(source.session, context.actor,
      { ...notification, source: { kind: "user" }, answerId: inputId }, { steer: true, targetRunId: previewRunId, senderAuthority: humanChannel.authority });
    expect(queuedAs(fixture, delivered.taskId)).toBe("preview");
  });

  it("still merges a live input into the running live turn", async () => {
    const { port, runtime } = live();
    const delivered = await port.deliver(source.session, context.actor,
      { ...notification, source: { kind: "user" }, answerId: inputId }, { steer: true, targetRunId: runId, senderAuthority: humanChannel.authority });
    expect(delivered.taskId).toBeNull();
    expect(runtime.inputReceived).toHaveBeenCalledWith(scope, runId, expect.anything());
  });

  it("starts a run for a child's message with the child's authority, root and account, never its creator's wider ones", async () => {
    const fixture = live();
    const creator = fixture.intents.get(runId)!;
    creator.channel = { ...creator.channel, authority: { classNames: [], executionKind: "live" } };
    creator.executionUserId = "creator-account";
    const childRoot = { session: source.session, runId: previewRunId };
    const child = { ...fixture.childRun, executionUserId: "child-account",
      channel: { ...fixture.childRun.channel, authority: { classNames: ["Orders"], executionKind: "live" as const }, root: childRoot } };
    const sent = await fixture.port.execute(scope, child, { op: "send", session: "parent", message: "Progress", steer: true });
    const queued = (sent as { taskId: string | null }).taskId;
    expect(queued).not.toBeNull();
    expect(fixture.runtime.inputReceived).not.toHaveBeenCalled();
    const started = fixture.intents.get(queued!)!;
    expect(started.channel.authority).toEqual({ classNames: ["Orders"], executionKind: "live" });
    expect(started.channel.root).toEqual(childRoot);
    expect(started.executionUserId).toBe("child-account");
  });

  it("merges a child's message into its creator's run only when that run reaches no further than the child", async () => {
    const fixture = live();
    const creator = fixture.intents.get(runId)!;
    creator.executionUserId = "child-account";
    const child = { ...fixture.childRun, executionUserId: "child-account",
      channel: { ...fixture.childRun.channel, authority: humanChannel.authority } };
    const sent = await fixture.port.execute(scope, child, { op: "send", session: "parent", message: "Progress", steer: true });
    expect((sent as { taskId: string | null }).taskId).toBeNull();
    expect(fixture.runtime.inputReceived).toHaveBeenCalledWith(scope, runId, expect.anything());
  });

  it("follows up left-over input as the run it was given to, not as the run that just stopped", async () => {
    const fixture = live();
    fixture.receipts.set(questionId, { id: questionId, sessionId, intentId: previewRunId, runId: null, messageSeq: 1, contextSeq: null,
      message: { ...userInput, content: "Also last year" } });
    const followUp = await fixture.finish();
    expect(followUp?.channel.authority.executionKind).toBe("preview");
    expect(followUp?.inputId).toBe(questionId);
  });
});

it("records the authority a provider settles with the run, so stopping and queueing read the run's real identity", async () => {
  const { port, intents, submit, runtime } = presentationAdmission();
  const previewAuthority = { ...humanChannel.authority, executionKind: "preview" as const };
  const provider = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const prepared = await (await provider(url, init)).json();
    return Response.json({ ...prepared, authority: previewAuthority });
  });
  // The stored intent, not the object being prepared, is what later readers see.
  const reserve = vi.mocked(port.facts.reserve).getMockImplementation()!;
  vi.mocked(port.facts.reserve).mockImplementation(async (...args) => {
    const intent = await reserve(...args);
    intents.set(intent.id, structuredClone(intent));
    return intent;
  });
  vi.mocked(port.facts.intent).mockImplementation(async (_scope, id) => structuredClone(intents.get(id)!));
  vi.mocked(port.facts.update).mockImplementation(async (_scope, intent) => { intents.set(intent.id, structuredClone(intent)); });
  // A live message to a conversation its provider keeps as a preview's.
  await submit();
  expect(intents.get(runId)!.channel.authority).toEqual(previewAuthority);
  expect((runtime.start as ReturnType<typeof vi.fn>).mock.calls[0]?.[5]).toMatchObject({ channel: { authority: previewAuthority } });
  // A preview may stop it: it is a preview's run.
  const cancel = vi.spyOn(port, "cancel").mockResolvedValue();
  vi.spyOn(port.facts, "task").mockResolvedValue({ scope, intent: intents.get(runId)! });
  await expect(port.execute(scope, { ...run, channel: { ...context, authority: previewAuthority } }, { op: "cancel", taskId: runId }))
    .resolves.toMatchObject({ accepted: true });
  expect(cancel).toHaveBeenCalledWith(scope, intents.get(runId));
  // A preview's message joins it while it waits, as a run of the same identity.
  vi.mocked(port.facts.waiting).mockResolvedValue(runId);
  intents.set(runId, { ...intents.get(runId)!, status: "starting" });
  const joined = await port.request(scope, sessionId, nextRunId, { ...humanChannel, authority: previewAuthority,
    root: { session: source.session, runId: nextRunId } }, userInput, "en", undefined, initiatingCredential);
  expect(joined.delivery).toMatchObject({ runId, delivery: "steer" });
});

it("keeps the original human message when the background turn is still preparing", async () => {
  const { port, send, finish, prepares } = currentRun(context, "starting");
  const message = { ...userInput, content: "Keep both lines\n  and this indentation." };
  const accepted = await send(nextRunId, humanChannel, message);
  expect(accepted.delivery).toMatchObject({ runId: nextRunId, delivery: "run", status: "starting" });
  expect(accepted.input.message).toEqual(message);
  expect(prepares).toEqual([]);

  await port.prepare((await finish())!);
  expect(prepares[0]).toMatchObject({ runId: nextRunId, input: message, userRecipient: humanChannel.userRecipient });
});

it("coalesces consecutive human messages at the queue tail across background preparation and execution in 1 -> 2 -> 3 order", async () => {
  const thirdId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const { runtime, port, send, finish, prepares, intents, receipts, starts } = currentRun(context, "starting");
  const msg1 = { ...userInput, content: "first human message", timestamp: 10 };
  const msg2 = { ...userInput, content: "second human message", timestamp: 20 };
  const msg3 = { ...userInput, content: "third human message", timestamp: 30 };

  // Two human messages arrive while the background turn is still preparing.
  const first = await send(nextRunId, humanChannel, msg1);
  const second = await send(followUpId, humanChannel, msg2);
  expect(first.delivery).toMatchObject({ runId: nextRunId, delivery: "run", status: "starting" });
  expect(second.delivery).toMatchObject({ runId: nextRunId, delivery: "steer", status: "starting" });

  // Background turn transitions from preparing to running, then a third human message arrives.
  intents.get(runId)!.status = "running";
  vi.mocked(runtime.store.session).mockResolvedValue({ activeRunId: runId } as never);
  (runtime as unknown as { active: Map<string, unknown> }).active.set(
    canonical([scope.hostId, scope.domainId, runId]),
    { scope, run: { ...run, status: "running", channel: context }, sealed: false, controller: new AbortController() },
  );
  const third = await send(thirdId, humanChannel, msg3);
  expect(third.delivery).toMatchObject({ runId: nextRunId, delivery: "steer", status: "starting" });

  // Background finishes; the single merged human round is claimed and consumes 1 -> 2 -> 3 in strict order.
  const claimed = await finish();
  expect(claimed?.id).toBe(nextRunId);
  starts.mockImplementation(async (_host, _scope, _sessionId, id) => {
    const intent = intents.get(id)!;
    intent.status = "running";
    receipts.get(intent.inputId)!.runId = id;
    return {} as never;
  });
  await port.prepare(claimed!);
  expect(prepares[0]).toMatchObject({ runId: nextRunId, input: msg1, userRecipient: humanChannel.userRecipient });

  const prepare = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) =>
    JSON.parse(String(init.body)).mode === "steer" ? Response.json({ accepted: true }) : prepare(url, init));
  const pending = await port.facts.pending(scope, sessionId, undefined, nextRunId);
  expect(pending.map(row => row.message)).toEqual([msg2, msg3]);
  // Simulate the runtime receiving the engine acknowledgments.
  for (const row of pending) receipts.get(row.id)!.runId = nextRunId;

  // No second out-of-order human round remains in the queue.
  const afterHuman = await port.nextLocked(scope, { ...run, id: nextRunId, status: "stopped", stopReason: "stop", errorMessage: null, channel: humanChannel });
  expect(afterHuman).toBeUndefined();
});

it("does not coalesce a new human message ahead of an intervening unattended queued reservation", async () => {
  const unattendedQueuedId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const secondHumanId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const { runtime, send, intents } = currentRun(context, "running");
  // Seal the running background turn so a new unattended request queues behind H1 instead of steering B.
  (runtime as unknown as { active: Map<string, { sealed: boolean }> }).active.get(
    canonical([scope.hostId, scope.domainId, runId]),
  )!.sealed = true;

  expect((await send(nextRunId, humanChannel, { ...userInput, content: "human 1" })).delivery).toMatchObject({
    runId: nextRunId, delivery: "run", status: "starting",
  });
  expect((await send(unattendedQueuedId, context, { ...userInput, content: "unattended 1" })).delivery).toMatchObject({
    runId: unattendedQueuedId, delivery: "run", status: "starting",
  });
  expect((await send(secondHumanId, humanChannel, { ...userInput, content: "human 2" })).delivery).toMatchObject({
    runId: secondHumanId, delivery: "run", status: "starting",
  });
  expect([...intents.values()].filter(i => i.status === "starting").map(i => i.id)).toEqual([
    nextRunId,
    unattendedQueuedId,
    secondHumanId,
  ]);
});

it("ChannelStore.waiting queries tail starting intent (DESC) while claimNext queries head (ASC) and skips deleted rows", async () => {
  const queries: string[] = [];
  const store = {
    table: (name: string) => `"agent_runtime".${name}`,
    pool: {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("ORDER BY m.seq DESC")) return { rows: [{ key: followUpId }] };
        if (sql.includes("SET preparing_run_id=")) return { rows: [{ preparing_run_id: nextRunId }] };
        return { rows: [{ intent: { id: nextRunId, session: source.session, channel: humanChannel, inputId, language: "en", status: "starting", createdAt: new Date(0).toISOString(), error: null, cancelled: false } }] };
      }),
    },
  } as unknown as RuntimeStore;
  const facts = new ChannelStore(store);

  await expect(facts.waiting(scope, sessionId)).resolves.toBe(followUpId);
  const claimed = await facts.claimNext(scope, sessionId);
  expect(claimed?.id).toBe(nextRunId);
  expect(queries[0]).toContain("NOT a.deleted");
  expect(queries[0]).toContain("ORDER BY m.seq DESC LIMIT 1");
  expect(queries[1]).toContain("NOT a.deleted");
  expect(queries[1]).toContain("ORDER BY m.seq ASC LIMIT 1");
});

it("exposes GET /v1/channel/intents/:runId scoped to host and domain and releases session chains on DELETE /v1/sessions/:sessionId", async () => {
  const { runtime, channel: port } = channel();
  const intent: AgentRunIntent = {
    id: nextRunId, session: source.session, channel: { ...context, root: { session: source.session, runId: nextRunId } },
    inputId, language: "en", status: "starting", createdAt: new Date(0).toISOString(), error: null, cancelled: false,
  };
  port.remember(intent.channel, initiatingCredential);
  vi.spyOn(port.facts, "intent").mockImplementation(async (reqScope, id) => {
    if (reqScope.hostId === scope.hostId && reqScope.domainId === scope.domainId && id === nextRunId) return intent;
    throw Object.assign(new Error("Not found"), { status: 404, code: "NOT_FOUND" });
  });
  runtime.deleteSession = vi.fn(async () => {});
  runtime.options.hosts = [{ id: scope.hostId, token: "fixture-host-token", providers: [context.agent.providerId] }];
  Object.assign(runtime, { channel: port });
  const server = createRuntimeHttp(runtime).listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { authorization: "Bearer fixture-host-token", "x-domain-id": scope.domainId, "x-correlation-id": "fixture" };
    const found = await fetch(`${base}/v1/channel/intents/${nextRunId}`, { headers });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ id: nextRunId, status: "starting" });

    const del = await fetch(`${base}/v1/sessions/${sessionId}`, { method: "DELETE", headers });
    expect(del.status).toBe(204);
    expect(runtime.deleteSession).toHaveBeenCalledWith(scope, sessionId, false);
    expect(() => port.credential(intent.channel)).toThrow("initiating credential is no longer available");
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("RuntimeStore.deleteSession rejects a preparing session and purges unclaimed starting intents and queued messages when idle", async () => {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  let sessionRow: Record<string, unknown> = { id: sessionId, active_run_id: null, preparing_run_id: nextRunId };
  const fakeStore = Object.create(RuntimeStore.prototype) as RuntimeStore;
  Object.assign(fakeStore, {
    table: (name: string) => `"agent_runtime".${name}`,
    transaction: async <T>(fn: (c: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>) =>
      fn({
        query: async (sql: string, params: unknown[]) => {
          executed.push({ sql, params });
          if (sql.startsWith("SELECT * FROM")) return { rows: [sessionRow] };
          return { rows: [] };
        },
      }),
  });

  await expect(fakeStore.deleteSession(scope, sessionId)).rejects.toMatchObject({ status: 409, code: "SESSION_BUSY" });
  expect(executed).toHaveLength(1);

  executed.length = 0;
  sessionRow = { id: sessionId, active_run_id: null, preparing_run_id: null };
  await fakeStore.deleteSession(scope, sessionId);
  expect(executed.some(q => q.sql.includes("UPDATE") && q.sql.includes("admissions") && q.sql.includes("deleted=true, intent=NULL"))).toBe(true);
  expect(executed.some(q => q.sql.includes("DELETE FROM") && q.sql.includes("messages"))).toBe(true);
  expect(executed.some(q => q.sql.includes("DELETE FROM") && q.sql.includes("sessions"))).toBe(true);
});
