import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),query:vi.fn(),agents:vi.fn(),access:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendGet:mocks.get,backendPost:mocks.post,buildBackendHeaders:()=>({})}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology'}}}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'service'})}}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(action:(tx:{query:unknown})=>unknown)=>action({query:mocks.query})}));
vi.mock('../store',()=>({lockProducts:async()=>{}}));
vi.mock('../ontology',()=>({ontologyRegistration:()=>null,synchronizeProductOntology:async()=>{}}));
vi.mock('../../assistant/store',()=>({assistantStore:{agents:mocks.agents}}));
vi.mock('../../app-builder/access',()=>({assertAppBuilderAccess:mocks.access}));
import {ensurePlatformAssets} from '../platform-assets';
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue({rows:[]});mocks.agents.mockResolvedValue([]);});
it('does not let an ordinary viewer register shared platform resources',async()=>{
 mocks.get.mockResolvedValue({text:JSON.stringify({success:true,data:{allowed:false}})});
 await ensurePlatformAssets({domainId:'ordinary',userId:'viewer'},{});
 expect(mocks.post).not.toHaveBeenCalled();expect(mocks.agents).not.toHaveBeenCalled();
});
it('coalesces concurrent authorized reconciliation and does not repeat completed work on every read',async()=>{
 mocks.get.mockImplementation(async(endpoint:string)=>({text:JSON.stringify(endpoint==='platform-sync-permission'?{success:true,data:{allowed:true}}:{data:[]})}));
 const owner={domainId:'concurrent',userId:'admin'};
 await Promise.all([ensurePlatformAssets(owner,{}),ensurePlatformAssets(owner,{})]);await ensurePlatformAssets(owner,{});
 expect(mocks.agents).toHaveBeenCalledTimes(1);
});
