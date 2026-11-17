<template>
  <!-- Outer gate: hide the UI only while the first-screen is pending -->
  <div ref="dashRootRef" class="dash-root" :class="{ 'is-layout-pending': !layoutReady }">
    <!-- Empty state: dashboard with no dimensions (vertically centered) -->
    <div
      v-if="
        normalizeId(props.dashboardId) && Array.isArray(chartGroups) && chartGroups.length === 0
      "
      class="empty-state"
    >
      <div class="empty-state__content">
        <div class="empty-state__icon">📊</div>
        <div class="empty-state__title">{{ t("hotData.noDimensionInDashboard") }}</div>
        <div class="empty-state__desc">{{ t("hotData.createDimensionFirstHint") }}</div>
        <el-button type="primary" size="large" @click="handleCreateDimension">
          <el-icon class="btn-icon"><Plus /></el-icon>
          {{ t("analysis.createDimension") }}
        </el-button>
      </div>
    </div>

    <!-- Main body: group dragging -->
    <Draggable
      v-else-if="Array.isArray(chartGroups)"
      v-model="chartGroups"
      class="bi-dashboard"
      item-key="id"
      handle=".group-drag-handle"
      :animation="180"
      :force-fallback="true"
      :fallback-tolerance="3"
      :group="{ name: 'dashboard-groups', pull: true, put: false }"
      :ghost-class="'drag-ghost'"
      :drag-class="'drag-dragging'"
      :disabled="dragDisabled"
      @end="() => persistLayoutDebounced()"
    >
      <template #item="{ element: g }">
        <div class="block" :data-group-id="g.id">
          <div class="group-header">
            <span class="group-drag-handle" :title="t('dashboard.dragToMoveGroup')">
              <el-icon :size="16"><GripVertical /></el-icon>
            </span>

            <div class="group-title" :title="g.title || ''">
              {{ g.title || t("hotData.unnamedDimension") }}
            </div>

            <DropdownMenu
              scene="dimension"
              trigger-class="group-more"
              @command="(cmd) => handleDimensionCommand(cmd, g)"
            />
          </div>

          <!-- Metric dragging -->
          <Draggable
            v-if="Array.isArray(g.metrics)"
            v-model="g.metrics"
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
            :disabled="dragDisabled"
            @end="() => persistLayoutDebounced()"
          >
            <template #item="{ element: m }">
              <MetricCard
                :metric="m"
                :data-card-id="m.id"
                :selected="isSelected(m.id, 'metric')"
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
              v-model="g.charts"
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
              :disabled="dragDisabled"
              @end="() => persistLayoutDebounced()"
            >
              <template #item="{ element: c }">
                <ChartCard
                  :chart="c"
                  :data-card-id="c.id"
                  :style="gridSpanStyle((draftChange(c.id) || {}).layout || c.layout)"
                  :dashboard-id="normalizeId(props.dashboardId)"
                  :preview-file="(draftChange(c.id) || {}).chartFile || null"
                  :preview-name="(draftChange(c.id) || {}).name || ''"
                  :draft="Boolean(draft)"
                  :selected="isSelected(c.id, 'chart')"
                  @select="(card) => selectCard(card)"
                  @chart-renamed="handleChartRenamed"
                  @chart-deleted="handleChartDeleted"
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

    <!-- A draft the reader has not saved yet: what it changes, and the ways to save or discard it. -->
    <div v-if="draft" class="draft-bar" role="region" :aria-label="t('dashboard.draft.title')">
      <div class="draft-bar__text">
        <strong>{{ t("dashboard.draft.title") }}</strong>
        <span>{{ draftSummary }}</span>
        <span v-if="draftBoardName" class="draft-bar__board">{{ t("dashboard.draft.boardWas", { from: boardName, to: draftBoardName }) }}</span>
      </div>
      <div v-if="draftFailure" class="draft-bar__failure" role="alert">
        <strong v-if="draftFailureHeadline">{{ draftFailureHeadline }}</strong>
        <span>{{ draftFailure.message }}</span>
      </div>
      <div class="draft-bar__actions">
        <el-button :disabled="savingDraft" @click="emit('discard-draft')">{{ t("common.cancel") }}</el-button>
        <el-button
          type="primary"
          :loading="savingDraft"
          :disabled="draft.operation === 'dashboard.card.parameters' && !parametersOpen"
          @click="saveDraft"
        >
          {{ t("common.save") }}
        </el-button>
      </div>
    </div>

    <MetricSourceDialog v-model="metricSourceOpen" :card="metricSourceCard" />

    <CardParameterDialog
      v-model="parametersOpen"
      :dashboard-id="normalizeId(props.dashboardId)"
      :card="parametersCard"
      :draft="parameterDraft"
      @saved="handleParametersSaved"
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
import { applyDraft } from "../draft";
import { clearDashboardSelection, setDashboardSelection } from "../selection";

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
  renameDashboard,
  saveCardParameters,
  createDimension,
} from "../api";

