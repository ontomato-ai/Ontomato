<script setup lang="ts">
import {AgentModelsPage,type AgentModelSource} from '@ontomato/platform-shell';
import {modelOptionsSchema} from '@ontomato/contracts/model-settings';
import {nodeApiRequest} from '@ontomato/workbench-ui';
defineProps<{title?:string;description?:string}>();
const source:AgentModelSource={async load(){const [response,modelsResponse]=await Promise.all([nodeApiRequest('/api/app-builder/agents'),nodeApiRequest('/api/data-query/model-options')]);const result=await response.json(),models=await modelsResponse.json();return {agents:result.agents.map((agent:{id:string;name:string;modelSelection:{modelId:string|null}})=>({id:agent.id,kind:null,name:agent.name==='App builder'?'应用构建':agent.name,description:'应用设计、代码生成与发布对话',modelId:agent.modelSelection.modelId})),models:modelOptionsSchema.parse(models.data??models)};},async save(id,modelId){const response=await nodeApiRequest(`/api/app-builder/agents/${id}/model`,{method:'PUT',body:JSON.stringify({modelSelection:{modelId}})});return (await response.json()).modelSelection.modelId;}};
</script>
<template><AgentModelsPage :source="source" path="/settings/model-config/app-builder" :title="title" :description="description"><template #navigation><slot name="navigation"/></template></AgentModelsPage></template>
<style scoped>.builder-models{height:100%;min-height:0;display:flex;flex-direction:column}.builder-models :deep(.agent-models-page){flex:1;min-height:0}</style>
