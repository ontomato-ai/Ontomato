<script setup lang="ts">
import {ref,watch,onBeforeUnmount,computed,inject} from 'vue';
import {productRenderersKey} from './renderers';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {resolveViewParameters} from '@ontomato/contracts/object-views';
import {useManagerClient} from '../context';
import {ElAlert,ElButton,ElTable,ElTableColumn,vLoading} from 'element-plus';
import {EChart,useChartTheme} from '@ontomato/foundation-ui/chart';
import ObjectViewVisualization from '../object-views/ObjectViewVisualization.vue';
import {viewWidgetSchema} from '@ontomato/contracts/object-views';
const props=defineProps<{asset:ProductAsset;pageState?:Record<string,unknown>}>();const client=useManagerClient();
const rows=ref<Record<string,unknown>[]>([]),error=ref(''),loading=ref(false);
const offset=ref(0),hasMore=ref(false);
const pageSize=computed(()=>props.asset.document.kind==='collection-view'?props.asset.document.pageSize??50:50);
const theme=useChartTheme();
const renderers=inject(productRenderersKey,new Map());
const sceneRenderer=renderers.get('collection-view:3d-scene');
const objectType=ref('');
const platformRenderer=computed(()=>renderers.get(`collection-view:${objectType.value}:${props.asset.document.kind==='collection-view'?props.asset.document.renderer:''}`));
const mapWidget=computed(()=>{const fields=props.asset.document.kind==='collection-view'?props.asset.document.fields:[];return viewWidgetSchema.parse({id:'map',kind:'chart',title:props.asset.name,span:12,height:360,skillId:'leaflet',chartType:'leaflet-map',latitudeField:fields[0]??'latitude',longitudeField:fields[1]??'longitude',labelField:fields[2]??''});});
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
  <section><h3>{{asset.name}}</h3><el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <template v-if="asset.document.kind==='collection-view'">
      <component :is="platformRenderer" v-if="platformRenderer" :asset="asset" :rows="rows" :loading="loading"/>
      <template v-else-if="asset.document.renderer==='3d-scene'"><component :is="sceneRenderer" v-if="sceneRenderer" :asset="asset" :rows="rows"/><el-alert v-else title="当前宿主未注册 3D 场景渲染器" type="error" :closable="false"/></template>
      <ObjectViewVisualization v-else-if="asset.document.renderer==='map'" :widget="mapWidget" :rows="rows" :value="rows"/>
      <EChart v-else-if="asset.document.renderer==='chart'" :option="chartOption" :theme="theme" :height="300"/>
      <ul v-else-if="asset.document.renderer==='list'" v-loading="loading"><li v-for="(row,index) in rows" :key="index"><dl><template v-for="field in asset.document.fields" :key="field"><dt>{{asset.document.presentation?.fieldLabels[field]??field}}</dt><dd>{{row[field]??'—'}}</dd></template></dl></li></ul>
      <el-table v-else v-loading="loading" :data="rows"><el-table-column v-for="field in asset.document.fields" :key="field" :prop="field" :label="asset.document.presentation?.fieldLabels[field]??field"/></el-table>
    </template>
    <footer v-if="offset||hasMore"><el-button :disabled="loading||!offset" @click="page(-1)">上一页</el-button><span>{{rows.length?offset+1:0}}–{{offset+rows.length}}</span><el-button :disabled="loading||!hasMore" @click="page(1)">下一页</el-button></footer>
  </section>
</template>
