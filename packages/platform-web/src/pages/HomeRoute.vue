<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { LayoutDashboard, Search } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import type { HomeItemRef, HomeState } from "@ontomato/contracts/platform-home";
import { PlatformTabs } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { fetchDashboardList } from "@ontomato/workbench-ui/features/dashboard";
import { createAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { openApplicationKey, platformApplicationsKey } from "../apps";
import { useApplicationCatalog } from "../catalog";
import {
  DashboardPicker,
  HomeCard,
  HomeDashboards,
  homeCategories,
  homeItems,
  itemKey,
  itemRef,
  itemsOf,
  matches,
  moved,
  readHomeState,
  recentItems,
  saveDashboards,
  saveFavorites,
  type HomeCategory,
  type HomeItem,
} from "../features/home";

/**
 * The platform's home, where everyone starts: a search over everything below; the reader's favourites and recently used
 * items; the dashboards they chose to see here; and the square of every application and agent they may open.
 *
 * Names, descriptions, icons and entries come from the application catalog the rail shows and from the agent list; the
 * home's own state only holds which items and dashboards the reader picked and when they last used each, so an item the
 * reader can no longer open is simply not shown. A new reader with nothing picked and nothing used sees the square
 * straight under the search.
 */
const { t } = useI18n();
const router = useRouter();
const applications = inject(platformApplicationsKey)!;
const openApplication = inject(openApplicationKey)!;
const catalog = useApplicationCatalog();
const agentClient = createAssistantClient();

const agents = ref<AgentHostAgent[]>([]);
const state = ref<HomeState | null>(null);
const dashboards = ref<DashboardListItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const items = computed(() => homeItems(applications.value, agents.value));
const favorites = computed(() => (state.value ? itemsOf(state.value.favorites, items.value) : []));
const favoriteKeys = computed(() => new Set(favorites.value.map(itemKey)));
const recent = computed(() => (state.value ? recentItems(state.value, items.value) : []));
const shownDashboards = computed(() => {
  const byId = new Map(dashboards.value.map((dashboard) => [dashboard.id, dashboard]));
  return (state.value?.dashboardIds ?? []).flatMap((id) => byId.get(id) ?? []);
});

type PersonalTab = "favorites" | "recent";
/** The tab the reader chose; until they choose, a reader with favourites sees them, one who only used things sees those. */
const personalChoice = ref<PersonalTab | null>(null);
const personalTab = computed<PersonalTab>(() => personalChoice.value ?? (favorites.value.length > 0 ? "favorites" : "recent"));
const personalTabs = computed(() => [
  { id: "favorites", label: t("home.favorites") },
  { id: "recent", label: t("home.recent") },
]);

/** Every request the home needs, read afresh each time the home is entered; the catalog is the shell's. */
async function load() {
  loading.value = true;
  loadError.value = null;
  try {
    [agents.value, state.value, dashboards.value] = await Promise.all([
      agentClient.listAgents(),
      readHomeState(),
      fetchDashboardList(),
    ]);
  } catch (error) {
    loadError.value = errorText(error);
  } finally {
    loading.value = false;
  }
}
void load();

const ready = computed(() => state.value !== null && !(catalog.loading.value && applications.value.length === 0));

const query = ref("");
const searching = computed(() => query.value.trim() !== "");
const shownFavorites = computed(() => favorites.value.filter((item) => matches(item, query.value)));
const shownRecent = computed(() => recent.value.filter((item) => matches(item, query.value)));

const category = ref<HomeCategory>("all");
const categoryTabs = computed(() => homeCategories.map((id) => ({ id, label: t(`home.categories.${id}`) })));
const square = computed(() =>
  items.value.filter((item) => (category.value === "all" || item.category === category.value) && matches(item, query.value)),
);

function openItem(item: HomeItem) {
  if (item.kind === "application") openApplication(item.id);
  // An agent opens in the agent platform, on a new conversation with it.
  else void router.push({ path: platformRoutes.chat.path, query: { agentId: item.id } });
}

/*
 * Favourites are saved whole, in order, as the reader shows them now: references the reader can no longer open drop out
 * with the next save. The edit stays on the page when saving fails; only the answer to the latest save is taken.
 */
let favoritesWrite = 0;
async function writeFavorites(next: HomeItemRef[]) {
  state.value = { ...state.value!, favorites: next };
  const write = ++favoritesWrite;
  try {
    const saved = await saveFavorites(next);
    if (write === favoritesWrite) state.value = { ...state.value!, favorites: saved };
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}

function toggleFavorite(item: HomeItem) {
  const current = favorites.value.map(itemRef);
  const key = itemKey(item);
  void writeFavorites(favoriteKeys.value.has(key) ? current.filter((ref) => itemKey(ref) !== key) : [...current, itemRef(item)]);
}

function moveFavorite(index: number, to: number) {
  void writeFavorites(moved(favorites.value.map(itemRef), index, to));
}

/** The favourite being dragged; a drop on another favourite puts it in that place. */
const dragging = ref<number | null>(null);
function dropFavorite(index: number) {
  if (dragging.value !== null && dragging.value !== index) moveFavorite(dragging.value, index);
  dragging.value = null;
}

const pickerOpen = ref(false);
const savingDashboards = ref(false);
async function saveDashboardIds(ids: string[]) {
  savingDashboards.value = true;
  try {
    const saved = await saveDashboards(ids);
    state.value = { ...state.value!, dashboardIds: saved };
    pickerOpen.value = false;
  } catch (error) {
    ElMessage.error(errorText(error));
  } finally {
    savingDashboards.value = false;
  }
}
</script>

<template>
  <div class="home-page platform-page-gutter">
    <h1 class="home-title">{{ t("home.title") }}</h1>
    <div class="home-toolbar">
      <el-input
        v-model="query"
        class="home-search"
        clearable
        :placeholder="t('home.search')"
        :aria-label="t('home.search')"
      >
        <template #prefix><Search :size="16" aria-hidden="true" /></template>
      </el-input>
      <el-button :disabled="!ready" @click="pickerOpen = true">
        <LayoutDashboard :size="16" aria-hidden="true" />
        <span class="home-button-label">{{ t("home.chooseDashboards") }}</span>
      </el-button>
    </div>

    <div v-if="loadError" class="home-state" role="alert">
      <span>{{ t("home.loadFailed", { reason: loadError }) }}</span>
      <el-button :loading="loading" @click="load">{{ t("home.retry") }}</el-button>
    </div>
    <el-skeleton v-else-if="!ready" class="home-loading" :rows="5" animated />
    <template v-else>
      <section v-if="favorites.length > 0 || recent.length > 0" class="home-section" :aria-label="t('home.personal')">
        <PlatformTabs :tabs="personalTabs" :active-id="personalTab" :label="t('home.personal')" @select="personalChoice = $event as PersonalTab" />
        <template v-if="personalTab === 'favorites'">
          <div v-if="shownFavorites.length > 0" class="home-grid">
            <HomeCard
              v-for="(item, index) in shownFavorites"
              :key="itemKey(item)"
              :item="item"
              favorite
              :position="searching ? undefined : { first: index === 0, last: index === shownFavorites.length - 1 }"
              :draggable="!searching"
              :class="{ dragging: dragging === index }"
              @dragstart="dragging = index"
              @dragend="dragging = null"
              @dragover.prevent
              @drop.prevent="dropFavorite(index)"
              @open="openItem(item)"
              @toggle-favorite="toggleFavorite(item)"
              @move="moveFavorite(index, index + $event)"
            />
          </div>
          <p v-else class="home-empty">{{ searching ? t("home.noMatches") : t("home.noFavorites") }}</p>
        </template>
        <template v-else>
          <div v-if="shownRecent.length > 0" class="home-grid">
            <HomeCard
              v-for="item in shownRecent"
              :key="itemKey(item)"
              :item="item"
              :favorite="favoriteKeys.has(itemKey(item))"
              @open="openItem(item)"
              @toggle-favorite="toggleFavorite(item)"
            />
          </div>
          <p v-else class="home-empty">{{ searching ? t("home.noMatches") : t("home.noRecent") }}</p>
        </template>
      </section>

      <section v-if="shownDashboards.length > 0" class="home-section">
        <h2 class="home-heading">{{ t("home.dashboards") }}</h2>
        <HomeDashboards :dashboards="shownDashboards" />
      </section>

      <section class="home-section">
        <h2 class="home-heading">{{ t("home.square") }}</h2>
        <PlatformTabs :tabs="categoryTabs" :active-id="category" :label="t('home.square')" @select="category = $event as HomeCategory" />
        <div v-if="square.length > 0" class="home-grid">
          <HomeCard
            v-for="item in square"
            :key="itemKey(item)"
            :item="item"
            :favorite="favoriteKeys.has(itemKey(item))"
            @open="openItem(item)"
            @toggle-favorite="toggleFavorite(item)"
          />
        </div>
        <p v-else class="home-empty">{{ searching ? t("home.noMatches") : t("home.noItems") }}</p>
      </section>
    </template>

    <DashboardPicker
      v-if="ready"
      v-model="pickerOpen"
      :dashboards="dashboards"
      :shown="shownDashboards.map((dashboard) => dashboard.id)"
      :saving="savingDashboards"
      @save="saveDashboardIds"
    />
  </div>
</template>

<style scoped>
.home-page {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--spacing-2xl);
  width: 100%;
  max-width: 1440px;
  margin-inline: auto;
  padding-block: var(--spacing-xl) var(--spacing-2xl);
}
/* The page is named for assistive technology; the rail's selected row already names it on screen. */
.home-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.home-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
  align-items: center;
}
.home-search {
  flex: 1 1 320px;
  max-width: 640px;
}
.home-button-label {
  margin-left: var(--spacing-xs);
}
.home-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
.home-heading {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
}
.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--spacing-md);
}
.home-grid .dragging {
  opacity: 0.5;
}
.home-empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.home-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
</style>
