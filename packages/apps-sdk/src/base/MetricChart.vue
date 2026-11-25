<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fillChartFile } from "@ontomato/contracts/chart-data";
import { chartValueText } from "@ontomato/contracts/chart-presentation";
import type { chartProjectionTemplateSchema, DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { MetricChart as ChartView } from "@ontomato/foundation-ui/chart";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { TablePreview, type TableData } from "@ontomato/foundation-ui/preview";
import { useMemberData, useMemberRefresh } from "../panel/member";
import { useDataStateLabels } from "./data-state-labels";

/** The source card's chart file and saved parameters, as its owner hands them over. */
type ChartTemplate = ReturnType<typeof chartProjectionTemplateSchema.parse>;

type ChartPayload = {
  file: unknown;
  metric: DashboardMetricOutput;
};

/**
 * One chart, drawn as its source card draws it: the card's chart file (the member's `template`) filled with a
 * MetricView's output (its `result`) for the card's saved parameters with the values this panel binds laid over them,
 * which the card's owner works out for the reader. Supports toggling between the drawn chart and a formatted data
 * table (formatted with the chart file's declared `formats`, up to `tableMaxRows`), opening a fullscreen zoom modal
 * (`min(1100px, 92vw) x min(720px, 92vh)`), keeping the previous chart visible under a translucent overlay during
 * refresh instead of flashing blank, and rendering truncation warnings either inline, as a compact 14px orange
 * warning icon, or delegated to an outer card header via `@truncation-change`.
 */
const props = withDefaults(
  defineProps<{
    /** Optional title shown in the zoom modal header. */
    title?: string;
    /** Optional chart document override (used for preview/draft override or standalone rendering). */
    fileOverride?: unknown;
    /** Optional direct metric output override for standalone rendering outside a projection member. */
    metricOverride?: DashboardMetricOutput | null;
    /** Current display mode: `"chart"` or `"table"` (formatted data overlay). */
    viewMode?: "chart" | "table";
    /** Show a compact hover toolbar with chart/table toggle and zoom buttons inside the chart box. */
    allowViewToggle?: boolean;
    /** Allow opening the chart or data table in a centered fullscreen zoom modal. */
    allowZoom?: boolean;
    /** Optional controlled open state for the fullscreen zoom modal. */
    zoomed?: boolean;
    /** Maximum number of rows rendered in the formatted data table view (default `500`). */
    tableMaxRows?: number;
    /** How truncation notices appear: `"inline"` (default bar above chart), `"icon"` (14px warning triangle), or `"none"`. */
    truncationDisplay?: "inline" | "icon" | "none";
    /** Keep the previous rendered chart/table visible with a translucent loading veil while refreshing (default `true`). */
    keepPreviousOnRefresh?: boolean;
    /** Optional minimum height of the chart container (CSS length, default `"320px"`). */
    minHeight?: string;
  }>(),
  {
    title: "",
    fileOverride: undefined,
    metricOverride: undefined,
    viewMode: undefined,
    allowViewToggle: false,
    allowZoom: false,
    zoomed: undefined,
    tableMaxRows: 500,
    truncationDisplay: "inline",
    keepPreviousOnRefresh: true,
    minHeight: "320px",
  },
);

const emit = defineEmits<{
  /** Emitted when the user switches between chart and formatted data table view. */
  "update:viewMode": [mode: "chart" | "table"];
  /** Emitted when the fullscreen zoom modal opens or closes. */
  "update:zoomed": [open: boolean];
  /** Emitted whenever the bound metric output's truncation notice changes (or clears to `null`). */
  "truncation-change": [hint: string | null];
}>();

defineSlots<{
  /** Optional extra controls placed beside the view toggle / zoom buttons inside the chart toolbar. */
  toolbar?(scope: { viewMode: "chart" | "table"; zoomed: boolean; truncationHint: string | null }): unknown;
  /** Optional actions rendered on the right side of the data-table footer bar (for example a "View metric" button). */
  "table-footer-actions"?(scope: { rowCount: number; displayedRowCount: number; truncationHint: string | null }): unknown;
}>();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();
const locale = computed(() => i18n?.locale.value ?? "en");
const isZh = computed(() => locale.value.toLowerCase().startsWith("zh"));
function translate(key: string, fallback: string): string {
  if (i18n && i18n.te(key)) return i18n.t(key);
  return fallback;
}

const template = (() => {
  try {
    return useMemberData("template");
  } catch {
    return null;
  }
})();
const output = (() => {
  try {
    return useMemberData("result");
  } catch {
    return null;
  }
})();
const memberRefresh = (() => {
  try {
    return useMemberRefresh();
  } catch {
    return () => {};
  }
})();

function toChartViewMetric(metric: DashboardMetricOutput) {
  return {
    columns: metric.columns,
    rows: metric.rows,
    ...(metric.truncation ? { truncation: metric.truncation } : {}),
  };
}

const rawResult = computed<DataStateResult<ChartPayload>>(() => {
  if (props.fileOverride != null && props.metricOverride) {
    return { status: "ready", value: { file: props.fileOverride, metric: props.metricOverride } };
  }
  const tpl = template?.value;
  const out = output?.value;
  if (!tpl || !out) {
    return { status: "empty" };
  }
  if (props.fileOverride == null && tpl.status !== "ready") return tpl as DataStateResult<ChartPayload>;
  if (out.status !== "ready") return out as DataStateResult<ChartPayload>;
  const effectiveFile = props.fileOverride
    ?? (tpl.status === "ready" ? (tpl.value as unknown as ChartTemplate).chartFile.content : null);
  if (!effectiveFile) return { status: "empty" };
  return {
    status: "ready",
    value: { file: effectiveFile, metric: out.value as unknown as DashboardMetricOutput },
  };
});

const lastReadyPayload = ref<ChartPayload | null>(null);
watch(
  rawResult,
  (next) => {
    if (next.status === "ready") {
      lastReadyPayload.value = next.value;
    } else if (next.status === "error" || next.status === "forbidden" || next.status === "awaiting") {
      lastReadyPayload.value = null;
    }
  },
  { immediate: true },
);

const isRefreshing = computed(() =>
  props.keepPreviousOnRefresh && rawResult.value.status === "loading" && lastReadyPayload.value !== null,
);

const result = computed<DataStateResult<ChartPayload>>(() =>
  isRefreshing.value && lastReadyPayload.value
    ? { status: "ready", value: lastReadyPayload.value }
    : rawResult.value,
);

const currentPayload = computed<ChartPayload | null>(() =>
  result.value.status === "ready" ? result.value.value : null,
);

const truncationHint = computed<string | null>(() =>
  currentPayload.value?.metric.truncation?.truncationHint ?? null,
);
watch(
  truncationHint,
  (hint) => {
    emit("truncation-change", hint);
  },
  { immediate: true },
);

const internalViewMode = ref<"chart" | "table">(props.viewMode ?? "chart");
watch(
  () => props.viewMode,
  (next) => {
    if (next) internalViewMode.value = next;
  },
);
const activeViewMode = computed<"chart" | "table">(() => props.viewMode ?? internalViewMode.value);

function setViewMode(mode: "chart" | "table") {
  internalViewMode.value = mode;
  emit("update:viewMode", mode);
}
function toggleViewMode() {
  setViewMode(activeViewMode.value === "chart" ? "table" : "chart");
}

const internalZoomed = ref<boolean>(props.zoomed ?? false);
watch(
  () => props.zoomed,
  (next) => {
    if (typeof next === "boolean") internalZoomed.value = next;
  },
);
const isZoomed = computed(() => (props.zoomed !== undefined ? props.zoomed : internalZoomed.value));

function setZoomed(open: boolean) {
  internalZoomed.value = open;
  emit("update:zoomed", open);
}
function openZoom() {
  setZoomed(true);
}
function closeZoom() {
  setZoomed(false);
}

const tableSummary = computed<{
  table: TableData;
  totalRows: number;
  displayedRows: number;
  capped: boolean;
}>(() => {
  const payload = currentPayload.value;
  if (!payload) {
    return { table: { columns: [], rows: [] }, totalRows: 0, displayedRows: 0, capped: false };
  }
  const { file, metric } = payload;
  const filled = fillChartFile<NonNullable<DashboardMetricOutput["truncation"]>>(file, {
    columns: metric.columns,
    rows: metric.rows,
    truncation: metric.truncation ?? undefined,
  });
  const formats = filled.ok ? filled.presentation.display.formats : undefined;
  let sourceRows = metric.rows;
  if (filled.ok) {
    const dataset = filled.option.dataset as { source?: typeof metric.rows }[] | undefined;
    sourceRows = dataset?.[0]?.source ?? metric.rows.slice(0, filled.displayedRowCount);
  }
  const limit = Math.max(1, Math.floor(props.tableMaxRows || 500));
  const sliced = sourceRows.slice(0, limit);
  return {
    table: {
      columns: metric.columns.map((column) => column.label ?? column.key),
      rows: sliced.map((row) =>
        metric.columns.map((column) => chartValueText(row[column.key], formats?.[column.key])),
      ),
    },
    totalRows: sourceRows.length,
    displayedRows: sliced.length,
    capped: sourceRows.length > sliced.length,
  };
});

const tableFooterText = computed(() => {
  const { displayedRows, totalRows, capped } = tableSummary.value;
  const countText = capped
    ? (isZh.value ? `展示前 ${displayedRows} 行（共 ${totalRows} 行）` : `Showing first ${displayedRows} of ${totalRows} rows`)
    : (isZh.value ? `共 ${displayedRows} 行` : `${displayedRows} rows`);
  return truncationHint.value ? `${countText} · ${truncationHint.value}` : countText;
});

const showInternalToolbar = computed(() =>
  Boolean(
    props.allowViewToggle
    || props.allowZoom
    || (props.truncationDisplay === "icon" && truncationHint.value),
  ),
);

const labels = useDataStateLabels();

function onModalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && isZoomed.value) {
    event.stopPropagation();
    closeZoom();
  }
}

