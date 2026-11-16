<script setup lang="ts">
import {ref} from 'vue';
import {AgentModelsPage,ontologyAgentModelPages,ontologyAgentModelSource} from '@ontomato/platform-shell';
import {ElButton,ElMessageBox} from 'element-plus';
import {useManagerClient} from '../context';
const client=useManagerClient(),revision=ref(0);
defineProps<{title?:string;description?:string}>();
const page=ontologyAgentModelPages.find(page=>page.app==='governance')!;
const source=ontologyAgentModelSource(client.dataEngine,page);
async function create(){const result=await ElMessageBox.prompt('配置名称','新增知识治理智能体',{inputValidator:value=>!!value?.trim()});await client.request('/ontology/ai/knowledge-governance/agents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:result.value.trim()})});revision.value++;}
</script>
<template><AgentModelsPage :key="revision" :source="source" :path="page.path" :title="title" :description="description"><template #actions="state"><ElButton :disabled="state.dirty||state.saving" @click="create">新增治理智能体</ElButton></template><template #navigation><slot name="navigation"/></template></AgentModelsPage></template>
<style scoped>.governance-models{height:100%;min-height:0;display:flex;flex-direction:column}.model-actions{padding:12px 24px;display:flex;justify-content:flex-end}.governance-models :deep(.agent-models-page){flex:1;min-height:0}</style>
