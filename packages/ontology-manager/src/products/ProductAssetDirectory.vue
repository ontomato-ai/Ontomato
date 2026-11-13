<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch,nextTick} from 'vue';
import {PlatformPageHeader,PlatformTabs} from '@ontomato/platform-shell';
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
import {productTypes,type ProductQuery,type ProductSummary} from '@ontomato/contracts/product-assets';
import {productIcons} from './product-icons';
import {useManagerClient,useManagerContext,useManagerCounts} from '../context';
const props=defineProps<{query:Partial<ProductQuery>}>();
const emit=defineEmits<{query:[query:Partial<ProductQuery>];open:[id:string];create:[kind:string]}>();
const client=useManagerClient(),items=ref<ProductSummary[]>([]),total=ref(0),loading=ref(false),error=ref(''),search=ref(props.query.search??'');
const context=useManagerContext();
const managerCounts=useManagerCounts();
const capabilityNames=ref<Record<string,string>>({});
async function resolveCapabilityNames(rows:ProductSummary[],current:number){
  const references=[...new Map(rows.filter(row=>row.details.resourceId).map(row=>{
    const kind=row.details.widgetKind==='action'?'actions':'metrics';
    return [`${kind}:${row.details.resourceId}`,{kind:kind as 'actions'|'metrics',id:row.details.resourceId!}];
  })).entries()];
  const names=await Promise.all(references.map(async([key,reference])=>{
    try{const result=await client.requestSmartAsset(reference.kind,'queryById',{id:reference.id});if(result.data?.name)return [key,String(result.data.name)] as const;}catch{/* An unavailable name must not hide the asset row. */}
    return [key,'能力暂不可访问'] as const;
  }));
  if(current===generation)capabilityNames.value=Object.fromEntries(names);
}
function capabilityName(row:ProductSummary){return capabilityNames.value[`${row.details.widgetKind==='action'?'actions':'metrics'}:${row.details.resourceId}`]??'正在读取能力名称…';}
const typeCounts=ref<Record<string,number>>({});
watch(typeCounts,counts=>{managerCounts.values.products=Object.values(counts).reduce((sum,count)=>sum+count,0);});
const typeTabs=computed(()=>productTypes.map(type=>({id:type.kind,label:`${type.name} ${typeCounts.value[type.kind]??0}`,icon:productIcons[type.kind]})));
const activeKind=computed(()=>props.query.kind??'application');
const activeType=computed(()=>productTypes.find(type=>type.kind===activeKind.value)!);
function date(value:string){return new Date(value).toLocaleString(context.locale,{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
const contentLabels:Record<string,string>={platform:'平台交互',metric:'指标卡',table:'表格',chart:'图表',text:'文字',action:'操作入口',input:'输入',button:'按钮',bar:'柱状图',line:'折线图',donut:'环形图',assistant:'智能问数',apps:'应用入口',data:'仪表盘集合',tasks:'任务动态',conversations:'分析会话',objects:'收藏对象',recent:'最近访问'};
function assetDetails(row:ProductSummary){
  const d=row.details;
  return [d.widgetKind?contentLabels[d.widgetKind]??d.widgetKind:'',d.chartType?contentLabels[d.chartType]??d.chartType:'',d.section?contentLabels[d.section]??d.section:'',d.className??'',d.childCount!==undefined?`${d.childCount} 个子资产`:'',d.widgetCount!==undefined?`${d.widgetCount} 个组件`:'',...(d.widgetKinds??[]).map(kind=>contentLabels[kind]??kind)].filter(Boolean).join(' · ');
}
const scroll=ref<HTMLElement>();
const scrollPositions=new Map<string,number>();
let generation=0,timer:ReturnType<typeof setTimeout>|undefined;
const queryKey=()=>JSON.stringify(props.query);
async function load(){const current=++generation;loading.value=true;error.value='';try{const [result,counts]=await Promise.all([client.products.query({...props.query,kind:activeKind.value}),client.products.counts()]);if(current!==generation)return;typeCounts.value=counts;items.value=result.items;total.value=result.total;capabilityNames.value={};void resolveCapabilityNames(result.items,current);await nextTick();if(scroll.value)scroll.value.scrollTop=scrollPositions.get(queryKey())??Number(sessionStorage.getItem('product-directory:'+queryKey())??0);}catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}finally{if(current===generation)loading.value=false;}}
watch(()=>props.query,()=>{search.value=props.query.search??'';void load();},{immediate:true,deep:true});
function update(patch:Partial<ProductQuery>){if(scroll.value)scrollPositions.set(queryKey(),scroll.value.scrollTop);emit('query',{...props.query,...patch});}
function scheduleSearch(){clearTimeout(timer);timer=setTimeout(()=>update({search:search.value,page:1}),300);}
function changeKind(value:string){clearTimeout(timer);update({kind:value as ProductQuery['kind'],search:'',page:1});}
function changeScope(value:string|number|boolean|undefined){update({scope:value as ProductQuery['scope'],page:1});}
function openRow(row:ProductSummary){open(row.id);}
function changePage(page:number){update({page});}
function changeSize(pageSize:number){update({pageSize,page:1});}
function open(id:string){if(scroll.value)sessionStorage.setItem('product-directory:'+queryKey(),String(scroll.value.scrollTop));emit('open',id);}
onBeforeUnmount(()=>{clearTimeout(timer);generation++;});
</script>
<template>
  <section class="product-directory">
    <PlatformPageHeader title="产品资产" description="管理可复用的页面、组件与应用"><template #actions><el-dropdown placement="bottom-end" :popper-options="dropdownBoundaryOptions" @command="(kind:string)=>emit('create',kind)"><el-button type="primary">创建资产</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item v-for="type in productTypes" :key="type.kind" :command="type.kind"><component :is="productIcons[type.kind]" :size="16" class="type-icon"/>{{type.name}}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></template></PlatformPageHeader>
    <div class="directory-types"><PlatformTabs :tabs="typeTabs" :active-id="activeKind" label="产品资产类型" @select="changeKind"/></div>
    <div class="type-description"><strong>{{activeType.name}}</strong><span>{{activeType.description}}</span></div>
    <div class="directory-toolbar"><el-input v-model="search" clearable :placeholder="`搜索${activeType.name}名称`" aria-label="搜索资产名称" @input="scheduleSearch"/><el-select :model-value="query.scope??'all'" aria-label="资产范围" @change="changeScope"><el-option value="all" label="全部可见"/><el-option value="mine" label="我的资产"/><el-option value="shared" label="域内共享"/></el-select></div>
    <el-alert v-if="error" class="directory-error" :title="error" type="error" :closable="false"><el-button text @click="load">重试</el-button></el-alert>
    <div ref="scroll" class="directory-table"><el-table v-loading="loading" :data="items" row-key="id" @row-click="openRow">
      <el-table-column label="名称" min-width="280"><template #default="{row}"><button class="asset-name" @click.stop="open(row.id)"><span><strong>{{row.name}}</strong><small v-if="row.description">{{row.description}}</small></span></button></template></el-table-column>
      <el-table-column label="内容与配置" min-width="230"><template #default="{row}"><span>{{assetDetails(row)||'—'}}</span><small v-if="row.details.resourceId" class="capability-reference" :title="`${capabilityName(row)} · ${row.details.resourceId}`">{{row.details.widgetKind==='action'?'操作':'指标'}}：{{capabilityName(row)}}</small></template></el-table-column>
      <el-table-column label="可见范围" width="120"><template #default="{row}">{{row.visibility==='domain'?'域内共享':'仅自己'}}</template></el-table-column><el-table-column label="所有者" min-width="150"><template #default="{row}"><span :title="row.ownerId">{{row.editable?'我':row.ownerId}}</span></template></el-table-column><el-table-column label="更新时间" width="180"><template #default="{row}"><span class="asset-date">{{date(row.updatedAt)}}</span></template></el-table-column><template #empty><span>{{loading?'正在加载…':error?'加载失败，请重试':'暂无匹配资产'}}</span></template></el-table></div>
    <footer><el-pagination :current-page="query.page??1" :page-size="query.pageSize??20" :page-sizes="[20,50,100]" :total="total" layout="total, sizes, prev, pager, next" @current-change="changePage" @size-change="changeSize"/></footer>
  </section>
</template>
<style scoped>
.capability-reference{display:block;color:var(--el-text-color-secondary);font-size:var(--text-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:var(--manager-label-gap)}
.directory-types{padding-inline:var(--page-gutter);flex-shrink:0}.type-description{display:flex;align-items:center;flex-wrap:wrap;gap:var(--manager-control-gap);padding:var(--manager-content-gap) var(--page-gutter) 0;font-size:var(--text-sm);flex-shrink:0}.type-description>svg,.type-description>span{color:var(--el-text-color-secondary)}.type-description strong{font-weight:var(--font-semibold)}
.asset-date{white-space:nowrap;font-variant-numeric:tabular-nums}
.product-directory{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}.directory-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:var(--manager-control-gap);padding:var(--manager-content-gap) var(--page-gutter);flex-shrink:0}.directory-toolbar>.el-input{width:260px}.directory-toolbar>.el-select{width:160px}.result-count{margin-inline-start:auto;color:var(--el-text-color-secondary);font-size:var(--text-xs)}.directory-error{margin:0 var(--page-gutter) var(--manager-content-gap);width:auto}.directory-table{flex:1;min-height:0;overflow:auto;margin:0 var(--page-gutter);border:1px solid var(--el-border-color);border-radius:var(--radius-md)}.asset-name{display:flex;align-items:center;gap:var(--manager-control-gap);border:0;background:none;color:var(--el-text-color-primary);font:inherit;text-align:start;width:100%;cursor:pointer;padding:var(--spacing-xs) 0}.asset-name>svg{flex-shrink:0;color:var(--el-text-color-secondary)}.asset-name>span{min-width:0}.asset-name strong,.asset-name small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60ch}.asset-name strong{font-weight:var(--font-semibold)}.asset-name small{font-size:var(--text-xs);color:var(--el-text-color-secondary);margin-top:var(--manager-label-gap)}.asset-name:focus-visible{outline:2px solid var(--el-color-primary)}.type-icon{margin-inline-end:var(--spacing-sm)}footer{display:flex;justify-content:flex-end;flex-shrink:0;padding:var(--manager-content-gap) var(--page-gutter);overflow-x:auto}.directory-table :deep(.el-table__row){cursor:pointer}@container ontology-manager (max-width:760px){.result-count{display:none}.directory-toolbar>.el-input{flex:1 1 200px}footer{justify-content:flex-start}}
/* Match the Manager catalogs: one gutter, 16px content gaps and 8px control gaps. */
.directory-types{padding-top:var(--manager-control-gap)}
.product-directory{font-size:var(--text-sm);line-height:var(--leading-sm)}
.type-description{padding-top:var(--manager-content-gap);gap:var(--manager-control-gap);line-height:var(--leading-sm)}
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
</style>
