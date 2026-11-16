import {afterEach,expect,it} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {createI18n} from 'vue-i18n';
import ProductAssetGraph from '../products/ProductAssetGraph.vue';
import type {ProductGraph} from '@ontomato/contracts/product-graph';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';});
it('opens the clicked asset identity and isolates SVG links between graph instances',async()=>{
  const graph:ProductGraph={nodes:[{id:'asset:page',assetId:'page',name:'Page',kind:'page',category:'composition'},{id:'asset:metric',assetId:'metric',name:'Metric',kind:'metric-widget',category:'element'}],edges:[{source:'asset:page',target:'asset:metric',relation:'contains',storage:'product-index'}]};
  const opened:string[]=[];
  const element=document.createElement('div');document.body.append(element);
  app=createApp({render:()=>h('div',[h(ProductAssetGraph,{graph,onOpen:(id:string)=>opened.push(id)}),h(ProductAssetGraph,{graph})])});app.use(createI18n({legacy:false,locale:'en',messages:{en:{}}}));app.mount(element);await nextTick();
  const links=element.querySelectorAll('[role="link"]');
  links[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  expect(opened).toEqual(['metric']);
  const edgeLinks=[...element.querySelectorAll('textPath')].map(node=>node.getAttribute('href'));
  expect(new Set(edgeLinks).size).toBe(2);
  for(const link of edgeLinks)expect(element.querySelector(link!)).not.toBeNull();
});
