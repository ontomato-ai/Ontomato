import {beforeEach,expect,it,vi} from 'vitest';
import {createObjectView} from '@ontomato/contracts/object-views';
const mocks=vi.hoisted(()=>({post:vi.fn(),describe:vi.fn(),dashboard:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,backendGet:vi.fn(),buildBackendHeaders:()=>({tk:'caller'})}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=mocks.describe;}}));
vi.mock('../../dashboard/access',()=>({getOwnedDashboard:mocks.dashboard}));
import {validateProduct} from '../validation';
const owner={domainId:'d',userId:'alice'};
const input={name:'View',description:'',visibility:'private' as const,document:{kind:'object-view' as const,className:'Order',form:'full' as const}};
beforeEach(()=>{vi.resetAllMocks();});
it('rejects legacy object reads even when the class view has been published',async()=>{
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{publishedRevision:1,versions:[{document:createObjectView('Order')}]}})});
  await expect(validateProduct(owner,input,{token:'caller'})).rejects.toMatchObject({code:'LEGACY_INLINE_LOGIC'});
});
it('checks underlying published metric output and parameter contracts',async()=>{
  const document=createObjectView('Order');
  const widget=document.tabs[0].sections[0].widgets[0];widget.resourceId='details';widget.fields=['name'];widget.parameters={id:{source:'context',path:'primaryKey'}};
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{publishedRevision:1,versions:[{document}]}})});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'name'}],parameterDefs:[{name:'id'}]});
  await expect(validateProduct(owner,input,{token:'caller'})).resolves.toBeUndefined();
  mocks.describe.mockResolvedValue({status:'PENDING_REVIEW',outputColumns:[],parameterDefs:[]});
  await expect(validateProduct(owner,input,{token:'caller'})).rejects.toMatchObject({code:'UNPUBLISHED_CAPABILITY'});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'different'}],parameterDefs:[{name:'id'}]});
  await expect(validateProduct(owner,input,{token:'caller'})).rejects.toMatchObject({code:'INVALID_PRODUCT_FIELD'});
});
