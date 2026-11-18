import express from 'express';
import type {Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({restore:vi.fn(),run:vi.fn()}));
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
 app.use((req,_res,next)=>{Object.assign(req,{userId:'U',domainId:'domain',token:req.header('tk'),locale:'en'});next();});
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
it.each(['ontology/ontology/retrievals/skill-runs','ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs/'+other,'ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs/'+other+'/content','ontology/ontology/retrievals/'+run+'/skill-runs/'+run+'/close','ontology/ontology/retrievals/'+run+'/retriever/cancel','ontology/ontology/retrievals/'+run+'/runs/'+run+'/outputs','ontology/platform/agent-channel/commands','ontology/internal/agent-execution/resolve','ontology/agent-principals/execution','ontology/https%3A%2F%2Fevil.test','workbench/internal/agent-channel/prepare'])('refuses an out-of-scope path %s before resolving any key',async path=>{
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

it('configuration keeps the original operator even when the selected business executor is invalid',async()=>{
 mocks.restore.mockRejectedValue(new Error('V is invalid'));
 const upstream=vi.fn(async()=>Response.json({saved:true}));vi.stubGlobal('fetch',upstream);
 expect((await call('workbench/api/assistant/agent-definitions/validate',{},'POST')).status).toBe(200);
 const headers=(upstream.mock.calls[0] as unknown as [string,NonNullable<Parameters<typeof fetch>[1]>])[1].headers;
 expect(headers).toMatchObject({tk:'initiator-token'});expect(headers).not.toHaveProperty('X-API-Key');
 expect(mocks.restore).not.toHaveBeenCalled();
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
