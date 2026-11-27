import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({definition:vi.fn((..._args:unknown[])=>({})),callback:vi.fn(()=>({value:'wbc1.sealed'}))}));
vi.mock('../sdk',()=>({currentAppSdk:async()=>({version:'sdk'})}));
vi.mock('../../../platform/agent-runtime/runtime',()=>({runDefinition:mocks.definition}));
vi.mock('../../agent-runtime/skills',()=>({workbenchBuiltinSkillRoot:()=>'/skills',publishSkill:async(_root:string,skill:unknown)=>({skill,digest:'a'.repeat(64)})}));
vi.mock('../../assistant/prompts',()=>({effectiveSystemPrompt:()=>''}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({callbackUrl:'http://workbench.test'})}}));
vi.mock('../../agent-runtime/callback-credential',()=>({callbackCredential:mocks.callback}));
import {prepareAppBuilderRun} from '../prepare';
it('uses the app-builder selected model and declares run-scoped business callbacks',async()=>{
 const run=await prepareAppBuilderRun({a:{id:'builder',kind:'app-builder',model_selection:{modelId:'provider/model'}},session:{id:'session',workspace_id:'workspace'},turn:{id:'turn',created_at:new Date()},message:'Build',owner:{domainId:'domain',userId:'user'},credentials:{locale:'en',token:'human-secret'}} as Parameters<typeof prepareAppBuilderRun>[0]);
 expect(mocks.definition.mock.calls[0][1]).toBe('provider/model');
 expect(run).not.toHaveProperty("environment");
 expect(run.businessCallbacks).toEqual({
   workbench:{owner: "workbench", credentialHeader: "X-Ontomato-Callback-Credential", pathPrefix: new URL('http://workbench.test/api/assistant/executions/turn/workbench').pathname, baseUrl:'http://workbench.test/api/assistant/executions/turn/workbench',credential:'wbc1.sealed'},
   ontology:{owner: "workbench", credentialHeader: "X-Ontomato-Callback-Credential", pathPrefix: new URL('http://workbench.test/api/assistant/executions/turn/ontology').pathname, baseUrl:'http://workbench.test/api/assistant/executions/turn/ontology',credential:'wbc1.sealed'},
   authoring:{owner: "workbench", credentialHeader: "X-Ontomato-Callback-Credential", pathPrefix: new URL('http://workbench.test/api/assistant/executions/turn/authoring').pathname, baseUrl:'http://workbench.test/api/assistant/executions/turn/authoring',credential:'wbc1.sealed'},
   panelOperations:{owner: "workbench", credentialHeader: "X-Ontomato-Callback-Credential", pathPrefix: new URL('http://workbench.test/api/assistant/executions/turn/panels').pathname, baseUrl:'http://workbench.test/api/assistant/executions/turn/panels',credential:'wbc1.sealed'},
 });
 expect(JSON.stringify(run)).not.toContain('human-secret');
});
