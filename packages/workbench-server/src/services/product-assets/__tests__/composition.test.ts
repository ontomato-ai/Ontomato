import {expect,it} from 'vitest';
import {productAssetInputSchema,productAssetSchema} from '@ontomato/contracts/product-assets';
import {defaultPersonalWorkspace} from '@ontomato/contracts/personal-workspace';
import {normalizeComposition,validateComposition,validateAffectedCompositions} from '../composition';
import {captureProductTree,contractHash} from '../releases';
const base={ownerId:'alice',revision:1,editable:true,createdAt:'now',updatedAt:'now',visibility:'private',description:''};
const asset=(id:string,document:unknown)=>productAssetSchema.parse({...base,id,name:id,document});
it('extracts inline widgets into deterministic referenced assets while retaining the group ID',()=>{
  const input=productAssetInputSchema.parse({name:'Overview',document:{kind:'widget-group',widgets:[{id:'count',kind:'metric',title:'Count',span:6,resourceId:'metric',valueField:'count'}]}});
  const result=normalizeComposition('overview',input);
  expect(result.input.document).toMatchObject({kind:'page',embeddable:true});
  expect(result.children[0].input.document).toMatchObject({kind:'metric-widget',renders:{kind:'MetricView',id:'metric'}});
  expect(normalizeComposition('overview',input).children[0].id).toBe(result.children[0].id);
});
it('rejects indirect cycles and Actions nested under an embeddable page',async()=>{
  const page=(children:string[],embeddable=false)=>({kind:'page' as const,workspace:defaultPersonalWorkspace(),children:children.map(assetId=>({assetId,column:'main' as const})),embeddable});
  const child=asset('child',page(['root']));
  await expect(validateComposition('root',{name:'Root',description:'',visibility:'private',document:page(['child'])},async()=>child)).rejects.toMatchObject({code:'PRODUCT_CYCLE'});
  const action=asset('action',{kind:'widget',widget:{id:'action',kind:'action',title:'Edit',span:12,resourceId:'edit'}});
  await expect(validateComposition('root',{name:'Root',description:'',visibility:'private',document:page(['action'],true)},async()=>action)).rejects.toMatchObject({code:'INVALID_EMBEDDABLE_PAGE'});
});
it('captures immutable recursive definitions and canonical capability contracts',async()=>{
  const leaf=asset('leaf',{kind:'widget',widget:{id:'text',kind:'text',title:'Text',span:12,text:'old'}});
  const root=asset('root',{kind:'page',workspace:defaultPersonalWorkspace(),children:[{assetId:'leaf',column:'main'}]});
  const assets=new Map([['leaf',leaf],['root',root]]);
  const snapshot=await captureProductTree(['root'],async id=>assets.get(id)!);
  assets.set('leaf',{...leaf,revision:2,name:'new'});
  expect(snapshot.find(item=>item.id==='leaf')).toMatchObject({revision:1,name:'leaf',editable:false});
  expect(snapshot.find(item=>item.id==='root')!.document).not.toHaveProperty('workspace');
  expect(root.document).toHaveProperty('workspace');
  expect(contractHash({a:1,b:2})).toBe(contractHash({b:2,a:1}));
  expect(contractHash({a:1})).not.toBe(contractHash({a:2}));
});
it('rejects Actions hidden inside a product-owned ObjectView layout on display-only pages',async()=>{
  const view=asset('view',{kind:'object-projection',renders:{kind:'ObjectType',id:'Order'},renderer:'full',layout:{schemaVersion:1,className:'Order',title:'Order',tabs:[{id:'tab',title:'Details',sections:[{id:'section',title:'',widgets:[{id:'approve',kind:'action',title:'Approve',span:12,resourceId:'approve'}]}]}]}});
  const root=productAssetInputSchema.parse({name:'Display',document:{kind:'page',workspace:defaultPersonalWorkspace(),children:[{assetId:'view'}],embeddable:true}});
  await expect(validateComposition('root',root,async()=>view)).rejects.toMatchObject({code:'INVALID_EMBEDDABLE_PAGE'});
});
it('requires reusable projection bindings to resolve through declared page parameters',async()=>{
  const metric=asset('metric',{kind:'metric-widget',renders:{kind:'MetricView',id:'count'},parameters:{id:{source:'variable',path:'selected.primaryKey'}},valueField:'count'});
  const page=productAssetInputSchema.parse({name:'Detail',document:{kind:'page',workspace:defaultPersonalWorkspace(),children:[{assetId:'metric'}]}});
  await expect(validateComposition('root',page,async()=>metric)).rejects.toMatchObject({code:'INVALID_PAGE_PARAMETER'});
  if(page.document.kind!=='page')throw new Error('Expected page');
  page.document.params={selected:{kind:'object',objectType:'Person'}};
  await expect(validateComposition('root',page,async()=>metric)).resolves.toBeUndefined();
});
it('rejects changing a nested Page to contain Actions when an existing ancestor is embeddable',async()=>{
  const page=(ids:string[],embeddable=false)=>({kind:'page',workspace:defaultPersonalWorkspace(),children:ids.map(assetId=>({assetId})),embeddable});
  const ancestor=asset('ancestor',page(['child'],true));
  const child=asset('child',page([]));
  const action=asset('action',{kind:'action-view',renders:{kind:'Action',id:'approve'},parameters:{}});
  const candidate=productAssetInputSchema.parse({name:'Child',document:page(['action'])});
  const records=new Map([['ancestor',ancestor],['child',child],['action',action]]);
  await expect(validateAffectedCompositions('child',candidate,[ancestor],async id=>records.get(id)!)).rejects.toMatchObject({code:'INVALID_EMBEDDABLE_PAGE'});
});
it('rejects nested Pages that would receive an object parameter of another ontology type',async()=>{
  const child=asset('child',{kind:'page',params:{selected:{kind:'object',objectType:'Person'}},children:[]});
  const parent=productAssetInputSchema.parse({name:'Parent',document:{kind:'page',params:{selected:{kind:'object',objectType:'Order'}},children:[{assetId:'child'}]}});
  await expect(validateComposition('parent',parent,async()=>child)).rejects.toMatchObject({code:'INVALID_PAGE_PARAMETER'});
});
it('allows a 3D ObjectView to serve as explicit Agent context without exposing undeclared fields',async()=>{
  const view=asset('twin',{kind:'object-projection',renders:{kind:'ObjectType',id:'Machine'},renderer:'3d',fields:['name']});
  const profile=productAssetInputSchema.parse({name:'Twin',document:{kind:'agent-profile',principalId:'agent',instructions:'',tools:[],contextViews:['twin']}});
  await expect(validateComposition('profile',profile,async()=>view)).resolves.toBeUndefined();
  if(view.document.kind!=='object-projection')throw new Error('Expected ObjectView');
  view.document.fields=[];
  await expect(validateComposition('profile',profile,async()=>view)).rejects.toMatchObject({code:'INVALID_AGENT_PROFILE'});
});
it('keeps Navigation at the application root and projections inside Pages',async()=>{
  const navigation=asset('nav',{kind:'navigation',entry:'home',nodes:[{id:'home',pageId:'home',label:'Home',path:'/'}]});
  const page=productAssetInputSchema.parse({name:'Page',document:{kind:'page',children:[{assetId:'nav'}]}});
  await expect(validateComposition('page',page,async()=>navigation)).rejects.toMatchObject({code:'INVALID_PRODUCT_CHILD'});
  const metric=asset('metric',{kind:'metric-widget',renders:{kind:'MetricView',id:'count'},parameters:{},valueField:'count'});
  const app=productAssetInputSchema.parse({name:'Application',document:{kind:'application',applicationId:'app',navigationId:'nav',children:[{assetId:'metric'}]}});
  await expect(validateComposition('app',app,async id=>id==='nav'?navigation:metric)).rejects.toMatchObject({code:'INVALID_PRODUCT_CHILD'});
  if(app.document.kind!=='application')throw new Error('Expected Application');
  delete app.document.navigationId;
  await expect(validateComposition('app',app,async()=>metric)).rejects.toMatchObject({code:'INVALID_PRODUCT_CHILD'});
});
it('rejects Actions exposed indirectly by an embedded AgentProfile on a display-only Page',async()=>{
  const action=asset('action',{kind:'action-view',renders:{kind:'Action',id:'approve'},parameters:{}});
  const profile=asset('profile',{kind:'agent-profile',principalId:'agent',instructions:'',tools:['action'],contextViews:[]});
  const page=productAssetInputSchema.parse({name:'Display',document:{kind:'page',embeddable:true,children:[{assetId:'profile'}]}});
  await expect(validateComposition('page',page,async id=>id==='profile'?profile:action)).rejects.toMatchObject({code:'INVALID_EMBEDDABLE_PAGE'});
});
