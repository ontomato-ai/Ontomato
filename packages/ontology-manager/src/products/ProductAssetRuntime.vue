<script setup lang="ts">
import { computed, ref, watch,onBeforeUnmount,inject,type Component } from "vue";
import {onProductInvalidation} from '@ontomato/contracts/product-invalidation';
import {productWidgets,productAgentRuntimeKey, type ProductAsset } from "@ontomato/contracts/product-assets";
import { objectViewDocumentSchema,readViewPath } from "@ontomato/contracts/object-views";
import ObjectViewRuntime from "../object-views/ObjectViewRuntime.vue";
import ObjectViewPage from "../object-views/ObjectViewPage.vue";
import PlatformWidgetRuntime from './PlatformWidgetRuntime.vue';
import ObjectProjectionRuntime from './ObjectProjectionRuntime.vue';
import CollectionProjectionRuntime from './CollectionProjectionRuntime.vue';
import MetricProjectionRuntime from './MetricProjectionRuntime.vue';
import ActionProjectionRuntime from './ActionProjectionRuntime.vue';
import {ElButton,ElInput} from 'element-plus';
import {useManagerClient} from '../context';
const props = defineProps<{asset:ProductAsset;revision?:number;preview?:boolean;pageState?:Record<string,unknown>}>();
const agentRuntime=inject<Component|null>(productAgentRuntimeKey,null);
const emit=defineEmits<{refresh:[];navigate:[id:string]}>();
const dataRevision=ref(0);
const client=useManagerClient();
const sources=ref<{objectTypes:string[];complete:boolean}>();
let sourceGeneration=0;
watch(()=>props.asset,async asset=>{const current=++sourceGeneration;sources.value=undefined;if(!asset.editable||!['metric-widget','collection-view','object-projection'].includes(asset.document.kind))return;try{const result=await client.products.sourceTypes(asset.id);if(current===sourceGeneration)sources.value=result;}catch{/* Missing metadata uses conservative invalidation. */}},{immediate:true});
const stopInvalidation=onProductInvalidation(event=>{
  const document=props.asset.document;
  if(document.kind==='object-projection'&&!event.objectTypes.includes(document.renders.id))return;
  if(props.asset.sourceObjectTypes&&!props.asset.sourceObjectTypes.some(type=>event.objectTypes.includes(type)))return;
  if(sources.value?.complete&&!sources.value.objectTypes.some(type=>event.objectTypes.includes(type)))return;
  if(event.objectTypes.length)dataRevision.value++;
});
onBeforeUnmount(()=>{sourceGeneration++;stopInvalidation();});
const objectKey=ref("");
const activeObject=ref("");
watch(()=>props.asset,asset=>{objectKey.value=asset.document.kind==='object-view'?asset.document.primaryKey??'':'';activeObject.value=objectKey.value;},{immediate:true});
const document = computed(() => {
  const asset = props.asset.document;
  const widgets = productWidgets(asset);
   return objectViewDocumentSchema.parse({schemaVersion:1,className:"product",title:props.asset.name,tabs:[{id:"product",title:props.asset.name,sections:[{id:"content",title:"",widgets:widgets.map(widget=>({...widget,parameters:Object.fromEntries(Object.entries(widget.parameters).map(([name,binding])=>[name,binding.source==='variable'&&props.pageState&&Object.hasOwn(props.pageState,binding.path.split('.')[0])?{source:'literal',value:readViewPath(props.pageState,binding.path)}:binding])),title:widget.title||props.asset.name,...(asset.kind==='widget'?{span:12}:{} )}))}]}]});
});
</script>
<template>
  <PlatformWidgetRuntime v-if="asset.document.kind==='widget'&&asset.document.widget.kind==='platform'" :asset="asset" :preview="preview"/>
  <MetricProjectionRuntime v-else-if="asset.document.kind==='metric-widget'" :key="`${revision}:${dataRevision}`" :asset="asset" :page-state="pageState"/>
  <ActionProjectionRuntime v-else-if="asset.document.kind==='action-view'" :asset="asset" :page-state="pageState" :preview="preview" @refresh="emit('refresh')"/>
  <ObjectProjectionRuntime v-else-if="asset.document.kind==='object-projection'" :revision="dataRevision" :asset="asset" :page-state="pageState" :preview="preview"/>
  <CollectionProjectionRuntime v-else-if="asset.document.kind==='collection-view'" :key="`${revision}:${dataRevision}`" :asset="asset" :page-state="pageState"/>
  <component :is="agentRuntime" v-else-if="asset.document.kind==='agent-profile'&&agentRuntime" :asset="asset" :preview="preview" :page-state="pageState"/>
  <section v-else-if="asset.document.kind==='agent-profile'"><h3>{{asset.name}}</h3><p>{{asset.description}}</p></section>
  <nav v-else-if="asset.document.kind==='navigation'" class="product-navigation"><el-button v-for="node in asset.document.nodes" :key="node.id" text @click="emit('navigate',node.pageId)">{{node.label}}</el-button></nav>
  <ObjectViewRuntime v-else-if="['metric-widget','action-view','widget','widget-group','operation-panel'].includes(asset.document.kind)" :key="asset.revision" class="product-widget-runtime" :document="document" :object="{}" :reference="{className:'product',primaryKey:asset.id}" :revision="(revision??0)+dataRevision" :preview="preview" @refresh="emit('refresh')" />
  <a v-else-if="asset.document.kind === 'dashboard'" class="product-entry" :href="`#/dashboards?dashboardId=${encodeURIComponent(asset.document.dashboardId)}`"><strong>{{ asset.name }}</strong><span>打开仪表盘 ↗</span></a>
  <a v-else-if="asset.document.kind === 'application'" class="product-entry" :href="!asset.document.workspaceId&&asset.document.navigationId?`#/products/${encodeURIComponent(asset.id)}?applicationId=${encodeURIComponent(asset.id)}`:`#/applications/${encodeURIComponent(asset.document.applicationId)}`"><strong>{{ asset.name }}</strong><span>打开应用 ↗</span></a>
  <section v-else-if="asset.document.kind === 'object-view'" class="product-object-view">
    <header><strong>{{asset.name}}</strong><span>{{asset.document.className}}</span></header>
    <form v-if="!asset.document.primaryKey" class="object-selector" @submit.prevent="activeObject=objectKey.trim()"><el-input v-model="objectKey" placeholder="输入对象主键，使用此类的已发布视图" aria-label="对象主键"/><el-button native-type="submit" :disabled="!objectKey.trim()">查看对象</el-button></form>
    <ObjectViewPage v-if="activeObject" :reference="{className:asset.document.className,primaryKey:activeObject}" preview capability-only :read-only="preview"/>
    <p v-else>选择对象后按同一个类视图呈现；切换对象不改变视图定义。</p>
  </section>
  <p v-else>{{ asset.name }}</p>
