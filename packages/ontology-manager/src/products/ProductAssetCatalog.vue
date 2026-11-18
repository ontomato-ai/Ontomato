<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from "vue";
import { PlatformPageHeader, openApplicationKey } from "@ontomato/platform-shell";
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
import { ArrowLeft, Plus, RefreshCw, ChevronRight, MoreHorizontal } from "lucide-vue-next";
import { randomId } from "@ontomato/contracts/random-id";
import { ElMessageBox } from "element-plus";
import { productAssetInputSchema, productWidgets, type ProductAsset, type ProductDocument } from "@ontomato/contracts/product-assets";
import {isMetricChartProjection} from '@ontomato/contracts/product-projections';
import type {MetricReferenceChartEntry} from '@ontomato/contracts/dashboard';
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { createViewWidget, type NonChartViewWidget } from "@ontomato/contracts/object-views";
import { useManagerClient, useManagerContext, useManagerCounts,useOntologyText } from "../context";
import ProductAssetRuntime from "./ProductAssetRuntime.vue";
import ProductAssetConfiguration from './ProductAssetConfiguration.vue';
import ProductAssetGraph from './ProductAssetGraph.vue';
import type {ProductGraph} from '@ontomato/contracts/product-graph';
import {productCategory} from '@ontomato/contracts/product-graph';
import {productIcons} from './product-icons';
import {rendererLabel} from './renderer-labels';
import {useProductText} from './default-texts';
import {localizedProductTypes,localizedProductCategories} from './catalog-labels';
import {useIdentityNames} from './identity-names';
import DashboardChartPicker from '../components/DashboardChartPicker.vue';
const client = useManagerClient();
const openApplication=inject(openApplicationKey,null);
function openReference(event:MouseEvent,reference:import('@ontomato/contracts/product-assets').ProductReference){
 if(reference.kind!=='application'||!openApplication)return;
 event.preventDefault();openApplication(reference.id);
}
const nativeBinding=ref<{agentId?:string;applicationId?:string}>({});
const identityName=useIdentityNames();
const {ot}=useOntologyText();
const productText=useProductText();
const catalogTypes=computed(()=>localizedProductTypes(ot));
const creationGroups=computed(()=>localizedProductCategories(ot).map(category=>({...category,types:catalogTypes.value.filter(type=>type.category===category.id)})));
const managerCounts=useManagerCounts();
const managerContext=useManagerContext();
const props=defineProps<{assetId?:string;createKind?:string}>();
const emit=defineEmits<{select:[id:string];home:[];open:[id:string];back:[]}>();
const assets = ref<ProductAsset[]>([]), selected = ref<ProductAsset|null>(null);
const error = ref(""), busy = ref(false), editing = ref(false), showTypes=ref(false);
const profileReleases=ref<{releaseId:string;createdAt:string;active:boolean}[]>([]);
const upgrade=ref<Awaited<ReturnType<typeof client.products.upgrade>>|null>(null);
async function reviewUpgrade(){if(selected.value)await run(async()=>{upgrade.value=await client.products.upgrade(selected.value!.id);});}
const grantRecords=ref<{principalKind:string;principalId:string;verb:string}[]>([]);
const grantPrincipal=ref(''),grantKind=ref<'principal'|'role'>('role'),grantVerb=ref<'use'|'edit'>('use');
async function loadGrants(){if(selected.value)await run(async()=>{grantRecords.value=(await client.products.grants(selected.value!.id)).grants;});}
async function changeGrant(principalKind:'principal'|'role',principalId:string,verb:'use'|'edit',remove=false){if(!selected.value)return;await run(async()=>{await client.products.changeGrant(selected.value!.id,{principalKind,principalId,verb,remove});grantRecords.value=(await client.products.grants(selected.value!.id)).grants;});}
async function setDomainGrant(shared:boolean){if(!selected.value)return;await run(async()=>{await client.products.changeDomainGrant(selected.value!.id,shared);grantRecords.value=(await client.products.grants(selected.value!.id)).grants;});}
const capabilities=ref<{id?:string;name:string;status?:string}[]>([]);
const classes=ref<{className:string;showName?:string}[]>([]);
const name = ref(""), description = ref(""), visibility = ref<"private"|"domain">("private");
const document = ref<ProductDocument>({kind:"page",children:[]});
const advanced = ref(false), raw = ref("");
const metricId = ref(""), valueField = ref(""), labelField=ref(""), parameters = ref("{}");
const childId = ref(""), childColumn = ref<"main"|"sidebar">("main");
const childOptions=ref<{id:string;name:string}[]>([]);
async function searchChildren(search=''){try{const result=await client.products.query({search,pageSize:50});childOptions.value=result.items.filter(asset=>['page','widget','dashboard','object-view','metric-widget','action-view','collection-view','object-projection','agent-profile'].includes(asset.kind)&&asset.id!==selected.value?.id);}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}}
const widgetIndex=ref(0);
/** A chart MetricWidget enters only by bringing in an existing chart. */
const chartPicker=ref(false);
/**
 * The brought chart replaces the number's presentation entirely: its file, its MetricView and its parameters. The
 * form's own fields follow, because saving writes them over the document.
 */
