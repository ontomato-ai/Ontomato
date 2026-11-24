import express from 'express';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({restore:vi.fn(),run:vi.fn(),ownedRun:vi.fn(),authoring:vi.fn(),adopt:vi.fn()}));
vi.mock('../../../services/assistant/authoring',()=>({executeAuthoring:mocks.authoring,adoptAppBuilderDefinition:mocks.adopt}));
vi.mock('../../../core/skills/registry/manager',()=>({skillRegistryManager:{}}));
vi.mock('../../../services/assistant/execution',()=>({credentialsForRun:mocks.restore,runForOwner:mocks.run,ownedRun:mocks.ownedRun}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({token:'test-callback-secret',callbackUrl:'http://workbench.test',queryServiceToken:'host-service'}),queryBase:()=>'http://ontology.test',queryTimeout:()=>30000,queryKey:()=>''}}));
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
beforeEach(()=>{vi.clearAllMocks();mocks.run.mockResolvedValue({status:"running"});mocks.ownedRun.mockResolvedValue({turn:{id:run,retrieval_scope_id:run},run:{status:"running",channel:{agent:{agentId:"agent"}}}});mocks.restore.mockResolvedValue({executionUserId:'V',retrievalScopeId:run,credentials:{apiKey:'selected-user-key',locale:'en',headers:{'X-Ontomato-Retrieval-Caller-Id':run}}});});
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
 'ontology/action/generateFromNatureLanguage',
 'ontology/metricView/generateFromNatureLanguage',
 'ontology/ontology/retrievals/skill-runs','ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs/'+other,'ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs/'+other+'/content','ontology/ontology/retrievals/'+run+'/skill-runs/'+run+'/close','ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs','ontology/platform/agent-channel/commands','ontology/internal/agent-execution/resolve','ontology/agent-principals/execution','ontology/https%3A%2F%2Fevil.test','workbench/internal/agent-channel/prepare'])('refuses an out-of-scope path %s before resolving any key',async path=>{
 const upstream=vi.fn();vi.stubGlobal('fetch',upstream);
 expect((await call(path)).status).toBe(403);expect(upstream).not.toHaveBeenCalled();expect(mocks.restore).not.toHaveBeenCalled();
});
it('keeps an existing query Grant separate from callback authentication',async()=>{
 const upstream=vi.fn(async()=>Response.json({result:'ok'}));vi.stubGlobal('fetch',upstream);
 expect((await call('ontology/ontology/ai/knowledge-governance/record/runs/'+run+'/actions/read_work_record',{tk:'oq.existing.grant'})).status).toBe(200);
 expect((upstream.mock.calls[0] as unknown as [string,NonNullable<Parameters<typeof fetch>[1]>])[1].headers).toMatchObject({tk:'oq.existing.grant'});
});
it('keeps path, run, expiry and HTTP method checks at the callback boundary',async()=>{
 const upstream=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',upstream);
 expect((await call('workbench/api/assistant/agents',{},'PUT')).status).toBe(403);
 expect((await call('workbench/api/assistant/agents',{},'DELETE')).status).toBe(403);
 expect((await call('workbench/api/assistant/agents',{},'OPTIONS')).status).toBe(401);
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
  ["GET", `workbench/api/assistant/agent-definitions/${other}`],
  ["POST", "workbench/api/assistant/agent-definitions/form"],
  ["POST", "workbench/api/assistant/agent-definitions/validate"],
  ["GET", "workbench/api/assistant/agent-skills"],
])("uses the initiator's visibility for %s %s", async (method, path) => {
 const upstream = vi.fn(async (_url: string, _request: NonNullable<Parameters<typeof fetch>[1]>) => Response.json({}));
 vi.stubGlobal("fetch", upstream);
 mocks.run.mockResolvedValue({ status: "running", channel: {} });
 expect((await call(path, { tk: "oq.business.grant" }, method)).status).toBe(200);
 expect(upstream.mock.calls[0]?.[1].headers).toMatchObject({ tk: "initiator-token" });
 expect(upstream.mock.calls[0]?.[1].headers).not.toHaveProperty("X-API-Key");
 expect(mocks.run).toHaveBeenCalledWith({ userId: "U", domainId: "domain" }, run);
 expect(mocks.restore).not.toHaveBeenCalled();
});

