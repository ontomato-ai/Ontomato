import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { z } from "zod";
import { HttpError } from "../../../utils/errors";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import * as serverOperations from "../server-operations";
import { agentDefinitionOperations } from "../agent-definition-operations";
import rawExamples from "../../../../../contracts/examples/platform-schedules.json";
import {platformTaskSchema} from "@ontomato/contracts/platform-schedules";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { type CreatePanelHumanOperationIntentRequest, type PanelOperationIntent } from "@ontomato/contracts/panel-agent";
import { agentHostObjectChangedFrameSchema } from "@ontomato/contracts/agent-host";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { AGENT_DEFINITION, APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE } from "@ontomato/contracts/panel-client-requests";
import { EXECUTION_CONTEXT_HEADER } from "@ontomato/contracts/execution-context";
import { panelReadOperationInputSchema, panelReadOperationResultSchema } from "@ontomato/contracts/panel-operations";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import { openPresentationView } from "../../agent-host/presentation";
const mocks = vi.hoisted(() => ({createDefinition:vi.fn(), projectDefinition:vi.fn(), assertPermission:vi.fn(),query:vi.fn(),backend:vi.fn(),run:vi.fn(),session:vi.fn(),request:vi.fn(),resolve:vi.fn(),panel:vi.fn(),projection:vi.fn(),pages:vi.fn(),restore:vi.fn(),sessionActor:vi.fn()}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../config/environment",()=>({environment:{agentRuntime:()=>({callbackUrl:"http://workbench.test",queryServiceToken:"fixture-service"})}}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{baseUrl:"http://owner.test"}}}));
vi.mock("../../../infrastructure/agent-runtime/client",()=>({RuntimeClient:class{run=mocks.run;session=mocks.session;request=mocks.request;}}));
vi.mock("../../assistant/store",()=>({assistantStore:{turn:async()=>({}),findAgent:async()=>undefined}}));
vi.mock("../../assistant/execution-setting",()=>({resolveAgentExecution:mocks.resolve}));
vi.mock("../../../identity/installed", () => ({ assertPermission: mocks.assertPermission }));
vi.mock("../../assistant/definitions", () => ({
  agentDefinitionPermissions: ["analysis-agent"],
  createAgentDefinitionSnapshot: mocks.createDefinition,
  projectAgentDefinitionSkills: mocks.projectDefinition,
}));

vi.mock("../../assistant/skills",()=>({
  readAssistantSkillView: mocks.pages,
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
    return { member, projection: { ...projection, data: projection.data ?? data, operations: projection.operations ?? operations } };
  },
}));
import {
  dispatchHumanPanelOperation, inspectPanelOperationImpact, ownPanelSettings,
  prepareHumanPanelOperation, projectPanelOperationIntent, readPanelOperation, readPanelOperationDescriptor,
} from "../operations";
import { productCatalogServerOperations } from "../catalog-operations";
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
const use={id:"tasks", names: { en: "tasks" },pageKey:"tasks",path:"/applications/A/tasks",panelId:"P"};
let intents:Map<string,PanelOperationIntent>, automatic:boolean, current:RuntimeRun;
const action=()=>({intentId:uuid(5),applicationId:"A",useId:"tasks",operationId:"run.runNow",call:{target:{kind:"object" as const,objectType:"platform:Trigger",primaryKey:uuid(9)},input:{}}});
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
   return {text:JSON.stringify({success:true,data:{applicationId:"A",use,menu:{singleEntry:true,groups:[],panelUses:[]}}})};
 });
 mocks.pages.mockResolvedValue({});
 mocks.assertPermission.mockResolvedValue(undefined);
 mocks.projectDefinition.mockImplementation(definition => definition);
 mocks.panel.mockResolvedValue({
   id: "P", manifest: {
     state: { task: { type: { kind: "object", objectType: "platform:Trigger" } } },
     members: {
       run: { target: { projectionId: "run" }, inputs: { task: { state: "task" } } },
       form: { target: { projectionId: "form" }, inputs: { task: { state: "task" } } },
     },
   },
 });
 mocks.projection.mockImplementation(async(_o:unknown,c:unknown,id:string)=>{expect(c).toBe(credentials);return {id,name:"Run now",componentId:id,binding:id==="run"?{kind:"PlatformOperation",id:"triggers.runNow"}:{kind:"PlatformObjectType",id:"platform:Trigger"},inputs:{task:{kind:"object",objectType:"platform:Trigger"}}};});
 mocks.restore.mockResolvedValue({owner});
 mocks.session.mockResolvedValue({messages:[]});
 mocks.request.mockResolvedValue({});
 mocks.query.mockImplementation(async(sql:string,args:unknown[])=>{
   const id=String(args[sql.startsWith("SELECT intent,owner_id")?1:2]);
   if(sql.startsWith("SELECT confirm_before"))return {rows:automatic?[{confirm_before_execute:false}]:[]};
   if(sql.startsWith("SELECT intent"))return {rows:intents.has(id)?[{intent:structuredClone(intents.get(id)),owner_id:owner.userId}]:[]};
   if(sql.startsWith("INSERT INTO panel_operation_intents")){if(!intents.has(String(args[1])))intents.set(String(args[1]),structuredClone(args[4] as PanelOperationIntent));return {rows:[]};}
   if(sql.includes("'{invalidated}'") && sql.includes("id<>$3")){
     const [domainId, userId, excludeId, targetsJson, reasonJson] = args;
     const targets = JSON.parse(String(targetsJson)) as { target: PanelOperationCall["target"] }[];
     const reason = JSON.parse(String(reasonJson));
     const rows = [];
     for (const [id, intent] of intents) {
       if (intent.initiator.domainId !== domainId || intent.initiator.userId !== userId || id === excludeId
         || intent.source.kind !== "agent-page" || intent.source.questionId === null || intent.dispatched || intent.invalidated) continue;
       const calls = "call" in intent ? [intent.call] : intent.calls;
       if (calls.some(({ target }) => target?.kind === "object" && targets.some(item =>
         item.target?.kind === "object" && target.objectType === item.target.objectType && target.primaryKey === item.target.primaryKey
       ))) { intent.invalidated = reason; rows.push({ id }); }
     }
     return { rows };
   }
   if(sql.includes("'{invalidated}'") && sql.includes("WHERE domain_id=$1 AND owner_id=$2 AND id=$3")){
     const val=intents.get(id);
     if(!val || val.dispatched || val.invalidated) return {rowCount:0};
     val.invalidated=JSON.parse(String(args[3]));
     return {rowCount:1};
   }
   if(sql.includes("AND intent->>'dispatched'='false'")){const value=intents.get(id)!;if(value.dispatched || value.invalidated)return {rowCount:0};intents.set(id,structuredClone(args[3] as PanelOperationIntent));return {rowCount:1};}
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
it("reports the identity assigned by the agent definition owner to a new draft", async () => {
  const actor = { owner, credentials };
  const unexpectedRequest = async () => { throw new Error("Unexpected request"); };
  const host = { initiator: actor, executor: actor, request: unexpectedRequest, requestWorkbench: unexpectedRequest };
  const primaryKey = uuid(91);
  const values = {
    name: "New agent", description: "", icon: null, enabled: true, skills: [], enabledMcpServiceIds: [], systemPrompt: "",
  };
  mocks.createDefinition.mockResolvedValueOnce({ definition: { ...values, id: primaryKey } });

  const outcome = await agentDefinitionOperations[0].execute(host, { kind: "draft" }, { values }, uuid(92));
  expect(outcome).toMatchObject({ kind: "success", created: { objectType: AGENT_DEFINITION, primaryKey } });
});

it.each([false, true])("protects generated secrets at dispatch and in the receipt (agent callback: %s)", async agentCallback => {
  const objectType = "platform:Trigger";
  const handlerRef = `${objectType}.save`;
  const created = { objectType, primaryKey: uuid(91) };
  const previous = { objectType, primaryKey: uuid(92) };
  const affected = { objects: [previous, created], objectTypes: [objectType], removed: [previous] };
  const secret = { items: [{ label: "Initial password", value: "generated-fixture-secret" }] };
  const humanValue = "entered-fixture-secret";
  const execute = vi.fn(async () => ({ kind: "success" as const, data: {}, created, affected, secret }));
  const inspect = vi.fn(async () => ({ summary: "Create task", total: 0, objects: [] }));
  mockRegisteredOperation({
    handlerRef, labelKey: "test.perform", binding: { kind: "PlatformOperation", id: handlerRef },
    kind: "form.save", effect: "write", batch: false, targetType: objectType, create: true,
    targetSchema: z.object({ kind: z.literal("draft") }).strict(),
    inputSchema: z.object({ values: z.record(z.unknown()) }), resultSchema: z.object({}),
    draftInput: input => input,
    inspectImpact: { handlerRef: "test.inspect", inspect },
    execute,
  });
  mocks.panel.mockResolvedValue({
    id: "P", manifest: { state: {}, members: { form: { target: { projectionId: "form" } } } },
  });
  mocks.projection.mockResolvedValue({
    id: "form", binding: { kind: "PlatformObjectType", id: objectType }, inputs: {},
  });
  const rootSession = { providerId: "workbench", sessionId: uuid(94) };
  current.channel!.userRecipient!.session = rootSession;
  const send = vi.fn();
  const unrelated = vi.fn();
  const view = new AbortController();
  openPresentationView("workbench", owner, uuid(95), send, view.signal);
  openPresentationView("workbench", { ...owner, userId: "other" }, uuid(96), unrelated, view.signal);
  try {
    const prepared = await prepareLiveAction({
      intentId: uuid(93), applicationId: "A", useId: "tasks", operationId: "form.save",
      secretFields: ["/settings/password"],
      call: { target: { kind: "draft" }, input: { values: { title: "New task", settings: { password: humanValue } } } },
    });
    expect(JSON.stringify([intents.get(prepared.intentId), prepared, mocks.request.mock.calls, inspect.mock.calls]))
      .not.toContain(humanValue);
    const caller = agentCallback
      ? { ...credentials, headers: { [AGENT_EXECUTION_HEADER]: uuid(97) } }
      : credentials;
    const result = await dispatchHumanPanelOperation(owner, caller, prepared.intentId);
    expect(result).toMatchObject({ kind: "dispatched", outcome: { kind: "success", created,
      ...(agentCallback ? { secretGenerated: true } : { secret }),
    } });
    if (agentCallback) expect(JSON.stringify(result)).not.toContain(secret.items[0]!.value);
    expect(execute).toHaveBeenCalledWith(expect.anything(), { kind: "draft" }, {
      values: { title: "New task", settings: { password: humanValue } },
    }, prepared.intentId);
    const replay = await dispatchHumanPanelOperation(owner, credentials, prepared.intentId);
    expect(replay).toMatchObject({ outcome: { secretGenerated: true } });
    const queried = await projectPanelOperationIntent(owner, prepared.intentId, undefined, credentials);
    const safe = JSON.stringify([intents.get(prepared.intentId), replay, queried, send.mock.calls]);
    expect(safe).not.toContain(humanValue);
    expect(safe).not.toContain(secret.items[0]!.value);
    expect(send).toHaveBeenCalledOnce();
    const frame = agentHostObjectChangedFrameSchema.parse(JSON.parse(JSON.stringify(send.mock.calls[0]![0])));
    expect(frame).toMatchObject({
      session: rootSession, target: null, affected,
      operation: { operationId: "form.save", panelId: "P", target: null, created, secretGenerated: true },
    });
    expect(unrelated).not.toHaveBeenCalled();
  } finally {
    view.abort();
  }
});

it("does not let a content page's loaded skill authorize a frame operation", async () => {
  await expect(prepareLiveAction({ ...action(), root: "frame" })).rejects.toMatchObject({
    status: 403, code: "PANEL_FRAME_SKILL_REQUIRED",
  });
  expect(intents.size).toBe(0);
});

const task=platformTaskSchema.parse({...rawExamples.creates.find(task=>task.name==="agents-instruction")!.response,id:uuid(9),revision:9});
it("session settings compare the authenticated owner even when a session is readable",async()=>{
 mocks.sessionActor.mockResolvedValue({id:uuid(4),domainId:"d"});mocks.restore.mockResolvedValue({owner:{...owner,userId:"someone-else"}});
 await expect(ownPanelSettings(owner,root)).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await panelOperationStore.settings(owner,root)).confirmBeforeExecute).toBe(true);
});
it("requires the human root and confirmation for preview page operations",async()=>{
 current.channel!.authority.executionKind="preview";
 await expect(prepareLiveAction(action())).rejects.toMatchObject({code:"PREVIEW_WRITE_FORBIDDEN"});
 current.channel!.root = { session, runId: current.id };
 current.channel!.userRecipient = { session, actor: current.channel!.actor };
 automatic = true;
 const preparation = await prepareLiveAction(action());
 expect(preparation).toMatchObject({ autoMode: false, questionId: expect.any(String) });
 expect(ownerWrites()).toHaveLength(0);
});

