<script setup lang="ts">
import {computed,inject,onMounted,ref} from 'vue';
import {useRouter} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {Search} from 'lucide-vue-next';
import {createAssistantClient} from '@ontomato/workbench-ui/features/workbench/assistant-host';
import type {AgentHostAgent} from '@ontomato/contracts/agent-host';
import type {HomeItemRef} from '@ontomato/contracts/platform-home';
import {HomeTile,homeCategories,homeItems,itemKey,itemRef,matches,readHomeState,saveFavorites,type HomeCategory,type HomeItem} from '../features/home';
import {openApplicationKey,platformApplicationsKey} from '../apps';
import {useApplicationCatalog} from '../catalog';
import AppPage from './AppPage.vue';
const {t,locale}=useI18n(),router=useRouter(),catalog=useApplicationCatalog();
const applications=inject(platformApplicationsKey)!,openApplication=inject(openApplicationKey)!;
const agents=ref<AgentHostAgent[]>([]),favorites=ref<HomeItemRef[]>([]),query=ref(''),category=ref<HomeCategory>('all');
const loading=ref(true),saving=ref(false),error=ref('');
const items=computed(()=>homeItems(applications.value,agents.value));
const shown=computed(()=>items.value.filter(item=>(category.value==='all'||item.category===category.value)&&matches(item,query.value)));
const favoriteKeys=computed(()=>new Set(favorites.value.map(itemKey)));
const labels=computed(()=>locale.value.startsWith('zh')?{title:'应用广场',description:'发现应用与智能体，收藏后从主页快速进入',empty:'没有匹配的应用',search:'搜索应用或智能体',retry:'重试'}:{title:'Application gallery',description:'Discover applications and agents; pin shortcuts to your home',empty:'No matching applications',search:'Search applications or agents',retry:'Retry'});
async function load(){loading.value=true;error.value='';try{const [list,state]=await Promise.all([createAssistantClient().listAgents(),readHomeState(),catalog.refresh()]);agents.value=list;favorites.value=state.favorites;if(catalog.error.value)throw new Error(catalog.error.value);}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{loading.value=false;}}
onMounted(()=>void load());
function open(item:HomeItem){if(item.kind==='application')openApplication(item.id);else void router.push({path:'/agents/chat',query:{agentId:item.id}});}
async function toggle(item:HomeItem){if(saving.value)return;saving.value=true;error.value='';try{const current=(await readHomeState()).favorites;const key=itemKey(item);const next=current.some(ref=>itemKey(ref)===key)?current.filter(ref=>itemKey(ref)!==key):[...current,itemRef(item)];favorites.value=await saveFavorites(next);}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{saving.value=false;}}
</script>
<template>
  <AppPage :title="labels.title" :description="labels.description" :labels="{save:'',discard:'',unsavedChanges:''}">
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button text @click="load">{{labels.retry}}</el-button></el-alert>
    <div class="gallery-toolbar"><nav aria-label="应用分类"><button v-for="value in homeCategories" :key="value" :class="{active:category===value}" :aria-pressed="category===value" @click="category=value">{{t(`home.categories.${value}`)}}</button></nav><el-input v-model="query" clearable :placeholder="labels.search" :aria-label="labels.search"><template #prefix><Search :size="16"/></template></el-input></div>
    <el-skeleton v-if="loading" :rows="5" animated/>
    <div v-else-if="shown.length" class="gallery-grid" :aria-busy="saving"><HomeTile v-for="item in shown" :key="itemKey(item)" :item="item" :favorite="favoriteKeys.has(itemKey(item))" @open="open(item)" @toggle-favorite="toggle(item)"/></div>
    <el-empty v-else :description="labels.empty" :image-size="64"/>
  </AppPage>
</template>
<style scoped>
.gallery-toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--spacing-lg);flex-wrap:wrap;margin-bottom:var(--page-content-gap)}.gallery-toolbar nav{display:flex;gap:var(--spacing-xs);flex-wrap:wrap}.gallery-toolbar nav button{font:inherit;font-size:var(--text-sm);padding:var(--spacing-sm) var(--spacing-md);border:0;border-radius:var(--radius-sm);background:transparent;color:var(--el-text-color-secondary);cursor:pointer}.gallery-toolbar nav button.active{background:var(--el-color-primary-light-9);color:var(--el-color-primary)}.gallery-toolbar nav button:hover{background:var(--el-fill-color-light)}.gallery-toolbar .el-input{width:280px;max-width:100%}.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:var(--spacing-lg)}
</style>
