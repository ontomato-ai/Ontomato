import {expect,it,vi} from 'vitest';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({get:vi.fn(),read:vi.fn(),query:vi.fn(),post:vi.fn()}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({})}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../store',()=>({getProduct:mocks.get}));
vi.mock('../platform-objects',()=>({readPlatformObjects:mocks.read}));
import {readPlatformProjectionObject} from '../object-read';
it('reads platform objects through the selected projection and captured principal',async()=>{
  mocks.get.mockResolvedValue({document:{kind:'object-projection',renders:{kind:'ObjectType',id:'platform:Conversation'},fields:['title']}});
  mocks.read.mockResolvedValue([{id:'mine',title:'My conversation'}]);
  const owner={domainId:'domain',userId:'reader'},credentials={token:'current'};
  await expect(readPlatformProjectionObject(owner,credentials,'view','mine')).resolves.toEqual({object:{id:'mine',title:'My conversation'}});
  expect(mocks.read).toHaveBeenCalledWith(owner,credentials,'platform:Conversation',{},['id','title']);
  await expect(readPlatformProjectionObject(owner,credentials,'view','another')).rejects.toMatchObject({status:404});
});
it('uses archived presentation fields for a pinned ObjectView while checking current access',async()=>{
  const archived=productAssetSchema.parse({id:'view',name:'Context',description:'',ownerId:'author',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'platform:Conversation'},renderer:'text',fields:['title']}});
  mocks.get.mockResolvedValue({...archived,revision:2,document:{...archived.document,fields:['internal']}});
  mocks.query.mockResolvedValue({rows:[{asset:archived}]});
  mocks.read.mockResolvedValue([{id:'mine',title:'Original context'}]);
  const owner={domainId:'domain',userId:'reader'};
  await expect(readPlatformProjectionObject(owner,{},'view','mine',1)).resolves.toMatchObject({object:{title:'Original context'}});
  expect(mocks.read.mock.lastCall?.[4]).toEqual(['id','title']);
  mocks.get.mockRejectedValue(Object.assign(new Error('Revoked'),{status:404}));
  await expect(readPlatformProjectionObject(owner,{},'view','mine',1)).rejects.toMatchObject({status:404});
});
it('filters governed business object attributes at the projection boundary',async()=>{
  mocks.get.mockResolvedValue({document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'text',fields:['name']}});
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{data:{name:'Alice',salary:900}}})});
  await expect(readPlatformProjectionObject({domainId:'domain',userId:'reader'},{token:'caller'},'view','alice')).resolves.toEqual({object:{name:'Alice'}});
  mocks.post.mockResolvedValue({text:JSON.stringify({success:false})});
  await expect(readPlatformProjectionObject({domainId:'domain',userId:'reader'},{},'view','alice')).rejects.toMatchObject({status:403});
});
