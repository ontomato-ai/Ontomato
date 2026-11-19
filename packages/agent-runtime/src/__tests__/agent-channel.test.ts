import { agentTasksSnapshotSchema } from "@ontomato/contracts/agent-tasks";
import { codeLimitsSchema } from "@ontomato/contracts/agent-runtime-code";
import { MID_ROUND_RESULT_NOTIFICATION_FACT } from "@ontomato/contracts/agent-visibility";
import { afterEach, expect, it, vi } from "vitest";
import { AgentChannel } from "../channel";
import { AgentRuntime } from "../runtime";
import { createRuntimeHttp } from "../http";
import { ArtifactFiles } from "../files";
import { canonical, type MessageRow } from "../store";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimeRun, RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import type { AgentInput, AgentNotification, AgentPrepareRequest, AgentRunContext, AgentRunIntent } from "@ontomato/contracts/agent-channel";
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
  const runtime = { options: { agentProviders: [{ id: "registered-custom", hostId: scope.hostId, url: "http://provider.test/channel", token: "service" }] }, store: { messages: vi.fn(async () => []) },
    importAgentFile: vi.fn(async () => "outputs/agents/delivered.dataset.json"),
    locked: async (_scope: unknown, _session: unknown, fn: () => Promise<unknown>) => { locked = true; try { return await fn(); } finally { locked = false; } },
    questionsChanged: vi.fn(async()=>{}),
    seal: vi.fn(() => expect(locked).toBe(true)),
  } as unknown as AgentRuntime;
  const port = new AgentChannel(runtime);
  port.remember(context,{token:"initiating-token",apiKey:null});
  vi.spyOn(port.facts,"intent").mockResolvedValue({ id: runId, session: source.session, channel: context, inputId, status: "running", language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false });
  vi.spyOn(port.facts,"questions").mockResolvedValue([]);
  vi.spyOn(port.facts,"pendingQuestions").mockResolvedValue([]);
  vi.spyOn(port.facts,"preparing").mockResolvedValue(null);
  return { runtime, channel: port, locked: () => locked };
}

const humanChannel = { ...context, userRecipient: { session: source.session, actor: context.actor } };
const browserBinding = { viewId: "55555555-5555-4555-8555-555555555555" };
const initiatingCredential = { token: "initiating-token", apiKey: null };
const userInput = { role: "user", content: "Show a page", timestamp: 1 } as const;

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
  vi.spyOn(port.facts, "receive").mockImplementation(async (_scope, sessionId, message, options) => {
    const id = options?.id ?? inputId;
    const receipt = { id, sessionId, intentId: options?.intentId ?? null, runId: null, messageSeq: 1, contextSeq: null, message };
    receipts.set(id, receipt);
    return receipt;
  });
  vi.spyOn(port.facts, "pending").mockImplementation(async () => [...receipts.values()]);
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
        sandbox: { limits: codeLimitsSchema.parse({ memoryBytes: 1_000_000_000, wallTimeMs: 60_000, cpuSeconds: 60 }) },
        compaction: { systemPrompt: "", summarizePrompt: "", updatePrompt: "" } },
      environment: { values: {}, secrets: {} }, presentationCallback: callback,
    };
    return Response.json(prepared);
  });
  const submit = (input: AgentInput = userInput, channel: AgentRunContext = humanChannel) =>
    port.request(scope, sessionId, runId, channel, input, "en", { workspaceId: sessionId },
      initiatingCredential, undefined, browserBinding);
  return { runtime, port, prepares, starts, callback, intents, submit };
}

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

