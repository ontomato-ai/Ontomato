import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
const mocks=vi.hoisted(()=>({query:vi.fn(),agent:vi.fn(),session:vi.fn(),turn:vi.fn(),turns:vi.fn(),create:vi.fn(),reserve:vi.fn(),admitted:vi.fn(),settled:vi.fn(),close:vi.fn(),callback:vi.fn(),skills:vi.fn(),request:vi.fn(),run:vi.fn(),open:vi.fn(),links:vi.fn(),scope:vi.fn(),scopeClose:vi.fn(),status:vi.fn(),overview:vi.fn(),record:vi.fn(),recordWindow:vi.fn()}));
vi.mock("../store",()=>({assistantStore:{agent:mocks.agent,session:mocks.session,turn:mocks.turn,turns:mocks.turns,create:mocks.create,reserve:mocks.reserve,admitted:mocks.admitted,settled:mocks.settled,recordRetrievalScope:mocks.scope,governanceWindow:mocks.record,recordGovernanceWindow:mocks.recordWindow,isBuilderRun:async()=>false}}));
vi.mock("../governance",()=>({closeGovernanceWindow:mocks.close}));
vi.mock("../../../core/skills/registry/manager",()=>({skillRegistryManager:{}}));
vi.mock("../../skills/skill-manager",()=>({skillManager:{},skillReference:vi.fn()}));
vi.mock("../skills",async original=>({...await original<typeof import("../skills")>(),prepareAssistantSkills:mocks.skills}));
vi.mock("../context",()=>({assistantOntologyContext:mocks.overview}));
vi.mock("../ontology-retrieval",()=>({OntologyRetrievalClient:class {open=mocks.open;links=mocks.links;closeScope=mocks.scopeClose;}}));
vi.mock("../prompts",()=>({effectiveSystemPrompt:()=>"Instructions"}));
vi.mock("../../skills/operations",()=>({withDomainSkills:async(_domain:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock("../../product-assets/platform-assets",()=>({nativeProfileId:async()=>null}));
vi.mock("../../product-assets/agent-profile",()=>({profileSourceForSession:async()=>null,agentProfileForAgent:async()=>null,profileForSession:async()=>null}));
vi.mock("../../agent-runtime/callback-credential",()=>({callbackCredential:mocks.callback}));
vi.mock("../../agent-host/caller",()=>({restoreAgentCaller:async()=>({owner:{domainId:"domain",userId:"user"},credentials:{}})}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{baseUrl:"http://ontology"}}}));
vi.mock("../../../config/query-settings",()=>({getQueryTimeoutMs:()=>900_000}));
vi.mock("../../../config/environment",()=>({environment:{agentRuntime:()=>({callbackUrl:"http://workbench"})}}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../infrastructure/agent-runtime/client",()=>({RuntimeClient:class {request=mocks.request;run=mocks.run;status=mocks.status;session=async()=>({messages:[{id:"22222222-2222-4222-8222-222222222222",messageSeq:1,message:{role:"user",content:"Review knowledge",timestamp:1}}]});}}));
vi.mock("../../../platform/agent-runtime/runtime",()=>({messageText:(message:{content:string})=>message.content,answerText:()=>"",userSkillEnvironment:()=>({values:{ONTOMATO_ONTOLOGY_URL:"http://ontology",ONTOMATO_SKILL_SCENARIO:"platform"},secrets:{ONTOMATO_TK:"user"}}),runDefinition:(systemPrompt:string,modelId:string,skills:unknown[])=>({systemPrompt,modelId,skills})}));
import { assistantService } from "../service";
import { agentChannelService } from "../../agent-host/channel";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
configureI18n({defaultLocale:"en",appTextLocale:"en",languageSwitchEnabled:false,packs:{en:{messages:en,...enLocaleMeta}}});
const owner={domainId:"domain",userId:"user"},sessionId="11111111-1111-4111-8111-111111111111",runId="22222222-2222-4222-8222-222222222222",agentId="33333333-3333-4333-8333-333333333333";
const skill={namespace:{kind:"provider",provider:"ontology"},name:"knowledge-governance"};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.agent.mockResolvedValue({id:agentId,kind:"custom",execution_user_id:null,enabled:true,class_names:[],skills:[skill],model_selection:{modelId:"provider/model"},enabled_mcp_service_ids:[]});
  const session={id:sessionId,agent_id:agentId,owner_id:"user",domain_id:"domain",workspace_id:null};
  const turn={id:runId,session_id:sessionId,created_at:new Date(),retrieval_scope_id:null,governance_record_id:null,class_names:[]};
  mocks.session.mockResolvedValue(session);mocks.turn.mockResolvedValue(turn);mocks.turns.mockResolvedValue([]);
  mocks.create.mockResolvedValue({row:session});mocks.reserve.mockResolvedValue({row:turn});
  mocks.query.mockResolvedValue({rows:[{session_id:sessionId}]});mocks.skills.mockResolvedValue([skill]);mocks.overview.mockResolvedValue("overview");
  mocks.status.mockResolvedValue({resolvedSkills:[{skill}]});mocks.open.mockResolvedValue({id:runId});mocks.links.mockResolvedValue([]);mocks.record.mockResolvedValue(null);
  mocks.callback.mockReturnValue({value:"callback"});
  mocks.close.mockResolvedValue(undefined);mocks.admitted.mockResolvedValue(undefined);mocks.settled.mockResolvedValue(undefined);
});
function preparation(): AgentPrepareRequest {return {mode:"run",agent:{providerId:"workbench",agentId},sessionId,runId,inputId:runId,input:{role:"user",content:"Review knowledge",timestamp:1},language:"en",authority:{classNames:[],executionKind:"live"},requestedBy:null,root:{session:{providerId:"workbench",sessionId},runId},actor:{id:runId,domainId:"domain"}};}
it("governance-only preparation registers caller bounds without query preparation or opening a report",async()=>{
  mocks.overview.mockRejectedValue(new Error("Query permission denied"));
  const prepared=await assistantService.prepare(preparation(),owner,{token:"user"});
  expect(prepared.definition).toMatchObject({agentId,modelId:"provider/model",skills:[skill]});
  expect(prepared.environment.values).toMatchObject({ONTOMATO_ASSISTANT_SESSION_ID:sessionId,ONTOMATO_SKILL_SCENARIO:"platform",ONTOMATO_ONTOLOGY_URL:"http://ontology"});
  expect(prepared.environment.values).not.toHaveProperty("ONTOMATO_RETRIEVAL_CALLER_ID");
  expect(mocks.callback.mock.calls[0][0].expiresAt).toBe(new Date((await mocks.turn()).created_at).getTime()+900_000);
  expect(mocks.overview).not.toHaveBeenCalled();expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({continuationIds:[],recentUserMessages:[],executionUserId:null}),{token:"user"});expect(mocks.recordWindow).not.toHaveBeenCalled();
});
it("the selected query skill opens and records its actual scope regardless of preset kind",async()=>{
  const querySkill={namespace:{kind:"provider",provider:"ontology"},name:"ontomato-analyst-assistant"};
  const agent=await mocks.agent();mocks.agent.mockResolvedValue({...agent,kind:"knowledge-governance",skills:[querySkill]});mocks.skills.mockResolvedValue([querySkill]);
  const prepared=await assistantService.prepare(preparation(),owner,{token:"user"});
  expect(mocks.overview).toHaveBeenCalled();expect(mocks.scope).toHaveBeenCalledWith(runId,owner,runId);
  expect(prepared.environment.values.ONTOMATO_RETRIEVAL_CALLER_ID).toBe(runId);
});
it("a failed scope opening never records an opened scope",async()=>{
  const querySkill={namespace:{kind:"provider",provider:"ontology"},name:"ontomato-analyst-assistant"};
  mocks.skills.mockResolvedValue([querySkill]);mocks.open.mockRejectedValue(new Error("admission failed"));
  await expect(assistantService.prepare(preparation(),owner,{token:"user"})).rejects.toThrow("admission failed");
  expect(mocks.scope).not.toHaveBeenCalled();
});
it("cancellation follows the round's saved scope after definition skills change",async()=>{
  mocks.turn.mockResolvedValue({id:runId,session_id:sessionId,retrieval_scope_id:runId});
  await assistantService.cancelScope(runId,owner,{token:"user"});
  expect(mocks.scopeClose).toHaveBeenCalledWith({token:"user"});
  mocks.scopeClose.mockClear();mocks.turn.mockResolvedValue({id:runId,session_id:sessionId,retrieval_scope_id:null});
  await assistantService.cancelScope(runId,owner,{token:"user"});expect(mocks.scopeClose).not.toHaveBeenCalled();
});
it("closes the Java gate before asking the runtime to stop",async()=>{
  let closed=false;mocks.close.mockImplementation(async()=>{closed=true;});mocks.request.mockImplementation(async()=>{expect(closed).toBe(true);});
  mocks.run.mockRejectedValue(new HttpError(404,"not admitted"));
  await expect(assistantService.cancel(sessionId,runId,owner,{token:"user"})).resolves.toEqual({run:null});
  expect(mocks.close).toHaveBeenCalledWith(runId,owner);
});
it("a custom agent's provider result follows its saved governance record",async()=>{
  mocks.record.mockImplementation(async id=>id===runId?agentId:null);mocks.run.mockResolvedValue({run:{id:runId,sessionId,status:"running",stopReason:null},messages:[],artifacts:[]});
  const result=await agentChannelService.read({actor:{id:runId,domainId:"domain"},execution:{session:{providerId:"workbench",sessionId},runId}},"domain");
  expect(result).toMatchObject({process:{mode:"page",href:`/governance/reports/${agentId}`},results:[{href:`/governance/reports/${agentId}`} ]});
});

it("steering a governance-only run does not turn its registered caller scope into query preparation",async()=>{
 mocks.turn.mockResolvedValue({id:runId,session_id:sessionId,retrieval_scope_id:runId});
 mocks.agent.mockRejectedValue(new Error("do not reload changed definitions"));
 await expect(agentChannelService.prepare({...preparation(),mode:"steer"},"domain")).resolves.toEqual({accepted:true});
 expect(mocks.overview).not.toHaveBeenCalled();
});
