import express from 'express';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({restore:vi.fn(),run:vi.fn(),operate:vi.fn(),dispatch:vi.fn(),authoring:vi.fn()}));
vi.mock('../../../services/assistant/authoring',()=>({executeAuthoring:mocks.authoring}));
vi.mock('../../../services/product-panels/operations',()=>({operatePanel:mocks.operate,dispatchPanel:mocks.dispatch}));
vi.mock('../../../services/assistant/execution',()=>({credentialsForRun:mocks.restore,runForOwner:mocks.run}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({token:'test-callback-secret',callbackUrl:'http://workbench.test'})}}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
vi.mock('../../../utils/request-identity',async original=>({...await original<typeof import('../../../utils/request-identity')>(),requireDomainId:(req:{domainId:string})=>req.domainId}));
import {assistantExecutionRouter} from '../assistant-execution';
import {callbackCredential,unwrapCallbackCredential} from '../../../services/agent-runtime/callback-credential';
const run='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const nativeFetch=globalThis.fetch;
let server:Server,base:string;
beforeAll(async()=>{
 const app=express();app.use(express.json());app.use(unwrapCallbackCredential);
 app.use((req,_res,next)=>{Object.assign(req,{userId:'U',userName:'Alice',domainId:'domain',token:req.header('tk'),locale:'en'});next();});
 app.use('/api/assistant/executions',assistantExecutionRouter);
 app.use((error:Error&{status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.status(error.status??500).json({error:error.message});});
 server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
afterEach(()=>{vi.unstubAllGlobals();});
beforeEach(()=>{vi.clearAllMocks();mocks.run.mockResolvedValue({status:"running"});mocks.restore.mockResolvedValue({executionUserId:'V',credentials:{apiKey:'selected-user-key',locale:'en',headers:{'X-Ontomato-Retrieval-Caller-Id':run}}});});
function credential() {return callbackCredential({pathPrefix:`/api/assistant/executions/${run}/`,runId:run,expiresAt:Date.now()+60000,token:'initiator-token',apiKey:''}).value;}
async function call(path:string,extra:Record<string,string>={},method='POST',token=credential()) {
 return nativeFetch(base+`/api/assistant/executions/${run}/`+path,{method,headers:{'content-type':'application/json','X-Ontomato-Callback-Credential':token,'X-Ontomato-Run-Id':run,...extra},...(method==='GET'?{}:{body:'{}'})});
}
it('restores the initiator before resolving the executor and forwards only ordinary business authentication',async()=>{
 const upstream=vi.fn(async()=>Response.json({rows:[{count:3}]}));vi.stubGlobal('fetch',upstream);
 const response=await call('ontology/ontology/query/execute-dsl',{'X-Ontomato-Query-Service-Token':'model-forged-service-token'});
 expect(response.status).toBe(200);const body=await response.text();expect(body).not.toContain('selected-user-key');
 expect(mocks.restore).toHaveBeenCalledWith({userId:'U',domainId:'domain'},run,expect.objectContaining({token:'initiator-token'}));
 const [url,request]=upstream.mock.calls[0] as unknown as [string,NonNullable<Parameters<typeof fetch>[1]>];
 expect(url).toBe('http://ontology.test/ontology/query/execute-dsl');
 expect(request.headers).toMatchObject({'X-API-Key':'selected-user-key','X-Ontomato-Run-Id':run,'X-Ontomato-Retrieval-Caller-Id':run});
 expect(request.headers).not.toHaveProperty('X-Ontomato-Query-Service-Token');expect(request.redirect).toBe('error');
});
it.each([
 'ontology/ontology/ai/generation/gates',
 'ontology/ontology/ai/generation/platform/action/test',
 'ontology/action/save',
 'ontology/metricView/save',
 'ontology/action/generateFromNatureLanguage',
 'ontology/metricView/generateFromNatureLanguage',
 'ontology/ontology/retrievals/skill-runs','ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs/'+other,'ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs/'+other+'/content','ontology/ontology/retrievals/'+run+'/skill-runs/'+run+'/close','ontology/ontology/retrievals/'+run+'/retriever/cancel','ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs','ontology/platform/agent-channel/commands','ontology/internal/agent-execution/resolve','ontology/agent-principals/execution','ontology/https%3A%2F%2Fevil.test','workbench/internal/agent-channel/prepare'])('refuses an out-of-scope path %s before resolving any key',async path=>{
 const upstream=vi.fn();vi.stubGlobal('fetch',upstream);
 expect((await call(path)).status).toBe(403);expect(upstream).not.toHaveBeenCalled();expect(mocks.restore).not.toHaveBeenCalled();
});
it('keeps an existing query Grant separate from callback authentication',async()=>{
 const upstream=vi.fn(async()=>Response.json({result:'ok'}));vi.stubGlobal('fetch',upstream);
 expect((await call('ontology/ontology/ai/knowledge-governance/record/runs/'+run+'/actions/read_work_record',{tk:'oq.existing.grant'})).status).toBe(200);
 expect((upstream.mock.calls[0] as unknown as [string,NonNullable<Parameters<typeof fetch>[1]>])[1].headers).toMatchObject({tk:'oq.existing.grant'});
});
it('keeps path, run and expiry checks while accepting only GET and POST',async()=>{
 const upstream=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',upstream);
 expect((await call('workbench/api/assistant/agents',{},'PUT')).status).toBe(401);
 expect((await call('workbench/api/assistant/agents',{},'DELETE')).status).toBe(401);
 expect((await call('workbench/api/assistant/agents',{},'GET')).status).toBe(200);
 expect((await call('ontology/ontology/query/overview',{'X-Ontomato-Run-Id':other})).status).toBe(401);
 const expired=callbackCredential({pathPrefix:`/api/assistant/executions/${run}/`,runId:run,expiresAt:Date.now()-1,token:'initiator-token',apiKey:''}).value;
 expect((await call('ontology/ontology/query/overview',{},'GET',expired)).status).toBe(401);
});

it('does not restore V when reading governance records as U',async()=>{
 mocks.restore.mockRejectedValue(new Error('V is invalid'));
 const upstream=vi.fn(async()=>Response.json({work:'owned by U'}));vi.stubGlobal('fetch',upstream);
 expect((await call('ontology/ontology/ai/knowledge-governance/record/runs/'+run+'/actions/read_work_record',{tk:'oq.existing.grant'})).status).toBe(200);
 expect(mocks.restore).not.toHaveBeenCalled();
});

it('does not accept an upstream path or headers on the fixed retrieval business entrance',async()=>{
 const upstream=vi.fn();vi.stubGlobal('fetch',upstream);
 const response=await nativeFetch(base+`/api/assistant/executions/${run}/retrieval`,{method:'POST',headers:{'content-type':'application/json','X-Ontomato-Callback-Credential':credential(),'X-Ontomato-Run-Id':run},body:JSON.stringify({operation:'begin',key:other,input:{question:'Question'},path:'/internal/agent-execution/resolve',headers:{'X-Ontomato-Query-Service-Token':'model'}})});
 expect(response.status).toBe(400);expect(upstream).not.toHaveBeenCalled();expect(mocks.restore).not.toHaveBeenCalled();
});

it.each([
  ["GET", "workbench/api/assistant/agent-definitions"],
  ["POST", "workbench/api/assistant/agent-definitions/form"],
  ["POST", "workbench/api/assistant/agent-definitions/validate"],
  ["GET", "workbench/api/assistant/agent-skills"],
  ["GET", "workbench/api/mcp/services/names"],
  ["GET", "ontology/model-options"],
  ["GET", "ontology/platform/agent-execution/options?selected=worker"],
  ["POST", "ontology/admin/getMetas"],
])("uses the executor for %s %s", async (method, path) => {
 const upstream = vi.fn(async (_url: string, _request: NonNullable<Parameters<typeof fetch>[1]>) => Response.json({}));
 vi.stubGlobal("fetch", upstream);
 expect((await call(path, { tk: "oq.business.grant" }, method)).status).toBe(200);
 expect(upstream.mock.calls[0]?.[1].headers).toMatchObject({"X-API-Key":"selected-user-key"});
 expect(upstream.mock.calls[0]?.[1].headers).not.toHaveProperty("tk");
});

it.each([
  "workbench/api/assistant/agent-definitions",
  "workbench/api/assistant/diagnosis-model",
  "workbench/api/mcp/services/names",
  "ontology/model-options",
  "ontology/platform/agent-execution/options",
])("rejects the unlisted POST %s", async path => {
 const upstream = vi.fn();
 vi.stubGlobal("fetch", upstream);
 expect((await call(path)).status).toBe(403);
 expect(upstream).not.toHaveBeenCalled();
});

it("lets Java restore V for governance business Grants without a Node key exchange",async()=>{
 mocks.restore.mockRejectedValue(new Error('V lookup must stay in Java'));
 const upstream=vi.fn(async()=>Response.json({items:[]}));vi.stubGlobal('fetch',upstream);
 expect((await call('ontology/ontology/ai/knowledge-governance/record/runs/'+run+'/actions/read_knowledge',{tk:'oq.business.grant'})).status).toBe(200);
 expect(mocks.restore).not.toHaveBeenCalled();
 expect((upstream.mock.calls[0] as unknown as [string,NonNullable<Parameters<typeof fetch>[1]>])[1].headers).toMatchObject({tk:'oq.business.grant'});
});
it("the platform knowledge page read outside the governance Grant uses V",async()=>{
 const upstream=vi.fn(async()=>Response.json({success:true,data:{}}));vi.stubGlobal('fetch',upstream);
 expect((await call('ontology/admin/getBussinessKnowledge')).status).toBe(200);
 expect((upstream.mock.calls[0] as unknown as [string,NonNullable<Parameters<typeof fetch>[1]>])[1].headers).toMatchObject({'X-API-Key':'selected-user-key'});
});

it.each([
  ["GET", "/platform/scheduled-tasks"],
  ["GET", `/platform/scheduled-tasks/${other}`],
  ["POST", "/platform/scheduled-tasks/applications/agents/form"],
  ["POST", "/ontology/query/metrics/describe"],
  ["POST", "/metricView/execute"],
])("forwards %s %s with the executor credential", async (method, path) => {
  const upstream = vi.fn(async (_url: string, _request?: Parameters<typeof fetch>[1]) => Response.json({}));
  vi.stubGlobal("fetch", upstream);
  const response = await call("ontology" + path, { tk: "oq.existing.grant" }, method);
  expect(response.status).toBe(200);
  expect(mocks.restore).toHaveBeenCalledWith({ userId: "U", domainId: "domain" }, run,
    expect.objectContaining({ token: "initiator-token" }));
  const [url, request] = upstream.mock.calls[0]!;
  expect(url).toBe("http://ontology.test" + path);
  expect(request).toMatchObject({ method, headers: { "X-API-Key": "selected-user-key" } });
  expect(request?.headers).not.toHaveProperty("tk");
});

it.each([
  ["POST", "/platform/scheduled-tasks"],
  ["POST", `/platform/scheduled-tasks/${other}`],
  ["GET", "/platform/scheduled-tasks/applications/agents/form"],
  ["POST", `/platform/scheduled-tasks/${other}/runs`],
  ["POST", `/platform/scheduled-tasks/${other}/enabled`],
  ["POST", "/platform/scheduled-tasks/applications/a%2520b/form"],
  ["POST", "/platform/scheduled-tasks/applications/%61gents/form"],
  ["POST", "/platform/scheduled-tasks/applications/%2e%2e%2fform"],
])("forbids %s %s before resolving the executor", async (method, path) => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect((await call("ontology" + path, {}, method)).status).toBe(403);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});

it.each(["PUT", "DELETE"])("rejects %s for a task at the existing callback credential boundary", async method => {
  expect((await call(`ontology/platform/scheduled-tasks/${other}`, {}, method)).status).toBe(401);
  expect(mocks.restore).not.toHaveBeenCalled();
});

it.each([
  ["GET", "product-projections/chart-sources?dashboardId=board&cardId=card", 200],
  ["GET", "product-projections/projection/chart-source", 200],
  ["POST", "product-projections/chart-sources", 403],
  ["PUT", "product-projections/projection/chart-source", 401],
])("only proxies the declared chart read pairs, %s %s", async (method, path, status) => {
  const upstream = vi.fn(async (_url: string) => Response.json({}));
  vi.stubGlobal("fetch", upstream);
  expect((await call("workbench/api/" + path, {}, method)).status).toBe(status);
  if (status === 200) expect(upstream).toHaveBeenCalledWith("http://workbench.test/api/" + path, expect.anything());
  else expect(upstream).not.toHaveBeenCalled();
});

it("validates the fixed operation entrance and never accepts an approval or question ID from a tool",async()=>{
 const body={intentId:other,applicationId:"A",useId:"tasks",operationId:"run.runNow",call:{target:{kind:"object",objectType:"platform:ScheduledTask",primaryKey:other},input:{}}};
 const headers={'content-type':'application/json','X-Ontomato-Callback-Credential':credential(),'X-Ontomato-Run-Id':run};
 mocks.operate.mockResolvedValue({kind:"confirmation-required",intentId:other});
 const response=await nativeFetch(base+`/api/assistant/executions/${run}/panels/operate`,{method:"POST",headers,body:JSON.stringify(body)});
 expect(response.status).toBe(200);expect(mocks.operate).toHaveBeenCalledWith({userId:"U",domainId:"domain"},expect.objectContaining({token:"initiator-token"}),run,body,"Alice");
 mocks.operate.mockClear();
 for(const forged of [{...body,questionId:other},{...body,approved:true}]) {
   expect((await nativeFetch(base+`/api/assistant/executions/${run}/panels/operate`,{method:"POST",headers,body:JSON.stringify(forged)})).status).toBe(400);
 }
 expect(mocks.operate).not.toHaveBeenCalled();
});

it("accepts author parameters only through the registered method and the run's callback", async () => {
 const context={ontology:[],knowledge:[],helpers:{markdown:""}};
 mocks.authoring.mockResolvedValue(context);
 expect((await call("authoring/metric-view/context",{},"GET")).status).toBe(200);
 expect(mocks.authoring).toHaveBeenCalledWith({userId:"U",domainId:"domain"},expect.objectContaining({token:"initiator-token"}),
   run,"metric-view","context",{});
 mocks.authoring.mockClear();
 expect((await call("authoring/metric-view/context",{},"POST")).status).toBeGreaterThanOrEqual(400);
 expect((await call("authoring/action/context",{},"GET","")).status).toBe(403);
 expect(mocks.authoring).not.toHaveBeenCalled();
});
