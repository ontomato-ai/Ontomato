<script setup lang="ts">
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {useRouter} from 'vue-router';
import {ElButton,ElDropdown,ElDropdownItem,ElDropdownMenu,ElMessage,ElMessageBox,ElTooltip,vLoading} from 'element-plus';
import { actionTooltipProps } from '@ontomato/foundation-ui/overlay';
import {platformRoutes} from '@ontomato/platform-shell/routes';
import {inject,ref,computed} from 'vue';
import {ArrowRight,ArrowUpRight,Bookmark,ChevronRight,Ellipsis,History,MessageSquare} from 'lucide-vue-next';
import {appIcon} from '@ontomato/platform-shell';
import ApplicationGlyph from '../features/home/ApplicationGlyph.vue';
import {nodeApiRequest} from '@ontomato/workbench-ui';
import {defaultPersonalWorkspace,personalWorkspaceSchema} from '@ontomato/contracts/personal-workspace';
import {useI18n} from 'vue-i18n';
import {appAt,openApplicationKey,platformApplicationsKey} from '../apps';
const props=defineProps<{asset:ProductAsset;rows:Record<string,unknown>[];loading?:boolean;objectType:string}>();
const router=useRouter();
const {locale,t}=useI18n();
const openApplication=inject(openApplicationKey,undefined);
const applications=inject(platformApplicationsKey,undefined);
function application(id:unknown){return applications?.value.find(app=>app.id===id);}
/** Application rows show the platform's current name and description for their application; other rows show what was read. A recent visit finds its application from its path, as the rail did when recording it. */
function rowApplication(row:Record<string,unknown>){return props.objectType==='platform:FavoriteApplication'?application(row.id):props.objectType==='platform:RecentVisit'&&applications&&typeof row.path==='string'?appAt(applications.value,row.path.split('?')[0]!)??undefined:undefined;}
function rowValue(row:Record<string,unknown>,field:string){return field==='description'&&props.objectType==='platform:FavoriteApplication'?application(row.id)?.description??row[field]:row[field];}
const changed=ref<Record<string,{pinned:boolean;title:string}>>({});
const saving=ref<string | null>(null);
const order=ref<string[]>();
const rows=computed(()=>order.value?[...props.rows].sort((a,b)=>{const rank=(id:unknown)=>{const index=order.value!.indexOf(String(id));return index<0?order.value!.length:index;};return rank(a.id)-rank(b.id);}):props.rows);
const isPinned = (row: Record<string, unknown>) => Boolean(changed.value[String(row.id)]?.pinned ?? row.pinned);
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
   const id = String(row.id);
   saving.value = id;
  try{
    const endpoint=`/api/product-assets/${encodeURIComponent(props.asset.id)}/overlay`;
     const response=await nodeApiRequest(endpoint);const overlay=await response.json();if(!response.ok)throw new Error(overlay.error?.message??t('common.error'));
    const workspace=personalWorkspaceSchema.parse(overlay.workspace??defaultPersonalWorkspace());
     const index=workspace.pinnedAnalyses.findIndex(item=>item.sessionId===id);
     if(action==='toggle'){if(index<0)workspace.pinnedAnalyses.push({sessionId:id,title:resourceTitle(row).slice(0,200)});else workspace.pinnedAnalyses.splice(index,1);}
     else if(index>=0&&action==='rename'){const result=await ElMessageBox.prompt(t('ontology.productName'),t('ontology.productRenamePinned'),{inputValue:workspace.pinnedAnalyses[index].title,inputValidator: value => !!value?.trim() && value.trim().length<=200});workspace.pinnedAnalyses[index].title=result.value.trim();}
    else if(index>0&&action==='up'){const [item]=workspace.pinnedAnalyses.splice(index,1);workspace.pinnedAnalyses.splice(index-1,0,item);}
     const saved=await nodeApiRequest(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:overlay.revision,workspace:personalWorkspaceSchema.parse(workspace)})});const result=await saved.json();if(!saved.ok)throw new Error(result.error?.message??t('common.error'));
    const selected=workspace.pinnedAnalyses.find(item=>item.sessionId===id);changed.value[id]={pinned:!!selected,title:selected?.title??String(row.title??id)};
    order.value=workspace.pinnedAnalyses.map(item=>item.sessionId);
   }catch(reason){if(reason!=='cancel'&&reason!=='close')ElMessage.error(reason instanceof Error?reason.message:t('common.error'));}finally{saving.value=null;}
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
    <div v-if="!loading&&!rows.length" class="collection-empty"><p>{{({ 'platform:FavoriteApplication':t('ontology.productEmptyFavoriteApplications'),'platform:Conversation':t('ontology.productEmptyConversations'),'platform:Task':t('ontology.productEmptyTasks'),'platform:Favorite':t('ontology.productEmptyFavorites'),'platform:RecentVisit':t('ontology.productEmptyRecent'),'platform:Dashboard':t('ontology.productEmptyDashboards')} as Record<string,string>)[objectType]??t('ontology.productEmptyContent')}}</p><el-button v-if="objectType==='platform:FavoriteApplication'" text @click="router.push('/applications')">{{t('ontology.productGoToGallery')}} <ArrowUpRight :size="14"/></el-button></div>
    <div :class="{'application-shortcuts':objectType==='platform:FavoriteApplication'}"><article v-for="row in rows" :key="String(row.id)" class="collection-row">
      <span v-if="objectType==='platform:FavoriteApplication' || objectType==='platform:Conversation' || objectType==='platform:RecentVisit'" class="row-icon" :class="{'recent-visit-icon':objectType==='platform:RecentVisit'}">
        <ApplicationGlyph v-if="objectType==='platform:FavoriteApplication'" :icon="application(row.id)?.icon ?? 'app-window'" :size="16" />
        <component v-else :is="objectType==='platform:Conversation' ? MessageSquare : (rowApplication(row) ? appIcon(rowApplication(row)!.icon) : History)" :size="16" aria-hidden="true" />
      </span>
      <div class="row-content">
      <el-button text class="resource-title" :title="resourceTitle(row)" @click="open(row)">{{resourceTitle(row)}}</el-button>
      <template v-if="objectType==='platform:Task'">
        <span class="row-status" :class="{ paused: row.pause, running: row.activeRunId && !row.pause }">{{row.pause?t('ontology.productTaskPaused'):row.activeRunId?t('ontology.productTaskRunning'):row.enabled?t('ontology.productTaskEnabled'):t('ontology.productTaskDisabled')}}</span>
        <p v-if="row.pauseMessage" :title="String(row.pauseMessage)">{{summary(row.pauseMessage)}}</p><p v-else-if="row.resultSummary" :title="String(row.resultSummary)">{{summary(row.resultSummary)}}</p>
      </template>
      <dl v-else><template v-for="field in asset.document.kind==='collection-view'?asset.document.fields.filter(field=>!['title','name','id','path','primaryKey','agentId','pinned','className'].includes(field)):[]" :key="field"><dt>{{fieldLabel(field)}}</dt><dd>{{fieldValue(field,rowValue(row,field))}}</dd></template></dl>
      </div>
      <div v-if="objectType==='platform:Task'" class="row-actions">
        <el-button v-if="typeof row.resultPath==='string'&&row.resultPath.startsWith('/')&&!row.resultPath.startsWith('//')" text class="result-action" @click="router.push(row.resultPath)">{{t('ontology.productViewResult')}} <ArrowRight :size="12" aria-hidden="true" /></el-button>
      </div>
      <div v-else-if="objectType==='platform:Conversation'" class="row-actions">
        <ElTooltip v-bind="actionTooltipProps" :content="t(isPinned(row) ? 'ontology.productUnpin' : 'ontology.productPin')">
          <el-button text class="row-icon-action bookmark-action" :class="{ 'is-bookmarked': isPinned(row) }" :loading="saving === String(row.id)" :disabled="saving !== null" :aria-label="t('ontology.productPin')" :aria-pressed="isPinned(row)" @click="pin(row,'toggle')">
            <Bookmark v-if="saving !== String(row.id)" :size="16" aria-hidden="true" />
          </el-button>
        </ElTooltip>
        <el-dropdown v-if="isPinned(row)" trigger="click" placement="bottom-end" :disabled="saving !== null" @command="(action: 'rename' | 'up') => pin(row, action)">
          <el-button text class="row-icon-action" :aria-label="t('common.more', 'More')"><Ellipsis :size="16" aria-hidden="true" /></el-button>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item command="rename">{{t('ontology.productRename')}}</el-dropdown-item>
            <el-dropdown-item command="up">{{t('ontology.productMoveUp')}}</el-dropdown-item>
          </el-dropdown-menu></template>
        </el-dropdown>
      </div>
      <ChevronRight v-else-if="objectType==='platform:FavoriteApplication' || objectType==='platform:RecentVisit'" class="row-chevron" :size="14" aria-hidden="true" />
    </article></div>
  </div>
