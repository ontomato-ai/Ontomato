<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch,nextTick,inject} from 'vue';
import {ElDialog} from 'element-plus';
import {ListChecks, Network, Plus, RefreshCw} from 'lucide-vue-next';
import {managerOverlayKey} from '../overlay';
import {useIdentityNames} from './identity-names';
import {PlatformPageHeader,PlatformTabs} from '@ontomato/platform-shell';
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
import {type ProductQuery,type ProductSummary} from '@ontomato/contracts/product-assets';
import {productIcons} from './product-icons';
import {rendererLabel} from './renderer-labels';
import {localizedProductTypes,localizedProductCategories} from './catalog-labels';
import {useProductText} from './default-texts';
import {productCategory} from '@ontomato/contracts/product-graph';
import type {ProductGraph} from '@ontomato/contracts/product-graph';
import ProductGraphDialog from './ProductGraphDialog.vue';
import {useManagerClient,useManagerContext,useManagerCounts,useOntologyText} from '../context';
const {ot}=useOntologyText();
const productText=useProductText();
const identityName=useIdentityNames();
const catalogTypes=computed(()=>localizedProductTypes(ot));
const categories=computed(()=>localizedProductCategories(ot));
const props=defineProps<{query:Partial<ProductQuery>}>();
const emit=defineEmits<{query:[query:Partial<ProductQuery>];open:[id:string];create:[kind:string]}>();
const client=useManagerClient(),items=ref<ProductSummary[]>([]),total=ref(0),loading=ref(false),error=ref(''),search=ref(props.query.search??'');
const context=useManagerContext();
const managerCounts=useManagerCounts();
const graph=ref<ProductGraph|null>(null),graphLoading=ref(false),graphError=ref('');
const graphOpen=ref(false);
const synchronizing=ref(false);
async function synchronize(){synchronizing.value=true;error.value='';try{await client.products.synchronizePlatform();await load();}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}finally{synchronizing.value=false;}}
const warnings=ref<{kind:string;id:string;name:string}[]|null>(null);
const warningsOpen=ref(false),warningsLoading=ref(false),warningsError=ref('');
const overlay=inject(managerOverlayKey,'body');
const warningKindLabels=computed<Record<string,string>>(()=>({ObjectType:ot('productTargetObjectType'),Definition:ot('productTargetDefinition'),MetricView:ot('productTargetMetricView'),Action:ot('productTargetAction')}));
const warningFilter=ref('');
const filteredWarnings=computed(()=>(warnings.value??[]).filter(warning=>!warningFilter.value||warning.kind===warningFilter.value));
async function showGraph(){graphLoading.value=true;graphError.value='';try{graph.value=await client.products.graph();graphOpen.value=true;}catch(reason){graphError.value=reason instanceof Error?reason.message:String(reason);}finally{graphLoading.value=false;}}
async function checkDefaults(){warningsOpen.value=true;warningsLoading.value=true;warningsError.value='';try{warnings.value=(await client.products.defaultProjectionWarnings()).warnings;}catch(reason){warningsError.value=reason instanceof Error?reason.message:String(reason);}finally{warningsLoading.value=false;}}
const capabilityNames=ref<Record<string,string>>({});
function capabilityKind(row:ProductSummary):'actions'|'metrics'|'definition'|'object-type'{return row.kind==='action-view'||row.details.widgetKind==='action'?'actions':row.kind==='collection-view'?'definition':row.kind==='object-projection'?'object-type':'metrics';}
async function resolveCapabilityNames(rows:ProductSummary[],current:number){
  const references=[...new Map(rows.filter(row=>row.details.resourceId).map(row=>{
    const kind=capabilityKind(row);
    return [`${kind}:${row.details.resourceId}`,{kind,id:row.details.resourceId!}];
  })).entries()];
  const names=await Promise.all(references.map(async([key,reference])=>{
    if(reference.kind==='object-type'){try{const ontology=await client.loadOntology();return [key,ontology.objects.find(object=>object.className===reference.id)?.showName??reference.id] as const;}catch{return [key,reference.id] as const;}}
    if(reference.kind==='definition'){try{const response=await client.request(`/product-assets/definitions/${encodeURIComponent(reference.id)}`,{},'');const result=await response.json();return [key,result.definition?.name??reference.id] as const;}catch{return [key,reference.id] as const;}}
    try{const result=await client.requestSmartAsset(reference.kind,'queryById',{id:reference.id});if(result.data?.name)return [key,String(result.data.name)] as const;}catch{/* An unavailable name must not hide the asset row. */}
    return [key,ot('productCapabilityUnavailable')] as const;
  }));
  if(current===generation)capabilityNames.value=Object.fromEntries(names);
}
function capabilityName(row:ProductSummary){return capabilityNames.value[`${capabilityKind(row)}:${row.details.resourceId}`]??ot('productLoadingCapabilityName');}
function capabilityLabel(row:ProductSummary){return {actions:ot('productCapabilityAction'),metrics:ot('productCapabilityMetric'),definition:ot('productCapabilityDefinition'),'object-type':ot('productTargetObjectType')}[capabilityKind(row)];}
const typeCounts=ref<Record<string,number>>({});
watch(typeCounts,counts=>{managerCounts.values.products=Object.values(counts).reduce((sum,count)=>sum+count,0);});
const typeTabs=computed(()=>catalogTypes.value.map(type=>({id:type.kind,label:`${type.name} ${typeCounts.value[type.kind]??0}`,icon:productIcons[type.kind]})));
const activeKind=computed(()=>props.query.kind??'application');
const activeCategory=computed(()=>productCategory(activeKind.value));
const categoryDescription=computed(()=>categories.value.find(category=>category.id===activeCategory.value)?.description);
const creationGroups=computed(()=>categories.value.map(category=>({...category,types:catalogTypes.value.filter(type=>type.category===category.id)})));
const categoryTabs=computed(()=>categories.value.map(category=>({id:category.id,label:category.name})));
const categoryTypeTabs=computed(()=>typeTabs.value.filter(type=>productCategory(type.id)===activeCategory.value));
const activeType=computed(()=>catalogTypes.value.find(type=>type.kind===activeKind.value)??{name:ot('productLegacyAsset'),description:ot('productLegacyAssetDescription'),term:''});
function changeCategory(value:string){const type=catalogTypes.value.find(type=>type.category===value);if(type)changeKind(type.kind);}
function date(value:string){return new Date(value).toLocaleString(context.locale,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
const contentLabels=computed<Record<string,string>>(()=>({platform:ot('productWidgetPlatform'),metric:ot('productWidgetMetric'),table:ot('productWidgetTable'),chart:ot('productWidgetChart'),text:ot('productWidgetText'),action:ot('productWidgetAction'),input:ot('productWidgetInput'),button:ot('productWidgetButton'),assistant:ot('productSourceAssistant'),apps:ot('productSourceApps'),data:ot('productSourceData'),tasks:ot('productSourceTasks'),conversations:ot('productSourceConversations'),objects:ot('productSourceObjects'),recent:ot('productSourceRecent')}));
function assetDetails(row:ProductSummary){
  const d=row.details;
  return [row.kind==='page'?(d.isTemplate?ot('productPageTemplate'):d.embeddable?ot('productEmbeddablePage'):ot('productStandardPage')):'',d.renderer?rendererLabel(ot,d.renderer):'',d.widgetKind?contentLabels.value[d.widgetKind]??d.widgetKind:'',d.section?contentLabels.value[d.section]??d.section:'',d.childCount!==undefined?ot('productChildCount',{count:d.childCount}):'',d.widgetCount!==undefined?ot('productWidgetCount',{count:d.widgetCount}):'',...(d.widgetKinds??[]).map(kind=>contentLabels.value[kind]??kind)].filter(Boolean).join(' · ');
}
const scroll=ref<HTMLElement>();
const scrollPositions=new Map<string,number>();
let generation=0,timer:ReturnType<typeof setTimeout>|undefined;
const queryKey=()=>JSON.stringify(props.query);
async function load(){const current=++generation;loading.value=true;error.value='';try{const [result,counts]=await Promise.all([client.products.query({...props.query,kind:activeKind.value}),client.products.counts()]);if(current!==generation)return;typeCounts.value=counts;items.value=result.items;total.value=result.total;capabilityNames.value={};void resolveCapabilityNames(result.items,current);await nextTick();if(scroll.value)scroll.value.scrollTop=scrollPositions.get(queryKey())??Number(sessionStorage.getItem('product-directory:'+queryKey())??0);}catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}finally{if(current===generation)loading.value=false;}}
watch(()=>props.query,()=>{search.value=props.query.search??'';void load();},{immediate:true,deep:true});
function update(patch:Partial<ProductQuery>){if(scroll.value)scrollPositions.set(queryKey(),scroll.value.scrollTop);emit('query',{...props.query,...patch});}
function scheduleSearch(){clearTimeout(timer);timer=setTimeout(()=>update({search:search.value,page:1}),300);}
function changeKind(value:string){clearTimeout(timer);update({kind:value as ProductQuery['kind'],pageForm:undefined,search:'',page:1});}
function changeScope(value:string|number|boolean|undefined){update({scope:value as ProductQuery['scope'],page:1});}
function openRow(row:ProductSummary){open(row.id);}
function changePage(page:number){update({page});}
function changeSize(pageSize:number){update({pageSize,page:1});}
function open(id:string){if(scroll.value)sessionStorage.setItem('product-directory:'+queryKey(),String(scroll.value.scrollTop));emit('open',id);}
onBeforeUnmount(()=>{clearTimeout(timer);generation++;});
</script>
<template>
  <section class="product-directory">
    <PlatformPageHeader :title="ot('productDirectoryTitle')" :description="ot('productDirectoryDescription')"><template #actions><el-dropdown placement="bottom-end" :popper-options="dropdownBoundaryOptions" @command="(kind:string)=>emit('create',kind)"><el-button type="primary" :icon="Plus">{{ot('productCreateAsset')}}</el-button><template #dropdown><el-dropdown-menu><template v-for="(group,index) in creationGroups" :key="group.id"><el-dropdown-item disabled :divided="index>0">{{group.name}}</el-dropdown-item><el-dropdown-item v-for="type in group.types" :key="type.kind" :command="type.kind"><component :is="productIcons[type.kind]" :size="16" class="type-icon" aria-hidden="true"/>{{type.name}}</el-dropdown-item></template></el-dropdown-menu></template></el-dropdown></template></PlatformPageHeader>
    <div class="directory-types">
      <PlatformTabs class="directory-layer-tabs" :tabs="categoryTabs" :active-id="activeCategory" :label="ot('productAssetLayers')" @select="changeCategory" />
      <PlatformTabs class="directory-kind-tabs" :tabs="categoryTypeTabs" :active-id="activeKind" :label="ot('productAssetTypes')" @select="changeKind" />
    </div>
    <div class="directory-overview"><div class="type-description" :title="categoryDescription"><strong>{{activeType.name}}</strong><span>{{activeType.description}}</span></div><div class="directory-tools"><el-button text :icon="RefreshCw" :loading="synchronizing" @click="synchronize">{{ot('productSyncPlatformAssets')}}</el-button><el-button text :icon="Network" :loading="graphLoading" @click="showGraph">{{ot('productAssetGraph')}}</el-button><el-button text :icon="ListChecks" :loading="warningsLoading" :title="ot('productCheckDefaultsHint')" @click="checkDefaults">{{ot('productCheckDefaults')}}</el-button></div></div>
    <ProductGraphDialog v-if="graph" v-model="graphOpen" :graph="graph" @open="open"/>
    <div v-if="graphError" class="directory-graph"><el-alert :title="graphError" type="error" closable @close="graphError=''"/></div>
    <ElDialog v-model="warningsOpen" :title="ot('productDefaultsCheckTitle')" :append-to="overlay" width="800px" destroy-on-close>
      <div class="projection-check">
        <p>{{ot('productDefaultsCheckIntro')}}</p>
        <el-alert v-if="warningsError" :title="warningsError" type="error" :closable="false"/>
        <div class="projection-check-toolbar"><span>{{warningsLoading?ot('productChecking'):ot('productPendingCount',{count:warnings?.length??0})}}</span><el-select v-model="warningFilter" :aria-label="ot('productCheckResultType')" clearable :placeholder="ot('productAllTypes')"><el-option v-for="(label,kind) in warningKindLabels" :key="kind" :value="kind" :label="label"/></el-select></div>
        <el-table v-loading="warningsLoading" :data="filteredWarnings" max-height="420" :empty-text="warningsError?ot('productCheckFailed'):ot('productNoMissingDefaults')"><el-table-column :label="ot('productType')" width="120"><template #default="{row}">{{warningKindLabels[row.kind]??row.kind}}</template></el-table-column><el-table-column prop="name" :label="ot('productOntologyElement')" min-width="240" show-overflow-tooltip/></el-table>
        <p class="projection-check-hint">{{ot('productDefaultsCheckHint')}}</p>
      </div>
      <template #footer><el-button :loading="warningsLoading" @click="checkDefaults">{{ot('productCheckAgain')}}</el-button><el-button type="primary" @click="warningsOpen=false">{{ot('productClose')}}</el-button></template>
    </ElDialog>
    <div class="directory-toolbar"><el-input v-model="search" clearable :placeholder="ot('productSearchName',{type:activeType.name})" :aria-label="ot('productSearchAssetName')" @input="scheduleSearch"/><el-select v-if="activeKind==='page'" :model-value="query.pageForm??'all'" :aria-label="ot('productPageForm')" @change="update({pageForm:$event,page:1})"><el-option value="all" :label="ot('productAllPageForms')"/><el-option value="page" :label="ot('productStandardPage')"/><el-option value="embeddable" :label="ot('productEmbeddablePage')"/><el-option value="template" :label="ot('productPageTemplate')"/></el-select><el-select :model-value="query.scope??'all'" :aria-label="ot('productAssetScope')" @change="changeScope"><el-option value="all" :label="ot('productScopeAll')"/><el-option value="mine" :label="ot('productScopeMine')"/><el-option value="shared" :label="ot('productScopeShared')"/></el-select><el-select :model-value="query.sort??'structure'" :aria-label="ot('productAssetSort')" @change="update({sort:$event,page:1})"><el-option value="structure" :label="ot('productSortStructure')"/><el-option value="name" :label="ot('productSortName')"/><el-option value="updated" :label="ot('productSortUpdated')"/></el-select></div>
    <el-alert v-if="error" class="directory-error" :title="error" type="error" :closable="false"><el-button text @click="load">{{ot('productRetry')}}</el-button></el-alert>
    <div ref="scroll" class="directory-table"><el-table v-loading="loading" :data="items" row-key="id" @row-click="openRow">
      <el-table-column :label="ot('productName')" min-width="280"><template #default="{row}"><button class="asset-name" @click.stop="open(row.id)"><span><strong>{{productText(row.name)}}</strong><small v-if="row.description">{{productText(row.description)}}</small></span></button></template></el-table-column>
      <el-table-column :label="ot('productContentAndConfiguration')" min-width="230"><template #default="{row}"><span>{{assetDetails(row)||'—'}}</span><small v-if="row.details.resourceId" class="capability-reference" :title="`${capabilityName(row)} · ${row.details.resourceId}`">{{ot('productCapabilityReference',{label:capabilityLabel(row),name:capabilityName(row)})}}</small></template></el-table-column>
      <el-table-column :label="ot('productCurrentGrant')" width="120"><template #default="{row}">{{row.editable?ot('productEditable'):ot('productReadOnly')}}</template></el-table-column><el-table-column :label="ot('productOwner')" min-width="150"><template #default="{row}"><span :title="row.ownerId">{{identityName(row.ownerId,ot('productOwner'))}}</span></template></el-table-column><el-table-column :label="ot('productUpdatedAt')" width="180"><template #default="{row}"><span class="asset-date">{{date(row.updatedAt)}}</span></template></el-table-column><template #empty><span>{{loading?ot('productLoading'):error?ot('productLoadFailed'):ot('productNoMatchingAssets')}}</span></template></el-table></div>
    <footer><el-pagination :current-page="query.page??1" :page-size="query.pageSize??20" :page-sizes="[20,50,100]" :total="total" layout="total, sizes, prev, pager, next" @current-change="changePage" @size-change="changeSize"/></footer>
  </section>
</template>
<style scoped>
.directory-overview{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--manager-control-gap) var(--manager-content-gap);padding:var(--manager-content-gap) var(--page-gutter) 0}.directory-tools{display:flex;flex-wrap:wrap;gap:var(--manager-control-gap)}.directory-tools :deep(.el-button+.el-button){margin-inline-start:0}
.directory-graph{margin:var(--manager-content-gap) var(--page-gutter) 0;flex-shrink:0;max-height:45%;overflow:auto}.directory-graph :deep(.graph-canvas){max-height:220px}.projection-warnings{padding:var(--spacing-md);border:1px solid var(--el-border-color-light);border-radius:var(--radius-md)}.projection-warnings summary{cursor:pointer}.projection-warnings p{overflow-wrap:anywhere;font-size:var(--text-xs);color:var(--el-text-color-secondary)}
.capability-reference{display:block;color:var(--el-text-color-secondary);font-size:var(--text-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:var(--manager-label-gap)}
.directory-types{padding-inline:var(--page-gutter);flex-shrink:0}.type-description{display:flex;align-items:center;flex-wrap:wrap;gap:var(--manager-control-gap);padding:var(--manager-content-gap) var(--page-gutter) 0;font-size:var(--text-sm);flex-shrink:0}.type-description>svg,.type-description>span{color:var(--el-text-color-secondary)}.type-description strong{font-weight:var(--font-semibold)}
.asset-date{white-space:nowrap;font-variant-numeric:tabular-nums}
.product-directory{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}.directory-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:var(--manager-control-gap);padding:var(--manager-content-gap) var(--page-gutter);flex-shrink:0}.directory-toolbar>.el-input{width:260px}.directory-toolbar>.el-select{width:160px}.result-count{margin-inline-start:auto;color:var(--el-text-color-secondary);font-size:var(--text-xs)}.directory-error{margin:0 var(--page-gutter) var(--manager-content-gap);width:auto}.directory-table{flex:1;min-height:0;overflow:auto;margin:0 var(--page-gutter);border:1px solid var(--el-border-color);border-radius:var(--radius-md)}.asset-name{display:flex;align-items:center;gap:var(--manager-control-gap);border:0;background:none;color:var(--el-text-color-primary);font:inherit;text-align:start;width:100%;cursor:pointer;padding:var(--spacing-xs) 0}.asset-name>svg{flex-shrink:0;color:var(--el-text-color-secondary)}.asset-name>span{min-width:0}.asset-name strong,.asset-name small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}.asset-name strong{font-weight:var(--font-semibold)}.asset-name small{font-size:var(--text-xs);color:var(--el-text-color-secondary);margin-top:var(--manager-label-gap)}.asset-name:focus-visible{outline:2px solid var(--el-color-primary)}.type-icon{margin-inline-end:var(--spacing-sm)}footer{display:flex;justify-content:flex-end;flex-shrink:0;padding:var(--manager-content-gap) var(--page-gutter);overflow-x:auto}.directory-table :deep(.el-table__row){cursor:pointer}@container ontology-manager (max-width:760px){.result-count{display:none}.directory-toolbar>.el-input{flex:1 1 200px}footer{justify-content:flex-start}}
/* Match the Manager catalogs: one gutter, 16px content gaps and 8px control gaps. */
.directory-types {
  display: grid;
  gap: var(--spacing-sm);
  min-width: 0;
  padding-block-start: var(--spacing-md);
}
.directory-types :deep(.page-tabs-bar) {
  gap: var(--spacing-xs);
  max-width: 100%;
  padding: var(--spacing-xs);
  border-bottom: 0;
  scrollbar-width: thin;
}
.directory-types :deep(.directory-layer-tabs) {
  width: max-content;
  box-sizing: border-box;
  border-radius: var(--radius-md);
  background: var(--el-fill-color-light);
}
.directory-types :deep(.directory-kind-tabs) { padding-inline: 0; }
.directory-types :deep(.page-tab) {
  height: var(--control-height-sm);
  gap: var(--spacing-xs);
  padding-inline: var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  transition: background-color var(--transition-fast), color var(--transition-fast);
}
.directory-types :deep(.page-tab:not(.active):hover) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.directory-types :deep(.directory-layer-tabs .page-tab.active) {
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  box-shadow: var(--elevation-panel);
  font-weight: var(--font-semibold);
}
.directory-types :deep(.directory-kind-tabs .page-tab.active) {
  background: var(--el-color-primary-light-9);
  color: var(--brand-link);
  font-weight: var(--font-medium);
}
.type-description small{flex-basis:100%;color:var(--el-text-color-secondary);font-size:var(--text-xs)}
.product-directory{font-size:var(--text-sm);line-height:var(--leading-sm)}
.directory-overview .type-description{padding:0;min-width:0;flex:1 1 320px;gap:var(--manager-control-gap);line-height:var(--leading-sm)}
.directory-toolbar{padding-top:var(--manager-control-gap);padding-bottom:var(--manager-content-gap);min-height:0;gap:var(--manager-control-gap)}
.directory-toolbar>.el-input,.directory-toolbar>.el-select{max-width:100%}
.directory-table :deep(.el-table th.el-table__cell){height:var(--table-head-height);padding:0 var(--spacing-md)!important}
.directory-table :deep(.el-table td.el-table__cell){height:var(--list-row-height);padding:var(--spacing-sm) var(--spacing-md)!important}
.directory-table :deep(.el-table .cell){padding-inline:0;line-height:var(--leading-sm)}
.asset-name{padding:0;gap:0;min-height:var(--leading-sm)}
.asset-name>span{width:100%;min-width:0}
.asset-name strong{line-height:var(--leading-sm)}
.asset-name small{margin-top:var(--manager-label-gap);line-height:var(--leading-xs)}
.asset-name strong,.asset-name small{max-width:100%}
footer{padding-top:var(--manager-content-gap);padding-bottom:var(--manager-module-gap)}
@container ontology-manager (max-width:760px){.directory-toolbar>.el-select{flex:0 1 160px}}
@container ontology-manager (max-width:600px){.directory-toolbar{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.directory-toolbar>.el-input{grid-column:1/-1}.directory-toolbar>.el-input,.directory-toolbar>.el-select{width:100%;min-width:0}.directory-table{min-height:180px;flex:1 0 180px}.product-directory{overflow:auto}.directory-overview{align-items:flex-start}.directory-graph{max-height:320px}footer :deep(.el-pagination){flex-wrap:wrap;gap:var(--spacing-sm)}}
</style>
<style scoped>.projection-check{display:flex;flex-direction:column;gap:16px}.projection-check p{margin:0;line-height:1.7;color:var(--el-text-color-secondary)}.projection-check-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px}.projection-check-toolbar .el-select{width:160px}.projection-check-hint{font-size:var(--text-xs)}</style>
