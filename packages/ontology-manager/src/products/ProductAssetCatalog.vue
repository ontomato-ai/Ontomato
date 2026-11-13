<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
import { ArrowLeft, Plus, RefreshCw, ChevronRight, MoreHorizontal, AppWindow, FileText, PanelsTopLeft, Puzzle, SlidersHorizontal, Gauge, ContactRound, Layers } from "lucide-vue-next";
import { randomId } from "@ontomato/contracts/random-id";
import { ElMessageBox } from "element-plus";
import { productAssetInputSchema, productTypes, productWidgets, type ProductAsset, type ProductDocument } from "@ontomato/contracts/product-assets";
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import { createViewWidget } from "@ontomato/contracts/object-views";
import { useManagerClient, useManagerContext, useManagerCounts } from "../context";
import ProductAssetRuntime from "./ProductAssetRuntime.vue";
import ProductAssetConfiguration from './ProductAssetConfiguration.vue';
const client = useManagerClient();
const managerCounts=useManagerCounts();
const managerContext=useManagerContext();
const props=defineProps<{assetId?:string;createKind?:string}>();
const emit=defineEmits<{select:[id:string];home:[];open:[id:string];back:[]}>();
const assets = ref<ProductAsset[]>([]), selected = ref<ProductAsset|null>(null);
const error = ref(""), busy = ref(false), editing = ref(false), showTypes=ref(false);
const capabilities=ref<{id?:string;name:string;status?:string}[]>([]);
const classes=ref<{className:string;showName?:string}[]>([]);
const name = ref(""), description = ref(""), visibility = ref<"private"|"domain">("private");
const document = ref<ProductDocument>({kind:"page",workspace:defaultPersonalWorkspace(),children:[]});
const advanced = ref(false), raw = ref("");
const metricId = ref(""), valueField = ref(""), labelField=ref(""), parameters = ref("{}");
const childId = ref(""), childColumn = ref<"main"|"sidebar">("main");
const childOptions=ref<{id:string;name:string}[]>([]);
async function searchChildren(search=''){try{const result=await client.products.query({search,pageSize:50});childOptions.value=result.items.filter(asset=>['workspace-block','widget','widget-group','operation-panel','dashboard','object-view',...(document.value.kind==='application'?['page']:[])].includes(asset.kind)&&asset.id!==selected.value?.id);}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}}
const widgetIndex=ref(0);
const editorWidgets=computed(()=>productWidgets(document.value));
const typeIcons={application:AppWindow,page:FileText,dashboard:Gauge,'object-view':ContactRound,widget:Puzzle,'widget-group':Layers,'operation-panel':SlidersHorizontal,'layout-template':PanelsTopLeft,'workspace-block':PanelsTopLeft};
const references = computed(() => expandedReferences.value);
const parentAssets=ref<{id:string;name:string}[]>([]);
const expandedReferences=ref<import('@ontomato/contracts/product-assets').ProductReference[]>([]);
const dependencyLoading=ref(false),dependencyError=ref(''),dependencyLoaded=ref(false);
const dependencyNames=ref<Record<string,string>>({});
const referenceLabels={asset:'产品资产',metric:'指标能力',action:'操作能力',dashboard:'仪表盘',application:'应用入口','object-view':'对象视图'};
const referenceGroups=computed(()=>Object.entries(referenceLabels).map(([kind,label])=>({kind,label,items:references.value.filter(reference=>reference.kind===kind)})).filter(group=>group.items.length));
function referenceName(reference:import('@ontomato/contracts/product-assets').ProductReference){return dependencyNames.value[`${reference.kind}:${reference.id}`]??assets.value.find(asset=>asset.id===reference.id)?.name??capabilities.value.find(capability=>capability.id===reference.id)?.name??reference.id;}
async function resolveDependencyNames(id:string,references:import('@ontomato/contracts/product-assets').ProductReference[]){
  const names=await Promise.all(references.map(async reference=>{
    try{
      if(reference.kind==='asset')return [`asset:${reference.id}`,(await client.products.get(reference.id)).name];
      if(reference.kind==='metric'||reference.kind==='action'){
        const result=await client.requestSmartAsset(reference.kind==='metric'?'metrics':'actions','queryById',{id:reference.id});
        if(result.data?.name)return [`${reference.kind}:${reference.id}`,String(result.data.name)];
      }
      if(reference.kind==='application'){
        const application=await client.dataEngine.get(`/platform/applications/${encodeURIComponent(reference.id)}`) as {names?:Record<string,string>};
        const names=application?.names;
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
  if(reference.kind==='application')return `#/applications/${id}`;
  if(reference.kind==='dashboard')return `#/dashboards?dashboardId=${id}`;
  return undefined;
}
watch(()=>selected.value,()=>{
  expandedReferences.value=[];
  dependencyNames.value={};
  dependencyLoaded.value=false;dependencyLoading.value=false;dependencyError.value='';
   parentAssets.value=[];
});
const usedBy = computed(() => parentAssets.value);
async function loadDependencies(event:Event){const target=event.target as HTMLDetailsElement;if(!target.classList.contains('asset-relations')||!target.open||!selected.value||dependencyLoaded.value||dependencyLoading.value)return;const id=selected.value.id;dependencyLoading.value=true;dependencyError.value='';try{const result=await client.products.dependencies(id);if(selected.value?.id===id){expandedReferences.value=result.references;parentAssets.value=result.usedBy;dependencyLoaded.value=true;void resolveDependencyNames(id,result.references);}}catch(reason){if(selected.value?.id===id)dependencyError.value=reason instanceof Error?reason.message:String(reason);}finally{if(selected.value?.id===id)dependencyLoading.value=false;}}
const children = computed(() => "children" in document.value ? document.value.children : []);
const candidates = computed(() => childOptions.value);
const widget=computed(()=>editorWidgets.value[widgetIndex.value]);
function updatePlatformResources(value:string){try{if(document.value.kind==='widget'&&document.value.widget.kind==='platform')document.value.widget.workspace=JSON.parse(value);}catch{error.value='资源选择 JSON 无效';}}
const headerTitle=computed(()=>editing.value?`${selected.value?'编辑':'创建'}${typeName(document.value.kind)}`:'产品资产');
const previewTitle=computed(()=>selected.value&&['application','dashboard'].includes(selected.value.document.kind)?'打开入口':selected.value&&['page','layout-template'].includes(selected.value.document.kind)?'页面组合':'运行预览');
const compositionColumns=computed(()=>selected.value&&'children' in selected.value.document?(['main','sidebar'] as const).map(column=>({column,label:column==='main'?'主栏':'侧栏',children:selected.value&&'children' in selected.value.document?selected.value.document.children.filter(child=>child.column===column):[]})):[]);
const layoutLabel=(layout:string)=>({data:'数据优先',tasks:'任务优先',assistant:'应用优先'}[layout]??layout);
const headerActions=computed(()=>[{id:'refresh',label:'刷新',icon:RefreshCw,disabled:busy.value||editing.value,onClick:()=>void run(load)}]);
const typeName = (value:string) => productTypes.find(type => type.kind === value)?.name ?? value;
async function run(action:()=>Promise<void>) { if(busy.value)return; busy.value=true;error.value="";try{await action();}catch(e){if(e!=="cancel"&&e!=="close")error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;} }
async function load() {
  const id=selected.value?.id??props.assetId;
  if(!id)return;
  selected.value=await client.products.get(id);
  const children='children' in selected.value.document?selected.value.document.children:[];
  assets.value=await Promise.all(children.map(child=>client.products.get(child.assetId)));
}
onMounted(()=>{if(props.createKind)void createAsset(props.createKind);else void run(load);});
watch(()=>props.assetId,id=>{if(!editing.value&&id!==selected.value?.id){selected.value=null;void run(load);}});
watch(()=>widget.value?.kind,async value=>{
  if(!value)return;
  try{capabilities.value=await client.loadSmartAssets(value==='action'?'actions':'metrics');}catch{capabilities.value=[];}
});
function select(asset:{id:string}|undefined) { if(!asset)return;editing.value=false;emit('select',asset.id); }
function more(command:string){if(command==='copy')void copy();else if(command==='template')void saveTemplate();else if(command==='delete')void remove();else showTypes.value=!showTypes.value;}
async function createPage(){if(!selected.value)return;await run(async()=>{const source=selected.value!;const result=await ElMessageBox.prompt('页面名称','使用模板创建页面',{inputValue:source.name+' · 页面'});selected.value=await client.products.createPage(source.id,result.value);await load();emit('select',selected.value!.id);});}
async function createAsset(value:string){if(value!=='dashboard'){edit(null,value);return;}await run(async()=>{const result=await ElMessageBox.prompt('仪表盘名称','创建仪表盘');selected.value=await client.products.createDashboard(result.value);await load();emit('select',selected.value!.id);});}
function edit(asset:ProductAsset|null,newKind="page") {
  widgetIndex.value=0;
  selected.value=asset;name.value=asset?.name ?? ""; description.value=asset?.description ?? "";visibility.value=asset?.visibility ?? "private";
  const defaults:Record<string,ProductDocument>={
    page:{kind:"page",workspace:defaultPersonalWorkspace(),children:[]},
    "layout-template":{kind:"layout-template",workspace:defaultPersonalWorkspace(),children:[]},
    widget:{kind:"widget",widget:createViewWidget("metric")},
    "operation-panel":{kind:"operation-panel",widgets:[createViewWidget("action")]},
    "widget-group":{kind:"widget-group",widgets:[createViewWidget("metric")]},
    dashboard:{kind:"dashboard",dashboardId:""},
    "object-view":{kind:"object-view",className:"",form:"full"},
    application:{kind:"application",applicationId:"",children:[]},
  };
  document.value=JSON.parse(JSON.stringify(asset?.document ?? defaults[newKind]!));
  raw.value=JSON.stringify(document.value,null,2);advanced.value=false;
  const widget=productWidgets(document.value)[0];
  metricId.value=widget?.resourceId ?? "";valueField.value=widget?.valueField ?? "";
  labelField.value=widget?.labelField ?? "";
  parameters.value=JSON.stringify(widget?.parameters ?? {},null,2);
  editing.value=true;
  if('children' in document.value)void searchChildren();
  if(document.value.kind==='object-view')void client.loadOntology().then(ontology=>{classes.value=ontology.objects;}).catch(()=>{});
}
function toggleAdvanced() {
  if(advanced.value){try{document.value=JSON.parse(raw.value);}catch{error.value="配置 JSON 无效";return;}}
  else {
    applyWidgetFields();
    raw.value=JSON.stringify(document.value,null,2);
  }
  advanced.value=!advanced.value;
  if(!advanced.value)readWidgetFields();
}
function readWidgetFields(){
  const widget=editorWidgets.value[widgetIndex.value];
  metricId.value=widget?.resourceId??'';valueField.value=widget?.valueField??'';labelField.value=widget?.labelField??'';parameters.value=JSON.stringify(widget?.parameters??{},null,2);
}
function applyWidgetFields(){
  const item=widget.value;
  if(item){item.resourceId=metricId.value;item.valueField=valueField.value;item.labelField=labelField.value;item.parameters=JSON.parse(parameters.value);}
}
function chooseWidget(index:number){try{applyWidgetFields();widgetIndex.value=index;readWidgetFields();}catch{error.value='请先修正当前组件的参数 JSON';}}
function addWidget(){if(!('widgets' in document.value))return;try{applyWidgetFields();document.value.widgets.push(createViewWidget(document.value.kind==='operation-panel'?'action':'metric'));widgetIndex.value=document.value.widgets.length-1;readWidgetFields();}catch{error.value='请先修正参数 JSON';}}
function removeWidget(){if(!('widgets' in document.value))return;document.value.widgets.splice(widgetIndex.value,1);widgetIndex.value=0;readWidgetFields();}
async function addChild() { if(childId.value && "children" in document.value && !children.value.some(child=>child.assetId===childId.value)){try{const asset=await client.products.get(childId.value);assets.value.push(asset);document.value.children.push({assetId:childId.value,column:childColumn.value});}catch(reason){error.value=reason instanceof Error?reason.message:String(reason);}} }
async function save() { await run(async()=>{
  if(advanced.value) document.value=JSON.parse(raw.value);
  else applyWidgetFields();
  if(document.value.kind==='object-view'&&!document.value.primaryKey?.trim())delete document.value.primaryKey;
  const input=productAssetInputSchema.parse({name:name.value,description:description.value,visibility:visibility.value,document:document.value});
  const saved=await client.products.save(selected.value?.id ?? randomId(),input,selected.value?.revision ?? 0);
  selected.value=saved;editing.value=false;await load();
  emit('select',saved.id);
  void managerCounts.refresh();
}); }
async function saveTemplate(){if(!selected.value||selected.value.document.kind!=='page')return;await run(async()=>{
  const result=await ElMessageBox.prompt('模板名称','保存为布局模板',{inputValue:selected.value!.name+' · 模板'});
  const source=selected.value!;
  if(source.document.kind!=='page')return;
  selected.value=await client.products.save(randomId(),{name:result.value,description:source.description,visibility:'private',document:{...source.document,kind:'layout-template'}},0);await load();
});}
async function copy() { if(!selected.value)return;await run(async()=>{const result=await ElMessageBox.prompt("新资产名称","复制资产",{inputValue:selected.value!.name+" · 副本"});selected.value=await client.products.copy(selected.value!.id,result.value);await load();}); }
async function useHome() { if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm("将此布局复制到我的主页，替换当前主页配置。共享组件继续按引用使用。","应用模板");const home=await client.products.home();await client.products.useHome(selected.value!.id,home.revision);emit('home');}); }
async function remove() { if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm("删除这个产品资产？","删除资产");await client.products.delete(selected.value!.id,selected.value!.revision);selected.value=null;void managerCounts.refresh();emit('back');}); }
</script>
<template>
  <section class="product-catalog">
    <PlatformPageHeader :title="headerTitle" description="选择视图与能力，组合页面和应用" :actions="headerActions">
      <template #leading><el-button text :icon="ArrowLeft" @click="emit('back')">返回资产目录</el-button><span class="product-title-divider" aria-hidden="true"/></template>
      <template #actions>
        <el-button v-if="editing" :disabled="busy" @click="editing=false">取消</el-button><el-button v-if="editing" type="primary" :loading="busy" @click="save">保存</el-button>
         <template v-else><el-dropdown placement="bottom-end" :popper-options="dropdownBoundaryOptions" :disabled="busy" @command="createAsset"><el-button type="primary" :icon="Plus">创建资产</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item v-for="type in productTypes" :key="type.kind" :command="type.kind">{{ type.name }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template>
      </template>
    </PlatformPageHeader>
    <div v-if="error" class="product-alert"><el-alert :title="error" type="error" :closable="false" /></div>
    <div v-if="showTypes" class="product-types"><article v-for="type in productTypes" :key="type.kind"><strong>{{type.name}}</strong><span>{{type.description}}</span></article></div>
    <div class="product-body" @toggle.capture="loadDependencies">
      <main v-if="editing" class="asset-editor">
        <h2>基本信息</h2>
        <el-form label-position="top" :disabled="busy"><el-form-item label="名称"><el-input v-model="name"/></el-form-item><el-form-item label="说明"><el-input v-model="description" type="textarea"/></el-form-item><el-form-item label="可见范围"><el-select v-model="visibility"><el-option value="private" label="仅自己"/><el-option value="domain" label="域内共享（使用者仍按自己的权限访问数据）"/></el-select></el-form-item>
          <template v-if="!advanced">
            <el-form-item v-if="document.kind==='widget'" label="组件实现"><el-select :model-value="document.widget.kind==='platform'?'platform':'capability'" @change="document={kind:'widget',widget:$event==='platform'?{kind:'platform',source:'assistant',placeholder:'',limit:4}:createViewWidget('metric')}"><el-option value="capability" label="能力展示与操作"/><el-option value="platform" label="平台交互"/></el-select></el-form-item>
            <template v-if="document.kind==='widget'&&document.widget.kind==='platform'"><el-form-item label="内容来源"><el-select v-model="document.widget.source"><el-option v-for="(label,key) in {assistant:'智能问数',apps:'应用与智能体入口',data:'仪表盘集合',tasks:'任务动态',conversations:'分析会话',objects:'收藏对象',recent:'最近访问'}" :key="key" :value="key" :label="label"/></el-select></el-form-item><el-form-item v-if="document.widget.source==='assistant'" label="输入提示"><el-input v-model="document.widget.placeholder"/></el-form-item><el-form-item label="展示条数"><el-input-number v-model="document.widget.limit" :min="1" :max="20"/></el-form-item><el-form-item label="资源选择（JSON）"><el-input :model-value="JSON.stringify(document.widget.workspace??{},null,2)" type="textarea" :rows="5" @change="updatePlatformResources"/></el-form-item></template>
           <template v-if="'widgets' in document"><h3>组合内容</h3><div class="toolbar"><el-select :model-value="widgetIndex" aria-label="编辑组合内组件" @change="chooseWidget"><el-option v-for="(item,index) in editorWidgets" :key="item.id" :value="index" :label="item.title||`组件 ${index+1}`"/></el-select><el-button @click="addWidget">添加组件</el-button><el-button :disabled="editorWidgets.length<=1" @click="removeWidget">移除</el-button></div></template>
           <el-form-item v-if="widget" label="组件标题"><el-input v-model="widget.title"/></el-form-item>
           <template v-if="widget"><el-form-item label="组件类型"><el-select v-model="widget.kind"><el-option v-for="value in (document.kind==='widget-group'?['metric','table','chart','text']:['metric','table','chart','text','action'])" :key="value" :value="value" :label="({metric:'指标卡',table:'表格',chart:'图表',text:'文字',action:'操作入口'} as Record<string,string>)[value]"/></el-select></el-form-item><el-form-item v-if="widget.kind==='text'" label="文字"><el-input v-model="widget.text" type="textarea"/></el-form-item></template>
            <template v-if="widget&&widget.kind!=='text'"><el-form-item label="已发布能力"><el-select v-model="metricId" filterable allow-create default-first-option placeholder="选择已发布指标或操作"><el-option v-for="capability in capabilities.filter(item=>item.status==='PUBLISHED'&&item.id)" :key="capability.id" :value="capability.id!" :label="capability.name"/></el-select></el-form-item><el-form-item v-if="widget && ['metric','chart','table'].includes(widget.kind)" label="数值字段"><el-input v-model="valueField"/></el-form-item><template v-if="widget?.kind==='chart'"><el-form-item label="图表样式"><el-select v-model="widget.chartType"><el-option value="bar" label="柱状图"/><el-option value="donut" label="环形图"/><el-option value="line" label="折线图"/></el-select></el-form-item><el-form-item label="标签字段"><el-input v-model="labelField"/></el-form-item></template><el-form-item label="参数绑定（literal / variable）"><el-input v-model="parameters" type="textarea" :rows="4"/></el-form-item></template>
           <template v-if="document.kind==='object-view'"><el-form-item label="使用已发布视图的对象类"><el-select v-model="document.className" filterable allow-create default-first-option><el-option v-for="item in classes" :key="item.className" :value="item.className" :label="item.showName||item.className"/></el-select></el-form-item><el-form-item label="默认对象主键（可选）"><el-input v-model="document.primaryKey" clearable placeholder="留空时运行页面选择对象" @clear="delete (document as Extract<ProductDocument,{kind:'object-view'}>).primaryKey"/></el-form-item><p>引用类上已有的视图定义。对象选择与视图定义独立，不复制对象内容。</p></template>
          <template v-if="document.kind==='page'||document.kind==='layout-template'"><el-form-item label="布局重点"><el-select v-model="document.workspace.layout"><el-option value="data" label="数据优先"/><el-option value="tasks" label="任务优先"/><el-option value="assistant" label="应用优先"/></el-select></el-form-item><p>个人主页的资源选择、区块排序与打开方式也可在主页中手动调整。</p></template>
          <el-form-item v-if="document.kind==='dashboard'" label="现有仪表盘 ID"><el-input v-model="document.dashboardId"/></el-form-item>
          <el-form-item v-if="document.kind==='application'" label="平台应用 ID"><el-input v-model="document.applicationId"/></el-form-item>
           <template v-if="'children' in document"><h3>组合组件</h3><div v-for="(child,index) in children" :key="child.assetId" class="child-row"><span>{{assets.find(asset=>asset.id===child.assetId)?.name ?? child.assetId}}</span><el-select v-model="child.column"><el-option value="main" label="主栏"/><el-option value="sidebar" label="侧栏"/></el-select><el-button :disabled="index===0" @click="children.splice(index-1,0,...children.splice(index,1))">上移</el-button><el-button @click="children.splice(index,1)">移除</el-button></div><div class="child-row"><el-select v-model="childId" filterable remote :remote-method="searchChildren" placeholder="搜索可复用组件"><el-option v-for="asset in candidates" :key="asset.id" :label="asset.name" :value="asset.id"/></el-select><el-select v-model="childColumn"><el-option value="main" label="主栏"/><el-option value="sidebar" label="侧栏"/></el-select><el-button @click="addChild">添加</el-button></div></template>
        </template>
        <el-button text @click="toggleAdvanced">{{advanced?'返回表单':'编辑完整配置 JSON'}}</el-button><el-input v-if="advanced" v-model="raw" type="textarea" :rows="22" spellcheck="false"/>
         </el-form>
      </main>
      <main v-else-if="selected" :key="selected.id"><header class="detail-heading"><div class="detail-identity"><component :is="typeIcons[selected.document.kind]" :size="22" class="detail-type-icon" aria-hidden="true"/><div><h2>{{selected.name}}</h2><div class="asset-meta"><span>{{typeName(selected.document.kind)}}</span><span>{{selected.visibility==='domain'?'域内共享':'仅自己'}}</span></div></div></div><div class="toolbar"><el-button v-if="selected.editable" @click="edit(selected)">编辑</el-button><el-button v-if="['page','layout-template'].includes(selected.document.kind)" @click="useHome">用作主页</el-button><el-button v-if="selected.document.kind==='page'" type="primary" @click="emit('open',selected.id)">打开页面</el-button><el-dropdown @command="more"><el-button text :icon="MoreHorizontal" aria-label="更多资产操作"/><template #dropdown><el-dropdown-menu><el-dropdown-item command="copy">复制</el-dropdown-item><el-dropdown-item v-if="selected.document.kind==='page'" command="template">保存为模板</el-dropdown-item><el-dropdown-item v-if="selected.editable" command="delete" divided>删除</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></header><p v-if="selected.description" class="asset-description">{{selected.description}}</p>
      <section class="asset-preview" :aria-label="previewTitle">
        <header class="preview-heading"><h3>{{previewTitle}}</h3><el-button v-if="selected.document.kind==='layout-template'" type="primary" :disabled="busy" @click="createPage">使用模板创建页面</el-button></header>
        <ProductAssetRuntime v-if="['widget','widget-group','operation-panel','dashboard','application','object-view'].includes(selected.document.kind)" :asset="selected" preview/>
        <div v-else class="composition-preview"><p v-if="'workspace' in selected.document" class="composition-meta">{{layoutLabel(selected.document.workspace.layout)}}<span>{{'children' in selected.document?selected.document.children.length:0}} 个组件</span></p><div v-if="'children' in selected.document&&selected.document.children.length" class="composition-columns"><section v-for="column in compositionColumns" :key="column.column" class="composition-column"><h4>{{column.label}}</h4><button v-for="child in column.children" :key="child.assetId" class="composition-item" :disabled="!assets.some(asset=>asset.id===child.assetId)" @click="select(assets.find(asset=>asset.id===child.assetId)!)"><component :is="typeIcons[assets.find(asset=>asset.id===child.assetId)?.document.kind??'widget']" :size="16" aria-hidden="true"/><span>{{assets.find(asset=>asset.id===child.assetId)?.name??'组件不可用'}}</span><ChevronRight :size="14" aria-hidden="true"/></button><p v-if="!column.children.length" class="composition-empty">未放置额外组件</p></section></div><p v-else class="composition-empty">暂无额外组件，可通过编辑添加。</p></div>
      </section>
      <details class="asset-relations"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>引用关系</strong><span>{{dependencyLoading?'正在加载…':dependencyLoaded?`${references.length} 项引用 · ${usedBy.length} 处使用`:'展开查看依赖与使用者'}}</span></summary>
        <div class="disclosure-content relation-content" :aria-busy="dependencyLoading">
          <p v-if="dependencyLoading" role="status">正在加载引用关系…</p>
          <el-alert v-else-if="dependencyError" :title="dependencyError" type="error" :closable="false"/>
          <template v-else-if="dependencyLoaded">
            <section v-for="group in referenceGroups" :key="group.kind" class="reference-group"><h3>{{group.label}}<span>{{group.items.length}}</span></h3>
              <div v-for="dependency in group.items" :key="dependency.id" class="reference-row">
                <button v-if="dependency.kind==='asset'" class="reference-link" @click="select({id:dependency.id})">{{referenceName(dependency)}}<ChevronRight :size="14"/></button>
                <a v-else-if="referenceHref(dependency)" class="reference-link" :href="referenceHref(dependency)">{{referenceName(dependency)}}<ChevronRight :size="14"/></a>
                <span v-else class="reference-value">{{referenceName(dependency)}}</span>
                <code v-if="referenceName(dependency)!==dependency.id">{{dependency.id}}</code>
              </div>
            </section>
            <p v-if="!references.length" class="relation-empty">暂无引用</p>
            <section class="reference-group"><h3>使用此资产<span>{{usedBy.length}}</span></h3><div v-for="parent in usedBy" :key="parent.id" class="reference-row"><button class="reference-link" @click="select(parent)">{{parent.name}}<ChevronRight :size="14"/></button><code>{{parent.id}}</code></div><p v-if="!usedBy.length" class="relation-empty">暂无其他可见资产引用</p></section>
          </template>
        </div>
      </details>
      <details class="asset-configuration"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>配置详情</strong><span>修订 {{selected.revision}}</span></summary><div class="disclosure-content"><ProductAssetConfiguration :asset="selected"/></div></details></main>
      <main v-else class="empty-detail"><el-empty description="选择资产查看预览、配置和引用关系" :image-size="64"/><el-button text @click="showTypes=!showTypes">查看类型说明</el-button></main>
    </div>
  </section>
</template>
<style scoped>
.product-title-divider{width:1px;height:20px;background:var(--el-border-color);margin-inline:var(--spacing-sm)}
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
.asset-editor :deep(.el-form)>.el-button{align-self:flex-start;margin:0;padding-inline:0}
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
</style>
