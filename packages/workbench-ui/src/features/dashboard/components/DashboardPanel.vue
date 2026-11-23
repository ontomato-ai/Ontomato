<template>
  <!-- Outer gate: hide the UI only while the first-screen is pending -->
  <div ref="dashRootRef" class="dash-root" :class="{ 'is-layout-pending': !layoutReady }">
    <div
      v-if="hasBoardPreview"
      class="board-preview-bar"
      role="region"
      :aria-label="t('platform.unsavedChanges')"
    >
      <div class="board-preview-bar__text">
        <strong>{{ t("platform.unsavedChanges") }}</strong>
        <span>{{ previewSummary.displaySummary }}</span>
      </div>
      <div v-if="boardPreviewFailure" class="board-preview-bar__failure" role="alert">
        <strong v-if="boardPreviewFailureHeadline">{{ boardPreviewFailureHeadline }}</strong>
        <span>{{ boardPreviewFailure.message }}</span>
      </div>
      <div class="board-preview-bar__actions">
        <el-button :disabled="savingBoardPreview" @click="discardBoardPreview">
          {{ t("common.cancel") }}
        </el-button>
        <el-button type="primary" :loading="savingBoardPreview" @click="() => saveBoardPreview()">
          {{ t("common.save") }}
        </el-button>
      </div>
    </div>

    <!-- Empty state: dashboard with no dimensions (vertically centered) -->
    <div
      v-if="
        normalizeId(props.dashboardId) && Array.isArray(displayedGroups) && displayedGroups.length === 0
      "
      class="empty-state"
    >
      <div class="empty-state__content">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__title">{{ t("hotData.noDimensionInDashboard") }}</div>
        <div class="empty-state__desc">{{ t("hotData.createDimensionFirstHint") }}</div>
        <span :title="hasBoardPreview ? previewBlockedReason : undefined">
          <el-button
            type="primary"
            size="large"
            :disabled="hasBoardPreview"
            :title="hasBoardPreview ? previewBlockedReason : undefined"
            @click="handleCreateDimension"
          >
            <el-icon class="btn-icon"><Plus /></el-icon>
            {{ t("analysis.createDimension") }}
          </el-button>
        </span>
      </div>
    </div>

    <!-- Main body: group dragging -->
    <Draggable
      v-else-if="Array.isArray(displayedGroups)"
      :model-value="displayedGroups"
      class="bi-dashboard"
      item-key="id"
      handle=".group-drag-handle"
      :animation="180"
      :force-fallback="true"
      :fallback-tolerance="3"
      :group="{ name: 'dashboard-groups', pull: true, put: false }"
      :ghost-class="'drag-ghost'"
      :drag-class="'drag-dragging'"
      :disabled="dragDisabled || hasBoardPreview"
      @update:model-value="onGroupsModelUpdate"
      @end="() => persistLayoutDebounced()"
    >
      <template #item="{ element: g }">
        <div class="block" :data-group-id="g.id">
          <div class="group-header">
            <span
              class="group-drag-handle"
              :class="{ 'is-disabled': hasBoardPreview }"
              :aria-disabled="hasBoardPreview ? 'true' : undefined"
              :title="hasBoardPreview ? previewBlockedReason : t('dashboard.dragToMoveGroup')"
            >
              <el-icon :size="16"><GripVertical /></el-icon>
            </span>

            <div class="group-title" :title="g.title || ''">
              {{ g.title || t("hotData.unnamedDimension") }}
            </div>

            <DropdownMenu
              scene="dimension"
              trigger-class="group-more"
              :board-locked="hasBoardPreview"
              :lock-reason="previewBlockedReason"
              @command="(cmd) => handleDimensionCommand(cmd, g)"
            />
          </div>

          <!-- Metric dragging -->
          <Draggable
            v-if="Array.isArray(g.metrics)"
            :model-value="g.metrics"
            item-key="id"
            tag="div"
            :class="['metrics-section', { 'metrics-empty': g.metrics.length === 0 }]"
            :group="{ name: 'dashboard-metrics', pull: true, put: ['dashboard-metrics'] }"
            :animation="180"
            :force-fallback="true"
            :fallback-tolerance="3"
            :filter="'.resize-handle, .metric-more'"
            :prevent-on-filter="false"
            :ghost-class="'drag-ghost'"
            :drag-class="'drag-dragging'"
            :disabled="dragDisabled || hasBoardPreview"
            @update:model-value="(next) => onGroupMetricsUpdate(g.id, next)"
            @end="() => persistLayoutDebounced()"
          >
            <template #item="{ element: m }">
              <MetricCard
                :metric="m"
                :data-card-id="m.id"
                :class="{ 'is-preview-modified': modifiedCardIds.has(m.id) }"
                :selected="isSelected(m.id, 'metric')"
                :board-locked="hasBoardPreview"
                :lock-reason="previewBlockedReason"
                :style="gridSpanStyle(m?.layout)"
                @select="(card) => selectCard(card)"
                @command="(cmd) => handleMetricCommand(cmd, m)"
                @layout-change="(layout) => handleLayoutChange(m, layout)"
                @resize-active="(v) => setDragDisabled(v)"
              />
            </template>
          </Draggable>

          <div v-if="Array.isArray(g.charts)" class="charts-wrapper">
            <Draggable
              :model-value="g.charts"
              item-key="id"
              tag="div"
              :class="[
                'charts-section',
                { 'charts-section--empty': g.charts.length === 0 && g.metrics.length === 0 },
              ]"
              :group="{ name: 'dashboard-charts', pull: true, put: ['dashboard-charts'] }"
              :animation="180"
              :force-fallback="true"
              :fallback-tolerance="3"
              :filter="'.resize-handle, .ai-chart-toolbar'"
              :prevent-on-filter="false"
              :empty-insert-threshold="48"
              :ghost-class="'drag-ghost'"
              :drag-class="'drag-dragging'"
              :disabled="dragDisabled || hasBoardPreview"
              @update:model-value="(next) => onGroupChartsUpdate(g.id, next)"
              @end="() => persistLayoutDebounced()"
            >
              <template #item="{ element: c }">
                <ChartCard
                  :chart="c"
                  :data-card-id="c.id"
                  :class="{ 'is-preview-modified': modifiedCardIds.has(c.id) }"
                  :style="gridSpanStyle(c.layout)"
                  :dashboard-id="normalizeId(props.dashboardId)"
                  :selected="isSelected(c.id, 'chart')"
                  :board-locked="hasBoardPreview"
                  :lock-reason="previewBlockedReason"
                  :rename-cancel-seq="cardRenameCancelSeq"
                  @select="(card) => selectCard(card)"
                  @chart-renamed="handleChartRenamed"
                  @chart-deleted="handleChartDeleted"
                  @rename-state="handleChartRenameState"
                  @view-metric="openMetricSource"
                  @edit-parameters="openParameters"
                  @layout-change="(layout) => handleLayoutChange(c, layout)"
                  @resize-active="(v) => setDragDisabled(v)"
                />
              </template>
            </Draggable>

            <div
              v-if="g.charts.length === 0 && g.metrics.length === 0"
              class="charts-empty-overlay"
            >
              <div class="charts-empty-hint">
                <div class="charts-empty-hint__title">{{ t("hotData.noChartInDim") }}</div>
                <div class="charts-empty-hint__desc">
                  {{ t("hotData.clickInQueryResult") }}
                  <span class="charts-empty-hint__hl">{{ t("analysis.addToDashboard") }}</span>
                  {{ t("hotData.toGenChart") }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </Draggable>

    <!-- Dashboard not loaded -->
    <div v-else class="empty">{{ t("hotData.noDashboardData") }}</div>

    <MetricSourceDialog v-model="metricSourceOpen" :card="metricSourceCard" />

    <CardParameterDialog
      ref="parameterDialogRef"
      v-model="parametersOpen"
      :dashboard-id="normalizeId(props.dashboardId)"
      :card="parametersCard"
      @saved="handleParametersSaved"
      @dirty="(dirty) => { parametersDirty = dirty; }"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { GripVertical, Plus } from "lucide-vue-next";
import Draggable from "vuedraggable";
import ChartCard from "./ChartCard.vue";
import MetricCard from "./MetricCard.vue";
import DropdownMenu from "./DropdownMenu.vue";
import CardParameterDialog from "./CardParameterDialog.vue";
import MetricSourceDialog from "./MetricSourceDialog.vue";
import { cardError, cardErrorHeadline } from "./utils/metricCard";
import {
  BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
  applyBoardPreviewOverlay,
  boardPreviewModifiedCards,
  buildBoardSavePlan,
  canonicalBoardPreviewSnapshot,
  computeDashboardBoardFingerprint,
  findBoardInlineEditConflicts,
  findMissingPreviewTargets,
  hasBoardPreviewEntries,
  mergeBoardPreview,
  parseBoardPreviewFill,
  summarizeBoardPreview,
} from "../board-preview";

import {
  normalizeId,
  patchDimensionTitle,
  patchDeleteDimension,
  patchChartTitle,
  patchDeleteChart,
  patchMetricTitle,
  patchDeleteMetric,
  fetchClassMetas,
  createDashboardLoader,
  metricCardTask,
  clamp,
} from "./utils/dashboardHelper";

import {
  deleteDimension,
  deleteMetric,
  fetchDashboardLocalDetail,
  modifyDashboardLayout,
  modifyDimensionName,
  modifyMetricName,
  modifyResultSetName,
  prepareDashboardAgentConfirm,
  renameDashboard,
  createDimension,
} from "../api";

import { useI18n } from "vue-i18n";

const { t } = useI18n();

/* ======================== props & state ======================== */

/**
 * One dashboard: its groups and cards, each card drawn from the metric it references.
 */
const props = defineProps({
  dashboardId: { type: String, default: "" },
  /** Latest saved board name from the tab strip so direct tab renames keep the local preview baseline current. */
  dashboardName: { type: String, default: "" },
  /** The card the page's own address names as chosen, so a board reopened at that address shows the same one chosen. */
  cardId: { type: String, default: "" },
  /** Whether the user is currently editing this dashboard's title inline in the tab strip. */
  editingBoardName: { type: Boolean, default: false },
});
const emit = defineEmits(["select-card", "dirty", "preview-active", "board-saved", "cancel-board-rename"]);

const dragDisabled = ref(false);
const boardName = ref("");
const chartGroups = ref(null);
const attrShowNameMapByClass = ref({});

watch(
  () => props.dashboardName,
  (nextName) => {
    const trimmed = String(nextName || "").trim();
    if (!trimmed) return;
    boardName.value = trimmed;
  },
);

const boardPreview = ref(null);
const savingBoardPreview = ref(false);
const boardPreviewFailure = ref(null);
let boardPreviewVersion = 0;
let unmounted = false;

const activeGroupRenameId = ref(null);
const activeCardRenameId = ref(null);
const cardRenameCancelSeq = ref(0);
let groupRenameToken = 0;
let cardRenameToken = 0;

const metricSourceOpen = ref(false);
const metricSourceCard = ref(null);

const parametersOpen = ref(false);
const parametersCard = ref(null);
const parameterDialogRef = ref(null);
const parametersDirty = ref(false);

const hasBoardPreview = computed(() => Boolean(boardPreview.value));
const previewBlockedReason = computed(() => t("dashboard.previewLocksBoardEdits"));
const displayedGroups = computed(() =>
  Array.isArray(chartGroups.value) ? applyBoardPreviewOverlay(chartGroups.value, boardPreview.value) : chartGroups.value
);
const modifiedCardIds = computed(() =>
  Array.isArray(chartGroups.value) ? boardPreviewModifiedCards(chartGroups.value, boardPreview.value) : new Set()
);
const previewSummary = computed(() =>
  boardPreview.value && Array.isArray(chartGroups.value)
    ? summarizeBoardPreview(boardName.value, chartGroups.value, boardPreview.value)
    : { displaySummary: "", confirmImpactSummary: "" }
);
const boardPreviewFailureHeadline = computed(() =>
  boardPreviewFailure.value ? cardErrorHeadline(boardPreviewFailure.value, t) : null
);
const isDirty = computed(() => hasBoardPreview.value || parametersDirty.value);
watch(hasBoardPreview, (active) => emit("preview-active", active), { flush: "sync", immediate: true });
watch(isDirty, (dirty) => emit("dirty", dirty), { flush: "sync", immediate: true });

const loader = createDashboardLoader();

/* ======================== Layout Gate (allow through once after the first-screen stabilizes, no rollback) ======================== */

const dashRootRef = ref(null);
const layoutReady = ref(false);

let layoutRO = null;
let raf1 = 0;
let raf2 = 0;
let stableTimer = null;
let dashboardLoadToken = 0;

let lastW = 0;
let stableHits = 0;

function clearStableTimer() {
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
}

function armLayoutFallback() {
  if (layoutReady.value) return;
  clearStableTimer();
  stableTimer = setTimeout(() => {
    layoutReady.value = true;
    stableTimer = null;
  }, 450);
}

function resetLayoutGate() {
  layoutReady.value = false;
  lastW = 0;
  stableHits = 0;
  clearStableTimer();
  cancelAnimationFrame(raf1);
  cancelAnimationFrame(raf2);
  armLayoutFallback();
}

function checkStableWidthOnce() {
  if (layoutReady.value) return;

  const el = dashRootRef.value;
  if (!el) return;

  const w = el.getBoundingClientRect().width || 0;

  if (w < 520) {
    stableHits = 0;
    lastW = w;
    return;
  }

  const delta = Math.abs(w - lastW);
  lastW = w;

  if (delta <= 2) stableHits += 1;
  else stableHits = 0;

  if (stableHits >= 1) {
    layoutReady.value = true;
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }
}

function scheduleStableCheckOnce() {
  if (layoutReady.value) return;
  armLayoutFallback();

  cancelAnimationFrame(raf1);
  cancelAnimationFrame(raf2);

  raf1 = requestAnimationFrame(() => {
    raf2 = requestAnimationFrame(() => {
      checkStableWidthOnce();
    });
  });
}

function ensureLayoutObserver() {
  const el = dashRootRef.value;
  if (!el) return;
  if (!layoutRO && typeof ResizeObserver !== "undefined") {
    layoutRO = new ResizeObserver(() => {
      scheduleStableCheckOnce();
    });
    layoutRO.observe(el);
  }
  scheduleStableCheckOnce();
  armLayoutFallback();
}

/* ======================== utils ======================== */

async function reloadDashboardGroups(id, options = {}) {
  const detail = await fetchDashboardLocalDetail(id);
  if (!detail && options.throwOnError) {
    throw new Error(`Dashboard '${id}' could not be loaded.`);
  }
  boardName.value = String(detail?.name || "");
  chartGroups.value = Array.isArray(detail?.groups) ? detail.groups : [];
}

function onGroupsModelUpdate(next) {
  if (hasBoardPreview.value) return;
  chartGroups.value = next;
}

function onGroupMetricsUpdate(groupId, next) {
  if (hasBoardPreview.value || !Array.isArray(chartGroups.value)) return;
  const target = chartGroups.value.find((group) => group.id === groupId);
  if (target) target.metrics = next;
}

function onGroupChartsUpdate(groupId, next) {
  if (hasBoardPreview.value || !Array.isArray(chartGroups.value)) return;
  const target = chartGroups.value.find((group) => group.id === groupId);
  if (target) target.charts = next;
}

function setDragDisabled(v) {
  dragDisabled.value = !!v;
  if (!v) requestAnimationFrame(() => cleanupDragClasses());
}

function cleanupDragClasses() {
  const root = document.querySelector(".bi-dashboard");
  if (!root) return;
  root.querySelectorAll(".drag-ghost, .drag-dragging").forEach((el) => {
    el.classList.remove("drag-ghost", "drag-dragging");
  });
}

/** layout maps to CSS Grid span */
function gridSpanStyle(layout) {
  const colSpan = clamp(layout?.colSpan ?? 1, 1, 24);
  const rowSpan = clamp(layout?.rowSpan ?? 1, 1, 6);
  return {
    "--col-span": String(colSpan),
    "--row-span": String(rowSpan),
    gridColumn: `span ${colSpan}`,
    gridRow: `span ${rowSpan}`,
  };
}

/* ======================== persistence ======================== */

let persistTimer = null;
let persistSaving = false;
let persistDirty = false;
let persistLastWarnAt = 0;

function hasPendingLayoutSave() {
  return Boolean(persistTimer || persistSaving || persistDirty);
}

function buildLayoutPersistPayload(groups) {
  const gs = Array.isArray(groups) ? groups : [];

  const pickLayout = (layout) => ({
    colSpan: clamp(layout?.colSpan ?? 1, 1, 24),
    rowSpan: clamp(layout?.rowSpan ?? 1, 1, 6),
  });

  // A card sends only its presentation: its query and its chart file stay as saved.
  const pickMetricChart = (c) => ({
    id: c.id,
    name: c.title || c.name,
    layout: pickLayout(c.layout),
  });

  const pickMetricValue = (m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    valueField: m.valueField,
    sort: m.sort,
    displayLimit: m.displayLimit,
    formats: m.formats,
    layout: pickLayout(m.layout),
    style: m.style,
  });

  return gs.map((g) => {
    const charts = Array.isArray(g?.charts) ? g.charts : [];
    const metrics = Array.isArray(g?.metrics) ? g.metrics : [];
    return {
      id: normalizeId(g?.id || ""),
      title: String(g?.title || "").trim(),
      charts: charts.map(pickMetricChart).filter((x) => x.id),
      metrics: metrics.map(pickMetricValue).filter((x) => x.id),
    };
  });
}

