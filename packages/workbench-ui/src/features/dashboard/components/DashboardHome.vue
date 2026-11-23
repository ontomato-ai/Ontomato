<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from "lucide-vue-next";
import type { DisplayObjectRefresh, DisplayPageController } from "@ontomato/agent-shell-ui";
import type { FormFillOutcome, FormFillRequestInput, PageActionOutcome, PageActionRequestInput } from "@ontomato/contracts/agent-presentation";
import { useDashboardStore } from "../stores/dashboard";
import DashboardPanel from "./DashboardPanel.vue";

/**
 * The dashboard feature page of the workbench shell: dashboard tabs above the selected board.
 *
 * The page is the same at its own address and beside a conversation, so its selection rides in whichever address it is
 * shown at: the page's own query here, the conversation's `?page=` there. When mounted beside a conversation, it
 * registers a `DisplayPageController` so live `present` state updates, `fill_form`, and `page_action` operate on the
 * currently displayed board directly.
 */
const props = defineProps<{
  objectRefresh?: DisplayObjectRefresh | null;
  registerPageController?: (controller: DisplayPageController) => () => void;
}>();
const emit = defineEmits<{ "display-dirty": [dirty: boolean] }>();

const { t } = useI18n();
const store = useDashboardStore();
const route = useRoute();
const router = useRouter();
const openMenuId = ref<string | null>(null);
const panelDirty = ref(false);
const boardPreviewActive = ref(false);
const previewBlockedReason = computed(() => t("dashboard.previewLocksBoardEdits"));
const panelRef = ref<{
  reload: () => Promise<void>;
  selectCardById: (cardId: string) => boolean;
  fillForm: (request: FormFillRequestInput) => Promise<FormFillOutcome>;
  executeAction: (request: PageActionRequestInput) => Promise<PageActionOutcome>;
} | null>(null);
const { dashboardItems, loadingDashboards, currentDashboardId, editingDashboardId, editingDashboardName } =
  storeToRefs(store);

function onPanelDirty(dirty: boolean) {
  panelDirty.value = dirty;
  emit("display-dirty", dirty);
}

function onBoardPreviewActive(active: boolean) {
  boardPreviewActive.value = active;
}

watch(currentDashboardId, (next, prev) => {
  if (next !== prev) {
    if (boardPreviewActive.value) boardPreviewActive.value = false;
    if (panelDirty.value) onPanelDirty(false);
  }
});

async function confirmDiscardUnsaved(): Promise<boolean> {
  if (!panelDirty.value) return true;
  try {
    await ElMessageBox.confirm(t("platform.formDiscardConfirm"), t("platform.unsavedChanges"), {
      confirmButtonText: t("platform.discard"),
      cancelButtonText: t("common.cancel"),
      type: "warning",
    });
    return true;
  } catch {
    return false;
  }
}

async function openDashboardTab(id: string) {
  if (id === currentDashboardId.value) return;
  if (!(await confirmDiscardUnsaved())) return;
  onPanelDirty(false);
  store.openDashboard(id);
}

async function createDashboard() {
  if (!(await confirmDiscardUnsaved())) return;
  await store.promptCreateDashboard();
}

function handleDashboardCommand(command: string, item: { id: string; name: string }) {
  if (boardPreviewActive.value && item.id === currentDashboardId.value) return;
  store.handleDashboardCommand(command, item);
}

onBeforeUnmount(() => {
  if (panelDirty.value) emit("display-dirty", false);
});

/**
 * The address this page is shown at: its own query at its own address, the page parameter's own address beside a
 * conversation.
 */
function pageAddress(): Record<string, unknown> {
  const paired = typeof route.query.page === "string" ? route.query.page : "";
  return paired ? Object.fromEntries(new URLSearchParams(paired.split("?")[1] ?? "")) : route.query;
}

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
 * Replaces the address this page is shown at: its own query at its own address, the conversation's page parameter
 * beside one, which is the address the platform's composer sends; that parameter keeps its path, and the conversation
 * keeps its own parameters.
 */
function replaceAddress(query: Record<string, string>) {
  const paired = typeof route.query.page === "string" ? route.query.page : "";
  if (!paired) {
    void router.replace({ query });
    return;
  }
  const search = new URLSearchParams(query);
  void router.replace({ query: { ...route.query, page: `${paired.split("?")[0]}${search.size ? `?${search}` : ""}` } });
}

/**
 * Writes the chosen card into the address this page is shown at. The card travels with its name and the board with its
 * own, because the message names a selection by its name and the page's skill finds it by its id.
 */
function writeCard(card: { id: string; name: string } | null) {
  const board = dashboardItems.value.find((item) => item.id === currentDashboardId.value);
  // A board is the page itself, so its name always travels; a card adds its own, and its absence clears the last one.
  const written: Record<string, string> = { dashboardName: board?.name || "", cardId: card?.id ?? "", cardName: card?.name ?? "" };
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(pageAddress())) if (typeof value === "string" && value) query[key] = value;
  for (const [key, value] of Object.entries(written)) {
    if (value) query[key] = value;
    else delete query[key];
  }
  replaceAddress(query);
}

