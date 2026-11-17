<script setup lang="ts">
import { computed, ref,watch } from 'vue';
import { CodeEditor } from '@ontomato/foundation-ui/code';
import { ChevronRight, Braces } from 'lucide-vue-next';
import { productWidgets, type ProductAsset } from '@ontomato/contracts/product-assets';
import { useManagerContext,useOntologyText,useManagerClient } from '../context';
import {rendererLabel} from './renderer-labels';
import {localizedProductTypes} from './catalog-labels';
import {useIdentityNames} from './identity-names';
import {useProductText} from './default-texts';
const {ot}=useOntologyText();
const productText=useProductText();
const identityName=useIdentityNames();

const props=defineProps<{asset:ProductAsset}>();
const context=useManagerContext();
const showJson=ref(false);
const widgets=computed(()=>productWidgets(props.asset.document));
const json=computed(()=>JSON.stringify(props.asset,null,2));
const date=(value:string)=>new Date(value).toLocaleString(context.locale);
const widgetKind=(kind:string)=>({metric:ot('productWidgetMetric'),table:ot('productWidgetTable'),chart:ot('productWidgetChart'),text:ot('productWidgetText'),action:ot('productWidgetAction'),input:ot('productWidgetInput'),button:ot('productWidgetButton')}[kind]??kind);
const bindings=(value:unknown)=>JSON.stringify(value,null,2);
const client=useManagerClient(),names=ref<Record<string,string>>({}),targetName=ref('');
const targetKinds=computed<Record<string,string>>(()=>({ObjectType:ot('productTargetObjectType'),Definition:ot('productTargetDefinition'),MetricView:ot('productTargetMetricView'),Action:ot('productTargetAction')}));
let generation=0;
watch(()=>props.asset,async asset=>{
 const current=++generation;names.value={};targetName.value=ot('productLoadingName');
 const document=asset.document;
 const ids=[...new Set([...('children' in document?document.children.map(child=>child.assetId):[]),...(document.kind==='agent-profile'?[...document.tools,...document.contextViews]:[])])];
 const resolved=await Promise.all(ids.map(async id=>{try{return [id,(await client.products.get(id)).name] as const;}catch{return [id,ot('productAssetUnavailable')] as const;}}));
 if(current!==generation)return;names.value=Object.fromEntries(resolved);
 if(!('renders' in document))return;
 try{
  let name='';
  if(document.renders.kind==='ObjectType'){const ontology=await client.loadOntology();name=ontology.objects.find(object=>object.className===document.renders.id)?.showName??'';}
  else if(document.renders.kind==='Definition'){const response=await client.request(`/product-assets/definitions/${encodeURIComponent(document.renders.id)}`,{},'');name=(await response.json()).definition?.name??'';}
  else {const result=await client.requestSmartAsset(document.renders.kind==='Action'?'actions':'metrics','queryById',{id:document.renders.id});name=result.data?.name??'';}
  if(current===generation)targetName.value=name||ot('productNameUnavailable');
 }catch{if(current===generation)targetName.value=ot('productNameUnavailable');}
},{immediate:true});
function referenceName(id:string){return productText(names.value[id]??ot('productLoadingAssetName'));}
function fieldLabel(field:string){return 'presentation' in props.asset.document?props.asset.document.presentation?.fieldLabels[field]??field:field;}
</script>
<template>
  <div class="product-configuration">
    <dl class="configuration-fields">
      <dt>{{ot('productAssetId')}}</dt><dd><code>{{asset.id}}</code></dd>
       <dt>{{ot('productType')}}</dt><dd>{{localizedProductTypes(ot).find(type=>type.kind===asset.document.kind)?.name}}</dd>
        <template v-if="'renders' in asset.document"><dt>{{ot('productRenderedElement')}}</dt><dd><span>{{targetKinds[asset.document.renders.kind]}} · {{targetName||ot('productLoadingName')}}</span><code class="reference-id">{{asset.document.renders.id}}</code></dd><dt>{{ot('productRenderer')}}</dt><dd>{{rendererLabel(ot,asset.document.renderer)}}</dd><dt>{{ot('productDefaultProjection')}}</dt><dd>{{asset.document.isDefault?ot('productYes'):ot('productNo')}}</dd><dt>{{ot('productAudience')}}</dt><dd>{{({human:ot('productAudienceHuman'),agent:ot('productAudienceAgent'),both:ot('productAudienceBoth')})[asset.document.audience]}}</dd><template v-if="'fields' in asset.document&&asset.document.fields.length"><dt>{{ot('productDisplayFields')}}</dt><dd class="field-list"><span v-for="field in asset.document.fields" :key="field" :title="field">{{fieldLabel(field)}}</span></dd></template><template v-if="asset.document.kind==='collection-view'"><dt>{{ot('productPageSize')}}</dt><dd>{{asset.document.pageSize??50}}</dd></template></template>
       <template v-if="asset.document.kind==='page'"><dt>{{ot('productPageForm')}}</dt><dd>{{asset.document.isTemplate?ot('productPageTemplate'):asset.document.embeddable?ot('productEmbeddablePage'):ot('productStandardPage')}}</dd><dt v-if="asset.document.layout">{{ot('productPageLayout')}}</dt><dd v-if="asset.document.layout">{{asset.document.layout.mode==='grid'?ot('productSingleGrid'):ot('productColumnsLayout',{main:asset.document.layout.mainWidth,side:12-asset.document.layout.mainWidth})}}</dd><dt v-if="asset.document.params">{{ot('productPageParams')}}</dt><dd v-if="asset.document.params"><pre>{{bindings(asset.document.params)}}</pre></dd></template>
       <template v-if="asset.document.kind==='agent-profile'"><dt>{{ot('productAgentDefinition')}}</dt><dd :title="asset.document.agentId">{{identityName(asset.document.agentId,ot('productAgentDefinition'))}}</dd><dd>{{ot('productAgentExecution')}}</dd><dt>{{ot('productInstructions')}}</dt><dd class="profile-instructions">{{asset.document.instructions}}</dd><dt>{{ot('productToolProjections')}}</dt><dd><ul class="reference-list"><li v-for="id in asset.document.tools" :key="id"><span>{{referenceName(id)}}</span><code class="reference-id">{{id}}</code></li></ul><span v-if="!asset.document.tools.length">{{ot('productNoTools')}}</span></dd><dt>{{ot('productObjectContext')}}</dt><dd><ul class="reference-list"><li v-for="id in asset.document.contextViews" :key="id"><span>{{referenceName(id)}}</span><code class="reference-id">{{id}}</code></li></ul><span v-if="!asset.document.contextViews.length">{{ot('productNoObjectContext')}}</span></dd></template>
       <dt>{{ot('productOwner')}}</dt><dd :title="asset.ownerId">{{identityName(asset.ownerId,ot('productOwner'))}}</dd>
      <dt>{{ot('productEditGrant')}}</dt><dd>{{asset.editable?ot('productEditable'):ot('productReadOnly')}} · {{ot('productUseGrantSeparate')}}</dd>
      <dt>{{ot('productCreatedAt')}}</dt><dd>{{date(asset.createdAt)}}</dd>
      <dt>{{ot('productUpdatedAt')}}</dt><dd>{{date(asset.updatedAt)}}</dd>
      <template v-if="asset.document.kind==='object-view'"><dt>{{ot('productObjectClass')}}</dt><dd><code>{{asset.document.className}}</code></dd><dt>{{ot('productViewForm')}}</dt><dd>{{asset.document.form}}</dd><dt>{{ot('productDefaultObject')}}</dt><dd><code v-if="asset.document.primaryKey">{{asset.document.primaryKey}}</code><span v-else>{{ot('productSelectAtRuntime')}}</span></dd></template>
      <template v-if="asset.document.kind==='application'"><dt>{{ot('productPlatformApplication')}}</dt><dd><code>{{asset.document.applicationId}}</code></dd><dt v-if="asset.document.workspaceId">{{ot('productSourceWorkspace')}}</dt><dd v-if="asset.document.workspaceId"><code>{{asset.document.workspaceId}}</code></dd></template>
      <template v-if="asset.document.kind==='dashboard'"><dt>{{ot('productDashboardId')}}</dt><dd><code>{{asset.document.dashboardId}}</code></dd></template>
      <template v-if="asset.document.kind==='widget'&&asset.document.widget.kind==='platform'"><dt>{{ot('productPlatformContent')}}</dt><dd>{{({assistant:ot('productSourceAssistant'),apps:ot('productSourceApps'),data:ot('productSourceData'),tasks:ot('productSourceTasks'),conversations:ot('productSourceConversations'),objects:ot('productSourceObjects'),recent:ot('productSourceRecent')})[asset.document.widget.source]}}</dd><dt>{{ot('productItemLimit')}}</dt><dd>{{asset.document.widget.limit}}</dd><dt v-if="asset.document.widget.placeholder">{{ot('productInputHint')}}</dt><dd v-if="asset.document.widget.placeholder">{{productText(asset.document.widget.placeholder)}}</dd></template>
      <template v-if="'workspace' in asset.document&&asset.document.workspace"><dt>{{ot('productLayoutFocus')}}</dt><dd>{{({data:ot('productLayoutData'),tasks:ot('productLayoutTasks'),assistant:ot('productLayoutAssistant')})[asset.document.workspace.layout]}}</dd><dt>{{ot('productObjectOpening')}}</dt><dd>{{asset.document.workspace.objectOpening==='drawer'?ot('productSidebar'):ot('productPage')}}</dd></template>
    </dl>
     <section v-if="'children' in asset.document&&asset.document.children.length" class="widget-configuration"><header><strong>{{ot('productCompositionReferences')}}</strong><span>{{ot('productItemsInOrder',{count:asset.document.children.length})}}</span></header><ol class="composition-config"><li v-for="child in asset.document.children" :key="child.assetId"><span>{{asset.document.kind==='page'&&asset.document.layout?.mode==='grid'?ot('productGridColumn'):child.column==='main'?ot('productMainColumn'):ot('productSidebar')}} · {{ot('productColumnsOf12',{width:child.width??(child.span==='half'?6:12)})}}</span><strong>{{referenceName(child.assetId)}}</strong><code class="reference-id">{{child.assetId}}</code></li></ol></section>
    <section v-for="widget in widgets" :key="widget.id" class="widget-configuration">
      <header><strong>{{widget.title||widget.id}}</strong><span>{{widgetKind(widget.kind)}}</span></header>
      <dl class="configuration-fields">
        <dt>{{ot('productComponentId')}}</dt><dd><code>{{widget.id}}</code></dd>
        <dt>{{ot('productLayout')}}</dt><dd>{{ot('productColumnsOf12',{width:widget.span})}} · {{widget.height}}px</dd>
        <template v-if="widget.resourceId"><dt>{{ot('productCapabilityId')}}</dt><dd><code>{{widget.resourceId}}</code></dd></template>
        <template v-if="widget.kind==='chart'"><dt>{{ot('productChartStyle')}}</dt><dd>{{({bar:ot('productChartBar'),line:ot('productChartLine'),donut:ot('productChartDonut')} as Record<string,string>)[widget.chartType]??widget.chartType}}</dd></template>
        <template v-if="widget.valueField"><dt>{{ot('productValueField')}}</dt><dd><code>{{widget.valueField}}</code></dd></template>
        <template v-if="widget.labelField"><dt>{{ot('productLabelField')}}</dt><dd><code>{{widget.labelField}}</code></dd></template>
        <template v-if="widget.fields.length"><dt>{{ot('productDisplayFields')}}</dt><dd class="field-list"><code v-for="field in widget.fields" :key="field">{{field}}</code></dd></template>
        <template v-if="widget.text"><dt>{{ot('productWidgetCopy')}}</dt><dd class="configuration-text">{{widget.text}}</dd></template>
      </dl>
      <div v-if="Object.keys(widget.parameters).length" class="parameter-bindings"><h4>{{ot('productParameterBindings')}}</h4><div v-for="(binding,name) in widget.parameters" :key="name" class="parameter-row"><code>{{name}}</code><span>{{binding.source==='literal'?ot('productBindingLiteral'):binding.source==='variable'?ot('productBindingVariable'):ot('productObjectContext')}}</span><CodeEditor v-if="binding.source==='literal'&&binding.value!==null&&typeof binding.value==='object'" :model-value="bindings(binding.value)" language="json" readonly :min-height="80"/><code v-else>{{binding.source==='literal'?bindings(binding.value):binding.path}}</code></div></div>
    </section>
    <section class="configuration-json"><button class="json-toggle" :aria-expanded="showJson" @click="showJson=!showJson"><ChevronRight :size="16" class="json-chevron" :class="{expanded:showJson}" aria-hidden="true"/><Braces :size="16" aria-hidden="true"/><span>{{ot('productFullJson')}}</span><small>{{showJson?ot('productCollapse'):ot('productExpand')}}</small></button><CodeEditor v-if="showJson" :model-value="json" language="json" readonly :min-height="240"/></section>
  </div>