it("cannot prepare a bound run again after its delivery has settled", async () => {
  const settled = presentationAdmission();
  await settled.submit();
  const finished = settled.intents.get(runId)!;
  finished.status = "completed";
  vi.spyOn(settled.port, "callback").mockResolvedValue({
    status: "completed", settled: true, summary: "", process: { mode: "none" }, results: [], quality: [], files: [],
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

it("seals under the consumption lock when the queue is empty", async () => {
  const { runtime, channel: port } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([]);
  expect(await port.followUp(scope, run)).toEqual([]);
  expect(runtime.seal).toHaveBeenCalledWith(scope, runId);
});
it("a registered provider sees typed inputs outside the lock; PI keeps their receipt identity", async () => {
  const { channel: port, locked } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, messageSeq: 8, contextSeq: null, message: notification }]);
  const consume = vi.spyOn(port.facts, "consume").mockImplementation(async () => { expect(locked()).toBe(true); });
  const fetch = vi.fn(async (_url: unknown, init: { body?: string }) => {
    expect(locked()).toBe(false);
    expect(JSON.parse(init.body as string)).toMatchObject({ mode: "steer", input: notification, agent: context.agent, actor: context.actor });
    expect(init).toMatchObject({headers:expect.objectContaining({tk:"initiating-token"})});
    return Response.json({ accepted: true });
  });
  vi.stubGlobal("fetch", fetch);
  const [message] = await port.followUp(scope, run);
  expect(message).toBe(notification);
  expect(port.inputIds.get(message)).toBe(inputId);
  expect(consume).toHaveBeenCalledWith(scope, sessionId, runId, [inputId]);
  expect(fetch.mock.calls[0][0]).toBe("http://provider.test/channel/prepare");
});
it("does not turn a provider refusal into model input or an empty success", async () => {
  const { channel: port } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, messageSeq: 8, contextSeq: null, message: notification }]);
  vi.spyOn(port.facts, "consume").mockResolvedValue();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "CALLER_EXPIRED", message: "Caller expired" } }, { status: 403 })));
  await expect(port.followUp(scope, run)).rejects.toMatchObject({ code: "CALLER_EXPIRED" });
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
  vi.spyOn(port, "callback").mockResolvedValue({ status: "completed", summary: "Saved", process: { mode: "none" }, results: [],quality:[],files:[],settled:true });
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
    status: "completed", summary: "Saved", process: { mode: "none" }, results: [], quality: [], files: [], settled: true,
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
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],quality:[],files:[{id:inputId,name:"delivered.dataset.json",mediaType:"application/json",href:"/file"}],settled:true });
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
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],quality:[],files:[],settled:true });
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
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],quality:[],files:[],settled:true });
  vi.spyOn(runtime.store,"messages").mockImplementation(async (_scope,id) => id === sessionId ? [] : [{ id,runId: id,messageSeq: 1, contextSeq: null,message: notification }]);
  const result = await port.tasks(scope,sessionId);
  expect(descendants).toHaveBeenCalledWith(scope.domainId,[source.session]);
  expect(result.tasks.map(task => ({ id: task.id,root: task.root,parentTaskId: task.parentTaskId }))).toEqual([
    { id: middleId,root: { sessionId,runId },parentTaskId: null },
    { id: inputId,root: { sessionId,runId },parentTaskId: middleId },
  ]);
});

it("an empty steering boundary does not seal the current loop",async()=>{
  const {runtime,channel:port}=channel();vi.spyOn(port.facts,"pending").mockResolvedValue([]);
  expect(await port.steering(scope,run)).toEqual([]);expect(runtime.seal).not.toHaveBeenCalled();
});
it("ordinary busy send refuses before receipt, while replyTo selects steering automatically",async()=>{
  const {runtime,channel:port}=channel();
  runtime.store.session=vi.fn().mockResolvedValue({activeRunId:runId});
  const target={...source.session,sessionId:inputId};
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:source});
  const receive=vi.spyOn(port.facts,"receive");
  await expect(port.deliver(target,context.actor,{...notification,kind:"agent-message",replyTo:undefined})).rejects.toMatchObject({code:"SESSION_BUSY"});
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
  expect(runtime.seal).not.toHaveBeenCalled();
});
it("native commands refuse build-test authority before contacting a provider",async()=>{
  const {channel:port}=channel();const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(port.execute(scope,{...run,channel:{...context,authority:{...context.authority,executionKind:"build-test"}}},{op:"list"})).rejects.toMatchObject({status:422,code:"BUILD_TEST_UNSUPPORTED"});
  expect(fetch).not.toHaveBeenCalled();
});

