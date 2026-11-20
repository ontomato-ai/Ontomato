import { z } from "zod";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import * as serverOperations from "../server-operations";
import rawExamples from "../../../../../contracts/examples/platform-schedules.json";
import {platformTaskSchema,platformScheduleFormSchema} from "@ontomato/contracts/platform-schedules";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { isPanelHumanOperationIntent, type PanelOperationIntent } from "@ontomato/contracts/panel-agent";
import { APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE } from "@ontomato/contracts/panel-client-requests";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { panelReadOperationInputSchema, panelReadOperationResultSchema } from "@ontomato/contracts/panel-operations";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
const mocks = vi.hoisted(() => ({draft:vi.fn(), createDefinition:vi.fn(), projectDefinition:vi.fn(), assertPermission:vi.fn(),recordCreated:vi.fn(),query:vi.fn(),backend:vi.fn(),run:vi.fn(),session:vi.fn(),request:vi.fn(),resolve:vi.fn(),panel:vi.fn(),projection:vi.fn(),pages:vi.fn(),resolveMember:vi.fn(),loadedMember:vi.fn(),restore:vi.fn(),sessionActor:vi.fn(),notify:vi.fn()}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../assistant/service",()=>({assistantService:{pageDraft:mocks.draft,recordPageDraftCreated:mocks.recordCreated}}));
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
vi.mock("../../agent-host/presentation",()=>({publishObjectChanged:mocks.notify}));
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
  operatePanel as realOperatePanel, dispatchPanel, dispatchHumanPanelOperation, inspectPanelOperationImpact, ownPanelSettings,
  prepareHumanPanelOperation, projectPanelOperationIntent, readPanelOperation, readPanelOperationDescriptor,
} from "../operations";
import { panelOperationStore } from "../operation-store";
configureI18n({defaultLocale:"en",appTextLocale:"en",languageSwitchEnabled:false,packs:{en:{messages:en,...enLocaleMeta}}});
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner={domainId:"d",userId:"U"},credentials={token:"U-token",locale:"en"};
const operatePanel=(initiator:typeof owner,auth:typeof credentials,runId:string,input:Parameters<typeof realOperatePanel>[3])=>realOperatePanel(initiator,auth,runId,input,"Alice");
const session={providerId:"workbench",sessionId:uuid(1)},root={providerId:"ontology",sessionId:uuid(2)};
const skill={namespace:{kind:"domain" as const,domainId:"d"},name:"derived-panel"};
const use={id:"tasks",pageKey:"tasks",path:"/applications/A/tasks",panelId:"P",access:{kind:"domain-member"}};
let intents:Map<string,PanelOperationIntent>, automatic:boolean, current:RuntimeRun, human:Record<string,unknown>|null;
const action=()=>({intentId:uuid(5),applicationId:"A",useId:"tasks",operationId:"run.runNow",call:{target:{kind:"object" as const,objectType:"platform:ScheduledTask",primaryKey:uuid(9)},input:{}}});
const save=()=>({...action(),operationId:"form.save",call:{...action().call,input:{revision:4,values:{title:"draft"}}}});
function mockRegisteredOperation(handler: serverOperations.PanelServerOperation) {
 return vi.spyOn(serverOperations, "registeredPanelOperation").mockReturnValue({
   handler, declaration: serverOperations.operationDeclaration(handler),
   targetType: handler.effect === "write" ? handler.targetType : undefined,
 });
}
function agentQuestionId() {
 const intent = intents.get(uuid(5))!;
 if (isPanelHumanOperationIntent(intent)) throw new Error("Expected an agent intent");
 return intent.questionId;
}
beforeEach(()=>{
 vi.resetAllMocks();intents=new Map();automatic=false;human=null;
 current={id:uuid(3),sessionId:session.sessionId,status:"running",executionUserId:"V",channel:{agent:{providerId:"workbench",agentId:"agent"},actor:{id:uuid(4),domainId:"d"},authority:{classNames:[],executionKind:"live"},root:{session:root,runId:uuid(10)},requestedBy:null,userRecipient:{session:root,actor:{id:uuid(4),domainId:"d"}}},resolvedSkills:[{skill,digest:"sha256:" + "a".repeat(64)}]} as unknown as RuntimeRun;
 mocks.run.mockImplementation(async()=>({run:current}));
 mocks.resolve.mockImplementation(async()=>({credentials:{apiKey:"V-key"}}));
 mocks.backend.mockImplementation(async(_name:string,url:string,options:{headers:object})=>{
   expect(options.headers).toMatchObject({tk:"U-token"});
   if (url.includes("/platform/agent-execution/options")) {
     const id=new URL(url).searchParams.get("selected");
     return {text:JSON.stringify({canSetExecutionUser:false,users:[],selected:{id,name:id==="U"?"Alice":"Victor",available:true}})};
   }
   return {text:JSON.stringify({success:true,data:{applicationId:"A",entry:{path:"/panels/A",renderer:"panels"},panelUses:[use]}})};
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
     events: {},
   },
 });
 mocks.projection.mockImplementation(async(_o:unknown,c:unknown,id:string)=>{expect(c).toBe(credentials);return {id,name:"Run now",componentId:id,binding:id==="run"?{kind:"PlatformOperation",id:"schedules.runNow"}:{kind:"PlatformObjectType",id:"platform:ScheduledTask"},inputs:{task:{kind:"object",objectType:"platform:ScheduledTask"}}};});
 mocks.restore.mockResolvedValue({owner});
 mocks.session.mockImplementation(async()=>({messages:human?[{message:human}]:[]}));
 mocks.request.mockImplementation(async(path:string,_method:string,body:{source:unknown})=>path==="/v1/channel/user-questions"?{questionId:agentQuestionId(),source:body.source,recipient:{session:root,actor:{id:uuid(4),domainId:"d"}}}:{questionId:agentQuestionId(),answerId:uuid(11),source:{kind:"user"},respondent:{id:uuid(12),domainId:"d"},recipientSession:root,selectedOption:1,text:"Execute"});
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
   expect(new Headers(init.headers).get("X-API-Key")).toBe("V-key");
   expect(new Headers(init.headers).get("tk")).toBeNull();
   expect(new Headers(init.headers).get("X-Ontomato-Retrieval-Caller-Id")).toBe(current.id);
   return Response.json({error:{code:"PERMISSION_DENIED",message:"V cannot use U's task"},correlationId:"test"},{status:403});
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const ownerWrites=()=>vi.mocked(fetch).mock.calls.filter(([,init])=>["POST","PUT"].includes(init?.method ?? "GET"));
function answer(source:object={kind:"user"}) {human={role:"notification",kind:"agent-answer",source,replyTo:agentQuestionId(),answerId:uuid(11)};}
it("returns immediately and ignores the parent's endorsement; a later run uses V once after a genuine U selection",async()=>{
 const request=action();const response=await operatePanel(owner,credentials,current.id,request);
 expect(response.kind).toBe("confirmation-required");expect(ownerWrites()).toHaveLength(0);
 const question=mocks.request.mock.calls[0][2];
 expect(question.message).toBe('Run “Run now” on “Inventory summary” as Victor?');
 expect(question.message).not.toContain(request.intentId);
 expect(question.options).toEqual([{label:"Do not execute",isDefault:true},{label:"Execute this operation"}]);
 answer({session:root,runId:uuid(10)});
 expect(await dispatchPanel(owner,credentials,current.id,request.intentId)).toMatchObject({kind:"not-dispatched",code:"CONFIRMATION_REQUIRED"});
 answer();current={...current,id:uuid(6)};
 const results=await Promise.all([dispatchPanel(owner,credentials,current.id,request.intentId),dispatchPanel(owner,credentials,current.id,request.intentId)]);
 expect(results.some(result=>result.kind==="dispatched")).toBe(true);
 expect(ownerWrites()).toHaveLength(1);
 expect(intents.get(request.intentId)).toMatchObject({dispatched:true,outcome:{kind:"refusal",code:"PERMISSION_DENIED"},source:{runId:uuid(3)}});
 expect(mocks.notify).not.toHaveBeenCalled();
 await operatePanel(owner,credentials,current.id,request);
 await dispatchPanel(owner,credentials,current.id,request.intentId);
 expect(ownerWrites()).toHaveLength(1);
 expect(mocks.resolve.mock.calls.at(-1)?.[0].execution_user_id).toBe("V");
});
it("requires a new intent for changed parameters, target, questioning session or executor",async()=>{
 const input=action();await operatePanel(owner,credentials,current.id,input);
 await expect(operatePanel(owner,credentials,current.id,{...input,call:{...input.call,input:{forged:true}}})).rejects.toBeDefined();
 await expect(operatePanel(owner,credentials,current.id,{...input,call:{...input.call,target:{...input.call.target,primaryKey:uuid(8)}}})).rejects.toMatchObject({code:"INTENT_CHANGED"});
 current={...current,executionUserId:"W"};
 await expect(dispatchPanel(owner,credentials,current.id,input.intentId)).rejects.toMatchObject({code:"INTENT_CHANGED"});
 current={...current,sessionId:uuid(7)};
 await expect(dispatchPanel(owner,credentials,current.id,input.intentId)).rejects.toMatchObject({code:"FORBIDDEN"});
});
it.each([undefined,0])("does not approve free text or the default selectedOption %s",async selectedOption=>{
 await operatePanel(owner,credentials,current.id,action());answer();
 mocks.request.mockResolvedValue({questionId:agentQuestionId(),answerId:uuid(11),source:{kind:"user"},respondent:{id:uuid(12),domainId:"d"},recipientSession:root,selectedOption:selectedOption??null,text:"I approve"});
 expect(await dispatchPanel(owner,credentials,current.id,uuid(5))).toMatchObject({code:"NOT_APPROVED"});
 expect(ownerWrites()).toHaveLength(0);
});
it("requires the actual initiating user, not another human receipt",async()=>{
 await operatePanel(owner,credentials,current.id,action());answer();mocks.restore.mockResolvedValue({owner:{...owner,userId:"other"}});
 expect(await dispatchPanel(owner,credentials,current.id,uuid(5))).toMatchObject({code:"NOT_APPROVED"});expect(ownerWrites()).toHaveLength(0);
});
it("default form save is an unsaved draft that dispatch cannot redeem",async()=>{
 expect(await operatePanel(owner,credentials,current.id,save())).toMatchObject({kind:"draft",draft:{operation:"platform:ScheduledTask.save",form:{title:"draft"}}});
 expect(await dispatchPanel(owner,credentials,current.id,uuid(5))).toMatchObject({code:"DRAFT_REQUIRES_SAVE"});expect(ownerWrites()).toHaveLength(0);expect(mocks.request).not.toHaveBeenCalled();
});
it.each(["save","runNow"])("automatic %s calls the same owner client, preserving the form revision",async operation=>{
 automatic=true;
 const writes:NonNullable<Parameters<typeof fetch>[1]>[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   expect(new Headers(init.headers).get("X-API-Key")).toBe("V-key");
   if(init.method==="PUT"){writes.push(init);return Response.json({error:{code:"REVISION_CONFLICT",message:"The task changed"},correlationId:"test"},{status:409});}
   if(url.endsWith("/runs"))return Response.json({error:{code:"PERMISSION_DENIED",message:"Denied"},correlationId:"test"},{status:403});
   if(url.endsWith("/form"))return Response.json(platformScheduleFormSchema.parse(rawExamples.forms.find(form=>form.name==="governance-ready")!.response));
   // The actual service contracts are supplied by the fixture for the read and dynamic form below.
   return Response.json(task);
 }));
 const response=await operatePanel(owner,credentials,current.id,operation==="save"?save():action());
 expect(response).toMatchObject({
   kind: "dispatched", outcome: { kind: "refusal", code: operation === "save" ? "REVISION_CONFLICT" : "PERMISSION_DENIED" },
 });
 expect(mocks.request).not.toHaveBeenCalled();
 if(operation==="save")expect(JSON.parse(String(writes[0]?.body))).toMatchObject({revision:4});
});
const task=platformTaskSchema.parse({...rawExamples.creates.find(task=>task.name==="governance-instruction")!.response,id:uuid(9),revision:9});
it("session settings compare the authenticated owner even when a session is readable",async()=>{
 mocks.sessionActor.mockResolvedValue({id:uuid(4),domainId:"d"});mocks.restore.mockResolvedValue({owner:{...owner,userId:"someone-else"}});
 await expect(ownPanelSettings(owner,root)).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await panelOperationStore.settings(owner,root)).confirmBeforeExecute).toBe(true);
});
it("declines unsupported business/test authority before an owner write",async()=>{
 current.channel!.authority.executionKind="build-test";
 await expect(operatePanel(owner,credentials,current.id,action())).rejects.toMatchObject({code:"BUILD_TEST_UNSUPPORTED"});expect(ownerWrites()).toHaveLength(0);
});

