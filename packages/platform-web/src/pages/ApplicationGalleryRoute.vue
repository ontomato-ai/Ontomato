<script setup lang="ts">
import {computed,inject,onMounted,ref} from 'vue';
import {useRouter} from 'vue-router';
import {useI18n} from 'vue-i18n';
import {AppWindow, Search} from 'lucide-vue-next';
import {createAssistantClient} from '@ontomato/workbench-ui/features/workbench/assistant-host';
import type {AgentHostAgent} from '@ontomato/contracts/agent-host';
import type {HomeItemRef} from '@ontomato/contracts/platform-home';
import {HomeTile,homeCategories,homeItems,itemKey,itemRef,matches,readHomeState,saveFavorites,type HomeCategory,type HomeItem} from '../features/home';
import {openApplicationKey,platformApplicationsKey} from '../apps';
import {useApplicationCatalog} from '../catalog';
import AppPage from './AppPage.vue';
const {t}=useI18n(),router=useRouter(),catalog=useApplicationCatalog();
const applications=inject(platformApplicationsKey)!,openApplication=inject(openApplicationKey)!;
const agents=ref<AgentHostAgent[]>([]),favorites=ref<HomeItemRef[]>([]),query=ref(''),category=ref<HomeCategory>('all');
const loading=ref(true),pendingFavorite=ref<string|null>(null),error=ref(''),favoriteError=ref('');
const items=computed(()=>homeItems(applications.value,agents.value));
const shown=computed(()=>items.value.filter(item=>(category.value==='all'||item.category===category.value)&&matches(item,query.value)));
const filtered=computed(()=>category.value!=='all'||!!query.value.trim());
function clearFilters(){query.value='';category.value='all';}
const favoriteKeys=computed(()=>new Set(favorites.value.map(itemKey)));
const labels=computed(()=>({title:t('ontology.productGalleryTitle'),description:t('ontology.productGalleryDescription'),empty:t('ontology.productGalleryEmpty'),search:t('ontology.productGallerySearch'),retry:t('ontology.productRetry')}));
async function load(){loading.value=true;error.value='';try{const [list,state]=await Promise.all([createAssistantClient().listAgents(),readHomeState(),catalog.refresh()]);agents.value=list;favorites.value=state.favorites;if(catalog.error.value)throw new Error(catalog.error.value);}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{loading.value=false;}}
onMounted(()=>void load());
function open(item:HomeItem){if(item.kind==='application')openApplication(item.id);else void router.push({path:'/agents/chat',query:{agentId:item.id}});}
async function toggle(item: HomeItem) {
  if (pendingFavorite.value) return;
  const key = itemKey(item);
  pendingFavorite.value = key;
  favoriteError.value = '';
  try {
    const current = (await readHomeState()).favorites;
    const next = current.some(ref => itemKey(ref) === key)
      ? current.filter(ref => itemKey(ref) !== key)
      : [...current, itemRef(item)];
    favorites.value = await saveFavorites(next);
  } catch (error) {
    favoriteError.value = error instanceof Error ? error.message : String(error);
  } finally {
    pendingFavorite.value = null;
  }
}
</script>
<template>
  <AppPage class="application-gallery" :title="labels.title" :description="labels.description" :labels="{save:'',discard:'',unsavedChanges:''}">
    <div class="gallery-content">
    <el-alert v-if="error" :title="error" type="error" :closable="false"><el-button text @click="load">{{labels.retry}}</el-button></el-alert>
    <el-alert v-if="favoriteError" :title="favoriteError" type="error" @close="favoriteError = ''" />
    <div class="gallery-toolbar"><nav :aria-label="t('ontology.productGalleryCategories')"><button v-for="value in homeCategories" :key="value" :class="{active:category===value}" :aria-pressed="category===value" @click="category=value">{{t(`home.categories.${value}`)}}</button></nav><el-input v-model="query" clearable :placeholder="labels.search" :aria-label="labels.search"><template #prefix><Search :size="16"/></template></el-input></div>
    <div v-if="loading" class="gallery-grid" aria-busy="true">
      <el-skeleton v-for="item in 6" :key="item" class="gallery-skeleton" :rows="2" animated />
    </div>
    <div v-else-if="shown.length" class="gallery-grid">
      <HomeTile v-for="item in shown" :key="itemKey(item)" :item="item" variant="preview"
        :favorite="favoriteKeys.has(itemKey(item))" :favorite-busy="pendingFavorite === itemKey(item)"
        :favorite-disabled="pendingFavorite !== null" @open="open(item)" @toggle-favorite="toggle(item)" />
    </div>
    <div v-else-if="!error" class="gallery-empty">
      <component :is="filtered ? Search : AppWindow" :size="24" aria-hidden="true" />
      <p role="status">{{ labels.empty }}</p>
      <el-button v-if="filtered" text :aria-label="`${t('common.clear')} · ${t('ontology.productGalleryCategories')}`" @click="clearFilters">{{ t('common.clear') }}</el-button>
    </div>
    </div>
  </AppPage>
</template>
<style scoped>
.gallery-content { width: min(100%, 1200px); margin-inline: auto; }
.gallery-content > .el-alert { margin-bottom: var(--spacing-md); }
.gallery-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--spacing-md); flex-wrap: wrap; margin-bottom: var(--page-content-gap); }
.gallery-toolbar nav { display: flex; flex-wrap: wrap; gap: var(--spacing-xs); max-width: 100%; padding: var(--spacing-xs); border-radius: var(--radius-md); background: var(--el-fill-color-light); }
.gallery-toolbar nav button {
  min-height: var(--control-height-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  cursor: pointer;
}
.gallery-toolbar nav button.active { background: var(--el-bg-color); color: var(--el-text-color-primary); box-shadow: var(--elevation-panel); }
.gallery-toolbar nav button:not(.active):hover { background: var(--el-color-primary-light-9); }
.gallery-toolbar .el-input { width: 280px; max-width: 100%; }
.gallery-skeleton { min-height: 108px; border: 1px solid var(--el-border-color); border-radius: var(--radius-lg); background: var(--el-bg-color); }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 256px), 1fr)); gap: var(--spacing-md); }
.gallery-skeleton { box-sizing: border-box; padding: var(--spacing-lg); }
.gallery-empty { display: grid; justify-items: center; gap: var(--spacing-sm); padding: var(--spacing-3xl) var(--spacing-lg); text-align: center; color: var(--el-text-color-secondary); }
.gallery-empty p { margin: 0; }
</style>
