import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,ref,type App} from 'vue';
import {ElButton,ElCheckbox,ElFormItem,ElInput,ElInputNumber,ElOption,ElSelect} from 'element-plus';
import {productAssetInputSchema,productAssetSchema,productAuthoringSchema} from '@ontomato/contracts/product-assets';
import MetricProjectionRuntime from '../products/MetricProjectionRuntime.vue';
import ProductAssetCatalog from '../products/ProductAssetCatalog.vue';
import DashboardChartPicker from '../components/DashboardChartPicker.vue';
import {installObjectViewHost} from './object-view-host';
import {chartFile} from './chart-fixture';
/** The platform chart is the shared component; this stub reports the file and the output it is given. */
const drawn:Array<{file:unknown;metric:{columns:{key:string}[];rows:Record<string,unknown>[]}}>=[];
vi.mock('@ontomato/foundation-ui/chart',()=>({MetricChart:{props:['file','metric','height'],setup:(props:never)=>{drawn.push(props as never);return()=>h('div',{class:'drawn'});}}}));
let app:App|undefined;
afterEach(()=>{app?.unmount();app=undefined;document.body.innerHTML='';drawn.length=0;vi.unstubAllGlobals();});
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

/** The catalog's own controls come from the host's global Element Plus registration. */
function installElement(app:App){for(const component of [ElButton,ElFormItem,ElInput,ElSelect,ElOption,ElCheckbox,ElInputNumber])app.component(component.name!,component);}
/** The catalog's buttons as a reader meets them; its controls are Element Plus components. */
const findButton=(scope:ParentNode,text:string)=>Array.from(scope.querySelectorAll("button")).find(item=>item.textContent?.trim()===text) as HTMLButtonElement|undefined;

describe('a chart MetricWidget',()=>{
  const settle=async()=>{for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};
  const card={id:'card-1',name:'Orders by kind',query:{kind:'metric',metricId:'orders',parameters:{year:2026}},chartFile:{name:'orders.chart.json',content:chartFile()}};
  /** An existing MetricWidget as the asset API returns it; `presentation` is what the form starts from. */
  const stored=(presentation:Record<string,unknown>)=>({id:'asset-1',ownerId:'author',name:'Orders',description:'',visibility:'private',revision:1,editable:true,createdAt:'now',updatedAt:'now',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'orders'},parameters:{},height:240,isDefault:false,audience:'both',...presentation}});
  /** A saved document the API answers with, so the form can open it. */
  const savedDocument=(presentation:Record<string,unknown>)=>({kind:'metric-widget',renders:{kind:'MetricView',id:'orders'},parameters:{},height:240,isDefault:false,audience:'both',...presentation});
  function host(loaded:unknown,update?:unknown){
    const sent:Array<{url:string;method:string;body:Record<string,any>|undefined}>=[];
    vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{
      sent.push({url,method:init.method??'GET',body:init.body?JSON.parse(String(init.body)):undefined});
      if(url.endsWith('/dashboards'))return Response.json({success:true,data:[{id:'board-1',name:'Sales',createdAt:0,updatedAt:0}]});
      if(url.includes('/dashboards/board-1'))return Response.json({success:true,data:{id:'board-1',ownerId:'author',name:'Sales',createdAt:0,updatedAt:0,groups:[{id:'g',title:'Sales',metrics:[],charts:[card]}]}});
      if(url.endsWith('/queryList'))return Response.json({success:true,data:[{id:'orders',name:'Orders',status:'PUBLISHED'}]});
      if(url.endsWith('/native-binding'))return Response.json({});
      if(init.method==='PUT'){const body=JSON.parse(String(init.body));return Response.json({asset:{...body,id:'asset-1',ownerId:'author',revision:2,createdAt:'now',updatedAt:'now',editable:true}});}
      if(update&&url.includes('/product-assets/asset-1'))return Response.json(update);
      if(url.includes('/product-assets/asset-1'))return Response.json(loaded);
      return Response.json({success:true,data:{items:[],total:0}});
    });
    return sent;
  }
  function mountCatalog(){
    const element=document.createElement("div");document.body.append(element);
    app=createApp({render:()=>h(ProductAssetCatalog,{assetId:'asset-1'})});
    // The catalog's own controls come from the host's global Element Plus registration.
    installElement(app);
    installObjectViewHost(app);app.mount(element);
    return element;
  }
  const button=findButton;
  async function editView(element:HTMLElement){
    button(element,"Edit")!.click();
    await settle();
  }
  async function bringIn(element:HTMLElement){
    button(element,"Bring in a chart")!.click();
    await settle();
    button(document.querySelector(".el-overlay-dialog")!,"Bring in")!.click();
    await settle();
  }
  async function save(element:HTMLElement){
    button(element,"Save")!.click();
    await settle();
  }
  const saved=(sent:Array<{url:string;method:string;body:Record<string,any>|undefined}>)=>sent.find(item=>item.method==="PUT")?.body;

  it('saves the chart it brought in as the chart file and its MetricView alone',async()=>{
    const sent=host({asset:stored({renderer:'chart',chartFile:chartFile()})});
    const element=mountCatalog();
    await settle();
    await editView(element);
    await bringIn(element);
    await save(element);
    const body=saved(sent)!;
    // Nothing the number presentation wrote survives, and the chart's own identity is what is saved.
    expect(body.document).toMatchObject({kind:'metric-widget',renderer:'chart',renders:{kind:'MetricView',id:'orders'},chartFile:chartFile(),parameters:{year:{source:'literal',value:2026}}});
    expect(body.document).not.toHaveProperty('format');
    expect(productAuthoringSchema.safeParse(body).success).toBe(true);
  });
});
describe('a product form',()=>{
  const settle=async()=>{for(let i=0;i<40;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}};
  it('starts the next form clean: a refused save belongs to the form that made it',async()=>{
    const number={id:'asset-1',ownerId:'author',name:'Orders',description:'',visibility:'private',revision:1,editable:true,createdAt:'now',updatedAt:'now',document:{kind:'metric-widget',renders:{kind:'MetricView',id:'orders'},renderer:'number',parameters:{},height:240,isDefault:false,audience:'both',valueField:'amount'}};
    vi.stubGlobal('fetch',async(url:string,init:RequestInit={})=>{
      if(url.endsWith('/native-binding'))return Response.json({});
      if(init.method==='PUT')throw new TypeError('document.renders.id: String must contain at least 1 character');
      if(url.includes('/product-assets/asset-1'))return Response.json({asset:number});
      if(url.endsWith('/queryList'))return Response.json({success:true,data:[]});
      return Response.json({success:true,data:{items:[],total:0}});
    });
    const element=document.createElement('div');document.body.append(element);
    app=createApp({render:()=>h(ProductAssetCatalog,{assetId:'asset-1'})});installElement(app);installObjectViewHost(app);app.mount(element);
    await settle();
    // A save the server refuses leaves its reason on that form.
    findButton(element,'Edit')!.click();
    await settle();
    findButton(element,'Save')!.click();
    await settle();
    expect(element.querySelector('.product-alert el-alert')?.getAttribute('title')).toContain('document.renders.id');
    // Reopening the editor starts clean: the refusal belonged to that save, not to the asset.
    findButton(element,'Cancel')!.click();
    await settle();
    findButton(element,'Edit')!.click();
    await settle();
    expect(element.querySelector('.product-alert')).toBeNull();
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