it.each(["save","runNow"])("automatic %s succeeds through the server owner interface without a human question",async operation=>{
 automatic=true;
 vi.stubGlobal("fetch",vi.fn(async(url:string,init:NonNullable<Parameters<typeof fetch>[1]>)=>{
   expect(new Headers(init.headers).get("X-API-Key")).toBe("V-key");
   if(init.method==="PUT") {const input=JSON.parse(String(init.body));expect(input.revision).toBe(9);return Response.json({...task,content:input.content,revision:10});}
   if(url.endsWith("/runs"))return Response.json({...rawExamples.runs.find(run=>run.name==="agents-running")!.response,taskId:task.id});
   if(url.endsWith("/form"))return Response.json(rawExamples.forms.find(form=>form.name==="governance-ready")!.response);
   return Response.json(task);
 }));
 const input=operation==="save"?{...save(),call:{...save().call,input:{values:task.content,revision:9}}}:action();
 expect(await operatePanel(owner,credentials,current.id,input)).toMatchObject({kind:"dispatched",outcome:{kind:"success"}});
 const target = { objectType: "platform:ScheduledTask", primaryKey: uuid(9) };
 expect(mocks.notify.mock.calls).toEqual([[{ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
   target, affected: { objects: [target], objectTypes: [target.objectType] },
 }]]);
 expect(mocks.request).not.toHaveBeenCalled();
});
it("notifies the initiator once after the later run dispatches an approved action",async()=>{
 const input=action();
 await operatePanel(owner,credentials,current.id,input);
 expect(mocks.notify).not.toHaveBeenCalled();
 answer();
 current={...current,id:uuid(6)};
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({...rawExamples.runs.find(run=>run.name==="agents-running")!.response,taskId:task.id})));
 expect(await dispatchPanel(owner,credentials,current.id,input.intentId)).toMatchObject({kind:"dispatched",outcome:{kind:"success"}});
 await dispatchPanel(owner,credentials,current.id,input.intentId);
 const target = { objectType: "platform:ScheduledTask", primaryKey: uuid(9) };
 expect(mocks.notify.mock.calls).toEqual([[{ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
   target, affected: { objects: [target], objectTypes: [target.objectType] },
 }]]);
});
it("rejects a declaration whose target type does not match its platform operation",async()=>{
 const panel=await mocks.panel();panel.manifest.state.task.type.objectType="customer:Account";
 await expect(operatePanel(owner,credentials,current.id,action())).rejects.toMatchObject({
   status: 422, code: "PANEL_OPERATION_TARGET_MISMATCH",
   message: expect.stringContaining("connect input 'task' to an object of type 'platform:ScheduledTask'"),
 });
 expect(ownerWrites()).toHaveLength(0);
});

