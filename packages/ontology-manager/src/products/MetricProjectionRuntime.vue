<script setup lang="ts">
import {computed} from 'vue';
import type {ChartRow} from '@ontomato/contracts/chart-data';
import {isMetricChartProjection} from '@ontomato/contracts/product-projections';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import MetricViewData from '../app-components/MetricViewData.vue';
import {resolveViewParameters} from '@ontomato/contracts/object-views';
import {formatProjectionValue,projectionDisplayRows} from '@ontomato/contracts/product-projections';
import {MetricChart} from '@ontomato/foundation-ui/chart';
import {ElAlert,ElSkeleton,ElTable,ElTableColumn} from 'element-plus';
const props=defineProps<{asset:ProductAsset;pageState?:Record<string,unknown>}>();
const projection=computed(()=>props.asset.document.kind==='metric-widget'?props.asset.document:null);
const chart=computed(()=>projection.value&&isMetricChartProjection(projection.value)?projection.value:null);
const resolvedParameters=computed(()=>projection.value?resolveViewParameters(Object.fromEntries(Object.entries(projection.value.parameters).filter(([,binding])=>!(binding.source==='literal'&&typeof binding.value==='string'))),{},props.pageState??{}):{});
const parameterTexts=computed(()=>projection.value?Object.fromEntries(Object.entries(projection.value.parameters).filter((entry):entry is [string,{source:'literal';value:string}]=>entry[1].source==='literal'&&typeof entry[1].value==='string').map(([name,binding])=>[name,binding.value])):{});
/** The rows this chart draws: the current MetricView result, unchanged by this consumer. */
const chartRows=(data:unknown)=>Array.isArray(data)?data as ChartRow[]:[];
function display(data:unknown){
  if(!projection.value)return '—';
  const row=projectionDisplayRows(Array.isArray(data)?data:[],projection.value.display)[0];const value=row?.[projection.value.valueField];
  return formatProjectionValue(value,projection.value.format);
}
function tableRows(data:unknown){return projectionDisplayRows(Array.isArray(data)?data:[],projection.value?.display).map(row=>Object.fromEntries(Object.entries(row).map(([field,value])=>[field,projection.value?.display?.formats?.[field]?formatProjectionValue(value,projection.value.display.formats[field]):value])));}
</script>
<template><MetricViewData v-if="projection" v-slot="read" :metric-view-id="projection.renders.id" :parameters="resolvedParameters" :parameter-texts="parameterTexts"><article class="metric-projection"><h4>{{asset.name}}</h4><el-alert v-if="read.error" :title="read.error.message" type="error" :closable="false"/><el-skeleton v-else-if="read.loading" :rows="1" animated/><strong v-else-if="projection.renderer==='number'">{{display(read.data)}}</strong><el-table v-else-if="projection.renderer==='table'" :data="tableRows(read.data)"><el-table-column v-for="field in projection.fields" :key="field" :prop="field" :label="projection.presentation?.fieldLabels[field]??field"/></el-table><MetricChart v-else-if="chart" :file="chart.chartFile" :metric="{columns:read.columns,rows:chartRows(read.data)}" :height="chart.height"/></article></MetricViewData></template>
<style scoped>.metric-projection{box-sizing:border-box;height:100%;border:1px solid var(--el-border-color-light);padding:var(--spacing-lg);border-radius:var(--radius-md)}h4{font-size:var(--text-xs);color:var(--el-text-color-secondary);margin:0 0 var(--spacing-sm);font-weight:var(--font-medium)}strong{font-size:var(--text-2xl);font-variant-numeric:tabular-nums}</style>
<style scoped>.metric-projection{min-width:0;max-width:100%;overflow:hidden}.metric-projection h4{line-height:var(--leading-sm);overflow-wrap:anywhere}.metric-projection>strong{display:block;line-height:1.4;overflow-wrap:anywhere}</style>
