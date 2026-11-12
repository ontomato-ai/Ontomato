<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { Plus, RefreshCw, ChevronRight, MoreHorizontal, AppWindow, FileText, PanelsTopLeft, Puzzle, SlidersHorizontal, Gauge, ContactRound, Layers } from "lucide-vue-next";
import { randomId } from "@ontomato/contracts/random-id";
import { ElMessageBox } from "element-plus";
import { productAssetInputSchema, productTypes, productWidgets, type ProductAsset, type ProductDocument } from "@ontomato/contracts/product-assets";
import { defaultPersonalWorkspace } from "@ontomato/contracts/personal-workspace";
import {productDependencies} from '@ontomato/contracts/product-dependencies';
import { createViewWidget } from "@ontomato/contracts/object-views";
import { useManagerClient } from "../context";
import ProductAssetRuntime from "./ProductAssetRuntime.vue";
const client = useManagerClient();
const props=defineProps<{assetId?:string}>();
const emit=defineEmits<{select:[id:string];home:[];open:[id:string]}>();
const assets = ref<ProductAsset[]>([]), selected = ref<ProductAsset|null>(null);
const kind = ref(""), search = ref(""), error = ref(""), busy = ref(false), editing = ref(false), showTypes=ref(false);
const capabilities=ref<{id?:string;name:string;status?:string}[]>([]);
const classes=ref<{className:string;showName?:string}[]>([]);
const name = ref(""), description = ref(""), visibility = ref<"private"|"domain">("private");
const document = ref<ProductDocument>({kind:"page",workspace:defaultPersonalWorkspace(),children:[]});
const advanced = ref(false), raw = ref("");
const metricId = ref(""), valueField = ref(""), labelField=ref(""), parameters = ref("{}");
const childId = ref(""), childColumn = ref<"main"|"sidebar">("main");
const widgetIndex=ref(0);
const editorWidgets=computed(()=>productWidgets(document.value));
const filtered = computed(() => assets.value.filter(asset => (!kind.value || asset.document.kind === kind.value) && asset.name.toLowerCase().includes(search.value.toLowerCase())));
const typeOrder=['application','page','dashboard','object-view','widget','widget-group','operation-panel','layout-template'] as const;
const typeIcons={application:AppWindow,page:FileText,dashboard:Gauge,'object-view':ContactRound,widget:Puzzle,'widget-group':Layers,'operation-panel':SlidersHorizontal,'layout-template':PanelsTopLeft};
const categories=computed(()=>typeOrder.map(value=>({kind:value,name:typeName(value),icon:typeIcons[value],count:assets.value.filter(asset=>asset.document.kind===value).length})));
const groups=computed(()=>categories.value.map(category=>({...category,items:filtered.value.filter(asset=>asset.document.kind===category.kind)})).filter(group=>group.items.length));
const dependencies=computed(()=>selected.value?productDependencies(selected.value,assets.value):{references:[],usedBy:[]});
const references = computed(() => expandedReferences.value.length?expandedReferences.value:dependencies.value.references);
const expandedReferences=ref<import('@ontomato/contracts/product-assets').ProductReference[]>([]);
watch(()=>selected.value,async asset=>{
  expandedReferences.value=[];
  if(!asset)return;
  try{const result=await client.products.dependencies(asset.id);if(selected.value?.id===asset.id)expandedReferences.value=result.references;}
  catch(reason){if(selected.value?.id===asset.id)error.value=reason instanceof Error?reason.message:String(reason);}
});
const usedBy = computed(() => assets.value.filter(asset=>dependencies.value.usedBy.some(parent=>parent.id===asset.id)));
const children = computed(() => "children" in document.value ? document.value.children : []);
const candidates = computed(() => assets.value.filter(asset => ["widget","widget-group","operation-panel","dashboard","object-view",...(document.value.kind==='application'?['page']:[])].includes(asset.document.kind) && asset.id !== selected.value?.id));
const widget=computed(()=>editorWidgets.value[widgetIndex.value]);
const headerTitle=computed(()=>editing.value?`${selected.value?'编辑':'创建'}${typeName(document.value.kind)}`:'产品资产');
const previewTitle=computed(()=>selected.value&&['application','dashboard'].includes(selected.value.document.kind)?'打开入口':selected.value&&['page','layout-template'].includes(selected.value.document.kind)?'页面组合':'运行预览');
const headerActions=computed(()=>[{id:'refresh',label:'刷新',icon:RefreshCw,disabled:busy.value||editing.value,onClick:()=>void run(load)}]);
const typeName = (value:string) => productTypes.find(type => type.kind === value)?.name ?? value;
async function run(action:()=>Promise<void>) { if(busy.value)return; busy.value=true;error.value="";try{await action();}catch(e){if(e!=="cancel"&&e!=="close")error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;} }
async function load() {
  assets.value=await client.products.list();
  const id = selected.value?.id ?? props.assetId;
  selected.value=assets.value.find(asset=>asset.id===id) ?? filtered.value[0] ?? null;
}
onMounted(()=>void run(load));
watch(()=>props.assetId,id=>{if(!editing.value)selected.value=assets.value.find(asset=>asset.id===id)??null;});
watch(()=>widget.value?.kind,async value=>{
  if(!value)return;
  try{capabilities.value=await client.loadSmartAssets(value==='action'?'actions':'metrics');}catch{capabilities.value=[];}
});
function select(asset:ProductAsset) { if(!asset)return;selected.value=asset;editing.value=false;emit('select',asset.id); }
watch([kind,search],()=>{if(!editing.value&&selected.value&&!filtered.value.some(asset=>asset.id===selected.value!.id))selected.value=filtered.value[0]??null;});
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
function addChild() { if(childId.value && "children" in document.value && !children.value.some(child=>child.assetId===childId.value)) document.value.children.push({assetId:childId.value,column:childColumn.value}); }
async function save() { await run(async()=>{
  if(advanced.value) document.value=JSON.parse(raw.value);
  else applyWidgetFields();
  if(document.value.kind==='object-view'&&!document.value.primaryKey?.trim())delete document.value.primaryKey;
  const input=productAssetInputSchema.parse({name:name.value,description:description.value,visibility:visibility.value,document:document.value});
  const saved=await client.products.save(selected.value?.id ?? randomId(),input,selected.value?.revision ?? 0);
  selected.value=saved;editing.value=false;await load();
}); }
async function saveTemplate(){if(!selected.value||selected.value.document.kind!=='page')return;await run(async()=>{
  const result=await ElMessageBox.prompt('模板名称','保存为布局模板',{inputValue:selected.value!.name+' · 模板'});
  const source=selected.value!;
  if(source.document.kind!=='page')return;
  selected.value=await client.products.save(randomId(),{name:result.value,description:source.description,visibility:'private',document:{...source.document,kind:'layout-template'}},0);await load();
});}
async function copy() { if(!selected.value)return;await run(async()=>{const result=await ElMessageBox.prompt("新资产名称","复制资产",{inputValue:selected.value!.name+" · 副本"});selected.value=await client.products.copy(selected.value!.id,result.value);await load();}); }
async function useHome() { if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm("将此布局复制到我的主页，替换当前主页配置。共享组件继续按引用使用。","应用模板");const home=await client.products.home();await client.products.useHome(selected.value!.id,home.revision);emit('home');}); }
async function remove() { if(!selected.value)return;await run(async()=>{await ElMessageBox.confirm("删除这个产品资产？","删除资产");await client.products.delete(selected.value!.id,selected.value!.revision);selected.value=null;await load();}); }
</script>
<template>
  <section class="product-catalog">
    <PlatformPageHeader :title="headerTitle" description="选择视图与能力，组合页面和应用" :actions="headerActions">
      <template #actions>
        <el-button v-if="editing" :disabled="busy" @click="editing=false">取消</el-button><el-button v-if="editing" type="primary" :loading="busy" @click="save">保存</el-button>
         <template v-else><el-dropdown :disabled="busy" @command="createAsset"><el-button type="primary" :icon="Plus">创建资产</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item v-for="type in productTypes" :key="type.kind" :command="type.kind">{{ type.name }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template>
      </template>
    </PlatformPageHeader>
    <div v-if="error" class="product-alert"><el-alert :title="error" type="error" :closable="false" /></div>
    <div v-if="showTypes" class="product-types"><article v-for="type in productTypes" :key="type.kind"><strong>{{type.name}}</strong><span>{{type.description}}</span></article></div>
    <nav class="asset-categories" aria-label="资产类型">
      <button :class="{active:!kind}" :disabled="editing" :aria-pressed="!kind" @click="kind=''">全部<span>{{assets.length}}</span></button>
      <button v-for="category in categories" :key="category.kind" :class="{active:kind===category.kind}" :disabled="editing" :aria-pressed="kind===category.kind" @click="kind=category.kind"><component :is="category.icon" :size="16" aria-hidden="true"/>{{category.name}}<span>{{category.count}}</span></button>
    </nav>
    <div class="product-body">
      <aside><div class="list-tools"><el-input v-model="search" placeholder="搜索名称" clearable aria-label="搜索产品资产"/><span class="resource-count">{{kind?typeName(kind):'全部资产'}} · {{filtered.length}}</span></div><div class="asset-list"><section v-for="group in groups" :key="group.kind" class="asset-group"><header v-if="!kind" class="asset-group-title"><component :is="group.icon" :size="15" aria-hidden="true"/><span>{{group.name}}</span><small>{{group.items.length}}</small></header><button v-for="asset in group.items" :key="asset.id" class="asset-row" :class="{active:selected?.id===asset.id}" :disabled="editing" @click="select(asset)"><span class="asset-label"><strong>{{asset.name}}</strong><small>{{asset.description || (asset.visibility==='domain'?'可在域内复用':'个人资产')}}</small></span><ChevronRight :size="14"/></button></section><el-empty v-if="!filtered.length" description="暂无匹配资产" :image-size="48"/></div></aside>
      <main v-if="editing" class="asset-editor">
        <h2>基本信息</h2>
        <el-form label-position="top" :disabled="busy"><el-form-item label="名称"><el-input v-model="name"/></el-form-item><el-form-item label="说明"><el-input v-model="description" type="textarea"/></el-form-item><el-form-item label="可见范围"><el-select v-model="visibility"><el-option value="private" label="仅自己"/><el-option value="domain" label="域内共享（使用者仍按自己的权限访问数据）"/></el-select></el-form-item>
         <template v-if="!advanced">
           <template v-if="'widgets' in document"><h3>组合内容</h3><div class="toolbar"><el-select :model-value="widgetIndex" aria-label="编辑组合内组件" @change="chooseWidget"><el-option v-for="(item,index) in editorWidgets" :key="item.id" :value="index" :label="item.title||`组件 ${index+1}`"/></el-select><el-button @click="addWidget">添加组件</el-button><el-button :disabled="editorWidgets.length<=1" @click="removeWidget">移除</el-button></div></template>
           <el-form-item v-if="widget" label="组件标题"><el-input v-model="widget.title"/></el-form-item>
           <template v-if="widget"><el-form-item label="组件类型"><el-select v-model="widget.kind"><el-option v-for="value in (document.kind==='widget-group'?['metric','table','chart','text']:['metric','table','chart','text','action'])" :key="value" :value="value" :label="({metric:'指标卡',table:'表格',chart:'图表',text:'文字',action:'操作入口'} as Record<string,string>)[value]"/></el-select></el-form-item><el-form-item v-if="widget.kind==='text'" label="文字"><el-input v-model="widget.text" type="textarea"/></el-form-item></template>
            <template v-if="widget&&widget.kind!=='text'"><el-form-item label="已发布能力"><el-select v-model="metricId" filterable allow-create default-first-option placeholder="选择已发布指标或操作"><el-option v-for="capability in capabilities.filter(item=>item.status==='PUBLISHED'&&item.id)" :key="capability.id" :value="capability.id!" :label="capability.name"/></el-select></el-form-item><el-form-item v-if="widget && ['metric','chart','table'].includes(widget.kind)" label="数值字段"><el-input v-model="valueField"/></el-form-item><template v-if="widget?.kind==='chart'"><el-form-item label="图表样式"><el-select v-model="widget.chartType"><el-option value="bar" label="柱状图"/><el-option value="donut" label="环形图"/><el-option value="line" label="折线图"/></el-select></el-form-item><el-form-item label="标签字段"><el-input v-model="labelField"/></el-form-item></template><el-form-item label="参数绑定（literal / variable）"><el-input v-model="parameters" type="textarea" :rows="4"/></el-form-item></template>
           <template v-if="document.kind==='object-view'"><el-form-item label="使用已发布视图的对象类"><el-select v-model="document.className" filterable allow-create default-first-option><el-option v-for="item in classes" :key="item.className" :value="item.className" :label="item.showName||item.className"/></el-select></el-form-item><el-form-item label="默认对象主键（可选）"><el-input v-model="document.primaryKey" clearable placeholder="留空时运行页面选择对象" @clear="delete (document as Extract<ProductDocument,{kind:'object-view'}>).primaryKey"/></el-form-item><p>引用类上已有的视图定义。对象选择与视图定义独立，不复制对象内容。</p></template>
          <template v-if="document.kind==='page'||document.kind==='layout-template'"><el-form-item label="布局重点"><el-select v-model="document.workspace.layout"><el-option value="data" label="数据优先"/><el-option value="tasks" label="任务优先"/><el-option value="assistant" label="应用优先"/></el-select></el-form-item><p>个人主页的资源选择、区块排序与打开方式也可在主页中手动调整。</p></template>
          <el-form-item v-if="document.kind==='dashboard'" label="现有仪表盘 ID"><el-input v-model="document.dashboardId"/></el-form-item>
          <el-form-item v-if="document.kind==='application'" label="平台应用 ID"><el-input v-model="document.applicationId"/></el-form-item>
          <template v-if="'children' in document"><h3>组合组件</h3><div v-for="(child,index) in children" :key="child.assetId" class="child-row"><span>{{assets.find(asset=>asset.id===child.assetId)?.name ?? child.assetId}}</span><el-select v-model="child.column"><el-option value="main" label="主栏"/><el-option value="sidebar" label="侧栏"/></el-select><el-button :disabled="index===0" @click="children.splice(index-1,0,...children.splice(index,1))">上移</el-button><el-button @click="children.splice(index,1)">移除</el-button></div><div class="child-row"><el-select v-model="childId" filterable placeholder="选择可复用组件"><el-option v-for="asset in candidates" :key="asset.id" :label="asset.name" :value="asset.id"/></el-select><el-select v-model="childColumn"><el-option value="main" label="主栏"/><el-option value="sidebar" label="侧栏"/></el-select><el-button @click="addChild">添加</el-button></div></template>
        </template>
        <el-button text @click="toggleAdvanced">{{advanced?'返回表单':'编辑完整配置 JSON'}}</el-button><el-input v-if="advanced" v-model="raw" type="textarea" :rows="22" spellcheck="false"/>
         </el-form>
      </main>
      <main v-else-if="selected" :key="selected.id"><header class="detail-heading"><div class="detail-identity"><component :is="typeIcons[selected.document.kind]" :size="22" class="detail-type-icon" aria-hidden="true"/><div><h2>{{selected.name}}</h2><div class="asset-meta"><span>{{typeName(selected.document.kind)}}</span><span>{{selected.visibility==='domain'?'域内共享':'仅自己'}}</span></div></div></div><div class="toolbar"><el-button v-if="selected.editable" @click="edit(selected)">编辑</el-button><el-button v-if="['page','layout-template'].includes(selected.document.kind)" @click="useHome">用作主页</el-button><el-button v-if="selected.document.kind==='page'" type="primary" @click="emit('open',selected.id)">打开页面</el-button><el-dropdown @command="more"><el-button text :icon="MoreHorizontal" aria-label="更多资产操作"/><template #dropdown><el-dropdown-menu><el-dropdown-item command="copy">复制</el-dropdown-item><el-dropdown-item v-if="selected.document.kind==='page'" command="template">保存为模板</el-dropdown-item><el-dropdown-item v-if="selected.editable" command="delete" divided>删除</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></header><p v-if="selected.description" class="asset-description">{{selected.description}}</p>
      <el-button v-if="selected.document.kind==='layout-template'" type="primary" @click="createPage">使用模板创建页面</el-button>
      <h3>{{previewTitle}}</h3><ProductAssetRuntime v-if="['widget','widget-group','operation-panel','dashboard','application','object-view'].includes(selected.document.kind)" :asset="selected" preview/><div v-else class="composition-preview"><p>布局：{{'workspace' in selected.document?selected.document.workspace.layout:''}}；组合组件：{{'children' in selected.document?selected.document.children.length:0}}</p><template v-if="'children' in selected.document"><div v-for="child in selected.document.children" :key="child.assetId" class="composition-row"><span>{{child.column==='main'?'主栏':'侧栏'}}</span><button class="text-button" @click="select(assets.find(asset=>asset.id===child.assetId)!)">{{assets.find(asset=>asset.id===child.assetId)?.name??child.assetId}}</button></div></template></div>
      <details class="asset-relations"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>引用关系</strong><span>{{references.length}} 项引用 · {{usedBy.length}} 处使用</span></summary><div class="disclosure-content"><h3>引用</h3><ul><li v-for="dependency in references" :key="dependency.kind+dependency.id"><button v-if="dependency.kind==='asset'" class="text-button" @click="select(assets.find(asset=>asset.id===dependency.id)!)">{{assets.find(asset=>asset.id===dependency.id)?.name ?? dependency.id}}</button><span v-else>{{dependency.kind}} · {{dependency.id}}</span></li></ul><p v-if="!references.length">暂无引用</p><h3>使用此资产</h3><div class="parent-links"><button v-for="parent in usedBy" :key="parent.id" class="text-button" @click="select(parent)">{{parent.name}}</button></div><p v-if="!usedBy.length">暂无其他可见资产引用</p></div></details><details class="asset-configuration"><summary><ChevronRight :size="16" class="disclosure-chevron" aria-hidden="true"/><strong>配置详情</strong><span>修订 {{selected.revision}}</span></summary><div class="disclosure-content"><pre>{{JSON.stringify(selected,null,2)}}</pre></div></details></main>
      <main v-else class="empty-detail"><el-empty description="选择资产查看预览、配置和引用关系" :image-size="64"/><el-button text @click="showTypes=!showTypes">查看类型说明</el-button></main>
    </div>
  </section>
</template>
<style scoped>
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
.disclosure-content{padding:var(--spacing-sm) var(--spacing-md) var(--manager-content-gap) calc(var(--spacing-md) + 16px + var(--spacing-sm));min-width:0}
.disclosure-content>h3:first-child{margin-top:0}
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
</style>