function bringChart(chart:MetricReferenceChartEntry){
  const projection=document.value as Extract<ProductDocument,{kind:'metric-widget'}>;
  projection.renderer='chart';
  projection.renders.id=chart.query.metricId;
  projection.chartFile=chart.chartFile.content;
  projection.parameters=Object.fromEntries(Object.entries(chart.query.parameters).map(([name,value])=>[name,{source:'literal' as const,value}]));
  projection.fields=[];projection.valueField='';projection.labelField='';projection.chartType='bar';
  delete projection.format;delete projection.display;
  metricId.value=projection.renders.id;
  valueField.value='';labelField.value='';parameters.value=JSON.stringify(projection.parameters,null,2);
  if(!name.value.trim())name.value=chart.name;
  raw.value=JSON.stringify(document.value,null,2);
}
const editorWidgets=computed(()=>productWidgets(document.value));
const typeIcons=productIcons;
const rendererOptions=computed(()=>({'metric-widget':['number','chart','table'],'action-view':['form','button','dialog','inline'],'collection-view':['table','list','3d-scene'],'object-projection':['full','summary','card','text','3d']} as Record<string,string[]>)[document.value.kind]??[]);
const references = computed(() => expandedReferences.value);
const parentAssets=ref<{id:string;name:string}[]>([]);
const expandedReferences=ref<import('@ontomato/contracts/product-assets').ProductReference[]>([]);
const dependencyLoading=ref(false),dependencyError=ref(''),dependencyLoaded=ref(false);
const dependencyGraph=ref<ProductGraph>({nodes:[],edges:[]});
const dependencyNames=ref<Record<string,string>>({});
const applicationLinks=ref<Record<string,string>>({});
const referenceLabels={asset:'productDirectoryTitle',metric:'productReferenceMetric',action:'productReferenceAction',definition:'productTargetDefinition','object-type':'productTargetObjectType',dashboard:'productDashboard',application:'productSourceApps','object-view':'productObjectView'} as const;
const referenceGroups=computed(()=>Object.entries(referenceLabels).map(([kind,label])=>({kind,label:ot(label),items:references.value.filter(reference=>reference.kind===kind)})).filter(group=>group.items.length));
function referenceName(reference:import('@ontomato/contracts/product-assets').ProductReference){return productText(dependencyNames.value[`${reference.kind}:${reference.id}`]??assets.value.find(asset=>asset.id===reference.id)?.name??capabilities.value.find(capability=>capability.id===reference.id)?.name??reference.id);}
async function resolveDependencyNames(id:string,references:import('@ontomato/contracts/product-assets').ProductReference[]){
  const names=await Promise.all(references.map(async reference=>{
    try{
      if(reference.kind==='asset')return [`asset:${reference.id}`,(await client.products.get(reference.id)).name];
      if(reference.kind==='definition'){const response=await client.request(`/product-assets/definitions/${encodeURIComponent(reference.id)}`,{},'');const result=await response.json();if(result.definition?.name)return [`definition:${reference.id}`,result.definition.name];}
      if(reference.kind==='object-type'){const ontology=await client.loadOntology();const object=ontology.objects.find(object=>object.className===reference.id);if(object?.showName)return [`object-type:${reference.id}`,object.showName];}
      if(reference.kind==='metric'||reference.kind==='action'){
        const result=await client.requestSmartAsset(reference.kind==='metric'?'metrics':'actions','queryById',{id:reference.id});
        if(result.data?.name)return [`${reference.kind}:${reference.id}`,String(result.data.name)];
      }
      if(reference.kind==='application'){
        const application=await client.dataEngine.get(`/platform/applications/${encodeURIComponent(reference.id)}`) as {names?:Record<string,string>};
        const names=application?.names;
        const entry=application as {kind?:string;entry?:{home?:string;path?:string}};
        const path=entry.kind==='hosted'||entry.kind==='connected'?`/applications/${encodeURIComponent(reference.id)}`:entry.entry?.home??entry.entry?.path;
        if(selected.value?.id===id&&path?.startsWith('/')&&!path.startsWith('//'))applicationLinks.value={...applicationLinks.value,[reference.id]:'#'+path};
        if(names){const name=names[managerContext.locale]??names[managerContext.locale.startsWith('zh')?'zh-CN':'en']??Object.values(names)[0];if(name)return [`application:${reference.id}`,name];}
      }
    }catch{/* Keep the identifier visible when metadata is unavailable. */}
    return null;
  }));
  if(selected.value?.id===id)dependencyNames.value=Object.fromEntries(names.filter((entry):entry is string[]=>entry!==null));
}
function referenceHref(reference:import('@ontomato/contracts/product-assets').ProductReference){
  const id=encodeURIComponent(reference.id);
  if(reference.kind==='metric')return `#/ontology/assets/metrics/${id}`;
  if(reference.kind==='action')return `#/ontology/assets/actions/${id}`;
   if(reference.kind==='application')return applicationLinks.value[reference.id]??`#/applications/${id}`;
  if(reference.kind==='dashboard')return `#/dashboards?dashboardId=${id}`;
  return undefined;
}
watch(()=>selected.value,()=>{
  upgrade.value=null;
  grantRecords.value=[];
  expandedReferences.value=[];
  dependencyNames.value={};
  dependencyLoaded.value=false;dependencyLoading.value=false;dependencyError.value='';
   parentAssets.value=[];
});
const usedBy = computed(() => parentAssets.value);
async function loadDependencies(event:Event){const target=event.target as HTMLDetailsElement;if(!target.classList.contains('asset-relations')||!target.open||!selected.value||dependencyLoaded.value||dependencyLoading.value)return;const id=selected.value.id;dependencyLoading.value=true;dependencyError.value='';try{const result=await client.products.dependencies(id);if(selected.value?.id===id){expandedReferences.value=result.references;parentAssets.value=result.usedBy;dependencyGraph.value=result.graph;dependencyLoaded.value=true;void resolveDependencyNames(id,result.references);}}catch(reason){if(selected.value?.id===id)dependencyError.value=reason instanceof Error?reason.message:String(reason);}finally{if(selected.value?.id===id)dependencyLoading.value=false;}}
const children = computed(() => "children" in document.value ? document.value.children : []);
const candidates = computed(() => childOptions.value);
const widget=computed(()=>editorWidgets.value[widgetIndex.value]);
/** The widget without a chart: its value and label fields and text; a chart keeps its drawing in the file. */
const detail=computed(()=>widget.value as NonChartViewWidget|undefined);
function updatePlatformResources(value:string){try{if(document.value.kind==='widget'&&document.value.widget.kind==='platform')document.value.widget.workspace=JSON.parse(value);}catch{error.value=ot('productInvalidResourceJson');}}
function updateProfileReferences(field:'tools'|'contextViews',value:string){if(document.value.kind==='agent-profile')document.value[field]=value.split('\n').map(id=>id.trim()).filter(Boolean);}
function updateProjectionFields(value:string){if('fields' in document.value)document.value.fields=value.split('\n').map(field=>field.trim()).filter(Boolean);}
function updateCollectionParameters(value:string){try{if(document.value.kind==='collection-view')document.value.parameters=JSON.parse(value);}catch{error.value=ot('productInvalidBindingJson');}}
function updatePageParameters(value:string){try{if(document.value.kind==='page')document.value.params=JSON.parse(value);}catch{error.value=ot('productInvalidPageParamsJson');}}
function updateMetricFormat(value:string){try{if(document.value.kind==='metric-widget'){if(value.trim())document.value.format=JSON.parse(value);else delete document.value.format;}}catch{error.value=ot('productInvalidFormatJson');}}
function updateObjectLayout(value:string){try{if(document.value.kind==='object-projection'){if(value.trim())document.value.layout=JSON.parse(value);else delete document.value.layout;}}catch{error.value=ot('productInvalidObjectLayoutJson');}}
function updateReadOnlyParameters(value:string){if(document.value.kind==='action-view')document.value.readOnlyParameters=value.split('\n').map(name=>name.trim()).filter(Boolean);}
const headerTitle=computed(()=>editing.value?ot(selected.value?'productEditTitle':'productCreateTitle',{type:typeName(document.value.kind)}):ot('productDirectoryTitle'));
const legacyAsset=computed(()=>selected.value?productCategory(selected.value.document.kind)==='legacy':false);
const previewTitle=computed(()=>selected.value&&['application','dashboard'].includes(selected.value.document.kind)?ot('productOpenEntry'):selected.value&&['page','layout-template'].includes(selected.value.document.kind)?ot('productPageComposition'):ot('productRunPreview'));
const compositionColumns=computed(()=>{const document=selected.value?.document;if(!document||!('children' in document))return [];if(document.kind==='page'&&(document.layout?.mode==='grid'||document.layout?.mainWidth===12))return [{column:'main',label:ot('productPageContentInOrder'),children:document.children}];return (['main','sidebar'] as const).map(column=>({column,label:column==='main'?ot('productMainColumn'):ot('productSidebar'),children:document.children.filter(child=>child.column===column)}));});
const layoutLabel=(layout?:string)=>({data:ot('productLayoutData'),tasks:ot('productLayoutTasks'),assistant:ot('productLayoutAssistant')}[layout??'']??ot('productPageLayout'));
const compositionLayout=computed(()=>selected.value?.document.kind==='page'&&selected.value.document.layout?selected.value.document.layout.mode==='grid'?ot('productSingleGrid'):ot('productColumnsLayout',{main:selected.value.document.layout.mainWidth,side:12-selected.value.document.layout.mainWidth}):selected.value&&'workspace' in selected.value.document?layoutLabel(selected.value.document.workspace?.layout):ot('productPageLayout'));
const headerActions=computed(()=>[{id:'refresh',label:ot('productRefresh'),icon:RefreshCw,disabled:busy.value||editing.value,onClick:()=>void run(load)}]);
const typeName = (value:string) => catalogTypes.value.find(type => type.kind === value)?.name ?? value;
async function run(action:()=>Promise<void>) { if(busy.value)return; busy.value=true;error.value="";try{await action();}catch(e){if(e!=="cancel"&&e!=="close")error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;} }
async function load() {
  const id=selected.value?.id??props.assetId;
  if(!id)return;
  selected.value=await client.products.get(id);
  nativeBinding.value=await client.products.nativeBinding(id);
  profileReleases.value=['agent-profile','application'].includes(selected.value.document.kind)&&selected.value.editable?(await client.products.releases(id)).releases:[];
  const children='children' in selected.value.document?selected.value.document.children:[];
  assets.value=await Promise.all(children.map(child=>client.products.get(child.assetId)));
}
onMounted(()=>{if(props.createKind)void createAsset(props.createKind);else void run(load);});
watch(()=>props.assetId,id=>{if(!editing.value&&id!==selected.value?.id){selected.value=null;void run(load);}});
watch(()=>widget.value?.kind,async value=>{
  if(!value)return;
  try{capabilities.value=await client.loadSmartAssets(value==='action'?'actions':'metrics');}catch{capabilities.value=[];}
});
/** A chart renderer without a chart file cannot be saved, so choosing it asks for the chart first. */
function rendererChanged(){
  if(document.value.kind!=='metric-widget'||document.value.renderer!=='chart')return;
  // The number's value mappings do not belong in a chart file, so they go with the old presentation.
  document.value.fields=[];document.value.valueField='';document.value.labelField='';document.value.chartType='bar';
  delete document.value.format;delete document.value.display;
  valueField.value='';labelField.value='';
  if(!document.value.chartFile)chartPicker.value=true;
}
function select(asset:{id:string}|undefined) { if(!asset)return;editing.value=false;emit('select',asset.id); }
function more(command:string){if(command==='copy')void copy();else if(command==='template')void saveTemplate();else if(command==='delete')void remove();else showTypes.value=!showTypes.value;}
async function createPage(){if(!selected.value)return;await run(async()=>{const source=selected.value!;const result=await ElMessageBox.prompt(ot('productPageName'),ot('productCreatePageFromTemplate'),{inputValue:ot('productPageSuffix',{name:source.name})});selected.value=await client.products.createPage(source.id,result.value);await load();emit('select',selected.value!.id);});}
async function createAsset(value:string){if(value!=='dashboard'){edit(null,value);return;}await run(async()=>{const result=await ElMessageBox.prompt(ot('productDashboardName'),ot('productCreateDashboard'));selected.value=await client.products.createDashboard(result.value);await load();emit('select',selected.value!.id);});}
function edit(asset:ProductAsset|null,newKind="page") {
  // A new form starts clean: the previous form's failure is not this form's.
  error.value="";
  if(asset&&productCategory(asset.document.kind)==='legacy'){error.value=ot('productLegacyContract');return;}
  widgetIndex.value=0;
  selected.value=asset;name.value=asset?.name ?? ""; description.value=asset?.description ?? "";visibility.value=asset?.visibility ?? "private";
  const defaults:Record<string,ProductDocument>={
    'metric-widget':{kind:'metric-widget',renders:{kind:'MetricView',id:''},renderer:'number',parameters:{},fields:[],valueField:'count',labelField:'',chartType:'bar',height:240,isDefault:false,audience:'both'},
    'action-view':{kind:'action-view',renders:{kind:'Action',id:''},renderer:'form',parameters:{},readOnlyParameters:[],isDefault:false,audience:'both'},
    'collection-view':{kind:'collection-view',renders:{kind:'Definition',id:''},renderer:'table',parameters:{},fields:[],isDefault:false,audience:'both'},
    'object-projection':{kind:'object-projection',renders:{kind:'ObjectType',id:''},renderer:'full',fields:[],isDefault:false,audience:'both'},
    navigation:{kind:'navigation',entry:'home',nodes:[]},
    'agent-profile':{kind:'agent-profile',agentId:'',instructions:'',tools:[],contextViews:[]},
    page:{kind:"page",children:[]},
    "layout-template":{kind:"layout-template",workspace:defaultPersonalWorkspace(),children:[]},
    widget:{kind:"widget",widget:createViewWidget("metric")},
    "operation-panel":{kind:"operation-panel",widgets:[createViewWidget("action")]},
    "widget-group":{kind:"widget-group",widgets:[createViewWidget("metric")]},
    dashboard:{kind:"dashboard",dashboardId:""},
    "object-view":{kind:"object-view",className:"",form:"full"},
    application:{kind:"application",applicationId:"",children:[]},
  };
  document.value=JSON.parse(JSON.stringify(asset?.document ?? defaults[newKind]!));
  // A new chart MetricWidget has nothing to show until a chart is brought in, so it asks for one right away.
  chartPicker.value=!asset&&document.value.kind==='metric-widget'&&document.value.renderer==='chart';
  raw.value=JSON.stringify(document.value,null,2);advanced.value=false;
  const widget=productWidgets(document.value)[0];
  metricId.value=widget?.resourceId ?? "";
  valueField.value=widget&&widget.kind!=='chart'?widget.valueField:"";
  labelField.value=widget&&widget.kind!=='chart'?widget.labelField:"";
  parameters.value=JSON.stringify(widget?.parameters ?? {},null,2);
  editing.value=true;
  if('children' in document.value)void searchChildren();
  if(document.value.kind==='object-view')void client.loadOntology().then(ontology=>{classes.value=ontology.objects;}).catch(()=>{});
}
function toggleAdvanced() {
  if(advanced.value){try{document.value=JSON.parse(raw.value);}catch{error.value=ot('productInvalidConfigJson');return;}}
  else {
    applyWidgetFields();
    raw.value=JSON.stringify(document.value,null,2);
  }
  advanced.value=!advanced.value;
  if(!advanced.value)readWidgetFields();
}
function readWidgetFields(){
  const widget=editorWidgets.value[widgetIndex.value];
  metricId.value=widget?.resourceId??'';
  valueField.value=widget&&widget.kind!=='chart'?widget.valueField:'';
  labelField.value=widget&&widget.kind!=='chart'?widget.labelField:'';
  parameters.value=JSON.stringify(widget?.parameters??{},null,2);
}
function applyWidgetFields(){
  if(document.value.kind==='metric-widget'){
    document.value.renders.id=metricId.value;document.value.parameters=JSON.parse(parameters.value);
    if(isMetricChartProjection(document.value))return;
    document.value.valueField=valueField.value;document.value.labelField=labelField.value;return;
  }
  if(document.value.kind==='action-view'){document.value.renders.id=metricId.value;document.value.parameters=JSON.parse(parameters.value);return;}
  const item=detail.value;
  if(item){item.resourceId=metricId.value;item.parameters=JSON.parse(parameters.value);item.valueField=valueField.value;item.labelField=labelField.value;}
}
function chooseWidget(index:number){try{applyWidgetFields();widgetIndex.value=index;readWidgetFields();}catch{error.value=ot('productFixWidgetJson');}}
function addWidget(){if(!('widgets' in document.value))return;try{applyWidgetFields();document.value.widgets.push(createViewWidget(document.value.kind==='operation-panel'?'action':'metric'));widgetIndex.value=document.value.widgets.length-1;readWidgetFields();}catch{error.value=ot('productFixParametersJson');}}
function removeWidget(){if(!('widgets' in document.value))return;document.value.widgets.splice(widgetIndex.value,1);widgetIndex.value=0;readWidgetFields();}
async function addChild() { if(childId.value && "children" in document.value && !children.value.some(child=>child.assetId===childId.value)){try{const asset=await client.products.get(childId.value);assets.value.push(asset);document.value.children.push({assetId:childId.value,column:childColumn.value});}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}} }
async function save() { await run(async()=>{
  if(advanced.value) document.value=JSON.parse(raw.value);
  else applyWidgetFields();
  if(document.value.kind==='object-view'&&!document.value.primaryKey?.trim())delete document.value.primaryKey;
  const input=productAssetInputSchema.parse({name:name.value,description:description.value,visibility:visibility.value,document:document.value});
   const id=selected.value?.id??(input.document.kind==='application'?input.document.applicationId:randomId());
   const shareInitially=!selected.value&&visibility.value==='domain';
   const saved=await client.products.save(id,input,selected.value?.revision ?? 0);
   selected.value=saved;editing.value=false;
   emit('select',saved.id);
   void managerCounts.refresh();
   if(shareInitially)try{await client.products.changeDomainGrant(saved.id,true);}catch(reason){throw new Error(ot('productInitialShareFailed',{reason:reason instanceof Error?reason.message:''}),{cause:reason});}
   await load();
}); }
async function saveTemplate(){if(!selected.value||selected.value.document.kind!=='page')return;await run(async()=>{
  const result=await ElMessageBox.prompt(ot('productTemplateName'),ot('productSaveLayoutTemplate'),{inputValue:ot('productTemplateSuffix',{name:selected.value!.name})});
  const source=selected.value!;
  if(source.document.kind!=='page')return;
  selected.value=await client.products.save(randomId(),{name:result.value,description:source.description,visibility:'private',document:{...source.document,isTemplate:true}},0);await load();
});}
async function copy() { if(!selected.value)return;await run(async()=>{const result=await ElMessageBox.prompt(ot('productNewAssetName'),ot('productCopyAsset'),{inputValue:ot('productCopySuffix',{name:selected.value!.name})});selected.value=await client.products.copy(selected.value!.id,result.value);await load();}); }
async function publishProfile(){if(!selected.value)return;await run(async()=>{await client.products.publish(selected.value!.id,selected.value!.revision);await load();});}
async function retryPublication(){if(!selected.value)return;await run(async()=>{await client.products.retryPublication(selected.value!.id);await load();});}
async function rollbackProfile(releaseId:string){if(!selected.value)return;await run(async()=>{await client.products.rollback(selected.value!.id,releaseId);await load();});}
async function migrateView(){if(!selected.value)return;await run(async()=>{selected.value=await client.products.migrate(selected.value!.id,selected.value!.revision);await load();});}
async function migrateDashboard(){if(!selected.value)return;await run(async()=>{selected.value=await client.products.migrateDashboard(selected.value!.id,selected.value!.revision);await load();});}
async function migratePlatform(){if(!selected.value)return;await run(async()=>{const source=selected.value!;let profileId:string|undefined;if(source.document.kind==='widget'&&source.document.widget.kind==='platform'&&source.document.widget.source==='assistant')profileId=(await ElMessageBox.prompt(ot('productPublishedProfileId'),ot('productConfigureConversationProjection'))).value;selected.value=await client.products.migratePlatform(source.id,source.revision,profileId);await load();});}
async function useHome() { if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm(ot('productUseAsHomeConfirm'),ot('productApplyTemplate'));const home=await client.products.home();await client.products.useHome(selected.value!.id,home.revision);emit('home');}); }
async function remove() { if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm(ot('productDeleteConfirm'),ot('productDeleteAsset'));await client.products.delete(selected.value!.id,selected.value!.revision);selected.value=null;void managerCounts.refresh();emit('back');}); }
</script>
<template>
  <section class="product-catalog">
    <PlatformPageHeader :title="headerTitle" :description="ot('productCatalogDescription')" :actions="headerActions">
      <template #leading><el-button text :icon="ArrowLeft" @click="emit('back')">{{ot('productBackToDirectory')}}</el-button><span class="product-title-divider" aria-hidden="true"/></template>
      <template #actions>
        <el-button v-if="!editing&&selected?.editable&&!nativeBinding.agentId&&!nativeBinding.applicationId&&(selected.document.kind==='agent-profile'||selected.document.kind==='application'&&!selected.document.workspaceId)" :loading="busy" @click="publishProfile">{{ot('productPublish')}}</el-button>
        <el-button v-if="!editing&&selected?.editable&&selected.document.kind==='application'&&!selected.document.workspaceId" :disabled="busy" @click="retryPublication">{{ot('productRetryCatalogSync')}}</el-button>
        <el-button v-if="!editing&&selected?.editable&&((profileReleases.length&&selected.document.kind==='agent-profile')||selected.document.kind==='application')" :disabled="busy" @click="reviewUpgrade">{{ot('productReviewUpgrade')}}</el-button>
        <el-button v-if="!editing&&selected?.editable&&selected.document.kind==='object-view'" :loading="busy" @click="migrateView">{{ot('productMigrateView')}}</el-button>
        <el-button v-if="!editing&&selected?.editable&&selected.document.kind==='dashboard'" :loading="busy" @click="migrateDashboard">{{ot('productMigrateToPage')}}</el-button>
        <el-button v-if="!editing&&selected?.editable&&selected.document.kind==='widget'&&selected.document.widget.kind==='platform'" :loading="busy" @click="migratePlatform">{{ot('productMigratePlatform')}}</el-button>
        <el-button v-if="editing" :disabled="busy" @click="editing=false">{{ot('productCancel')}}</el-button><el-button v-if="editing" type="primary" :loading="busy" @click="save">{{ot('productSave')}}</el-button>
          <template v-else><el-dropdown placement="bottom-end" :popper-options="dropdownBoundaryOptions" :disabled="busy" @command="createAsset"><el-button type="primary" :icon="Plus">{{ot('productCreateAsset')}}</el-button><template #dropdown><el-dropdown-menu><template v-for="(group,index) in creationGroups" :key="group.id"><el-dropdown-item disabled :divided="index>0">{{group.name}}</el-dropdown-item><el-dropdown-item v-for="type in group.types" :key="type.kind" :command="type.kind"><component :is="typeIcons[type.kind]" :size="16" class="creation-type-icon" aria-hidden="true"/>{{type.name}}</el-dropdown-item></template></el-dropdown-menu></template></el-dropdown></template>
      </template>
    </PlatformPageHeader>
    <div v-if="error" class="product-alert"><el-alert :title="error" type="error" :closable="false" /></div>
    <el-alert v-if="legacyAsset&&!editing" :title="ot('productLegacyAssetWarning')" type="warning" :closable="false"/>
    <div v-if="showTypes" class="product-types"><article v-for="type in catalogTypes" :key="type.kind"><strong>{{type.name}}</strong><span>{{type.description}}</span></article></div>
    <div class="product-body" @toggle.capture="loadDependencies">
      <main v-if="editing" class="asset-editor">
        <h2>{{ot('productBasicInfo')}}</h2>
        <el-form label-position="top" :disabled="busy"><el-form-item :label="ot('productName')"><el-input v-model="name"/></el-form-item><el-form-item :label="ot('productDescription')"><el-input v-model="description" type="textarea"/></el-form-item><el-form-item v-if="!selected" :label="ot('productInitialGrant')"><el-select v-model="visibility"><el-option value="private" :label="ot('productVisibilityPrivate')"/><el-option value="domain" :label="ot('productVisibilityDomain')"/></el-select></el-form-item><p v-else>{{ot('productGrantsManagedByRecords')}}</p>
          <template v-if="!advanced">
            <el-form-item v-if="document.kind==='widget'" :label="ot('productWidgetImplementation')"><el-select :model-value="document.widget.kind==='platform'?'platform':'capability'" @change="document={kind:'widget',widget:$event==='platform'?{kind:'platform',source:'assistant',placeholder:'',limit:4}:createViewWidget('metric')}"><el-option value="capability" :label="ot('productCapabilityDisplay')"/><el-option value="platform" :label="ot('productWidgetPlatform')"/></el-select></el-form-item>
            <template v-if="document.kind==='widget'&&document.widget.kind==='platform'"><el-form-item :label="ot('productContentSource')"><el-select v-model="document.widget.source"><el-option v-for="(label,key) in {assistant:ot('productSourceAssistant'),apps:ot('productSourceAppsAndAgents'),data:ot('productSourceData'),tasks:ot('productSourceTasks'),conversations:ot('productSourceConversations'),objects:ot('productSourceObjects'),recent:ot('productSourceRecent')}" :key="key" :value="key" :label="label"/></el-select></el-form-item><el-form-item v-if="document.widget.source==='assistant'" :label="ot('productInputHint')"><el-input v-model="document.widget.placeholder"/></el-form-item><el-form-item :label="ot('productItemLimit')"><el-input-number v-model="document.widget.limit" :min="1" :max="20"/></el-form-item><el-form-item :label="ot('productResourceSelectionJson')"><el-input :model-value="JSON.stringify(document.widget.workspace??{},null,2)" type="textarea" :rows="5" @change="updatePlatformResources"/></el-form-item></template>
           <template v-if="'widgets' in document"><h3>{{ot('productCompositionContent')}}</h3><div class="toolbar"><el-select :model-value="widgetIndex" :aria-label="ot('productEditComposedWidget')" @change="chooseWidget"><el-option v-for="(item,index) in editorWidgets" :key="item.id" :value="index" :label="item.title||ot('productWidgetNumbered',{index:index+1})"/></el-select><el-button @click="addWidget">{{ot('productAddComponent')}}</el-button><el-button :disabled="editorWidgets.length<=1" @click="removeWidget">{{ot('productRemove')}}</el-button></div></template>
           <el-form-item v-if="widget&&document.kind!=='metric-widget'&&document.kind!=='action-view'" :label="ot('productWidgetTitle')"><el-input v-model="widget.title"/></el-form-item>
            <template v-if="'renders' in document"><el-form-item v-if="!['metric-widget','action-view'].includes(document.kind)" :label="ot('productBoundElement')"><el-input v-model="document.renders.id"/></el-form-item><el-form-item :label="ot('productRenderer')"><el-select v-model="document.renderer" @change="rendererChanged"><el-option v-for="renderer in rendererOptions" :key="renderer" :value="renderer" :label="rendererLabel(ot,renderer)"/></el-select></el-form-item><el-checkbox v-model="document.isDefault">{{ot('productDefaultProjection')}}</el-checkbox></template>
            <template v-if="document.kind==='page'"><el-form-item :label="ot('productPagePurpose')"><el-checkbox v-model="document.embeddable">{{ot('productEmbeddableDisplayPage')}}</el-checkbox><el-checkbox v-model="document.isTemplate">{{ot('productTemplateForPages')}}</el-checkbox></el-form-item><el-form-item :label="ot('productPageLayout')"><el-button v-if="!document.layout" @click="document.layout={mode:'columns',mainWidth:8,gap:'normal'}">{{ot('productConfigureLayout')}}</el-button><template v-else><el-select v-model="document.layout.mode"><el-option value="columns" :label="ot('productMainAndSidebar')"/><el-option value="grid" :label="ot('productSingleGrid')"/></el-select><el-input-number v-if="document.layout.mode==='columns'" v-model="document.layout.mainWidth" :min="4" :max="12" :aria-label="ot('productMainColumnWidth')"/><el-select v-model="document.layout.gap"><el-option value="compact" :label="ot('productGapCompactSpacing')"/><el-option value="normal" :label="ot('productGapNormalSpacing')"/><el-option value="comfortable" :label="ot('productGapComfortableSpacing')"/></el-select></template></el-form-item><p>{{ot('productPageReferencesHint')}}</p></template>
           <template v-if="document.kind==='agent-profile'"><el-form-item :label="ot('productAgentDefinition')"><el-input v-model="document.agentId"/><p>{{ot('productAgentExecution')}}</p></el-form-item><el-form-item :label="ot('productInstructions')"><el-input v-model="document.instructions" type="textarea" :rows="6"/></el-form-item><el-form-item :label="ot('productToolReferences')"><el-input :model-value="document.tools.join('\n')" type="textarea" @update:model-value="updateProfileReferences('tools',$event)"/></el-form-item><el-form-item :label="ot('productContextReferences')"><el-input :model-value="document.contextViews.join('\n')" type="textarea" @update:model-value="updateProfileReferences('contextViews',$event)"/></el-form-item></template>
           <el-form-item v-if="'fields' in document" :label="ot('productDisplayFieldsPerLine')"><el-input :model-value="document.fields.join('\n')" type="textarea" @update:model-value="updateProjectionFields"/></el-form-item>
           <el-form-item v-if="document.kind==='collection-view'" :label="ot('productDefinitionBindings')"><el-input :model-value="JSON.stringify(document.parameters,null,2)" type="textarea" :rows="4" @change="updateCollectionParameters"/></el-form-item>
           <el-form-item v-if="document.kind==='collection-view'" :label="ot('productItemsShownPerPage')"><el-input-number v-model="document.pageSize" :min="1" :max="50"/></el-form-item>
           <el-form-item v-if="document.kind==='metric-widget'&&document.renderer==='chart'" :label="ot('ovBringChart')"><el-button @click="chartPicker=true">{{ot('ovBringChart')}}</el-button><code v-if="document.chartFile" class="reference-id">{{document.chartFile.dataset[0].dimensions.join(' · ')}}</code></el-form-item>
           <el-form-item v-if="document.kind==='metric-widget'&&document.renderer!=='chart'" :label="ot('productDisplayFormatJson')"><el-input :model-value="document.format?JSON.stringify(document.format,null,2):''" type="textarea" :rows="3" placeholder='{"kind":"number","decimals":2,"unit":"人"}' @change="updateMetricFormat"/></el-form-item>
           <el-form-item v-if="document.kind==='action-view'" :label="ot('productReadOnlyParamsPerLine')"><el-input :model-value="document.readOnlyParameters.join('\n')" type="textarea" @change="updateReadOnlyParameters"/></el-form-item>
            <el-form-item v-if="document.kind==='object-projection'&&document.renderer==='full'" :label="ot('productObjectLayout')"><el-input :model-value="document.layout?JSON.stringify(document.layout,null,2):''" type="textarea" :rows="8" @change="updateObjectLayout"/><p>{{ot('productObjectLayoutHint')}}</p></el-form-item>
           <el-form-item v-if="document.kind==='page'" :label="ot('productTypedPageParams')"><el-input :model-value="JSON.stringify(document.params??{},null,2)" type="textarea" :rows="4" placeholder='{"selected":{"kind":"object","objectType":"Person"}}' @change="updatePageParameters"/></el-form-item>
            <template v-if="document.kind==='navigation'"><el-form-item :label="ot('productEntryNode')"><el-select v-model="document.entry"><el-option v-for="node in document.nodes" :key="node.id" :value="node.id" :label="node.label||node.id"/></el-select></el-form-item><section v-for="(node,index) in document.nodes" :key="index" class="navigation-node"><header><strong>{{ot('productPageNode',{index:index+1})}}</strong><el-button text @click="document.nodes.splice(index,1)">{{ot('productRemove')}}</el-button></header><div class="node-fields"><el-form-item :label="ot('productNodeId')"><el-input v-model="node.id"/></el-form-item><el-form-item :label="ot('productMenuName')"><el-input v-model="node.label"/></el-form-item><el-form-item :label="ot('productPageAssetId')"><el-input v-model="node.pageId"/></el-form-item><el-form-item :label="ot('productDeepLink')"><el-input v-model="node.path" :placeholder="ot('productDeepLinkPlaceholder')"/></el-form-item></div></section><el-button class="add-node" @click="document.nodes.push({id:`page-${document.nodes.length+1}`,label:'',pageId:'',path:`/page-${document.nodes.length+1}`})">{{ot('productAddPageNode')}}</el-button></template>
            <template v-if="detail&&!['metric-widget','action-view'].includes(document.kind)"><el-form-item :label="ot('productWidgetType')"><el-select v-model="detail.kind"><el-option v-for="value in (document.kind==='widget-group'?['metric','table','text']:['metric','table','text','action'])" :key="value" :value="value" :label="({metric:ot('productWidgetMetric'),table:ot('productWidgetTable'),text:ot('productWidgetText'),action:ot('productWidgetAction')} as Record<string,string>)[value]"/></el-select></el-form-item><el-form-item v-if="detail.kind==='text'" :label="ot('productWidgetText')"><el-input v-model="detail.text" type="textarea"/></el-form-item></template>
            <template v-if="detail&&detail.kind!=='text'"><el-form-item :label="ot('productPublishedCapability')"><el-select v-model="metricId" filterable allow-create default-first-option :placeholder="ot('productChooseCapability')"><el-option v-for="capability in capabilities.filter(item=>item.status==='PUBLISHED'&&item.id)" :key="capability.id" :value="capability.id!" :label="capability.name"/></el-select></el-form-item><el-form-item v-if="detail && ['metric','table'].includes(detail.kind)" :label="ot('productValueField')"><el-input v-model="valueField"/></el-form-item><el-form-item :label="ot('productParameterBindingsHint')"><el-input v-model="parameters" type="textarea" :rows="4"/></el-form-item></template>
           <template v-if="document.kind==='object-view'"><el-form-item :label="ot('productObjectClassWithView')"><el-select v-model="document.className" filterable allow-create default-first-option><el-option v-for="item in classes" :key="item.className" :value="item.className" :label="item.showName||item.className"/></el-select></el-form-item><el-form-item :label="ot('productDefaultObjectKey')"><el-input v-model="document.primaryKey" clearable :placeholder="ot('productObjectKeyPlaceholder')" @clear="delete (document as Extract<ProductDocument,{kind:'object-view'}>).primaryKey"/></el-form-item><p>{{ot('productObjectViewHint')}}</p></template>
           <p v-if="document.kind==='page'">{{ot('productPersonalPreferencesHint')}}</p>
          <el-form-item v-if="document.kind==='dashboard'" :label="ot('productExistingDashboardId')"><el-input v-model="document.dashboardId"/></el-form-item>
           <el-form-item v-if="document.kind==='application'" :label="ot('productPlatformApplicationId')"><el-input v-model="document.applicationId"/></el-form-item>
           <el-form-item v-if="document.kind==='application'" :label="ot('productNavigationRootId')"><el-input v-model="document.navigationId" :placeholder="ot('productRequiredForDeclarative')"/></el-form-item>
           <template v-if="'children' in document"><h3>{{ot('productComposedComponents')}}</h3><div v-for="(child,index) in children" :key="child.assetId" class="child-row"><span>{{productText(assets.find(asset=>asset.id===child.assetId)?.name ?? child.assetId)}}</span><el-select v-model="child.column"><el-option value="main" :label="ot('productMainColumn')"/><el-option value="sidebar" :label="ot('productSidebar')"/></el-select><el-button :disabled="index===0" @click="children.splice(index-1,0,...children.splice(index,1))">{{ot('productMoveUp')}}</el-button><el-button @click="children.splice(index,1)">{{ot('productRemove')}}</el-button></div><div class="child-row"><el-select v-model="childId" filterable remote :remote-method="searchChildren" :placeholder="ot('productSearchReusable')"><el-option v-for="asset in candidates" :key="asset.id" :label="productText(asset.name)" :value="asset.id"/></el-select><el-select v-model="childColumn"><el-option value="main" :label="ot('productMainColumn')"/><el-option value="sidebar" :label="ot('productSidebar')"/></el-select><el-button @click="addChild">{{ot('productAdd')}}</el-button></div></template>
        </template>
        <el-button text @click="toggleAdvanced">{{advanced?ot('productBackToForm'):ot('productEditFullJson')}}</el-button><el-input v-if="advanced" v-model="raw" type="textarea" :rows="22" spellcheck="false"/>
        <DashboardChartPicker v-model="chartPicker" @pick="bringChart"/>
         </el-form>
      </main>
      <main v-else-if="selected" :key="selected.id">
        <header class="detail-heading">
          <div class="detail-identity"><component :is="typeIcons[selected.document.kind]" :size="22" class="detail-type-icon" aria-hidden="true"/><div><h2>{{productText(selected.name)}}</h2><div class="asset-meta"><span>{{typeName(selected.document.kind)}}</span><span>{{selected.editable?ot('productEditable'):ot('productReadOnly')}}</span></div></div></div>
          <div class="toolbar"><el-button v-if="selected.editable" @click="edit(selected)">{{ot('productEdit')}}</el-button><el-button v-if="['page','layout-template'].includes(selected.document.kind)" @click="useHome">{{ot('productUseAsHome')}}</el-button><el-button v-if="selected.document.kind==='page'" type="primary" @click="emit('open',selected.id)">{{ot('productOpenPage')}}</el-button><el-dropdown @command="more"><el-button text :icon="MoreHorizontal" :aria-label="ot('productMoreActions')"/><template #dropdown><el-dropdown-menu><el-dropdown-item command="copy">{{ot('productCopy')}}</el-dropdown-item><el-dropdown-item v-if="selected.document.kind==='page'" command="template">{{ot('productSaveAsTemplate')}}</el-dropdown-item><el-dropdown-item v-if="selected.editable" command="delete" divided>{{ot('productDelete')}}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div>
        </header>
        <p v-if="selected.description" class="asset-description">{{productText(selected.description)}}</p>
        <el-alert v-if="nativeBinding.agentId" :title="ot('productNativeAgentNote')" type="info" :closable="false"/>
        <el-alert v-else-if="nativeBinding.applicationId" :title="ot('productNativeApplicationNote')" type="info" :closable="false"/>
       <section class="asset-preview" :aria-label="previewTitle">
         <section v-if="upgrade"><h3>{{ot('productUpgradeChanges')}}</h3><p v-if="!upgrade.assets.length&&!upgrade.contracts.length">{{ot('productDraftMatchesRelease')}}</p><p v-for="change in upgrade.assets" :key="change.id">{{change.id}} · {{change.change}} · {{change.fromRevision??'—'}} → {{change.toRevision??'—'}}</p><p v-for="change in upgrade.contracts" :key="`${change.kind}:${change.id}`">{{change.kind}} · {{change.id}} · {{change.change}}</p><p>{{selected.document.kind==='application'&&selected.document.workspaceId?ot('productPublishFromWorkspace'):ot('productPublishToFreeze')}}</p></section>
        <header class="preview-heading"><h3>{{previewTitle}}</h3><el-button v-if="selected.document.kind==='layout-template'||(selected.document.kind==='page'&&selected.document.isTemplate)" type="primary" :disabled="busy" @click="createPage">{{ot('productCreatePageFromTemplate')}}</el-button></header>
        <ProductAssetRuntime v-if="!['page','layout-template'].includes(selected.document.kind)" :asset="selected" preview/>
        <div v-else class="composition-preview">
          <p v-if="'children' in selected.document" class="composition-meta">{{compositionLayout}}<span>{{ot('productChildCount',{count:selected.document.children.length})}}</span></p>
          <div v-if="'children' in selected.document&&selected.document.children.length" class="composition-columns"><section v-for="column in compositionColumns" :key="column.column" class="composition-column"><h4>{{column.label}}</h4><button v-for="child in column.children" :key="child.assetId" class="composition-item" :disabled="!assets.some(asset=>asset.id===child.assetId)" @click="select(assets.find(asset=>asset.id===child.assetId)!)"><component :is="typeIcons[assets.find(asset=>asset.id===child.assetId)?.document.kind??'widget']" :size="16" aria-hidden="true"/><span>{{productText(assets.find(asset=>asset.id===child.assetId)?.name??ot('productComponentUnavailable'))}}</span><ChevronRight :size="14" aria-hidden="true"/></button><p v-if="!column.children.length" class="composition-empty">{{ot('productNoExtraInColumn')}}</p></section></div>
          <p v-else class="composition-empty">{{ot('productNoExtraComponents')}}</p>
        </div>
       </section>
       <details v-if="selected.editable" class="asset-grants" @toggle="($event.target as HTMLDetailsElement).open&&loadGrants()">
         <summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>{{ot('productGrants')}}</strong><span>{{ot('productManageGrants')}}</span></summary>
         <div class="disclosure-content">
            <div v-for="grant in grantRecords" :key="`${grant.principalKind}:${grant.principalId}:${grant.verb}`" class="grant-row"><span :title="grant.principalId">{{grant.principalKind==='role'?ot('productRole'):grant.principalKind==='principal'?ot('productPrincipal'):ot('productDomainMembers')}} · {{identityName(grant.principalId,grant.principalKind==='role'?ot('productRole'):ot('productPrincipal'))}} · {{grant.verb==='use'?ot('productUse'):ot('productEdit')}}</span><el-button v-if="grant.principalKind!=='domain'" text :disabled="busy" @click="changeGrant(grant.principalKind as 'principal'|'role',grant.principalId,grant.verb as 'use'|'edit',true)">{{ot('productRevoke')}}</el-button></div>
           <div class="grant-form"><el-select v-model="grantKind" :aria-label="ot('productGrantTargetType')"><el-option value="role" :label="ot('productRole')"/><el-option value="principal" :label="ot('productPrincipal')"/></el-select><el-input v-model="grantPrincipal" :placeholder="ot('productPrincipalPlaceholder')"/><el-select v-model="grantVerb" :aria-label="ot('productGrantVerb')"><el-option value="use" :label="ot('productUse')"/><el-option value="edit" :label="ot('productEdit')"/></el-select><el-button :disabled="busy||!grantPrincipal.trim()" @click="changeGrant(grantKind,grantPrincipal.trim(),grantVerb)">{{ot('productGrant')}}</el-button></div>
           <div class="domain-grants"><el-button :disabled="busy" @click="setDomainGrant(true)">{{ot('productGrantDomainUse')}}</el-button><el-button :disabled="busy" @click="setDomainGrant(false)">{{ot('productRevokeDomainUse')}}</el-button></div>
         </div>
       </details>
       <details v-if="profileReleases.length" class="asset-releases"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>{{ot('productReleaseHistory')}}</strong><span>{{ot('productVersionCount',{count:profileReleases.length})}}</span></summary><div class="disclosure-content profile-releases"><div v-for="release in profileReleases" :key="release.releaseId"><time>{{new Date(release.createdAt).toLocaleString(managerContext.locale)}}</time><el-tag v-if="release.active" size="small" type="info">{{ot('productActiveRelease')}}</el-tag><el-button v-else :disabled="busy" @click="rollbackProfile(release.releaseId)">{{ot('productRollbackRelease')}}</el-button></div></div></details>
      <details class="asset-relations"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>{{ot('productReferences')}}</strong><span>{{dependencyLoading?ot('productLoading'):dependencyLoaded?ot('productReferenceCounts',{references:references.length,usedBy:usedBy.length}):ot('productExpandReferences')}}</span></summary>
        <div class="disclosure-content relation-content" :aria-busy="dependencyLoading">
          <p v-if="dependencyLoading" role="status">{{ot('productLoadingReferences')}}</p>
          <el-alert v-else-if="dependencyError" :title="dependencyError" type="error" :closable="false"/>
           <template v-else-if="dependencyLoaded">
            <ProductAssetGraph :graph="dependencyGraph" @open="select({id:$event})"/>
            <section v-for="group in referenceGroups" :key="group.kind" class="reference-group"><h3>{{group.label}}<span>{{group.items.length}}</span></h3>
              <div v-for="dependency in group.items" :key="dependency.id" class="reference-row">
                <button v-if="dependency.kind==='asset'" class="reference-link" @click="select({id:dependency.id})">{{referenceName(dependency)}}<ChevronRight :size="14"/></button>
                <a v-else-if="referenceHref(dependency)" class="reference-link" :href="referenceHref(dependency)" @click="openReference($event,dependency)">{{referenceName(dependency)}}<ChevronRight :size="14"/></a>
                <span v-else class="reference-value">{{referenceName(dependency)}}</span>
                <code v-if="referenceName(dependency)!==dependency.id">{{dependency.id}}</code>
              </div>
            </section>
            <p v-if="!references.length" class="relation-empty">{{ot('productNoReferences')}}</p>
            <section class="reference-group"><h3>{{ot('productUsedBy')}}<span>{{usedBy.length}}</span></h3><div v-for="parent in usedBy" :key="parent.id" class="reference-row"><button class="reference-link" @click="select(parent)">{{productText(parent.name)}}<ChevronRight :size="14"/></button><code>{{parent.id}}</code></div><p v-if="!usedBy.length" class="relation-empty">{{ot('productNoUsers')}}</p></section>
          </template>
        </div>
      </details>
      <details class="asset-configuration"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>{{ot('productConfigurationDetails')}}</strong><span>{{ot('productRevision',{revision:selected.revision})}}</span></summary><div class="disclosure-content"><ProductAssetConfiguration :asset="selected"/></div></details></main>
      <main v-else class="empty-detail"><el-empty :description="ot('productSelectAssetHint')" :image-size="64"/><el-button text @click="showTypes=!showTypes">{{ot('productViewTypeGuide')}}</el-button></main>
    </div>
  </section>