async function flushPersistLayout() {
  const id = normalizeId(props.dashboardId);
  if (!id) return;
  if (persistSaving) return;

  persistSaving = true;
  try {
    while (persistDirty) {
      persistDirty = false;
      const payload = buildLayoutPersistPayload(chartGroups.value);
      await modifyDashboardLayout(id, payload);
    }
  } catch {
    persistDirty = true;
    const now = Date.now();
    if (!persistLastWarnAt || now - persistLastWarnAt > 4000) {
      persistLastWarnAt = now;
      ElMessage.warning(t("dashboard.layoutSaveFailedRetry"));
    }
  } finally {
    persistSaving = false;
  }
}

function persistLayoutDebounced() {
  if (hasBoardPreview.value) return;
  const id = normalizeId(props.dashboardId);
  if (!id) return;
  persistDirty = true;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersistLayout();
  }, 400);
}

/* ======================== create dimension ======================== */

async function handleCreateDimension(insertIndex) {
  if (hasBoardPreview.value) return;
  const id = normalizeId(props.dashboardId);
  if (!id) return;

  try {
    const ret = await ElMessageBox.prompt(
      t("analysis.enterDimensionName"),
      t("analysis.createDimension"),
      {
        confirmButtonText: t("common.create"),
        cancelButtonText: t("common.cancel"),
        inputValidator: (v) => {
          const s = String(v || "").trim();
          if (!s) return t("common.nameRequired");
          if (s.length > 50) return t("common.nameTooLong");
          return true;
        },
      }
    );

    const dimensionName = String(ret?.value || "").trim();
    if (!dimensionName) return;

    const ok = await createDimension(id, dimensionName);
    if (!ok) throw new Error(t("analysis.createFailed"));

    // Record the group ids that existed before creation
    const before = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const beforeIds = new Set(before.map((g) => normalizeId(g?.id)).filter(Boolean));

    // Fetch locally added groups (only append the new ones)
    await reloadAndAppendOnly(id);

    // Find the newly added groups
    const list = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const addedIndex = list.findIndex((g) => {
      const gid = normalizeId(g?.id);
      return gid && !beforeIds.has(gid);
    });
    if (addedIndex === -1) {
      ElMessage.success(t("dashboard.created"));
      return;
    }

    // Insert the new groups at the specified position (below) and persist the order
    const added = list.splice(addedIndex, 1)[0];

    // When insertIndex is not passed, append to the end by default
    let target = typeof insertIndex === "number" ? insertIndex : list.length;
    target = Math.max(0, Math.min(target, list.length));

    list.splice(target, 0, added);
    chartGroups.value = list;

    // Save the new dimension order (based on modifyDashboardLayout order)
    persistLayoutDebounced();

    requestAnimationFrame(() => {
      const gid = normalizeId(added?.id);
      if (!gid) return;
      document
        .querySelector(`[data-group-id="${gid}"]`)
        ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });

    ElMessage.success(t("dashboard.created"));
  } catch (e) {
    if (e === "cancel") return;
    ElMessage.error(e instanceof Error ? e.message : t("analysis.createFailed"));
  }
}