it("fails explicitly after runtime memory is lost and never passes a missing credential to prepare",async()=>{
  const {runtime}=channel(),port=new AgentChannel(runtime);
  vi.spyOn(port.facts,"intent").mockResolvedValue({id:runId,session:source.session,channel:context,inputId,status:"running",language:"en",createdAt:new Date(0).toISOString(),error:null,cancelled:false});
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8, contextSeq: null,message:notification}]);
  vi.spyOn(port.facts,"consume").mockResolvedValue();const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  await expect(port.steering(scope,run)).rejects.toMatchObject({code:"CALLER_CREDENTIAL_INVALID",message:expect.stringContaining("please start again")});
  expect(fetch).not.toHaveBeenCalled();
});
it("retains only the root credential until delegated business attachments finish, then drops it",async()=>{
  const {channel:port}=channel();
  const child={id:inputId,session:{...source.session,sessionId:inputId},channel:{...context,requestedBy:source},inputId,language:"en",status:"running" as const,createdAt:new Date(0).toISOString(),error:null,cancelled:false};
  const reserve=vi.spyOn(port.facts,"reserve").mockResolvedValue(child);vi.spyOn(port,"prepare").mockResolvedValue();
  await port.execute(scope,run,{op:"start",agent:context.agent,message:"Inspect"});
  expect(JSON.stringify(reserve.mock.calls)).not.toContain("initiating-token");
  vi.mocked(port.facts.intent).mockImplementation(async (_scope,id) => id===child.id ? {...child,status:"completed"} : {...child,id:runId,session:source.session,channel:context});
  const projection={status:"completed",summary:"Done",process:{mode:"none"},results:[],quality:[],files:[]};
  const read=vi.spyOn(port,"callback").mockResolvedValue({...projection,settled:false});
  vi.spyOn(port,"deliver").mockResolvedValue({messageId:inputId,taskId:null,sessionRef:source.session});
  await port.changed(scope,inputId,"delivery");expect(port.credential(context).token).toBe("initiating-token");
  read.mockResolvedValue({...projection,settled:true});
  await port.changed(scope,inputId,"quality");expect(()=>port.credential(context)).toThrow("please start again");
});

it("turns an expired initiating credential into an explicit restart instruction",async()=>{
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8, contextSeq: null,message:notification}]);
  vi.spyOn(port.facts,"consume").mockResolvedValue();
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({success:false},{status:401})));
  await expect(port.steering(scope,run)).rejects.toMatchObject({code:"CALLER_CREDENTIAL_INVALID",message:expect.stringContaining("please start again")});
});

it("projects the original question, default and reply as one context message for steering and a new round",async()=>{
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8, contextSeq: null,message:notification}]);
  vi.spyOn(port.facts,"consume").mockResolvedValue();
  vi.spyOn(port.facts,"question").mockResolvedValue({role:"notification",kind:"agent-question",source,content:"Which period?",defaultAssumption:"Current year",timestamp:0});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({accepted:true})));
  const [steering]=await port.steering(scope,run);
  const inserted=await port.modelMessage(scope.domainId,steering as unknown as import("@ontomato/contracts/agent-runtime-messages").RuntimeMessage);
  const nextRound=await port.modelMessage(scope.domainId,notification);
  expect(inserted).toEqual(nextRound);expect(inserted.role).toBe("user");
  expect(inserted.content).toContain("Question:\nWhich period?\nDefault assumption:\nCurrent year\nAnswer:\nUse the confirmed period");
  expect(notification.content).toBe("Use the confirmed period");expect(port.inputIds.get(steering)).toBe(inputId);
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
  const project = () => port.modelMessagesForRun(scope, humanRun, runId, [deliveryRow]);
  const first = await project();
  expect(first[0].content).toBe(`${original.content}\n${MID_ROUND_RESULT_NOTIFICATION_FACT}`);
  expect(await project()).toEqual(first);
  expect(deliveryRow.message.content).toBe("Retrieval completed");
});