</template>
<style scoped>
.product-configuration{display:flex;flex-direction:column;gap:var(--manager-content-gap);min-width:0;font-size:var(--text-sm)}
.configuration-fields{display:grid;grid-template-columns:120px minmax(0,1fr);margin:0;gap:0;line-height:var(--leading-sm)}
.configuration-fields dt,.configuration-fields dd{padding:var(--spacing-sm) var(--spacing-md);margin:0;border-bottom:1px solid var(--el-border-color-lighter);min-width:0;overflow-wrap:anywhere}
.configuration-fields dt{color:var(--el-text-color-secondary)}code{font-family:var(--font-mono);font-size:var(--text-xs);overflow-wrap:anywhere}
.widget-configuration{min-width:0}.widget-configuration header{display:flex;align-items:center;gap:var(--manager-control-gap);padding:var(--spacing-sm) var(--spacing-md);background:var(--el-fill-color-light);flex-wrap:wrap}.widget-configuration header span{color:var(--el-text-color-secondary);font-size:var(--text-xs)}
.configuration-text{white-space:pre-wrap}.field-list{display:flex;flex-wrap:wrap;gap:var(--spacing-sm)}
.composition-config{margin:0;padding-inline-start:var(--spacing-xl)}.composition-config li{padding:var(--spacing-sm) var(--spacing-md);border-bottom:1px solid var(--el-border-color-lighter);overflow-wrap:anywhere}.composition-config li>span{color:var(--el-text-color-secondary);margin-inline-end:var(--spacing-md)}
.parameter-bindings h4{font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--el-text-color-secondary);margin:0;padding:var(--spacing-sm) var(--spacing-md)}
.parameter-row{display:grid;grid-template-columns:minmax(100px,1fr) 100px minmax(0,2fr);gap:var(--spacing-md);padding:var(--spacing-sm) var(--spacing-md);border-bottom:1px solid var(--el-border-color-lighter);align-items:start;min-width:0}.parameter-row>span{color:var(--el-text-color-secondary);font-size:var(--text-xs)}
.configuration-json{margin:0;min-width:0}.json-toggle{display:flex;align-items:center;gap:var(--spacing-sm);width:100%;min-height:var(--list-row-height);padding:var(--spacing-sm) var(--spacing-md);border:0;background:transparent;color:var(--el-text-color-regular);font:inherit;cursor:pointer;text-align:start}.json-toggle:hover,.json-toggle[aria-expanded='true']{background:var(--el-fill-color-light)}.json-toggle:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:-2px}.json-toggle small{margin-inline-start:auto;font-size:var(--text-xs);color:var(--el-text-color-secondary)}.json-toggle svg{flex-shrink:0;color:var(--el-text-color-secondary)}.json-chevron{transition:transform var(--transition-fast)}.json-chevron.expanded{transform:rotate(90deg)}.configuration-json :deep(.cm-editor){max-height:480px}.configuration-json :deep(.cm-scroller){overflow:auto}
@container ontology-manager (max-width:520px){.configuration-fields{grid-template-columns:90px minmax(0,1fr)}.parameter-row{grid-template-columns:minmax(0,1fr) auto}.parameter-row>:last-child{grid-column:1/-1}}
</style>
<style scoped>.reference-id{display:block;margin-top:4px;color:var(--el-text-color-secondary)}.reference-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}.reference-list li{min-width:0}.field-list>span{background:var(--el-fill-color-light);padding:2px 8px;border-radius:var(--radius-sm)}.profile-instructions{white-space:pre-wrap;line-height:1.8}.composition-config strong{font-weight:var(--font-medium)}</style>