it("carries a preview run's identity into the business write its page operation dispatches, whoever confirms it",async()=>{
 current.channel!.authority.executionKind="preview";
 current.channel!.root = { session, runId: current.id };
 current.channel!.userRecipient = { session, actor: current.channel!.actor };
 const { intentId } = await prepareLiveAction(action());
 expect(intents.get(intentId)).toMatchObject({ source: { kind: "agent-page", executionKind: "preview" } });
 const owner422 = vi.fn(async(url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   const marked = new Headers(init.headers).get(EXECUTION_CONTEXT_HEADER);
   if ((init.method ?? "GET") === "GET") {
     expect(marked).toBeNull();
     return Response.json({...task,title:"Inventory summary"});
   }
   expect(url).toMatch(/\/platform\/triggers\/[^/]+\/runs$/u);
   expect(marked).toBe('preview');
   return Response.json({error:{code:"PREVIEW_WRITE_FORBIDDEN",message:"预览里不执行写操作，动作的对错用动作试跑验"},correlationId:"test"},{status:422});
 });
 vi.stubGlobal("fetch",owner422);
 // The person confirming in the page dispatches with their own credentials, which carry no preview of their own.
 expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({ kind: "dispatched", outcome: {
   kind: "refusal", code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验",
 } });
 expect(ownerWrites()).toHaveLength(1);
});

