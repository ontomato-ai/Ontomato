import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({profile:vi.fn(),source:vi.fn(),record:vi.fn(),skills:vi.fn(),environment:vi.fn(),open:vi.fn(),callback:vi.fn(),overview:vi.fn()}));
vi.mock('../../product-assets/agent-profile',()=>({profileForSession:mocks.profile,profileSourceForSession:mocks.source}));
vi.mock('../../../utils/backend-client',()=>({backendPost:vi.fn(),buildBackendHeaders:(_token:unknown,_user:unknown,_locale:unknown,_key:unknown,headers:unknown)=>headers??({})}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
vi.mock('../prompts',()=>({effectiveSystemPrompt:()=> 'Instructions'}));
vi.mock('../../../i18n',()=>({resolveLocale:(locale:string)=>locale}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({callbackUrl:'http://workbench.test'})}}));
vi.mock('../skills',()=>({needsRetrievalScope:(skills:unknown[])=>skills.length>0,hasGovernanceSkill:()=>false,prepareAssistantSkills:mocks.skills}));
vi.mock('../context',()=>({assistantOntologyContext:mocks.overview}));
vi.mock('../store',()=>({assistantStore:{turns:async()=>[],recordRetrievalScope:mocks.record}}));
vi.mock('../../../infrastructure/agent-runtime/client',()=>({RuntimeClient:class{session=async()=>({messages:[{id:'input',messageSeq:1,message:{role:'user',content:'Question',timestamp:1}}]});}}));
vi.mock('../../../platform/agent-runtime/runtime',()=>({messageText:(message:{content:string})=>message.content,runDefinition:(_prompt:string,_model:unknown,skills:unknown,_locale:unknown,externalMcp:unknown)=>({skills,externalMcp}),userSkillEnvironment:mocks.environment}));
vi.mock('../ontology-retrieval',()=>({OntologyRetrievalClient:class{open=mocks.open;}}));
vi.mock('../../agent-runtime/callback-credential',()=>({callbackCredential:mocks.callback}));
import {prepareAnalystRun,type AssistantPreparation} from '../prepare';
function request(executionUserId:string|null=null):AssistantPreparation {
 return {a:{id:'agent',kind:'regular',skills:[{name:'analyst'}],enabled_mcp_service_ids:['external'],model_selection:{modelId:null}},session:{id:'session',agent_id:'agent'},turn:{id:'run',created_at:new Date(),retrieval_scope_id:'run',class_names:['Person']},message:'Question',inputId:'input',input:{role:'user',content:'Question',timestamp:1},ontologyContext:null,owner:{domainId:'domain',userId:'human'},credentials:{token:'human-secret',locale:'en'},executionUserId,executionCredentials:executionUserId===null?{token:'human-secret',locale:'en'}:{apiKey:'executor-key',locale:'en',executionUserId}} as unknown as AssistantPreparation;
}
beforeEach(()=>{vi.resetAllMocks();mocks.source.mockResolvedValue(null);mocks.open.mockResolvedValue({id:"run"});mocks.profile.mockResolvedValue(null);mocks.skills.mockResolvedValue({skills:[{name:'analyst'}],pageDrafts:true});mocks.callback.mockReturnValue({value:'sealed-callback'});mocks.overview.mockResolvedValue('Ontology');mocks.environment.mockImplementation(credentials=>({values:{},secrets:{ONTOMATO_TK:credentials.token}}));});
it('limits a Profile run to frozen projection tools without inherited skills or model-readable human credentials',async()=>{
 mocks.source.mockResolvedValue({profileId:'profile'});
 mocks.profile.mockResolvedValue({id:'profile',agentId:'agent',releaseId:'release',instructions:'Instructions',tools:[],contextViews:[]});
 const run=await prepareAnalystRun(request());
 expect(run.definition.skills).toEqual([]);expect(run.definition.externalMcp).toEqual([]);expect(run.definition.toolSurface).toBe('product');
 expect(run.environment.secrets).toEqual({ONTOMATO_PRODUCT_CALLBACK:'sealed-callback'});
 expect(mocks.environment).not.toHaveBeenCalled();expect(mocks.skills).not.toHaveBeenCalled();
 expect(JSON.stringify(run)).not.toContain('human-secret');
});
it('keeps the initiator identity for caller ownership and native skills in self mode',async()=>{
 const input=request();const run=await prepareAnalystRun(input);
 expect(run.definition.skills).toEqual([{name:'analyst'}]);expect(run.definition.externalMcp).toEqual([{id:'external'}]);expect(run.definition.toolSurface).toBeUndefined();
 expect(mocks.skills).toHaveBeenCalledWith('domain',input.a,input.credentials);
 expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({executionUserId:null,classNames:['Person']}),input.credentials);
 expect(run.environment.secrets.ONTOMATO_TK).toBe('human-secret');
});
it('uses executor business credentials while page skills and caller ownership stay with the initiator',async()=>{
 const input=request('executor');const run=await prepareAnalystRun(input);
 expect(mocks.skills).toHaveBeenCalledWith('domain',input.a,input.credentials);
 expect(mocks.overview).toHaveBeenCalledWith(input.a,expect.objectContaining({apiKey:'executor-key',headers:{'X-Ontomato-Retrieval-Caller-Id':'run'}}));
 expect(mocks.profile).toHaveBeenCalledWith(input.owner,input.credentials,'session','agent',expect.objectContaining({apiKey:'executor-key'}),null);
 expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({executionUserId:'executor'}),input.credentials);
 expect(run.environment.secrets).toEqual({ONTOMATO_EXECUTION_CALLBACK:'sealed-callback'});
 expect(run.environment.values.ONTOMATO_ONTOLOGY_URL).toBe('http://workbench.test/api/assistant/executions/run/ontology');
 expect(JSON.stringify(run)).not.toContain('executor-key');expect(JSON.stringify(run)).not.toContain('human-secret');
});
