import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,ref,type App} from 'vue';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import MetricProjectionRuntime from '../products/MetricProjectionRuntime.vue';
import ProductAssetCatalog from '../products/ProductAssetCatalog.vue';
import DashboardChartPicker from '../components/DashboardChartPicker.vue';
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

describe('a chart MetricWidget',()=>{
  const settle=async()=>{for(let i=0;i<10;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};
  it('asks for an existing chart only when the presentation is a chart, and keeps what the chart brings',async()=>{
    const calls:string[]=[];
    vi.stubGlobal('fetch',async(url:string)=>{
      calls.push(url);
      if(url.endsWith('/dashboards'))return Response.json({success:true,data:[{id:'board-1',name:'Sales',createdAt:0,updatedAt:0}]});
      if(url.includes('/dashboards/board-1'))return Response.json({success:true,data:{id:'board-1',ownerId:'author',name:'Sales',createdAt:0,updatedAt:0,groups:[{id:'g',title:'Sales',metrics:[],charts:[{id:'card-1',name:'Orders by kind',query:{kind:'metric',metricId:'orders',parameters:{year:2026}},chartFile:{name:'orders.chart.json',content:chartFile()}}]}]}});
      return Response.json({success:true,data:{items:[],total:0}});
    });
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(ProductAssetCatalog,{createKind:'metric-widget'})});installObjectViewHost(app);app.mount(element);
    await settle();
    // A new MetricWidget shows a number until its presentation becomes a chart: it asks for nothing and reads no dashboard.
    expect(calls.some(url=>url.includes('/dashboards'))).toBe(false);
    expect(document.querySelector('.el-overlay-dialog')?.textContent?.trim()).toBeFalsy();
  });
});

describe('bringing in a dashboard chart',()=>{
  const settle=async()=>{for(let i=0;i<10;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};
  it('lists the author\'s dashboards and hands over the chosen card as stored',async()=>{
    const calls:string[]=[];
    vi.stubGlobal('fetch',async(url:string)=>{
      calls.push(url);
      if(url.endsWith('/dashboards'))return Response.json({success:true,data:[{id:'board-1',name:'Sales',createdAt:0,updatedAt:0},{id:'board-2',name:'Stock',createdAt:0,updatedAt:0}]});
      if(url.includes('/dashboards/board-1'))return Response.json({success:true,data:{id:'board-1',ownerId:'author',name:'Sales',createdAt:0,updatedAt:0,groups:[{id:'g',title:'Sales',metrics:[],charts:[{id:'card-1',name:'Orders by kind',query:{kind:'metric',metricId:'orders',parameters:{year:2026}},chartFile:{name:'orders.chart.json',content:chartFile()}}]}]}});
      return Response.json({success:true,data:{id:'board-2',ownerId:'author',name:'Stock',createdAt:0,updatedAt:0,groups:[]}});
    });
    const picked:unknown[]=[];
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(DashboardChartPicker,{modelValue:true,onPick:(chart:unknown)=>picked.push(chart)})});installObjectViewHost(app);app.mount(element);
    await settle();
    expect(document.querySelector('.el-overlay-dialog')?.textContent).toContain('Sales');
    const choose=Array.from(document.querySelectorAll('.el-overlay-dialog button')).find(button=>button.textContent?.trim()==='Bring in') as HTMLButtonElement;
    choose.click();
    await settle();
    expect(picked).toEqual([{id:'card-1',name:'Orders by kind',query:{kind:'metric',metricId:'orders',parameters:{year:2026}},chartFile:{name:'orders.chart.json',content:chartFile()}}]);
    // Reading is all this does: no card is saved back to the source dashboard.
    expect(calls.every(url=>url.includes('/dashboards'))).toBe(true);
  });
});