it("uses the initiator's display name in self mode",async()=>{
 current={...current,executionUserId:null};
 await operatePanel(owner,credentials,current.id,action());
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
 await operatePanel(owner,credentials,current.id,action());
 expect(read).toHaveBeenCalledTimes(1);
 expect(mocks.request.mock.calls[0][2].message).toBe(`Run “Run now” on “${uuid(9)}” as Victor?`);
});
it("preserves a failed target read instead of hiding an owner outage behind an ID",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:{code:"DEPENDENCY_UNAVAILABLE",message:"Owner unavailable"},correlationId:"test"},{status:503})));
 await expect(operatePanel(owner,credentials,current.id,action())).rejects.toMatchObject({status:503});
 expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects an unregistered server handler before any question or dispatch",async()=>{
 mocks.projection.mockResolvedValue({id:"run",name:"Other",componentId:"run",binding:{kind:"PlatformOperation",id:"not.registered"},inputs:{task:{kind:"object",objectType:"platform:ScheduledTask"}}});
 await expect(operatePanel(owner,credentials,current.id,{...action(),operationId:"run.registered"})).rejects.toMatchObject({status:422,code:"OPERATION_UNAVAILABLE"});
 expect(mocks.request).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it("dispatches through the registered owner without a resource-specific coordinator branch",async()=>{
 automatic=true;
 const handler={handlerRef:"test.perform",kind:"action" as const,binding:{kind:"PlatformOperation" as const,id:"test.perform"},effect:"write" as const,batch:false as const,targetInput:"task",targetType:"test:Thing",
   targetSchema:z.object({kind:z.literal("object"),objectType:z.literal("test:Thing"),primaryKey:z.string()}),inputSchema:z.object({value:z.number()}),resultSchema:z.object({done:z.boolean()}),
   targetLabel:vi.fn(),execute:vi.fn(async()=>({kind:"success" as const,data:{done:true}}))};
 mockRegisteredOperation(handler);
 const panel=await mocks.panel();panel.manifest.state.task.type.objectType="test:Thing";
 mocks.projection.mockResolvedValue({id:"run",name:"Perform",componentId:"run",binding:handler.binding,inputs:{task:{kind:"object",objectType:handler.targetType}}});
 const input={...action(),operationId:"run.perform",call:{target:{kind:"object" as const,objectType:handler.targetType,primaryKey:"opaque-key"},input:{value:7}}};
 expect(await operatePanel(owner,credentials,current.id,input)).toMatchObject({kind:"dispatched",outcome:{kind:"success",data:{done:true}}});
 expect(handler.execute).toHaveBeenCalledWith(expect.objectContaining({request:expect.any(Function)}),input.call.target,input.call.input,input.intentId);
 expect(fetch).not.toHaveBeenCalled();
 expect(mocks.notify).not.toHaveBeenCalled();
});

