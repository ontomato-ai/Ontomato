import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {ElButton,ElFormItem,ElInput,ElInputNumber,ElOption,ElSelect} from 'element-plus';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import ProductAssetGraph from '../products/ProductAssetGraph.vue';
import {productGraph} from '@ontomato/contracts/product-graph';
import {installObjectViewHost} from './object-view-host';

let app:App|undefined;
afterEach(()=>{app?.unmount();app=undefined;document.body.innerHTML='';vi.unstubAllGlobals();});

function installElement(target:App){for(const component of [ElButton,ElFormItem,ElInput,ElSelect,ElOption,ElInputNumber])target.component(component.name!,component);}
const settle=async()=>{for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};

const page=productAssetSchema.parse({
  id:'page-1',ownerId:'author',name:'Default page',description:'',visibility:'domain',revision:1,editable:true,
  createdAt:'now',updatedAt:'now',document:{kind:'page',children:[]},
});

describe('a granted member in a product graph',()=>{
  it('is called a member, as the list and the legend call it',async()=>{
    const graph=productGraph([page]);
    graph.nodes.push({id:'grant:principal:someone',name:'someone',kind:'principal',category:'principal'});
    graph.edges.push({source:'grant:principal:someone',target:'asset:page-1',relation:'use',storage:'governance'});
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(ProductAssetGraph,{graph})});installElement(app);installObjectViewHost(app);app.mount(element);
    await settle();

    expect(element.textContent).toContain('Member');
    expect(element.textContent).not.toContain('Principal');
  });
});
