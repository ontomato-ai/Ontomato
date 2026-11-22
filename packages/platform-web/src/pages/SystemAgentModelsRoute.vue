<script setup lang="ts">
import {computed,defineComponent,h} from 'vue';
import {useRoute,useRouter} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {AgentModelsPage,PlatformTabs,ontologyAgentModelPages,ontologyAgentModelSource,usePageAccess,useLeaveConfirmation} from '@ontomato/platform-shell';
import {platformRoutes} from '@ontomato/platform-shell/routes';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import BuilderModelsRoute from './BuilderModelsRoute.vue';
const route=useRoute(),router=useRouter(),{t}=useI18n(),canOpen=usePageAccess();
const leave=useLeaveConfirmation();
async function select(category:string){if(category===active.value)return;if(leave.leaves('/settings/model-config/agents/category')&&!await leave.confirm())return;await router.replace({query:{category}});}
const options=computed(()=>[
 ...ontologyAgentModelPages.map(page=>({id:page.app,label:t(page.app==='ontology'?'platform.ontologyAgentModels':'platform.conversationAgentModels'),path:platformRoutes.usage.path})),
 {id:'builder',label:t('platform.builderAgentModels'),path:platformRoutes.builderModels.path},
].filter(option=>canOpen(option.path)));
const active=computed(()=>options.value.find(option=>option.id===route.query.category)?.id??options.value[0]?.id??'');
const sources=new Map(ontologyAgentModelPages.map(page=>[page.app,ontologyAgentModelSource({async get(path){const response=await nodeApiRequest('/api/data-query'+path);const body=await response.json();return body.data??body;},async put(path,value){const response=await nodeApiRequest('/api/data-query'+path,{method:'PUT',body:JSON.stringify(value)});const body=await response.json();return body.data??body;}},page)]));
const source=computed(()=>sources.get(active.value as 'ontology'|'agents'));
const CategoryTabs=defineComponent({setup:()=>()=>h('div',{class:'model-category-tabs'},h(PlatformTabs,{tabs:options.value,activeId:active.value,label:'智能体模型分类',onSelect:select}))});
</script>
<template><section class="system-agent-models"><BuilderModelsRoute v-if="active==='builder'" :title="t('platform.systemAgentModels')" :description="t('platform.systemAgentModelsDescription')"><template #navigation><CategoryTabs/></template></BuilderModelsRoute><AgentModelsPage v-else-if="source" :key="active" :source="source" path="/settings/model-config/agents" :title="t('platform.systemAgentModels')" :description="t('platform.systemAgentModelsDescription')"><template #navigation><CategoryTabs/></template></AgentModelsPage></section></template>
<style scoped>.system-agent-models{display:flex;flex-direction:column;height:100%;min-height:0}.model-category-tabs{padding:12px var(--page-gutter);flex-shrink:0}.system-agent-models>:last-child{flex:1;min-height:0}</style>
