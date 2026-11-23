import { z } from "zod";
import { HttpError } from "../../../utils/errors";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import * as serverOperations from "../server-operations";
import rawExamples from "../../../../../contracts/examples/platform-schedules.json";
import {platformTaskSchema,platformScheduleFormSchema} from "@ontomato/contracts/platform-schedules";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { type CreatePanelHumanOperationIntentRequest, type PanelOperationIntent } from "@ontomato/contracts/panel-agent";
import { APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE } from "@ontomato/contracts/panel-client-requests";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { panelReadOperationInputSchema, panelReadOperationResultSchema } from "@ontomato/contracts/panel-operations";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
const mocks = vi.hoisted(() => ({createDefinition:vi.fn(), projectDefinition:vi.fn(), assertPermission:vi.fn(),query:vi.fn(),backend:vi.fn(),run:vi.fn(),session:vi.fn(),request:vi.fn(),resolve:vi.fn(),panel:vi.fn(),projection:vi.fn(),pages:vi.fn(),resolveMember:vi.fn(),loadedMember:vi.fn(),restore:vi.fn(),sessionActor:vi.fn()}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../config/environment",()=>({environment:{agentRuntime:()=>({callbackUrl:"http://workbench.test"})}}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{baseUrl:"http://owner.test"}}}));
vi.mock("../../../infrastructure/agent-runtime/client",()=>({RuntimeClient:class{run=mocks.run;session=mocks.session;request=mocks.request;}}));
vi.mock("../../assistant/store",()=>({assistantStore:{turn:async()=>({})}}));
vi.mock("../../assistant/execution-setting",()=>({resolveAgentExecution:mocks.resolve}));
vi.mock("../../../identity/installed", () => ({ assertPermission: mocks.assertPermission }));
vi.mock("../../assistant/definitions", () => ({
  agentDefinitionPermissions: ["analysis-agent"],
  createAgentDefinitionSnapshot: mocks.createDefinition,
  projectAgentDefinitionSkills: mocks.projectDefinition,
}));

vi.mock("../../assistant/skills",()=>({
  readAssistantSkillView: mocks.pages,
  resolvePageSkillSource: mocks.resolveMember,
  loadedPageSkillVersion: mocks.loadedMember,
}));
vi.mock("../../../utils/backend-client",()=>({backendGet:mocks.backend,backendPost:mocks.backend,buildBackendHeaders:(token:string,_x:unknown,_l:unknown,key:string,headers:object)=>({...headers,...(token?{tk:token}:{}),...(key?{"X-API-Key":key}:{})})}));
vi.mock("../../agent-host/caller",()=>({restoreAgentCaller:mocks.restore,readAgentSessionActor:mocks.sessionActor}));
vi.mock("../current",()=>({
  readCurrentPanelRecord: mocks.panel,
  async requireDirectPanelMember(...[owner, credentials, panel, key]: Parameters<typeof import("../current").requireDirectPanelMember>) {
    const member = panel.manifest.members[key];
    if (!("projectionId" in member.target)) throw new Error("Expected a projection in this fixture");
    const { binding, ...projection } = await mocks.projection(owner, credentials, member.target.projectionId);
    const form = Object.keys(projection.inputs)[0];
    const action = binding.kind === "PlatformOperation" || binding.kind === "Action";
    const shortName = binding.kind === "Action" ? "execute" : binding.id.split(".").at(-1)!;
    const data = action ? {} : form
      ? { form: { source: { object: { input: form } }, read: "form", params: {} } }
      : { createForm: { source: { type: binding }, read: "createForm", params: {} } };
    const operations = {
      [action ? shortName : "save"]: {
        operation: action ? binding : { kind: "PlatformOperation", id: `${binding.id}.save` },
        ...(form && { target: { input: form } }),
      },
    };
    return { member, projection: { ...projection, data, operations } };
  },
}));
import {
  dispatchHumanPanelOperation, inspectPanelOperationImpact, ownPanelSettings,
  prepareHumanPanelOperation, projectPanelOperationIntent, readPanelOperation, readPanelOperationDescriptor,
} from "../operations";
import { panelOperationStore } from "../operation-store";
import { readAdmittedProjectionOperations } from "../direct-operations";
import { requireDirectPanelMember } from "../current";
configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
  packs: {
    en: { ...enLocaleMeta, messages: { ...en, "test.perform": "Perform", "test.batch": "Set status", "test.previewMetric": "Preview the metric results" } },
    fr: { ...enLocaleMeta, messages: { "test.previewMetric": "Aperçu des résultats" } },
  },
});
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner={domainId:"d",userId:"U"},credentials={token:"U-token",locale:"en"};
const session={providerId:"workbench",sessionId:uuid(1)},root={providerId:"ontology",sessionId:uuid(2)};
const skill={namespace:{kind:"domain" as const,domainId:"d"},name:"derived-panel"};
const use={id:"tasks",pageKey:"tasks",path:"/applications/A/tasks",panelId:"P",access:{kind:"domain-member"}};
let intents:Map<string,PanelOperationIntent>, automatic:boolean, current:RuntimeRun;
const action=()=>({intentId:uuid(5),applicationId:"A",useId:"tasks",operationId:"run.runNow",call:{target:{kind:"object" as const,objectType:"platform:ScheduledTask",primaryKey:uuid(9)},input:{}}});
function prepareLiveAction({ intentId, ...request }: CreatePanelHumanOperationIntentRequest & { intentId: string }) {
  return prepareHumanPanelOperation(owner, credentials, {
    ...request, agentRun: { runId: current.id, sessionId: current.sessionId, toolCallId: intentId },
  }, "Alice");
}