import { useI18n } from "vue-i18n";

const { t } = useI18n();

/* ======================== props & state ======================== */

/**
 * One dashboard: its groups and cards, each card drawn from the metric it references. A draft an agent wrote may be
 * open on it: the board then shows the draft's changes over the saved ones, saves nothing by itself, and waits for the
 * reader to save or discard it.
 */
const props = defineProps({
  dashboardId: { type: String, default: "" },
  draft: { type: Object, default: null },
});
const emit = defineEmits(["discard-draft"]);

const dragDisabled = ref(false);
const chartGroups = ref(null);
const attrShowNameMapByClass = ref({});

const metricSourceOpen = ref(false);
const metricSourceCard = ref(null);

const parametersOpen = ref(false);
const parametersCard = ref(null);

const loader = createDashboardLoader();

/* ======================== draft ======================== */

const draftChanges = ref(new Map());
const draftGroupsRenamed = ref(new Map());
const draftBoardName = ref("");
/** The board's saved name, so a draft's own name stands beside it. */
const boardName = ref("");
const savingDraft = ref(false);
const draftFailure = ref(null);
const draftFailureHeadline = computed(() => (draftFailure.value ? cardErrorHeadline(draftFailure.value, t) : null));

function draftChange(cardId) {
  return draftChanges.value.get(cardId);
}

const draftSummary = computed(() => {
  if (!props.draft) return "";
  const names = [...draftChanges.value.values()].filter((change) => change.name).length;
  const files = [...draftChanges.value.values()].filter((change) => change.chartFile).length;
  const layouts = [...draftChanges.value.values()].filter((change) => change.layout).length;
  const groups = draftGroupsRenamed.value.size;
  const parts = [];
  if (names) parts.push(t("dashboard.draft.names", { n: names }, names));
  if (files) parts.push(t("dashboard.draft.charts", { n: files }, files));
  if (layouts) parts.push(t("dashboard.draft.layouts", { n: layouts }, layouts));
  if (draftBoardName.value) parts.push(t("dashboard.draft.boardName", { name: draftBoardName.value }));
  if (groups) parts.push(t("dashboard.draft.groups", { n: groups }, groups));
  if (props.draft.operation === "dashboard.card.parameters") parts.push(t("dashboard.draft.parameters"));
  return parts.join(t("dashboard.draft.separator"));
});

/** The draft's parameter change, handed to the parameter form as the values to show and the revision it was written on. */
const parameterDraft = computed(() => {
  const form = props.draft ? props.draft.form : null;
  return form ? { revision: form.revision, values: form.values } : null;
});

/**
 * Lays the draft over a freshly read board: the draft's names, chart files and layouts show, and nothing is posted.
 * Each card's rows still come from its saved query, so a chart file is previewed with this card's current data.
 */
