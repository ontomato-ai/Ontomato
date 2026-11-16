<script setup lang="ts">
import {ref,watch,onBeforeUnmount,computed,inject} from 'vue';
import {productRenderersKey} from './renderers';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {useManagerClient} from '../context';
import ObjectViewRuntime from '../object-views/ObjectViewRuntime.vue';
import {ElAlert,ElInput,ElButton} from 'element-plus';
const props=defineProps<{asset:ProductAsset;pageState?:Record<string,unknown>;preview?:boolean;revision?:number}>();
const client=useManagerClient();
const twinRenderer=inject(productRenderersKey,new Map()).get('object-projection:3d');
const key=ref(''),record=ref<Record<string,unknown>>(),error=ref(''),loading=ref(false);
const loadedKey=ref('');
const visibleFields=computed(()=>props.asset.document.kind==='object-projection'?(props.asset.document.fields.length?props.asset.document.fields:Object.keys(record.value??{})):[]);
const contextText=computed(()=>visibleFields.value.map(field=>`${field}: ${record.value?.[field]??'—'}`).join('\n'));
watch(()=>props.revision,()=>{if(loadedKey.value){key.value=loadedKey.value;void load();}});
let generation=0;
onBeforeUnmount(()=>{generation++;});
async function load(){
  if(props.asset.document.kind!=='object-projection'||!key.value.trim())return;
   const current=++generation;const selection=key.value.trim();loading.value=true;error.value='';record.value=undefined;
   try{const result=await client.products.object(props.asset.id,selection,props.asset.revision);if(current===generation){record.value=result.object;loadedKey.value=selection;}}
  catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}finally{if(current===generation)loading.value=false;}
}
watch(()=>JSON.stringify([props.asset,props.pageState]),()=>{
  const asset=props.asset;generation++;
  const selected=Object.values(props.pageState??{}).find((value):value is {className:string;primaryKey:string}=>!!value&&typeof value==='object'&&'className' in value&&'primaryKey' in value&&asset.document.kind==='object-projection'&&value.className===asset.document.renders.id&&typeof value.primaryKey==='string');
  key.value=selected?.primaryKey??(asset.document.kind==='object-projection'?asset.document.primaryKey??'':'');record.value=undefined;loadedKey.value='';error.value='';loading.value=false;if(key.value)void load();
},{immediate:true});
</script>
<template><section class="object-projection" :class="asset.document.kind==='object-projection'?`renderer-${asset.document.renderer}`:''"><header><strong>{{asset.name}}</strong></header><form @submit.prevent="load"><el-input v-model="key" placeholder="选择对象主键" aria-label="对象主键"/><el-button native-type="submit" :loading="loading">查看</el-button></form><el-alert v-if="error" :title="error" type="error" :closable="false"/><template v-if="record&&asset.document.kind==='object-projection'"><template v-if="asset.document.renderer==='3d'"><component :is="twinRenderer" v-if="twinRenderer" :asset="asset" :object="record" :reference="{className:asset.document.renders.id,primaryKey:loadedKey}"/><el-alert v-else title="当前宿主未注册 3D 对象渲染器" type="error" :closable="false"/></template><pre v-else-if="asset.document.renderer==='text'" class="object-context">{{contextText}}</pre><ObjectViewRuntime v-else-if="asset.document.layout&&asset.document.renderer==='full'" :document="asset.document.layout" :object="record" :reference="{className:asset.document.renders.id,primaryKey:loadedKey}" :preview="preview" @refresh="load"/><dl v-else><template v-for="field in visibleFields" :key="field"><dt>{{field}}</dt><dd>{{record[field]??'—'}}</dd></template></dl></template></section></template>
<style scoped>.object-projection{min-width:0}.renderer-card{border:1px solid var(--el-border-color);border-radius:var(--radius-md);padding:var(--spacing-lg)}.object-context{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.renderer-summary form,.renderer-card form{margin-block:var(--spacing-sm)}form{display:flex;gap:var(--spacing-sm);margin-block:var(--spacing-md)}dl{display:grid;grid-template-columns:minmax(100px,1fr) minmax(0,3fr);margin:0}dt,dd{padding:var(--spacing-sm) var(--spacing-md);margin:0;border-bottom:1px solid var(--el-border-color-light);overflow-wrap:anywhere}dt{color:var(--el-text-color-secondary)}</style>
