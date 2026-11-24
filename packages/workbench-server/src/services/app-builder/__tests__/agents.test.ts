import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),appBuilder:vi.fn(),validate:vi.fn()}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../assistant/store',()=>({assistantStore:{appBuilder:mocks.appBuilder}}));
vi.mock('../../../platform/agent-runtime/model-selection',()=>({validateModelSelection:mocks.validate}));
import {saveBuilderModel} from '../agents';
import {isAppBuilderKind} from '../definition';
beforeEach(()=>{vi.resetAllMocks();});
it('keeps builder variants on the workspace execution boundary',()=>{
 expect(isAppBuilderKind('app-builder:variant')).toBe(true);
 expect(isAppBuilderKind('app-builder-unrelated')).toBe(false);
});
it('does not configure an ordinary agent through builder administration',async()=>{
 mocks.appBuilder.mockResolvedValue({id:'builder'});
 await expect(saveBuilderModel({domainId:'d',userId:'u'},'agent',{modelId:null})).rejects.toMatchObject({status:404});
 expect(mocks.query).not.toHaveBeenCalled();
});
it('validates the model in the selected domain before persisting the domain builder',async()=>{
 mocks.appBuilder.mockResolvedValue({id:'agent'});
 await saveBuilderModel({domainId:'d',userId:'u'},'agent',{modelId:'provider/model'});
 expect(mocks.validate).toHaveBeenCalledWith('d',{modelId:'provider/model'});
 expect(mocks.query.mock.calls[0][1]).toEqual(['d','agent','{"modelId":"provider/model"}']);
});
