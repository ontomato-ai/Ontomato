<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { chartValueText } from "@ontomato/contracts/chart-presentation";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import { MetricChart as ChartView } from "@ontomato/foundation-ui/chart";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelContextKey } from "../panel/context";
import { useMember, useMemberData, useMemberOutput, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import { unwrapJsonField } from "./display-value";
import type { ObjectListRef } from "./object-list-types";
import { displayFieldText, rawRecordField } from "./record-field";
import type { DashboardMetricPreviewCard } from "./dashboard-metric-preview-types";

/**
 * Dedicated personal-workspace dashboard metric & chart preview component (spec 2.1.2, W-06).
 *
 * Consumes a bound `rows` (`panelRecordList` / `panelRecordQuery`) of `platform:DashboardCard` records — or a direct
 * `cards` prop — and renders scalar metric cards in a responsive up-to-3-column numeral grid above thumbnail chart
 * previews in a responsive up-to-2-column grid (220px height), matching the original `<DashboardMetricPreview>`
 * layout. Clicking any metric or chart selects its `ObjectListRef` into the member's `selected` state parameter and
 * emits `select`.
 */

const props = withDefaults(
  defineProps<{
    /** Optional direct cards array for standalone usage outside a `rows` datum binding. */
    cards?: readonly DashboardMetricPreviewCard[];
    /** Optional filter limiting displayed cards to specific primary keys (preserving order). */
    cardIds?: readonly string[];
    /** Record field identifying `"metric"` vs `"chart"` cards (default `"cardKind"`). */
    kindField?: string;
    /** Record field holding scalar metric display value (default `"value"`). */
    valueField?: string;
    /** Record field holding optional metric unit suffix (default `"unit"`). */
    unitField?: string;
    /** Record field holding chart `.chart.json` content (default `"chartFile"`). */
    chartFileField?: string;
    /** Record field holding metric/chart query output `{ columns, rows, truncation? }` (default `"output"`). */
    outputField?: string;
    /** Record field holding per-card error text (default `"error"`). */
    errorField?: string;
    /** Record field holding truncation/partial boolean or notice (default `"partial"`). */
    partialField?: string;
    /** Maximum number of scalar metric cards rendered when `cardIds` is omitted (default `3`). */
    maxMetrics?: number;
    /** Maximum number of thumbnail chart cards rendered when `cardIds` is omitted (default `2`). */
    maxCharts?: number;
    /** Height of each chart thumbnail (default `"220px"`). */
    chartHeight?: string;
    /** Optional fallback text when no cards are available. */
    emptyText?: string;
  }>(),
  {
    cards: undefined,
    cardIds: undefined,
    kindField: "cardKind",
    valueField: "value",
    unitField: "unit",
    chartFileField: "chartFile",
    outputField: "output",
    errorField: "error",
    partialField: "partial",
    maxMetrics: 3,
    maxCharts: 2,
    chartHeight: "220px",
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader clicks a metric or chart card title. */
  select: [card: { id: string; name: string; ref?: ObjectListRef; row?: PlatformObjectRecord }];
}>();

const panel = inject(panelContextKey, null);
const member = (() => {
  try {
    return useMember();
  } catch {
    return null;
  }
})();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();
const locale = computed(() => i18n?.locale.value ?? "en");
const isZh = computed(() => locale.value.toLowerCase().startsWith("zh"));
function translate(key: string): string {
  return i18n && i18n.te(key) ? i18n.t(key) : key;
}

const rowsState = (() => {
  if (!member?.projection.data?.rows) return null;
  try {
    return useMemberData("rows");
  } catch {
    return null;
  }
})();

const selectedParam = (() => {
  try {
    return useMemberParam("selected");
  } catch {
    return null;
  }
})();

const selectedKey = computed<string | null>(() => {
  if (!selectedParam) return null;
  const obj = stateObject(selectedParam.value.value as PanelFieldValue);
  return obj ? `${obj.className}:${obj.primaryKey}` : null;
});

function extractOutput(raw: unknown): DashboardMetricOutput | null {
  const unwrapped = unwrapJsonField(raw);
  if (!unwrapped || typeof unwrapped !== "object") return null;
  const candidate = unwrapped as Record<string, unknown>;
  if (Array.isArray(candidate.columns) && Array.isArray(candidate.rows)) {
    return candidate as unknown as DashboardMetricOutput;
  }
  return null;
}

function extractChartFile(raw: unknown): unknown {
  const unwrapped = unwrapJsonField(raw);
  if (!unwrapped || typeof unwrapped !== "object") return undefined;
  const candidate = unwrapped as Record<string, unknown>;
  if ("content" in candidate && candidate.content && typeof candidate.content === "object") {
    return candidate.content;
  }
  return unwrapped;
}

function parseRecordCard(row: PlatformObjectRecord): DashboardMetricPreviewCard {
  const rawKind = String(rawRecordField(row, props.kindField) ?? rawRecordField(row, "kind") ?? "").toLowerCase();
  const file = extractChartFile(rawRecordField(row, props.chartFileField));
  const kind: "metric" | "chart" = rawKind === "chart" || (!rawKind && file !== undefined) ? "chart" : "metric";
  const output = extractOutput(rawRecordField(row, props.outputField));
  const rawVal = rawRecordField(row, props.valueField);
  let value: string | number | null = null;
  if (rawVal !== undefined && rawVal !== null && rawVal !== "") {
    value = typeof rawVal === "number" || typeof rawVal === "string"
      ? rawVal
      : displayFieldText(rawVal as never, locale.value, translate);
  } else if (kind === "metric" && output && output.rows.length > 0) {
    const mappedField = rawRecordField(row, "valueField");
    const colKey = typeof mappedField === "string" && mappedField ? mappedField : output.columns[0]?.key;
    if (colKey) {
      const rawFormats = unwrapJsonField(rawRecordField(row, "formats"));
      const formats = rawFormats && typeof rawFormats === "object"
        ? (rawFormats as Readonly<Record<string, Parameters<typeof chartValueText>[1]>>)
        : undefined;
      value = chartValueText(output.rows[0]?.[colKey], formats?.[colKey]);
    }
  }
  const unitRaw = rawRecordField(row, props.unitField);
  const unit = typeof unitRaw === "string" ? unitRaw : "";
  const errRaw = rawRecordField(row, props.errorField);
  const error = typeof errRaw === "string" ? errRaw : "";
  const partialRaw = rawRecordField(row, props.partialField);
  const partial = Boolean(partialRaw) || Boolean(output?.truncation);
  const ref: ObjectListRef = {
    className: row.className || "platform:DashboardCard",
    primaryKey: row.primaryKey,
  };
  return {
    id: row.primaryKey,
    name: row.label || row.primaryKey,
    kind,
    value,
    unit,
    file,
    output,
    error,
    partial,
    ref,
    row,
  };
}

const resolvedData = computed<DataStateResult<readonly DashboardMetricPreviewCard[]>>(() => {
  if (props.cards) {
    return props.cards.length > 0 ? { status: "ready", value: props.cards } : { status: "empty" };
  }
  if (!rowsState) return { status: "empty" };
  const state = rowsState.value;
  if (state.status !== "ready") return state as DataStateResult<readonly DashboardMetricPreviewCard[]>;
  const raw = state.value as unknown as readonly PlatformObjectRecord[] | { rows?: readonly PlatformObjectRecord[] } | null;
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows) ? (raw as { rows: readonly PlatformObjectRecord[] }).rows : []);
  const parsed = rows.map(parseRecordCard);
  return parsed.length > 0 ? { status: "ready", value: parsed } : { status: "empty" };
});