it("reuses the original creation artifact as the initiator and saves as the executor", async () => {
  automatic = true;
  const objectType = "platform:AgentDefinition";
  const values = { name: "Assistant", icon: "legacy", description: "", enabled: false,
    systemPrompt: "", skills: [{ name: "report", namespace: { kind: "domain", domainId: owner.domainId } }],
    classNames: ["Customer"], modelSelection: { modelId: null }, enabledMcpServiceIds: [] };
  const link = { sessionId: session.sessionId, runId: current.id, path: "outputs/drafts/new.page-draft.json" };
  const form = { pageKey: use.pageKey, operation: "agent.create", target: {},
    form: { ...values, skills: [{ name: "report", namespace: { kind: "domain" } }] } };
  mocks.projection.mockResolvedValue({
    id: "form", name: "Agent form", componentId: "form", binding: { kind: "PlatformObjectType", id: objectType }, inputs: {},
  });
  mocks.draft.mockResolvedValue(form);
  const input = { ...save(), call: { target: { kind: "draft" as const }, input: { values }, draft: link } };
  const createdId = uuid(21);
  mocks.createDefinition.mockResolvedValue({
    definition: { ...values, id: createdId, executionUserId: null, sortOrder: 0 },
  });
  expect(await operatePanel(owner, credentials, current.id, input)).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
  expect(mocks.assertPermission).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "V-key" }), ["analysis-agent"]);
  expect(mocks.createDefinition).toHaveBeenCalledWith(input.intentId, values, { domainId: owner.domainId, userId: "V" },
    expect.objectContaining({ apiKey: "V-key" }), { credentials, view: { resolveSource: mocks.resolveMember } });
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.draft).toHaveBeenCalledWith(link.sessionId, link.runId, link.path, owner);
  expect(mocks.recordCreated).toHaveBeenCalledWith(link.sessionId, link.runId, link.path, createdId, owner);
  const target = { objectType, primaryKey: createdId };
  expect(mocks.notify).toHaveBeenCalledWith({ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
    target, affected: { objects: [target], objectTypes: [objectType] },
  });
  mocks.draft.mockResolvedValue({ ...form, created: { id: createdId } });
  await expect(operatePanel(owner, credentials, current.id, { ...input, intentId: uuid(22) }))
    .rejects.toMatchObject({ code: "PAGE_DRAFT_MISMATCH" });
  expect(mocks.createDefinition).toHaveBeenCalledTimes(1);

  const currentView = { resolveSource: mocks.resolveMember, revoked: true };
  mocks.pages.mockResolvedValueOnce(currentView);
  mocks.projectDefinition.mockImplementationOnce(definition => ({ ...definition, skills: [] }));
  expect(await dispatchPanel(owner, credentials, current.id, input.intentId)).toMatchObject({
    kind: "dispatched", outcome: { kind: "success", data: { id: createdId, skills: [] } },
  });
  expect(mocks.projectDefinition).toHaveBeenLastCalledWith(expect.objectContaining({ skills: values.skills }), currentView);
  expect(mocks.createDefinition).toHaveBeenCalledTimes(1);
});

