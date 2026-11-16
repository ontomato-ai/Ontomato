import {beforeEach,expect,it,vi} from 'vitest';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({get:vi.fn(),validate:vi.fn(),active:vi.fn(),query:vi.fn(),release:vi.fn(),contracts:vi.fn(),post:vi.fn()}));
vi.mock('../agent-principal',()=>({agentPrincipalCredentials:async()=>({token:'agent-execution'})}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:(token:string)=>({tk:token})}));
vi.mock('../../dashboard/metric-client',()=>({DashboardMetricClient:class{describe=async()=>({parameterDefs:[],outputColumns:[{key:'count'}]});}}));
vi.mock('../store',()=>({getProduct:mocks.get}));
vi.mock('../grants',()=>({withProductGrants:async(_owner:unknown,action:()=>unknown)=>action(),currentProductGrants:()=>({use:new Set(['profile']),edit:new Set()}),requireProductUse:vi.fn()}));
vi.mock('../validation',()=>({validateProduct:mocks.validate}));
vi.mock('../releases',()=>({activeProductBundle:mocks.active,readActiveProductBundle:mocks.active,readProductRelease:mocks.release,productReleaseIssues:mocks.contracts,snapshotAsset:(snapshot:{assets:{id:string}[]},id:string)=>snapshot.assets.find(asset=>asset.id===id)}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
import {assembleAgentProfile,agentProfileForPrincipal,executeProfileTool,profileForSession} from '../agent-profile';
const owner={domainId:'domain',userId:'reader'};
const asset=(id:string,document:unknown)=>productAssetSchema.parse({id,document,name:id,description:'',visibility:'domain',ownerId:'author',revision:1,editable:false,createdAt:'now',updatedAt:'now'});
beforeEach(()=>{vi.resetAllMocks();mocks.contracts.mockResolvedValue([]);});
it('assembles the published Profile even when draft instructions and tool bindings changed',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'published',tools:['metric'],contextViews:[]});
  const metric=asset('metric',{kind:'metric-widget',renders:{kind:'MetricView',id:'published-metric'},parameters:{},valueField:'count'});
  mocks.get.mockResolvedValue({...metric,revision:2});
  mocks.query.mockResolvedValue({rows:[{id:'profile'}]});
  mocks.active.mockResolvedValue({snapshot:{assets:[profile,metric]}});
  const result=await agentProfileForPrincipal(owner,{token:'current'},'agent');
  expect(result).toMatchObject({instructions:'published',tools:[{id:'published-metric'}]});
   expect(mocks.validate).toHaveBeenCalledWith(owner,metric,{token:'agent-execution'});
});
it('does not fall back to a live projection absent from the frozen profile tree',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'published',tools:['missing'],contextViews:[]});
  mocks.get.mockResolvedValue(profile);
  await expect(assembleAgentProfile(owner,{},'profile',[profile])).rejects.toMatchObject({code:'PRODUCT_UNAVAILABLE'});
});
it('rejects a published Profile that embodies a different principal',async()=>{
  mocks.query.mockResolvedValue({rows:[{id:'profile'}]});
  mocks.active.mockResolvedValue({snapshot:{assets:[asset('profile',{kind:'agent-profile',principalId:'another',instructions:'',tools:[],contextViews:[]})]}});
  await expect(agentProfileForPrincipal(owner,{},'agent')).rejects.toMatchObject({code:'AGENT_PROFILE_PRINCIPAL_CHANGED'});
});
it('rejects tool execution not declared by the frozen Profile before calling a capability',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:[],contextViews:[]});
  mocks.active.mockResolvedValue({snapshot:{assets:[profile]}});
  await expect(executeProfileTool(owner,{},'profile','undeclared',{})).rejects.toMatchObject({status:403,code:'PROFILE_TOOL_UNAVAILABLE'});
});
it('preserves read-only bindings when executing Action tools',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:['action'],contextViews:[]});
  const action=asset('action',{kind:'action-view',renders:{kind:'Action',id:'approve'},parameters:{tenant:{source:'literal',value:'one'}},readOnlyParameters:['tenant']});
  mocks.active.mockResolvedValue({snapshot:{assets:[profile,action]}});
  await expect(executeProfileTool(owner,{},'profile','action',{tenant:'another'})).rejects.toMatchObject({code:'INVALID_PRODUCT_PARAMETER'});
});
it('resolves run callbacks against their pinned release even after the active Profile changes',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'old',tools:[],contextViews:[]});
  mocks.release.mockResolvedValue({assets:[profile]});
  await expect(executeProfileTool(owner,{},'profile','new-tool',{},'old-release')).rejects.toMatchObject({code:'PROFILE_TOOL_UNAVAILABLE'});
  expect(mocks.release).toHaveBeenCalledWith(owner,'old-release','profile');
  expect(mocks.contracts).toHaveBeenCalled();
  expect(mocks.active).not.toHaveBeenCalled();
});
it('executes the signature parsers typed read-only values instead of restoring presentation text',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:['action'],contextViews:[]});
  const action=asset('action',{kind:'action-view',renders:{kind:'Action',id:'approve'},parameters:{year:{source:'literal',value:'2026'}},readOnlyParameters:['year']});
  mocks.active.mockResolvedValue({snapshot:{assets:[profile,action]}});
  mocks.post.mockResolvedValueOnce({text:JSON.stringify({success:true,data:{parameters:{year:2026}}})}).mockResolvedValueOnce({text:JSON.stringify({success:true,data:{result:'done'}})});
  await executeProfileTool(owner,{},'profile','action',{});
  expect((mocks.post.mock.calls[1][2] as FormData).get('param')).toBe('{"year":2026}');
  expect(mocks.post.mock.calls[1][3].headers.tk).toBe('agent-execution');
});
it('keeps a conversation on its selected Profile release across subsequent turns',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'session instructions',tools:[],contextViews:[]});
  mocks.query.mockResolvedValue({rows:[{profile_id:'profile',release_id:'session-release'}]});
  mocks.release.mockResolvedValue({assets:[profile]});mocks.get.mockResolvedValue(profile);
  await expect(profileForSession(owner,{},'conversation','agent')).resolves.toMatchObject({instructions:'session instructions',releaseId:'session-release'});
  expect(mocks.active).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledWith(owner,'session-release','profile');
});
it('assembles selected object context from governed data and only the frozen text view fields',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:[],contextViews:['text']});
  const text=asset('text',{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'text',fields:['name']});
  mocks.query.mockResolvedValue({rows:[{profile_id:'profile',release_id:'session-release',context_objects:[{className:'Person',primaryKey:'alice'}]}]});
  mocks.release.mockResolvedValue({assets:[profile,text]});mocks.get.mockResolvedValue(profile);
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{data:{name:'Alice',salary:900}}})});
  const result=await profileForSession(owner,{},'conversation','agent');
  expect(result).toMatchObject({objectContext:[{objectType:'Person',primaryKey:'alice',values:{name:'Alice'}}]});
  expect(JSON.stringify(result)).not.toContain('salary');
});
it('resolves Action bindings from the owned frozen session state and preserves read-only object identity',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:['action'],contextViews:[]});
  const action=asset('action',{kind:'action-view',renders:{kind:'Action',id:'approve'},parameters:{person:{source:'variable',path:'selected.primaryKey'}},readOnlyParameters:['person']});
  mocks.release.mockResolvedValue({assets:[profile,action]});
  mocks.query.mockResolvedValue({rows:[{page_state:{selected:{className:'Person',primaryKey:'one'}}}]});
  mocks.post.mockResolvedValueOnce({text:JSON.stringify({success:true,data:{parameters:{person:'one'}}})}).mockResolvedValueOnce({text:JSON.stringify({success:true,data:{completed:true}})});
  await expect(executeProfileTool(owner,{},'profile','action',{},'release','session')).resolves.toEqual({completed:true});
  expect(mocks.post.mock.calls[0][2]).toMatchObject({parameters:{person:'one'}});
  mocks.query.mockResolvedValue({rows:[]});
  await expect(executeProfileTool(owner,{},'profile','action',{},'release','another-session')).rejects.toMatchObject({code:'PROFILE_CONTEXT_REQUIRED'});
});
it('degrades a changed projection while retaining unaffected tools in the same Profile release',async()=>{
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:['changed','working'],contextViews:[]});
  const metric=(id:string)=>asset(id,{kind:'metric-widget',renders:{kind:'MetricView',id},parameters:{},valueField:'count'});
  const frozen=[profile,metric('changed'),metric('working')];mocks.get.mockResolvedValue(profile);
  const issues=[{assetId:'changed',code:'PRODUCT_CONTRACT_CHANGED',message:'Upgrade'}];
  const result=await assembleAgentProfile(owner,{},'profile',frozen,issues);
  expect(result.tools.map(tool=>tool.assetId)).toEqual(['working']);expect(result.issues).toEqual(issues);
  mocks.release.mockResolvedValue({assets:frozen});mocks.contracts.mockResolvedValue(issues);
  await expect(executeProfileTool(owner,{},'profile','changed',{},'release')).rejects.toMatchObject({code:'PRODUCT_CONTRACT_CHANGED'});
});
