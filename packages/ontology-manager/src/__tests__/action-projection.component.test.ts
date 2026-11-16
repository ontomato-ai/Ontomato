import {afterEach,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import ActionProjectionRuntime from '../products/ActionProjectionRuntime.vue';
import {installObjectViewHost} from './object-view-host';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';vi.unstubAllGlobals();});
async function settle(){for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}}
it('loads inline fields from the Action signature and submits the typed parameters it returns',async()=>{
  const calls:{url:string;body:unknown}[]=[];
  vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{
    calls.push({url,body:init.body});
    if(url.endsWith('/action/form')){
      const input=JSON.parse(String(init.body));
      return Response.json({success:true,data:{fields:[{key:'name',label:'Name',type:'text',required:true,defaultValue:null,help:null,multiline:false,placeholder:null,maxLength:200}],values:{name:'Alice'},errors:[],parameters:input.values?{name:'Alice'}:null}});
    }
    return Response.json({success:true,data:{result:'done',affects:['Person']}});
  });
  const asset=productAssetSchema.parse({id:'edit',ownerId:'author',name:'Edit person',description:'',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'action-view',renders:{kind:'Action',id:'edit-person'},renderer:'inline',parameters:{}}});
  const element=document.createElement('div');document.body.append(element);
  app=createApp({render:()=>h(ActionProjectionRuntime,{asset})});installObjectViewHost(app);app.mount(element);
  await settle();expect(element.querySelector('input')).not.toBeNull();
  element.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await settle();
  const executed=calls.find(call=>call.url.endsWith('/action/execute'))!;
  expect(executed.body).toBeInstanceOf(FormData);
  expect((executed.body as FormData).get('param')).toBe('{"name":"Alice"}');
});