async function executeLiveAction(request: Parameters<typeof prepareLiveAction>[0]) {
  const { intentId } = await prepareLiveAction(request);
  return dispatchHumanPanelOperation(owner, credentials, intentId);
}
function mockRegisteredOperation(handler: serverOperations.PanelServerOperation) {
 return vi.spyOn(serverOperations, "registeredPanelOperation").mockReturnValue({
   handler, declaration: serverOperations.operationDeclaration(handler),
   targetType: handler.effect === "write" ? handler.targetType : undefined,
 });
}
beforeEach(()=>{
 vi.resetAllMocks();intents=new Map();automatic=false;
 current={id:uuid(3),sessionId:session.sessionId,status:"running",executionUserId:null,channel:{agent:{providerId:"workbench",agentId:"agent"},actor:{id:uuid(4),domainId:"d"},authority:{classNames:[],executionKind:"live"},root:{session:root,runId:uuid(10)},requestedBy:null,userRecipient:{session:root,actor:{id:uuid(4),domainId:"d"}}},resolvedSkills:[{skill,digest:"sha256:" + "a".repeat(64)}]} as unknown as RuntimeRun;
 mocks.run.mockImplementation(async()=>({run:current}));
 mocks.resolve.mockImplementation(async()=>({credentials:{apiKey:"V-key"}}));
 mocks.backend.mockImplementation(async(_name:string,url:string,options:{headers:object})=>{
   expect(options.headers).toMatchObject({tk:"U-token"});
   if (url.includes("/platform/agent-execution/options")) {
     const id=new URL(url).searchParams.get("selected");
     return {text:JSON.stringify({canSetExecutionUser:false,users:[],selected:{id,name:id==="U"?"Alice":"Victor",available:true}})};
   }
   if (new URL(url).searchParams.get("useId") !== use.id)
     throw new HttpError(404, "Unknown use", "NOT_FOUND");
   return {text:JSON.stringify({success:true,data:{applicationId:"A",use,menu:{groups:[],panelUses:[]}}})};
 });
 mocks.pages.mockResolvedValue({ resolveSource: mocks.resolveMember });
 mocks.assertPermission.mockResolvedValue(undefined);
 mocks.projectDefinition.mockImplementation(definition => definition);
 mocks.resolveMember.mockResolvedValue(skill);
 mocks.loadedMember.mockImplementation((ref, loaded: RuntimeRun["resolvedSkills"]) =>
   loaded.find(entry => JSON.stringify(entry.skill) === JSON.stringify(ref)) ?? null);
 mocks.panel.mockResolvedValue({
   id: "P", manifest: {
     state: { task: { type: { kind: "object", objectType: "platform:ScheduledTask" } } },
     members: {
       run: { target: { projectionId: "run" }, inputs: { task: { state: "task" } } },
       form: { target: { projectionId: "form" }, inputs: { task: { state: "task" } } },
     },
   },
 });
 mocks.projection.mockImplementation(async(_o:unknown,c:unknown,id:string)=>{expect(c).toBe(credentials);return {id,name:"Run now",componentId:id,binding:id==="run"?{kind:"PlatformOperation",id:"schedules.runNow"}:{kind:"PlatformObjectType",id:"platform:ScheduledTask"},inputs:{task:{kind:"object",objectType:"platform:ScheduledTask"}}};});
 mocks.restore.mockResolvedValue({owner});
 mocks.session.mockResolvedValue({messages:[]});
 mocks.request.mockResolvedValue({});
 mocks.query.mockImplementation(async(sql:string,args:unknown[])=>{
   const id=String(args[sql.startsWith("SELECT intent,owner_id")?1:2]);
   if(sql.startsWith("SELECT confirm_before"))return {rows:automatic?[{confirm_before_execute:false}]:[]};
   if(sql.startsWith("SELECT intent"))return {rows:intents.has(id)?[{intent:structuredClone(intents.get(id)),owner_id:owner.userId}]:[]};
   if(sql.startsWith("INSERT INTO panel_operation_intents")){if(!intents.has(String(args[1])))intents.set(String(args[1]),structuredClone(args[4] as PanelOperationIntent));return {rows:[]};}
   if(sql.includes("AND intent->>'dispatched'='false'")){const value=intents.get(id)!;if(value.dispatched)return {rowCount:0};intents.set(id,structuredClone(args[3] as PanelOperationIntent));return {rowCount:1};}
   if(sql.includes("jsonb_set")){intents.get(id)!.outcome=JSON.parse(String(args[3]));return {rowCount:1};}
   throw new Error(sql);
 });
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   if ((init.method ?? "GET") === "GET") {
     expect(new Headers(init.headers).get("tk")).toBe("U-token");
     expect(new Headers(init.headers).get("X-API-Key")).toBeNull();
     return Response.json({...task,title:"Inventory summary"});
   }
   expect(new Headers(init.headers).get("X-API-Key")).toBeNull();
   expect(new Headers(init.headers).get("tk")).toBe("U-token");
   return Response.json({error:{code:"PERMISSION_DENIED",message:"User cannot update this task"},correlationId:"test"},{status:403});
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const ownerWrites=()=>vi.mocked(fetch).mock.calls.filter(([,init])=>["POST","PUT"].includes(init?.method ?? "GET"));
it("does not let a content page's loaded skill authorize a frame operation", async () => {
  await expect(prepareLiveAction({ ...action(), root: "frame" })).rejects.toMatchObject({
    status: 403, code: "PANEL_FRAME_SKILL_REQUIRED",
  });
  expect(intents.size).toBe(0);
});

const task=platformTaskSchema.parse({...rawExamples.creates.find(task=>task.name==="governance-instruction")!.response,id:uuid(9),revision:9});
it("session settings compare the authenticated owner even when a session is readable",async()=>{
 mocks.sessionActor.mockResolvedValue({id:uuid(4),domainId:"d"});mocks.restore.mockResolvedValue({owner:{...owner,userId:"someone-else"}});
 await expect(ownPanelSettings(owner,root)).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await panelOperationStore.settings(owner,root)).confirmBeforeExecute).toBe(true);
});
it("declines unsupported business/test authority before an owner write",async()=>{
 current.channel!.authority.executionKind="build-test";
 await expect(prepareLiveAction(action())).rejects.toMatchObject({code:"BUILD_TEST_UNSUPPORTED"});expect(ownerWrites()).toHaveLength(0);
});