it("asks by the entry's title and approves the whole entry as the executor", async () => {
  const key = uuid(9);
  const entry = { knowledgeID: key, knowledgeTitle: "Order rule", knowledgeText: "Orders need a customer", knowledgeTags: ["Business"], status: 0, creatorType: 1 };
  mocks.panel.mockResolvedValue({ id: "P", manifest: {
    state: { task: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } } },
    members: { run: { target: { projectionId: "run" }, inputs: { knowledge: { state: "task" } } } }, events: {},
  } });
  mocks.projection.mockResolvedValue({ id: "run", name: "Approve", componentId: "@ontomato/sdk:OperationButton",
    binding: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, inputs: { knowledge: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
    data: { describe: { source: { operation: APPROVE_KNOWLEDGE }, read: "describe", params: {} } },
  });
  // The label is read as the initiator; the dispatch's list read and the write go as the executor.
  const reads: Headers[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(init.headers);
    if (String(url).endsWith("/admin/getBussinessKnowledge")) {
      reads.push(headers);
      return Response.json({ success: true, data: { [key]: entry } });
    }
    expect(String(url).endsWith("/admin/editBussinessKnowledge")).toBe(true);
    expect(headers.get("X-API-Key")).toBe("V-key");
    expect(headers.get("tk")).toBeNull();
    // Approval rewrites the whole entry as the owner read it, with status 1.
    expect(JSON.parse(String(init.body))).toEqual({ ...entry, status: 1 });
    return Response.json({ success: true });
  }));
  const input = { ...action(), operationId: "run.approve", call: { target: { kind: "object" as const, objectType: BUSINESS_KNOWLEDGE, primaryKey: key }, input: {} } };
  const response = await operatePanel(owner, credentials, current.id, input);
  expect(response.kind).toBe("confirmation-required");
  expect(mocks.request.mock.calls[0][2].message).toBe('Run “Approve” on “Order rule” as Victor?');
  answer();
  current = { ...current, id: uuid(6) };
  expect(await dispatchPanel(owner, credentials, current.id, input.intentId)).toMatchObject({ kind: "dispatched", outcome: { kind: "success", data: {} } });
  expect(reads.map((headers) => [headers.get("tk"), headers.get("X-API-Key")])).toEqual([["U-token", null], [null, "V-key"]]);
  const target = { objectType: BUSINESS_KNOWLEDGE, primaryKey: key };
  expect(mocks.notify.mock.calls).toEqual([[{ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
    target, affected: { objects: [target], objectTypes: [BUSINESS_KNOWLEDGE] },
  }]]);
});

