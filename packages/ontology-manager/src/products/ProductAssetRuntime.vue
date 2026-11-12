<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {productWidgets, type ProductAsset } from "@ontomato/contracts/product-assets";
import { objectViewDocumentSchema } from "@ontomato/contracts/object-views";
import ObjectViewRuntime from "../object-views/ObjectViewRuntime.vue";
import ObjectViewPage from "../object-views/ObjectViewPage.vue";
const props = defineProps<{asset:ProductAsset;revision?:number;preview?:boolean}>();
const emit=defineEmits<{refresh:[]}>();
const objectKey=ref("");
const activeObject=ref("");
watch(()=>props.asset,asset=>{objectKey.value=asset.document.kind==='object-view'?asset.document.primaryKey??'':'';activeObject.value=objectKey.value;},{immediate:true});
const document = computed(() => {
  const asset = props.asset.document;
  const widgets = productWidgets(asset);
  return objectViewDocumentSchema.parse({schemaVersion:1,className:"product",title:props.asset.name,tabs:[{id:"product",title:props.asset.name,sections:[{id:"content",title:"",widgets:widgets.map(widget=>({...widget,...(asset.kind==='widget'?{span:12}:{} )}))}]}]});
});
</script>
<template>
  <ObjectViewRuntime v-if="['widget','widget-group','operation-panel'].includes(asset.document.kind)" :key="asset.revision" class="product-widget-runtime" :document="document" :object="{}" :reference="{className:'product',primaryKey:asset.id}" :revision="revision" :preview="preview" @refresh="emit('refresh')" />
  <a v-else-if="asset.document.kind === 'dashboard'" class="product-entry" :href="`#/dashboards?dashboardId=${encodeURIComponent(asset.document.dashboardId)}`"><strong>{{ asset.name }}</strong><span>打开仪表盘 ↗</span></a>
  <a v-else-if="asset.document.kind === 'application'" class="product-entry" :href="`#/applications/${encodeURIComponent(asset.document.applicationId)}`"><strong>{{ asset.name }}</strong><span>打开应用 ↗</span></a>
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
