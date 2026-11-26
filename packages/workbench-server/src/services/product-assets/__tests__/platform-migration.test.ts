import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),save:vi.fn(),query:vi.fn()}));
vi.mock('../store',()=>({getProduct:mocks.get,saveProduct:mocks.save,lockProducts:async()=>{}}));
vi.mock('../platform-objects',()=>({platformObjectProvider:()=>({})}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(action:(client:{query:typeof mocks.query})=>unknown)=>action({query:mocks.query})}));
import {migratePlatformProjection} from '../platform-migration';
const owner={domainId:'domain',userId:'author'};
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue({rows:[]});});
it('keeps a legacy task placement identity and replaces its closed source with a Definition projection',async()=>{
  mocks.get.mockResolvedValue({id:'task',revision:1,editable:true,name:'Tasks',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'tasks',limit:7}}});
  await migratePlatformProjection(owner,{},'task',1);
  expect(mocks.save).toHaveBeenCalledWith(owner,'task',expect.objectContaining({document:expect.objectContaining({kind:'collection-view',pageSize:7,renders:{kind:'Definition',id:'platform-members:platform:Task'}})}),1,{},true);
});
it('rejects migration of the retired question panel',async()=>{
  mocks.get.mockResolvedValue({id:'ask',revision:1,editable:true,name:'Ask',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'assistant'}}});
  await expect(migratePlatformProjection(owner,{},'ask',1)).rejects.toMatchObject({code:'PRODUCT_UNPINNABLE_DEPENDENCY'});
  expect(mocks.save).not.toHaveBeenCalled();expect(mocks.query).not.toHaveBeenCalled();
});
it('extracts the original authors widget preferences without overwriting another principals overlay',async()=>{
  const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
  mocks.get.mockResolvedValue({id:'favorite',ownerId:'original-author',revision:1,editable:true,name:'Favorites',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'objects',workspace:defaultPersonalWorkspace()}}});
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'original-author',revision:1}]:[]}));
  await migratePlatformProjection(owner,{},'favorite',1);
  const write=mocks.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO product_user_overlays'))!;
  expect(write[1].slice(0,3)).toEqual(['domain','original-author','favorite']);expect(write[0]).toContain('ON CONFLICT DO NOTHING');
});
it('keeps the original widget when its reserved Definition identity contains another predicate',async()=>{
  mocks.get.mockResolvedValue({id:'task',revision:1,editable:true,name:'Tasks',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'tasks'}}});
  mocks.query.mockResolvedValue({rows:[{definition:{status:'PUBLISHED',objectType:'platform:Task',predicate:{field:'title'}}}]});
  await expect(migratePlatformProjection(owner,{},'task',1)).rejects.toMatchObject({code:'INVALID_DEFINITION'});
  expect(mocks.save).not.toHaveBeenCalled();
});
it('preserves current home preferences instead of stale widget selections',async()=>{
  const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
  const latest={...defaultPersonalWorkspace(),applicationIds:['latest']};
  mocks.get.mockResolvedValue({id:'apps',ownerId:'author',revision:1,editable:true,name:'Apps',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'apps',workspace:defaultPersonalWorkspace()}}});
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'author',revision:1}]:sql.includes('SELECT overlay.preferences')?[{preferences:latest}]:[]}));
  await migratePlatformProjection(owner,{},'apps',1);
  const write=mocks.query.mock.calls.find(([sql])=>sql.includes('INSERT INTO product_user_overlays'))!;
  expect(JSON.parse(write[1][3]).applicationIds).toEqual(['latest']);
});
vi.mock('../panel-boundary',()=>({assertLegacyProductWrite:vi.fn()}));