</template>
<style scoped>
.product-title-divider{width:1px;height:20px;background:var(--el-border-color);margin-inline:var(--spacing-sm)}
.creation-type-icon{flex-shrink:0;margin-inline-end:var(--spacing-sm)}
.reference-group{min-width:0}.product-body .reference-group h3{display:flex;align-items:center;gap:var(--spacing-sm);margin:var(--spacing-md) 0 var(--spacing-sm);font-size:var(--text-xs);color:var(--el-text-color-secondary)}.reference-group h3>span{font-weight:var(--font-normal)}.reference-row{display:flex;flex-direction:column;gap:var(--spacing-xs);padding:var(--spacing-sm) var(--spacing-md);border-bottom:1px solid var(--el-border-color-lighter);min-width:0}.reference-link{display:flex;align-items:center;justify-content:space-between;gap:var(--spacing-md);background:none;border:0;padding:0;color:var(--el-color-primary);font:inherit;text-align:start;text-decoration:none;cursor:pointer;overflow-wrap:anywhere}.reference-link svg{flex-shrink:0}.reference-link:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}.reference-value,.reference-row code{overflow-wrap:anywhere}.reference-row code{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--el-text-color-secondary)}.relation-empty{margin:0;padding:var(--spacing-sm) var(--spacing-md);font-size:var(--text-sm)}
.product-body{display:flex!important;flex-direction:column}.product-body>main{flex:1;width:100%}.product-body>main.asset-editor{max-width:1100px}.product-body>main:not(.asset-editor){padding-inline:var(--page-gutter)}
.asset-categories{display:flex;flex-shrink:0;align-items:center;gap:var(--spacing-xs);padding:var(--manager-control-gap) var(--page-gutter);border-bottom:1px solid var(--el-border-color);overflow-x:auto;scrollbar-width:thin}.asset-categories button{display:flex;align-items:center;gap:var(--spacing-sm);flex-shrink:0;min-height:var(--control-height);padding:var(--spacing-xs) var(--spacing-md);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--el-text-color-secondary);font:inherit;cursor:pointer}.asset-categories button:hover{background:var(--el-fill-color-light)}.asset-categories button.active{color:var(--el-color-primary);background:var(--el-color-primary-light-9);font-weight:var(--font-semibold)}.asset-categories button>span{font-size:var(--text-xs);font-variant-numeric:tabular-nums;color:var(--el-text-color-secondary)}.asset-categories button:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:-2px}.asset-group-title{display:flex;align-items:center;gap:var(--spacing-sm);padding:var(--spacing-md) var(--manager-content-gap) var(--spacing-sm);color:var(--el-text-color-secondary);font-size:var(--text-xs);background:var(--el-fill-color-light);border-bottom:1px solid var(--el-border-color-light)}.asset-group-title span{flex:1;font-weight:var(--font-semibold)}.asset-group-title small{font-size:inherit}.detail-identity{display:flex;align-items:flex-start;gap:var(--manager-control-gap);min-width:0}.detail-identity>div{min-width:0}.detail-identity h2{overflow-wrap:anywhere}.detail-type-icon{flex-shrink:0;margin-top:2px;color:var(--el-text-color-secondary)}
.detail-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--manager-content-gap);flex-wrap:wrap}.detail-heading h2{margin-bottom:var(--manager-control-gap)}.asset-description{margin:0 0 var(--manager-module-gap);max-width:70ch}.parent-links{display:flex;flex-direction:column;align-items:flex-start;gap:var(--spacing-xs)}summary{cursor:pointer;line-height:var(--leading-sm);font-weight:var(--font-medium)}summary>span{margin-inline-start:var(--manager-control-gap);font-size:var(--text-xs);font-weight:var(--font-normal);color:var(--el-text-color-secondary)}.asset-relations{padding-top:var(--manager-content-gap);border-top:1px solid var(--el-border-color-light)}
.product-catalog{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;color:var(--el-text-color-primary);font-size:var(--text-sm)}
.product-alert{padding:var(--manager-control-gap) var(--page-gutter);flex-shrink:0}.product-types{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--manager-content-gap);padding:var(--manager-content-gap) var(--page-gutter);max-height:30%;overflow:auto;border-bottom:1px solid var(--el-border-color)}.product-types article{display:flex;flex-direction:column;gap:var(--manager-label-gap)}.product-types span,.resource-count,.asset-meta{color:var(--el-text-color-secondary);font-size:var(--text-xs)}
.product-body{display:grid;grid-template-columns:280px minmax(0,1fr);flex:1;min-height:0;overflow:hidden}.product-body aside{display:flex;flex-direction:column;min-height:0;min-width:0;border-inline-end:1px solid var(--el-border-color)}.list-tools{display:flex;flex-direction:column;gap:var(--manager-control-gap);padding:var(--manager-content-gap)}.asset-list{min-height:0;flex:1;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable}.asset-row{width:100%;display:flex;align-items:center;gap:var(--manager-control-gap);min-height:56px;border:0;border-bottom:1px solid var(--el-border-color-light);padding:var(--manager-control-gap) var(--manager-content-gap);text-align:start;background:transparent;color:var(--el-text-color-primary);font:inherit;cursor:pointer}.asset-row:hover{background:var(--el-fill-color-light)}.asset-row.active{background:var(--el-color-primary-light-9);box-shadow:inset 2px 0 var(--el-color-primary)}.asset-label{min-width:0;flex:1}.asset-label strong,.asset-label small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.asset-label strong{font-size:var(--text-sm);font-weight:var(--font-semibold)}.asset-label small{font-size:var(--text-xs);color:var(--el-text-color-secondary);margin-top:var(--manager-label-gap)}.asset-row>svg{flex-shrink:0;color:var(--el-text-color-secondary)}
.product-body main{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:var(--manager-module-padding);box-sizing:border-box}.product-body h2{font-size:var(--text-lg);margin:0 0 var(--manager-content-gap);font-weight:var(--font-semibold)}.product-body h3{font-size:var(--text-sm);margin:var(--manager-module-gap) 0 var(--manager-content-gap);font-weight:var(--font-semibold)}.product-body p{color:var(--el-text-color-secondary);line-height:var(--leading-sm);overflow-wrap:anywhere}.product-body :deep(.el-select){width:100%}.product-body :deep(.el-form){max-width:860px}.toolbar,.asset-meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--manager-control-gap);margin-bottom:var(--manager-content-gap)}.toolbar :deep(.el-button+.el-button){margin-inline-start:0}.child-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--manager-control-gap);padding-block:var(--manager-control-gap);border-bottom:1px solid var(--el-border-color-light)}.child-row .el-select{width:140px}.child-row span{min-width:120px;flex:1;overflow-wrap:anywhere}.text-button{border:0;background:none;color:var(--el-color-primary);cursor:pointer;padding:var(--spacing-xs);font:inherit;text-align:start;overflow-wrap:anywhere}.composition-row{display:flex;align-items:center;gap:var(--manager-content-gap);border-bottom:1px solid var(--el-border-color-light);min-height:var(--list-row-height)}.composition-row>span{color:var(--el-text-color-secondary);font-size:var(--text-xs)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:var(--text-xs);background:var(--el-fill-color-light);padding:var(--manager-content-gap);border-radius:var(--radius-sm)}details{margin-top:var(--manager-module-gap)}.empty-detail{display:grid;place-items:center}
@container ontology-manager (max-width:760px){.product-body{grid-template-columns:200px minmax(0,1fr)}.product-types{grid-template-columns:repeat(2,minmax(0,1fr))}.list-tools{padding:var(--manager-control-gap)}}
@container ontology-manager (max-width:520px){.product-body{display:flex;flex-direction:column}.product-body aside{max-height:35%;flex-shrink:0;border-inline-end:0;border-bottom:1px solid var(--el-border-color)}.list-tools{display:grid;grid-template-columns:1fr 1fr}.resource-count{display:none}.product-body main{flex:1}.product-types{grid-template-columns:1fr}}

