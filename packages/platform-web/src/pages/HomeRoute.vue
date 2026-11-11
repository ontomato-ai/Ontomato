<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { LayoutDashboard, Search } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import type { HomeItemRef, HomeState } from "@ontomato/contracts/platform-home";
import { usePlatformHost } from "@ontomato/platform-admin";
import { PlatformTabs } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { readRememberedAgent } from "@ontomato/workbench-ui";
import { fetchDashboardList } from "@ontomato/workbench-ui/features/dashboard";
import { createAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { openApplicationKey, platformApplicationsKey } from "../apps";
import { useApplicationCatalog } from "../catalog";
import {
  DashboardPicker,
  HomeAsk,
  HomeContinue,
  HomeDashboards,
  HomeTile,
  homeCategories,
  homeItems,
  itemKey,
  itemRef,
  itemsOf,
  matches,
  moved,
  readHomeState,
  recentApplications,
  recentConversations,
  saveDashboards,
  saveFavorites,
  type HomeCategory,
  type HomeItem,
  type RecentConversation,
} from "../features/home";

/**
 * The platform's home, where everyone starts. It answers "what do I do today, and where did I leave off" first: a
 * greeting and a question for an agent; the reader's favourites; the conversations and applications they used last; the
 * dashboards they chose to see here. The square of every application and agent they may open comes last.
 *
 * Names, descriptions, icons and entries come from the application catalog the rail shows and from the agent list; the
 * home's own state only holds references, times and the latest conversations, so an item the reader can no longer open
 * is simply not shown. A reader with nothing of their own sees the square straight under the question.
 */
const { t } = useI18n();
const router = useRouter();
const host = usePlatformHost();
const applications = inject(platformApplicationsKey)!;
const openApplication = inject(openApplicationKey)!;
const catalog = useApplicationCatalog();
const agentClient = createAssistantClient();
/** The agent the agent platform last used, which the question box offers first. */
const remembered = readRememberedAgent();

const agents = ref<AgentHostAgent[]>([]);
const state = ref<HomeState | null>(null);
const dashboards = ref<DashboardListItem[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const items = computed(() => homeItems(applications.value, agents.value));
const agentItems = computed(() => items.value.filter((item) => item.kind === "agent"));
const favorites = computed(() => (state.value ? itemsOf(state.value.favorites, items.value) : []));
const favoriteKeys = computed(() => new Set(favorites.value.map(itemKey)));
const conversations = computed(() => (state.value ? recentConversations(state.value, items.value) : []));
const openedApplications = computed(() => (state.value ? recentApplications(state.value, items.value) : []));
const shownDashboards = computed(() => {
  const byId = new Map(dashboards.value.map((dashboard) => [dashboard.id, dashboard]));
  return (state.value?.dashboardIds ?? []).flatMap((id) => byId.get(id) ?? []);
});

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
const category = ref<HomeCategory>("all");
const categoryTabs = computed(() => homeCategories.map((id) => ({ id, label: t(`home.categories.${id}`) })));
const square = computed(() =>
  items.value.filter((item) => (category.value === "all" || item.category === category.value) && matches(item, query.value)),
);

const chat = platformRoutes.chat.path;

function openItem(item: HomeItem) {
  if (item.kind === "application") openApplication(item.id);
  // An agent opens in the agent platform, on a new conversation with it.
  else void router.push({ path: chat, query: { agentId: item.id } });
}

function ask(agentId: string, prompt: string) {
  void router.push({ path: chat, query: { agentId, prompt } });
}

function openConversation(conversation: RecentConversation) {
  void router.push({ path: chat, query: { agentId: conversation.agentId, sessionId: conversation.sessionId } });
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
    <div v-if="loadError" class="home-state" role="alert">
      <span>{{ t("home.loadFailed", { reason: loadError }) }}</span>
      <el-button :loading="loading" @click="load">{{ t("home.retry") }}</el-button>
    </div>
    <el-skeleton v-else-if="!ready" class="home-loading" :rows="5" animated />
    <template v-else>
      <HomeAsk :agents="agentItems" :remembered="remembered" :user-name="host.account?.userName ?? null" @ask="ask" />

      <section v-if="favorites.length > 0" class="home-section" aria-labelledby="home-favorites">
        <h2 id="home-favorites" class="home-heading">{{ t("home.favorites") }}</h2>
        <div class="home-tile-row">
          <HomeTile
            v-for="(item, index) in favorites"
            :key="itemKey(item)"
            :item="item"
            :position="{ first: index === 0, last: index === favorites.length - 1 }"
            draggable="true"
            :class="{ dragging: dragging === index }"
            @dragstart="dragging = index"
            @dragend="dragging = null"
            @dragover.prevent
            @drop.prevent="dropFavorite(index)"
            @open="openItem(item)"
            @move="moveFavorite(index, index + $event)"
          />
        </div>
      </section>

      <section v-if="conversations.length > 0 || openedApplications.length > 0" class="home-section" aria-labelledby="home-continue">
        <h2 id="home-continue" class="home-heading">{{ t("home.continue") }}</h2>
        <HomeContinue
          :conversations="conversations"
          :applications="openedApplications"
          @open-conversation="openConversation"
          @open-application="openItem"
        />
      </section>

      <!-- The reader's own dashboards: without one chosen, the section is its title and the button that chooses. -->
      <section v-if="dashboards.length > 0" class="home-section" aria-labelledby="home-dashboards">
        <div class="home-section-head">
          <h2 id="home-dashboards" class="home-heading">{{ t("home.dashboards") }}</h2>
          <el-button text @click="pickerOpen = true">
            <LayoutDashboard :size="16" aria-hidden="true" />
            <span class="home-button-label">{{ t("home.chooseDashboards") }}</span>
          </el-button>
        </div>
        <HomeDashboards v-if="shownDashboards.length > 0" :dashboards="shownDashboards" />
      </section>

      <section class="home-section" aria-labelledby="home-square">
        <div class="home-section-head">
          <h2 id="home-square" class="home-heading">{{ t("home.square") }}</h2>
          <el-input
            v-model="query"
            class="home-search"
            clearable
            :placeholder="t('home.squareSearch')"
            :aria-label="t('home.squareSearch')"
          >
            <template #prefix><Search :size="16" aria-hidden="true" /></template>
          </el-input>
        </div>
        <PlatformTabs :tabs="categoryTabs" :active-id="category" :label="t('home.square')" @select="category = $event as HomeCategory" />
        <div v-if="square.length > 0" class="home-square">
          <HomeTile
            v-for="item in square"
            :key="itemKey(item)"
            :item="item"
            :favorite="favoriteKeys.has(itemKey(item))"
            @open="openItem(item)"
            @toggle-favorite="toggleFavorite(item)"
          />
        </div>
        <p v-else class="home-empty">{{ query.trim() ? t("home.noMatches") : t("home.noItems") }}</p>
      </section>

      <DashboardPicker
        v-model="pickerOpen"
        :dashboards="dashboards"
        :shown="shownDashboards.map((dashboard) => dashboard.id)"
        :saving="savingDashboards"
        @save="saveDashboardIds"
      />
    </template>
  </div>
</template>

<style scoped>
.home-page {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--spacing-2xl);
  width: 100%;
  max-width: 1280px;
  margin-inline: auto;
  padding-block: var(--spacing-3xl) var(--spacing-2xl);
}
.home-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}
.home-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm) var(--spacing-lg);
}
.home-heading {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg);
}
.home-button-label {
  margin-left: var(--spacing-xs);
}
.home-search {
  width: 280px;
  max-width: 100%;
}
/* The favourites: one compact row of names that wraps rather than scroll out of reach. */
.home-tile-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.home-tile-row > * {
  width: 200px;
}
.home-tile-row .dragging {
  opacity: 0.5;
}
.home-square {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--spacing-sm);
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
