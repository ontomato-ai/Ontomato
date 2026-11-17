<template>
  <div
    ref="rootRef"
    class="chart-container"
    :class="{ 'chart-container--draft': draft, 'chart-container--selected': selected }"
    tabindex="0"
    @click="selectUnlessControl"
    @focusin="select"
    @keydown.enter.prevent="select"
  >
    <div class="chart-header">
      <h3 :title="shownTitle">
        <span v-if="renamed" class="chart-original-name">{{ title }}</span>
        {{ shownTitle }}
      </h3>
      <span
        v-if="chartChanged"
        class="chart-draft-badge"
        role="note"
        :title="t('dashboard.draft.chartChanged')"
        :aria-label="t('dashboard.draft.chartChanged')"
      >
        {{ t("dashboard.draft.chartChanged") }}
      </span>
      <span
        v-if="partialNotice && state !== 'empty'"
        class="chart-partial"
        role="note"
        :title="partialNotice"
        :aria-label="partialNotice"
      >
        <TriangleAlert :size="14" />
      </span>
      <ChartToolbar
        :data-open="dataOpen"
        @edit-parameters="emit('edit-parameters', props.chart)"
        @open-zoom="openZoom"
        @toggle-data="toggleData"
        @command="handleCommand"
      />
    </div>
    <div
      v-loading="loading"
      :class="['chart-wrapper', { 'chart-wrapper--transparent-loading': transparentLoading }]"
      :element-loading-text="t('common.loading')"
    >
      <div class="chart-wrapper__canvas">
        <MetricChart
          v-if="state === 'ready'"
          :key="drawnFile.name"
          :file="drawnFile.content"
          :metric="output"
          height="100%"
          :empty="t('common.noData')"
        />
        <div v-if="state === 'empty'" class="chart-mask">
          {{ partialNotice || t("common.noData") }}
        </div>
        <div v-else-if="state === 'error'" class="chart-mask chart-mask--error" role="alert">
          <strong v-if="errorHeadline">{{ errorHeadline }}</strong>
          <span>{{ chart.error.message }}</span>
        </div>
      </div>
      <ChartDataOverlay
        :open="dataOpen"
        :table="table"
        :total="(chart.rows ?? []).length"
        :source-label="t('dashboard.viewMetric')"
        @view-dsl="handleViewQuery"
      />
    </div>
    <ChartZoomModal
      :open="modalOpen"
      :mode="modalMode"
      :title="shownTitle"
      :file="drawnFile.content"
      :metric="output"
      :table="table"
      @close="closeZoom"
    />
    <!-- Bottom-right resize handle -->
    <span class="resize-handle" :title="t('dashboard.dragToResize')" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import interact from "interactjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { TriangleAlert } from "lucide-vue-next";
import { MetricChart } from "@ontomato/foundation-ui/chart";
import ChartDataOverlay from "./ChartDataOverlay.vue";
import ChartToolbar from "./ChartToolbar.vue";
import ChartZoomModal from "./ChartZoomModal.vue";
import { cardErrorHeadline, chartCardTable } from "./utils/metricCard";
import { deleteResultSet, modifyResultSetName } from "../api";
import { clamp, parseGridColumns, partialResultNotice } from "./utils/dashboardHelper";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";

/** Loading mask background follows the app's original value (open source: transparent). */
const transparentLoading = workbenchContent().dashboard.loadingMask === "transparent";

const { t } = useI18n();

/**
 * One chart card: the platform's chart draws the card's own `.chart.json` file filled from the metric's current output.
 * A draft may name another file or another name for the same card; it draws that file over this output and touches
 * nothing the card has saved.
 */
const props = defineProps({
  chart: { type: Object, required: true },
  dashboardId: { type: String, default: "" },
  /** A draft's chart file for this card, drawn over the saved one. */
  previewFile: { type: Object, default: null },
  /** A draft's name for this card. */
  previewName: { type: String, default: "" },
  /** Whether the card is shown as a draft: it says so, and does not save its layout while it is one. */
  draft: { type: Boolean, default: false },
  /** Whether this card is the one the reader chose: a message sent from beside the page asks about it. */
  selected: { type: Boolean, default: false },
});
const emit = defineEmits([
  "chart-renamed",
  "chart-deleted",
  "view-metric",
  "edit-parameters",
  "layout-change",
  "resize-active",
  "select",
]);

