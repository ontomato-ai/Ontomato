import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
import { HttpError } from "../../../utils/errors";

const state=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined,schema:"",runtimeSessions:new Set<string>()}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>state.pool,qualifiedTable:(name:string)=>`"${state.schema}"."${name}"`}));
vi.mock("../../../infrastructure/agent-runtime/client",()=>({RuntimeClient:class {
  async session(id:string) {
    if(!state.runtimeSessions.has(id))throw new HttpError(404,"Session not found","NOT_FOUND");
    return {session:{id},latestRun:null,messages:[],pendingQuestions:[]};
  }
  async createSession(id:string) {state.runtimeSessions.add(id);}
}}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{baseUrl:"http://ontology"}}}));
vi.mock("../../../core/skills/registry/manager",()=>({skillRegistryManager:{}}));
vi.mock("../../skills/skill-manager",()=>({skillManager:{},skillReference:vi.fn()}));
vi.mock("../../skills/operations",()=>({withDomainSkills:async(_domain:string,work:()=>Promise<unknown>)=>work()}));
// Admission is exercised through the real store and claim helper, without model preparation.
vi.mock("../prepare",()=>({prepareAnalystRun:async({a,input}:{a:{id:string};input:unknown})=>({
  language:"en",definition:{agentId:a.id},input,environment:{values:{},secrets:{}},
})}));
import { ensureAgentExecutionSchema } from "../../../infrastructure/postgres-migrations/20261117-agent-execution/schema";
import { ensureAssistantSchema } from "../../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { ensureWorkspacesSchema } from "../../../infrastructure/postgres-migrations/20261109-workspaces/schema";
import { ensureOpsDiagnosisSchema } from "../../../infrastructure/postgres-migrations/20261029-ops-diagnosis/schema";
import { assistantStore } from "../store";
import { assistantService } from "../service";
import { createDiagnosis } from "../../ops-diagnosis/service";

const database=process.env.RUNTIME_TEST_DATABASE_URL;
if(!database)throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const owner={domainId:"domain",userId:"owner"},agentId=randomUUID();
beforeAll(async()=>{
  state.schema="channel_prepare_"+randomUUID().replaceAll("-","");
  state.pool=new pg.Pool({connectionString:database});
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureAssistantSchema(state.pool);await ensureAgentExecutionSchema(state.pool);await ensureOpsDiagnosisSchema(state.pool);await ensureWorkspacesSchema(state.pool);
  await state.pool.query(`INSERT INTO "${state.schema}".assistant_agents(id,domain_id,kind,name,system_prompt) VALUES($1,$2,'custom','Agent','')`,[agentId,owner.domainId]);
});
beforeEach(async()=>{vi.spyOn(assistantService,"admitAgent").mockResolvedValue({agent:await assistantStore.agent(agentId,owner)});});
afterEach(()=>{vi.restoreAllMocks();});
afterAll(async()=>{if(state.pool){await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);await state.pool.end();}});
function prepared(sessionId:string):AgentPrepareRequest {
  const parent={session:{providerId:"workbench",sessionId:randomUUID()},runId:randomUUID()};
  return {mode:"run",language:"en",agent:{providerId:"workbench",agentId},sessionId,runId:randomUUID(),
    actor:{id:randomUUID(),domainId:owner.domainId},inputId:randomUUID(),
    input:{role:"notification",kind:"agent-message",source:parent,content:"Delegated work",timestamp:Date.now()},
    authority:{classNames:[],executionKind:"live"},requestedBy:parent,root:parent};
}
it("first channel preparation accepts the runtime's existing session and creates the assistant index",async()=>{
  const id=randomUUID(),body=prepared(id);state.runtimeSessions.add(id);
  const result=await assistantService.prepare(body,owner,{});
  expect(result.definition.agentId).toBe(agentId);
  const session=await assistantStore.session(id,owner);
  expect(session.agent_id).toBe(agentId);expect(session.latest_run_id).toBe(body.runId);expect(session.origin).toBe("delegated");
});
it("trusted preparation still refuses a session indexed by another surface",async()=>{
  const id=randomUUID();state.runtimeSessions.add(id);
  await state.pool!.query(`INSERT INTO "${state.schema}".ops_sessions(id,domain_id,owner_id) VALUES($1,$2,$3)`,[id,owner.domainId,owner.userId]);
  await expect(assistantService.prepare(prepared(id),owner,{})).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_CONFLICT"});
  await expect(assistantStore.session(id,owner)).rejects.toMatchObject({status:404});
});
it("client and scheduler creation remain strict for an existing runtime session",async()=>{
  const id=randomUUID();state.runtimeSessions.add(id);
  await expect(assistantService.create(id,owner,{agentId})).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_CONFLICT"});
  await expect(assistantService.create(id,owner,{agentId},"scheduled")).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_CONFLICT"});
  await expect(assistantStore.session(id,owner)).rejects.toMatchObject({status:404});
});
it("diagnosis uses the same trusted-claim rule while client creation stays strict",async()=>{
  const accepted=randomUUID(),client=randomUUID();state.runtimeSessions.add(accepted);state.runtimeSessions.add(client);
  expect((await createDiagnosis(accepted,owner,null,true)).session.id).toBe(accepted);
  await expect(createDiagnosis(client,owner)).rejects.toMatchObject({status:409,code:"IDEMPOTENCY_CONFLICT"});
});