async function applyDraftToBoard() {
  if (!props.draft) return;
  const detail = await fetchDashboardLocalDetail(normalizeId(props.dashboardId));
  boardName.value = detail.name;
  const applied = applyDraft(detail, props.draft);
  draftChanges.value = applied.cards;
  draftGroupsRenamed.value = applied.groupsRenamed;
  draftBoardName.value = applied.boardName ?? "";
  chartGroups.value = applied.groups.map((group) => ({
    ...group,
    charts: group.charts.map((card) => ({ ...card, title: card.name, state: "loading" })),
    metrics: group.metrics.map((card) => ({ ...card, state: "loading" })),
  }));
  await Promise.all(
    [...applied.groups.flatMap((group) => group.charts), ...applied.groups.flatMap((group) => group.metrics)].map((card) =>
      metricCardTask(normalizeId(props.dashboardId), card.id, setGroups)(),
    ),
  );
}

/** Saves the draft through the page's own action for its operation; the saved board then replaces the draft. */
async function saveDraft() {
  const draft = props.draft;
  if (!draft) return;
  const id = normalizeId(props.dashboardId);
  savingDraft.value = true;
  draftFailure.value = null;
  try {
    if (draft.operation === "dashboard.layout") {
      if (!(await modifyDashboardLayout(id, draft.form.groups))) throw new Error(t("dashboard.layoutSaveFailedRetry"));
    } else if (draft.operation === "dashboard.rename") {
      const form = draft.form;
      if (!(await renameDashboard(id, form.name))) throw new Error(t("common.renameFailed"));
    } else if (draft.operation === "dashboard.group.rename") {
      const form = draft.form;
      if (!(await modifyDimensionName(id, form.groupId, form.dimensionName))) throw new Error(t("common.renameFailed"));
    } else if (draft.operation === "dashboard.chart.rename") {
      const form = draft.form;
      if (!(await modifyResultSetName(id, form.chartId, form.resultSetName))) throw new Error(t("common.renameFailed"));
    } else if (draft.operation === "dashboard.metric.rename") {
      const form = draft.form;
      if (!(await modifyMetricName(id, form.metricId, form.metricName))) throw new Error(t("common.renameFailed"));
    } else {
      const form = draft.form;
      await saveCardParameters({ dashboardId: id, cardId: form.cardId, revision: form.revision, values: form.values });
    }
    ElMessage.success(t("dashboard.draft.saved"));
    emit("discard-draft");
    await loadDashboardAll(id);
  } catch (error) {
    draftFailure.value = cardError(error);
  } finally {
    savingDraft.value = false;
  }
}

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

async function reloadDashboardGroups(id) {
  const detail = await fetchDashboardLocalDetail(id);
  boardName.value = detail?.name ?? "";
  chartGroups.value = Array.isArray(detail?.groups) ? detail.groups : [];
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

function buildLayoutPersistPayload(groups) {
  const gs = Array.isArray(groups) ? groups : [];

  const pickLayout = (layout) => ({
    colSpan: clamp(layout?.colSpan ?? 1, 1, 24),
    rowSpan: clamp(layout?.rowSpan ?? 1, 1, 6),
  });

  // A card sends only its presentation: its query and its chart file stay as saved, and a draft changes the file.
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
  // A draft's preview is not a saved layout: nothing is posted while it is open.
  if (props.draft) return;
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
  const id = normalizeId(props.dashboardId);
  if (!id || props.draft) return;
  persistDirty = true;

  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushPersistLayout();
  }, 400);
}

/* ======================== create dimension ======================== */