it.each([
 { request: "preview", run: "live" },
 { request: "live", run: "preview" },
] as const)("records a $request request's page operation for a $run run as the preview's, so a live page's confirmation still reaches the write as the preview",async({ request, run })=>{
 current.channel!.authority.executionKind=run;
 current.channel!.root = { session, runId: current.id };
 current.channel!.userRecipient = { session, actor: current.channel!.actor };
 mocks.projection.mockImplementation(async(_o:unknown,_c:unknown,id:string)=>({id,name:"Run now",componentId:id,binding:id==="run"?{kind:"PlatformOperation",id:"triggers.runNow"}:{kind:"PlatformObjectType",id:"platform:Trigger"},inputs:{task:{kind:"object",objectType:"platform:Trigger"}}}));
 const { intentId: toolCallId, ...operation } = action();
 const caller = request === "preview" ? { ...credentials, executionKind: "preview" as const } : credentials;
 const { intentId } = await prepareHumanPanelOperation(owner, caller,
   { ...operation, agentRun: { runId: current.id, sessionId: current.sessionId, toolCallId } }, "Alice");
 expect(intents.get(intentId)).toMatchObject({ source: { kind: "agent-page", executionKind: "preview" } });
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   const marked = new Headers(init.headers).get(EXECUTION_CONTEXT_HEADER);
   if ((init.method ?? "GET") === "GET") return Response.json({...task,title:"Inventory summary"});
   expect(url).toMatch(/\/platform\/triggers\/[^/]+\/runs$/u);
   expect(marked).toBe('preview');
   return Response.json({error:{code:"PREVIEW_WRITE_FORBIDDEN",message:"预览里不执行写操作，动作的对错用动作试跑验"},correlationId:"test"},{status:422});
 }));
 // The person on the live page confirms with their own, unmarked credentials.
 expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({ kind: "dispatched", outcome: {
   kind: "refusal", code: "PREVIEW_WRITE_FORBIDDEN",
 } });
 expect(ownerWrites()).toHaveLength(1);
});

it("carries a preview's identity into the business write when it confirms a live run's page operation",async()=>{
 const { intentId } = await prepareLiveAction(action());
 expect(intents.get(intentId)!.source).not.toHaveProperty("executionKind");
 mocks.projection.mockImplementation(async(_o:unknown,_c:unknown,id:string)=>({id,name:"Run now",componentId:id,binding:{kind:"PlatformOperation",id:"triggers.runNow"},inputs:{task:{kind:"object",objectType:"platform:Trigger"}}}));
 const owner422 = vi.fn(async(url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   const marked = new Headers(init.headers).get(EXECUTION_CONTEXT_HEADER);
   if ((init.method ?? "GET") === "GET") {
     expect(marked).toBeNull();
     return Response.json({...task,title:"Inventory summary"});
   }
   expect(url).toMatch(/\/platform\/triggers\/[^/]+\/runs$/u);
   expect(marked).toBe('preview');
   return Response.json({error:{code:"PREVIEW_WRITE_FORBIDDEN",message:"预览里不执行写操作，动作的对错用动作试跑验"},correlationId:"test"},{status:422});
 });
 vi.stubGlobal("fetch",owner422);
 // Confirming a pending operation is platform state; the write it executes is refused at its entry, never let through live.
 expect(await dispatchHumanPanelOperation(owner, { ...credentials, executionKind: "preview" }, intentId)).toMatchObject({ kind: "dispatched", outcome: {
   kind: "refusal", code: "PREVIEW_WRITE_FORBIDDEN", message: "预览里不执行写操作，动作的对错用动作试跑验",
 } });
 expect(ownerWrites()).toHaveLength(1);
});

it("rejects a declaration whose target type does not match its platform operation",async()=>{
 const panel=await mocks.panel();panel.manifest.state.task.type.objectType="customer:Account";
 await expect(prepareLiveAction(action())).rejects.toMatchObject({
   status: 422, code: "PANEL_OPERATION_TARGET_MISMATCH",
   message: expect.stringContaining("connect input 'task' to an object of type 'platform:Trigger'"),
 });
 expect(ownerWrites()).toHaveLength(0);
});