it("rejects a declaration whose target type does not match its platform operation",async()=>{
 const panel=await mocks.panel();panel.manifest.state.task.type.objectType="customer:Account";
 await expect(prepareLiveAction(action())).rejects.toMatchObject({
   status: 422, code: "PANEL_OPERATION_TARGET_MISMATCH",
   message: expect.stringContaining("connect input 'task' to an object of type 'platform:ScheduledTask'"),
 });
 expect(ownerWrites()).toHaveLength(0);
});

it("uses the initiator's display name in self mode",async()=>{
 current={...current,executionUserId:null};
 await prepareLiveAction(action());
 expect(mocks.request.mock.calls[0][2].message).toBe('Run “Run now” on “Inventory summary” as Alice?');
 expect(mocks.backend.mock.calls.some(([,url])=>url.includes("/platform/agent-execution/options"))).toBe(false);
});
it.each([403,404])("identifies an unreadable task by ID after one initiator read (%s), without trying the executor",async status=>{
 const read=vi.fn(async(_url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   expect(init.method ?? "GET").toBe("GET");
   expect(new Headers(init.headers).get("tk")).toBe("U-token");
   expect(new Headers(init.headers).get("X-API-Key")).toBeNull();
   return Response.json({error:{code:status===403?"PERMISSION_DENIED":"TASK_NOT_FOUND",message:"Unavailable"},correlationId:"test"},{status});
 });vi.stubGlobal("fetch",read);
 await prepareLiveAction(action());
 expect(read).toHaveBeenCalledTimes(1);
 expect(mocks.request.mock.calls[0][2].message).toBe(`Run “Run now” on “${uuid(9)}” as Alice?`);
});
it("rejects an unregistered server handler before any question or dispatch",async()=>{
 mocks.projection.mockResolvedValue({id:"run",name:"Other",componentId:"run",binding:{kind:"PlatformOperation",id:"not.registered"},inputs:{task:{kind:"object",objectType:"platform:ScheduledTask"}}});
 await expect(prepareLiveAction({...action(),operationId:"run.registered"})).rejects.toMatchObject({status:422,code:"OPERATION_UNAVAILABLE"});
 expect(mocks.request).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it("dispatches through the registered owner without a resource-specific coordinator branch",async()=>{
 automatic=true;
 const handler={handlerRef:"test.perform",labelKey:"test.perform",kind:"action" as const,binding:{kind:"PlatformOperation" as const,id:"test.perform"},effect:"write" as const,batch:false as const,targetInput:"task",targetType:"test:Thing",
   targetSchema:z.object({kind:z.literal("object"),objectType:z.literal("test:Thing"),primaryKey:z.string()}),inputSchema:z.object({value:z.number()}),resultSchema:z.object({done:z.boolean()}),
   targetLabel:vi.fn(),execute:vi.fn(async()=>({kind:"success" as const,data:{done:true}}))};
 mockRegisteredOperation(handler);
 const panel=await mocks.panel();panel.manifest.state.task.type.objectType="test:Thing";
 mocks.projection.mockResolvedValue({id:"run",name:"Perform",componentId:"run",binding:handler.binding,inputs:{task:{kind:"object",objectType:handler.targetType}}});
 const input={...action(),operationId:"run.perform",call:{target:{kind:"object" as const,objectType:handler.targetType,primaryKey:"opaque-key"},input:{value:7}}};
 const { intentId, autoMode } = await prepareLiveAction(input);
 expect(autoMode).toBe(true);
 expect(mocks.request).not.toHaveBeenCalled();
 expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({kind:"dispatched",outcome:{kind:"success",data:{done:true}}});
 expect(handler.execute).toHaveBeenCalledWith(expect.objectContaining({executor:{owner,credentials}}),input.call.target,input.call.input,intentId);
 expect(fetch).not.toHaveBeenCalled();
});

it("freezes the owner write description with a named target and a result schema", async () => {
  const input = action();
  const { intentId } = await prepareLiveAction(input);
  expect(intents.get(intentId)).toMatchObject({
    call: input.call,
    operation: { effect: "write", target: { source: "input", input: "task" }, resultSchema: { type: "object" }, batch: false },
  });
});

it("rejects a batch when the registered owner does not declare batch support", async () => {
  const { call, ...intent } = action();
  await expect(prepareLiveAction({ ...intent, calls: [call] }))
    .rejects.toMatchObject({ code: "OPERATION_BATCH_UNSUPPORTED" });
  expect(intents.size).toBe(0);
  expect(ownerWrites()).toHaveLength(0);
});

it.each([
  { status: 403, kind: "refusal", code: "FORBIDDEN" },
  { status: 502, kind: "failure", code: "DEPENDENCY_UNAVAILABLE" },
])("keeps an agent delete response with status $status as $kind", async ({ status, kind, code }) => {
  automatic = true;
  const objectType = "platform:AgentDefinition";
  const panel = await mocks.panel();
  panel.manifest.state.task.type.objectType = objectType;
  panel.manifest.members.run.inputs = { agent: { state: "task" } };
  mocks.projection.mockResolvedValue({
    id: "run", componentId: "run", name: "Delete agent", binding: { kind: "PlatformOperation", id: "agents.delete" },
    inputs: { agent: { kind: "object", objectType } },
  });
  const input = { ...action(), operationId: "run.delete", call: {
    target: { kind: "object" as const, objectType, primaryKey: uuid(9) }, input: {},
  } };
  // The agent's name is read before the write; the delete itself answers with the status.
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => init.method === "GET"
    ? Response.json({
      id: uuid(9), name: "Inventory analyst", description: "", icon: null, enabled: true,
      executionUserId: null, modelSelection: { modelId: null }, skills: [], systemPrompt: "",
    })
    : Response.json({ error: { code, message: "Owner response" }, correlationId: "test" }, { status })));
  expect(await executeLiveAction(input)).toMatchObject({
    kind: "dispatched", outcome: { kind, code },
  });
});

