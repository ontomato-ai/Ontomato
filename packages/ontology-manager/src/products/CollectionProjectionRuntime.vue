<script setup lang="ts">
import {ref,watch,onBeforeUnmount,computed,inject} from 'vue';
import {productRenderersKey} from './renderers';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {resolveViewParameters} from '@ontomato/contracts/object-views';
import {useManagerClient,useOntologyText} from '../context';
import {useProductText} from './default-texts';
import {ElAlert,ElButton,ElTable,ElTableColumn,vLoading} from 'element-plus';
import {EChart,useChartTheme} from '@ontomato/foundation-ui/chart';
import ObjectViewVisualization from '../object-views/ObjectViewVisualization.vue';
import {viewWidgetSchema} from '@ontomato/contracts/object-views';
const {ot}=useOntologyText();
const productText=useProductText();
const props=defineProps<{asset:ProductAsset;pageState?:Record<string,unknown>}>();const client=useManagerClient();
const rows=ref<Record<string,unknown>[]>([]),error=ref(''),loading=ref(false);
const offset=ref(0),hasMore=ref(false);
const pageSize=computed(()=>props.asset.document.kind==='collection-view'?props.asset.document.pageSize??50:50);
const theme=useChartTheme();
const renderers=inject(productRenderersKey,new Map());
const sceneRenderer=renderers.get('collection-view:3d-scene');
const objectType=ref('');
const platformRenderer=computed(()=>renderers.get(`collection-view:${objectType.value}:${props.asset.document.kind==='collection-view'?props.asset.document.renderer:''}`));
const mapWidget=computed(()=>{const fields=props.asset.document.kind==='collection-view'?props.asset.document.fields:[];return viewWidgetSchema.parse({id:'map',kind:'chart',title:productText(props.asset.name),span:12,height:360,skillId:'leaflet',chartType:'leaflet-map',latitudeField:fields[0]??'latitude',longitudeField:fields[1]??'longitude',labelField:fields[2]??''});});
const chartOption=computed(()=>{
  const fields=props.asset.document.kind==='collection-view'?props.asset.document.fields:[];
  return {tooltip:{trigger:'axis'},grid:{left:48,right:16,top:16,bottom:48},xAxis:{type:'category',data:rows.value.map(row=>String(row[fields[0]]??''))},yAxis:{type:'value'},series:[{type:'bar',data:rows.value.map(row=>row[fields[1]])}]};
});
let generation=0;
onBeforeUnmount(()=>{generation++;});
async function load(){
  const asset=props.asset,current=++generation;
  rows.value=[];objectType.value='';error.value='';loading.value=false;hasMore.value=false;
  if(asset.document.kind!=='collection-view')return;
  loading.value=true;
  try{
    const result=await client.products.collection(asset.document.renders.id,resolveViewParameters(asset.document.parameters,{},props.pageState??{}),asset.document.fields,offset.value,asset.id);
    if(current===generation){rows.value=result.rows.slice(0,pageSize.value);objectType.value=result.objectType??'';hasMore.value=result.rows.length>pageSize.value||result.rows.length===50;}
  }catch(reason){if(current===generation)error.value=reason instanceof Error?reason.message:String(reason);}
  finally{if(current===generation)loading.value=false;}
}
watch(()=>JSON.stringify([props.asset,props.pageState]),()=>{offset.value=0;void load();},{immediate:true});
function page(delta:number){offset.value=Math.max(0,offset.value+delta*pageSize.value);void load();}
</script>
<template>
  <section class="collection-projection"><h3>{{productText(asset.name)}}</h3><el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <template v-if="asset.document.kind==='collection-view'">
      <component :is="platformRenderer" v-if="platformRenderer" :asset="asset" :rows="rows" :loading="loading"/>
      <template v-else-if="asset.document.renderer==='3d-scene'"><component :is="sceneRenderer" v-if="sceneRenderer" :asset="asset" :rows="rows"/><el-alert v-else :title="ot('productNo3dSceneRenderer')" type="error" :closable="false"/></template>
      <ObjectViewVisualization v-else-if="asset.document.renderer==='map'" :widget="mapWidget" :rows="rows" :value="rows"/>
      <EChart v-else-if="asset.document.renderer==='chart'" :option="chartOption" :theme="theme" :height="300"/>
      <ul v-else-if="asset.document.renderer==='list'" v-loading="loading" class="collection-list"><li v-for="(row,index) in rows" :key="index"><dl><template v-for="field in asset.document.fields" :key="field"><dt>{{asset.document.presentation?.fieldLabels[field]??field}}</dt><dd>{{row[field]??'—'}}</dd></template></dl></li></ul>
      <el-table v-else v-loading="loading" :data="rows" :empty-text="ot('productNoRecordsInScope')"><el-table-column v-for="field in asset.document.fields" :key="field" :prop="field" :label="asset.document.presentation?.fieldLabels[field]??field" min-width="150" show-overflow-tooltip><template #default="{row}">{{row[field]===null||row[field]===undefined||row[field]===''?'—':row[field]}}</template></el-table-column></el-table>
    </template>
    <footer v-if="offset||hasMore"><el-button :disabled="loading||!offset" @click="page(-1)">{{ot('productPreviousPage')}}</el-button><span>{{rows.length?offset+1:0}}–{{offset+rows.length}}</span><el-button :disabled="loading||!hasMore" @click="page(1)">{{ot('productNextPage')}}</el-button></footer>
  </section>
</template>
<style scoped>
.collection-projection{display:flex;flex-direction:column;gap:var(--manager-content-gap);min-width:0;max-width:100%;font-size:var(--text-sm);line-height:var(--leading-sm)}
.collection-projection>h3{margin:0;font-size:var(--text-sm);font-weight:var(--font-semibold)}
.collection-projection>footer{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:var(--manager-control-gap);padding-top:var(--manager-control-gap);margin:0}
.collection-projection>footer span{color:var(--el-text-color-secondary);font-size:var(--text-xs);font-variant-numeric:tabular-nums;min-width:48px;text-align:center}
.collection-projection>footer :deep(.el-button+.el-button){margin:0}
.collection-list{list-style:none;margin:0;padding:0}.collection-list>li{padding:var(--spacing-md);border-bottom:1px solid var(--el-border-color-light)}
.collection-list dl{display:grid;grid-template-columns:minmax(80px,1fr) minmax(0,3fr);gap:var(--spacing-sm);margin:0}.collection-list dt{color:var(--el-text-color-secondary)}.collection-list dd{margin:0;overflow-wrap:anywhere}
@container ontology-manager (max-width:520px){.collection-projection>footer{justify-content:flex-start}}
</style>