it("uses the initiator's display name in self mode",async()=>{
 current={...current,executionUserId:null};
 await prepareLiveAction(action());
 expect(mocks.request.mock.calls[0][2].message).toBe('Run “Run now” on “Inventory summary” as Alice?');
 expect(mocks.backend.mock.calls.some(([,url])=>url.includes("/platform/agent-execution/options"))).toBe(false);
});
it.each([403,404])("refuses an unreadable trigger after one initiator read (%s), without trying the executor",async status=>{
 const read=vi.fn(async(_url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   expect(init.method ?? "GET").toBe("GET");
   expect(new Headers(init.headers).get("tk")).toBe("U-token");
   expect(new Headers(init.headers).get("X-API-Key")).toBeNull();
   return Response.json({error:{code:status===403?"PERMISSION_DENIED":"TASK_NOT_FOUND",message:"Unavailable"},correlationId:"test"},{status});
 });vi.stubGlobal("fetch",read);
 await expect(prepareLiveAction(action())).rejects.toMatchObject({status});
 expect(read).toHaveBeenCalledTimes(1);
 expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects an unregistered server handler before any question or dispatch",async()=>{
 mocks.projection.mockResolvedValue({id:"run",name:"Other",componentId:"run",binding:{kind:"PlatformOperation",id:"not.registered"},inputs:{task:{kind:"object",objectType:"platform:Trigger"}}});
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

function installBatchOwner(
  availability: Pick<serverOperations.PanelWriteServerOperation, "unavailable" | "unavailableBatch" | "secretFields"> = {},
) {
  const objectType = "platform:Trigger";
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
    ...availability,
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

it("restores each human batch input and expires a batch whose secrets are gone", async () => {
  const { handler, request } = installBatchOwner({ secretFields: ["password"] });
  const [first, second] = request.calls;
  const calls: serverOperations.PanelBatchCalls = [
    { ...first, input: { ...first.input, password: "first-fixture-secret" } },
    { ...second!, input: { ...second!.input, password: "second-fixture-secret" } },
  ];
  handler.executeBatch.mockImplementation(async (_host, calls: serverOperations.PanelBatchCalls) => ({
    kind: "batch",
    items: calls.map(({ target }, index) => ({
      target: { objectType: target.objectType, primaryKey: target.primaryKey },
      outcome: { kind: "success", data: {}, secret: { items: [{ label: "Key", value: `fixture-output-${index}` }] } },
    })),
  }));
  const { intentId: _unused, ...input } = request;
  const prepared = await prepareHumanPanelOperation(owner, credentials, { ...input, calls });
  expect(JSON.stringify([intents.get(prepared.intentId), prepared])).not.toContain("fixture-secret");
  const done = await dispatchHumanPanelOperation(owner, credentials, prepared.intentId);
  expect(handler.executeBatch).toHaveBeenCalledWith(expect.anything(), calls, prepared.intentId);
  expect(JSON.stringify(done)).toContain("fixture-output-1");
  expect(JSON.stringify(intents.get(prepared.intentId))).not.toContain("fixture-output-");
  expect(await dispatchHumanPanelOperation(owner, credentials, prepared.intentId)).toMatchObject({
    outcome: { items: [{ outcome: { secretGenerated: true } }, { outcome: { secretGenerated: true } }] },
  });
  vi.useFakeTimers();
  try {
    const pending = await prepareHumanPanelOperation(owner, credentials, { ...input, calls });
    vi.runOnlyPendingTimers();
    expect(await dispatchHumanPanelOperation(owner, credentials, pending.intentId)).toMatchObject({
      kind: "not-dispatched", code: "PANEL_SECRET_EXPIRED",
    });
    expect(intents.get(pending.intentId)?.dispatched).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

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

it("previews only executable calls in the agent's confirmation and owner impact", async () => {
  const { handler, request, impact } = installBatchOwner({
    unavailable: async (_host, target) => target!.primaryKey === uuid(9) ? { reason: "Already processed" } : undefined,
  });
  const [skipped, executable] = request.calls;
  handler.targetLabel.mockImplementation(async (_host, target) => target.primaryKey === skipped.target.primaryKey
    ? "Already processed task" : "Pending task");
  handler.inspectImpact.inspect.mockResolvedValue({ ...impact, objects: [], total: 1 });

  await prepareLiveAction({ ...request, calls: [skipped, executable!] });
  expect(handler.inspectImpact.inspect).toHaveBeenCalledWith(expect.anything(), [executable]);
  const { message } = mocks.request.mock.calls[0]![2];
  expect(message).toContain("Pending task (1)");
  expect(message).not.toContain("Already processed task");
  expect(message).toMatch(/\b1\b.*will be skipped/i);
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
    .rejects.toMatchObject({ status: 404 });
  expect(mocks.pages).not.toHaveBeenCalled();
  expect(intents.size).toBe(0);
});

it("adds owner availability only to a live descriptor for the selected record", async () => {
  const registration = serverOperations.registeredPanelOperation("triggers.runNow");
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
  const pending = await prepareLiveAction({ ...request, intentId: uuid(55), calls: [request.calls[4]!] });
  const unchanged = await prepareLiveAction({ ...request, intentId: uuid(56), calls: [request.calls[1]!] });
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
  expect(await dispatchHumanPanelOperation(owner, credentials, pending.intentId)).toMatchObject({
    kind: "not-dispatched", code: "FORM_CONFIRMATION_STALE",
  });
  expect(intents.get(unchanged.intentId)?.invalidated).toBeUndefined();
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
    objects, objectTypes: ["platform:Trigger"],
  } };
  handler.executeBatch.mockResolvedValue(outcome);
  expect(await executeLiveAction(request)).toMatchObject({ kind: "dispatched", outcome });
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
});

it("uses the owner's bulk availability at dispatch and restores skipped targets in the frozen order", async () => {
  const reason = "Already approved";
  const unavailable = vi.fn();
  type UnavailableBatch = NonNullable<serverOperations.PanelWriteServerOperation["unavailableBatch"]>;
  const unavailableBatch = vi.fn<Parameters<UnavailableBatch>, ReturnType<UnavailableBatch>>();
  unavailableBatch.mockResolvedValue(new Map());
  const { handler, request, impact } = installBatchOwner({ unavailable, unavailableBatch });
  automatic = true;
  const { intentId } = await prepareLiveAction(request);
  unavailableBatch.mockImplementation(async (_host, targets) => new Map([
    [targets[1]!.rowKey, { reason }],
    [targets[4]!.rowKey, { reason }],
  ]));
  const executable = [request.calls[0], request.calls[2], request.calls[3]];
  const targets = impact.objects.map(({ target }) => target);
  const affected = { objects: [targets[0]!], objectTypes: [targets[0]!.objectType] };
  const success = { kind: "success", data: {}, affected };
  const failure = { kind: "failure", code: "STORE_ERROR", message: "Write failed" };
  const skipped = { kind: "skipped", reason };
  handler.executeBatch.mockResolvedValue({
    kind: "batch", items: [
      { target: targets[0], outcome: success },
      { target: targets[2], outcome: failure },
      { target: targets[3], outcome: failure },
    ],
  });
  expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({
    kind: "dispatched",
    outcome: {
      kind: "batch",
      items: targets.map((target, index) => ({ target, outcome: [success, skipped, failure, failure, skipped][index] })),
      affected,
    },
  });
  expect(handler.executeBatch).toHaveBeenCalledWith(expect.anything(), executable, intentId);
  expect(unavailable).not.toHaveBeenCalled();
});

it("uses single-target availability and maps an atomic result only to the executable items", async () => {
  const reason = { reason: "Already approved" };
  type Unavailable = NonNullable<serverOperations.PanelWriteServerOperation["unavailable"]>;
  const unavailable = vi.fn<Parameters<Unavailable>, ReturnType<Unavailable>>();
  const { handler, request, impact } = installBatchOwner({ unavailable });
  automatic = true;
  const ids = [request.calls[1].target.primaryKey, request.calls[3].target.primaryKey];
  unavailable.mockImplementation(async (_host, target) => ids.includes(target!.primaryKey) ? reason : undefined);
  const success = { kind: "success", data: { updated: 3 }, affected: {
    objects: impact.objects.filter(({ target }) => !ids.includes(target.primaryKey)).map(({ target }) => target),
    objectTypes: [request.calls[0].target.objectType],
  } };
  handler.executeBatch.mockResolvedValue(success);
  const { intentId } = await prepareLiveAction(request);
  expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({
    kind: "dispatched",
    outcome: {
      kind: "batch",
      items: impact.objects.map(({ target }) => ({
        target, outcome: ids.includes(target.primaryKey) ? { kind: "skipped", ...reason } : success,
      })),
      affected: success.affected,
    },
  });
  expect(handler.executeBatch).toHaveBeenCalledWith(expect.anything(),
    request.calls.filter(({ target }) => !ids.includes(target.primaryKey)), intentId);
});

it("records an all-skipped batch without calling the owner write or invalidating pending writes", async () => {
  const reason = { reason: "Already approved" };
  const { handler, request, impact } = installBatchOwner({ unavailable: async () => reason });
  automatic = true;
  const pending = await prepareLiveAction({ ...request, intentId: uuid(57), calls: [request.calls[0]] });
  const { intentId } = await prepareLiveAction(request);
  const outcome = {
    kind: "batch",
    items: impact.objects.map(({ target }) => ({ target, outcome: { kind: "skipped", ...reason } })),
  };
  expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toEqual({ kind: "dispatched", intentId, outcome });
  expect(handler.executeBatch).not.toHaveBeenCalled();
  expect(handler.inspectImpact.inspect).not.toHaveBeenCalled();
  expect(intents.get(pending.intentId)?.invalidated).toBeUndefined();
});

it("returns type-only changes from a successful single write", async () => {
  const { handler, request: { calls, ...request } } = installBatchOwner();
  automatic = true;
  const affected = { objects: [], objectTypes: ["platform:Trigger"] };
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

it("freezes a localized input schema and dispatches the batch in the same locale", async () => {
  const { handler, request } = installBatchOwner();
  const describeInputSchema: NonNullable<serverOperations.PanelServerOperation["describeInputSchema"]> = async (_host, locale) => ({
    type: "object",
    properties: { status: { type: "number", title: locale === "fr" ? "Statut" : "Status" } },
  });
  mockRegisteredOperation({ ...handler, describeInputSchema });
  handler.executeBatch.mockResolvedValue({
    kind: "batch",
    items: request.calls.map(({ target: { objectType, primaryKey } }) => ({
      target: { objectType, primaryKey }, outcome: { kind: "success", data: { done: true } },
    })),
  });
  const viewer = { ...credentials, locale: "fr" };
  const { intentId: _id, ...input } = request;

  const descriptor = await readPanelOperationDescriptor(owner, viewer, input);
  expect(descriptor.inputSchema).toHaveProperty("properties.status.title", "Statut");
  const { intentId } = await prepareHumanPanelOperation(owner, viewer, input);
  expect(intents.get(intentId)?.operation.inputSchema).toEqual(descriptor.inputSchema);
  await expect(dispatchHumanPanelOperation(owner, viewer, intentId)).resolves.toMatchObject({
    kind: "dispatched", outcome: { kind: "batch" },
  });
  expect(handler.executeBatch).toHaveBeenCalledWith(expect.objectContaining({ locale: "fr" }), input.calls, intentId);
});

it("runs a registered read for a preview reader with the preview identity, without creating an intent", async () => {
  const binding = { kind: "PlatformOperation" as const, id: "metricViews.testExecute" };
  const input = { applicationId: "A", useId: "tasks", operationId: "run.testExecute", call: {
    target: { kind: "draft" as const },
    input: { draft: { name: "Unsaved metric" }, parameters: { amount: 3 }, bindingId: "sample" },
  } };
  const preview = { ...credentials, executionKind: "preview" as const };
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
    // A read carries the caller's preview identity; its owner does not treat the identity as a write refusal.
    expect(new Headers(init.headers).get(EXECUTION_CONTEXT_HEADER)).toBe('preview');
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


it.each([false, true])("handles an Action-backed form with another tab saving first = %s", async (humanSavesFirst) => {
 const order = { kind: "object" as const, objectType: "Order", primaryKey: "o1" };
 const identity = { kind: "object", objectType: "Order" };
 const binding = { kind: "Action", id: "approve-order" };
 const token = "private-customer-action-token";
 mocks.panel.mockResolvedValue({ id: "P", manifest: {
   state: { order: { type: identity } },
   members: { form: { target: { projectionId: "approval" }, inputs: { target: { state: "order" } } } },
 } });
 mocks.projection.mockResolvedValue({ id: "approval", name: "Approve order",
   binding, inputs: { target: identity },
   data: { form: { source: { object: { input: "target" } }, read: "form", params: {} } },
   operations: {
     save: { operation: binding, target: { input: "target" } },
     run: { operation: binding, target: { input: "target" } },
   },
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
       function: { parameters: [{ name: "key", type: "TYPE_STRING" }, { name: "token", type: "TYPE_STRING" }] },
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
       expect(submitted.values).toMatchObject({ token });
       ownerCalls.push("submit");
     }
     return Response.json({ success: true, data: {
       fields: [{ key: "key", label: "Key", required: false, defaultValue: null, help: null,
         type: "text", multiline: false, placeholder: null, maxLength: 200 }],
       values: { key: "o1" }, errors: [], parameters: submitted.values === undefined ? null : { key: "o1", token },
     } });
   }
   expect(path).toBe("/action/execute");
   expect(headers.get("X-API-Key")).toBeNull();
   expect(headers.get("tk")).toBe("U-token");
   expect((init.body as FormData).get("param")).toBe(JSON.stringify({ key: "o1", token }));
   ownerCalls.push("execute");
   return Response.json({ success: true, data: { result: "{}", affects: ["Order"] } });
 }));
 const input = {
   ...action(), operationId: "form.save", secretFields: ["/values/token"],
   call: { target: order, input: { values: { token } } },
 };
 await expect(prepareLiveAction({ ...input, operationId: "form.run", intentId: uuid(96) })).rejects.toMatchObject({
   code: "PANEL_SECRET_HUMAN_INPUT_REQUIRED",
 });
 const prepared = await prepareLiveAction(input);
 const { intentId } = prepared;
 expect(JSON.stringify([prepared, intents.get(intentId)])).not.toContain(token);
 const { message } = mocks.request.mock.calls[0]![2] as { message: string };
 expect(message).toContain("Purchase order");
 expect(message).not.toContain(token);
 expect(ownerCalls.slice(-2)).toEqual(["definition", "open"]);
 if (humanSavesFirst) {
   const manual = await prepareHumanPanelOperation(owner, credentials, input);
   expect(await dispatchHumanPanelOperation(owner, credentials, manual.intentId)).toMatchObject({
     kind: "dispatched", outcome: { kind: "success" },
   });
   expect(await dispatchHumanPanelOperation(owner, credentials, intentId)).toMatchObject({
     kind: "not-dispatched", code: "FORM_CONFIRMATION_STALE",
   });
   expect(ownerCalls.filter(call => call === "execute")).toHaveLength(1);
   return;
 }
 const outcome = await dispatchHumanPanelOperation(owner, credentials, intentId);
 expect(outcome).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
 expect(JSON.stringify([outcome, intents.get(intentId)])).not.toContain(token);
});


it("uses the owner form's display labels in the confirmation input summary", async () => {
  const originalBackend = mocks.backend.getMockImplementation()!;
  mocks.panel.mockResolvedValue({
    id: "P", manifest: { state: {}, members: { form: { target: { projectionId: "form" } } } },
  });
  mocks.projection.mockResolvedValue({
    id: "form", binding: { kind: "PlatformObjectType", id: "platform:ObjectType" }, inputs: {},
  });
  mockRegisteredOperation({
    handlerRef: "platform:ObjectType.save", labelKey: "test.perform", binding: { kind: "PlatformObjectType", id: "platform:ObjectType" },
    kind: "form.save", effect: "write", batch: false, targetType: "platform:ObjectType", create: true,
    targetSchema: z.object({ kind: z.literal("draft") }).strict(),
    inputSchema: z.object({ values: z.record(z.unknown()) }), resultSchema: z.object({}),
    draftInput: input => input,
    execute: async () => ({ kind: "success", data: {}, affected: { objects: [], objectTypes: ["platform:ObjectType"] } }),
  });
  const textField = (path: string, label: string, required: boolean) => ({
    path, label, control: { kind: "text" }, valueSchema: { type: "string" }, required, readOnly: false,
  });
  mocks.backend.mockImplementation(async (...args) => {
    const url = new URL(args[1]);
    if (url.pathname === "/ontology/model/object-type/form") {
      expect(args[2]).toMatchObject({ target: { kind: "draft" }, changedField: null });
      return { text: JSON.stringify({
        fields: [
          textField("/className", "API name", true),
          textField("/primaryKeyName", "Primary key name", true),
          textField("/showName", "Display name", true),
          textField("/classDesc", "Description", false),
        ],
        values: { className: "", primaryKeyName: "", showName: "", classDesc: "" },
        save: { method: "POST", path: "/ontology/model/object-type/create", bodySchema: { type: "object" } },
      }) };
    }
    return originalBackend(...args);
  });

  await prepareLiveAction({
    intentId: uuid(98), applicationId: "A", useId: "tasks", operationId: "form.save",
    call: { target: { kind: "draft" }, input: { values: {
      className: "Order", primaryKeyName: "id", showName: "Order", classDesc: "Orders",
    } } },
  });
  const { message } = mocks.request.mock.calls[0]![2] as { message: string };
  expect(message).toContain("API name, Primary key name, Display name, Description");
  expect(message).not.toContain("className, primaryKeyName, showName, classDesc");
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
    draftInput: input => input,

    create: true,
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
  const unavailableFallback = vi.fn(async (_host, target: { primaryKey: string } | null) => {
    const { primaryKey } = target!;
    return primaryKey === "k-draft" ? undefined : { reason: `Single unavailable: ${primaryKey}` };
  });

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

it.each([
  { scenario: "two tabs on one entry", crossEntry: false, targetKind: "same" },
  { scenario: "two different applications and entries", crossEntry: true, targetKind: "same" },
  { scenario: "two different objects", crossEntry: false, targetKind: "different" },
  { scenario: "two independent new drafts", crossEntry: false, targetKind: "draft" },
])("scopes pending form confirmation invalidation for $scenario", async ({ crossEntry, targetKind }) => {
  const objectType = "platform:Trigger";
  const objectTarget = { kind: "object" as const, objectType, primaryKey: uuid(9) };
  const target = targetKind === "draft" ? { kind: "draft" as const } : objectTarget;
  const manualTarget = targetKind === "different" ? { ...objectTarget, primaryKey: uuid(10) } : target;
  const execute = vi.fn(async () => ({
    kind: "success" as const,
    data: {},
    ...(targetKind === "draft" && { affected: { objects: [{ objectType, primaryKey: uuid(11) }], objectTypes: [objectType] } }),
  }));
  const saveHandlerRef = "platform:Trigger.save";
  mockRegisteredOperation({
    handlerRef: saveHandlerRef,
    labelKey: "test.perform",
    binding: { kind: "PlatformOperation", id: saveHandlerRef },
    kind: "form.save",
    effect: "write",
    batch: false,
    targetType: objectType,
    targetSchema: z.union([
      z.object({ kind: z.literal("object"), objectType: z.literal(objectType), primaryKey: z.string() }).strict(),
      z.object({ kind: z.literal("draft") }).strict(),
    ]),
    inputSchema: z.object({ values: z.record(z.unknown()), submittedFields: z.array(z.string()).optional() }),
    resultSchema: z.object({}),
    draftInput: input => input,
    create: true,
    execute,
  });
  if (targetKind === "draft") {
    mocks.panel.mockResolvedValue({
      id: "P", manifest: { state: {}, members: { form: { target: { projectionId: "form" } } } },
    });
    mocks.projection.mockResolvedValue({
      id: "form", binding: { kind: "PlatformObjectType", id: objectType }, inputs: {},
    });
  }
  if (crossEntry) {
    const read = mocks.backend.getMockImplementation()!;
    mocks.backend.mockImplementation(async (...args) => {
      const url = new URL(args[1]);
      if (url.searchParams.get("applicationId") !== "B" || url.searchParams.get("useId") !== "other-tasks") {
        return read(...args);
      }
      const otherUse = { ...use, id: "other-tasks", path: "/applications/B/other-tasks" };
      return { text: JSON.stringify({ success: true, data: {
        applicationId: "B", use: otherUse, menu: { singleEntry: true, groups: [], panelUses: [] },
      } }) };
    });
  }

  const values = { title: "private-title-value", password: "private-password-value", credentials: { token: "private-token-value" }, untouched: true };
  const agentPrepared = await prepareLiveAction({
    intentId: uuid(51),
    applicationId: "A",
    useId: "tasks",
    operationId: "form.save",
    call: { target, input: { values, submittedFields: ["/title", "/password", "/credentials/token"] } },
  });
  const { message } = mocks.request.mock.calls[0]![2] as { message: string };
  for (const field of ["title", "password", "credentials/token"]) expect(message).toContain(field);
  for (const secret of [values.title, values.password, values.credentials.token]) expect(message).not.toContain(secret);
  expect(message).not.toContain("untouched");

  const humanPrepared = await prepareHumanPanelOperation(owner, credentials, {
    applicationId: crossEntry ? "B" : "A",
    useId: crossEntry ? "other-tasks" : "tasks",
    operationId: "form.save",
    call: { target: manualTarget, input: { values: { title: "Manual title" }, submittedFields: ["/title"] } },
  });
  const humanDispatched = await dispatchHumanPanelOperation(owner, credentials, humanPrepared.intentId);
  expect(humanDispatched).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });

  const agentDispatched = await dispatchHumanPanelOperation(owner, credentials, agentPrepared.intentId);
  if (targetKind === "same") {
    expect(agentDispatched).toMatchObject({ kind: "not-dispatched", code: "FORM_CONFIRMATION_STALE" });
    expect(execute).toHaveBeenCalledTimes(1);
  } else {
    expect(agentDispatched).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
  }
});

it("persists the agent-page intent before publishing the confirmation question and cancels it if publishing fails", async () => {
  const { request } = installBatchOwner();
  const order: string[] = [];
  const origQuery = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith("INSERT INTO panel_operation_intents")) order.push("insert-intent");
    return origQuery(sql, args);
  });
  mocks.request.mockImplementation(async (path: string) => {
    if (path === "/v1/channel/user-questions") order.push("publish-question");
    return {};
  });

  await prepareLiveAction({ ...request, intentId: uuid(54) });
  expect(order).toEqual(["insert-intent", "publish-question"]);

  // If publishing the question fails after insert, the intent is cancelled rather than left pending.
  mocks.request.mockRejectedValueOnce(new Error("runtime unavailable"));
  await expect(prepareLiveAction({ ...request, intentId: uuid(52) })).rejects.toThrow("runtime unavailable");
  const inserted = [...intents.values()].find(item => item.source.kind === "agent-page" && item.source.toolCallId === uuid(52));
  expect(inserted?.invalidated).toMatchObject({ code: "CONFIRMATION_PUBLISH_FAILED" });
});

it("lists every target name in batch confirmation questions instead of truncating at four", async () => {
  const { request } = installBatchOwner();
  await prepareLiveAction({ ...request, intentId: uuid(53) });
  const questionBody = mocks.request.mock.calls.at(-1)?.[2] as { message: string };
  for (let index = 1; index <= 5; index += 1) {
    expect(questionBody.message).toContain(`Task ${index}`);
  }
});

it("names the specific application entry in deleteEntry confirmation prompts", async () => {
  const deleteEntry = productCatalogServerOperations.find(op => op.handlerRef === "applications.deleteEntry")!;
  if (deleteEntry.effect !== "write" || deleteEntry.kind !== "action" || !deleteEntry.targetLabel) {
    throw new Error("Expected applications.deleteEntry write handler");
  }
  const origBackend = mocks.backend.getMockImplementation()!;
  mocks.backend.mockImplementation(async (name: string, url: string, opts: { headers: object }) => {
    if (url.includes("/platform/applications/catalogue/app-1")) {
      return {
        text: JSON.stringify({
          success: true,
          data: {
            id: "app-1",
            source: "domain",
            names: { en: "Orders App" },
            descriptions: {},
            icon: "apps",
            allowStandalone: false,
            canMaintain: true,
            canEditEntries: true,
            entryCount: 2,
            updatedAt: "",
            entry: { path: "/orders", home: "/orders/list" },
            groups: [],
            panelUses: [
              { id: "entry-a", pageKey: "orders", panelId: "p1", path: "/orders/list", names: { en: "Order List" } },
              { id: "entry-b", pageKey: "settings", panelId: "p2", path: "/orders/settings", names: { en: "Order Settings" } },
            ],
          },
        }),
      };
    }
    return origBackend(name, url, opts);
  });

  const host = {
    initiator: { owner, credentials },
    executor: { owner, credentials },
    locale: "en",
    request: async () => new Response(),
    requestWorkbench: async () => new Response(),
  };
  const labelA = await deleteEntry.targetLabel(host, { kind: "object", objectType: "platform:Application", primaryKey: "app-1" }, { entryId: "entry-a" });
  const labelB = await deleteEntry.targetLabel(host, { kind: "object", objectType: "platform:Application", primaryKey: "app-1" }, { entryId: "entry-b" });
  expect(labelA).toBe("Orders App / Order List");
  expect(labelB).toBe("Orders App / Order Settings");
  expect(labelA).not.toBe(labelB);
});

it("rejects an agent-page action that supplies a declared secret", async () => {
  const handlerRef = "test.setPassword";
  mockRegisteredOperation({
    handlerRef, labelKey: "test.perform", binding: { kind: "PlatformOperation", id: handlerRef },
    kind: "action", effect: "write", batch: false, secretFields: ["password"],
    targetSchema: z.null(), inputSchema: z.object({ password: z.string() }), resultSchema: z.object({}),
    execute: async () => ({ kind: "success" as const, data: {} }),
  });
  mocks.panel.mockResolvedValue({ id: "P", manifest: { state: {}, members: { action: { target: { projectionId: "action" } } } } });
  mocks.projection.mockResolvedValue({ id: "action", binding: { kind: "PlatformOperation", id: handlerRef }, inputs: {} });
  await expect(prepareLiveAction({
    intentId: uuid(93), applicationId: "A", useId: "tasks", operationId: "action.setPassword",
    call: { target: null, input: { password: "agent-fixture-secret" } },
  })).rejects.toMatchObject({ code: "PANEL_SECRET_HUMAN_INPUT_REQUIRED" });
  expect(intents.size).toBe(0);
});

it.each(["none", "draft"] as const)("restricts agent reads with target source %s to human-entered draft secrets", async source => {
  const handlerRef = "test.previewSecret";
  const execute = vi.fn(async () => ({ kind: "json" as const, value: "preview" }));
  mockRegisteredOperation({
    handlerRef, labelKey: "test.perform", binding: { kind: "PlatformOperation", id: handlerRef },
    kind: "action", effect: "read", batch: false, target: { source },
    targetSchema: z.undefined().optional().or(z.object({ kind: z.literal("draft") })),
    inputSchema: runtimeJsonObjectSchema,
    describeInputSchema: () => ({
      properties: {
        draft: { properties: { password: { format: "password" } } },
        parameters: { properties: { pin: { "x-secret": true } } },
      },
    }),
    secretFields: ["/parameters/token"],
    resultSchema: panelReadOperationResultSchema, execute,
  });
  const panel = await mocks.panel();
  panel.manifest.members.run = {
    target: { projectionId: "preview" },
    readOperationInputs: { previewSecret: { draft: { slot: "form" }, parameters: { fields: {} } } },
  };
  mocks.projection.mockResolvedValue({ id: "preview", binding: { kind: "PlatformOperation", id: handlerRef }, inputs: {} });
  const request = { applicationId: "A", useId: "tasks", operationId: "run.previewSecret" };
  const agentRun = { runId: current.id, sessionId: current.sessionId, toolCallId: "preview" };
  const draft = { password: "human-fixture-secret" };
  const unsafe = { ...request, call: { input: { draft, parameters: { token: "agent-fixture-secret" } } } };

  await expect(readPanelOperation(owner, credentials, { ...unsafe, agentRun })).rejects.toMatchObject({
    code: "PANEL_SECRET_HUMAN_INPUT_REQUIRED",
  });
  const schemaMarked = { ...request, call: { input: { draft, parameters: { pin: "agent-fixture-pin" } } } };
  await expect(readPanelOperation(owner, credentials, { ...schemaMarked, agentRun })).rejects.toMatchObject({
    code: "PANEL_SECRET_HUMAN_INPUT_REQUIRED",
  });
  const draftOnly = { ...request, call: { input: { draft, parameters: {} } }, agentRun };
  if (source === "draft") {
    await expect(readPanelOperation(owner, credentials, draftOnly)).resolves.toMatchObject({ kind: "json" });
    expect(execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: draftOnly.call.input }));
  } else {
    await expect(readPanelOperation(owner, credentials, draftOnly)).rejects.toMatchObject({
      code: "PANEL_SECRET_HUMAN_INPUT_REQUIRED",
    });
    expect(execute).not.toHaveBeenCalled();
  }
  await expect(readPanelOperation(owner, credentials, { ...unsafe, agentRun: { ...agentRun, sessionId: uuid(99) } }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(readPanelOperation(owner, credentials, unsafe)).resolves.toMatchObject({ kind: "json" });
});

it("asks the owner for availability of a targetless write operation", async () => {
  const handlerRef = "test.create";
  const reason = { reason: "Creation is closed" };
  const unavailable = vi.fn(async () => reason);
  mockRegisteredOperation({
    handlerRef, labelKey: "test.perform", binding: { kind: "PlatformOperation", id: handlerRef },
    kind: "action", effect: "write", batch: false, unavailable,
    targetSchema: z.null(), inputSchema: z.object({}), resultSchema: z.object({}),
    execute: async () => ({ kind: "success" as const, data: {} }),
  });
  const panel = await mocks.panel();
  const member = { target: { projectionId: "create" } };
  mocks.projection.mockResolvedValue({ id: "create", binding: { kind: "PlatformOperation", id: handlerRef }, inputs: {} });
  panel.manifest.members.create = member;
  const { projection } = await requireDirectPanelMember(owner, credentials, panel, "create");
  const descriptors = await readAdmittedProjectionOperations({ owner, credentials }, {
    panel, member, projection, slot: "create",
  }, {});
  expect(unavailable).toHaveBeenCalledWith(expect.anything(), null);
  expect(descriptors.create?.unavailable).toEqual(reason);
});

it("describes mixed scoped Action buttons in one owner item and displays caller scope refusals", async () => {
  const handlerRef = "test.create";
  const unavailable = vi.fn(async () => ({ reason: "Creation is closed" }));
  mockRegisteredOperation({
    handlerRef, labelKey: "test.perform", binding: { kind: "PlatformOperation", id: handlerRef },
    kind: "action", effect: "write", batch: false, unavailable,
    targetSchema: z.null(), inputSchema: z.object({}), resultSchema: z.object({}),
    execute: async () => ({ kind: "success" as const, data: {} }),
  });
  const panel = await mocks.panel();
  const member = { target: { projectionId: "action-buttons" } };
  panel.manifest.members.buttons = member;
  const first = { className: "Order", primaryKey: "O1" };
  const second = { className: "Order", primaryKey: "O2" };
  const action = (id: string, object: typeof first) => ({
    operation: { kind: "Action", id }, target: { literal: object },
  });
  mocks.projection.mockResolvedValue({
    id: "action-buttons", inputs: {}, binding: { kind: "Action", id: "primary" }, operations: {
      approve: action("primary", first),
      create: { operation: { kind: "PlatformOperation", id: handlerRef } },
      denied: action("secondary", second),
      hidden: action("hidden", second),
    },
  });
  const { projection } = await requireDirectPanelMember(owner, credentials, panel, "buttons");
  const actor = { owner, credentials: { apiKey: "executor-key", locale: "en" } };
  const retrievalScopeId = uuid(39);
  const path = {
    source: { kind: "registered" as const, applicationId: "A", useId: "tasks" },
    registration: { panelId: "P", framePanelId: "F", inputs: undefined }, uses: [],
  };
  mocks.backend.mockImplementationOnce(async (_method, url, body, options) => {
    expect(new URL(url).pathname).toBe("/internal/workbench-panel-reads");
    expect(options.headers).toMatchObject({
      "X-API-Key": "executor-key", "X-Ontomato-Retrieval-Caller-Id": retrievalScopeId,
    });
    expect(body.reads).toEqual([{ ...path, call: {
      type: "platform:Action", name: "executionDefinitions", parameters: {
        actions: [
          { primaryKey: "primary", object: first }, { primaryKey: "secondary", object: second }, { primaryKey: "hidden", object: second },
        ],
      },
    } }]);
    expect(body.reads[0]).not.toHaveProperty("visibleKinds");
    return { text: JSON.stringify({ viewer: owner, results: [{ status: "ready", payload: [
      { status: "ready", payload: {
        id: "primary", name: "Approve", codeHash: "hash", target: { className: "Order", keyParameter: "order_id" },
        function: { parameters: [{ name: "order_id", type: "TYPE_STRING" }] },
      } },
      { status: "forbidden", code: "ACTION_TARGET_OUT_OF_SCOPE", error: "超出本轮数据范围", payload: {
        id: "secondary", name: "Complete order", target: { className: "Order", keyParameter: "order_id" },
        function: { parameters: [{ name: "order_id", type: "TYPE_STRING" }] },
      } },
      { status: "forbidden", code: "ACTION_TARGET_OUT_OF_SCOPE", error: "Outside action permission" },
    ] }] }) };
  });

  const result = await readAdmittedProjectionOperations(actor, { panel, member, projection, slot: "buttons" }, {}, { path, retrievalScopeId });
  expect(result).toMatchObject({
    approve: { label: "Approve", handlerRef: "actions.execute" },
    create: { unavailable: { reason: "Creation is closed" } },
    denied: { label: "Complete order", handlerRef: "actions.execute", unavailable: { reason: "超出本轮数据范围" } },
  });
  expect(result.approve).not.toHaveProperty("unavailable");
  expect(Object.keys(result)).toEqual(["approve", "create", "denied"]);
  expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ executor: actor }), null);
  expect(mocks.backend).toHaveBeenCalledTimes(1);
});
