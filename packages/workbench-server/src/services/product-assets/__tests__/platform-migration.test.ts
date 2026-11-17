import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({get:vi.fn(),list:vi.fn(),save:vi.fn(),query:vi.fn(),active:vi.fn()}));
vi.mock('../store',()=>({getProduct:mocks.get,listProducts:mocks.list,saveProduct:mocks.save,lockProducts:async()=>{}}));
vi.mock('../releases',()=>({activeProductBundle:mocks.active}));
vi.mock('../platform-assets',()=>({nativeAgentAsset:async()=>undefined,ensurePlatformAssets:async()=>{}}));
vi.mock('../platform-objects',()=>({platformObjectProvider:()=>({})}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(action:(client:{query:typeof mocks.query})=>unknown)=>action({query:mocks.query})}));
import {migratePlatformProjection} from '../platform-migration';
const owner={domainId:'domain',userId:'author'};
beforeEach(()=>{vi.resetAllMocks();mocks.query.mockResolvedValue({rows:[]});mocks.list.mockResolvedValue([]);});
it('keeps a legacy task placement identity and replaces its closed source with a Definition projection',async()=>{
  mocks.get.mockResolvedValue({id:'task',revision:1,editable:true,name:'Tasks',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'tasks',limit:7}}});
  await migratePlatformProjection(owner,{},'task',1);
  expect(mocks.save).toHaveBeenCalledWith(owner,'task',expect.objectContaining({document:expect.objectContaining({kind:'collection-view',pageSize:7,renders:{kind:'Definition',id:'platform-members:platform:Task'}})}),1,{},true);
});
it('does not invent an AgentProfile when migrating the legacy question panel',async()=>{
  mocks.get.mockResolvedValue({id:'ask',revision:1,editable:true,name:'Ask',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'assistant'}}});
  await expect(migratePlatformProjection(owner,{},'ask',1)).rejects.toMatchObject({code:'PRODUCT_PROFILE_REQUIRED'});
  expect(mocks.save).not.toHaveBeenCalled();expect(mocks.query).not.toHaveBeenCalled();
});
it('replaces an old question panel with an existing native Profile without requiring a declarative release',async()=>{
 mocks.get.mockImplementation(async(_owner,id)=>id==='ask'?{id:'ask',revision:1,editable:true,name:'Ask',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'assistant'}}}:{id:'profile',document:{kind:'agent-profile',principalId:'agent'}});
 mocks.list.mockResolvedValue([{id:'profile',document:{kind:'agent-profile',principalId:'agent'}}]);
 const native=vi.spyOn(await import('../platform-assets'),'nativeAgentAsset').mockResolvedValue('agent' as never);
 await migratePlatformProjection(owner,{},'ask',1);
 expect(mocks.save).toHaveBeenCalledWith(owner,'ask',expect.objectContaining({document:{kind:'page',children:[{assetId:'profile',column:'main'}]}}),1,{},true);
 expect(mocks.active).not.toHaveBeenCalled();
 native.mockRestore();
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
it('keeps Agent shortcuts as explicit published Profile references when migrating application entries',async()=>{
  const {defaultPersonalWorkspace}=await import('@ontomato/contracts/personal-workspace');
  const source={id:'apps',ownerId:'author',revision:1,editable:true,name:'Apps',description:'',visibility:'private',document:{kind:'widget',widget:{kind:'platform',source:'apps',workspace:{...defaultPersonalWorkspace(),agentIds:['agent']}}}};
  mocks.get.mockImplementation(async(_owner,id)=>{if(id==='apps')return source;const {HttpError}=await import('../../../utils/errors');throw new HttpError(404,'Missing');});
  mocks.list.mockResolvedValue([{id:'profile',document:{kind:'agent-profile',principalId:'agent'}}]);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('SELECT owner_id,revision')?[{owner_id:'author',revision:1}]:[]}));
  await migratePlatformProjection(owner,{},'apps',1);
  const root=mocks.save.mock.calls.at(-1)!;
  expect(root[1]).toBe('apps');expect(root[2].document).toMatchObject({kind:'page',children:expect.arrayContaining([{assetId:'profile',column:'main'}])});
  expect(mocks.active).toHaveBeenCalledWith(owner,'profile',{});
});
