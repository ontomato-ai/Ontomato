<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { MoreHorizontal, Plus } from "lucide-vue-next";
import { pageDraftLink, readPageDraft, withoutPageDraftQuery, type PageDraftLink } from "@ontomato/agent-shell-ui";
import { createAssistantClient } from "../../workbench/assistant-host";
import { useDashboardStore } from "../stores/dashboard";
import DashboardPanel from "./DashboardPanel.vue";
import { acceptDraft, boardIdentity, DASHBOARD_PAGE_KEY, DraftRejected, type AcceptedDraft } from "../draft";
import { dashboardOperationSchema, type DashboardAuthoringForm, type DashboardOperation } from "@ontomato/contracts/dashboard";
import { fetchDashboardLocalDetail } from "../api";
import { cardError, type CardError } from "./utils/metricCard";

/**
 * The dashboard feature page of the workbench shell: dashboard tabs above the selected board. A link an agent wrote
 * may name a page draft: this page reads it, checks it against the board the reader owns, and hands it to the board,
 * which shows its changes and saves nothing until the reader says so.
 *
 * The page is the same at its own address and beside a conversation, so its draft comes from whichever address it is
 * shown at: the page's own query here, the conversation's `?page=` there. Both are the platform's page link, read the
 * one way the platform reads them.
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

/**
 * The address this page is shown at: its own query at its own address, the page parameter's own address beside a
 * conversation, which is where the platform's page link carries the board and the draft alike.
 */
function pageAddress(): Record<string, unknown> {
  const paired = typeof route.query.page === "string" ? route.query.page : "";
  return paired ? Object.fromEntries(new URLSearchParams(paired.split("?")[1] ?? "")) : route.query;
}

const link = computed(() => pageDraftLink(pageAddress()));

/**
 * The card chosen in the board, as the page's own address names it. The address carries it because the board is read
 * again elsewhere: the composer at the foot of this page sends the address into the conversation, which mounts the
 * board beside it, and the question written there is about the same card.
 */
const chosenCardId = computed(() => {
  const value = pageAddress().cardId;
  return typeof value === "string" ? value : "";
});

/**
 * Writes the chosen card into the address this page is shown at: its own query at its own address, the conversation's
 * page parameter beside one, which is the address the platform's composer sends.
 */
function writeCard(cardId: string | undefined) {
  if (!currentDashboardId.value) return;
  const paired = typeof route.query.page === "string" ? route.query.page : "";
  if (paired) {
    const [path, search = ""] = paired.split("?");
    const target = new URLSearchParams(search);
    if (cardId) target.set("cardId", cardId);
    else target.delete("cardId");
    void router.replace({ query: { ...route.query, page: `${path}${target.size ? `?${target}` : ""}` } });
    return;
  }
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(route.query)) if (typeof value === "string" && value) query[key] = value;
  if (cardId) query.cardId = cardId;
  else delete query.cardId;
  void router.replace({ query });
}

/**
 * The reader chose a card, or let go of it; the board it sits in is the one the address already names.
 *
 * Switching boards drops the card: the card chosen on the last board is not this one's.
 */
watch(
  () => currentDashboardId.value,
  (id, previous) => {
    if (previous && previous !== id) writeCard(undefined);
  },
);

/**
 * Reads the draft the link names through the platform's own reader, which checks the page it was written for and one of
 * this page's save actions, then hands it to the board only once the board it names is this reader's: every object a
 * draft addresses has to be that board's own.
 */
async function readDraft(pageLink: PageDraftLink) {
  const received = await readPageDraft<DashboardAuthoringForm<DashboardOperation>, DashboardOperation>(shell, pageLink, {
    pageKey: DASHBOARD_PAGE_KEY,
    operations: dashboardOperationSchema.options,
  });
  const form = received.form as { dashboardId?: string; id?: string };
  const id = String(form.dashboardId ?? form.id ?? "");
  const detail = await fetchDashboardLocalDetail(id);
  if (!detail) throw new DraftRejected(t("dashboard.draft.unavailable"));
  draft.value = acceptDraft({ ...received, pageKey: DASHBOARD_PAGE_KEY, form: received.form }, boardIdentity(detail));
  await store.selectDashboard(detail.id);
}

/** Dropping the draft only empties this page: the saved board stays as it was, and the address stops naming the draft. */
function discardDraft() {
  draft.value = null;
  draftFailure.value = null;
  if (typeof route.query.page === "string") return;
  void router.replace({ query: withoutPageDraftQuery(route.query) as Record<string, string> });
}

const failureText = computed(() => draftFailure.value?.message ?? "");

onMounted(async () => {
  await store.loadDashboards({ notifyError: true });
  if (link.value) {
    try {
      await readDraft(link.value);
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
  () => pageAddress(),
  (address, previous) => {
    const next = pageDraftLink(address);
    const before = pageDraftLink(previous ?? {});
    if (next?.sessionId === before?.sessionId && next?.runId === before?.runId && next?.path === before?.path) return;
    if (next) void readDraft(next).catch((error: unknown) => { draftFailure.value = cardError(error); });
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
        :card-id="chosenCardId"
        @discard-draft="discardDraft"
        @select-card="(card: { id: string } | null) => writeCard(card ? card.id : undefined)"
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