const partitioned = computed(() => {
  const all = resolvedData.value.status === "ready" ? resolvedData.value.value : [];
  const allMetrics = all.filter((card) => card.kind === "metric");
  const allCharts = all.filter((card) => card.kind === "chart");

  const selectCards = (items: readonly DashboardMetricPreviewCard[], limit: number) => {
    if (props.cardIds === undefined) return items.slice(0, Math.max(0, limit));
    return props.cardIds.flatMap((id) => items.filter((item) => item.id === id));
  };

  const metrics = selectCards(allMetrics, props.maxMetrics);
  const charts = selectCards(allCharts, props.maxCharts);
  const missingCount = props.cardIds
    ? props.cardIds.filter((id) => !all.some((card) => card.id === id)).length
    : 0;

  return { metrics, charts, missingCount };
});

useMemberOutput("status", () => resolvedData.value.status);
useMemberOutput("metricCount", () => partitioned.value.metrics.length);
useMemberOutput("chartCount", () => partitioned.value.charts.length);

const labels = useDataStateLabels(() => props.emptyText || (isZh.value ? "打开仪表盘查看图表与明细" : "Open dashboard for charts and details"));

function isCardSelected(card: DashboardMetricPreviewCard): boolean {
  if (!card.ref || !selectedKey.value) return false;
  return `${card.ref.className}:${card.ref.primaryKey}` === selectedKey.value;
}

function toChartViewMetric(metric: DashboardMetricOutput) {
  return {
    columns: metric.columns,
    rows: metric.rows,
    ...(metric.truncation ? { truncation: metric.truncation } : {}),
  };
}

function handleSelect(card: DashboardMetricPreviewCard) {
  if (card.ref && selectedParam) {
    selectedParam.set({ className: card.ref.className, primaryKey: card.ref.primaryKey });
  }
  if (card.ref && panel && member && panel.manifest.members[member.key]?.outputs?.select) {
    void panel.instance.output(member.key, "select", {
      className: card.ref.className,
      primaryKey: card.ref.primaryKey,
    });
  }
  emit("select", { id: card.id, name: card.name, ref: card.ref, row: card.row });
}
</script>