it("leaves a delivery unchanged when it opens a new round or belongs to an earlier round", async () => {
  const { channel: port } = channel();
  const original = await port.modelMessage(scope.domainId, deliveredResult);
  expect(await port.modelMessagesForRun(scope, humanRun, deliveryRow.id, [deliveryRow])).toEqual([original]);
  expect(await port.modelMessagesForRun(scope, humanRun, runId, [
    { ...deliveryRow, runId: inputId },
  ])).toEqual([original]);
});

it("leaves deliveries to a delegated round unchanged even with a human recipient", async () => {
  const { channel: port } = channel();
  const delegatedRun = { ...humanRun, channel: { ...humanChannel, requestedBy: deliveredResult.source } };
  const original = await port.modelMessage(scope.domainId, deliveredResult);
  expect(await port.modelMessagesForRun(scope, delegatedRun, runId, [deliveryRow])).toEqual([original]);
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
    const receiver={active:new Map([[canonical([scope.hostId,scope.domainId,runId]),{sandbox:{workspace}}]])} as unknown as AgentRuntime;
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
  const record={id:inputId,runId:null,messageSeq:9,contextSeq:null,message};
  runtime.store.session=vi.fn().mockResolvedValue({activeRunId:phase==="running"?runId:null});
  runtime.acceptsInput=vi.fn(()=>phase==="running");runtime.inputReceived=vi.fn();
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:null});
  vi.spyOn(port.facts,"receipt").mockResolvedValue(null);
  vi.mocked(port.facts.preparing).mockResolvedValue(phase==="preparing"?runId:null);
  vi.spyOn(port.facts,"receive").mockResolvedValue(record);
  const reserve=vi.spyOn(port.facts,"reserve");
  const result=await port.request(scope,sessionId,inputId,context,message,"en",undefined,{token:"initiating-token",apiKey:null});
  expect(result.delivery).toMatchObject({runId,delivery:"steer",status:phase==="running"?"running":"starting"});
  expect(reserve).not.toHaveBeenCalled();
  vi.spyOn(port.facts,"pending").mockResolvedValue([record]);vi.spyOn(port.facts,"consume").mockResolvedValue();
  const fetch=vi.fn(async(_url:unknown,init:{body?:string})=>{expect(JSON.parse(init.body!)).toMatchObject({mode:"steer",inputId,input:message,runId});return Response.json({accepted:true});});
  vi.stubGlobal("fetch",fetch);
  expect(await port.steering(scope,run)).toEqual([message]);
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
  expect(reserve.mock.calls[0][5]).toMatchObject({afterRunId:runId});expect(prepare).not.toHaveBeenCalled();
  vi.spyOn(port.facts,"update").mockResolvedValue();vi.mocked(port.facts.preparing).mockResolvedValue(inputId);
  vi.mocked(port.facts.intent).mockImplementation(async(_scope,id)=>id===inputId?next:{...next,id:runId,channel:context,status:"running"});
  expect(await port.nextLocked(scope,{...run,stopReason:"stop",errorMessage:null})).toBe(next);
  expect(reserve).toHaveBeenCalledTimes(1);
});

it.each(["steer","followup"])("keeps the run's fixed executor for %s while its actor and credential remain the initiator",async mode=>{
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8,contextSeq:null,message:notification}]);
  vi.spyOn(port.facts,"consume").mockResolvedValue();
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
  await (mode==="steer"?port.steering(scope,fixed):port.followUp(scope,fixed));
  expect(notification).not.toHaveProperty("executionActor");
});

it("keeps a selected user equal to the initiator distinct from null self mode",async()=>{
 const {channel:port}=channel();
 vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8,contextSeq:null,message:notification}]);
 vi.spyOn(port.facts,"consume").mockResolvedValue();
 const actors:unknown[]=[];
 vi.stubGlobal("fetch",vi.fn(async (_url:unknown,init:NonNullable<Parameters<typeof fetch>[1]>)=>{actors.push(JSON.parse(String(init.body)).executionActor);return Response.json({accepted:true});}));
 await port.steering(scope,{...run,executionUserId:null});
 await port.steering(scope,{...run,executionUserId:"initiator-user"});
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
 await port.deliver(source.session,fresh,{...notification,source:{kind:"user"},selectedOption:1,answerId:inputId},{steer:true});
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
