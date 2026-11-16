import {expect,it} from 'vitest';
import {mount} from '@vue/test-utils';
import {createRouter,createMemoryHistory} from 'vue-router';
import ElementPlus from 'element-plus';
import {createI18n} from 'vue-i18n';
import {productAssetSchema} from '@ontomato/contracts/product-assets';
import PlatformCollectionList from '../pages/PlatformCollectionList.vue';
it('opens the governed Conversation identity provided by its collection projection',async()=>{
  const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{template:'<div />'}},{path:'/agents/chat',component:{template:'<div />'}}]});await router.push('/');
  const asset=productAssetSchema.parse({id:'view',name:'Conversations',ownerId:'author',visibility:'private',revision:1,editable:false,createdAt:'now',updatedAt:'now',document:{kind:'collection-view',renders:{kind:'Definition',id:'conversations'},renderer:'list',parameters:{},fields:['title','agentId']}});
  const wrapper=mount(PlatformCollectionList,{props:{asset,objectType:'platform:Conversation',rows:[{id:'session',agentId:'agent',title:'Discussion'}]},global:{plugins:[router,ElementPlus,createI18n({legacy:false,locale:'en',messages:{en:{}}})]}});
  await wrapper.get('button').trigger('click');await router.isReady();await new Promise(resolve=>setTimeout(resolve,0));
  expect(router.currentRoute.value.query).toEqual({agentId:'agent',sessionId:'session'});wrapper.unmount();
});