function setGroups(updater) {
  chartGroups.value = typeof updater === "function" ? updater(chartGroups.value || []) : updater;
}

async function loadDashboardAll(id, options = {}) {
  const prevBoardName = boardName.value;
  const prevGroups = chartGroups.value;
  try {
    // 1) Local detail
    await reloadDashboardGroups(id, options);

    // 2) Remote merge (read every card's current result)
    await loader.loadDashboardById(id, setGroups, options);
  } catch (err) {
    if (options.preserveOnError) {
      boardName.value = prevBoardName;
      chartGroups.value = prevGroups;
    }
    throw err;
  }
}

function appendNewGroupsOnly(prevGroups, nextGroupsFromLocal) {
  const prev = Array.isArray(prevGroups) ? prevGroups : [];
  const next = Array.isArray(nextGroupsFromLocal) ? nextGroupsFromLocal : [];

  const existed = new Set(prev.map((g) => normalizeId(g?.id)).filter(Boolean));
  const added = next.filter((g) => {
    const gid = normalizeId(g?.id);
    return gid && !existed.has(gid);
  });

  // Only append the new ones (don't mutate any existing object in prev, ensuring remote fields aren't lost)
  return prev.concat(added);
}

async function reloadAndAppendOnly(id) {
  const detail = await fetchDashboardLocalDetail(id);
  const localGroups = Array.isArray(detail?.groups) ? detail.groups : [];
  chartGroups.value = appendNewGroupsOnly(chartGroups.value, localGroups);
}

/* ======================== watch dashboard ======================== */

watch(
  () => normalizeId(props.dashboardId),
  async (id) => {
    const loadToken = ++dashboardLoadToken;
    boardPreview.value = null;
    boardPreviewFailure.value = null;
    activeGroupRenameId.value = null;
    activeCardRenameId.value = null;
    parametersOpen.value = false;
    parametersDirty.value = false;

    // Reset the dashboard reset gate
    resetLayoutGate();

    if (!id) {
      boardName.value = "";
      chartGroups.value = null;
      layoutReady.value = true;
      return;
    }

    try {
      await loadDashboardAll(id);
      if (loadToken !== dashboardLoadToken) return;

      await nextTick();
      scheduleStableCheckOnce();
    } catch (e) {
      if (loadToken !== dashboardLoadToken) return;
      layoutReady.value = true;
      ElMessage.error(e instanceof Error ? e.message : t("dashboard.loadDashboardFailed"));
    }
  },
  { immediate: true }
);

