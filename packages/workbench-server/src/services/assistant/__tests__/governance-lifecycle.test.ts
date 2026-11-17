import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "../../../utils/errors";
const mocks=vi.hoisted(()=>({query:vi.fn(),agent:vi.fn(),session:vi.fn(),turn:vi.fn(),create:vi.fn(),reserve:vi.fn(),admitted:vi.fn(),settled:vi.fn(),close:vi.fn(),access:vi.fn(),skills:vi.fn(),request:vi.fn(),run:vi.fn(),retrieval:vi.fn(),overview:vi.fn()}));
vi.mock("../store",()=>({assistantStore:{agent:mocks.agent,session:mocks.session,turn:mocks.turn,create:mocks.create,reserve:mocks.reserve,admitted:mocks.admitted,settled:mocks.settled,runKind:async()=>"knowledge-governance"}}));
vi.mock("../governance",()=>({closeGovernanceWindow:mocks.close,requireGovernanceAccess:mocks.access}));
vi.mock("../skills",()=>({prepareAssistantSkills:mocks.skills}));
vi.mock("../context",()=>({assistantOntologyContext:mocks.overview}));
vi.mock("../ontology-retrieval",()=>({OntologyRetrievalClient:class {constructor(){mocks.retrieval();}}}));
vi.mock("../prompts",()=>({effectiveSystemPrompt:()=>"Governance instructions"}));
vi.mock("../../skills/operations",()=>({withDomainSkills:async(_domain:string,fn:()=>Promise<unknown>)=>fn()}));
vi.mock("../../product-assets/platform-assets",()=>({nativeProfileId:async()=>null}));
vi.mock("../../product-assets/agent-profile",()=>({agentProfileForPrincipal:async()=>null}));
vi.mock("../../agent-runtime/callback-credential",()=>({callbackCredential:()=>({value:"callback"})}));
vi.mock("../../../config/application",()=>({config:{dataQuery:{baseUrl:"http://ontology"}}}));
vi.mock("../../../config/environment",()=>({environment:{agentRuntime:()=>({callbackUrl:"http://workbench"})}}));
vi.mock("../../../infrastructure/postgres",()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock("../../../infrastructure/agent-runtime/client",()=>({RuntimeClient:class {request=mocks.request;run=mocks.run;}}));
vi.mock("../../../platform/agent-runtime/runtime",()=>({userSkillEnvironment:()=>({values:{ONTOMATO_ONTOLOGY_URL:"http://ontology",ONTOMATO_SKILL_SCENARIO:"platform"},secrets:{ONTOMATO_TK:"user"}}),runDefinition:(systemPrompt:string,modelId:string,skills:unknown[])=>({systemPrompt,modelId,skills})}));
import { assistantService } from "../service";
import type { AgentPrepareRequest } from "@ontomato/contracts/agent-channel";
configureI18n({defaultLocale:"en",appTextLocale:"en",languageSwitchEnabled:false,packs:{en:{messages:en,...enLocaleMeta}}});
const owner={domainId:"domain",userId:"user"},sessionId="11111111-1111-4111-8111-111111111111",runId="22222222-2222-4222-8222-222222222222",agentId="33333333-3333-4333-8333-333333333333";
const skill={namespace:{kind:"provider",provider:"ontology"},name:"knowledge-governance"};
beforeEach(()=>{
  vi.clearAllMocks();
  mocks.agent.mockResolvedValue({id:agentId,kind:"knowledge-governance",enabled:true,class_names:[],skills:[skill],model_selection:{modelId:"provider/model"},enabled_mcp_service_ids:[]});
  const session={id:sessionId,agent_id:agentId,owner_id:"user",domain_id:"domain",workspace_id:null};
  const turn={id:runId,session_id:sessionId,created_at:new Date()};
  mocks.session.mockResolvedValue(session);mocks.turn.mockResolvedValue(turn);
  mocks.create.mockResolvedValue({row:session});mocks.reserve.mockResolvedValue({row:turn});
  mocks.query.mockResolvedValue({rows:[{session_id:sessionId}]});mocks.skills.mockResolvedValue([skill]);
  mocks.close.mockResolvedValue(undefined);mocks.admitted.mockResolvedValue(undefined);mocks.settled.mockResolvedValue(undefined);
});
function preparation(): AgentPrepareRequest {return {mode:"run",agent:{providerId:"workbench",agentId},sessionId,runId,inputId:runId,input:{role:"user",content:"Review knowledge",timestamp:1},language:"en",authority:{classNames:[],executionKind:"live"},requestedBy:null,root:{session:{providerId:"workbench",sessionId},runId},actor:{id:runId,domainId:"domain"}};}
it("prepares governance through the ordinary provider without requiring query access or opening a report",async()=>{
  mocks.overview.mockRejectedValue(new Error("Query permission denied"));
  const prepared=await assistantService.prepare(preparation(),owner,{token:"user"});
  expect(prepared.definition).toMatchObject({agentId,modelId:"provider/model",skills:[skill]});
  expect(prepared.environment.values).toMatchObject({ONTOMATO_ASSISTANT_SESSION_ID:sessionId,ONTOMATO_SKILL_SCENARIO:"platform",ONTOMATO_ONTOLOGY_URL:"http://ontology"});
  expect(prepared.environment.values).not.toHaveProperty("ONTOMATO_RETRIEVAL_CALLER_ID");
  expect(mocks.overview).not.toHaveBeenCalled();expect(mocks.retrieval).not.toHaveBeenCalled();expect(mocks.close).not.toHaveBeenCalled();
});
it("closes the Java gate before asking the runtime to stop",async()=>{
  let closed=false;mocks.close.mockImplementation(async()=>{closed=true;});
  mocks.request.mockImplementation(async()=>{expect(closed).toBe(true);});
  mocks.run.mockRejectedValue(new HttpError(404,"not admitted"));
  await expect(assistantService.cancel(sessionId,runId,owner,{token:"user"})).resolves.toEqual({run:null});
  expect(mocks.close).toHaveBeenCalledWith(runId,owner.domainId);
});
it("closes failed admission and terminal runs through the same data-service boundary",async()=>{
  mocks.skills.mockRejectedValueOnce(new Error("Skill admission failed"));
  await expect(assistantService.prepare(preparation(),owner,{token:"user"})).rejects.toThrow("Skill admission failed");
  expect(mocks.close).toHaveBeenCalledWith(runId,owner.domainId);
  await assistantService.settleTurn(runId,owner);
  await assistantService.cancelScope(runId,owner,{token:"user"});
  expect(mocks.retrieval).not.toHaveBeenCalled();expect(mocks.settled).toHaveBeenCalledWith(runId);
});