defineExpose({
  refresh: memberRefresh,
  viewMode: activeViewMode,
  zoomed: isZoomed,
  truncationHint,
  setViewMode,
  toggleViewMode,
  openZoom,
  closeZoom,
});
</script>

<template>
  <div
    class="sdk-metric-chart"
    :class="{ 'is-refreshing': isRefreshing, 'is-table-mode': activeViewMode === 'table' }"
    :style="{ minHeight }"
    :aria-busy="rawResult.status === 'loading' ? 'true' : undefined"
  >
    <div v-if="showInternalToolbar || $slots.toolbar" class="sdk-metric-chart-toolbar">
      <span
        v-if="truncationDisplay === 'icon' && truncationHint"
        class="sdk-metric-chart-truncation-icon"
        role="note"
        :title="truncationHint"
        :aria-label="truncationHint"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      </span>
      <slot name="toolbar" :view-mode="activeViewMode" :zoomed="isZoomed" :truncation-hint="truncationHint" />
      <button
        v-if="allowViewToggle"
        type="button"
        class="sdk-metric-chart-tool-btn"
        data-testid="metric-chart-toggle-view"
        :aria-pressed="activeViewMode === 'table'"
        :title="activeViewMode === 'chart' ? (isZh ? '查看数据表' : 'View data table') : (isZh ? '返回图表' : 'Back to chart')"
        :aria-label="activeViewMode === 'chart' ? (isZh ? '查看数据表' : 'View data table') : (isZh ? '返回图表' : 'Back to chart')"
        @click.stop="toggleViewMode"
      >
        <svg v-if="activeViewMode === 'chart'" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
          <path d="M9 3v18" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 3v18h18" />
          <path d="M18 17V9" />
          <path d="M13 17V5" />
          <path d="M8 17v-3" />
        </svg>
      </button>
      <button
        v-if="allowZoom"
        type="button"
        class="sdk-metric-chart-tool-btn"
        data-testid="metric-chart-zoom"
        :title="isZh ? '放大查看' : 'Expand'"
        :aria-label="isZh ? '放大查看' : 'Expand'"
        @click.stop="openZoom"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 15 6 6" />
          <path d="m15 9 6-6" />
          <path d="M21 16v5h-5" />
          <path d="M21 8V3h-5" />
          <path d="M3 16v5h5" />
          <path d="m3 21 6-6" />
          <path d="M3 8V3h5" />
          <path d="M9 9 3 3" />
        </svg>
      </button>
    </div>

    <DataState :result="result" :labels="labels" @retry="memberRefresh">
      <template #default="{ value }">
        <div v-if="activeViewMode === 'table'" class="sdk-metric-chart-table-overlay" data-testid="metric-chart-data-overlay">
          <div class="sdk-metric-chart-table-body">
            <TablePreview :table="tableSummary.table" :page-size="50" />
          </div>
          <footer class="sdk-metric-chart-table-footer">
            <span class="sdk-metric-chart-table-count">{{ tableFooterText }}</span>
            <div v-if="$slots['table-footer-actions']" class="sdk-metric-chart-table-actions">
              <slot
                name="table-footer-actions"
                :row-count="tableSummary.totalRows"
                :displayed-row-count="tableSummary.displayedRows"
                :truncation-hint="truncationHint"
              />
            </div>
          </footer>
        </div>
        <ChartView
          v-else
          :file="value.file"
          :metric="toChartViewMetric(value.metric)"
          height="100%"
          :hide-truncation-notice="truncationDisplay !== 'inline'"
          :undated="translate('ontology.ovUndated', 'Undated')"
          :empty="translate('ontology.ovNoChartData', 'No data')"
        />
      </template>
    </DataState>

    <div v-if="isRefreshing" class="sdk-metric-chart-refresh-veil" role="status" :aria-label="isZh ? '刷新中' : 'Refreshing'">
      <span class="sdk-metric-chart-spinner" aria-hidden="true" />
    </div>

    <Teleport to="body">
      <div
        v-if="isZoomed"
        class="sdk-metric-chart-zoom-backdrop"
        data-testid="metric-chart-zoom-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="title || (isZh ? '图表详情' : 'Chart detail')"
        tabindex="-1"
        @keydown="onModalKeydown"
        @click.self="closeZoom"
      >
        <div class="sdk-metric-chart-zoom-dialog">
          <header class="sdk-metric-chart-zoom-header">
            <div class="sdk-metric-chart-zoom-title-wrap">
              <h3 class="sdk-metric-chart-zoom-title">{{ title || (isZh ? '图表详情' : 'Chart detail') }}</h3>
              <span
                v-if="truncationHint"
                class="sdk-metric-chart-truncation-icon"
                role="note"
                :title="truncationHint"
                :aria-label="truncationHint"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
              </span>
            </div>
            <div class="sdk-metric-chart-zoom-actions">
              <button
                type="button"
                class="sdk-metric-chart-zoom-btn"
                data-testid="metric-chart-zoom-toggle-view"
                @click="toggleViewMode"
              >
                {{ activeViewMode === "chart" ? (isZh ? "数据表" : "Data table") : (isZh ? "图表" : "Chart") }}
              </button>
              <button
                type="button"
                class="sdk-metric-chart-zoom-close"
                data-testid="metric-chart-zoom-close"
                :aria-label="isZh ? '关闭' : 'Close'"
                @click="closeZoom"
              >
                ×
              </button>
            </div>
          </header>
          <div class="sdk-metric-chart-zoom-body">
            <div v-if="activeViewMode === 'table'" class="sdk-metric-chart-table-overlay">
              <div class="sdk-metric-chart-table-body">
                <TablePreview :table="tableSummary.table" :page-size="50" />
              </div>
              <footer class="sdk-metric-chart-table-footer">
                <span class="sdk-metric-chart-table-count">{{ tableFooterText }}</span>
                <div v-if="$slots['table-footer-actions']" class="sdk-metric-chart-table-actions">
                  <slot
                    name="table-footer-actions"
                    :row-count="tableSummary.totalRows"
                    :displayed-row-count="tableSummary.displayedRows"
                    :truncation-hint="truncationHint"
                  />
                </div>
              </footer>
            </div>
            <ChartView
              v-else-if="currentPayload"
              :file="currentPayload.file"
              :metric="toChartViewMetric(currentPayload.metric)"
              height="100%"
              :hide-truncation-notice="true"
              :undated="translate('ontology.ovUndated', 'Undated')"
              :empty="translate('ontology.ovNoChartData', 'No data')"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* Fills the box its member is placed in; falls back to minHeight when that box has no definite height. */