/* ======================== lifecycle ======================== */

onMounted(async () => {
  fetchClassMetas().then((cmap) => {
    attrShowNameMapByClass.value = cmap;
  });

  await nextTick();
  ensureLayoutObserver();
});

onBeforeUnmount(() => {
  unmounted = true;
  boardPreview.value = null;
  activeGroupRenameId.value = null;
  activeCardRenameId.value = null;
  parametersDirty.value = false;
  emit("preview-active", false);
  emit("dirty", false);
  loader.abort();

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (persistDirty) flushPersistLayout();

  if (layoutRO) {
    layoutRO.disconnect();
    layoutRO = null;
  }
  if (stableTimer) {
    clearTimeout(stableTimer);
    stableTimer = null;
  }
  cancelAnimationFrame(raf1);
  cancelAnimationFrame(raf2);
});

/* ======================== dimension ops ======================== */

async function handleDimensionCommand(cmd, g) {
  if (hasBoardPreview.value) return;
  const id = normalizeId(props.dashboardId);
  const groupId = normalizeId(g?.id);
  if (!id || !groupId) return;

  // Create above/below the current dimension
  if (cmd === "create_above" || cmd === "create_below") {
    const list = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const curIndex = list.findIndex((x) => normalizeId(x?.id) === groupId);
    const insertIndex = curIndex < 0 ? undefined : cmd === "create_above" ? curIndex : curIndex + 1;

    return handleCreateDimension(insertIndex);
  }

  if (cmd === "rename") {
    const token = ++groupRenameToken;
    activeGroupRenameId.value = groupId;
    try {
      const ret = await ElMessageBox.prompt(
        t("analysis.enterDimensionName"),
        t("dashboard.renameDimension"),
        {
          confirmButtonText: t("common.ok"),
          cancelButtonText: t("common.cancel"),
          inputValue: String(g?.title || "").trim(),
        }
      );
      if (token !== groupRenameToken) return;

      const nextName = String(ret?.value || "").trim();
      if (!nextName) return;

      const ok = await modifyDimensionName(id, groupId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));

      chartGroups.value = patchDimensionTitle(chartGroups.value, groupId, nextName);
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel" || e === "close") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
    } finally {
      if (token === groupRenameToken) activeGroupRenameId.value = null;
    }
  }

  if (cmd === "delete") {
    try {
      await ElMessageBox.confirm(
        t("dashboard.deleteDimensionConfirm", { name: String(g?.title || groupId) }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
          confirmButtonClass: "el-button--danger",
        }
      );

      const ok = await deleteDimension(id, groupId);
      if (!ok) throw new Error(t("admin.deleteFailed"));

      chartGroups.value = patchDeleteDimension(chartGroups.value, groupId);
      ElMessage.success(t("common.deleted"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("admin.deleteFailed"));
    }
  }
}

/* ======================== metric ops ======================== */

async function handleMetricCommand(cmd, m) {
  const id = normalizeId(props.dashboardId);
  const metricId = normalizeId(m?.id);
  const metricTitle = String(m?.name || "").trim();
  if (!id || !metricId) return;

  if (cmd === "view-query") {
    openMetricSource(m);
    return;
  }

  if (cmd === "parameters") {
    openParameters(m);
    return;
  }

  if (hasBoardPreview.value) return;

  if (cmd === "rename") {
    const token = ++cardRenameToken;
    activeCardRenameId.value = metricId;
    try {
      const ret = await ElMessageBox.prompt(
        t("dashboard.enterMetricName"),
        t("dashboard.renameMetric"),
        {
          confirmButtonText: t("common.ok"),
          cancelButtonText: t("common.cancel"),
          inputValue: metricTitle,
        }
      );
      if (token !== cardRenameToken) return;

      const nextName = String(ret?.value || "").trim();
      if (!nextName) return;

      const ok = await modifyMetricName(id, metricId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));

      chartGroups.value = patchMetricTitle(chartGroups.value, metricId, nextName);
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel" || e === "close") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
    } finally {
      if (token === cardRenameToken) activeCardRenameId.value = null;
    }
  }

  if (cmd === "delete") {
    try {
      await ElMessageBox.confirm(
        t("dashboard.deleteMetricConfirm", { name: String(metricTitle) }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
          confirmButtonClass: "el-button--danger",
        }
      );

      const ok = await deleteMetric(id, metricId);
      if (!ok) throw new Error(t("admin.deleteFailed"));

      chartGroups.value = patchDeleteMetric(chartGroups.value, metricId);
      ElMessage.success(t("common.deleted"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("admin.deleteFailed"));
    }
  }
}

/* ======================== selection ======================== */

/*
 * The card the reader points at is what a message sent from beside the page asks about: choosing one card chooses it
 * alone. The choice belongs to the page's address — the page is read again somewhere else, and the message travels with
 * the address — so this component takes the chosen card from its own props and reports each choice back to the page.
 */
const chosen = ref("");

function isSelected(cardId, kind) {
  return chosen.value === `${kind}:${cardId}`;
}