</template>
<style scoped>
.platform-collection{min-width:0;font-size:var(--text-sm);line-height:var(--leading-sm)}
.collection-row{position:relative;display:flex;align-items:flex-start;gap:var(--spacing-sm);padding:var(--spacing-sm);min-width:0;border-radius:var(--radius-md)}
.collection-row:hover,.collection-row:focus-within{background:var(--el-fill-color-light)}
.row-content{display:flex;flex:1;flex-direction:column;align-items:flex-start;min-width:0}
.row-actions{position:relative;display:flex;flex:none;gap:var(--spacing-xs);align-items:center}
.row-actions .el-button{margin:0;padding-inline:var(--spacing-xs);height:var(--control-height-sm);color:var(--el-text-color-secondary)}
.row-icon-action{width:var(--control-height-sm)}
.row-icon-action:hover,.result-action:hover,.row-icon-action.is-bookmarked{color:var(--el-text-color-primary)}
.bookmark-action.is-bookmarked :deep(svg){fill:currentColor}
.result-action :deep(span){gap:var(--spacing-xs)}
.row-status{display:inline-flex;align-items:center;gap:var(--spacing-xs);font-size:var(--text-xs);color:var(--el-text-color-secondary)}
.row-status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.row-status.paused{color:var(--el-color-warning-text)}
.row-status.running{color:var(--el-color-success-text)}
.row-icon{display:grid;place-items:center;flex:none;width:var(--control-height-sm);height:var(--control-height-sm);border-radius:var(--radius-sm);background:var(--el-fill-color);color:var(--el-text-color-secondary)}
.row-icon.recent-visit-icon{color:var(--el-color-primary)}
.row-chevron{flex:none;margin-top:7px;color:var(--el-text-color-secondary)}
.resource-title{position:static;max-width:100%;height:auto;min-height:var(--control-height-sm);text-align:start;padding:0;color:var(--el-text-color-primary)}
.resource-title::after{content:'';position:absolute;inset:0;border-radius:var(--radius-md)}
.resource-title:focus-visible::after{outline:2px solid var(--brand-link);outline-offset:-2px}
.resource-title.is-text:hover:not(.is-disabled){background:transparent}
.resource-title :deep(span){display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow:hidden;overflow-wrap:anywhere}
.platform-collection p{margin:var(--spacing-xs) 0 0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
dl{display:flex;gap:var(--spacing-xs) var(--spacing-sm);flex-wrap:wrap;margin:var(--spacing-xs) 0 0;font-size:var(--text-xs);color:var(--el-text-color-secondary)}dd{margin:0;overflow-wrap:anywhere}
</style>
<style scoped>
.collection-empty{padding:var(--spacing-md) 0;color:var(--el-text-color-secondary);font-size:var(--text-sm)}
.collection-empty p{margin:0 0 var(--spacing-sm);display:block}
.application-shortcuts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--spacing-xs) var(--spacing-sm)}
.application-shortcuts .resource-title{font-weight:var(--font-semibold)}
.application-shortcuts dl dt{display:none}
.application-shortcuts dd{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
@container ontology-manager (max-width:420px){.application-shortcuts{grid-template-columns:minmax(0,1fr)}}
</style>
