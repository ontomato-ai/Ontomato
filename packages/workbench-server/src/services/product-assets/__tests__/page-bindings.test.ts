import {beforeEach,expect,it,vi} from 'vitest';
import {productAssetSchema,productAssetInputSchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({describe:vi.fn()}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=mocks.describe;}}));
import {validatePageBindings} from '../validation';
const owner={domainId:'domain',userId:'author'};
const page=(params:unknown)=>productAssetInputSchema.parse({name:'Page',document:{kind:'page',params,children:[{assetId:'metric'}]}});
const metric=productAssetSchema.parse({id:'metric',name:'Metric',description:'',ownerId:'author',visibility:'private',revision:1,createdAt:'now',updatedAt:'now',editable:true,document:{kind:'metric-widget',renders:{kind:'MetricView',id:'count'},parameters:{person:{source:'variable',path:'selected.primaryKey'}},valueField:'count'}});
beforeEach(()=>{vi.resetAllMocks();});
it('checks typed Page bindings against the actual capability signature',async()=>{
  mocks.describe.mockResolvedValue({parameterDefs:[{name:'person',type:'TYPE_STRING'}]});
  const input=page({selected:{kind:'object',objectType:'Person'}});
  await expect(validatePageBindings(owner,input,async()=>metric,{})).resolves.toBeUndefined();
  mocks.describe.mockResolvedValue({parameterDefs:[{name:'person',type:'TYPE_NUMBER'}]});
  await expect(validatePageBindings(owner,input,async()=>metric,{})).rejects.toMatchObject({code:'INVALID_PAGE_PARAMETER'});
});
it('rejects a missing page parameter before a projection can execute with undefined input',async()=>{
  mocks.describe.mockResolvedValue({parameterDefs:[{name:'person',type:'TYPE_STRING'}]});
  await expect(validatePageBindings(owner,page({}),async()=>metric,{})).rejects.toMatchObject({code:'INVALID_PAGE_PARAMETER'});
});
it('checks ontology object parameter classes rather than accepting any object-shaped page state',async()=>{
  const objectMetric=productAssetSchema.parse({...metric,document:{...metric.document,parameters:{person:{source:'variable',path:'selected'}}}});
  mocks.describe.mockResolvedValue({parameterDefs:[{name:'person',type:'TYPE_ONTOOBJ',classNames:['Person']}]});
  await expect(validatePageBindings(owner,page({selected:{kind:'object',objectType:'Person'}}),async()=>objectMetric,{})).resolves.toBeUndefined();
  await expect(validatePageBindings(owner,page({selected:{kind:'object',objectType:'Order'}}),async()=>objectMetric,{})).rejects.toMatchObject({code:'INVALID_PAGE_PARAMETER'});
});
it('checks tool bindings inside a Profile embedded in a typed Page',async()=>{
  const profile=productAssetSchema.parse({...metric,id:'profile',document:{kind:'agent-profile',principalId:'agent',instructions:'',tools:['metric'],contextViews:[]}});
  const input=productAssetInputSchema.parse({name:'Page',document:{kind:'page',params:{selected:{kind:'object',objectType:'Person'}},children:[{assetId:'profile'}]}});
  mocks.describe.mockResolvedValue({parameterDefs:[{name:'person',type:'TYPE_NUMBER'}]});
  await expect(validatePageBindings(owner,input,async id=>id==='profile'?profile:metric,{})).rejects.toMatchObject({code:'INVALID_PAGE_PARAMETER'});
});
