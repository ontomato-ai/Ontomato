<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { MoreHorizontal, Plus } from "lucide-vue-next";
import { pageDraftPathSchema, type PageDraft } from "@ontomato/contracts/page-draft";
import { createAssistantClient } from "../../workbench/assistant-host";
import { useDashboardStore } from "../stores/dashboard";
import DashboardPanel from "./DashboardPanel.vue";
import { acceptDraft, boardIdentity, DraftRejected, type AcceptedDraft } from "../draft";
import { fetchDashboardLocalDetail } from "../api";
import { cardError, type CardError } from "./utils/metricCard";

/**
 * The dashboard feature page of the workbench shell: dashboard tabs above the selected board. A link an agent wrote
 * may name a page draft: this page reads it, checks it against the board the reader owns, and hands it to the board,
 * which shows its changes and saves nothing until the reader says so.
 */
const { t } = useI18n();
const store = useDashboardStore();
const route = useRoute();
const router = useRouter();
const openMenuId = ref<string | null>(null);
const { dashboardItems, loadingDashboards, currentDashboardId, editingDashboardId, editingDashboardName } =
  storeToRefs(store);
const shell = createAssistantClient();

const draft = ref<AcceptedDraft | null>(null);
const draftFailure = ref<CardError | null>(null);

/** The three values a draft link carries: the run artifact and nothing else. */
function draftLink() {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const sessionId = text(route.query.draftSessionId);
  const runId = text(route.query.draftRunId);
  // The path is an address, not a form: the draft file's own location is all it may name.
  const path = pageDraftPathSchema.safeParse(text(route.query.draftPath));
  return sessionId && runId && path.success ? { sessionId, runId, path: path.data } : null;
}

/**
 * Reads the draft the link names, and fills it only after this page and the board agree with it: its page key, its
 * save action, the board it names, and every object it addresses. A rejection states what did not match.
 */
async function readDraft(link: { sessionId: string; runId: string; path: string }) {
  const file: PageDraft<Record<string, unknown>> = await shell.readPageDraft(link.sessionId, link.runId, link.path);
  const id = String((file.form as { dashboardId?: string; id?: string }).dashboardId ?? (file.form as { id?: string }).id ?? "");
  const detail = await fetchDashboardLocalDetail(id);
  if (!detail) throw new DraftRejected(t("dashboard.draft.unavailable"));
  draft.value = acceptDraft(file, boardIdentity(detail));
  await store.selectDashboard(detail.id);
}

function discardDraft() {
  draft.value = null;
  draftFailure.value = null;
  void router.replace({ query: { dashboardId: currentDashboardId.value || undefined } });
}

const failureText = computed(() => draftFailure.value?.message ?? "");

onMounted(async () => {
  await store.loadDashboards({ notifyError: true });
  const link = draftLink();
  if (link) {
    try {
      await readDraft(link);
      return;
    } catch (error) {
      draftFailure.value = cardError(error);
      // A draft this page cannot fill leaves the reader on their own board.
    }
  }
  if (!currentDashboardId.value && dashboardItems.value[0])
    void store.selectDashboard(dashboardItems.value[0].id);
});

watch(
  () => route.query,
  (query, previous) => {
    if (query.draftSessionId === previous?.draftSessionId && query.draftRunId === previous?.draftRunId && query.draftPath === previous?.draftPath) return;
    const link = draftLink();
    if (link) void readDraft(link).catch((error: unknown) => { draftFailure.value = cardError(error); });
    else if (draft.value) discardDraft();
  },
);
</script>

<template>
  <div class="dashboard-home">
    <!-- The page's own bar: its boards and the way to make one. The title above it is the application header's. -->
    <div class="home-bar" role="tablist" :aria-label="t('analysis.myDashboards')">
      <div v-loading="loadingDashboards" class="tabs">
        <div
          v-for="item in dashboardItems"
          :key="item.id"
          class="tab"
          :class="{ active: item.id === currentDashboardId, 'menu-open': item.id === openMenuId }"
        >
          <el-input
            v-if="editingDashboardId === item.id"
            v-model="editingDashboardName"
            size="small"
            class="rename"
            @keydown.enter.stop.prevent="store.saveDashboardRename(item)"
            @keydown.esc.stop.prevent="store.cancelDashboardRename()"
            @blur="store.saveDashboardRename(item)"
          />
          <template v-else>
            <button
              type="button"
              role="tab"
              class="tab-open"
              :aria-selected="item.id === currentDashboardId"
              @click="store.openDashboard(item.id)"
            >
              {{ item.name }}
            </button>
            <el-dropdown
              trigger="click"
              placement="bottom-end"
              :popper-options="dropdownBoundaryOptions"
              @visible-change="(visible: boolean) => { if (visible) openMenuId = item.id; else if (openMenuId === item.id) openMenuId = null; }"
              @command="(command: string) => store.handleDashboardCommand(command, item)"
            >
              <button type="button" class="tab-more" :aria-label="t('common.more')">
                <MoreHorizontal :size="14" />
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">{{ t("common.rename") }}</el-dropdown-item>
                  <el-dropdown-item command="delete">{{ t("common.delete") }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>
      <el-button class="create" @click="store.promptCreateDashboard()">
        <Plus :size="15" />
        <span>{{ t("analysis.createDashboard") }}</span>
      </el-button>
    </div>
    <p v-if="failureText" class="draft-failure" role="alert">{{ failureText }}</p>
    <div class="home-body">
      <DashboardPanel
        v-if="currentDashboardId"
        :key="`${currentDashboardId}:${draft ? draft.operation : 'saved'}`"
        :dashboard-id="currentDashboardId"
        :draft="draft"
        @discard-draft="discardDraft"
      />
      <el-empty v-else-if="!loadingDashboards" :description="t('analysis.noDashboards')" />
    </div>
  </div>
</template>

<style scoped>
.dashboard-home {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.home-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  padding-bottom: var(--spacing-md);
  flex-wrap: wrap;
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color);
}
.draft-failure {
  margin: var(--spacing-sm) 0 0;
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
.home-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0;
}
.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  flex-shrink: 0;
}
.tab:hover {
  background: var(--el-fill-color);
}
.tab.active {
  background: var(--el-fill-color-dark);
}
.tab-open {
  height: 32px;
  padding: 0 4px 0 12px;
  border: 0;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.tab.active .tab-open {
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.tab-more {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-right: 3px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-tertiary);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast);
}
.tab:hover .tab-more,
.tab:focus-within .tab-more,
.tab.menu-open .tab-more {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .tab-more { opacity: 1; pointer-events: auto; }
}
.tab-more:hover {
  color: var(--el-text-color-primary);
}
.rename {
  width: 160px;
}
.create :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
@container platform-page (max-width: 600px) {
  .tabs { flex-basis: 100%; }
}
</style>
