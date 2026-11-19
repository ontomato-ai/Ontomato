import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({post:vi.fn(),query:vi.fn(),token:'service-token'}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({tk:'caller'})}));
vi.mock('../../../config/environment',()=>({environment:{agentRuntime:()=>({queryServiceToken:mocks.token})}}));
vi.mock('../../../config/application',()=>({config:{dataQuery:{baseUrl:'http://java.test'}}}));
import {registerProductResource,requireProductGrant,grantedProductIds} from '../../product-governance/grants';
import {migrateProductGrants,withProductGrants,currentProductGrants,requireProductUse} from '../grants';
beforeEach(()=>{vi.resetAllMocks();mocks.token='service-token';});
it('registers persisted resource ownership through service authentication',async()=>{
  mocks.post.mockResolvedValue({text:'{"success":true}'});
  await registerProductResource({domainId:'domain',userId:'author'},'profile',true);
  expect(mocks.post.mock.calls[0][2]).toEqual({domainId:'domain',ownerId:'author',id:'profile',shared:true});
  expect(mocks.post.mock.calls[0][3].headers['X-Ontomato-Query-Service-Token']).toBe('service-token');
});
it('fails closed when governance denies access or registration credentials are missing',async()=>{
  mocks.post.mockResolvedValue({text:'{"allowed":false}'});
  await expect(requireProductGrant('profile','edit',{token:'caller'})).rejects.toMatchObject({status:403});
  mocks.token='';
  await expect(registerProductResource({domainId:'domain',userId:'author'},'profile',false)).rejects.toMatchObject({code:'PRODUCT_GOVERNANCE_UNAVAILABLE'});
});
it('accepts only a valid authorized resource list from the governance boundary',async()=>{
  mocks.post.mockResolvedValueOnce({text:'{"ids":["profile"]}'}).mockResolvedValueOnce({text:'{"ids":[42]}'});
  await expect(grantedProductIds('use',{token:'caller'})).resolves.toEqual(['profile']);
  await expect(grantedProductIds('use',{token:'caller'})).rejects.toMatchObject({code:'PRODUCT_GOVERNANCE_UNAVAILABLE'});
});
it('marks historical resources imported only after governance registration succeeds',async()=>{
  mocks.query.mockResolvedValueOnce({rows:[{id:'shared',owner_id:'author',visibility:'domain'}]}).mockResolvedValue({rows:[]});
  mocks.post.mockResolvedValue({text:'{"success":true}'});
  await migrateProductGrants({domainId:'domain',userId:'reader'});
  expect(mocks.post.mock.calls[0][2]).toEqual({domainId:'domain',ownerId:'author',id:'shared',shared:true});
  expect(mocks.query.mock.calls[1][1]).toEqual(['domain','shared','author']);
  mocks.query.mockReset();mocks.query.mockResolvedValue({rows:[{id:'private',owner_id:'author',visibility:'private'}]});
  mocks.post.mockRejectedValue(new Error('Unavailable'));
  await expect(migrateProductGrants({domainId:'domain',userId:'reader'})).rejects.toThrow('Unavailable');
  expect(mocks.query).toHaveBeenCalledTimes(1);
});
it('keeps Grant contexts scoped to the captured subject and never defaults to owner visibility',async()=>{
  mocks.query.mockResolvedValue({rows:[]});
  mocks.post.mockImplementation(async(_name,_url,body)=>({text:JSON.stringify({ids:body.verb==='use'?['shared']:['editable']})}));
  const owner={domainId:'domain',userId:'reader'};
  await withProductGrants(owner,async()=>{
    expect(currentProductGrants(owner).use.has('shared')).toBe(true);
    expect(currentProductGrants(owner).edit.has('editable')).toBe(true);
    expect(()=>currentProductGrants({...owner,userId:'another'})).toThrow();
    await expect(requireProductUse(owner,'editable')).rejects.toMatchObject({code:'PRODUCT_FORBIDDEN'});
    await expect(requireProductUse(owner,'shared')).resolves.toBeUndefined();
  });
  expect(()=>currentProductGrants(owner)).toThrow();
});