/**
 * The reader chose a card, or let go of it; the board it sits in is the one the address already names.
 *
 * A board opening names itself in the address, and switching boards drops the card: the card chosen on the last board is
 * not this one's.
 */
watch(
  [() => currentDashboardId.value, dashboardItems, () => loadingDashboards.value],
  ([id]) => {
    const board = dashboardItems.value.find((item) => item.id === id);
    if (!board) return;
    const address = pageAddress();
    // The board names itself in the address it is sent from; a board the address already names keeps its card.
    if (address.dashboardId === id && address.dashboardName === board.name) return;
    writeCard(address.cardId && address.dashboardId === id ? { id: String(address.cardId), name: String(address.cardName ?? address.cardId) } : null);
  },
  { immediate: true },
);

if (props.registerPageController) {
  const unregister = props.registerPageController({
    blocksNavigation(next) {
      if (!panelDirty.value) return false;
      const currentId = currentDashboardId.value;
      const query = next.address.split("?")[1]?.split("#")[0] ?? "";
      const queryId = new URLSearchParams(query).get("dashboardId")?.trim() ?? "";
      const hasState = Boolean(next.state && Object.keys(next.state).length > 0);
      const stateHasDashboardId = Boolean(next.state && "dashboardId" in next.state);
      const stateId = typeof next.state?.dashboardId === "string" ? next.state.dashboardId.trim() : "";

      if (stateHasDashboardId) {
        if (!stateId || stateId !== currentId) return true;
        // An address with explicit query/hash omitting dashboardId would still rewrite the URL and drop the board.
        if ((next.address.includes("?") || next.address.includes("#")) && queryId !== currentId) return true;
        return false;
      }
      if (queryId) {
        return queryId !== currentId;
      }

      // Without dashboardId, allow only a bare-path state patch operating on the current board (such as `{ cardId }`),
      // because the display controller keeps the current address intact for state-only patches.
      const addressHasParams = next.address.includes("?") || next.address.includes("#");
      const isSameBoardCardPatch =
        hasState
        && !addressHasParams
        && typeof next.state?.cardId === "string"
        && next.state.cardId.trim().length > 0
        && Object.keys(next.state!).every((key) => key === "cardId");
      return !isSameBoardCardPatch;
    },
    applyState(patch) {
      const nextDashboardId = typeof patch.dashboardId === "string" ? patch.dashboardId.trim() : "";
      if (nextDashboardId && nextDashboardId !== currentDashboardId.value) {
        if (panelDirty.value) return;
        void store.selectDashboard(nextDashboardId);
      }
      if (typeof patch.cardId === "string" && patch.cardId.trim()) {
        panelRef.value?.selectCardById(patch.cardId.trim());
      }
    },
    fillForm(request) {
      if (!panelRef.value) {
        return Promise.resolve({
          ok: false,
          reason: "form_not_ready",
          ...(request.member ? { member: request.member } : {}),
          message: "No dashboard is currently open.",
        });
      }
      return panelRef.value.fillForm(request);
    },
    async executeAction(request) {
      if (request.operation === "page.refresh") {
        await store.loadDashboards();
        await panelRef.value?.reload();
        return { ok: true, kind: "executed", operation: request.operation };
      }
      if (!panelRef.value) {
        return {
          ok: false,
          reason: "action_not_ready",
          operation: request.operation,
          message: "No dashboard is currently open.",
        };
      }
      return panelRef.value.executeAction(request);
    },
  });
  onBeforeUnmount(unregister);
}

watch(() => props.objectRefresh?.seq, () => {
  if (!props.objectRefresh) return;
  void store.loadDashboards();
  void panelRef.value?.reload();
});

/* ======================== the boards list ======================== */

/*
 * The boards scroll sideways when they do not fit — beside a conversation at the platform's panel width, and on a
 * narrow page. The one open is always in sight, opened from a link or chosen in the list, so a reader never has to
 * guess which board is shown; the arrows appear only on the side where more boards wait.
 */
const tabsRef = ref<HTMLElement | null>(null);
const overflow = ref({ left: false, right: false });

function measureOverflow() {
  const element = tabsRef.value;
  if (!element) return;
  const max = element.scrollWidth - element.clientWidth;
  overflow.value = { left: element.scrollLeft > 0, right: element.scrollLeft < max };
}

/** Brings the open board into sight: it is the one a reader came to see. */
function revealOpenBoard() {
  const strip = tabsRef.value;
  if (!strip) return;
  const open = strip.querySelector<HTMLElement>(".tab.active");
  if (!open) return;
  const left = open.offsetLeft;
  const right = left + open.offsetWidth;
  if (left < strip.scrollLeft) strip.scrollLeft = left;
  else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  measureOverflow();
}

