import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),agent:vi.fn(),validate:vi.fn()}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../assistant/store',()=>({assistantStore:{agent:mocks.agent}}));
vi.mock('../../../platform/agent-runtime/model-selection',()=>({validateModelSelection:mocks.validate}));
import {saveBuilderModel} from '../agents';
import {isAppBuilderKind} from '../definition';
beforeEach(()=>{vi.resetAllMocks();});
it('keeps builder variants on the workspace execution boundary',()=>{
 expect(isAppBuilderKind('app-builder:variant')).toBe(true);
 expect(isAppBuilderKind('app-builder-unrelated')).toBe(false);
});
it('does not configure an ordinary agent through builder administration',async()=>{
 mocks.agent.mockResolvedValue({kind:'regular'});
 await expect(saveBuilderModel({domainId:'d',userId:'u'},'agent',{modelId:null})).rejects.toMatchObject({status:404});
 expect(mocks.query).not.toHaveBeenCalled();
});
it('validates the model in the selected domain before persisting a builder variant',async()=>{
 mocks.agent.mockResolvedValue({kind:'app-builder:variant'});
 await saveBuilderModel({domainId:'d',userId:'u'},'agent',{modelId:'provider/model'});
 expect(mocks.validate).toHaveBeenCalledWith('d',{modelId:'provider/model'});
 expect(mocks.query.mock.calls[0][1]).toEqual(['d','agent','{"modelId":"provider/model"}']);
});
