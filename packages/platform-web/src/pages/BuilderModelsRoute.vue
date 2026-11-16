<script setup lang="ts">
import {AgentModelsPage,type AgentModelSource} from '@ontomato/platform-shell';
import {modelOptionsSchema} from '@ontomato/contracts/model-settings';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {ElMessageBox,ElButton} from 'element-plus';
import {ref} from 'vue';
const revision=ref(0);
const source:AgentModelSource={async load(){const [response,modelsResponse]=await Promise.all([nodeApiRequest('/api/app-builder/agents'),nodeApiRequest('/api/data-query/model-options')]);const result=await response.json(),models=await modelsResponse.json();return {agents:result.agents.map((agent:{id:string;name:string;modelSelection:{modelId:string|null}})=>({id:agent.id,kind:null,name:agent.name==='App builder'?'应用构建':agent.name,description:'应用设计、代码生成与发布对话',modelId:agent.modelSelection.modelId})),models:modelOptionsSchema.parse(models.data??models)};},async save(id,modelId){const response=await nodeApiRequest(`/api/app-builder/agents/${id}/model`,{method:'PUT',body:JSON.stringify({modelSelection:{modelId}})});return (await response.json()).modelSelection.modelId;}};
async function create(){const result=await ElMessageBox.prompt('配置名称','新增应用构建智能体',{inputValidator:value=>!!value?.trim()});await nodeApiRequest('/api/app-builder/agents',{method:'POST',body:JSON.stringify({name:result.value.trim(),modelSelection:{modelId:null}})});revision.value++;}
</script>
<template><section class="builder-models"><div class="builder-model-actions"><ElButton @click="create">新增构建智能体</ElButton></div><AgentModelsPage :key="revision" :source="source" path="/settings/model-config/app-builder"/></section></template>
<style scoped>.builder-models{height:100%;min-height:0;display:flex;flex-direction:column}.builder-model-actions{padding:12px 24px;display:flex;justify-content:flex-end}.builder-models :deep(.agent-models-page){flex:1;min-height:0}</style>
