<script setup lang="ts">
import {computed} from 'vue';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import MetricViewData from '../app-components/MetricViewData.vue';
import {resolveViewParameters} from '@ontomato/contracts/object-views';
import {formatProjectionValue,projectionDisplayRows} from '@ontomato/contracts/product-projections';
import {EChart,useChartTheme} from '@ontomato/foundation-ui/chart';
import {ElAlert,ElSkeleton,ElTable,ElTableColumn} from 'element-plus';
const props=defineProps<{asset:ProductAsset;pageState?:Record<string,unknown>}>();
const projection=computed(()=>props.asset.document.kind==='metric-widget'?props.asset.document:null);
const theme=useChartTheme();
const resolvedParameters=computed(()=>projection.value?resolveViewParameters(Object.fromEntries(Object.entries(projection.value.parameters).filter(([,binding])=>!(binding.source==='literal'&&typeof binding.value==='string'))),{},props.pageState??{}):{});
const parameterTexts=computed(()=>projection.value?Object.fromEntries(Object.entries(projection.value.parameters).filter((entry):entry is [string,{source:'literal';value:string}]=>entry[1].source==='literal'&&typeof entry[1].value==='string').map(([name,binding])=>[name,binding.value])):{});
function categoryLabel(value:unknown){return value===null||value===undefined||value===''?'未填写':String(value);}
function option(data:unknown){
  const document=projection.value!;
  const rows=projectionDisplayRows(Array.isArray(data)?data:[],document.display);
  const values=rows.map(row=>row[document.valueField]);
  if(document.renderer==='gauge')return {color:document.display?.colors,series:[{type:'gauge',data:[{value:values[0],name:props.asset.name}],detail:{formatter:(value:unknown)=>formatProjectionValue(value,document.format)}}]};
   if(document.renderer==='chart'&&document.chartType==='donut')return {color:document.display?.colors,tooltip:{trigger:'item'},legend:{bottom:0},series:[{type:'pie',radius:['45%','70%'],data:rows.map(row=>({name:categoryLabel(row[document.labelField]),value:row[document.valueField]})),label:{show:false}}]};
   return {color:document.display?.colors,tooltip:{trigger:'axis'},grid:{left:48,right:16,top:16,bottom:36},xAxis:{type:'category',data:rows.map(row=>categoryLabel(row[document.labelField]))},yAxis:{type:'value'},series:[{type:document.renderer==='trend'||document.chartType==='line'?'line':'bar',data:values}]};
}
function display(data:unknown){
  if(!projection.value)return '—';
  const row=projectionDisplayRows(Array.isArray(data)?data:[],projection.value.display)[0];const value=row?.[projection.value.valueField];
  return formatProjectionValue(value,projection.value.format);
}
function tableRows(data:unknown){return projectionDisplayRows(Array.isArray(data)?data:[],projection.value?.display).map(row=>Object.fromEntries(Object.entries(row).map(([field,value])=>[field,projection.value?.display?.formats?.[field]?formatProjectionValue(value,projection.value.display.formats[field]):value])));}
</script>
<template><MetricViewData v-if="projection" v-slot="read" :metric-view-id="projection.renders.id" :parameters="resolvedParameters" :parameter-texts="parameterTexts"><article class="metric-projection"><h4>{{asset.name}}</h4><el-alert v-if="read.error" :title="read.error.message" type="error" :closable="false"/><el-skeleton v-else-if="read.loading" :rows="1" animated/><strong v-else-if="projection.renderer==='number'">{{display(read.data)}}</strong><el-table v-else-if="projection.renderer==='table'" :data="tableRows(read.data)"><el-table-column v-for="field in projection.fields" :key="field" :prop="field" :label="projection.presentation?.fieldLabels[field]??field"/></el-table><EChart v-else :option="option(read.data)" :theme="theme" :height="projection.height"/></article></MetricViewData></template>
<style scoped>.metric-projection{box-sizing:border-box;height:100%;border:1px solid var(--el-border-color-light);padding:var(--spacing-lg);border-radius:var(--radius-md)}h4{font-size:var(--text-xs);color:var(--el-text-color-secondary);margin:0 0 var(--spacing-sm);font-weight:var(--font-medium)}strong{font-size:var(--text-2xl);font-variant-numeric:tabular-nums}</style>
<style scoped>.metric-projection{min-width:0;max-width:100%;overflow:hidden}.metric-projection h4{line-height:var(--leading-sm);overflow-wrap:anywhere}.metric-projection>strong{display:block;line-height:1.4;overflow-wrap:anywhere}</style>