const rootRef = ref(null);
let interactable = null;
const loading = computed(() => props.chart.state === "loading");
const title = computed(() => String(props.chart?.title || props.chart?.name || ""));
const renamed = computed(() => Boolean(props.previewName) && props.previewName !== title.value);
const shownTitle = computed(() => (props.previewName ? props.previewName : title.value));
const chartChanged = computed(() => Boolean(props.previewFile));
/** The file this card draws: the draft's when it names one, otherwise the card's saved file. */
const drawnFile = computed(() => (props.previewFile ? props.previewFile : props.chart.chartFile));
/** This refresh's output for the card; the platform's chart fills it into the file. */
const output = computed(() => ({
  columns: props.chart.columns ?? [],
  rows: props.chart.rows ?? [],
  truncation: props.chart.truncation ?? undefined,
}));
const dataOpen = ref(false);
const errorHeadline = computed(() => (props.chart?.error ? cardErrorHeadline(props.chart.error, t) : null));

const TABLE_ROWS = 500;
/** The data table and the zoomed table read this refresh's rows, written in the formats the card's file states. */
const table = computed(() => {
  const data = { columns: output.value.columns, rows: output.value.rows, truncation: props.chart.truncation ?? null };
  const table = chartCardTable(drawnFile.value.content, data);
  return { columns: table.columns, rows: table.rows.slice(0, TABLE_ROWS) };
});

const modalOpen = ref(false);
const modalMode = ref("chart");

/** Zero rows of a partial result are not "no data": the empty mask shows this notice instead. */
const partialNotice = computed(() => partialResultNotice(props.chart?.truncation, t));

const state = computed(() => props.chart?.state ?? "empty");

function handleViewQuery() {
  emit("view-metric", props.chart);
}

/** The reader asked for this card: one card is chosen at a time, and choosing it again keeps it chosen. */
function select() {
  emit("select", { id: props.chart.id, name: shownTitle.value, kind: "chart" });
}

/** A tool or the resize handle acts on the card; choosing it is the reader pointing at the card itself. */
function selectUnlessControl(event) {
  const target = event.target;
  if (target?.closest(".ai-chart-toolbar, .resize-handle, .el-dropdown-menu, .el-dialog")) return;
  select();
}

async function handleCommand(cmd) {
  const dashboardId = String(props.dashboardId || "").trim();
  const chartId = String(props.chart?.id || "").trim();

  if (cmd === "rename") {
    try {
      const ret = await ElMessageBox.prompt(
        t("analysis.enterChartName"),
        t("analysis.renameChart"),
        {
          confirmButtonText: t("common.ok"),
          cancelButtonText: t("common.cancel"),
          inputValue: title.value,
        }
      );
      const nextName = String(ret?.value || "").trim();
      if (!nextName || nextName === title.value) return;
      const ok = await modifyResultSetName(dashboardId, chartId, nextName);
      if (!ok) throw new Error(t("common.renameFailed"));
      emit("chart-renamed", { chartId, title: nextName });
      ElMessage.success(t("common.renamed"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("common.renameFailed"));
    }
    return;
  }

  if (cmd === "delete") {
    try {
      await ElMessageBox.confirm(
        t("analysis.deleteChartConfirm", { name: title.value || chartId }),
        t("common.deleteConfirm"),
        {
          confirmButtonText: t("common.delete"),
          cancelButtonText: t("common.cancel"),
          type: "warning",
          confirmButtonClass: "el-button--danger",
        }
      );
      const ok = await deleteResultSet(dashboardId, chartId);
      if (!ok) throw new Error(t("admin.deleteFailed"));
      emit("chart-deleted", { chartId });
      ElMessage.success(t("common.deleted"));
    } catch (e) {
      if (e === "cancel") return;
      ElMessage.error(e instanceof Error ? e.message : t("admin.deleteFailed"));
    }
  }
}

function toggleData() {
  dataOpen.value = !dataOpen.value;
}

function openZoom() {
  select();
  if (dataOpen.value) {
    modalMode.value = "table";
    modalOpen.value = true;
    return;
  }

  modalMode.value = "chart";
  modalOpen.value = true;
}

function closeZoom() {
  modalOpen.value = false;
}

/* ======================== resize (grid layout) ========================= */
function setupResize() {
  const el = rootRef.value;
  if (!el) return;

  interactable = interact(el).resizable({
    allowFrom: ".resize-handle",
    edges: { right: true, bottom: true, left: false, top: false },
    listeners: {
      start() {
        emit("resize-active", true);
      },
      move(event) {
        const target = event.target;
        const gridEl = target.closest(".charts-section");
        const { colCount, colWidth, gap } = parseGridColumns(gridEl);

        const w = event.rect.width;
        const h = event.rect.height;

        const colSpan = clamp(Math.round((w + gap) / (colWidth + gap)), 1, Math.max(1, colCount));

        // rowSpan: roughly converted from the chart-wrapper base height 280 + header/toolbars
        const baseRowPx = 360;
        const rowGap = 16;
        const rowSpan = clamp(Math.round((h + rowGap) / (baseRowPx + rowGap)), 1, 6);

        emit("layout-change", { colSpan, rowSpan });
      },
      end() {
        emit("resize-active", false);
      },
    },
    modifiers: [
      interact.modifiers.restrictSize({
        min: { width: 360, height: 260 },
      }),
    ],
    inertia: true,
  });
}

onMounted(setupResize);

onBeforeUnmount(() => {
  if (interactable) {
    interactable.unset();
    interactable = null;
  }
});
</script>

<style scoped>
.chart-container {
  grid-column: span var(--col-span, 1);
  grid-row: span var(--row-span, 1);
  height: 100%;
  padding: var(--surface-padding);
  background-color: var(--el-bg-color);
  border-radius: var(--radius-md);
  border: 1px solid var(--el-border-color);
  box-shadow: var(--shadow-card);
  position: relative;
  display: flex;
  flex-direction: column;
  transition: border-color var(--transition-fast);
}

.chart-container:hover {
  border-color: var(--el-border-color-dark);
}

.chart-container--draft {
  border-color: var(--el-color-primary);
  border-style: dashed;
}

.chart-container--selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary);
}