function installBatchOwner() {
  const objectType = "platform:ScheduledTask";
  const binding = { kind: "PlatformOperation" as const, id: "test.batch" };
  const handler = {
    handlerRef: binding.id, labelKey: "test.batch", kind: "action" as const, binding, effect: "write" as const, batch: true as const,
    targetType: objectType, targetInput: "task",
    targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(objectType), primaryKey: z.string() }),
    inputSchema: z.object({ status: z.number() }), resultSchema: z.object({ done: z.boolean() }),
    targetLabel: vi.fn(async (_host, target: { primaryKey: string }) => target.primaryKey),
    inspectImpact: { handlerRef: "test.batch.impact", inspect: vi.fn() },
    execute: vi.fn(),
    executeBatch: vi.fn(),
  };
  mockRegisteredOperation(handler);
  mocks.projection.mockResolvedValue({
    id: "run", name: "Set status", componentId: "run", binding, inputs: { task: { kind: "object", objectType } },
  });
  const call = (n: number, status: number) => ({
    target: { kind: "object" as const, objectType, primaryKey: uuid(n) },
    input: { status },
  });
  const calls: serverOperations.PanelBatchCalls = [call(9, 1), call(10, 2), call(11, 3), call(12, 4), call(13, 5)];
  const impact = {
    summary: "The owner will change these status records.",
    total: 12,
    objects: calls.map(({ target }, index) => ({
      target: { objectType: target.objectType, primaryKey: target.primaryKey }, label: `Task ${index + 1}`,
    })),
  };
  handler.inspectImpact.inspect.mockResolvedValue(impact);
  const request = { intentId: uuid(5), applicationId: "A", useId: "tasks", operationId: "run.batch", calls };
  return { handler, request, impact };
}

it("uses the same owner impact for the human read and agent confirmation of the frozen batch", async () => {
  const { handler, request, impact } = installBatchOwner();
  const { intentId: _intentId, ...inspect } = request;
  expect(await inspectPanelOperationImpact(owner, credentials, inspect)).toEqual(impact);
  expect(intents.size).toBe(0);
  const { intentId } = await prepareLiveAction(request);
  expect(intents.get(intentId)?.source).toMatchObject({ kind: "agent-page", autoMode: false });
  expect(handler.inspectImpact.inspect).toHaveBeenCalledTimes(2);
  for (const [host, calls] of handler.inspectImpact.inspect.mock.calls) {
    expect(host).toMatchObject({ request: expect.any(Function) });
    expect(calls).toEqual(request.calls);
  }
  const question = mocks.request.mock.calls[0]![2];
  expect(question.message).toContain("Task 1");
  expect(question.message).toContain("(12)");
  expect(question.message).toContain(impact.summary);
  expect(intents.get(intentId)).toMatchObject({
    calls: request.calls, operation: { batch: true, inspectImpact: { handlerRef: "test.batch.impact" } },
  });
  expect(handler.executeBatch).not.toHaveBeenCalled();
});

it("reads the registered owner descriptor for an admitted human panel use", async () => {
  const { request } = installBatchOwner();
  const input = { applicationId: request.applicationId, useId: request.useId, operationId: request.operationId };
  expect(await readPanelOperationDescriptor(owner, credentials, input)).toMatchObject({
    handlerRef: "test.batch", label: "Set status", effect: "write", target: { source: "input", input: "task" },
    inputSchema: { properties: { status: { type: "number" } } },
    resultSchema: { properties: { done: { type: "boolean" } } },
    batch: true, inspectImpact: { handlerRef: "test.batch.impact" },
  });
  await expect(readPanelOperationDescriptor(owner, credentials, { ...input, useId: "other" }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.pages).not.toHaveBeenCalled();
  expect(intents.size).toBe(0);
});

it("adds owner availability only to a live descriptor for the selected record", async () => {
  const registration = serverOperations.registeredPanelOperation("schedules.runNow");
  if (registration?.handler.effect !== "write") throw new Error("Expected the runtime task write handler");
  const reason = { reason: "The task is not available to run." };
  const unavailable = vi.fn(async () => reason);
  mockRegisteredOperation({ ...registration.handler, unavailable });
  const panel = await mocks.panel();
  const placement = { ...await requireDirectPanelMember(owner, credentials, panel, "run"), panel, slot: "run" };
  const actor = { owner, credentials };
  expect((await readAdmittedProjectionOperations(actor, placement, {})).runNow).not.toHaveProperty("unavailable");
  expect(unavailable).not.toHaveBeenCalled();

  const { call, intentId: _intentId, ...operation } = action();
  const target = call.target;
  const read = await readAdmittedProjectionOperations(actor, placement,
    { task: { className: target.objectType, primaryKey: target.primaryKey } });
  expect(read.runNow).toMatchObject({ unavailable: reason });
  expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({
    locale: "en", executor: actor,
  }), target);
  expect(intents.size).toBe(0);

  const prepared = await prepareHumanPanelOperation(owner, credentials, { ...operation, call });
  expect(intents.get(prepared.intentId)?.operation).not.toHaveProperty("unavailable");
  expect(unavailable).toHaveBeenCalledTimes(1);
});

