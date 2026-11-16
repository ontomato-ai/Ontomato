import {beforeEach,expect,it,vi} from 'vitest';
import {createObjectView} from '@ontomato/contracts/object-views';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({list:vi.fn(),get:vi.fn(),save:vi.fn(),query:vi.fn(),post:vi.fn()}));
vi.mock('../store',()=>({listProducts:mocks.list,getProduct:mocks.get,saveProduct:mocks.save,lockProducts:vi.fn()}));
vi.mock('../../../infrastructure/postgres-transaction',()=>({transaction:async(action:(client:{query:typeof mocks.query})=>unknown)=>action({query:mocks.query})}));
vi.mock('../../../infrastructure/postgres',()=>({getPostgresPool:()=>({query:mocks.query}),qualifiedTable:(name:string)=>name}));
vi.mock('../../../utils/backend-client',()=>({backendPost:mocks.post,buildBackendHeaders:()=>({})}));
import {objectViewAuthoring} from '../object-view-authoring';
const owner={domainId:'domain',userId:'editor'};
function asset(revision=2,editable=true){return productAssetSchema.parse({id:'face',name:'Person',description:'',ownerId:'author',visibility:'domain',revision,editable,createdAt:'2026-11-16',updatedAt:'2026-11-16',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'full',layout:createObjectView('Person'),fields:[],isDefault:true}});}
beforeEach(()=>{vi.resetAllMocks();mocks.list.mockResolvedValue([asset()]);mocks.query.mockResolvedValue({rows:[]});mocks.get.mockResolvedValue(asset());});
it('uses the product save boundary and optimistic revision for the existing object editor',async()=>{
  mocks.save.mockResolvedValue(asset(3));
  await expect(objectViewAuthoring(owner,{token:'caller'},'Person','save',{document:createObjectView('Person'),expectedRevision:2})).resolves.toMatchObject({revision:3});
  expect(mocks.save).toHaveBeenCalledWith(owner,'face',expect.objectContaining({document:expect.objectContaining({kind:'object-projection',renders:{kind:'ObjectType',id:'Person'}})}),2,{token:'caller'});
  expect(mocks.post).not.toHaveBeenCalled();
});
it('does not grant editing merely because a default face is visible',async()=>{
  mocks.list.mockResolvedValue([asset(2,false)]);
  await expect(objectViewAuthoring(owner,{},'Person','edit')).rejects.toMatchObject({status:403});
  expect(mocks.save).not.toHaveBeenCalled();
});
it('does not restore an archived edit decision when returning a published face',async()=>{
  const published=asset(1,true),current=asset(2,false);
  mocks.list.mockResolvedValue([current]);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT asset')?[{asset:published}]:sql.startsWith('SELECT revision')?[{revision:1}]:[]}));
  const result=await objectViewAuthoring(owner,{},'Person','read');
  expect(result.publishedAsset).toMatchObject({revision:1,editable:false});
});
it('imports a legacy published definition once and never writes back to class storage',async()=>{
  mocks.list.mockResolvedValue([]);mocks.save.mockResolvedValue(asset(1));
  const {HttpError}=await import('../../../utils/errors');mocks.get.mockRejectedValueOnce(new HttpError(404,'Missing')).mockResolvedValue(asset(1));
  mocks.post.mockResolvedValue({text:JSON.stringify({success:true,data:{publishedRevision:7,versions:[{revision:7,document:createObjectView('Person')}]}})});
  await objectViewAuthoring(owner,{},'Person','edit');
  expect(mocks.save.mock.calls[0][2].document.layout.className).toBe('Person');
  expect(mocks.post.mock.calls.every(call=>call[1].endsWith('/objectView/edit'))).toBe(true);
});
it('rejects ambiguous defaults instead of editing an arbitrary projection',async()=>{
  mocks.list.mockResolvedValue([asset(),{...asset(),id:'other'}]);
  await expect(objectViewAuthoring(owner,{},'Person','edit')).rejects.toMatchObject({code:'OBJECT_VIEW_AMBIGUOUS'});
  expect(mocks.save).not.toHaveBeenCalled();
});
it('rechecks the revision under the product lock before publishing a standalone object entry',async()=>{
  mocks.get.mockResolvedValue(asset(3));
  await expect(objectViewAuthoring(owner,{},'Person','publish',{expectedRevision:2,revision:2})).rejects.toMatchObject({code:'PRODUCT_CONFLICT'});
  expect(mocks.query.mock.calls.some(call=>call[0].startsWith('INSERT INTO product_object_view_heads'))).toBe(false);
});
it('keeps draft edits separate from the standalone published object entry',async()=>{
  const published=asset(1),draft=asset(2);
  if(draft.document.kind==='object-projection')draft.document.fields=['privateDraftField'];
  mocks.list.mockResolvedValue([draft]);
  mocks.query.mockImplementation(async(sql:string)=>({rows:sql.startsWith('SELECT asset')?[{asset:published}]:sql.startsWith('SELECT revision')?[{revision:1}]:[]}));
  const result=await objectViewAuthoring(owner,{},'Person','read');
  expect(result).toMatchObject({revision:2,publishedRevision:1});
  expect(result.versions.map(version=>version.revision)).toEqual([1]);
  expect(result.publishedAsset).toMatchObject({id:'face',revision:1,document:published.document});
  expect((result.publishedAsset as {document:{fields:string[]}}).document.fields).not.toContain('privateDraftField');
  expect(mocks.save).not.toHaveBeenCalled();
});
