import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,ref,type App} from 'vue';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import MetricProjectionRuntime from '../products/MetricProjectionRuntime.vue';
import {installObjectViewHost} from './object-view-host';
import {chartFile} from './chart-fixture';
/** The platform chart is the shared component; this stub reports the file and the output it is given. */
const drawn:Array<{file:unknown;metric:{columns:{key:string}[];rows:Record<string,unknown>[]}}>=[];
vi.mock('@ontomato/foundation-ui/chart',()=>({MetricChart:{props:['file','metric','height'],setup:(props:never)=>{drawn.push(props as never);return()=>h('div',{class:'drawn'});}}}));
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';drawn.length=0;vi.unstubAllGlobals();});
it('preserves literal text parsing and renders a published numeric result without recalculating it',async()=>{
  const calls:Array<{url:string;body:Record<string,unknown>}>=[];
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    calls.push({url,body:JSON.parse(String(init.body))});
    if(url.endsWith('/metrics/describe'))return Response.json({outputColumns:[{key:'value',label:null,type:null}]});
    return Response.json({success:true,data:url.endsWith('/queryById')?{function:{parameters:[]}}:[{value:0.25}]});
  });
  const asset=productAssetSchema.parse({id:'metric',ownerId:'author',name:'Published ratio',description:'',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'ratio'},renderer:'number',parameters:{year:{source:'literal',value:'2026'}},valueField:'value',format:{kind:'percent',decimals:2,locale:'en-US'}}});
  const element=document.createElement('div');document.body.append(element);app=createApp({render:()=>h(MetricProjectionRuntime,{asset})});installObjectViewHost(app);app.mount(element);
  for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}
  expect(calls.find(call=>call.url.endsWith('/execute'))?.body).toMatchObject({parameterTexts:{year:'2026'}});
  expect(element.querySelector('strong')?.textContent).toBe('0.25 %');
});

describe('a MetricWidget chart',()=>{
  const chart=(parameters:Record<string,unknown>)=>({id:'chart',ownerId:'author',name:'Orders by kind',description:'',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'orders'},renderer:'chart',chartFile:chartFile(),parameters,height:360}});
  it('draws the saved file from the current MetricView output and reads again for a new page parameter',async()=>{
    const actions:string[]=[],reads:Array<Record<string,unknown>>=[];
    vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
      actions.push(url);
      if(url.endsWith('/queryById'))return Response.json({success:true,data:{function:{queryPackage:{manifest:{parameterDefs:[{name:'year',value:2025}]}}}}});
      // The MetricView declares one more column than the file draws; the chart draws the columns it names.
      if(url.endsWith('/metrics/describe'))return Response.json({outputColumns:[{key:'kind',label:null,type:null},{key:'amount',label:null,type:null},{key:'region',label:null,type:null}]});
      const body=JSON.parse(String(init.body));if(url.endsWith('/execute'))reads.push(body.param);
      return Response.json({success:true,data:[{kind:'A',amount:1,region:'east'}]});
    });
    const pageState=ref<Record<string,unknown>>({year:2025});
    const asset=productAssetSchema.parse(chart({year:{source:'variable',path:'year'}}));
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(MetricProjectionRuntime,{asset,pageState:pageState.value})});installObjectViewHost(app);app.mount(element);
    for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}
    expect(reads.at(-1)).toEqual({year:2025});
    expect(drawn.at(-1)?.file).toEqual(chartFile());
    expect(drawn.at(-1)?.metric.columns).toEqual([{key:'kind',label:null,type:null},{key:'amount',label:null,type:null},{key:'region',label:null,type:null}]);
    expect(drawn.at(-1)?.metric.rows).toEqual([{kind:'A',amount:1,region:'east'}]);
    // The same widget with another page state reads the current MetricView again and draws no second chart.
    pageState.value={year:2026};
    await nextTick();
    for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}
    expect(reads.at(-1)).toEqual({year:2026});
    expect(actions.some(url=>url.includes('/skills'))).toBe(false);
  });
});
