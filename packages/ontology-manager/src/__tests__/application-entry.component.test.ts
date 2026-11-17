import {afterEach,expect,it,vi} from 'vitest';
import {createApp,h,nextTick,type App} from 'vue';
import {openApplicationKey} from '@ontomato/platform-shell';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import ProductAssetRuntime from '../products/ProductAssetRuntime.vue';
import {installObjectViewHost} from './object-view-host';
let app:App|undefined;
afterEach(()=>{app?.unmount();document.body.innerHTML='';vi.unstubAllGlobals();});
it.each(['browser','data-governance','app-example'])('opens %s through the same host entry as the gallery',async applicationId=>{
 vi.stubGlobal('fetch',async()=>Response.json({asset:{},nativeApplicationId:applicationId}));
 const open=vi.fn();
 const asset=productAssetSchema.parse({id:'imported-asset',ownerId:'author',name:'App',description:'',visibility:'private',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'application',applicationId,children:[]}});
 const element=document.createElement('div');document.body.append(element);app=createApp({render:()=>h(ProductAssetRuntime,{asset})});installObjectViewHost(app);app.provide(openApplicationKey,open);app.mount(element);await nextTick();
 element.querySelector('a')!.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
 expect(open).toHaveBeenCalledWith(applicationId);
});
