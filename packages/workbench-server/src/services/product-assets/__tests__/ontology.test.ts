import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),post:vi.fn()}));
const grants=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('../../product-governance/grants',()=>({readProductGrantRecords:grants.read}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({tk:'caller'})}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:'service-only'})}}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://ontology.test'}}}));
import {synchronizeProductOntology,ontologyRegistration,addAuthorizationEdges} from '../ontology';
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
it('uses catalogue grant eligibility and isolates authorization read failures by application',async()=>{
  const nodes=['denied','managed','visible'].map(assetId=>({
    id:`asset:${assetId}`,assetId,name:assetId,kind:'application',category:'bundle' as const,
  }));
  grants.read.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({grants:[
    {principalKind:'role',principalId:'reader',principalName:'业务查看者',verb:'use'},
  ]});
  const graph=await addAuthorizationEdges(
    {graph:{nodes,edges:[]},grantableApplicationIds:new Set(['denied','managed'])},
    {domainId:'domain',userId:'human'},{token:'caller'},
  );
  expect(grants.read.mock.calls.map(([id])=>id)).toEqual(['denied','managed']);
  expect(graph.edges).toContainEqual({source:'grant:role:reader',target:'asset:managed',relation:'use',storage:'governance'});
  expect(graph.nodes).toContainEqual({id:'grant:role:reader',name:'业务查看者',kind:'role',category:'principal'});
});
