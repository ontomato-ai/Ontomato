<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {AgentChatPanel} from '@ontomato/agent-shell-ui';
import {createAssistantClient} from '@ontomato/workbench-ui/features/workbench/assistant-host';
import {useShellLabels} from '@ontomato/workbench-ui/composables/useShellLabels';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {ElAlert,ElSkeleton} from 'element-plus';
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
<template><section class="product-agent" :class="{'is-preview':preview}" :aria-busy="!preview&&!ready&&!error"><ElAlert v-if="degraded" title="部分投影的能力契约已变化，已停用受影响的工具或上下文，请升级发布。" type="warning" :closable="false"/><div v-if="preview" class="profile-preview"><strong>{{asset.name}}</strong><p>发布后可在页面中嵌入对话，使用此配置声明的工具和对象上下文。</p><dl v-if="asset.document.kind==='agent-profile'"><div><dt>工具</dt><dd>{{asset.document.tools.length}}</dd></div><div><dt>上下文视图</dt><dd>{{asset.document.contextViews.length}}</dd></div></dl></div><ElAlert v-else-if="error" :title="error" type="error" :closable="false"/><AgentChatPanel v-else-if="agent&&ready" v-model:session-id="sessionId" :client="client" :agent-id="agent.id" :agent="agent" :labels="labels"/><div v-else role="status"><p>正在准备智能分析工具与上下文…</p><ElSkeleton :rows="3" animated/></div></section></template>
<style scoped>.product-agent{height:560px;min-height:320px;min-width:0}.product-agent.is-preview{height:auto;min-height:0}.profile-preview{padding:var(--manager-content-gap);border:1px solid var(--el-border-color-light);border-radius:var(--radius-md)}.profile-preview strong{font-size:var(--text-sm)}.profile-preview p{margin:var(--spacing-sm) 0;color:var(--el-text-color-secondary);font-size:var(--text-sm);line-height:var(--leading-sm)}dl{display:flex;flex-wrap:wrap;gap:var(--spacing-xl);margin:var(--spacing-md) 0 0}dl>div{display:flex;gap:var(--spacing-sm);align-items:center}dt{color:var(--el-text-color-secondary);font-size:var(--text-xs)}dd{margin:0;font-size:var(--text-sm);font-variant-numeric:tabular-nums}</style>