it("dispatches one frozen batch once and merges affected evidence from successful items only", async () => {
  const { handler, request, impact } = installBatchOwner();
  const first = impact.objects[0]!.target, refused = impact.objects[1]!.target;
  const statuses = [
    { kind: "success", data: { done: true }, affected: { objects: [first], objectTypes: [first.objectType] } },
    { kind: "refusal", code: "REVISION_CONFLICT", message: "The task changed" },
    { kind: "failure", code: "DEPENDENCY_UNAVAILABLE", message: "Owner failure" },
    { kind: "unknown", message: "No receipt" },
    { kind: "success", data: { done: true }, affected: { objects: [first], objectTypes: [first.objectType] } },
  ];
  const items = impact.objects.map(({ target }, index) => ({ target, outcome: statuses[index] }));
  handler.executeBatch.mockResolvedValue({ kind: "batch", items, affected: { objects: [refused], objectTypes: ["ignored"] } });
  const { intentId } = await prepareLiveAction(request);
  const results = await Promise.all([
    dispatchHumanPanelOperation(owner, credentials, intentId),
    dispatchHumanPanelOperation(owner, credentials, intentId),
  ]);
  expect(results).toContainEqual(expect.objectContaining({
    kind: "dispatched", outcome: { kind: "batch", items, affected: { objects: [first], objectTypes: [first.objectType] } },
  }));
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
  expect(handler.executeBatch).toHaveBeenCalledWith(expect.objectContaining({ request: expect.any(Function) }), request.calls, intentId);
  expect(handler.execute).not.toHaveBeenCalled();
});

it("keeps an uncertain owner batch terminal", async () => {
  const { handler, request } = installBatchOwner();
  automatic = true;
  handler.executeBatch.mockRejectedValue(new Error("Connection lost after dispatch"));
  const { intentId } = await prepareLiveAction(request);
  expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({
    kind: "dispatched", outcome: { kind: "unknown", message: "Connection lost after dispatch" },
  });
  await dispatchHumanPanelOperation(owner, credentials, intentId);
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
});

it("keeps a definitive atomic batch receipt without inventing per-item receipts", async () => {
  const { handler, request, impact } = installBatchOwner();
  automatic = true;
  const objects = impact.objects.map(item => item.target);
  const outcome = { kind: "success", data: { updated: objects.length }, affected: {
    objects, objectTypes: ["platform:ScheduledTask"],
  } };
  handler.executeBatch.mockResolvedValue(outcome);
  expect(await executeLiveAction(request)).toMatchObject({ kind: "dispatched", outcome });
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
});

it("returns type-only changes from a successful single write", async () => {
  const { handler, request: { calls, ...request } } = installBatchOwner();
  automatic = true;
  const affected = { objects: [], objectTypes: ["platform:ScheduledTask"] };
  handler.execute.mockResolvedValue({ kind: "success", data: { done: true }, affected });
  expect(await executeLiveAction({ ...request, call: calls[0] })).toMatchObject({ outcome: { affected } });
});

it("says what a single write did by its target's name, read before the write, unless the owner said it", async () => {
  const { handler, request: { calls, ...request } } = installBatchOwner();
  automatic = true;
  const order: string[] = [];
  handler.targetLabel.mockImplementation(async (_host, target: { primaryKey: string }) => {
    order.push("name");
    return `Task ${target.primaryKey}`;
  });
  handler.execute.mockImplementation(async () => {
    order.push("write");
    return { kind: "success", data: { done: true } };
  });
  Object.assign(handler, { done: (_host: unknown, name: string) => `${name} deleted` });
  expect(await executeLiveAction({ ...request, call: calls[0] })).toMatchObject({
    kind: "dispatched", outcome: { kind: "success", message: `Task ${calls[0].target.primaryKey} deleted` },
  });
  // The name is read while the target is still there.
  expect(order.slice(-2)).toEqual(["name", "write"]);

  handler.execute.mockResolvedValue({ kind: "success", data: { done: true }, message: "The owner's own words" });
  expect(await executeLiveAction({ ...request, intentId: uuid(6), call: calls[1] })).toMatchObject({
    kind: "dispatched", outcome: { kind: "success", message: "The owner's own words" },
  });
});

it("fails before claiming a write whose target's name cannot be read, so the write is not left unknown", async () => {
  const { handler, request: { calls, ...request } } = installBatchOwner();
  automatic = true;
  Object.assign(handler, { done: (_host: unknown, name: string) => `${name} deleted` });
  handler.targetLabel.mockRejectedValueOnce(new Error("The task is gone"));
  const { intentId } = await prepareLiveAction({ ...request, call: calls[0] });
  await expect(dispatchHumanPanelOperation(owner, credentials, intentId)).rejects.toThrow("The task is gone");
  expect(handler.execute).not.toHaveBeenCalled();
  expect(intents.get(intentId)).toMatchObject({ dispatched: false });
});

it("gathers what a batch removed from its successful items once", async () => {
  const { handler, request, impact } = installBatchOwner();
  automatic = true;
  const [first, second] = impact.objects.map(({ target }) => target);
  const gone = (target: typeof first) => ({ kind: "success", data: { done: true }, affected: {
    objects: [target], objectTypes: [target!.objectType], removed: [target],
  } });
  const items = impact.objects.map(({ target }, index) => ({
    target, outcome: index === 0 ? gone(first) : index === 1 ? gone(second) : { kind: "refusal", code: "IN_USE", message: "In use" },
  }));
  handler.executeBatch.mockResolvedValue({ kind: "batch", items });
  expect(await executeLiveAction(request)).toMatchObject({ kind: "dispatched", outcome: {
    kind: "batch", affected: { objects: [first, second], objectTypes: [first!.objectType], removed: [first, second] },
  } });
});