.sdk-metric-chart {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.sdk-metric-chart-toolbar {
  position: absolute;
  top: 6px;
  right: 8px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  border-radius: var(--radius-sm, 6px);
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.sdk-metric-chart:hover .sdk-metric-chart-toolbar,
.sdk-metric-chart:focus-within .sdk-metric-chart-toolbar,
.sdk-metric-chart.is-table-mode .sdk-metric-chart-toolbar {
  opacity: 1;
}

.sdk-metric-chart-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.sdk-metric-chart-tool-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.sdk-metric-chart-truncation-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-warning);
  flex: none;
  line-height: 1;
}

.sdk-metric-chart-table-overlay {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--el-bg-color);
}

.sdk-metric-chart-table-body {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: var(--spacing-xs, 8px) var(--spacing-sm, 12px) 0;
}

.sdk-metric-chart-table-footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 12px);
  padding: 6px var(--spacing-sm, 12px);
  border-top: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  background: var(--el-fill-color-blank, var(--el-bg-color));
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
}

.sdk-metric-chart-table-count {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-metric-chart-table-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs, 8px);
  flex: none;
}

.sdk-metric-chart-refresh-veil {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--el-bg-color) 55%, transparent);
  pointer-events: none;
}

.sdk-metric-chart-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--el-border-color);
  border-top-color: var(--el-color-primary);
  border-radius: 50%;
  animation: sdk-metric-chart-spin 700ms linear infinite;
}

@keyframes sdk-metric-chart-spin {
  to {
    transform: rotate(360deg);
  }
}

.sdk-metric-chart-zoom-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.45);
  box-sizing: border-box;
}

.sdk-metric-chart-zoom-dialog {
  display: flex;
  flex-direction: column;
  width: min(1100px, 92vw);
  height: min(720px, 92vh);
  border-radius: var(--radius-lg, 12px);
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow, 0 20px 50px rgba(0, 0, 0, 0.22));
  overflow: hidden;
}

.sdk-metric-chart-zoom-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ui-divider, var(--el-border-color-lighter));
}

.sdk-metric-chart-zoom-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.sdk-metric-chart-zoom-title {
  margin: 0;
  font-size: var(--text-base, 15px);
  font-weight: var(--font-semibold, 600);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-metric-chart-zoom-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.sdk-metric-chart-zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm, 6px);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: var(--text-xs, 12px);
  cursor: pointer;
}

.sdk-metric-chart-zoom-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.sdk-metric-chart-zoom-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--el-text-color-secondary);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.sdk-metric-chart-zoom-close:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.sdk-metric-chart-zoom-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 12px 16px 16px;
}
</style>
