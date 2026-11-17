import {beforeEach,expect,it,vi} from 'vitest';
import {createObjectView} from '@ontomato/contracts/object-views';
const mocks=vi.hoisted(()=>({post:vi.fn(),describe:vi.fn(),dashboard:vi.fn()}));
const definitions=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../definitions',()=>({readDefinition:definitions.read}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,backendGet:vi.fn(),buildBackendHeaders:()=>({tk:'caller'})}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=mocks.describe;}}));
vi.mock('../../dashboard/access',()=>({getOwnedDashboard:mocks.dashboard}));
import {validateProduct} from '../validation';
const owner={domainId:'d',userId:'alice'};
const input={name:'View',description:'',visibility:'private' as const,document:{kind:'object-view' as const,className:'Order',form:'full' as const}};
beforeEach(()=>{vi.resetAllMocks();});
it('rejects legacy object reads even when the class view has been published',async()=>{
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{publishedRevision:1,versions:[{revision:1,document:createObjectView('Order')}]}})});
  await expect(validateProduct(owner,input,{token:'caller'})).rejects.toMatchObject({code:'LEGACY_INLINE_LOGIC'});
});
it('checks underlying published metric output and parameter contracts',async()=>{
  const document=createObjectView('Order');
  const widget=document.tabs[0].sections[0].widgets[0];if(widget.kind==='chart')throw new Error('Expected properties');widget.resourceId='details';widget.fields=['name'];widget.parameters={id:{source:'context',path:'primaryKey'}};
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{publishedRevision:1,versions:[{revision:2,document:createObjectView('Order')},{revision:1,document}]}})});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'name'}],parameterDefs:[{name:'id'}]});
  await expect(validateProduct(owner,input,{token:'caller'})).resolves.toBeUndefined();
  mocks.describe.mockResolvedValue({status:'PENDING_REVIEW',outputColumns:[],parameterDefs:[]});
  await expect(validateProduct(owner,input,{token:'caller'})).rejects.toMatchObject({code:'UNPUBLISHED_CAPABILITY'});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'different'}],parameterDefs:[{name:'id'}]});
  await expect(validateProduct(owner,input,{token:'caller'})).rejects.toMatchObject({code:'INVALID_PRODUCT_FIELD'});
});
it('rejects invalid collection output fields during save instead of waiting for execution',async()=>{
  const {productAssetInputSchema}=await import('@ontomato/contracts/product-assets');
  const collection=productAssetInputSchema.parse({name:'Members',document:{kind:'collection-view',renders:{kind:'Definition',id:'people'},parameters:{},fields:['salary']}});
  definitions.read.mockResolvedValue({objectType:'Person',parameters:[]});
  mocks.post.mockResolvedValue({text:JSON.stringify({classes:[{className:'Person',attrs:[{name:'name'}]}]})});
  await expect(validateProduct(owner,collection,{})).rejects.toMatchObject({code:'INVALID_PRODUCT_FIELD'});
});
it('rejects capability configuration hidden inside an ObjectView',async()=>{
  const {productAssetInputSchema}=await import('@ontomato/contracts/product-assets');
  const layout=createObjectView('Person');
  layout.tabs[0].sections[0].widgets[0].resourceId='details';
  const view=productAssetInputSchema.parse({name:'Person',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'full',layout}});
  await expect(validateProduct(owner,view,{})).rejects.toMatchObject({code:'LEGACY_INLINE_LOGIC'});
});

function chartFile(): import('@ontomato/contracts/chart-data').ChartFile {return {dataset:[{id:'metric',dimensions:['name','value'],source:[]}],series:[{id:'main',type:'bar',datasetId:'metric',encode:{x:'name',y:'value'}}],ontomato:{}};}
it('validates MetricWidget chart columns, empty snapshots and parameter signatures at admission',async()=>{
  const {productAssetInputSchema}=await import('@ontomato/contracts/product-assets');
  const chart=productAssetInputSchema.parse({name:'Chart',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'metric'},renderer:'chart',chartFile:chartFile(),parameters:{}}});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'name'},{key:'value'}],parameterDefs:[]});
  await expect(validateProduct(owner,chart,{})).resolves.toBeUndefined();
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'name'}],parameterDefs:[]});
  await expect(validateProduct(owner,chart,{})).rejects.toMatchObject({code:'CARD_OUTPUT_MISMATCH',details:{missingColumns:['value']}});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'name'},{key:'value'}],parameterDefs:[]});
  if(chart.document.kind!=='metric-widget'||chart.document.renderer!=='chart')throw new Error('Expected chart');
  chart.document.chartFile.dataset[0].source=[{name:'A',value:1}];
  expect(productAssetInputSchema.safeParse(chart).success).toBe(false);
});
it('admits only chart-file widgets in ObjectViews and checks their MetricView columns',async()=>{
  const {productAssetInputSchema}=await import('@ontomato/contracts/product-assets');
  const layout=createObjectView('platform:people');
  layout.tabs[0].sections[0].widgets=[{id:'chart',kind:'chart',title:'Chart',span:12,height:240,resourceId:'metric',chartFile:chartFile(),parameters:{}}];
  const chart=productAssetInputSchema.parse({name:'Chart',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'platform:people'},renderer:'full',layout}});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',outputColumns:[{key:'name'}],parameterDefs:[]});
  await expect(validateProduct(owner,chart,{})).rejects.toMatchObject({code:'CARD_OUTPUT_MISMATCH'});
  mocks.describe.mockResolvedValue({status:'PENDING_REVIEW',outputColumns:[{key:'name'},{key:'value'}],parameterDefs:[]});
  await expect(validateProduct(owner,chart,{})).rejects.toMatchObject({code:'UNPUBLISHED_CAPABILITY'});
});