/* The header is as tall as the tools' buttons, so it keeps its height when they appear. */
.chart-header {
  display: flex;
  align-items: center;
  min-height: 26px;
  padding-bottom: var(--spacing-md);
  margin-bottom: var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color);
}

.chart-header h3 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

/* A draft's name stands beside the name it replaces, so the reader sees both. */
.chart-original-name {
  margin-right: 6px;
  color: var(--el-text-color-tertiary);
  font-weight: var(--font-normal);
  text-decoration: line-through;
}

.chart-draft-badge {
  flex-shrink: 0;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: var(--text-xs);
}

.chart-wrapper {
  width: 100%;
  flex: 1;
  min-height: 280px;
  position: relative;
}

.chart-wrapper__canvas {
  position: absolute;
  inset: 0;
}

/*
 * The card's chart fills the room the card gives it: the platform's chart takes a height, and here that height is the
 * card's own, not the panel default it draws a page-sized chart with. The chart's own padding comes out of that height,
 * so its canvas ends where the card's room ends.
 */
.chart-wrapper__canvas :deep(.metric-chart) {
  height: 100%;
  box-sizing: border-box;
}

.chart-wrapper--transparent-loading :deep(.el-loading-mask) {
  background-color: transparent;
}

.chart-partial {
  display: inline-flex;
  flex-shrink: 0;
  margin-left: 6px;
  color: var(--el-color-warning);
}

.chart-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs);
  background: color-mix(in srgb, var(--el-bg-color) 72%, transparent);
  border-radius: var(--radius-lg);
}

/* A card is narrow: the data view's column names wrap instead of being cut off. */
.chart-wrapper :deep(.table-preview .el-table__header .cell) {
  white-space: normal;
  overflow-wrap: anywhere;
}

.chart-mask--error {
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--el-text-color-secondary);
  overflow: auto;
}

.chart-mask--error strong {
  color: var(--el-color-danger);
  font-weight: 600;
}

:deep(.el-loading-spinner .el-loading-text) {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

/*
 * The tools sit at the end of the title's row and take room there only while shown (hover, keyboard focus, an open
 * menu): the title then gives way and ends in an ellipsis instead of lying under them. Hidden, they keep no width but
 * stay in the tab order, and focusing one shows them.
 */
:deep(.ai-chart-toolbar) {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  transition: opacity 0.18s ease;
  pointer-events: none;
  user-select: none;
}

.chart-container:hover :deep(.ai-chart-toolbar),
.chart-container:focus-within :deep(.ai-chart-toolbar),
:deep(.ai-chart-toolbar[data-open="1"]) {
  max-width: none;
  margin-left: var(--spacing-sm);
  overflow: visible;
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  :deep(.ai-chart-toolbar) {
    max-width: none;
    margin-left: var(--spacing-sm);
    overflow: visible;
    opacity: 1;
    pointer-events: auto;
  }
}

:deep(button.ai-chart-tool-btn) {
  width: 26px;
  height: 26px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  transition: all var(--transition-fast);
}

:deep(button.ai-chart-tool-btn:hover) {
  background: var(--el-fill-color);
  border-color: var(--el-border-color);
  color: var(--el-color-primary);
}

:deep(button.ai-chart-tool-btn:disabled),
:deep(button.ai-chart-tool-btn:disabled:hover) {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none;
  color: var(--el-text-color-tertiary);
}

:deep(button.ai-chart-tool-btn img) {
  width: 15px;
  height: 15px;
}

.chart-container:hover .resize-handle {
  opacity: 1;
}
</style>