it("freezes the owner write description with a named target and a result schema", async () => {
  const input = action();
  await operatePanel(owner, credentials, current.id, input);
  expect(intents.get(input.intentId)).toMatchObject({
    call: input.call,
    operation: { effect: "write", target: { source: "input", input: "task" }, resultSchema: { type: "object" }, batch: false },
  });
});

it("expires an old pending confirmation without reading the owner or claiming its write", async () => {
  const input = action();
  await operatePanel(owner, credentials, current.id, input);
  const legacyOperation = {
    id: input.operationId, slot: "run", label: "Run now", kind: "action", handlerRef: "schedules.runNow",
    inputSchema: {}, target: { source: "state", state: "task" },
  };
  Object.assign(intents.get(input.intentId)!, { operation: legacyOperation });
  answer();
  expect(await dispatchPanel(owner, credentials, current.id, input.intentId)).toMatchObject({
    kind: "not-dispatched", code: "PANEL_CONFIRMATION_EXPIRED",
  });
  expect(intents.get(input.intentId)?.dispatched).toBe(false);
  expect(ownerWrites()).toHaveLength(0);
});

it("returns an old unknown outcome without making its intent claimable again", async () => {
  const input = action();
  await operatePanel(owner, credentials, current.id, input);
  const outcome = { kind: "unknown", message: "The owner did not return a result" };
  Object.assign(intents.get(input.intentId)!, { dispatched: true, outcome, operation: {
    id: input.operationId, slot: "run", label: "Run now", kind: "action", handlerRef: "schedules.runNow",
    inputSchema: {}, target: { source: "state", state: "task" },
  } });
  expect(await dispatchPanel(owner, credentials, current.id, input.intentId)).toMatchObject({ kind: "dispatched", outcome });
  expect(ownerWrites()).toHaveLength(0);
});

it("rejects a batch when the registered owner does not declare batch support", async () => {
  const { call, ...intent } = action();
  await expect(operatePanel(owner, credentials, current.id, { ...intent, calls: [call] }))
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
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(
    { error: { code, message: "Owner response" }, correlationId: "test" }, { status },
  )));
  expect(await operatePanel(owner, credentials, current.id, input)).toMatchObject({
    kind: "dispatched", outcome: { kind, code },
  });
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("inspects the actual agent delete using the initiator's definition read", async () => {
  const objectType = "platform:AgentDefinition", primaryKey = uuid(9);
  const panel = await mocks.panel();
  panel.manifest.state.task.type.objectType = objectType;
  panel.manifest.members.run.inputs = { agent: { state: "task" } };
  mocks.projection.mockResolvedValue({
    id: "run", componentId: "run", name: "Delete agent", binding: { kind: "PlatformOperation", id: "agents.delete" },
    inputs: { agent: { kind: "object", objectType } },
  });
  const read = vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    expect(url).toBe(`http://workbench.test/api/assistant/agent-definitions/${primaryKey}`);
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("tk")).toBe("U-token");
    return Response.json({
      id: primaryKey, name: "Inventory analyst", description: "", icon: null, enabled: true,
      executionUserId: null, modelSelection: { modelId: null }, skills: [], systemPrompt: "",
    });
  });
  vi.stubGlobal("fetch", read);
  const input = { applicationId: "A", useId: "tasks", operationId: "run.delete", call: {
    target: { kind: "object" as const, objectType, primaryKey }, input: {},
  } };
  expect(await inspectPanelOperationImpact(owner, credentials, input)).toEqual({
    summary: "This deletes the selected agent definition.",
    objects: [{ target: { objectType, primaryKey }, label: "Inventory analyst" }], total: 1,
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(intents.size).toBe(0);
});