<template>
  <div class="sdk-dashboard-metric-preview">
    <DataState :result="resolvedData" :labels="labels">
      <div class="sdk-dmp-content">
        <div v-if="partitioned.metrics.length" class="sdk-dmp-values">
          <div
            v-for="metric in partitioned.metrics"
            :key="metric.id"
            class="sdk-dmp-value-card"
            :class="{ 'is-selected': isCardSelected(metric) }"
          >
            <button type="button" class="sdk-dmp-metric-open" @click="handleSelect(metric)">
              {{ metric.name }}
            </button>
            <span v-if="metric.error" class="sdk-dmp-error" role="alert">{{ metric.error }}</span>
            <template v-else>
              <strong class="sdk-dmp-numeral">
                {{ metric.value !== null && metric.value !== undefined && metric.value !== "" ? metric.value : (isZh ? "暂无数据" : "No data") }}
                <small v-if="metric.unit" class="sdk-dmp-unit">{{ metric.unit }}</small>
              </strong>
              <small v-if="metric.partial" class="sdk-dmp-partial">
                {{ isZh ? "结果已截断，请查看仪表盘" : "Partial result; open dashboard" }}
              </small>
            </template>
          </div>
        </div>

        <p v-if="partitioned.missingCount > 0" class="sdk-dmp-note" role="note">
          {{
            isZh
              ? `${partitioned.missingCount} 项关注内容已删除或不可访问，请重新选择`
              : `${partitioned.missingCount} followed cards are unavailable. Update your selection.`
          }}
        </p>

        <div v-if="partitioned.charts.length" class="sdk-dmp-charts">
          <section
            v-for="chart in partitioned.charts"
            :key="chart.id"
            class="sdk-dmp-chart-card"
            :class="{ 'is-selected': isCardSelected(chart) }"
          >
            <button type="button" class="sdk-dmp-chart-open" @click="handleSelect(chart)">
              {{ chart.name }}
            </button>
            <p v-if="chart.error" class="sdk-dmp-error" role="alert">{{ chart.error }}</p>
            <ChartView
              v-else-if="chart.output && chart.file"
              :file="chart.file"
              :metric="toChartViewMetric(chart.output)"
              :height="chartHeight"
              :hide-truncation-notice="true"
              :empty="isZh ? '暂无数据' : 'No data'"
            />
            <p v-else class="sdk-dmp-empty">{{ isZh ? "暂无数据" : "No data" }}</p>
            <small v-if="chart.partial" class="sdk-dmp-partial">
              {{ isZh ? "结果已截断，请查看完整仪表盘" : "Partial result; open full dashboard" }}
            </small>
          </section>
        </div>

        <p v-if="!partitioned.metrics.length && !partitioned.charts.length" class="sdk-dmp-empty">
          {{ emptyText || (isZh ? "打开仪表盘查看图表与明细" : "Open dashboard for charts and details") }}
        </p>
      </div>
    </DataState>
  </div>
</template>

<style scoped>
.sdk-dashboard-metric-preview {
  container: sdk-dashboard-metric-preview / inline-size;
  width: 100%;
  min-width: 0;
}

.sdk-dmp-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sdk-dmp-values {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--spacing-lg, 16px);
}

.sdk-dmp-value-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs, 4px);
  min-width: 0;
  padding-block: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
}

.sdk-dmp-metric-open {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm, 13px);
  line-height: 20px;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.sdk-dmp-metric-open:hover,
.sdk-dmp-chart-open:hover {
  color: var(--el-color-primary);
}

.sdk-dmp-metric-open:focus-visible,
.sdk-dmp-chart-open:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.sdk-dmp-numeral {
  font-size: var(--text-2xl, 24px);
  line-height: 1.25;
  font-weight: var(--font-semibold, 600);
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}

.sdk-dmp-unit {
  font-size: var(--text-sm, 13px);
  font-weight: normal;
  color: var(--el-text-color-secondary);
  margin-inline-start: 4px;
}

.sdk-dmp-partial,
.sdk-dmp-note,
.sdk-dmp-empty {
  margin: var(--spacing-xs, 4px) 0 0;
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}

.sdk-dmp-error {
  margin: var(--spacing-xs, 4px) 0 0;
  font-size: var(--text-xs, 12px);
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}

.sdk-dmp-charts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-lg, 16px);
  margin-top: var(--spacing-md, 12px);
}

.sdk-dmp-chart-card {
  padding-top: var(--spacing-md, 12px);
  border-top: 1px solid var(--el-border-color-lighter);
  min-width: 0;
}

.sdk-dmp-chart-open {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  border: 0;
  background: transparent;
  padding: var(--spacing-xs, 4px) 0;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-medium, 500);
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}

@container sdk-dashboard-metric-preview (max-width: 620px) {
  .sdk-dmp-charts {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container sdk-dashboard-metric-preview (max-width: 420px) {
  .sdk-dmp-values {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container sdk-dashboard-metric-preview (max-width: 240px) {
  .sdk-dmp-values {
    grid-template-columns: 1fr;
  }
}
</style>
