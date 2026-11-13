<script setup lang="ts">
import { computed, ref } from 'vue';
import { CodeEditor } from '@ontomato/foundation-ui/code';
import { ChevronRight, Braces } from 'lucide-vue-next';
import { productTypes, productWidgets, type ProductAsset } from '@ontomato/contracts/product-assets';
import { useManagerContext } from '../context';

const props=defineProps<{asset:ProductAsset}>();
const context=useManagerContext();
const showJson=ref(false);
const widgets=computed(()=>productWidgets(props.asset.document));
const json=computed(()=>JSON.stringify(props.asset,null,2));
const date=(value:string)=>new Date(value).toLocaleString(context.locale);
const widgetKind=(kind:string)=>({metric:'指标卡',table:'表格',chart:'图表',text:'文字',action:'操作入口',input:'输入',button:'按钮'}[kind]??kind);
const bindings=(value:unknown)=>JSON.stringify(value,null,2);
</script>
<template>
  <div class="product-configuration">
    <dl class="configuration-fields">
      <dt>资产标识</dt><dd><code>{{asset.id}}</code></dd>
      <dt>类型</dt><dd>{{productTypes.find(type=>type.kind===asset.document.kind)?.name}}</dd>
      <dt>所有者</dt><dd><code>{{asset.ownerId}}</code></dd>
      <dt>可见范围</dt><dd>{{asset.visibility==='domain'?'域内共享':'仅自己'}}</dd>
      <dt>创建时间</dt><dd>{{date(asset.createdAt)}}</dd>
      <dt>更新时间</dt><dd>{{date(asset.updatedAt)}}</dd>
      <template v-if="asset.document.kind==='object-view'"><dt>对象类</dt><dd><code>{{asset.document.className}}</code></dd><dt>视图形式</dt><dd>{{asset.document.form}}</dd><dt>默认对象</dt><dd><code v-if="asset.document.primaryKey">{{asset.document.primaryKey}}</code><span v-else>运行时选择</span></dd></template>
      <template v-if="asset.document.kind==='application'"><dt>平台应用</dt><dd><code>{{asset.document.applicationId}}</code></dd><dt v-if="asset.document.workspaceId">源码工作区</dt><dd v-if="asset.document.workspaceId"><code>{{asset.document.workspaceId}}</code></dd></template>
      <template v-if="asset.document.kind==='dashboard'"><dt>仪表盘标识</dt><dd><code>{{asset.document.dashboardId}}</code></dd></template>
      <template v-if="asset.document.kind==='widget'&&asset.document.widget.kind==='platform'"><dt>平台内容</dt><dd>{{({assistant:'智能问数',apps:'应用入口',data:'仪表盘集合',tasks:'任务动态',conversations:'分析会话',objects:'收藏对象',recent:'最近访问'})[asset.document.widget.source]}}</dd><dt>展示条数</dt><dd>{{asset.document.widget.limit}}</dd><dt v-if="asset.document.widget.placeholder">输入提示</dt><dd v-if="asset.document.widget.placeholder">{{asset.document.widget.placeholder}}</dd></template>
      <template v-if="'workspace' in asset.document"><dt>布局重点</dt><dd>{{({data:'数据优先',tasks:'任务优先',assistant:'应用优先'})[asset.document.workspace.layout]}}</dd><dt>对象打开方式</dt><dd>{{asset.document.workspace.objectOpening==='drawer'?'侧栏':'页面'}}</dd></template>
    </dl>
    <section v-if="'children' in asset.document&&asset.document.children.length" class="widget-configuration"><header><strong>组合引用</strong><span>{{asset.document.children.length}} 项 · 按展示顺序</span></header><ol class="composition-config"><li v-for="child in asset.document.children" :key="child.assetId"><span>{{child.column==='main'?'主栏':'侧栏'}}</span><code>{{child.assetId}}</code></li></ol></section>
    <section v-for="widget in widgets" :key="widget.id" class="widget-configuration">
      <header><strong>{{widget.title||widget.id}}</strong><span>{{widgetKind(widget.kind)}}</span></header>
      <dl class="configuration-fields">
        <dt>组件标识</dt><dd><code>{{widget.id}}</code></dd>
        <dt>布局</dt><dd>{{widget.span}} / 12 列 · {{widget.height}}px</dd>
        <template v-if="widget.resourceId"><dt>能力标识</dt><dd><code>{{widget.resourceId}}</code></dd></template>
        <template v-if="widget.kind==='chart'"><dt>图表样式</dt><dd>{{({bar:'柱状图',line:'折线图',donut:'环形图'} as Record<string,string>)[widget.chartType]??widget.chartType}}</dd></template>
        <template v-if="widget.valueField"><dt>数值字段</dt><dd><code>{{widget.valueField}}</code></dd></template>
        <template v-if="widget.labelField"><dt>标签字段</dt><dd><code>{{widget.labelField}}</code></dd></template>
        <template v-if="widget.fields.length"><dt>展示字段</dt><dd class="field-list"><code v-for="field in widget.fields" :key="field">{{field}}</code></dd></template>
        <template v-if="widget.text"><dt>文案</dt><dd class="configuration-text">{{widget.text}}</dd></template>
      </dl>
      <div v-if="Object.keys(widget.parameters).length" class="parameter-bindings"><h4>参数绑定</h4><div v-for="(binding,name) in widget.parameters" :key="name" class="parameter-row"><code>{{name}}</code><span>{{binding.source==='literal'?'固定值':binding.source==='variable'?'交互变量':'对象上下文'}}</span><CodeEditor v-if="binding.source==='literal'&&binding.value!==null&&typeof binding.value==='object'" :model-value="bindings(binding.value)" language="json" readonly :min-height="80"/><code v-else>{{binding.source==='literal'?bindings(binding.value):binding.path}}</code></div></div>
    </section>
    <section class="configuration-json"><button class="json-toggle" :aria-expanded="showJson" @click="showJson=!showJson"><ChevronRight :size="16" class="json-chevron" :class="{expanded:showJson}" aria-hidden="true"/><Braces :size="16" aria-hidden="true"/><span>完整 JSON</span><small>{{showJson?'收起':'展开'}}</small></button><CodeEditor v-if="showJson" :model-value="json" language="json" readonly :min-height="240"/></section>
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