function installBatchOwner() {
  const objectType = "platform:ScheduledTask";
  const binding = { kind: "PlatformOperation" as const, id: "test.batch" };
  const handler = {
    handlerRef: binding.id, kind: "action" as const, binding, effect: "write" as const, batch: true as const,
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
  expect(await operatePanel(owner, credentials, current.id, request)).toMatchObject({ kind: "confirmation-required" });
  expect(handler.inspectImpact.inspect).toHaveBeenCalledTimes(2);
  for (const [host, calls] of handler.inspectImpact.inspect.mock.calls) {
    expect(host).toMatchObject({ request: expect.any(Function) });
    expect(calls).toEqual(request.calls);
  }
  const question = mocks.request.mock.calls[0]![2];
  expect(question.message).toContain("Task 1");
  expect(question.message).toContain("(12)");
  expect(question.message).toContain(impact.summary);
  expect(intents.get(request.intentId)).toMatchObject({
    calls: request.calls, executionUserId: "V", operation: { batch: true, inspectImpact: { handlerRef: "test.batch.impact" } },
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
  await operatePanel(owner, credentials, current.id, request);
  answer();
  const results = await Promise.all([
    dispatchPanel(owner, credentials, current.id, request.intentId),
    dispatchPanel(owner, credentials, current.id, request.intentId),
  ]);
  expect(results).toContainEqual(expect.objectContaining({
    kind: "dispatched", outcome: { kind: "batch", items, affected: { objects: [first], objectTypes: [first.objectType] } },
  }));
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
  expect(handler.executeBatch).toHaveBeenCalledWith(expect.objectContaining({ request: expect.any(Function) }), request.calls, request.intentId);
  expect(handler.execute).not.toHaveBeenCalled();
  expect(mocks.notify.mock.calls).toEqual([[{ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
    target: null, affected: { objects: [first], objectTypes: [first.objectType] },
  }]]);
});

it("keeps an uncertain owner batch terminal and publishes no change", async () => {
  const { handler, request } = installBatchOwner();
  automatic = true;
  handler.executeBatch.mockRejectedValue(new Error("Connection lost after dispatch"));
  expect(await operatePanel(owner, credentials, current.id, request)).toMatchObject({
    kind: "dispatched", outcome: { kind: "unknown", message: "Connection lost after dispatch" },
  });
  await dispatchPanel(owner, credentials, current.id, request.intentId);
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("keeps a definitive atomic batch receipt without inventing per-item receipts", async () => {
  const { handler, request, impact } = installBatchOwner();
  automatic = true;
  const objects = impact.objects.map(item => item.target);
  const outcome = { kind: "success", data: { updated: objects.length }, affected: {
    objects, objectTypes: ["platform:ScheduledTask"],
  } };
  handler.executeBatch.mockResolvedValue(outcome);
  expect(await operatePanel(owner, credentials, current.id, request)).toMatchObject({ kind: "dispatched", outcome });
  expect(handler.executeBatch).toHaveBeenCalledTimes(1);
  expect(mocks.notify.mock.calls).toEqual([[{ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
    target: null, affected: outcome.affected,
  }]]);
});

it("publishes type-only changes from a successful single write", async () => {
  const { handler, request: { calls, ...request } } = installBatchOwner();
  automatic = true;
  const affected = { objects: [], objectTypes: ["platform:ScheduledTask"] };
  handler.execute.mockResolvedValue({ kind: "success", data: { done: true }, affected });
  await operatePanel(owner, credentials, current.id, { ...request, call: calls[0] });
  expect(mocks.notify.mock.calls).toEqual([[{ domainId: owner.domainId, initiator: owner.userId, rootSession: root,
    target: null, affected,
  }]]);
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
  await expect(dispatchPanel(owner, credentials, current.id, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const results = await Promise.all([dispatchHumanPanelOperation(owner, credentials, id), dispatchHumanPanelOperation(owner, credentials, id)]);
  expect(results).toContainEqual({ kind: "dispatched", intentId: id, outcome: {
    ...outcome, affected: { objects: impact.objects.map(item => item.target), objectTypes: [input.calls[0].target.objectType] },
  } });
  expect(handler.inspectImpact.inspect).toHaveBeenCalledTimes(1);
  expect(handler.executeBatch).toHaveBeenCalledOnce();
  expect(handler.execute).not.toHaveBeenCalled();
  expect(ownerWrite).toHaveBeenCalledOnce();
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("refuses to dispatch an agent intent from the human route", async () => {
  await operatePanel(owner, credentials, current.id, action());
  await expect(dispatchHumanPanelOperation(owner, credentials, action().intentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(ownerWrites()).toHaveLength(0);
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
    handlerRef: binding.id, effect: "read", kind: "action", batch: false, binding,
    target: { source: "draft", slot: "form" }, targetSchema: z.object({ kind: z.literal("draft") }).strict(),
    inputSchema: panelReadOperationInputSchema, resultSchema: panelReadOperationResultSchema, execute,
  });
  const label = "Preview the metric results";
  mocks.projection.mockResolvedValue({ id: "run", name: label, componentId: "run", binding, inputs: {} });
  const ownerRead = vi.fn(async (url, init) => {
    expect(url).toBe("http://owner.test/metricView/testExecute");
    expect(new Headers(init.headers).get("tk")).toBe("U-token");
    expect(new Headers(init.headers).get(BUILD_TEST_HEADER)).toBe("build-preview");
    expect(JSON.parse(init.body)).toEqual(input.call.input);
    return Response.json({});
  });
  vi.stubGlobal("fetch", ownerRead);
  expect(await readPanelOperationDescriptor(owner, credentials, input)).toMatchObject({
    label, effect: "read", batch: false, target: { source: "draft", slot: "form" },
  });
  expect(await readPanelOperation(owner, preview, input)).toEqual({ kind: "json", value: [{ amount: 3 }] });
  await expect(prepareHumanPanelOperation(owner, credentials, input)).rejects.toMatchObject({ code: "OPERATION_WRITE_REQUIRED" });
  expect(ownerRead).toHaveBeenCalledOnce();
  expect(intents.size).toBe(0);
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("resolves the actual panel-use member and refuses a run that only loaded a sibling", async () => {
  mocks.resolveMember.mockResolvedValue({ ...skill, name: "other-panel-in-the-same-group" });
  await expect(operatePanel(owner, credentials, current.id, action())).rejects.toMatchObject({ code: "FORBIDDEN" });
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

it("rechecks a customer action and reads the confirmation label as the initiator, then executes as the runner", async () => {
 const order = { kind: "object" as const, objectType: "Order", primaryKey: "o1" };
 const identity = { kind: "object", objectType: "Order" };
 mocks.panel.mockResolvedValue({ id: "P", manifest: {
   state: { order: { type: identity } },
   members: { run: { target: { projectionId: "approval" }, inputs: { target: { state: "order" } } } },
   events: {},
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
       expect(headers.get("X-API-Key")).toBe("V-key");
       expect(headers.get("tk")).toBeNull();
       ownerCalls.push("submit");
     }
     return Response.json({ success: true, data: {
       fields: [{ key: "key", label: "Key", required: false, defaultValue: null, help: null,
         type: "text", multiline: false, placeholder: null, maxLength: 200 }],
       values: { key: "o1" }, errors: [], parameters: submitted.values === undefined ? null : { key: "o1" },
     } });
   }
   expect(path).toBe("/action/execute");
   expect(headers.get("X-API-Key")).toBe("V-key");
   expect(headers.get("tk")).toBeNull();
   expect((init.body as FormData).get("param")).toBe(JSON.stringify({ key: "o1" }));
   ownerCalls.push("execute");
   return Response.json({ success: true, data: { result: "{}", affects: ["Order"] } });
 }));
 const input = { ...action(), operationId: "run.execute", call: { target: order, input: { values: {} } } };
 expect(await operatePanel(owner, credentials, current.id, input)).toMatchObject({ kind: "confirmation-required" });
 expect(JSON.stringify(mocks.request.mock.calls[0]?.[2])).toContain("Purchase order");
 expect(ownerCalls).toEqual(["definition", "open"]);
 answer();
 expect(await dispatchPanel(owner, credentials, current.id, input.intentId)).toMatchObject({
   kind: "dispatched", outcome: { kind: "success" },
 });
 expect(ownerCalls).toEqual(["definition", "open", "definition", "open", "submit", "execute"]);
});
