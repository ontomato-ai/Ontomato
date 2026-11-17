<script setup lang="ts">
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {useRouter} from 'vue-router';
import {ElButton,ElMessageBox,vLoading} from 'element-plus';
import {platformRoutes} from '@ontomato/platform-shell/routes';
import {inject,ref,computed} from 'vue';
import {ArrowUpRight} from 'lucide-vue-next';
import {appIcon} from '@ontomato/platform-shell';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {defaultPersonalWorkspace,personalWorkspaceSchema} from '@ontomato/contracts/personal-workspace';
import {useI18n} from 'vue-i18n';
import {openApplicationKey,platformApplicationsKey} from '../apps';
const props=defineProps<{asset:ProductAsset;rows:Record<string,unknown>[];loading?:boolean;objectType:string}>();
const router=useRouter();
const {locale,t}=useI18n();
const openApplication=inject(openApplicationKey,undefined);
const applications=inject(platformApplicationsKey,undefined);
function application(id:unknown){return applications?.value.find(app=>app.id===id);}
function applicationIcon(id:unknown){return appIcon(application(id)?.icon??'app-window');}
/** Application rows show the platform's current name and description for their application; other rows show what was read. */
function rowApplication(row:Record<string,unknown>){return props.objectType==='platform:FavoriteApplication'?application(row.id):props.objectType==='platform:RecentVisit'?application(row.appId):undefined;}
function rowValue(row:Record<string,unknown>,field:string){return field==='description'&&props.objectType==='platform:FavoriteApplication'?application(row.id)?.description??row[field]:row[field];}
const changed=ref<Record<string,{pinned:boolean;title:string}>>({}),error=ref(''),saving=ref(false);
const order=ref<string[]>();
const rows=computed(()=>order.value?[...props.rows].sort((a,b)=>{const rank=(id:unknown)=>{const index=order.value!.indexOf(String(id));return index<0?order.value!.length:index;};return rank(a.id)-rank(b.id);}):props.rows);
function resourceTitle(row:Record<string,unknown>){
 const raw=String(changed.value[String(row.id)]?.title??rowApplication(row)?.label??row.title??row.name??t('ontology.productUntitledItem'));
 if(props.objectType!=='platform:Conversation')return raw;
 const quoted=raw.match(/"title"\s*:\s*"([^"\n]+)"/);if(quoted)return t('ontology.productConversationAnalysis',{title:quoted[1]});
 return raw.split(/\n|\{\s*"/)[0].replace(/(?:对象引用|分析上下文)\s*[:：][\s\S]*$/,'').trim().slice(0,70)||t('ontology.productUntitledAnalysis');
}
function summary(value:unknown){return String(value??'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[`#*|]/g,'').split(/\n\s*\n/)[0].trim().slice(0,180);}
function fieldLabel(field:string){return props.asset.document.kind==='collection-view'?props.asset.document.presentation?.fieldLabels[field]??({description:t('ontology.productDescription'),updatedAt:t('ontology.productUpdatedAt'),visitedAt:t('ontology.productVisitedAt')} as Record<string,string>)[field]??field:field;}
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
    else if(index>=0&&action==='rename'){const result=await ElMessageBox.prompt(t('ontology.productName'),t('ontology.productRenamePinned'),{inputValue:workspace.pinnedAnalyses[index].title});workspace.pinnedAnalyses[index].title=result.value.trim();}
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
    <div v-if="!loading&&!rows.length" class="collection-empty"><p>{{({ 'platform:FavoriteApplication':t('ontology.productEmptyFavoriteApplications'),'platform:Conversation':t('ontology.productEmptyConversations'),'platform:Task':t('ontology.productEmptyTasks'),'platform:Favorite':t('ontology.productEmptyFavorites'),'platform:RecentVisit':t('ontology.productEmptyRecent'),'platform:Dashboard':t('ontology.productEmptyDashboards')} as Record<string,string>)[objectType]??t('ontology.productEmptyContent')}}</p><el-button v-if="objectType==='platform:FavoriteApplication'" text @click="router.push('/applications')">{{t('ontology.productGoToGallery')}} <ArrowUpRight :size="14"/></el-button></div>
    <div :class="{'application-shortcuts':objectType==='platform:FavoriteApplication'}"><article v-for="row in rows" :key="String(row.id)">
      <component :is="applicationIcon(row.id)" v-if="objectType==='platform:FavoriteApplication'" :size="22" class="shortcut-icon"/>
      <el-button text class="resource-title" :title="resourceTitle(row)" @click="open(row)">{{resourceTitle(row)}}</el-button>
      <template v-if="objectType==='platform:Task'">
        <span>{{row.pause?t('ontology.productTaskPaused'):row.activeRunId?t('ontology.productTaskRunning'):row.enabled?t('ontology.productTaskEnabled'):t('ontology.productTaskDisabled')}}</span>
        <p v-if="row.pauseMessage">{{summary(row.pauseMessage)}}</p><p v-else-if="row.resultSummary">{{summary(row.resultSummary)}}</p>
        <el-button v-if="typeof row.resultPath==='string'&&row.resultPath.startsWith('/')&&!row.resultPath.startsWith('//')" text @click="router.push(row.resultPath)">{{t('ontology.productViewResult')}}</el-button>
      </template>
      <template v-if="objectType==='platform:Conversation'">
        <el-button text :disabled="saving" @click="pin(row,'toggle')">{{(changed[String(row.id)]?.pinned??row.pinned)?t('ontology.productUnpin'):t('ontology.productPin')}}</el-button>
        <template v-if="changed[String(row.id)]?.pinned??row.pinned"><el-button text :disabled="saving" @click="pin(row,'rename')">{{t('ontology.productRename')}}</el-button><el-button text :disabled="saving" @click="pin(row,'up')">{{t('ontology.productMoveUp')}}</el-button></template>
      </template>
      <dl v-if="objectType!=='platform:Task'"><template v-for="field in asset.document.kind==='collection-view'?asset.document.fields.filter(field=>!['title','name','id','path','primaryKey','agentId','pinned','className'].includes(field)):[]" :key="field"><dt>{{fieldLabel(field)}}</dt><dd>{{fieldValue(field,rowValue(row,field))}}</dd></template></dl>
    </article></div>
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
<style scoped>.platform-collection article>.resource-title{max-width:calc(100% - 80px)}.platform-collection article>span{display:inline-block;margin-inline-start:8px;font-size:var(--text-xs);color:var(--el-text-color-secondary)}.application-shortcuts article>.resource-title{max-width:100%}</style>
<style scoped>.collection-empty{padding:20px 0;color:var(--el-text-color-secondary);font-size:var(--text-sm)}.collection-empty p{margin:0 0 8px;display:block}.application-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.application-shortcuts article{position:relative;padding:16px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--el-fill-color-blank)}.application-shortcuts article:hover{border-color:var(--el-color-primary-light-5);background:var(--el-fill-color-light)}.shortcut-icon{color:var(--el-color-primary);margin-bottom:8px}.application-shortcuts .resource-title{display:flex;font-weight:600}.application-shortcuts dl dt{display:none}.application-shortcuts dl{line-height:1.6}.application-shortcuts article :deep(.el-button){margin:0}@container ontology-manager (max-width:420px){.application-shortcuts{grid-template-columns:minmax(0,1fr)}}</style>
