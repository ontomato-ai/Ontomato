import {afterEach,expect,it,vi} from 'vitest';
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils';
import {createRouter,createMemoryHistory} from 'vue-router';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('@ontomato/workbench-ui',()=>({nodeApiRequest:mocks.request}));
vi.mock('@ontomato/ontology-manager',()=>({ManagerFrame:{template:'<div><slot /></div>'},ProductAssetRuntime:{props:['asset','pageState'],template:'<div class="projection">{{JSON.stringify(pageState)}}</div>'}}));
vi.mock('../pages/PersonalWorkspaceRoute.vue',()=>({default:{props:['productAssetId','pinnedAssets'],template:'<div class="page">{{productAssetId}}</div>'}}));
import ProductRoute from '../pages/ProductRoute.vue';
let wrapper:VueWrapper|undefined;
afterEach(()=>{wrapper?.unmount();vi.resetAllMocks();});
const asset=(id:string,document:unknown)=>productAssetSchema.parse({id,name:id,description:'',ownerId:'author',visibility:'private',revision:1,editable:false,createdAt:'now',updatedAt:'now',document});
async function open(id:string,query:Record<string,string>={}){
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/products/:id',component:ProductRoute,props:route=>({productAssetId:route.params.id,applicationId:route.query.applicationId})}]});
  await router.push({path:`/products/${id}`,query});await router.isReady();
  wrapper=mount({template:'<router-view />'},{global:{plugins:[router]}});await flushPromises();return wrapper;
}
it('runs a declarative Applications Navigation entry from its frozen release tree',async()=>{
  const root=asset('app',{kind:'application',applicationId:'app',navigationId:'nav',children:[]});
  const navigation=asset('nav',{kind:'navigation',entry:'start',nodes:[{id:'start',pageId:'published-page',label:'Home',path:'/'}]});
  const page=asset('published-page',{kind:'page',children:[]});
  mocks.request.mockResolvedValue(Response.json({asset:root,assets:[root,navigation,page],issues:[]}));
  const view=await open('app',{applicationId:'app'});
  expect(view.find('.page').text()).toBe('published-page');
  expect(mocks.request.mock.calls.every(([path])=>path.includes('/published/app/'))).toBe(true);
});
it('passes a validated object identity to the selected ObjectView renderer',async()=>{
  const objectView=asset('person-view',{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'card',fields:['name']});
  mocks.request.mockResolvedValue(Response.json({asset:objectView,assets:[objectView],issues:[]}));
  const state={selected:{className:'Person',primaryKey:'one'}};
  const view=await open('person-view',{applicationId:'app',state:JSON.stringify(state)});
  expect(view.find('.projection').text()).toContain('"primaryKey":"one"');
});
it('opens the declared deep link rather than silently returning to the application entry',async()=>{
  const root=asset('app',{kind:'application',applicationId:'app',navigationId:'nav',children:[]});
  const navigation=asset('nav',{kind:'navigation',entry:'home',nodes:[{id:'home',pageId:'home',label:'Home',path:'/'},{id:'detail',pageId:'detail',label:'Detail',path:'/details'}]});
  mocks.request.mockImplementation(async()=>Response.json({asset:root,assets:[root,navigation,asset('home',{kind:'page',children:[]}),asset('detail',{kind:'page',children:[]})],issues:[]}));
  const view=await open('app',{applicationId:'app',navigationPath:'/details'});
  expect(view.find('.page').text()).toBe('detail');
});
it('rejects a deep link absent from the frozen Navigation',async()=>{
  const root=asset('app',{kind:'application',applicationId:'app',navigationId:'nav',children:[]});
  const navigation=asset('nav',{kind:'navigation',entry:'home',nodes:[{id:'home',pageId:'home',label:'Home',path:'/'}]});
  mocks.request.mockResolvedValue(Response.json({asset:root,assets:[root,navigation,asset('home',{kind:'page',children:[]})],issues:[]}));
  const view=await open('app',{applicationId:'app',navigationPath:'/undeclared'});
  expect(view.find('.page').exists()).toBe(false);
});