function selectCard(card) {
  chosen.value = `${card.kind}:${card.id}`;
  emit("select-card", { id: card.id, name: shownName(card.id) });
  // A card chosen in a narrow pane is shown, not only marked: the reader asked for this one.
  nextTick(() => document.querySelector(`[data-card-id="${card.id}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
}

/** The card's name as the board shows it. */
function shownName(cardId) {
  const card = [...(displayedGroups.value || []).flatMap((group) => [...group.charts, ...group.metrics])].find((item) => item.id === cardId);
  return card?.name || card?.title || String(cardId);
}

/** A board is a fresh page: the card chosen on the last one is not this one's. */
watch(() => normalizeId(props.dashboardId), () => {
  chosen.value = "";
}, { immediate: true });

/** The address says which card is chosen; a board read again restores that choice once its cards are drawn. */
watch([() => props.cardId, chartGroups], ([cardId]) => {
  const card = [...(chartGroups.value || []).flatMap((group) => [...group.charts, ...group.metrics])].find((item) => item.id === cardId);
  if (!card) return;
  const kind = (chartGroups.value || []).some((group) => group.charts.some((item) => item.id === card.id)) ? "chart" : "metric";
  chosen.value = `${kind}:${card.id}`;
});

/* ======================== layout change ======================== */

function handleLayoutChange(card, layout) {
  if (hasBoardPreview.value) return;
  card.layout = { ...(card.layout || {}), ...layout };
  persistLayoutDebounced();
}

/* ======================== chart events ======================== */

function handleChartRenamed(payload) {
  chartGroups.value = patchChartTitle(chartGroups.value, payload?.chartId, payload?.title);
}

function handleChartDeleted(payload) {
  chartGroups.value = patchDeleteChart(chartGroups.value, payload?.chartId);
}

function handleChartRenameState(payload) {
  const chartId = normalizeId(payload?.chartId);
  if (!chartId) return;
  if (payload?.active) {
    activeCardRenameId.value = chartId;
  } else if (activeCardRenameId.value === chartId) {
    activeCardRenameId.value = null;
  }
}

function cancelActiveGroupRename() {
  groupRenameToken += 1;
  activeGroupRenameId.value = null;
  ElMessageBox.close();
}

function cancelActiveCardRename() {
  cardRenameToken += 1;
  cardRenameCancelSeq.value += 1;
  activeCardRenameId.value = null;
  ElMessageBox.close();
}

/* ======================== metric-reference parameters ======================== */

function openMetricSource(card) {
  metricSourceCard.value = card;
  metricSourceOpen.value = true;
}

function openParameters(card) {
  parametersCard.value = { id: card.id, name: card.title || card.name };
  parametersOpen.value = true;
}

/** The saved parameters become the card's query; the card then asks the metric again. */
function handleParametersSaved(cardId) {
  metricCardTask(normalizeId(props.dashboardId), cardId, setGroups)();
}

function findCard(cardId) {
  const groups = Array.isArray(displayedGroups.value) ? displayedGroups.value : [];
  for (const group of groups) {
    const chart = (group.charts || []).find((item) => item.id === cardId);
    if (chart) return { card: chart, kind: "chart" };
    const metric = (group.metrics || []).find((item) => item.id === cardId);
    if (metric) return { card: metric, kind: "metric" };
  }
  return null;
}

function selectedCardId() {
  if (chosen.value.includes(":")) return chosen.value.slice(chosen.value.indexOf(":") + 1);
  return props.cardId || "";
}

function selectCardById(cardId) {
  const found = findCard(cardId);
  if (!found) return false;
  selectCard({ id: found.card.id, name: shownName(found.card.id), kind: found.kind });
  return true;
}

async function openParametersForCard(cardId, options = {}) {
  const targetId = cardId || selectedCardId();
  if (!targetId) {
    return { ok: false, reason: "action_unavailable", message: "No dashboard card is selected to edit parameters." };
  }
  const found = findCard(targetId);
  if (!found) {
    return { ok: false, reason: "action_unavailable", message: `Dashboard card '${targetId}' was not found.` };
  }
  if (parametersOpen.value && parametersCard.value) {
    if (parametersCard.value.id === found.card.id) {
      await parameterDialogRef.value?.waitForLoad?.();
      return { ok: true };
    }
    if (!options.allowReplaceUnsaved && parameterDialogRef.value?.hasUnsavedChanges?.()) {
      return {
        ok: false,
        reason: "blocked_unsaved",
        message: `Card '${parametersCard.value.name}' has unsaved parameter edits; save or discard them before switching to '${found.card.title || found.card.name}'.`,
      };
    }
  }
  selectCard({ id: found.card.id, name: shownName(found.card.id), kind: found.kind });
  openParameters(found.card);
  await nextTick();
  await parameterDialogRef.value?.waitForLoad?.();
  return { ok: true };
}

async function verifyBoardPreviewBaseline(id, baselineFingerprint) {
  if (hasPendingLayoutSave()) {
    return {
      ok: false,
      stale: true,
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    };
  }
  const localGroups = Array.isArray(chartGroups.value) ? chartGroups.value : [];
  const localFingerprint = computeDashboardBoardFingerprint(boardName.value, localGroups);
  const expectedBaseline = baselineFingerprint || localFingerprint;
  if (localFingerprint !== expectedBaseline) {
    return {
      ok: false,
      stale: true,
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    };
  }
  let latestDetail;
  try {
    latestDetail = await fetchDashboardLocalDetail(id);
  } catch (error) {
    return {
      ok: false,
      stale: false,
      message: error instanceof Error ? error.message : t("dashboard.loadDashboardFailed"),
    };
  }
  if (!latestDetail || !Array.isArray(latestDetail.groups)) {
    return {
      ok: false,
      stale: true,
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    };
  }
  const serverFingerprint = computeDashboardBoardFingerprint(String(latestDetail.name || ""), latestDetail.groups);
  if (serverFingerprint !== expectedBaseline) {
    return {
      ok: false,
      stale: true,
      message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE,
    };
  }
  return { ok: true };
}

async function saveBoardPreview(options = {}) {
  const skipBaselineCheck = Boolean(options?.skipBaselineCheck);
  const id = normalizeId(props.dashboardId);
  const preview = boardPreview.value;
  if (!id || !preview) {
    return {
      ok: false,
      partial: false,
      succeeded: [],
      failed: [],
      remaining: [],
      message: "There are no unsaved dashboard changes to save.",
    };
  }
  const missingTargets = Array.isArray(chartGroups.value)
    ? findMissingPreviewTargets(chartGroups.value, preview)
    : [];
  if (missingTargets.length > 0) {
    const message = `Target objects no longer exist on the dashboard: ${missingTargets.join(", ")}.`;
    boardPreviewFailure.value = { code: null, message };
    return {
      ok: false,
      stale: true,
      partial: false,
      succeeded: [],
      failed: [],
      remaining: [],
      message,
    };
  }

  savingBoardPreview.value = true;
  boardPreviewFailure.value = null;
  try {
    if (!skipBaselineCheck) {
      const baselineCheck = await verifyBoardPreviewBaseline(id, preview.baselineFingerprint);
      if (!baselineCheck.ok) {
        boardPreviewFailure.value = { code: null, message: baselineCheck.message };
        return {
          ok: false,
          stale: Boolean(baselineCheck.stale),
          partial: false,
          succeeded: [],
          failed: [],
          remaining: [],
          message: baselineCheck.message,
        };
      }
    }

    const groups = Array.isArray(chartGroups.value) ? chartGroups.value : [];
    const groupTitleOf = (groupId) =>
      groups.find((item) => item.id === groupId)?.title || groupId;
    const chartNameOf = (chartId) =>
      groups.flatMap((group) => group.charts || []).find((item) => item.id === chartId)?.name || chartId;
    const metricNameOf = (metricId) =>
      groups.flatMap((group) => group.metrics || []).find((item) => item.id === metricId)?.name || metricId;

    const plan = buildBoardSavePlan(boardName.value, preview);
    const remainingPreview = {
      version: preview.version,
      ...(preview.baselineFingerprint !== undefined ? { baselineFingerprint: preview.baselineFingerprint } : {}),
      ...(preview.boardName !== undefined ? { boardName: preview.boardName } : {}),
      groupRenames: { ...preview.groupRenames },
      chartRenames: { ...preview.chartRenames },
      metricRenames: { ...preview.metricRenames },
      ...(preview.layoutGroups ? { layoutGroups: preview.layoutGroups } : {}),
    };

    const steps = [];
    if (plan.renameBoard !== undefined) {
      steps.push({
        label: "rename dashboard",
        run: async () => {
          const ok = await renameDashboard(id, plan.renameBoard);
          if (!ok) throw new Error(t("common.renameFailed"));
        },
        onSuccess: () => {
          boardName.value = plan.renameBoard;
          delete remainingPreview.boardName;
        },
      });
    }
    if (plan.layoutGroups) {
      steps.push({
        label: "update dashboard layout",
        run: async () => {
          const ok = await modifyDashboardLayout(id, plan.layoutGroups);
          if (!ok) throw new Error(t("dashboard.layoutSaveFailedRetry"));
        },
        onSuccess: () => {
          delete remainingPreview.layoutGroups;
          remainingPreview.groupRenames = {};
          remainingPreview.chartRenames = {};
          remainingPreview.metricRenames = {};
        },
      });
    } else {
      for (const item of plan.groupRenames) {
        steps.push({
          label: `rename group "${groupTitleOf(item.groupId)}"`,
          run: async () => {
            const ok = await modifyDimensionName(id, item.groupId, item.dimensionName);
            if (!ok) throw new Error(t("common.renameFailed"));
          },
          onSuccess: () => {
            chartGroups.value = patchDimensionTitle(chartGroups.value, item.groupId, item.dimensionName);
            delete remainingPreview.groupRenames[item.groupId];
          },
        });
      }
      for (const item of plan.chartRenames) {
        steps.push({
          label: `rename chart "${chartNameOf(item.chartId)}"`,
          run: async () => {
            const ok = await modifyResultSetName(id, item.chartId, item.resultSetName);
            if (!ok) throw new Error(t("common.renameFailed"));
          },
          onSuccess: () => {
            chartGroups.value = patchChartTitle(chartGroups.value, item.chartId, item.resultSetName);
            delete remainingPreview.chartRenames[item.chartId];
          },
        });
      }
      for (const item of plan.metricRenames) {
        steps.push({
          label: `rename metric "${metricNameOf(item.metricId)}"`,
          run: async () => {
            const ok = await modifyMetricName(id, item.metricId, item.metricName);
            if (!ok) throw new Error(t("common.renameFailed"));
          },
          onSuccess: () => {
            chartGroups.value = patchMetricTitle(chartGroups.value, item.metricId, item.metricName);
            delete remainingPreview.metricRenames[item.metricId];
          },
        });
      }
    }

    const succeeded = [];
    const failed = [];
    const remaining = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      try {
        await step.run();
        step.onSuccess();
        succeeded.push(step.label);
      } catch (error) {
        const parsedError = cardError(error);
        failed.push({ label: step.label, error: parsedError.message });
        for (let nextIndex = index + 1; nextIndex < steps.length; nextIndex += 1) {
          remaining.push(steps[nextIndex].label);
        }
        break;
      }
    }

    if (failed.length > 0) {
      if (succeeded.length > 0) {
        const failedText = failed.map((item) => `${item.label} (${item.error})`).join(", ");
        const remainingText = remaining.length > 0 ? ` Not run: ${remaining.join(", ")}.` : "";
        const partialMessage = `Partially saved dashboard changes. Saved: ${succeeded.join(", ")}. Failed: ${failedText}.${remainingText}`;
        emit("board-saved");
        try {
          await loadDashboardAll(id, { preserveOnError: true, throwOnError: true });
        } catch {
          // Best-effort refresh after partial save; keep remaining unsaved preview visible.
        }
        const refreshedBaseline = Array.isArray(chartGroups.value)
          ? computeDashboardBoardFingerprint(boardName.value, chartGroups.value)
          : preview.baselineFingerprint;
        boardPreview.value = hasBoardPreviewEntries(remainingPreview)
          ? {
              ...remainingPreview,
              version: ++boardPreviewVersion,
              ...(refreshedBaseline ? { baselineFingerprint: refreshedBaseline } : {}),
            }
          : null;
        boardPreviewFailure.value = { code: null, message: partialMessage };
        return {
          ok: false,
          partial: true,
          succeeded,
          failed,
          remaining,
          message: partialMessage,
        };
      }
      boardPreviewFailure.value = { code: null, message: failed[0].error };
      return {
        ok: false,
        partial: false,
        succeeded: [],
        failed,
        remaining,
        message: failed[0].error,
      };
    }

    boardPreview.value = null;
    boardPreviewFailure.value = null;
    emit("board-saved");
    try {
      await loadDashboardAll(id, { preserveOnError: true, throwOnError: true });
    } catch (reloadErr) {
      const reloadError = reloadErr instanceof Error ? reloadErr.message : String(reloadErr);
      const message = `Dashboard changes were saved, but refreshing the board failed: ${reloadError}`;
      ElMessage.warning(message);
      return {
        ok: true,
        partial: false,
        succeeded,
        failed: [],
        remaining: [],
        reloadFailed: true,
        reloadError,
        message,
      };
    }
    return {
      ok: true,
      partial: false,
      succeeded,
      failed: [],
      remaining: [],
      reloadFailed: false,
    };
  } finally {
    savingBoardPreview.value = false;
  }
}

async function discardBoardPreview() {
  const id = normalizeId(props.dashboardId);
  boardPreview.value = null;
  boardPreviewFailure.value = null;
  if (id) await loadDashboardAll(id);
}

async function saveBoardFromAction(operation, agentRun) {
  const id = normalizeId(props.dashboardId);
  if (!id || !Array.isArray(chartGroups.value)) {
    return { ok: false, reason: "action_not_ready", operation, message: "The dashboard is not loaded." };
  }
  if (!boardPreview.value) {
    return { ok: false, reason: "action_unavailable", operation, message: "There are no unsaved dashboard changes to save." };
  }
  if (savingBoardPreview.value) {
    return { ok: false, reason: "action_not_ready", operation, message: "Dashboard changes are currently saving." };
  }

  const baselineCheck = await verifyBoardPreviewBaseline(id, boardPreview.value.baselineFingerprint);
  if (!baselineCheck.ok) {
    boardPreviewFailure.value = { code: null, message: baselineCheck.message };
    return {
      ok: false,
      reason: baselineCheck.stale ? "stale" : "failed",
      operation,
      message: baselineCheck.message,
    };
  }

  const capturedDashboardId = id;
  const capturedVersion = boardPreview.value.version;
  const capturedCanonical = canonicalBoardPreviewSnapshot(boardPreview.value);
  const capturedLoadToken = dashboardLoadToken;
  const targetLabel = boardName.value || id;
  const impactSummary = previewSummary.value.confirmImpactSummary;

  let prepared;
  try {
    prepared = await prepareDashboardAgentConfirm({
      dashboardId: capturedDashboardId,
      operation: "board.save",
      targetLabel,
      impactSummary,
      agentRun,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      operation,
      message: error instanceof Error ? error.message : "Failed to prepare save confirmation.",
    };
  }

  let cancelled = false;
  let dispatched = false;
  const isStillValid = () => {
    if (unmounted) return { ok: false, reason: "stale", message: "The dashboard page was closed." };
    if (cancelled) return { ok: false, reason: "stale", message: "The save confirmation was cancelled." };
    if (dispatched) return { ok: false, reason: "stale", message: "The save confirmation was already executed." };
    if (normalizeId(props.dashboardId) !== capturedDashboardId || dashboardLoadToken !== capturedLoadToken) {
      return { ok: false, reason: "stale", message: "The dashboard was switched or reloaded." };
    }
    if (!boardPreview.value) {
      return { ok: false, reason: "stale", message: "The unsaved dashboard preview was already saved or discarded." };
    }
    if (
      boardPreview.value.version !== capturedVersion ||
      canonicalBoardPreviewSnapshot(boardPreview.value) !== capturedCanonical
    ) {
      return { ok: false, reason: "stale", message: "The dashboard preview changed after confirmation was requested." };
    }
    if (!Array.isArray(chartGroups.value)) {
      return { ok: false, reason: "stale", message: "The dashboard is not loaded." };
    }
    if (hasPendingLayoutSave()) {
      return { ok: false, reason: "stale", message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE };
    }
    if (
      boardPreview.value.baselineFingerprint &&
      computeDashboardBoardFingerprint(boardName.value, chartGroups.value) !== boardPreview.value.baselineFingerprint
    ) {
      return { ok: false, reason: "stale", message: BOARD_MODIFIED_SINCE_PREVIEW_MESSAGE };
    }
    const missingTargets = findMissingPreviewTargets(chartGroups.value, boardPreview.value);
    if (missingTargets.length > 0) {
      return {
        ok: false,
        reason: "stale",
        message: `Target objects no longer exist on the dashboard: ${missingTargets.join(", ")}.`,
      };
    }
    if (savingBoardPreview.value) {
      return { ok: false, reason: "stale", message: "Dashboard changes are currently saving." };
    }
    return { ok: true };
  };

  if (prepared.autoMode) {
    const check = isStillValid();
    if (!check.ok) {
      return { ok: false, reason: "stale", operation, intentId: prepared.intentId, message: check.message };
    }
    dispatched = true;
    const saved = await saveBoardPreview({ skipBaselineCheck: true });
    if (saved.ok) {
      return {
        ok: true,
        kind: "executed",
        operation,
        intentId: prepared.intentId,
        ...(saved.reloadFailed
          ? {
              outcome: {
                dashboardId: capturedDashboardId,
                saved: saved.succeeded,
                reloadFailed: true,
                reloadError: saved.reloadError,
                message: saved.message,
              },
            }
          : {}),
      };
    }
    if (saved.partial) {
      return {
        ok: true,
        kind: "executed",
        operation,
        intentId: prepared.intentId,
        outcome: {
          dashboardId: capturedDashboardId,
          partial: true,
          succeeded: saved.succeeded,
          failed: saved.failed,
          remaining: saved.remaining,
          message: saved.message,
        },
      };
    }
    return {
      ok: false,
      reason: saved.stale ? "stale" : "failed",
      operation,
      intentId: prepared.intentId,
      message: saved.message,
    };
  }

  const confirmation = {
    intentId: prepared.intentId,
    questionId: prepared.questionId,
    operationId: operation,
    label: prepared.label,
    isStillValid,
    async dispatch() {
      const check = isStillValid();
      if (!check.ok) {
        return { ok: false, intentId: prepared.intentId, reason: "stale", message: check.message };
      }
      dispatched = true;
      const saved = await saveBoardPreview();
      if (saved.ok) {
        return {
          ok: true,
          intentId: prepared.intentId,
          outcome: {
            dashboardId: capturedDashboardId,
            ...(saved.reloadFailed
              ? {
                  saved: saved.succeeded,
                  reloadFailed: true,
                  reloadError: saved.reloadError,
                  message: saved.message,
                }
              : {}),
          },
          summary: saved.reloadFailed ? saved.message : prepared.label,
        };
      }
      if (saved.partial) {
        return {
          ok: true,
          intentId: prepared.intentId,
          outcome: {
            dashboardId: capturedDashboardId,
            partial: true,
            succeeded: saved.succeeded,
            failed: saved.failed,
            remaining: saved.remaining,
            message: saved.message,
          },
          summary: saved.message,
        };
      }
      return {
        ok: false,
        intentId: prepared.intentId,
        reason: saved.stale ? "stale" : "failed",
        message: saved.message || "Failed to save dashboard changes.",
      };
    },
    async cancel() {
      cancelled = true;
    },
  };

  return {
    ok: true,
    kind: "awaiting_confirmation",
    operation,
    intentId: prepared.intentId,
    questionId: prepared.questionId,
    label: prepared.label,
    confirmation,
  };
}

function currentActiveCardId() {
  if (parametersOpen.value && parametersCard.value?.id) return parametersCard.value.id;
  return selectedCardId() || "";
}

function snapshotMeta() {
  const dashboardId = normalizeId(props.dashboardId) || undefined;
  const cardId = currentActiveCardId() || undefined;
  return {
    ...(dashboardId ? { dashboardId } : {}),
    ...(cardId ? { cardId } : {}),
  };
}

async function fillForm(request) {
  const activeDashboardId = normalizeId(props.dashboardId) || null;
  if (request.expectedDashboardId !== undefined && request.expectedDashboardId !== activeDashboardId) {
    return {
      ok: false,
      reason: "stale",
      ...(request.member ? { member: request.member } : {}),
      message: "The displayed dashboard board changed since the last observation.",
    };
  }
  if (request.member === "board") {
    const id = normalizeId(props.dashboardId);
    if (!id || !Array.isArray(chartGroups.value)) {
      return {
        ok: false,
        reason: "form_not_ready",
        member: "board",
        message: "The dashboard is not loaded yet.",
      };
    }
    if (savingBoardPreview.value) {
      return {
        ok: false,
        reason: "form_not_ready",
        member: "board",
        message: "Dashboard changes are currently saving.",
      };
    }
    if (hasPendingLayoutSave()) {
      return {
        ok: false,
        reason: "stale",
        member: "board",
        message: "The dashboard has a pending layout auto-save in progress. Please wait for it to finish and re-read the board before applying changes.",
      };
    }
    const parsed = parseBoardPreviewFill(id, chartGroups.value, request.values, ++boardPreviewVersion, boardName.value);
    if (!parsed.ok) return parsed;

    const inlineConflicts = findBoardInlineEditConflicts(
      boardName.value,
      chartGroups.value,
      parsed.preview,
      {
        boardName: Boolean(props.editingBoardName),
        groupId: activeGroupRenameId.value,
        cardId: activeCardRenameId.value,
      },
    );
    if (inlineConflicts.length > 0 && !request.overwriteUnsaved) {
      return {
        ok: false,
        reason: "blocked_unsaved",
        member: "board",
        message: `The user is currently editing ${inlineConflicts.map((item) => item.label).join(", ")}. Ask the user or retry with overwriteUnsaved: true to overwrite.`,
      };
    }

    if (boardPreview.value || parsed.preview.layoutGroups) {
      const expectedBaseline = boardPreview.value?.baselineFingerprint ?? parsed.preview.baselineFingerprint;
      const baselineCheck = await verifyBoardPreviewBaseline(id, expectedBaseline);
      if (!baselineCheck.ok) {
        if (boardPreview.value) {
          boardPreviewFailure.value = { code: null, message: baselineCheck.message };
        }
        return {
          ok: false,
          reason: "stale",
          member: "board",
          message: baselineCheck.message,
        };
      }
      if (hasPendingLayoutSave()) {
        return {
          ok: false,
          reason: "stale",
          member: "board",
          message: "The dashboard has a pending layout auto-save in progress. Please wait for it to finish and re-read the board before applying changes.",
        };
      }
    }

    if (inlineConflicts.length > 0 && request.overwriteUnsaved) {
      for (const conflict of inlineConflicts) {
        if (conflict.kind === "boardName") emit("cancel-board-rename");
        if (conflict.kind === "groupName") cancelActiveGroupRename();
        if (conflict.kind === "cardName") cancelActiveCardRename();
      }
    }

    boardPreview.value = mergeBoardPreview(boardPreview.value, parsed.preview, chartGroups.value);
    boardPreviewFailure.value = null;
    return {
      ok: true,
      member: "board",
      filledFields: parsed.filledFields,
      ...(parsed.rejectedFields ? { rejectedFields: parsed.rejectedFields } : {}),
    };
  }
  if (request.member && request.member !== "card.parameters") {
    return {
      ok: false,
      reason: "form_not_found",
      member: request.member,
      message: `No form '${request.member}' exists on this dashboard page.`,
    };
  }
  const activeCardId = currentActiveCardId() || null;
  if (request.expectedCardId !== undefined && request.expectedCardId !== activeCardId) {
    return {
      ok: false,
      reason: "stale",
      member: "card.parameters",
      message: "The selected dashboard card changed since the last observation.",
    };
  }
  const selectedId = selectedCardId();
  if (!parametersOpen.value) {
    const opened = await openParametersForCard(selectedId);
    if (!opened.ok) {
      return {
        ok: false,
        reason: "form_not_ready",
        member: "card.parameters",
        message: "Select a dashboard card or open its parameter dialog before filling parameters.",
      };
    }
  } else if (selectedId && parametersCard.value && selectedId !== parametersCard.value.id) {
    const switched = await openParametersForCard(selectedId, {
      allowReplaceUnsaved: Boolean(request.overwriteUnsaved),
    });
    if (!switched.ok) {
      return {
        ok: false,
        reason: switched.reason === "blocked_unsaved" ? "blocked_unsaved" : "form_not_ready",
        member: "card.parameters",
        message: switched.message,
      };
    }
  }
  if (!parameterDialogRef.value) {
    return {
      ok: false,
      reason: "form_not_ready",
      member: "card.parameters",
      message: "The card parameter dialog is not mounted.",
    };
  }
  return parameterDialogRef.value.fillValues(request.values, request.overwriteUnsaved);
}

async function executeAction(request) {
  const operation = request.operation;
  const activeDashboardId = normalizeId(props.dashboardId) || null;
  if (request.expectedDashboardId !== undefined && request.expectedDashboardId !== activeDashboardId) {
    return {
      ok: false,
      reason: "stale",
      operation,
      message: "The displayed dashboard board changed since the last observation.",
    };
  }
  const isCardScopedAction =
    operation === "card.parameters.save"
    || operation === "card.parameters.discard"
    || (operation === "card.parameters.open" && typeof request.input?.cardId !== "string")
    || ((operation === "form.save" || operation === "form.discard") && parametersOpen.value);
  if (isCardScopedAction && request.expectedCardId !== undefined) {
    const activeCardId = currentActiveCardId() || null;
    if (request.expectedCardId !== activeCardId) {
      return {
        ok: false,
        reason: "stale",
        operation,
        message: "The selected dashboard card changed since the last observation.",
      };
    }
  }
  if (operation === "page.refresh") {
    const id = normalizeId(props.dashboardId);
    if (id) await loadDashboardAll(id);
    return { ok: true, kind: "executed", operation };
  }
  if (operation === "card.parameters.open") {
    const requestedCardId = typeof request.input?.cardId === "string" ? request.input.cardId : undefined;
    const opened = await openParametersForCard(requestedCardId);
    return opened.ok
      ? { ok: true, kind: "executed", operation }
      : { ok: false, reason: "action_unavailable", operation, message: opened.message };
  }
  if (operation === "card.parameters.save") {
    if (!parameterDialogRef.value) {
      return { ok: false, reason: "action_not_ready", operation, message: "The card parameter dialog is not open." };
    }
    return parameterDialogRef.value.saveFromAction(operation, request.agentRun);
  }
  if (operation === "card.parameters.discard") {
    if (!parametersOpen.value || !parameterDialogRef.value) {
      return { ok: false, reason: "action_not_ready", operation, message: "The card parameter dialog is not open." };
    }
    parameterDialogRef.value.discard();
    return { ok: true, kind: "executed", operation };
  }
  if (operation === "board.save") {
    return saveBoardFromAction(operation, request.agentRun);
  }
  if (operation === "board.discard") {
    if (!hasBoardPreview.value) {
      return { ok: false, reason: "action_unavailable", operation, message: "There are no unsaved dashboard changes to discard." };
    }
    await discardBoardPreview();
    return { ok: true, kind: "executed", operation };
  }
  if (operation === "form.save") {
    if (parametersOpen.value && parameterDialogRef.value) {
      return parameterDialogRef.value.saveFromAction(operation, request.agentRun);
    }
    if (hasBoardPreview.value) {
      return saveBoardFromAction(operation, request.agentRun);
    }
    return { ok: false, reason: "action_not_ready", operation, message: "No unsaved dashboard or parameter changes to save." };
  }
  if (operation === "form.discard") {
    if (parametersOpen.value && parameterDialogRef.value) {
      parameterDialogRef.value.discard();
      return { ok: true, kind: "executed", operation };
    }
    if (hasBoardPreview.value) {
      await discardBoardPreview();
      return { ok: true, kind: "executed", operation };
    }
    return { ok: false, reason: "action_not_ready", operation, message: "There are no unsaved changes to discard." };
  }
  return {
    ok: false,
    reason: "action_not_found",
    operation,
    message: `Unsupported dashboard action '${operation}'.`,
  };
}

defineExpose({
  reload: () => {
    const id = normalizeId(props.dashboardId);
    return id ? loadDashboardAll(id) : Promise.resolve();
  },
  isDirty: () => isDirty.value,
  snapshotMeta,
  selectCardById,
  openParametersForCard,
  fillForm,
  executeAction,
});
</script>

<style scoped>
.dash-root {
  width: 100%;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  align-self: stretch;
  overflow: auto;
  background: var(--shell-workspace-bg, var(--el-bg-color));
}

.dash-root.is-layout-pending {
  visibility: hidden;
}

.board-preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: var(--spacing-md);
  padding: 10px 14px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  flex-shrink: 0;
}

.board-preview-bar__text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}

.board-preview-bar__failure {
  display: flex;
  align-items: baseline;
  gap: 6px;
  width: 100%;
  color: var(--el-color-danger);
  font-size: var(--text-xs);
}

.board-preview-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.is-preview-modified {
  outline: 1.5px dashed var(--el-color-primary);
  outline-offset: -1px;
}

/* Empty state: no dimensions */
.empty-state {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 0 24px;
  margin: 0;
  box-sizing: border-box;
  background: transparent;
}

.empty-state__content {
  text-align: center;
  transform: translateY(-24px);
}

.empty-state__icon {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
  margin: 0 auto var(--spacing-lg);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.empty-state__title {
  font-size: var(--text-xl);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  margin-bottom: 8px;
}

.empty-state__desc {
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
  margin-bottom: 20px;
}

/* Main body */
.bi-dashboard {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  padding: var(--spacing-lg) 0 0;
  box-sizing: border-box;
  background-color: transparent;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg-xl);
}

.block {
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  padding: var(--surface-padding);
  box-shadow: var(--shadow-card);
}

/* ===============================
   group header (icon + title + more)
================================ */
.group-header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding-right: 2px;
  margin-bottom: 12px;
  box-sizing: border-box;
}

.group-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  cursor: grab;
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
  transition: all var(--transition-fast);
}
.group-drag-handle:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.group-title {
  flex: 1;
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  line-height: 1;
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.group-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.group-more:hover {
  background: var(--el-fill-color-dark);
  color: var(--el-color-primary);
}

.group-header :deep(.el-icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  vertical-align: middle;
}

/* ===============================
   metric card
================================ */
.metrics-section {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: 102px;
  gap: 14px;
  margin-bottom: 14px;
}

.metrics-section.metrics-empty {
  margin-bottom: 0;
}

/* ===============================
   chart area
================================ */
.charts-wrapper {
  position: relative;
}

.charts-section {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  grid-auto-rows: 360px;
  gap: 14px;
}

.charts-section--empty {
  min-height: 200px;
  border: 1.5px dashed var(--el-border-color-dark);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-extra-light);
}

.charts-empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.charts-empty-hint {
  text-align: center;
  user-select: none;
  padding: 24px;
}

.charts-empty-hint__title {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}

.charts-empty-hint__desc {
  font-size: var(--text-sm);
  color: var(--el-text-color-tertiary);
  line-height: 1.7;
}

.charts-empty-hint__hl {
  font-weight: var(--font-semibold);
  color: var(--el-color-primary);
}

/* ===============================
   drag effect
================================ */
.drag-ghost {
  opacity: 0.45;
  border-radius: var(--radius-md);
}
.drag-dragging {
  cursor: grabbing !important;
  border-radius: var(--radius-md);
}

/* Others */
.empty {
  text-align: center;
  margin-top: 20px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-sm);
}

.btn-icon {
  margin-right: 6px;
}
@media (max-width: 700px) {
  :where(html.workbench-mobile-navigation) .bi-dashboard {
    padding: var(--spacing-lg) 0 env(safe-area-inset-bottom);
    gap: 12px;
  }
  :where(html.workbench-mobile-navigation) .block {
    padding: 12px 10px;
    border-radius: 12px;
  }
  :where(html.workbench-mobile-navigation) .group-header {
    margin-bottom: 8px;
  }
  :where(html.workbench-mobile-navigation) .group-title {
    font-size: var(--text-base);
  }
  :where(html.workbench-mobile-navigation) .metrics-section,
  :where(html.workbench-mobile-navigation) .charts-section {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }
  :where(html.workbench-mobile-navigation) .metrics-section > *,
  :where(html.workbench-mobile-navigation) .charts-section > * {
    grid-column: 1 / -1 !important;
  }
  :where(html.workbench-mobile-navigation) .charts-section {
    grid-auto-rows: 300px;
  }
  :where(html.workbench-mobile-navigation) .group-drag-handle {
    display: none;
  }
  :where(html.workbench-mobile-navigation) .empty-state {
    padding: 16px;
  }
  :where(html.workbench-mobile-navigation) .empty-state__content {
    transform: none;
  }
}
</style>
