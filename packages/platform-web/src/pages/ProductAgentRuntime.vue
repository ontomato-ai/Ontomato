<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {AgentChatPanel} from '@ontomato/agent-shell-ui';
import {createAssistantClient} from '@ontomato/workbench-ui/features/workbench/assistant-host';
import {useShellLabels} from '@ontomato/workbench-ui/composables/useShellLabels';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {ElAlert} from 'element-plus';
import {useI18n} from 'vue-i18n';
const {t}=useI18n();
const props=defineProps<{asset:ProductAsset;preview?:boolean;pageState?:Record<string,unknown>}>();
const labels=useShellLabels();const sessionId=ref<string|null>(null),releaseId=ref('');
async function request(path:string,init:RequestInit){const response=await nodeApiRequest(path,init);if(!response.ok){const body=await response.json();throw new Error(body.error?.message??body.message??t('ontology.productConversationFailed'));}return response;}
const client=createAssistantClient(async(path,init)=>{
  if(path==='/assistant/sessions'&&init.method==='POST')return request(`/api/product-assets/${encodeURIComponent(props.asset.id)}/sessions`,{...init,body:JSON.stringify({releaseId:releaseId.value,pageState:props.pageState??{},contextObjects:Object.values(props.pageState??{}).filter(value=>!!value&&typeof value==='object'&&'className' in value&&'primaryKey' in value).map(value=>({className:(value as {className:string}).className,primaryKey:(value as {primaryKey:string}).primaryKey}))})});
  return request('/api'+path,init);
});
const ready=ref(false),error=ref('');let generation=0;
const degraded=ref(false);
onBeforeUnmount(()=>{generation++;});
watch(()=>JSON.stringify([props.asset,props.pageState,props.preview]),async()=>{const asset=props.asset;const current=++generation;ready.value=false;degraded.value=false;error.value='';sessionId.value=null;if(props.preview)return;try{const response=await nodeApiRequest(`/api/product-assets/${encodeURIComponent(asset.id)}/active-profile`);const result=await response.json();if(!response.ok)throw new Error(result.error?.message??t('ontology.productProfileUnavailable'));if(result.asset?.revision!==asset.revision)throw new Error(t('ontology.productProfileChanged'));if(current===generation){releaseId.value=result.releaseId;degraded.value=!!result.issues?.length;ready.value=true;}}catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}},{immediate:true});
const agent=computed(()=>props.asset.document.kind==='agent-profile'?{id:props.asset.document.principalId,name:props.asset.name,description:props.asset.description,enabled:true,icon:null}:null);
</script>
<template><section class="product-agent"><ElAlert v-if="degraded" title="部分投影的能力契约已变化，已停用受影响的工具或上下文，请升级发布。" type="warning" :closable="false"/><p v-if="preview">{{asset.name}}</p><ElAlert v-else-if="error" :title="error" type="error" :closable="false"/><AgentChatPanel v-else-if="agent&&ready" v-model:session-id="sessionId" :client="client" :agent-id="agent.id" :agent="agent" :labels="labels"/></section></template>
<style scoped>.product-agent{height:560px;min-height:320px;min-width:0}</style>
