import { ensureAssistantDefaultPromptSchema } from "../../../infrastructure/postgres-migrations/20261105-assistant-default-prompts/schema";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({pool:undefined as pg.Pool|undefined,schema:""}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>state.pool,qualifiedTable:(name:string)=>`"${state.schema}"."${name}"`}));
import { ensureAssistantSchema } from "../../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { assistantStore } from "../store";
const database=process.env.RUNTIME_TEST_DATABASE_URL;
if(!database)throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const owner={domainId:"domain",userId:"user"},agent=randomUUID(),session=randomUUID(),legacy=randomUUID();
beforeAll(async()=>{
  state.schema="scope_facts_"+randomUUID().replaceAll("-","");state.pool=new pg.Pool({connectionString:database});
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);await ensureAssistantSchema(state.pool);await ensureAssistantDefaultPromptSchema(state.pool);
  await state.pool.query(`INSERT INTO "${state.schema}".assistant_agents(id,domain_id,kind,name,system_prompt) VALUES($1,'domain','custom','Agent','')`,[agent]);
  await state.pool.query(`INSERT INTO "${state.schema}".assistant_sessions(id,domain_id,owner_id,agent_id) VALUES($1,'domain','user',$2)`,[session,agent]);
  await state.pool.query(`INSERT INTO "${state.schema}".assistant_turns(id,session_id,retrieval_scope_id,request_seq,input_hash) VALUES($1,$2,$1,0,'old')`,[legacy,session]);
  await state.pool.query(`ALTER TABLE "${state.schema}".assistant_turns ALTER COLUMN retrieval_scope_id SET NOT NULL`);
  await ensureAssistantSchema(state.pool);
});
afterAll(async()=>{if(state.pool){await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);await state.pool.end();}});
it("keeps old references and records new retrieval/governance references only when explicitly opened",async()=>{
  expect((await assistantStore.turn(legacy,owner)).retrieval_scope_id).toBe(legacy);
  const id=randomUUID(),record=randomUUID();
  const {row}=await assistantStore.reserve(session,id,"New work",owner,[]);
  expect(row.retrieval_scope_id).toBeNull();expect(row.governance_record_id).toBeNull();
  expect(await assistantStore.governanceWindow(id,owner)).toBeNull();
  await assistantStore.recordRetrievalScope(id,owner,id);
  await assistantStore.recordGovernanceWindow(id,owner,record);
  expect((await assistantStore.turn(id,owner)).retrieval_scope_id).toBe(id);
  expect(await assistantStore.governanceWindow(id,owner)).toBe(record);
  expect(await assistantStore.governanceWindow(id,{...owner,domainId:"other"})).toBeNull();
});

it("seeds a stable governance preset in both existing and new domains",async()=>{
  const first=(await assistantStore.agents(owner.domainId)).find(agent=>agent.kind==="knowledge-governance")!;
  expect(first.enabled).toBe(true);expect(first.skills).toContainEqual({namespace:{kind:"provider",provider:"ontology"},name:"knowledge-governance"});
  expect(first.skills).toContainEqual({namespace:{kind:"provider",provider:"workbench"},name:"assistant-report"});
  expect((await assistantStore.agents(owner.domainId)).find(agent=>agent.kind==="knowledge-governance")?.id).toBe(first.id);
  const second=(await assistantStore.agents("new-domain")).find(agent=>agent.kind==="knowledge-governance")!;
  expect(second.domain_id).toBe("new-domain");expect(second.id).not.toBe(first.id);
});