it.each([
  "workbench/api/assistant/agent-skills",
  "workbench/api/platform-ontology/counts",
])("keeps the active-run requirement on %s", async path => {
 const upstream = vi.fn();
 vi.stubGlobal("fetch", upstream);
 mocks.run.mockResolvedValue({ status: "stopped", channel: {} });
 expect((await call(path, {}, "GET")).status).toBe(409);
 expect(upstream).not.toHaveBeenCalled();
 expect(mocks.restore).not.toHaveBeenCalled();
});

it.each([
  ["GET", "workbench/api/mcp/services/names"],
  ["GET", "ontology/model-options"],
  ["GET", "ontology/platform/agent-execution/options?selected=worker"],
  ["POST", "ontology/admin/getMetas"],
  ["POST", "ontology/metricView/queryList"],
  ["POST", "ontology/metricView/queryById"],
  ["POST", "ontology/metricView/form"],
  ["POST", "ontology/function/queryList"],
  ["POST", "ontology/function/queryById"],
  ["POST", "ontology/function/form"],
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

it.each([
  "/api/skills",
  "/api/skills/reporting/references",
  "/api/skills/reporting/files",
  "/api/skills/reporting/file?path=references%2Freadme.md",
])("forwards the declared skill read %s with the initiator credential", async path => {
 const upstream = vi.fn(async (_url: string, _request: NonNullable<Parameters<typeof fetch>[1]>) => Response.json({}));
 vi.stubGlobal("fetch", upstream);
 mocks.run.mockResolvedValue({ status: "running", channel: {} });
 expect((await call("workbench" + path, { tk: "oq.business.grant" }, "GET")).status).toBe(200);
 const [url, request] = upstream.mock.calls[0]!;
 expect(url).toBe("http://workbench.test" + path);
 expect(request).toMatchObject({ method: "GET", headers: { tk: "initiator-token" } });
 expect(request.headers).not.toHaveProperty("X-API-Key");
 expect(mocks.restore).not.toHaveBeenCalled();
});

it.each([
  ["GET", "workbench/api/skills/search?q=report"],
  ["GET", "workbench/api/skills/reporting/export"],
  ["GET", "workbench/api/skills/reporting/files/extra"],
  ["GET", "ontology/api/skills"],
  ["POST", "workbench/api/skills/reporting/files"],
  ["POST", "workbench/api/skills/import"],
])("refuses the unlisted skill callback %s %s before resolving the executor", async (method, path) => {
 const upstream = vi.fn();
 vi.stubGlobal("fetch", upstream);
 expect((await call(path, {}, method)).status).toBe(403);
 expect(mocks.restore).not.toHaveBeenCalled();
 expect(upstream).not.toHaveBeenCalled();
});

it.each([
  ["GET", "/api/platform-ontology/schema", undefined],
  ["GET", "/api/platform-ontology/counts", undefined],
  ["GET", "/api/platform-ontology/start", undefined],
  ["POST", "/api/platform-ontology/neighbors", { node: { className: "platform:User", primaryKey: "V" }, relationKinds: ["owns"] }],
  ["POST", "/api/platform-ontology/objects", { type: "platform:User", keyword: "V", page: 1 }],
])("forwards the platform ontology read %s %s with the initiator credential", async (method, path, body) => {
 const upstream = vi.fn(async (_url: string, _request: NonNullable<Parameters<typeof fetch>[1]>) => Response.json({}));
 vi.stubGlobal("fetch", upstream);
 mocks.run.mockResolvedValue({ status: "running", channel: {} });
 const response = await nativeFetch(base+`/api/assistant/executions/${run}/workbench`+path, {
   method, headers: { "content-type": "application/json", "X-Ontomato-Callback-Credential": credential(), "X-Ontomato-Run-Id": run, tk: "oq.business.grant" },
   body: body === undefined ? undefined : JSON.stringify(body),
 });
 expect(response.status).toBe(200);
 expect(upstream.mock.calls[0]?.[0]).toBe("http://workbench.test" + path);
 expect(upstream.mock.calls[0]?.[1]).toMatchObject({ method, body: body === undefined ? undefined : JSON.stringify(body), headers: { tk: "initiator-token" } });
 expect(upstream.mock.calls[0]?.[1].headers).not.toHaveProperty("X-API-Key");
 expect(mocks.run).toHaveBeenCalledWith({ userId: "U", domainId: "domain" }, run);
 expect(mocks.restore).not.toHaveBeenCalled();
});

it.each([
  ["POST", "workbench/api/platform-ontology/schema"],
  ["GET", "workbench/api/platform-ontology/neighbors"],
  ["POST", "workbench/api/platform-ontology/objects/extra"],
  ["GET", "ontology/platform-ontology/start"],
])("refuses the unlisted platform ontology callback %s %s", async (method, route) => {
 const upstream = vi.fn();
 vi.stubGlobal("fetch", upstream);
 expect((await call(route, {}, method)).status).toBe(403);
 expect(mocks.restore).not.toHaveBeenCalled();
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
  ["POST", "/ontology/query/metrics/execute"],
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

it.each(["PUT", "DELETE"])("forbids %s for a scheduled task before resolving the executor", async method => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect((await call(`ontology/platform/scheduled-tasks/${other}`, {}, method)).status).toBe(403);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
});

it.each([
  ["GET", "product-projections/chart-sources?dashboardId=board&cardId=card", 200],
  ["GET", "product-projections/projection/chart-source", 200],
  ["POST", "product-projections/chart-sources", 200],
  ["PUT", "product-projections/projection/chart-source", 403],
])("proxies declared chart operations and rejects undeclared ones, %s %s", async (method, path, status) => {
  const upstream = vi.fn(async (_url: string) => Response.json({}));
  vi.stubGlobal("fetch", upstream);
  expect((await call("workbench/api/" + path, {}, method)).status).toBe(status);
  if (status === 200) expect(upstream).toHaveBeenCalledWith("http://workbench.test/api/" + path, expect.anything());
  else expect(upstream).not.toHaveBeenCalled();
});

it.each([
  ["GET", "workbench/apps-sdk/current/sdk.json", "http://workbench.test/apps-sdk/current/sdk.json"],
  ["GET", "workbench/api/apps-sdk/current", "http://workbench.test/api/apps-sdk/current"],
  ["GET", "workbench/api/app-builder/type-table", "http://workbench.test/api/app-builder/type-table"],
  ["GET", "workbench/api/component-packages/my-pkg", "http://workbench.test/api/component-packages/my-pkg"],
  ["GET", "workbench/api/component-packages/%40scope%2Fpkg", "http://workbench.test/api/component-packages/%40scope%2Fpkg"],
  ["GET", "workbench/api/domain-components", "http://workbench.test/api/domain-components"],
  ["POST", "workbench/api/domain-components", "http://workbench.test/api/domain-components"],
  ["GET", "workbench/api/domain-components/domain-component%3Acard", "http://workbench.test/api/domain-components/domain-component:card"],
  ["PUT", "workbench/api/domain-components/domain-component%3Acard", "http://workbench.test/api/domain-components/domain-component:card"],
  ["GET", "workbench/api/workspaces?page=1", "http://workbench.test/api/workspaces?page=1"],
  ["POST", "workbench/api/workspaces", "http://workbench.test/api/workspaces"],
  ["GET", `workbench/api/workspaces/${other}`, `http://workbench.test/api/workspaces/${other}`],
  ["PATCH", `workbench/api/workspaces/${other}`, `http://workbench.test/api/workspaces/${other}`],
  ["DELETE", `workbench/api/workspaces/${other}`, `http://workbench.test/api/workspaces/${other}`],
  ["GET", `workbench/api/workspaces/${other}/tree`, `http://workbench.test/api/workspaces/${other}/tree`],
  ["GET", `workbench/api/workspaces/${other}/files/content?path=panel.json`, `http://workbench.test/api/workspaces/${other}/files/content?path=panel.json`],
  ["GET", `workbench/api/workspaces/${other}/panel-candidate?ref=working`, `http://workbench.test/api/workspaces/${other}/panel-candidate?ref=working`],
  ["GET", `workbench/api/workspaces/${other}/build-tests`, `http://workbench.test/api/workspaces/${other}/build-tests`],
  ["POST", `workbench/api/workspaces/${other}/build-tests`, `http://workbench.test/api/workspaces/${other}/build-tests`],
  ["DELETE", `workbench/api/workspaces/${other}/build-tests`, `http://workbench.test/api/workspaces/${other}/build-tests`],
  ["POST", `workbench/api/workspaces/${other}/import`, `http://workbench.test/api/workspaces/${other}/import`],
  ["POST", `workbench/api/workspaces/${other}/publish`, `http://workbench.test/api/workspaces/${other}/publish`],
  ["GET", "workbench/api/product-panels/panel-1", "http://workbench.test/api/product-panels/panel-1"],
  ["PUT", "workbench/api/product-panels/panel-1", "http://workbench.test/api/product-panels/panel-1"],
  ["DELETE", "workbench/api/product-panels/panel-1", "http://workbench.test/api/product-panels/panel-1"],
  ["GET", "workbench/api/product-projections/proj-1", "http://workbench.test/api/product-projections/proj-1"],
  ["PUT", "workbench/api/product-projections/proj-1", "http://workbench.test/api/product-projections/proj-1"],
  ["GET", "workbench/api/product-projections/proj-1/used-by", "http://workbench.test/api/product-projections/proj-1/used-by"],
  ["PUT", "workbench/api/product-assets/asset-1", "http://workbench.test/api/product-assets/asset-1"],
  ["DELETE", "workbench/api/product-assets/asset-1", "http://workbench.test/api/product-assets/asset-1"],
  ["POST", "workbench/api/dashboards/create", "http://workbench.test/api/dashboards/create"],
  ["GET", "ontology/admin/getDatasetDesc", "http://ontology.test/admin/getDatasetDesc"],
  ["GET", "ontology/admin/getAllClassNames", "http://ontology.test/admin/getAllClassNames"],
  ["POST", "ontology/admin/getSchemaByClassName", "http://ontology.test/admin/getSchemaByClassName"],
  ["POST", "ontology/admin/getRelationshipByClassNames", "http://ontology.test/admin/getRelationshipByClassNames"],
  ["POST", "ontology/vectorResource/upload", "http://ontology.test/vectorResource/upload"],
  ["POST", "ontology/vectorResource/delete", "http://ontology.test/vectorResource/delete"],
  ["POST", "ontology/action/save", "http://ontology.test/action/save"],
  ["POST", "ontology/action/delete", "http://ontology.test/action/delete"],
  ["POST", "ontology/metricView/save", "http://ontology.test/metricView/save"],
  ["POST", "ontology/metricView/delete", "http://ontology.test/metricView/delete"],
  ["POST", "ontology/function/save", "http://ontology.test/function/save"],
  ["POST", "ontology/function/delete", "http://ontology.test/function/delete"],
  ["GET", "ontology/platform/applications?purpose=navigation", "http://ontology.test/platform/applications?purpose=navigation"],
  ["GET", "ontology/platform/applications/catalogue/app-1", "http://ontology.test/platform/applications/catalogue/app-1"],
  ["GET", "ontology/platform/applications/app-1/panel-uses", "http://ontology.test/platform/applications/app-1/panel-uses"],
  ["PUT", "ontology/platform/applications/app-1/panel-uses", "http://ontology.test/platform/applications/app-1/panel-uses"],
  ["PUT", "ontology/platform/applications/app-1/identity", "http://ontology.test/platform/applications/app-1/identity"],
  ["DELETE", "ontology/platform/applications/app-1", "http://ontology.test/platform/applications/app-1"],
  ["GET", "ontology/user/getCur", "http://ontology.test/user/getCur"],
  ["POST", "ontology/workflow/subjects", "http://ontology.test/workflow/subjects"],
  ["POST", "ontology/workflow/grants", "http://ontology.test/workflow/grants"],
])("forwards registered skill callback %s %s to %s", async (method, path, expectedUrl) => {
  const upstream = vi.fn(async () => method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ ok: true }));
  vi.stubGlobal("fetch", upstream);
  const response = await call(path, {}, method);
  expect(response.status).toBe(method === "DELETE" ? 204 : 200);
  expect(upstream).toHaveBeenCalledWith(expectedUrl, expect.objectContaining({ method, redirect: "error" }));
});

it.each([
  ["POST", "workbench/api/component-packages/install"],
  ["GET", "workbench/api/component-packages/install"],
  ["GET", "workbench/api/app-builder/bootstrap"],
  ["GET", "workbench/api/app-builder/agents"],
  ["GET", `workbench/api/workspaces/applications/app-1/policy`],
  ["POST", `workbench/api/workspaces/${other}/preview-token`],
  ["POST", `workbench/api/workspaces/${other}/export`],
  ["DELETE", "workbench/api/domain-components/domain-component:card"],
  ["GET", "workbench/api/domain-components/domain-component:card/used-by"],
  ["PUT", "workbench/api/product-panels/personal-state"],
  ["DELETE", "workbench/api/product-projections/proj-1"],
  ["PUT", "workbench/api/product-projections/chart-sources"],
  ["PUT", "workbench/api/dashboards/board-1"],
  ["DELETE", "workbench/api/dashboards/board-1"],
  ["POST", "ontology/admin/unknown"],
  ["GET", "ontology/action/save"],
  ["POST", "ontology/platform/applications/app-1/other"],
  ["DELETE", "ontology/platform/applications/catalogue"],
])("forbids unlisted skill route or method %s %s", async (method, path) => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect((await call(path, {}, method)).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});

it("forwards execution-context and reuse-panel headers when supplied", async () => {
  const upstream = vi.fn(async (_url: string, _request?: Parameters<typeof fetch>[1]) => Response.json({ ok: true }));
  vi.stubGlobal("fetch", upstream);
  const response = await call("workbench/api/product-projections/proj-1", {
    "X-Ontomato-Execution-Context": JSON.stringify({ kind: "build-test", contextId: "ctx-1" }),
    "X-Ontomato-Projection-Reuse-Panel": "panel-1",
  }, "PUT");
  expect(response.status).toBe(200);
  expect(upstream.mock.calls[0]?.[1]?.headers).toMatchObject({
    "X-Ontomato-Execution-Context": JSON.stringify({ kind: "build-test", contextId: "ctx-1" }),
    "X-Ontomato-Projection-Reuse-Panel": "panel-1",
  });
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

it("lets only the current callback submit the App Builder definition for adoption", async () => {
 const url=base+`/api/assistant/executions/${run}/authoring/action/adopt`;
 const definition={function:{code:"program"}};
 const adopted={definition,executionId:other,digest:"a".repeat(64)};
 mocks.adopt.mockResolvedValue(adopted);
 const headers={"content-type":"application/json","X-Ontomato-Callback-Credential":credential(),"X-Ontomato-Run-Id":run};
 const response=await nativeFetch(url,{method:"POST",headers,body:JSON.stringify({definition})});
 expect(response.status).toBe(200);
 expect(await response.json()).toEqual(adopted);
 expect(mocks.adopt).toHaveBeenCalledWith({userId:"U",domainId:"domain"},expect.objectContaining({token:"initiator-token"}),run,"action",definition);
 mocks.adopt.mockClear();
 for (const [auth,body,expected] of [
   [{"content-type":"application/json"},{definition},403],
   [headers,{definition,testPassed:true},400],
 ] as const) {
   expect((await nativeFetch(url,{method:"POST",headers:auth,body:JSON.stringify(body)})).status).toBe(expected);
 }
 expect(mocks.adopt).not.toHaveBeenCalled();
});

it("resolves retrieval_scope_id from the server turn on retrieval and ontology calls instead of trusting caller headers",async()=>{
 const scope="33333333-3333-4333-8333-333333333333";
 const upstream=vi.fn(async (_url: string, _request?: Parameters<typeof fetch>[1])=>Response.json({ok:true}));vi.stubGlobal('fetch',upstream);
 mocks.ownedRun.mockResolvedValue({turn:{id:run,retrieval_scope_id:scope},run:{status:"running",channel:{agent:{agentId:"agent"}}}});
 mocks.restore.mockResolvedValue({executionUserId:null,retrievalScopeId:scope,credentials:{token:'initiator-token',locale:'en',headers:{'X-Ontomato-Retrieval-Caller-Id':scope}}});

 // Status/close retrieval operations look up the turn's retrieval_scope_id via ownedRun.
 const statusRes=await nativeFetch(base+`/api/assistant/executions/${run}/retrieval`,{method:'POST',headers:{'content-type':'application/json','X-Ontomato-Callback-Credential':credential(),'X-Ontomato-Run-Id':run,'X-Ontomato-Retrieval-Caller-Id':other},body:JSON.stringify({operation:'status',retrievalId:other,retrievalRunId:other,key:other})});
 expect(statusRes.status).toBe(200);
 expect(upstream.mock.calls[0]![1]?.headers).toMatchObject({'X-Ontomato-Retrieval-Caller-Id':scope});

 // Ontology proxy forwards the resolved retrievalScopeId and never caller-supplied IDs.
 const ontoRes=await call('ontology/ontology/query/execute-dsl',{'X-Ontomato-Retrieval-Caller-Id':other});
 expect(ontoRes.status).toBe(200);
 expect(upstream.mock.calls[1]![1]?.headers).toMatchObject({'X-Ontomato-Retrieval-Caller-Id':scope});

 // When the turn has no retrieval scope (e.g. app-builder), no X-Ontomato-Retrieval-Caller-Id header is sent.
 mocks.restore.mockResolvedValue({executionUserId:null,retrievalScopeId:null,credentials:{token:'initiator-token',locale:'en'}});
 const appBuilderRes=await call('ontology/ontology/query/overview',{},'GET');
 expect(appBuilderRes.status).toBe(200);
 expect(upstream.mock.calls[2]![1]?.headers).not.toHaveProperty('X-Ontomato-Retrieval-Caller-Id');
});