/* Quiet group labels and inset rows follow the application's navigation rhythm. */
.asset-list{padding:0 var(--spacing-sm) var(--spacing-sm);box-sizing:border-box}
.asset-group+.asset-group{margin-top:var(--manager-control-gap);padding-top:var(--manager-control-gap);border-top:1px solid var(--el-border-color-light)}
.asset-group-title{background:transparent;border:0;padding:var(--spacing-sm);gap:var(--spacing-sm);min-height:32px;box-sizing:border-box}
.asset-group-title small{color:var(--el-text-color-placeholder)}
.asset-row{min-height:52px;padding:var(--spacing-sm);border:0;border-radius:var(--radius-sm);gap:var(--spacing-sm)}
.asset-row+.asset-row{margin-top:2px}
.asset-row.active{box-shadow:none}
.asset-label small{margin-top:2px;line-height:var(--leading-xs)}
.list-tools{padding:var(--manager-content-gap);gap:var(--spacing-sm)}
.detail-heading{align-items:flex-start;gap:var(--manager-content-gap);margin-bottom:var(--manager-content-gap)}
.product-body .detail-heading h2{margin:0 0 var(--spacing-xs);line-height:1.4}
.detail-heading .toolbar,.detail-heading .asset-meta{margin-bottom:0}
.detail-heading .toolbar{align-items:center;gap:var(--spacing-sm)}
.asset-description{margin:0 0 var(--manager-content-gap);line-height:1.6}
.product-body main>h3{margin:0 0 var(--manager-content-gap)}
.product-body main>details{margin-top:0;border-bottom:1px solid var(--el-border-color-light)}
.product-body main>.asset-relations{margin-top:var(--manager-module-gap);padding-top:0;border-top:1px solid var(--el-border-color-light)}
/* Match the Manager object-detail attribute rows: flat, neutral hover and expanded backgrounds. */
summary{display:flex;align-items:center;gap:var(--spacing-sm);min-height:var(--list-row-height);padding:var(--spacing-sm) var(--spacing-md);box-sizing:border-box;list-style:none;border-radius:0;color:var(--el-text-color-regular);font-weight:var(--font-normal);transition:background-color var(--transition-fast)}
summary::-webkit-details-marker{display:none}
summary::marker{content:''}
summary strong{font-size:var(--text-sm);font-weight:var(--font-medium)}
summary>span{margin-inline-start:auto;padding-inline-start:var(--spacing-sm);line-height:var(--leading-xs);text-align:end;color:var(--el-text-color-secondary)}
summary:hover,details[open]>summary{background:var(--el-fill-color-light)}
summary:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:-2px}
.disclosure-chevron{flex-shrink:0;color:var(--el-text-color-tertiary);transition:transform var(--transition-fast)}
details[open]>summary .disclosure-chevron{transform:rotate(90deg)}
.disclosure-content{padding:var(--spacing-sm) 0 var(--manager-content-gap);min-width:0}
.disclosure-content>h3:first-child{margin-top:0}
.product-body .reference-group h3{margin:0;padding:var(--spacing-sm) var(--spacing-md)}
.relation-content{display:flex;flex-direction:column;gap:var(--manager-content-gap)}
.relation-content>.el-alert{margin:var(--spacing-sm) var(--spacing-md);width:auto}
.disclosure-content ul{padding-inline-start:var(--spacing-lg);margin:0 0 var(--manager-content-gap)}
.disclosure-content li+li{margin-top:var(--spacing-xs)}
.disclosure-content pre{margin:0}
@media(prefers-reduced-motion:reduce){.disclosure-chevron,summary{transition:none}}

