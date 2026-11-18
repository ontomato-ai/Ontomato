import {expect,it} from 'vitest';
import {productGraph,productGraphSchema} from '@ontomato/contracts/product-graph';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import {defaultPersonalWorkspace} from '@ontomato/contracts/personal-workspace';

function asset(id:string,document:unknown){return productAssetSchema.parse({id,name:id,ownerId:'author',description:'',visibility:'private',revision:1,createdAt:'now',updatedAt:'now',editable:true,document});}
it('preserves intermediate composition edges and keeps same-named ontology identities distinct',()=>{
  const assets=[asset('app',{kind:'application',applicationId:'app',children:[{assetId:'page'}]}),asset('page',{kind:'page',workspace:defaultPersonalWorkspace(),children:[{assetId:'count'}]}),asset('template',{kind:'page',children:[{assetId:'count'}],isTemplate:true}),asset('count',{kind:'metric-widget',renders:{kind:'MetricView',id:'count'},parameters:{},valueField:'count'})];
  const graph=productGraphSchema.parse(productGraph(assets));
  expect(graph.edges).toEqual(expect.arrayContaining([
    {source:'asset:app',target:'asset:page',relation:'contains',storage:'product-index'},
    {source:'asset:page',target:'asset:count',relation:'contains',storage:'product-index'},
    {source:'asset:count',target:'metric:count',relation:'renders',storage:'product-index'},
  ]));
  expect(graph.nodes.find(node=>node.id==='asset:template')).toMatchObject({category:'composition',isTemplate:true});
  expect(new Set(graph.nodes.map(node=>node.id)).size).toBe(graph.nodes.length);
});
it('never invents hidden asset nodes',()=>{
  const profile=asset('profile',{kind:'agent-profile',agentId:'agent',instructions:'',tools:['missing'],contextViews:[]});
  const graph=productGraph([profile]);
  expect(graph.nodes.some(node=>node.id==='asset:missing')).toBe(false);
  expect(graph.edges).toContainEqual({source:'asset:profile',target:'agent:agent',relation:'embodies',storage:'product-index'});
});
it('preserves distinct Navigation, tool and context relationships',()=>{
  const navigation=asset('nav',{kind:'navigation',entry:'home',nodes:[{id:'home',pageId:'home',label:'Home',path:'/'}]});
  const page=asset('home',{kind:'page',children:[]});
  const app=asset('app',{kind:'application',applicationId:'app',navigationId:'nav',children:[]});
  const profile=asset('profile',{kind:'agent-profile',agentId:'agent',instructions:'',tools:['tool'],contextViews:['context']});
  const tool=asset('tool',{kind:'metric-widget',renders:{kind:'MetricView',id:'metric'},parameters:{},valueField:'value'});
  const context=asset('context',{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'text',fields:['name']});
  const graph=productGraph([app,navigation,page,profile,tool,context]);
  expect(graph.edges).toEqual(expect.arrayContaining([
    {source:'asset:app',target:'asset:nav',relation:'navigates',storage:'product-index'},
    {source:'asset:nav',target:'asset:home',relation:'navigates',storage:'product-index'},
    {source:'asset:profile',target:'asset:tool',relation:'tools',storage:'product-index'},
    {source:'asset:profile',target:'asset:context',relation:'context',storage:'product-index'},
  ]));
});
it('rejects graph responses with dangling endpoints before they reach the renderer',()=>{
  expect(productGraphSchema.safeParse({nodes:[],edges:[{source:'hidden',target:'missing',relation:'contains',storage:'product-index'}]}).success).toBe(false);
});
