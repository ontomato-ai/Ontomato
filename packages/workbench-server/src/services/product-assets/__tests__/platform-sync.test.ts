import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),query:vi.fn(),agents:vi.fn(),access:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendGet:mocks.get,backendPost:mocks.post,buildBackendHeaders:()=>({})}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology'}}}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'service'})}}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(action:(client:{query:typeof mocks.query})=>unknown)=>action({query:mocks.query})}));
vi.mock('../store',()=>({lockProducts:async()=>{}}));
vi.mock('../ontology',()=>({ontologyRegistration:()=>null,synchronizeProductOntology:async()=>{}}));
vi.mock('../grants',()=>({registerProductResource:async()=>{}}));
vi.mock('../../assistant/store',()=>({assistantStore:{agents:mocks.agents}}));
vi.mock('../../app-builder/access',()=>({assertAppBuilderAccess:mocks.access}));
import {ensurePlatformAssets,synchronizePlatformAssets} from '../platform-assets';
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
it('registers a native application without an empty placeholder page',async()=>{
 const documents:{id:string;document:{kind:string;children:unknown[]}}[]=[];
 mocks.get.mockResolvedValue({text:JSON.stringify({data:[{id:'home',names:{en:'Home'}}]})});
 mocks.query.mockImplementation(async(sql:string,args:unknown[])=>{
  if(sql.startsWith('INSERT INTO product_assets(')){
   documents.push({id:String(args[1]),document:JSON.parse(String(args[5]))});
   return {rows:[{revision:1,created_at:new Date(),updated_at:new Date()}]};
  }
  return {rows:[]};
 });
 await synchronizePlatformAssets({domainId:'native-home',userId:'admin'},{},false);
 expect(documents.some(asset=>asset.document.kind==='page')).toBe(false);
 expect(documents.find(asset=>asset.document.kind==='application')?.document.children).toEqual([]);
});
