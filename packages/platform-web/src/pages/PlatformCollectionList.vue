<script setup lang="ts">
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {useRouter} from 'vue-router';
import {ElButton,ElEmpty,ElMessageBox,vLoading} from 'element-plus';
import {platformRoutes} from '@ontomato/platform-shell/routes';
import {inject,ref,computed} from 'vue';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {defaultPersonalWorkspace,personalWorkspaceSchema} from '@ontomato/contracts/personal-workspace';
import {useI18n} from 'vue-i18n';
import {openApplicationKey} from '../apps';
const props=defineProps<{asset:ProductAsset;rows:Record<string,unknown>[];loading?:boolean;objectType:string}>();
const router=useRouter();
const {locale}=useI18n();
const openApplication=inject(openApplicationKey,undefined);
const changed=ref<Record<string,{pinned:boolean;title:string}>>({}),error=ref(''),saving=ref(false);
const order=ref<string[]>();
const rows=computed(()=>order.value?[...props.rows].sort((a,b)=>{const rank=(id:unknown)=>{const index=order.value!.indexOf(String(id));return index<0?order.value!.length:index;};return rank(a.id)-rank(b.id);}):props.rows);
function fieldLabel(field:string){return props.asset.document.kind==='collection-view'?props.asset.document.presentation?.fieldLabels[field]??({description:'说明',updatedAt:'更新时间',visitedAt:'最近访问'} as Record<string,string>)[field]??field:field;}
function fieldValue(field:string,value:unknown){if(['updatedAt','visitedAt'].includes(field)&&value){const date=new Date(String(value));if(Number.isFinite(date.getTime()))return date.toLocaleString(locale.value);}return value??'—';}
async function pin(row:Record<string,unknown>,action:'toggle'|'rename'|'up'){
  if(saving.value)return;
  saving.value=true;error.value='';
  try{
    const endpoint=`/api/product-assets/${encodeURIComponent(props.asset.id)}/overlay`;
    const response=await nodeApiRequest(endpoint);const overlay=await response.json();if(!response.ok)throw new Error(overlay.error?.message??'Preferences unavailable');
    const workspace=personalWorkspaceSchema.parse(overlay.workspace??defaultPersonalWorkspace());
    const id=String(row.id),index=workspace.pinnedAnalyses.findIndex(item=>item.sessionId===id);
    if(action==='toggle'){if(index<0)workspace.pinnedAnalyses.push({sessionId:id,title:String(row.title??id).slice(0,200)});else workspace.pinnedAnalyses.splice(index,1);}
    else if(index>=0&&action==='rename'){const result=await ElMessageBox.prompt('名称','重命名收藏',{inputValue:workspace.pinnedAnalyses[index].title});workspace.pinnedAnalyses[index].title=result.value.trim();}
    else if(index>0&&action==='up'){const [item]=workspace.pinnedAnalyses.splice(index,1);workspace.pinnedAnalyses.splice(index-1,0,item);}
    const saved=await nodeApiRequest(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:overlay.revision,workspace})});const result=await saved.json();if(!saved.ok)throw new Error(result.error?.message??'Preferences could not be saved');
    const selected=workspace.pinnedAnalyses.find(item=>item.sessionId===id);changed.value[id]={pinned:!!selected,title:selected?.title??String(row.title??id)};
    order.value=workspace.pinnedAnalyses.map(item=>item.sessionId);
  }catch(reason){if(reason!=='cancel'&&reason!=='close')error.value=reason instanceof Error?reason.message:String(reason);}finally{saving.value=false;}
}
function open(row:Record<string,unknown>){
  if(props.objectType==='platform:Conversation')void router.push({path:'/agents/chat',query:{agentId:String(row.agentId),sessionId:String(row.id)}});
  else if(props.objectType==='platform:Favorite')void router.push({name:platformRoutes.objectView.name,params:{className:String(row.className)},query:{key:String(row.primaryKey)}});
  else if(props.objectType==='platform:RecentVisit'&&typeof row.path==='string'&&row.path.startsWith('/')&&!row.path.startsWith('//'))void router.push(row.path);
  else if(props.objectType==='platform:Task')void router.push({path:'/schedules',query:{taskId:String(row.id)}});
  else if(props.objectType==='platform:Dashboard')void router.push({path:platformRoutes.dashboards.path,query:{dashboardId:String(row.id)}});
  else if(props.objectType==='platform:FavoriteApplication'){if(openApplication)openApplication(String(row.id));else if(typeof row.path==='string'&&row.path.startsWith('/')&&!row.path.startsWith('//'))void router.push(row.path);}
}
</script>
<template>
  <div v-loading="loading" class="platform-collection">
    <p v-if="error" role="alert">{{error}}</p>
    <el-empty v-if="!loading&&!rows.length" :image-size="48"/>
    <article v-for="row in rows" :key="String(row.id)">
      <el-button text class="resource-title" :title="String(changed[String(row.id)]?.title??row.title??row.name??row.id)" @click="open(row)">{{changed[String(row.id)]?.title??row.title??row.name??row.id}}</el-button>
      <template v-if="objectType==='platform:Task'">
        <span>{{row.pause?'已暂停':row.activeRunId?'运行中':row.enabled?'已启用':'已停用'}}</span>
        <p v-if="row.pauseMessage">{{row.pauseMessage}}</p><p v-else-if="row.resultSummary">{{row.resultSummary}}</p>
        <el-button v-if="typeof row.resultPath==='string'&&row.resultPath.startsWith('/')&&!row.resultPath.startsWith('//')" text @click="router.push(row.resultPath)">查看结果</el-button>
      </template>
      <template v-if="objectType==='platform:Conversation'">
        <el-button text :disabled="saving" @click="pin(row,'toggle')">{{(changed[String(row.id)]?.pinned??row.pinned)?'取消收藏':'收藏'}}</el-button>
        <template v-if="changed[String(row.id)]?.pinned??row.pinned"><el-button text :disabled="saving" @click="pin(row,'rename')">重命名</el-button><el-button text :disabled="saving" @click="pin(row,'up')">上移</el-button></template>
      </template>
      <dl v-if="objectType!=='platform:Task'"><template v-for="field in asset.document.kind==='collection-view'?asset.document.fields.filter(field=>!['title','name','id','path','primaryKey','agentId','pinned','className'].includes(field)):[]" :key="field"><dt>{{fieldLabel(field)}}</dt><dd>{{fieldValue(field,row[field])}}</dd></template></dl>
    </article>
  </div>
</template>
<style scoped>
.platform-collection{min-width:0;font-size:var(--text-sm);line-height:var(--leading-sm)}
.platform-collection article{padding:var(--spacing-md) var(--spacing-sm);border-bottom:1px solid var(--el-border-color-light);min-width:0}
.platform-collection article>.el-button+.el-button{margin-inline-start:var(--spacing-sm)}
.resource-title{max-width:100%;height:auto;text-align:start;padding:0;min-height:var(--control-height)}
.resource-title :deep(span){display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow:hidden;overflow-wrap:anywhere}
.platform-collection p{margin:var(--spacing-sm) 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere}
dl{display:flex;gap:var(--spacing-xs) var(--spacing-sm);flex-wrap:wrap;margin:var(--spacing-xs) 0 0;font-size:var(--text-xs);color:var(--el-text-color-secondary)}dd{margin:0;overflow-wrap:anywhere}
</style>