/* Each boundary owns one gap, including forms with conditional fields and composition rows. */
.product-body{line-height:var(--leading-sm)}
.list-tools{padding:var(--manager-content-gap) var(--manager-content-gap) var(--manager-control-gap)}
.asset-group-title{min-height:var(--control-height);padding-block:var(--spacing-xs);line-height:var(--leading-xs)}
.asset-group+.asset-group{margin-top:var(--manager-content-gap)}
.asset-row{min-height:var(--list-row-height);padding-block:var(--manager-control-gap)}
.asset-label strong{line-height:var(--leading-sm)}
.asset-label small{margin-top:var(--manager-label-gap)}
.detail-identity .asset-meta{gap:var(--manager-control-gap);line-height:var(--leading-xs)}
.product-body .asset-editor>h2{margin:0 0 var(--manager-content-gap)}
.asset-editor :deep(.el-form){display:flex;flex-direction:column;gap:var(--manager-content-gap)}
.asset-editor :deep(.el-form-item){margin-bottom:0}
.asset-editor :deep(.el-form-item__label){margin:0;padding-bottom:var(--manager-control-gap);line-height:var(--leading-sm)}
.asset-editor :deep(.el-form-item__content){min-height:0;line-height:var(--leading-sm)}
.asset-editor :deep(.el-form-item__content:has(.el-textarea)){align-items:flex-start}
.asset-editor :deep(.el-form-item__error){position:static;padding-top:var(--manager-label-gap)}
.asset-editor :deep(.el-form)>h3,.asset-editor :deep(.el-form)>p{margin:0}
.asset-editor :deep(.el-form)>.el-button{align-self:flex-start;margin:0}
.asset-editor :deep(.el-form)>.el-button.is-text{padding-inline:0}
.asset-editor .child-row{padding-block:0;border-bottom:0;gap:var(--manager-control-gap)}
.asset-editor .child-row :deep(.el-button+.el-button){margin-inline-start:0}
.composition-preview{display:flex;flex-direction:column;gap:var(--manager-control-gap)}
.composition-preview>p{margin:0}
.composition-row{gap:var(--manager-control-gap)}
.disclosure-content{display:flex;flex-direction:column;gap:var(--manager-control-gap);padding-top:var(--manager-content-gap)}
.disclosure-content>h3,.disclosure-content>p,.disclosure-content>ul{margin:0}
.disclosure-content>h3:not(:first-child){margin-top:var(--manager-control-gap)}
.parent-links{gap:var(--manager-control-gap)}
.parent-links .text-button{padding:0;min-height:var(--leading-sm)}
.empty-detail{display:flex;flex-direction:column;justify-content:center;align-items:center;gap:var(--manager-content-gap)}
.empty-detail :deep(.el-empty){padding:0}
@container ontology-manager (max-width:520px){.list-tools{padding:var(--manager-control-gap)}}