it("freezes a human batch and its impact, then claims once with the reader's credentials", async () => {
  const { handler, request, impact } = installBatchOwner();
  const { intentId: _intentId, ...input } = request;
  const outcome = { kind: "batch", items: impact.objects.map(({ target }) => ({
    target, outcome: { kind: "success", data: { done: true }, affected: { objects: [target], objectTypes: [target.objectType] } },
  })) };
  handler.executeBatch.mockImplementation(async (host: serverOperations.PanelOperationHost) => {
    await host.requestWorkbench("/test-owner", { method: "POST" });
    return outcome;
  });
  const ownerWrite = vi.fn(async (_url, init) => {
    expect(new Headers(init.headers).get("tk")).toBe("U-token");
    expect(new Headers(init.headers).get("X-API-Key")).toBeNull();
    return Response.json({});
  });
  vi.stubGlobal("fetch", ownerWrite);
  const preparation = await prepareHumanPanelOperation(owner, credentials, input);
  const id = preparation.intentId;
  expect(preparation.confirmation).toEqual({
    kind: "batch", impact, targets: { total: input.calls.length, objects: input.calls.map(({ target }) => ({
      target: { primaryKey: target.primaryKey, objectType: target.objectType }, label: target.primaryKey,
    })) },
  });
  expect(intents.get(id)).toMatchObject({
    source: { kind: "human" }, initiator: owner, calls: input.calls, confirmation: preparation.confirmation, dispatched: false,
  });
  const useRef = { applicationId: input.applicationId, useId: input.useId };
  expect(await projectPanelOperationIntent(owner, id, useRef, credentials)).toEqual(preparation);
  await expect(projectPanelOperationIntent(owner, id, { ...useRef, useId: "other" }, credentials)).rejects.toMatchObject({ status: 404 });
  expect(ownerWrite).not.toHaveBeenCalled();
  const results = await Promise.all([dispatchHumanPanelOperation(owner, credentials, id), dispatchHumanPanelOperation(owner, credentials, id)]);
  expect(results).toContainEqual({ kind: "dispatched", intentId: id, outcome: {
    ...outcome, affected: { objects: impact.objects.map(item => item.target), objectTypes: [input.calls[0].target.objectType] },
  } });
  expect(handler.inspectImpact.inspect).toHaveBeenCalledTimes(1);
  expect(handler.executeBatch).toHaveBeenCalledOnce();
  expect(handler.execute).not.toHaveBeenCalled();
  expect(ownerWrite).toHaveBeenCalledOnce();
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("requires confirmation for a batch without an impact inspector", async () => {
  const { handler, request } = installBatchOwner();
  const { inspectImpact: _inspector, ...withoutInspector } = handler;
  mockRegisteredOperation(withoutInspector);
  const { intentId: _id, ...input } = request;
  const { confirmation } = await prepareHumanPanelOperation(owner, credentials, input);
  expect(confirmation).toEqual({ kind: "batch", targets: {
    total: input.calls.length, objects: input.calls.map(({ target }) => ({
      target: { primaryKey: target.primaryKey, objectType: target.objectType }, label: target.primaryKey,
    })),
  } });
  expect(handler.executeBatch).not.toHaveBeenCalled();
});

it("runs a registered read using the reader and preview context without creating an intent", async () => {
  const binding = { kind: "PlatformOperation" as const, id: "metricViews.testExecute" };
  const input = { applicationId: "A", useId: "tasks", operationId: "run.testExecute", call: {
    target: { kind: "draft" as const },
    input: { draft: { name: "Unsaved metric" }, parameters: { amount: 3 }, bindingId: "sample" },
  } };
  const preview = { ...credentials, headers: { [BUILD_TEST_HEADER]: "build-preview" } };
  const execute = vi.fn(async (host: serverOperations.PanelOperationHost, call: typeof input.call) => {
    await host.request("/api/data-query/metricView/testExecute", { method: "POST", body: JSON.stringify(call.input) });
    return { kind: "json" as const, value: [{ amount: 3 }] };
  });
  mockRegisteredOperation({
    handlerRef: binding.id, labelKey: "test.previewMetric", effect: "read", kind: "action", batch: false, binding,
    target: { source: "draft" }, targetSchema: z.object({ kind: z.literal("draft") }).strict(),
    inputSchema: panelReadOperationInputSchema, resultSchema: panelReadOperationResultSchema, execute,
  });
  mocks.projection.mockResolvedValue({ id: "run", name: "Metric trial projection", componentId: "run", binding, inputs: {} });
  await expect(readPanelOperationDescriptor(owner, credentials, input)).rejects.toMatchObject({
    code: "PANEL_OPERATION_DRAFT_UNBOUND",
    message: expect.stringContaining("Member 'run', operation 'testExecute'"),
  });
  const panel = await mocks.panel();
  panel.manifest.members.metricEditor = panel.manifest.members.form;
  panel.manifest.members.run.readOperationInputs = {
    testExecute: { draft: { slot: "metricEditor" }, parameters: { fields: {} } },
  };
  const ownerRead = vi.fn(async (url, init) => {
    expect(url).toBe("http://owner.test/metricView/testExecute");
    expect(new Headers(init.headers).get("tk")).toBe("U-token");
    expect(new Headers(init.headers).get(BUILD_TEST_HEADER)).toBe("build-preview");
    expect(JSON.parse(init.body)).toEqual(input.call.input);
    return Response.json({});
  });
  vi.stubGlobal("fetch", ownerRead);
  expect(await readPanelOperationDescriptor(owner, credentials, input)).toMatchObject({
    label: "Preview the metric results", effect: "read", batch: false, target: { source: "draft", slot: "metricEditor" },
  });
  expect(await readPanelOperationDescriptor(owner, { ...credentials, locale: "fr" }, input)).toMatchObject({
    label: "Aperçu des résultats",
  });
  expect(await readPanelOperation(owner, preview, input)).toEqual({ kind: "json", value: [{ amount: 3 }] });
  await expect(prepareHumanPanelOperation(owner, credentials, input)).rejects.toMatchObject({ code: "OPERATION_WRITE_REQUIRED" });
  expect(ownerRead).toHaveBeenCalledOnce();
  expect(intents.size).toBe(0);
});

it("resolves the actual panel-use member and refuses a run that only loaded a sibling", async () => {
  mocks.resolveMember.mockResolvedValue({ ...skill, name: "other-panel-in-the-same-group" });
  await expect(prepareLiveAction(action())).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.pages).toHaveBeenCalledWith(owner.domainId, credentials);
  expect(mocks.resolveMember).toHaveBeenCalledWith(
    expect.objectContaining({ resolveSource: mocks.resolveMember }),
    { access: "domain-member", pageKey: "tasks" },
    { kind: "application-use", applicationId: "A", useId: "tasks" }, [], { id: use.panelId },
  );
  expect(mocks.loadedMember).toHaveBeenCalledWith(
    { ...skill, name: "other-panel-in-the-same-group" }, current.resolvedSkills,
  );
  expect(ownerWrites()).toHaveLength(0);
});

it("rechecks a customer action and reads the confirmation label as the initiator, then executes with the same user", async () => {
 const order = { kind: "object" as const, objectType: "Order", primaryKey: "o1" };
 const identity = { kind: "object", objectType: "Order" };
 mocks.panel.mockResolvedValue({ id: "P", manifest: {
   state: { order: { type: identity } },
   members: { run: { target: { projectionId: "approval" }, inputs: { target: { state: "order" } } } },
 } });
 mocks.projection.mockResolvedValue({ id: "approval", name: "Approve order",
   binding: { kind: "Action", id: "approve-order" }, inputs: { target: identity },
 });
 const originalBackend = mocks.backend.getMockImplementation()!;
 mocks.backend.mockImplementation(async (...args) => {
   const url = new URL(args[1]);
   if (url.pathname === "/ontology/model/attributes") {
     expect(args[2].headers.tk).toBe("U-token");
     return { text: JSON.stringify([
       { className: "Order", name: "id", showName: "ID", type: "varchar", attrDesc: "", enable: true, primaryKey: true, businessKey: false },
       { className: "Order", name: "name", showName: "Name", type: "varchar", attrDesc: "", enable: true, primaryKey: false, businessKey: true },
     ]) };
   }
   if (url.pathname === "/data/queryInfoByNode") {
     expect(args[3].headers.tk).toBe("U-token");
     expect(args[2]).toEqual({ class: "Order", id: "Order:o1" });
     return { text: JSON.stringify({ success: true, data: { data: { name: "Purchase order" } } }) };
   }
   return originalBackend(...args);
 });
 const ownerCalls: string[] = [];
 vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
   const headers = new Headers(init.headers);
   const path = new URL(url).pathname;
   if (path === "/action/queryById") {
     expect(headers.get("tk")).toBe("U-token");
     ownerCalls.push("definition");
     return Response.json({ success: true, data: {
       id: "approve-order", name: "Approve order", codeHash: "a".repeat(64),
       target: { className: "Order", keyParameter: "key" },
       function: { parameters: [{ name: "key", type: "TYPE_STRING" }] },
     } });
   }
   if (path === "/action/form") {
     const submitted = JSON.parse(String(init.body));
     if (submitted.values === undefined) {
       expect(headers.get("tk")).toBe("U-token");
       ownerCalls.push("open");
     } else {
       expect(headers.get("X-API-Key")).toBeNull();
       expect(headers.get("tk")).toBe("U-token");
       ownerCalls.push("submit");
     }
     return Response.json({ success: true, data: {
       fields: [{ key: "key", label: "Key", required: false, defaultValue: null, help: null,
         type: "text", multiline: false, placeholder: null, maxLength: 200 }],
       values: { key: "o1" }, errors: [], parameters: submitted.values === undefined ? null : { key: "o1" },
     } });
   }
   expect(path).toBe("/action/execute");
   expect(headers.get("X-API-Key")).toBeNull();
   expect(headers.get("tk")).toBe("U-token");
   expect((init.body as FormData).get("param")).toBe(JSON.stringify({ key: "o1" }));
   ownerCalls.push("execute");
   return Response.json({ success: true, data: { result: "{}", affects: ["Order"] } });
 }));
 const input = { ...action(), operationId: "run.execute", call: { target: order, input: { values: {} } } };
 const { intentId } = await prepareLiveAction(input);
 expect(JSON.stringify(mocks.request.mock.calls[0]?.[2])).toContain("Purchase order");
 expect(ownerCalls).toEqual(["definition", "open"]);
 expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({
   kind: "dispatched", outcome: { kind: "success" },
 });
 expect(ownerCalls).toEqual(["definition", "open", "definition", "open", "submit", "execute"]);
});

