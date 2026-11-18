import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
const mocks = vi.hoisted(() => ({ session: vi.fn(), domainSession: vi.fn(), turn: vi.fn(), status: vi.fn(), post: vi.fn(), record:vi.fn(), window:vi.fn() }));
vi.mock("../../../identity/installed", () => ({ workbenchIdentity: () => ({ requireDomainId: (input: {domainId:string}) => input.domainId }) }));
vi.mock("../../../services/assistant/store", () => ({ assistantStore: { session: mocks.session, domainSession: mocks.domainSession, turn: mocks.turn, recordGovernanceWindow:mocks.record, governanceWindow:mocks.window } }));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({ RuntimeClient: class { status = mocks.status; } }));
vi.mock("../../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "service", token: "runtime-secret" }) } }));
vi.mock("../../../config/query-settings",()=>({getQueryTimeoutMs:()=>900_000}));
vi.mock("../../../config/data-query-api", () => ({ getApiConfig: () => ({ baseUrl: "http://ontology" }) }));
vi.mock("../../../utils/backend-client", () => ({ backendPost: mocks.post, buildBackendHeaders: () => ({ tk: "current-user" }) }));
import { governanceRunStatus, openGovernanceWindow, closeGovernanceWindow } from "../../../services/assistant/governance";
import { assistantInternalRouter, governanceWindowsRouter } from "../governance";
import { callbackCredential, unwrapCallbackCredential } from "../../../services/agent-runtime/callback-credential";
const sessionId="11111111-1111-4111-8111-111111111111", runId="22222222-2222-4222-8222-222222222222", recordId="33333333-3333-4333-8333-333333333333";
const owner={domainId:"domain",userId:"user"};
let server: Server | undefined;
beforeEach(() => {
  server=undefined;
  vi.clearAllMocks();
  const session={id:sessionId,domain_id:"domain",owner_id:"user",latest_run_id:runId};
  mocks.session.mockResolvedValue(session);mocks.domainSession.mockResolvedValue(session);
  mocks.turn.mockResolvedValue({id:runId,session_id:sessionId,admitted:true,settled:false,created_at:new Date()});
  mocks.status.mockResolvedValue({id:runId,sessionId,status:"running",stopReason:null,messages:["private"]});
  mocks.post.mockImplementation(async (_name:string,_url:string,input:{recordId:string;sessionId:string;runId:string;expiresAt:string}) => ({text:JSON.stringify({id:input.recordId,sessionId:input.sessionId,runId:input.runId,expiresAt:input.expiresAt,token:"governance-grant"})}));
});
afterEach(async () => {const closing=server;if(closing) await new Promise<void>((resolve,reject)=>closing.close(error=>error?reject(error):resolve()));});
it("binds a window to the persisted current run and configured run deadline", async () => {
  const result=await openGovernanceWindow(sessionId,runId,recordId,owner,{token:"current-user"});
  expect(result.id).toBe(recordId);
  const binding=mocks.post.mock.calls[0][2];
  expect(binding).toMatchObject({recordId,domainId:"domain",ownerId:"user",sessionId,runId,runtimeHostId:"workbench"});
  expect(new Date(binding.expiresAt).getTime()).toBe(new Date((await mocks.turn()).created_at).getTime()+900_000);
});
it("refuses another session's run, a settled run and a non-current run before registration", async () => {
  mocks.turn.mockResolvedValueOnce({id:runId,session_id:recordId,admitted:true,settled:false});
  await expect(openGovernanceWindow(sessionId,runId,undefined,owner,{})).rejects.toMatchObject({status:404});
  mocks.turn.mockResolvedValueOnce({id:runId,session_id:sessionId,admitted:true,settled:true});
  await expect(openGovernanceWindow(sessionId,runId,undefined,owner,{})).rejects.toMatchObject({code:"GOVERNANCE_RUN_CLOSED"});
  mocks.session.mockResolvedValueOnce({id:sessionId,latest_run_id:recordId});
  await expect(openGovernanceWindow(sessionId,runId,undefined,owner,{})).rejects.toMatchObject({code:"GOVERNANCE_RUN_CLOSED"});
  expect(mocks.post).not.toHaveBeenCalled();
});
it("propagates runtime failures and never registers a stopped run", async () => {
  mocks.status.mockRejectedValueOnce(new Error("unavailable"));
  await expect(openGovernanceWindow(sessionId,runId,undefined,owner,{})).rejects.toThrow("unavailable");
  mocks.status.mockResolvedValueOnce({id:runId,sessionId,status:"stopped",stopReason:"aborted"});
  await expect(openGovernanceWindow(sessionId,runId,undefined,owner,{})).rejects.toMatchObject({code:"GOVERNANCE_RUN_CLOSED"});
  expect(mocks.post).not.toHaveBeenCalled();
});
it("returns only the lightweight fact for the owned run", async () => {
  expect(await governanceRunStatus(sessionId,runId,"domain")).toEqual({sessionId,runId,status:"running",stopReason:null});
  mocks.status.mockResolvedValueOnce({id:runId,sessionId:recordId,status:"running",stopReason:null});
  await expect(governanceRunStatus(sessionId,runId,"domain")).rejects.toMatchObject({status:404});
  mocks.status.mockResolvedValueOnce({id:recordId,sessionId,status:"running",stopReason:null});
  await expect(governanceRunStatus(sessionId,runId,"domain")).rejects.toMatchObject({status:404});
});
async function listen() {
  const app=express();app.use(express.json());app.use(unwrapCallbackCredential);
  app.use((req,_res,next)=>{Object.assign(req,{domainId:"domain",userId:"user",token:"current-user"});next();});
  app.use("/api/assistant/sessions",governanceWindowsRouter);app.use("/internal/assistant",assistantInternalRouter);
  app.use((error: {status?:number},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{res.sendStatus(error.status??500);});
  server=app.listen(0,"127.0.0.1");await once(server,"listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
it("requires a verified run callback instead of caller-supplied identity headers", async () => {
  const url=await listen(),path=`/api/assistant/sessions/${sessionId}/governance-window`;
  const plain=await fetch(url+path,{method:"POST",headers:{"content-type":"application/json",tk:"user","X-Ontomato-Run-Id":runId},body:"{}"});
  expect(plain.status).toBe(403);
  const credential=callbackCredential({pathPrefix:path,runId,expiresAt:Date.now()+60_000,token:"user",apiKey:""}).value;
  const forged=await fetch(url+path,{method:"POST",headers:{"content-type":"application/json",tk:credential,"X-Ontomato-Run-Id":recordId},body:"{}"});
  expect(forged.status).toBe(401);
  expect(mocks.post).not.toHaveBeenCalled();
  const real=await fetch(url+path,{method:"POST",headers:{"content-type":"application/json",tk:credential,"X-Ontomato-Run-Id":runId},body:"{}"});
  expect(real.status).toBe(200);
  expect(mocks.post.mock.calls[0][2]).toMatchObject({sessionId,runId});
});
it("keeps the status endpoint behind service authentication", async () => {
  const url=await listen(),path=`/internal/assistant/sessions/${sessionId}/runs/${runId}/status`;
  expect((await fetch(url+path)).status).toBe(403);
  const response=await fetch(url+path,{headers:{"X-Ontomato-Query-Service-Token":"service","X-Domain-Id":"domain"}});
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({sessionId,runId,status:"running",stopReason:null});
});

it("closes only a recorded governance window, independently of the current definition",async()=>{
  mocks.window.mockResolvedValueOnce(null);
  await closeGovernanceWindow(runId,owner);expect(mocks.post).not.toHaveBeenCalled();
  mocks.window.mockResolvedValueOnce(recordId);mocks.post.mockResolvedValueOnce({text:""});
  await closeGovernanceWindow(runId,owner);
  expect(mocks.post.mock.calls[0][1]).toBe(`http://ontology/ontology/ai/knowledge-governance/platform-windows/${runId}/close`);
});

it("propagates Java window admission failures without recording a window",async()=>{
  const failure=Object.assign(new Error("credential expired"),{status:401});
  mocks.post.mockRejectedValueOnce(failure);
  await expect(openGovernanceWindow(sessionId,runId,recordId,owner,{token:"expired"})).rejects.toBe(failure);
  expect(mocks.record).not.toHaveBeenCalled();
});

it("registers U with only the fixed V reference and never restores V credentials in Node",async()=>{
  mocks.status.mockResolvedValue({id:runId,sessionId,status:"running",stopReason:null,executionUserId:"executor"});
  await openGovernanceWindow(sessionId,runId,recordId,owner,{token:"current-user"});
  expect(mocks.post.mock.calls[0][2]).toMatchObject({ownerId:"user",executionActor:{userId:"executor",domainId:"domain"}});
  expect(mocks.post.mock.calls[0][3].headers).toMatchObject({tk:"current-user"});
  expect(JSON.stringify(mocks.post.mock.calls[0][2])).not.toContain("apiKey");
});
