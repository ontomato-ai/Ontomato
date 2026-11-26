import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),get:vi.fn(),describe:vi.fn(),post:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({})}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name,getPostgresPool:()=>({query:mocks.query})}));
vi.mock('../store',()=>({getProduct:mocks.get}));
vi.mock('../grants',()=>({requireProductUse:vi.fn(),withProductGrants:async(_owner:unknown,action:()=>unknown)=>action()}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=mocks.describe;}}));
import {readProductRelease,validateReleaseContracts,contractHash,snapshotAsset,releaseSnapshotSchema,activeProductBundle,productReleaseIssues} from '../releases';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('ONTOMATO_QUERY_SERVICE_TOKEN','fixture-service');});
afterEach(()=>{vi.unstubAllEnvs();});
const owner={domainId:'domain',userId:'reader'};
const snapshot=()=>releaseSnapshotSchema.parse({schemaVersion:1,roots:['root'],assets:[{id:'root',name:'Original',description:'',ownerId:'author',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'widget',widget:{id:'w',kind:'metric',title:'Count',span:12,resourceId:'metric',valueField:'count'}}}],contracts:[{kind:'metric',id:'metric',hash:contractHash({parameters:[],outputs:[{key:'count'}]})}]});
it('resolves target release contents and rejects historical releases without a snapshot',async()=>{
  mocks.query.mockResolvedValueOnce({rows:[{snapshot:snapshot()}]}).mockResolvedValueOnce({rows:[]});
  const release=await readProductRelease(owner,'release','app');
  expect(snapshotAsset(release,'root')).toMatchObject({revision:1,name:'Original'});
  expect(mocks.query.mock.calls[0][1]).toEqual(['domain','release','app']);
  expect(()=>snapshotAsset(release,'undeclared')).toThrow();
  await expect(readProductRelease(owner,'old')).rejects.toMatchObject({code:'PRODUCT_RELEASE_UNPINNED'});
});
it('checks current visibility and detects output contract drift without changing the pinned asset',async()=>{
  mocks.get.mockResolvedValue({revision:2,name:'Edited'});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',parameterDefs:[],outputColumns:[{key:'count'}]});
  const release=snapshot();
  await expect(validateReleaseContracts(owner,release,{token:'current'})).resolves.toBeUndefined();
  expect(snapshotAsset(release,'root').name).toBe('Original');
  mocks.describe.mockResolvedValue({status:'PUBLISHED',parameterDefs:[],outputColumns:[{key:'renamed'}]});
  await expect(validateReleaseContracts(owner,release,{})).rejects.toMatchObject({code:'PRODUCT_CONTRACT_CHANGED'});
  mocks.get.mockRejectedValue(Object.assign(new Error('Hidden'),{status:404}));
  await expect(validateReleaseContracts(owner,release,{})).rejects.toMatchObject({status:404});
});
it('marks only projections with changed contracts while preserving current access checks',async()=>{
  mocks.get.mockResolvedValue({revision:2});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',parameterDefs:[],outputColumns:[{key:'renamed'}]});
  await expect(productReleaseIssues(owner,snapshot(),{})).resolves.toMatchObject([{assetId:'root',code:'PRODUCT_CONTRACT_CHANGED'}]);
  mocks.get.mockRejectedValue(Object.assign(new Error('Denied'),{status:403}));
  await expect(productReleaseIssues(owner,snapshot(),{})).rejects.toMatchObject({status:403});
});
it('rejects incomplete release records instead of silently resolving live children or unpinned contracts',()=>{
  const release=snapshot();
  expect(releaseSnapshotSchema.safeParse({...release,contracts:[]}).success).toBe(false);
  expect(releaseSnapshotSchema.safeParse({...release,roots:['missing']}).success).toBe(false);
  const parent={...release.assets[0],id:'page',document:{kind:'page',children:[{assetId:'missing'}]}};
  expect(releaseSnapshotSchema.safeParse({...release,roots:['page'],assets:[parent]}).success).toBe(false);
});
it('rejects a Trigger snapshot without both its own contract and its Definition contract',()=>{
  const release=snapshot();
  const trigger={id:'entered',name:'Entered',definitionId:'members',revision:1,status:'PUBLISHED',event:'entered',keyField:'id'};
  expect(releaseSnapshotSchema.safeParse({...release,triggers:[trigger]}).success).toBe(false);
  expect(releaseSnapshotSchema.safeParse({...release,triggers:[trigger],contracts:[...release.contracts,{kind:'trigger',id:'entered',hash:'frozen'},{kind:'definition',id:'members',hash:'frozen'}]}).success).toBe(true);
});
it('detects relationship endpoint drift without treating schema ordering as a contract change',async()=>{
  const view={...snapshot().assets[0],id:'view',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'summary',fields:['name']}};
  const contract={className:'Person',attributes:[{name:'id',type:'string',primaryKey:true},{name:'name',type:'string',primaryKey:undefined}],relationships:[{name:'worksFor',fromclass:'Person',toclass:'Organization'}]};
  const release=releaseSnapshotSchema.parse({schemaVersion:1,roots:['view'],assets:[view],contracts:[{kind:'object-type',id:'Person',contractVersion:2,hash:contractHash(contract)}]});
  mocks.get.mockResolvedValue(view);
  mocks.post.mockResolvedValue({text:JSON.stringify({classes:[{className:'Person',attrs:[{name:'name',type:'string'},{name:'id',type:'string',primaryKey:true}]}],relationships:contract.relationships})});
  await expect(productReleaseIssues(owner,release,{})).resolves.toEqual([]);
  mocks.post.mockResolvedValue({text:JSON.stringify({classes:[{className:'Person',attrs:contract.attributes}],relationships:[{name:'worksFor',fromclass:'Person',toclass:'Department'}]})});
  await expect(productReleaseIssues(owner,release,{})).resolves.toMatchObject([{assetId:'view',code:'PRODUCT_CONTRACT_CHANGED'}]);
});
it('keeps historical object contract hashes readable after adding relationship pinning',async()=>{
  const view={...snapshot().assets[0],id:'view',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'summary',fields:['name']}};
  const attributes=[{name:'name',type:'string',primaryKey:undefined}];
  const release=releaseSnapshotSchema.parse({schemaVersion:1,roots:['view'],assets:[view],contracts:[{kind:'object-type',id:'Person',hash:contractHash({className:'Person',attributes})}]});
  mocks.get.mockResolvedValue(view);mocks.post.mockResolvedValue({text:JSON.stringify({classes:[{className:'Person',attrs:attributes}],relationships:[]})});
  await expect(validateReleaseContracts(owner,release,{})).resolves.toBeUndefined();
});
it('does not run a new active snapshot while its application directory publication is pending',async()=>{
  mocks.get.mockResolvedValue({editable:false});
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT release_id')?[{release_id:'pending'}]:[]}));
  await expect(activeProductBundle(owner,'app-example',{})).rejects.toMatchObject({code:'PRODUCT_PUBLICATION_PENDING'});
  expect(mocks.query.mock.calls.some(([sql])=>sql.includes('SELECT snapshot'))).toBe(false);
});
vi.mock('../panel-boundary',()=>({assertLegacyProductWrite:vi.fn()}));