it("admits a cross-member form.save write operation bound to another form member via operationDrafts", async () => {
  const { readAdmittedProjectionOperations } = await import("../direct-operations");
  const saveId = "test.cross.save";
  mockRegisteredOperation({
    handlerRef: saveId,
    labelKey: "test.previewMetric",
    binding: { kind: "PlatformOperation", id: saveId },
    kind: "form.save",
    effect: "write",
    batch: false,
    targetType: "platform:Relationship",
    targetSchema: z.union([
      z.object({ kind: z.literal("object"), objectType: z.literal("platform:Relationship"), primaryKey: z.string() }).strict(),
      z.object({ kind: z.literal("draft") }).strict(),
    ]),
    inputSchema: z.object({ values: z.record(z.unknown()) }),
    resultSchema: z.object({}),
    draftOperation: () => "relationship.create",
    draftInput: input => input,

    create: {
      draftValues: values => (values as Record<string, unknown>) ?? {},
      createdObject: () => ({ primaryKey: "rel-1", objectType: "platform:Relationship" }),
    },
    execute: async () => ({ kind: "success", data: {}, affected: { objects: [], objectTypes: ["platform:Relationship"] } }),
  });

  const panel = {
    id: "panel-cross-save",
    manifest: {
      state: {},
      members: {
        relationForm: { target: { projectionId: "rel-form" } },
        headerSave: {
          target: { projectionId: "header-save" },
          operationDrafts: { save: { slot: "relationForm" } },
        },
      },
    },
  };
  const headerProjection = {
    id: "header-save",
    name: "Header save",
    description: "",
    visibility: "domain" as const,
    componentId: "@ontomato/sdk:OperationButton",
    inputs: {},
    outputs: {},
    data: {},
    config: { operation: "save" },
    operations: {
      save: { operation: { kind: "PlatformOperation" as const, id: saveId } },
    },
  };
  const actor = {
    owner,
    credentials,
    use: { kind: "registered" as const, applicationId: "A", useId: "relations" },
  };

  const admitted = await readAdmittedProjectionOperations(actor as never, {
    panel: panel as never,
    projection: headerProjection as never,
    member: panel.manifest.members.headerSave,
    slot: "headerSave",
  }, {});
  expect(admitted.save).toMatchObject({
    kind: "form.save",
    effect: "write",
    target: { source: "draft", slot: "relationForm" },
  });
});

