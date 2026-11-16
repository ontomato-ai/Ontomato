import {afterEach,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,ref,type App} from 'vue';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import ObjectProjectionRuntime from '../products/ObjectProjectionRuntime.vue';
import {installObjectViewHost} from './object-view-host';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';vi.unstubAllGlobals();});
async function settle(){for(let i=0;i<8;i++){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}}
it('renders only declared text context fields and preserves the selected object during invalidation',async()=>{
  const calls:unknown[]=[];
  vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{calls.push(JSON.parse(String(init.body)));return Response.json({object:{name:'Alice',salary:900}});});
  const asset=productAssetSchema.parse({id:'context',ownerId:'author',name:'Person',description:'',visibility:'domain',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'object-projection',renders:{kind:'ObjectType',id:'Person'},renderer:'text',fields:['name']}});
  const revision=ref(0);const element=document.createElement('div');document.body.append(element);
  app=createApp({render:()=>h(ObjectProjectionRuntime,{asset,revision:revision.value,pageState:{selected:{className:'Person',primaryKey:'alice'}}})});installObjectViewHost(app);app.mount(element);
  await settle();expect(element.querySelector('pre')?.textContent).toBe('name: Alice');
  expect(element.textContent).not.toContain('900');
  revision.value++;await settle();
  expect(calls).toHaveLength(2);expect(calls[1]).toEqual({primaryKey:'alice',revision:1});
});
