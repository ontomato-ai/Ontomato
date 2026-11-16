import {expect,it} from 'vitest';
import {productAssetInputSchema,productQuerySchema,productTypes,productAuthoringSchema} from '@ontomato/contracts/product-assets';
import {validatePageState,validateProductNavigation} from '@ontomato/contracts/product-page-state';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import {formatProjectionValue,projectionDisplayRows,projectionDisplaySchema} from '@ontomato/contracts/product-projections';
import {invalidateProductData,onProductInvalidation} from '@ontomato/contracts/product-invalidation';
import {createObjectView,objectProjectionIssues,objectViewProductIssues} from '@ontomato/contracts/object-views';

it('rejects extra projection targets and inline predicates',()=>{
  const document={kind:'collection-view',renders:{kind:'Definition',id:'active'},renderer:'table',parameters:{},fields:['name']};
  expect(productAssetInputSchema.safeParse({name:'Active',document}).success).toBe(true);
  expect(productAssetInputSchema.safeParse({name:'Active',document:{...document,predicate:'salary > 0'}}).success).toBe(false);
  expect(productAssetInputSchema.safeParse({name:'Active',document:{...document,renders:{kind:'Definition',id:'active',second:'other'}}}).success).toBe(false);
});
it('keeps legacy migration inputs and personal preferences out of the current authoring contract',()=>{
  expect(productAuthoringSchema.safeParse({name:'Page',revision:0,document:{kind:'page',children:[]}}).success).toBe(true);
  expect(productAuthoringSchema.safeParse({name:'Page',revision:0,document:{kind:'page',children:[],workspace:{}}}).success).toBe(false);
  expect(productAuthoringSchema.safeParse({name:'Dashboard',revision:0,document:{kind:'dashboard',dashboardId:'board'}}).success).toBe(false);
  expect(productAuthoringSchema.safeParse({name:'Page',revision:0,visibility:'domain',document:{kind:'page',children:[]}}).success).toBe(false);
});
it('exposes every V2 asset kind through catalog creation and paginated filtering',()=>{
  for(const kind of ['metric-widget','action-view','collection-view','object-projection','navigation','agent-profile']){
    expect(productTypes.some(type=>type.kind===kind)).toBe(true);
    expect(productQuerySchema.parse({kind}).kind).toBe(kind);
  }
});
it('formats display values without manufacturing percentages and tolerates invalid display inputs',()=>{
  expect(formatProjectionValue(0.25,{kind:'percent',locale:'en-US',decimals:2})).toBe('0.25 %');
  expect(formatProjectionValue('invalid',{kind:'date'})).toBe('invalid');
  expect(formatProjectionValue(10,{kind:'number',locale:'not_a_locale'})).toBe('10');
  expect(formatProjectionValue(null,{kind:'number'})).toBe('—');
});
it('sorts display rows without changing numeric results or accepting calculation expressions',()=>{
  const rows=[{name:'B',value:2},{name:'A',value:7}];
  expect(projectionDisplayRows(rows,{sort:[{field:'name',order:'asc'}],limit:1})).toEqual([{name:'A',value:7}]);
  expect(rows).toEqual([{name:'B',value:2},{name:'A',value:7}]);
  expect(projectionDisplaySchema.safeParse({expression:'value * 100'}).success).toBe(false);
});
it('uses typed object navigation values rather than accepting objects of another type',()=>{
  const signature={selected:{kind:'object' as const,objectType:'Person'}};
  expect(validatePageState(signature,{selected:{className:'Person',primaryKey:'1'}})).toHaveProperty('selected');
  expect(()=>validatePageState(signature,{selected:{className:'Salary',primaryKey:'1'}})).toThrow();
  expect(()=>validatePageState(signature,{predicate:'status=active'})).toThrow();
});
it('constrains published navigation to its declared Page nodes',()=>{
  const asset=(id:string,document:unknown)=>productAssetSchema.parse({id,name:id,description:'',ownerId:'author',visibility:'private',revision:1,editable:false,createdAt:'now',updatedAt:'now',document});
  const assets=[asset('navigation',{kind:'navigation',entry:'home',nodes:[{id:'home',pageId:'home',label:'Home',path:'/'}]}),asset('home',{kind:'page',children:[]}),asset('internal',{kind:'page',children:[]})];
  expect(validateProductNavigation(assets,'home').id).toBe('home');
  expect(()=>validateProductNavigation(assets,'internal')).toThrow();
});
it('isolates failing invalidation observers after a completed Action',()=>{
  const stopBroken=onProductInvalidation(()=>{throw new Error('Reader failed');});
  let refreshed=false;const stopReader=onProductInvalidation(()=>{refreshed=true;});
  expect(()=>invalidateProductData({actionId:'approve',objectTypes:['Order']})).not.toThrow();
  expect(refreshed).toBe(true);stopBroken();stopReader();
});
it('allows governed attribute reads only in the product-owned ObjectView contract',()=>{
  const document=createObjectView('Person');
  expect(objectViewProductIssues(document)).not.toEqual([]);
  expect(objectProjectionIssues(document)).toEqual([]);
  document.tabs[0].sections[0].widgets[0].visibleWhen={binding:{source:'object',path:'salary'},operator:'eq',value:'high'};
  expect(objectProjectionIssues(document)).not.toEqual([]);
});
