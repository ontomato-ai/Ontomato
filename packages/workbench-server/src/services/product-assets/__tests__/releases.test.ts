import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),get:vi.fn(),describe:vi.fn(),post:vi.fn(),put:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,backendPut:mocks.put,buildBackendHeaders:()=>({})}));
vi.mock('../../assistant/execution',()=>({credentialsForDefinition:async()=>({token:'agent-execution',executionUserId:'executor'})}));
vi.mock('../ontology',()=>({synchronizeProductOntology:async()=>{}}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(fn:(client:{query:typeof mocks.query})=>unknown)=>fn({query:mocks.query})}));
vi.mock('../../../infrastructure/postgres',()=>({qualifiedTable:(name:string)=>name,getPostgresPool:()=>({query:mocks.query})}));
vi.mock('../store',()=>({getProduct:mocks.get,lockProducts:vi.fn()}));
vi.mock('../grants',()=>({requireProductUse:vi.fn(),withProductGrants:async(_owner:unknown,action:()=>unknown)=>action()}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=mocks.describe;}}));
import {readProductRelease,validateReleaseContracts,contractHash,snapshotAsset,releaseSnapshotSchema,rollbackProductBundle,activeProductBundle,productReleaseIssues,productReleaseDiff,captureProductRelease,synchronizeBundlePublication} from '../releases';
beforeEach(()=>{vi.resetAllMocks();mocks.put.mockResolvedValue({text:'{"success":true}'});});
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
it('rolls a Profile back to its frozen projection tree without overwriting draft assets',async()=>{
  const profile={...snapshot().assets[0],id:'profile',editable:true,document:{kind:'agent-profile',agentId:'agent',instructions:'draft',tools:[],contextViews:[]}};
  const frozen=releaseSnapshotSchema.parse({schemaVersion:1,roots:['profile'],assets:[{...profile,document:{...profile.document,instructions:'published'}}],contracts:[]});
  mocks.get.mockResolvedValue(profile);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT snapshot')?[{snapshot:frozen}]:sql.includes('SELECT release_id')&&!sql.includes('product_publication_outbox')?[{release_id:'first'}]:[]}));
  await expect(rollbackProductBundle(owner,'profile','first',{})).resolves.toEqual({releaseId:'first'});
  const active=await activeProductBundle(owner,'profile',{});
  expect(snapshotAsset(active.snapshot,'profile').document).toMatchObject({instructions:'published'});
  expect(mocks.query.mock.calls.some(([sql])=>sql.includes('UPDATE product_assets'))).toBe(false);
  mocks.get.mockResolvedValue({...profile,editable:false});
  await expect(rollbackProductBundle(owner,'profile','first',{})).rejects.toMatchObject({status:403});
});
it('marks only projections with changed contracts while preserving current access checks',async()=>{
  mocks.get.mockResolvedValue({revision:2});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',parameterDefs:[],outputColumns:[{key:'renamed'}]});
  await expect(productReleaseIssues(owner,snapshot(),{})).resolves.toMatchObject([{assetId:'root',code:'PRODUCT_CONTRACT_CHANGED'}]);
  mocks.get.mockRejectedValue(Object.assign(new Error('Denied'),{status:403}));
  await expect(productReleaseIssues(owner,snapshot(),{})).rejects.toMatchObject({status:403});
});
it('rolls declarative Applications back through the same immutable bundle records',async()=>{
  const app={...snapshot().assets[0],id:'app',editable:true,document:{kind:'application',applicationId:'app',children:[]}};
  const frozen=releaseSnapshotSchema.parse({schemaVersion:1,roots:['app'],assets:[app],contracts:[]});
  mocks.get.mockResolvedValue(app);
  mocks.query.mockResolvedValue({rows:[{snapshot:frozen}]});
  await expect(rollbackProductBundle(owner,'app','release',{})).resolves.toEqual({releaseId:'release'});
  mocks.get.mockResolvedValue({...app,document:{...app.document,workspaceId:'source-workspace'}});
  await expect(rollbackProductBundle(owner,'app','release',{})).rejects.toMatchObject({code:'INVALID_PRODUCT_TYPE'});
});
it('shows child revision and capability contract changes before an explicit upgrade',()=>{
  const previous=snapshot(),next=structuredClone(previous);
  next.assets[0].revision=2;next.contracts[0].hash='changed';
  expect(productReleaseDiff(previous,next)).toEqual({assets:[{id:'root',change:'updated',fromRevision:1,toRevision:2}],contracts:[{kind:'metric',id:'metric',change:'changed'}]});
  expect(productReleaseDiff(previous,previous)).toEqual({assets:[],contracts:[]});
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
it('requires explicit migration before a new release can pin a legacy widget',async()=>{
  mocks.get.mockResolvedValue(snapshot().assets[0]);
  await expect(captureProductRelease(owner,['root'],{})).rejects.toMatchObject({code:'PRODUCT_UNPINNABLE_DEPENDENCY'});
});
it('can restore a frozen release with a drifted projection while retaining current permission checks',async()=>{
  const profile={...snapshot().assets[0],id:'profile',editable:true,document:{kind:'agent-profile',agentId:'agent',instructions:'',tools:['root'],contextViews:[]}};
  const frozen=releaseSnapshotSchema.parse({...snapshot(),roots:['profile'],assets:[profile,...snapshot().assets]});
  mocks.get.mockResolvedValue(profile);mocks.query.mockResolvedValue({rows:[{snapshot:frozen}]});
  mocks.describe.mockResolvedValue({status:'PUBLISHED',parameterDefs:[],outputColumns:[{key:'changed'}]});
  await expect(rollbackProductBundle(owner,'profile','release',{})).resolves.toEqual({releaseId:'release'});
});
it('retains failed directory publications and retries the frozen declaration rather than the draft',async()=>{
  const app={...snapshot().assets[0],id:'app-example',name:'Frozen name',editable:true,document:{kind:'application',applicationId:'app-example',children:[]}};
  const frozen=releaseSnapshotSchema.parse({schemaVersion:1,roots:['app-example'],assets:[app],contracts:[]});
  mocks.get.mockResolvedValue({...app,name:'Draft name'});
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('FROM product_publication_outbox')?[{release_id:'release'}]:sql.includes('SELECT snapshot')?[{snapshot:frozen}]:[]}));
  mocks.put.mockRejectedValueOnce(new Error('Directory unavailable'));
  await expect(synchronizeBundlePublication(owner,'app-example',{})).rejects.toThrow();
  expect(mocks.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM product_publication_outbox'))).toBe(false);
  await synchronizeBundlePublication(owner,'app-example',{});
  expect(mocks.put.mock.lastCall?.[2]).toMatchObject({declaration:{names:{en:'Frozen name'}}});
  expect(mocks.query.mock.calls.some(([sql])=>sql.startsWith('DELETE FROM product_publication_outbox'))).toBe(true);
});
it('does not run a new active snapshot while its application directory publication is pending',async()=>{
  mocks.get.mockResolvedValue({editable:false});
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT release_id')?[{release_id:'pending'}]:[]}));
  await expect(activeProductBundle(owner,'app-example',{})).rejects.toMatchObject({code:'PRODUCT_PUBLICATION_PENDING'});
  expect(mocks.query.mock.calls.some(([sql])=>sql.includes('SELECT snapshot'))).toBe(false);
});
