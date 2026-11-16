import {afterEach,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import MetricProjectionRuntime from '../products/MetricProjectionRuntime.vue';
import {installObjectViewHost} from './object-view-host';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';vi.unstubAllGlobals();});
it('preserves literal text parsing and renders a published numeric result without recalculating it',async()=>{
  const calls:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    const input=JSON.parse(String(init.body));calls.push(input);
    return Response.json({success:true,data:url.endsWith('/queryById')?{function:{parameters:[]}}:[{value:0.25}]});
  });
  const asset=productAssetSchema.parse({id:'metric',ownerId:'author',name:'Published ratio',description:'',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'ratio'},renderer:'number',parameters:{year:{source:'literal',value:'2026'}},valueField:'value',format:{kind:'percent',decimals:2,locale:'en-US'}}});
  const element=document.createElement('div');document.body.append(element);app=createApp({render:()=>h(MetricProjectionRuntime,{asset})});installObjectViewHost(app);app.mount(element);
  for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}
  expect(calls[1]).toMatchObject({parameterTexts:{year:'2026'}});
  expect(element.querySelector('strong')?.textContent).toBe('0.25 %');
});
