import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {ElButton,ElFormItem,ElInput,ElInputNumber,ElOption,ElSelect} from 'element-plus';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import ProductAssetGraph from '../products/ProductAssetGraph.vue';
import {productGraph} from '@ontomato/contracts/product-graph';
import {installObjectViewHost} from './object-view-host';

const AGENTS=[
  {id:'11111111-1111-4111-8111-111111111111',name:'Assistant',description:'Answers business questions',icon:null,enabled:true},
];
let app:App|undefined;
afterEach(()=>{app?.unmount();app=undefined;document.body.innerHTML='';vi.unstubAllGlobals();});

function installElement(target:App){for(const component of [ElButton,ElFormItem,ElInput,ElSelect,ElOption,ElInputNumber])target.component(component.name!,component);}
const settle=async()=>{for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};

const profile=productAssetSchema.parse({
  id:'profile-1',ownerId:'author',name:'Default agent profile',description:'',visibility:'domain',revision:1,editable:true,
  createdAt:'now',updatedAt:'now',
  document:{kind:'agent-profile',agentId:AGENTS[0]!.id,instructions:'Be brief.',tools:[],contextViews:[]},
});

describe('a granted member in a product graph',()=>{
  it('is called a member, as the list and the legend call it',async()=>{
    const graph=productGraph([profile]);
    graph.nodes.push({id:'grant:principal:someone',name:'someone',kind:'principal',category:'principal'});
    graph.edges.push({source:'grant:principal:someone',target:'asset:profile-1',relation:'use',storage:'governance'});
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(ProductAssetGraph,{graph})});installElement(app);installObjectViewHost(app);app.mount(element);
    await settle();

    expect(element.textContent).toContain('Member');
    expect(element.textContent).not.toContain('Principal');
  });
});
