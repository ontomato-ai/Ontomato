import {beforeEach,expect,it,vi} from 'vitest';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({dashboard:vi.fn(),post:vi.fn()}));
vi.mock('../../dashboard/access',()=>({getOwnedDashboard:mocks.dashboard}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({tk:'caller'})}));
import {expandedProductDependencies} from '../dependencies';
beforeEach(()=>{vi.clearAllMocks();});
it('expands referenced service definitions using caller credentials and deduplicates capabilities',async()=>{
  const base={ownerId:'alice',revision:1,createdAt:'now',updatedAt:'now',editable:true,visibility:'private',description:''};
  const root=productAssetSchema.parse({...base,id:'view',name:'Details',document:{kind:'object-view',className:'Order',form:'full'}});
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{versions:[{document:{schemaVersion:1,className:'Order',title:'Details',tabs:[{id:'t',title:'t',sections:[{id:'s',title:'',widgets:[{id:'a',kind:'properties',title:'Details',span:12,resourceId:'metric'},{id:'b',kind:'table',title:'Rows',span:12,resourceId:'metric'}]}]}]}}]}})});
  const result=await expandedProductDependencies({domainId:'d',userId:'alice'},{token:'caller'},root,[root]);
  expect(result.references.filter(reference=>reference.kind==='metric')).toEqual([{kind:'metric',id:'metric'}]);
  expect(mocks.post.mock.calls[0][3].headers).toEqual({tk:'caller'});
});
it('expands dashboard cards without exposing another owners dashboard',async()=>{
  const root=productAssetSchema.parse({ownerId:'alice',revision:1,createdAt:'now',updatedAt:'now',editable:true,visibility:'private',description:'',id:'board',name:'Board',document:{kind:'dashboard',dashboardId:'personal'}});
  mocks.dashboard.mockResolvedValue({groups:[{charts:[],metrics:[{query:{kind:'metric',metricId:'count'}}]}]});
  expect((await expandedProductDependencies({domainId:'d',userId:'alice'},{},root,[root])).references).toContainEqual({kind:'metric',id:'count'});
  expect(mocks.dashboard).toHaveBeenCalledWith('alice','d','personal');
  mocks.dashboard.mockRejectedValue(new Error('Unavailable'));
  await expect(expandedProductDependencies({domainId:'d',userId:'bob'},{},root,[root])).rejects.toThrow('Unavailable');
});