async function handleCreateDimension(insertIndex) {
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

async function loadDashboardAll(id) {
  // 1) Local detail
  await reloadDashboardGroups(id);

  // 2) Remote merge (read every card's current result)
  await loader.loadDashboardById(id, setGroups);
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
  () => [normalizeId(props.dashboardId), props.draft],
  async ([id]) => {
    const loadToken = ++dashboardLoadToken;

    // Reset the dashboard reset gate
    resetLayoutGate();

    if (!id) {
      chartGroups.value = null;
      layoutReady.value = true;
      return;
    }

    try {
      if (props.draft) {
        // The board under a draft is read again and drawn with the draft's own changes; its rows still come from the
        // saved query, so the preview is this card's data with the draft's file, not a save.
        await applyDraftToBoard();
        if (loadToken !== dashboardLoadToken) return;
      } else {
        await loadDashboardAll(id);
        if (loadToken !== dashboardLoadToken) return;
      }

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

/** The name a card is shown under in the draft's board. */
function cardName(cardId) {
  const cards = Array.isArray(chartGroups.value) ? chartGroups.value.flatMap((group) => [...group.charts, ...group.metrics]) : [];
  return String(cards.find((card) => card.id === cardId)?.name ?? "");
}

/* ======================== lifecycle ======================== */

onMounted(async () => {
  fetchClassMetas().then((cmap) => {
    attrShowNameMapByClass.value = cmap;
  });

  await nextTick();
  ensureLayoutObserver();
});

onBeforeUnmount(() => {
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

      const nextName = String(ret?.value || "").trim();
      if (!nextName) return;

      const ok = await modifyDimensionName(id, groupId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));

      chartGroups.value = patchDimensionTitle(chartGroups.value, groupId, nextName);
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
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

  if (cmd === "rename") {
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

      const nextName = String(ret?.value || "").trim();
      if (!nextName) return;

      const ok = await modifyMetricName(id, metricId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));

      chartGroups.value = patchMetricTitle(chartGroups.value, metricId, nextName);
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
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
 * alone, the board it sits in rides along, and the page reports both to the platform. The board is reported on its own
 * as soon as it is drawn, so a question about the board needs no card chosen first.
 */
const chosen = ref("");

function isSelected(cardId, kind) {
  return chosen.value === `${kind}:${cardId}`;
}

function selectCard(card) {
  chosen.value = `${card.kind}:${card.id}`;
  reportSelection();
  // A card chosen in a narrow pane is shown, not only marked: the reader asked for this one.
  nextTick(() => document.querySelector(`[data-card-id="${card.id}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
}

/** The board and, when one is chosen, that card, as the platform reads them for a message sent from beside the page. */
function reportSelection() {
  const id = normalizeId(props.dashboardId);
  if (!id) return;
  const kind = chosen.value.startsWith("chart:") ? "chart" : "metric";
  const cardId = chosen.value.slice(kind.length + 1);
  // The card's name is the one shown: a draft's name while the draft is open, the saved one otherwise.
  const card = [...(chartGroups.value || []).flatMap((group) => [...group.charts, ...group.metrics])].find((item) => item.id === cardId);
  setDashboardSelection({ id, name: boardName.value || id }, card ? { id: card.id, name: (draftChange(card.id) || {}).name || card.name || card.title || card.id, kind } : undefined);
}

/** A board is a fresh page: the card chosen on the last one is not this one's. */
watch(() => normalizeId(props.dashboardId), () => {
  chosen.value = "";
  reportSelection();
}, { immediate: true });
watch(chartGroups, () => reportSelection());

onBeforeUnmount(() => clearDashboardSelection());

/* ======================== layout change ======================== */

function handleLayoutChange(card, layout) {
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
  if (!props.draft) metricCardTask(normalizeId(props.dashboardId), cardId, setGroups)();
  else emit("discard-draft");
}

/** A draft of a card's parameters opens its form with the draft's values; nothing else in it changes. */
watch(
  () => props.draft,
  (draft) => {
    if (draft?.operation !== "dashboard.card.parameters") return;
    parametersCard.value = { id: draft.form.cardId, name: cardName(draft.form.cardId) };
    parametersOpen.value = true;
  },
  { immediate: true },
);
</script>