</template>
<style scoped>
.product-entry{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--manager-control-gap) var(--manager-content-gap);padding:var(--manager-module-padding);border:1px solid var(--el-border-color);border-radius:var(--radius-md);color:var(--el-text-color-primary);text-decoration:none;font-size:var(--text-sm)}.product-entry strong{min-width:0;flex:1 1 160px;overflow-wrap:anywhere}.product-entry span{color:var(--el-color-primary);white-space:nowrap}.product-entry:hover{background:var(--el-fill-color-light)}
.product-widget-runtime :deep(.el-tabs__header){display:none}
.product-widget-runtime :deep(.widget-card){width:100%}
:deep([data-kind='action'] > h4){display:none}
.product-object-view{min-width:0;border:1px solid var(--el-border-color);border-radius:var(--radius-md);padding:var(--manager-module-padding)}
.product-object-view header{display:flex;flex-wrap:wrap;gap:var(--spacing-sm);align-items:center}.product-object-view header span,.product-object-view p{color:var(--el-text-color-secondary);font-size:var(--text-sm);overflow-wrap:anywhere}
.object-selector{display:flex;gap:var(--spacing-sm);margin:var(--manager-content-gap) 0}.product-object-view :deep(.object-view-page){height:auto;overflow:visible}.product-object-view :deep(.object-page-content > .object-view-runtime){padding-inline:0}
.product-object-view header>span{max-width:100%;overflow-wrap:anywhere}.object-selector .el-input{min-width:0;flex:1}.object-selector .el-button{flex-shrink:0;margin:0}
.product-object-view>p{margin:var(--manager-content-gap) 0 0;line-height:var(--leading-sm)}
.product-object-view:has(.object-view-page){border:0;padding:0}.product-object-view:has(.object-view-page)>header{display:none}
.product-object-view :deep(.object-page-content>.object-view-runtime){padding-top:0;padding-bottom:0}
@container ontology-manager (max-width:520px){.object-selector{flex-wrap:wrap}.object-selector .el-input{flex-basis:100%}}
</style>