/** A step is one board's own width, so one press moves the list by what the reader sees. */
function scrollTabs(direction: 1 | -1) {
  const strip = tabsRef.value;
  if (!strip) return;
  const step = strip.querySelector<HTMLElement>(".tab")?.offsetWidth ?? strip.clientWidth;
  strip.scrollBy({ left: direction * step, behavior: "smooth" });
}

watch([() => currentDashboardId.value, dashboardItems, () => loadingDashboards.value], async () => {
  await nextTick();
  revealOpenBoard();
}, { immediate: true });

// A panel's width is the platform's to change (the side panel, the window): the open board and the arrows follow it.
const resize = new ResizeObserver(() => revealOpenBoard());
watch(tabsRef, (element, previous) => {
  if (previous) resize.unobserve(previous);
  if (element) resize.observe(element);
});
onBeforeUnmount(() => resize.disconnect());

onMounted(async () => {
  await store.loadDashboards({ notifyError: true });
  if (!currentDashboardId.value && dashboardItems.value[0])
    void store.selectDashboard(dashboardItems.value[0].id);
});
</script>

<template>
  <div class="dashboard-home">
    <!-- The page's own bar: its boards and the way to make one. The title above it is the application header's. -->
    <div class="home-bar" role="tablist" :aria-label="t('analysis.myDashboards')">
      <!-- The boards scroll when they do not fit; the arrows say so and step one board's width at a time. -->
      <button
        v-if="overflow.left"
        type="button"
        class="tabs-scroll tabs-scroll--left"
        :aria-label="t('dashboard.scrollTabsLeft')"
        :title="t('dashboard.scrollTabsLeft')"
        @click="scrollTabs(-1)"
      >
        <ChevronLeft :size="16" />
      </button>
      <div ref="tabsRef" v-loading="loadingDashboards" class="tabs" @scroll.passive="measureOverflow">
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
              @click="openDashboardTab(item.id)"
            >
              {{ item.name }}
            </button>
            <el-dropdown
              trigger="click"
              placement="bottom-end"
              :popper-options="dropdownBoundaryOptions"
              @visible-change="(visible: boolean) => { if (visible) openMenuId = item.id; else if (openMenuId === item.id) openMenuId = null; }"
              @command="(command: string) => handleDashboardCommand(command, item)"
            >
              <button type="button" class="tab-more" :aria-label="t('common.more')">
                <MoreHorizontal :size="14" />
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <li
                    v-if="boardPreviewActive && item.id === currentDashboardId"
                    class="tab-preview-lock-hint"
                    role="note"
                  >
                    {{ previewBlockedReason }}
                  </li>
                  <el-dropdown-item
                    command="rename"
                    :disabled="boardPreviewActive && item.id === currentDashboardId"
                    :title="boardPreviewActive && item.id === currentDashboardId ? previewBlockedReason : undefined"
                  >
                    {{ t("common.rename") }}
                  </el-dropdown-item>
                  <el-dropdown-item
                    command="delete"
                    :disabled="boardPreviewActive && item.id === currentDashboardId"
                    :title="boardPreviewActive && item.id === currentDashboardId ? previewBlockedReason : undefined"
                  >
                    {{ t("common.delete") }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </div>
      </div>
      <button
        v-if="overflow.right"
        type="button"
        class="tabs-scroll tabs-scroll--right"
        :aria-label="t('dashboard.scrollTabsRight')"
        :title="t('dashboard.scrollTabsRight')"
        @click="scrollTabs(1)"
      >
        <ChevronRight :size="16" />
      </button>
      <el-button class="create" @click="createDashboard()">
        <Plus :size="15" />
        <span>{{ t("analysis.createDashboard") }}</span>
      </el-button>
    </div>
    <div class="home-body">
      <DashboardPanel
        v-if="currentDashboardId"
        ref="panelRef"
        :key="currentDashboardId"
        :dashboard-id="currentDashboardId"
        :card-id="chosenCardId"
        :editing-board-name="Boolean(currentDashboardId && editingDashboardId === currentDashboardId)"
        @select-card="(card: { id: string; name: string } | null) => writeCard(card)"
        @dirty="onPanelDirty"
        @preview-active="onBoardPreviewActive"
        @cancel-board-rename="store.cancelDashboardRename()"
        @board-saved="() => store.loadDashboards()"
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
  scrollbar-width: none;
}
.tabs::-webkit-scrollbar {
  display: none;
}
/* The arrows stand where the boards do not fit; they are the bar's own height, so the row does not grow. */
.tabs-scroll {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 32px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.tabs-scroll:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.tabs-scroll:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
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
.tab-preview-lock-hint {
  max-width: 240px;
  padding: 6px 12px;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
  list-style: none;
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
