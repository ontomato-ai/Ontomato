import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),post:vi.fn()}));
const grants=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../grants',()=>({readProductGrantRecords:grants.read}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'service-only'})}}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
import {synchronizeProductOntology,ontologyRegistration,registeredProductGraph} from '../ontology';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
beforeEach(()=>{vi.resetAllMocks();});
it('retains a failed registration for retry and acknowledges only the synchronized revision',async()=>{
  const registration={id:'view',kind:'metric-widget',name:'View',revision:2,targetKind:'MetricView',targetId:'count',isDefault:true};
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT')?[{asset_id:'view',revision:2,registration}]:[]}));
  mocks.post.mockRejectedValue(new Error('Unavailable'));
  await expect(synchronizeProductOntology({domainId:'domain',userId:'human'})).rejects.toThrow();
  expect(mocks.query.mock.calls.some(([sql])=>sql.startsWith('DELETE'))).toBe(false);
  mocks.post.mockResolvedValue({text:'{"success":true}'});
  await synchronizeProductOntology({domainId:'domain',userId:'human'});
  expect(mocks.query.mock.calls.find(([sql])=>sql.startsWith('DELETE'))?.[1]).toEqual(['domain','view',2]);
});
it('registers ontology faces and bundles without moving Page composition into the ontology',()=>{
  const base={name:'Page',description:'',visibility:'private',ownerId:'human',revision:1,editable:true,createdAt:'now',updatedAt:'now'};
  expect(ontologyRegistration(productAssetSchema.parse({...base,id:'page',document:{kind:'page',children:[]}}))).toBeNull();
  expect(ontologyRegistration(productAssetSchema.parse({...base,id:'view',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'text',fields:['name']}}))).toMatchObject({targetKind:'ObjectType',targetId:'Person'});
});
it('does not label a locally derived renders edge as synchronized when the ontology revision is stale',async()=>{
  const asset=productAssetSchema.parse({name:'View',visibility:'private',ownerId:'human',id:'view',revision:2,editable:true,createdAt:'now',updatedAt:'now',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'count'},parameters:{},valueField:'count'}});
  mocks.query.mockResolvedValue({rows:[]});
  mocks.post.mockResolvedValue({text:JSON.stringify({nodes:[{id:'view',name:'View',kind:'metric-widget',revision:1}],edges:[{source:'view',relation:'renders',target_kind:'MetricView',target_id:'count',is_default:false}]})});
  await expect(registeredProductGraph({domainId:'domain',userId:'human'},[asset])).rejects.toMatchObject({code:'PRODUCT_ONTOLOGY_PENDING'});
});
it('includes governance edges only for bundles the caller can edit',async()=>{
  const base={name:'App',visibility:'private',ownerId:'human',revision:1,createdAt:'now',updatedAt:'now',document:{kind:'application',applicationId:'app',children:[]}};
  const editable=productAssetSchema.parse({...base,id:'app',editable:true});
  const visible=productAssetSchema.parse({...base,id:'other',editable:false,document:{...base.document,applicationId:'other'}});
  mocks.query.mockResolvedValue({rows:[]});
  mocks.post.mockResolvedValue({text:JSON.stringify({nodes:[{id:'app',name:'App',kind:'application',revision:1},{id:'other',name:'App',kind:'application',revision:1}],edges:[]})});
  grants.read.mockResolvedValue({grants:[{principalKind:'role',principalId:'reader',verb:'use'}]});
  const graph=await registeredProductGraph({domainId:'domain',userId:'human'},[editable,visible],{token:'caller'});
  expect(graph.edges).toContainEqual({source:'grant:role:reader',target:'asset:app',relation:'use',storage:'governance'});
  expect(grants.read.mock.calls.map(call=>call[0])).toEqual(['app']);
});
