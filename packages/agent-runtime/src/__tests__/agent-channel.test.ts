import { afterEach, expect, it, vi } from "vitest";
import { AgentChannel } from "../channel";
import type { AgentRuntime } from "../runtime";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import type { AgentNotification } from "@ontomato/contracts/agent-channel";
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
    locked: async (_scope: unknown, _session: unknown, fn: () => Promise<unknown>) => { locked = true; try { return await fn(); } finally { locked = false; } },
    seal: vi.fn(() => expect(locked).toBe(true)),
  } as unknown as AgentRuntime;
  const port = new AgentChannel(runtime);
  port.remember(context,{token:"initiating-token",apiKey:null});
  vi.spyOn(port.facts,"intent").mockResolvedValue({ id: runId, session: source.session, channel: context, inputId, status: "running", language: "en", createdAt: new Date(0).toISOString(), error: null, cancelled: false });
  vi.spyOn(port.facts,"questions").mockResolvedValue([]);
  return { runtime, channel: port, locked: () => locked };
}
it("seals under the consumption lock when the queue is empty", async () => {
  const { runtime, channel: port } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([]);
  expect(await port.followUp(scope, run)).toEqual([]);
  expect(runtime.seal).toHaveBeenCalledWith(scope, runId);
});
it("a registered provider sees typed inputs outside the lock; PI keeps their receipt identity", async () => {
  const { channel: port, locked } = channel();
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, messageSeq: 8, message: notification }]);
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
  vi.spyOn(port.facts, "pending").mockResolvedValue([{ id: inputId, runId: null, messageSeq: 8, message: notification }]);
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

it("message reads expose conversation progress without transferring the child's system prompt", async () => {
  const { runtime,channel: port } = channel();
  const child = { id: inputId, session: { providerId: source.session.providerId,sessionId: inputId },channel: { ...context,requestedBy: source },inputId,language: "en",status: "completed" as const,createdAt: new Date(0).toISOString(),error: null,cancelled: false };
  vi.spyOn(port.facts,"task").mockResolvedValue({ scope,intent: child });
  vi.spyOn(port,"callback").mockResolvedValue({ status: "completed",summary: "Saved",process: { mode: "none" },results: [],quality:[],files:[],settled:true });
  vi.spyOn(runtime.store,"messages").mockResolvedValue([
    { id: runId,runId: inputId,messageSeq: 1,message: { role: "system",content: "Private host instructions",timestamp: 1 } },
    { id: inputId,runId: inputId,messageSeq: 2,message: notification },
  ]);
  const result = await port.execute(scope,run,{ op: "read",taskId: inputId,view: "messages" }) as { messages: Array<{ id: string }> };
  expect(result.messages.map(message => message.id)).toEqual([inputId]);
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
  vi.spyOn(runtime.store,"messages").mockImplementation(async (_scope,id) => id === sessionId ? [] : [{ id,runId: id,messageSeq: 1,message: notification }]);
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
  const {runtime,channel:port}=channel();runtime.notificationReceived=vi.fn();
  vi.spyOn(port.facts,"binding").mockResolvedValue({agent:context.agent,actor:context.actor,parent:null});
  const receive=vi.spyOn(port.facts,"receive").mockResolvedValue({id:inputId,runId,messageSeq:8,message:notification});
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
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8,message:notification}]);
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
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8,message:notification}]);
  vi.spyOn(port.facts,"consume").mockResolvedValue();
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({success:false},{status:401})));
  await expect(port.steering(scope,run)).rejects.toMatchObject({code:"CALLER_CREDENTIAL_INVALID",message:expect.stringContaining("please start again")});
});

it("projects the original question, default and reply as one context message for steering and a new round",async()=>{
  const {channel:port}=channel();
  vi.spyOn(port.facts,"pending").mockResolvedValue([{id:inputId,runId:null,messageSeq:8,message:notification}]);
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

it.each(["native","external"])("forwards %s caller language to each provider without translating its directory",async kind=>{
  const {channel:port}=channel();
  const fetch=vi.fn(async (_url:unknown,init:{body?:string})=>{
    expect(JSON.parse(init.body!).language).toBe("zh-CN");
    return Response.json({agents:[{ref:context.agent,name:"取数员",description:"提供方说明"}]});
  });vi.stubGlobal("fetch",fetch);
  const caller=kind==="native"?{...run,language:"zh-CN"}:{kind:"external" as const,actor:context.actor,authority:context.authority,language:"zh-CN",credential:{token:"initiating-token",apiKey:null}};
  await expect(port.execute(scope,caller,{op:"list"})).resolves.toMatchObject({agents:[{name:"取数员",description:"提供方说明"}]});
});
