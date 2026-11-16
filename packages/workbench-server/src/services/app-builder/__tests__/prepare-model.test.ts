import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({definition:vi.fn((..._args:unknown[])=>({})),authorize:vi.fn()}));
vi.mock('../build-tests',()=>({WorkspaceBuildTests:class{authorize=mocks.authorize;}}));
vi.mock('../sdk',()=>({currentAppSdk:async()=>({version:'sdk'})}));
vi.mock('../../../platform/agent-runtime/runtime',()=>({runDefinition:mocks.definition,userSkillEnvironment:()=>({values:{},secrets:{}})}));
vi.mock('../../assistant/prompts',()=>({effectiveSystemPrompt:()=>''}));
import {prepareAppBuilderRun} from '../prepare';
it('uses a builder variants selected model when preparing its runtime definition',async()=>{
 await prepareAppBuilderRun({a:{id:'builder',kind:'app-builder:variant',model_selection:{modelId:'provider/model'}},session:{id:'session',workspace_id:'workspace'},turn:{id:'turn',created_at:new Date()},message:'Build',owner:{domainId:'domain',userId:'user'},credentials:{locale:'en'}} as Parameters<typeof prepareAppBuilderRun>[0]);
 expect(mocks.definition.mock.calls[0][1]).toBe('provider/model');
});