/* Details remain a continuous working surface; only the preview owns its content boundaries. */
.detail-heading{display:grid;grid-template-columns:minmax(180px,1fr) auto;align-items:start;gap:var(--manager-content-gap)}
.detail-identity{min-width:0}.detail-identity>div{flex:1}.detail-heading .toolbar{justify-content:flex-end;flex-shrink:0;max-width:100%}
.asset-meta>span+span::before{content:'·';margin-inline-end:var(--manager-control-gap);color:var(--el-text-color-placeholder)}
.asset-description{max-width:80ch;white-space:pre-line;overflow-wrap:anywhere}
.asset-preview{display:flex;flex-direction:column;gap:var(--manager-content-gap);min-width:0;margin-top:var(--manager-module-gap)}
.asset-description+.asset-preview{margin-top:0}
.preview-heading{display:flex;justify-content:space-between;align-items:center;gap:var(--manager-control-gap);flex-wrap:wrap;min-width:0}
.product-body .preview-heading h3{margin:0;font-size:var(--text-sm);font-weight:var(--font-semibold)}
.composition-meta{display:flex;align-items:center;flex-wrap:wrap;gap:var(--manager-control-gap);margin:0;font-size:var(--text-sm)}
.composition-meta>span{font-size:var(--text-xs);color:var(--el-text-color-secondary)}
.composition-columns{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:var(--manager-content-gap);min-width:0}
.composition-column{min-width:0;border:1px solid var(--el-border-color);border-radius:var(--radius-md);overflow:hidden;background:var(--el-bg-color)}
.composition-column h4{font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--el-text-color-secondary);margin:0;padding:var(--spacing-md);border-bottom:1px solid var(--el-border-color-light)}
.composition-item{display:flex;width:100%;min-width:0;align-items:center;gap:var(--manager-control-gap);padding:var(--spacing-md);min-height:var(--list-row-height);border:0;background:transparent;color:var(--el-text-color-primary);font:inherit;text-align:start;cursor:pointer}
.composition-item+.composition-item{border-top:1px solid var(--el-border-color-light)}.composition-item:hover{background:var(--el-fill-color-light)}
.composition-item>span{min-width:0;flex:1;overflow-wrap:anywhere}.composition-item>svg{flex-shrink:0;color:var(--el-text-color-secondary)}
.composition-item:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:-2px}.composition-item:disabled{color:var(--el-text-color-secondary);cursor:default}
.composition-empty{margin:0;padding:var(--spacing-md);font-size:var(--text-sm)}
.disclosure-content{box-sizing:border-box;max-width:100%;overflow-wrap:anywhere}.disclosure-content li{min-width:0;overflow-wrap:anywhere}
.disclosure-content pre{max-width:100%;min-width:0;max-height:480px;overflow:auto;white-space:pre;font-family:var(--font-mono);line-height:1.6}
summary>strong{min-width:0;flex-shrink:0}summary>span{min-width:0;overflow-wrap:anywhere}
.asset-editor .toolbar{display:flex;flex-wrap:wrap;gap:var(--manager-control-gap);margin:0}.asset-editor .toolbar>.el-select{width:auto;flex:1 1 200px;min-width:0}
@container ontology-manager (max-width:900px){.detail-heading{grid-template-columns:minmax(0,1fr)}.detail-heading .toolbar{justify-content:flex-start}.composition-columns{grid-template-columns:minmax(0,1fr)}}
@container ontology-manager (max-width:520px){.preview-heading>.el-button{max-width:100%;white-space:normal;height:auto;min-height:var(--control-height)}summary{flex-wrap:wrap;row-gap:var(--spacing-xs)}summary>span{flex-basis:100%;padding-inline-start:24px;text-align:start}.asset-editor .child-row .el-select{flex:1 1 120px}}
.product-body>main{max-width:100%;margin:0 auto}.product-body>main.asset-editor{max-width:none;padding-inline:var(--page-gutter)}
.asset-editor :deep(.el-form){max-width:880px;gap:var(--manager-module-gap)}
.asset-editor :deep(.el-form-item__content){gap:var(--manager-control-gap);min-width:0}
.asset-editor :deep(.el-form-item__content>.el-select){max-width:100%}
.asset-editor :deep(.el-form-item__content:has(>.el-input-number)>.el-select){width:220px;flex:1 1 200px}
.asset-editor :deep(.el-checkbox){margin-inline-end:var(--manager-control-gap);height:auto;min-height:var(--control-height);white-space:normal}
.asset-editor :deep(.el-checkbox__label){white-space:normal;line-height:var(--leading-sm)}
.asset-editor .child-row{padding:var(--spacing-md);border:1px solid var(--el-border-color-light);border-radius:var(--radius-sm)}
.asset-editor .child-row>.el-select:first-child{flex:1 1 240px;min-width:0}
.navigation-node{padding:var(--manager-content-gap);border:1px solid var(--el-border-color-light);border-radius:var(--radius-md)}
.navigation-node>header{display:flex;justify-content:space-between;align-items:center;gap:var(--spacing-sm);margin-bottom:var(--manager-content-gap)}
.node-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--manager-content-gap)}
.grant-row{display:flex;align-items:center;justify-content:space-between;gap:var(--spacing-md);padding:var(--spacing-sm) var(--spacing-md);border-bottom:1px solid var(--el-border-color-lighter)}
.grant-row>span{min-width:0;overflow-wrap:anywhere}.grant-row>.el-button{flex-shrink:0}
.grant-form{display:grid;grid-template-columns:120px minmax(160px,1fr) 120px auto;gap:var(--manager-control-gap);padding:var(--spacing-md)}
.domain-grants{display:flex;flex-wrap:wrap;gap:var(--manager-control-gap);padding:0 var(--spacing-md) var(--spacing-sm)}
.domain-grants :deep(.el-button+.el-button){margin-inline-start:0}
.profile-releases>div{display:flex;align-items:center;justify-content:space-between;gap:var(--manager-content-gap);padding:var(--spacing-sm) var(--spacing-md);border-bottom:1px solid var(--el-border-color-lighter);flex-wrap:wrap}
.profile-releases time{font-size:var(--text-sm);font-variant-numeric:tabular-nums}.profile-releases :deep(.el-button){margin:0}
.asset-preview{margin:var(--manager-content-gap) 0 var(--manager-module-gap)}
.asset-preview :deep(.collection-projection>h3),.asset-preview :deep(.object-projection>header){display:none}
.product-body main>.asset-relations{margin-top:0;border-top:0}
.product-catalog>.el-alert{margin:var(--spacing-sm) var(--page-gutter);width:auto}
@container ontology-manager (max-width:600px){.grant-form{grid-template-columns:120px minmax(0,1fr)}.node-fields{grid-template-columns:minmax(0,1fr)}.asset-editor .child-row{align-items:flex-start}.asset-editor .child-row>span{flex-basis:100%}.product-title-divider{display:none}.product-catalog :deep(.page-description){display:none}.product-catalog :deep(.header-text){flex-wrap:wrap}.product-catalog :deep(.header-leading){min-width:0}.product-catalog :deep(.page-actions){width:100%}.asset-editor :deep(.el-input-number){max-width:100%}}
</style>
