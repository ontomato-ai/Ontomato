import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({profile:vi.fn(),skills:vi.fn(),environment:vi.fn(),open:vi.fn(),callback:vi.fn(),principal:vi.fn(),native:vi.fn(),use:vi.fn(),check:vi.fn()}));
vi.mock('../../product-assets/agent-profile',()=>({profileForSession:mocks.profile}));
vi.mock('../../product-assets/platform-assets',()=>({nativeProfileId:mocks.native}));
vi.mock('../../product-assets/grants',()=>({requireProductUse:mocks.use}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.check,buildBackendHeaders:()=>({})}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
vi.mock('../prompts',()=>({effectiveSystemPrompt:()=> 'Instructions'}));
vi.mock('../../../i18n',()=>({resolveLocale:(locale:string)=>locale}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({callbackUrl:'http://workbench.test'})}}));
vi.mock('../../product-assets/agent-principal',()=>({agentPrincipalCredentials:mocks.principal}));
vi.mock('../skills',()=>({prepareAssistantSkills:mocks.skills}));
vi.mock('../context',()=>({assistantOntologyContext:vi.fn()}));
vi.mock('../store',()=>({assistantStore:{turns:async()=>[]}}));
vi.mock('../../../infrastructure/agent-runtime/client',()=>({RuntimeClient:class{session=async()=>({messages:[]});}}));
vi.mock('../../../platform/agent-runtime/runtime',()=>({runDefinition:(_prompt:string,_model:unknown,skills:unknown,_locale:unknown,externalMcp:unknown)=>({skills,externalMcp}),userSkillEnvironment:mocks.environment}));
vi.mock('../ontology-retrieval',()=>({OntologyRetrievalClient:class{open=mocks.open;}}));
vi.mock('../../agent-runtime/callback-credential',()=>({callbackCredential:mocks.callback}));
import {prepareAnalystRun,type AssistantPreparation} from '../prepare';
beforeEach(()=>{vi.resetAllMocks();});
it('limits a Profile run to its projection tools without passing human business credentials or inherited skills',async()=>{
  mocks.profile.mockResolvedValue({id:'profile',principalId:'agent',releaseId:'release',instructions:'Instructions',tools:[],contextViews:[]});
  mocks.principal.mockResolvedValue({token:'agent-execution'});mocks.callback.mockReturnValue({value:'sealed-callback'});
  const request={a:{skills:[{name:'inherited'}],enabled_mcp_service_ids:['inherited'],model_selection:{modelId:null}},session:{id:'session',agent_id:'agent'},turn:{id:'run',created_at:new Date(),retrieval_scope_id:'scope',class_names:[]},message:'Question',input:{role:'user',content:'Question',timestamp:1},ontologyContext:null,owner:{domainId:'domain',userId:'human'},credentials:{token:'human-secret',locale:'en'}} as unknown as AssistantPreparation;
  const run=await prepareAnalystRun(request);
  expect(run.definition.skills).toEqual([]);expect(run.definition.externalMcp).toEqual([]);
  expect(run.definition.toolSurface).toBe('product');
  expect(run.environment.secrets).toEqual({ONTOMATO_PRODUCT_CALLBACK:'sealed-callback'});
  expect(run.environment.values.ONTOMATO_WORKBENCH_URL).toBe('http://workbench.test');
  expect(mocks.environment).not.toHaveBeenCalled();expect(mocks.skills).not.toHaveBeenCalled();expect(mocks.open).not.toHaveBeenCalled();
  expect(JSON.stringify(run)).not.toContain('human-secret');
});
function nativeRequest(){return {a:{id:'agent',skills:[{name:'analyst'}],enabled_mcp_service_ids:['external'],model_selection:{modelId:null}},session:{id:'session',agent_id:'agent'},turn:{id:'run',created_at:new Date(),retrieval_scope_id:'scope',class_names:[]},message:'Question',owner:{domainId:'domain',userId:'human'},credentials:{token:'human-secret',locale:'en'}} as unknown as AssistantPreparation;}
it('preserves native tools and current-user data credentials after identity authorization',async()=>{
 mocks.native.mockResolvedValue('native-profile');mocks.check.mockResolvedValue({text:JSON.stringify({allowed:true})});
 mocks.skills.mockResolvedValue([{name:'analyst'}]);mocks.environment.mockReturnValue({values:{},secrets:{tk:'human-secret'}});
 const run=await prepareAnalystRun(nativeRequest());
 expect(mocks.use).toHaveBeenCalledWith({domainId:'domain',userId:'human'},'native-profile');
 expect(mocks.use).toHaveBeenCalledWith({domainId:'domain',userId:'human'},'agent');
 expect(run.definition.skills).toEqual([{name:'analyst'}]);expect(run.definition.externalMcp).toEqual([{id:'external'}]);
 expect(run.environment.secrets).toEqual({tk:'human-secret'});expect(run.definition.toolSurface).toBeUndefined();
 expect(mocks.principal).not.toHaveBeenCalled();
});
it('rejects a disabled native identity before preparing its tools or credentials',async()=>{
 mocks.native.mockResolvedValue('native-profile');mocks.check.mockResolvedValue({text:JSON.stringify({allowed:false})});
 await expect(prepareAnalystRun(nativeRequest())).rejects.toMatchObject({status:403,code:'AGENT_PRINCIPAL_FORBIDDEN'});
 expect(mocks.environment).not.toHaveBeenCalled();expect(mocks.skills).not.toHaveBeenCalled();
});
it('rejects a native run when the Profile use grant has been revoked',async()=>{
 mocks.native.mockResolvedValue('native-profile');mocks.use.mockRejectedValue(Object.assign(new Error('Forbidden'),{status:403}));
 await expect(prepareAnalystRun(nativeRequest())).rejects.toMatchObject({status:403});
 expect(mocks.check).not.toHaveBeenCalled();expect(mocks.environment).not.toHaveBeenCalled();
});