it("marks a batch operation unavailable only when every item in a non-empty array target is unavailable", async () => {
  const unavailableBatch = vi.fn(async (_host, targets: readonly { target: { primaryKey: string }; rowKey: string }[]) => {
    const reasons = new Map<string, { reason: string }>();
    for (const entry of targets) {
      if (entry.target.primaryKey !== "k-draft") {
        reasons.set(entry.rowKey, { reason: `Already approved: ${entry.target.primaryKey}` });
      }
    }
    return reasons;
  });
  const unavailableFallback = vi.fn(async (_host, target: { primaryKey: string }) =>
    target.primaryKey === "k-draft" ? undefined : { reason: `Single unavailable: ${target.primaryKey}` });

  const makeBatchHandler = (
    overrides: Pick<serverOperations.PanelWriteServerOperation, "unavailable" | "unavailableBatch">,
  ): serverOperations.PanelWriteServerOperation => ({
    handlerRef: APPROVE_KNOWLEDGE,
    labelKey: "test.batch",
    kind: "action",
    binding: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE },
    effect: "write",
    batch: true,
    targetType: BUSINESS_KNOWLEDGE,
    targetInput: "knowledge",
    targetSchema: z.object({ kind: z.literal("object"), objectType: z.literal(BUSINESS_KNOWLEDGE), primaryKey: z.string() }),
    inputSchema: z.object({}).strict(),
    resultSchema: z.object({ approved: z.boolean() }).strict(),
    targetLabel: async (_host, target) => target.primaryKey,
    execute: async () => ({ kind: "success", data: { approved: true } }),
    executeBatch: async () => ({ kind: "success", data: { approved: true } }),
    ...overrides,
  });

  const panel = {
    id: "panel-batch-availability",
    manifest: {
      state: {
        checked: { type: { kind: "list", items: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
      },
      members: {
        toolbar: {
          target: { projectionId: "toolbar-proj" },
          inputs: { checked: { state: "checked" } },
        },
      },
    },
  };
  const projection = {
    id: "toolbar-proj",
    name: "Toolbar",
    description: "",
    visibility: "domain" as const,
    componentId: "@ontomato/sdk:OperationButton",
    inputs: {
      checked: { kind: "list" as const, items: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE } },
    },
    outputs: {},
    data: {},
    config: { operation: "approveAll" },
    operations: {
      approveAll: {
        operation: { kind: "PlatformOperation" as const, id: APPROVE_KNOWLEDGE },
        target: { input: "checked" },
      },
    },
  };
  const actor = { owner, credentials };
  const placement = {
    panel: panel as never,
    projection: projection as never,
    member: panel.manifest.members.toolbar,
    slot: "toolbar",
  };
  const approved1 = { className: BUSINESS_KNOWLEDGE, primaryKey: "k-approved-1" };
  const approved2 = { className: BUSINESS_KNOWLEDGE, primaryKey: "k-approved-2" };
  const draft = { className: BUSINESS_KNOWLEDGE, primaryKey: "k-draft" };

  // 1. Handler with unavailableBatch (and unavailable, verifying unavailableBatch takes precedence)
  const spy = mockRegisteredOperation(makeBatchHandler({ unavailableBatch, unavailable: unavailableFallback }));

  // All selected items unavailable -> returns first target's unavailable reason
  const allUnavailable = await readAdmittedProjectionOperations(actor, placement, { checked: [approved1, approved2] });
  expect(allUnavailable.approveAll).toMatchObject({ unavailable: { reason: "Already approved: k-approved-1" } });
  expect(unavailableBatch).toHaveBeenCalledTimes(1);
  expect(unavailableBatch).toHaveBeenCalledWith(
    expect.objectContaining({ locale: "en", executor: actor }),
    [
      { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-approved-1" }, rowKey: "0" },
      { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-approved-2" }, rowKey: "1" },
    ],
  );
  expect(unavailableFallback).not.toHaveBeenCalled();

  // Mixed selection (at least one available) -> remains available
  const mixed = await readAdmittedProjectionOperations(actor, placement, { checked: [approved1, draft] });
  expect(mixed.approveAll).not.toHaveProperty("unavailable");
  expect(unavailableBatch).toHaveBeenCalledTimes(2);

  // Empty array -> remains available without invoking handler checks
  const empty = await readAdmittedProjectionOperations(actor, placement, { checked: [] });
  expect(empty.approveAll).not.toHaveProperty("unavailable");
  expect(unavailableBatch).toHaveBeenCalledTimes(2);

  // Pinned literal array input on member -> also checked
  const pinnedPlacement = {
    ...placement,
    member: {
      ...panel.manifest.members.toolbar,
      inputs: { checked: { literal: [approved2, approved1] } },
    },
  };
  const pinnedResult = await readAdmittedProjectionOperations(actor, pinnedPlacement as never, {});
  expect(pinnedResult.approveAll).toMatchObject({ unavailable: { reason: "Already approved: k-approved-2" } });

  // 2. Handler implementing only unavailable (no unavailableBatch) -> falls back to concurrent per-item checks
  spy.mockRestore();
  mockRegisteredOperation(makeBatchHandler({ unavailable: unavailableFallback }));

  const fallbackAllUnavailable = await readAdmittedProjectionOperations(actor, placement, { checked: [approved1, approved2] });
  expect(fallbackAllUnavailable.approveAll).toMatchObject({ unavailable: { reason: "Single unavailable: k-approved-1" } });
  expect(unavailableFallback).toHaveBeenCalledTimes(2);

  const fallbackMixed = await readAdmittedProjectionOperations(actor, placement, { checked: [approved1, draft] });
  expect(fallbackMixed.approveAll).not.toHaveProperty("unavailable");
  expect(unavailableFallback).toHaveBeenCalledTimes(4);
});
