<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PanelFieldTone, PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyObjectsResponse } from "@ontomato/contracts/platform-ontology";
import { panelContextKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import {
  asTone,
  extractMetricCell,
  formatTypedNumber,
  sumRecordField,
  unwrapJsonField,
  useOptionalMemberDatum,
  useProjectionConfig,
  type DisplayDataStateKind,
  type TypedNumberFormat,
} from "./display-value";
import { readConfigString, readConfigStringMap, resolveLocalizedText } from "./localized-text";
import type { MetricCardItem } from "./metric-card-types";
import { displayFieldText, rawRecordField } from "./record-field";

/**
 * Displays one or more statistical metric cards (label + tabular numeral + optional unit, supporting description, and
 * semantic tone) for ontology headers, dashboards, and catalog summaries. Directly consumes a MetricView's `result`
 * (`metricOutput`) table — extracting a scalar or named column from the first (or `rowIndex`) row — as well as a single
 * `record` (`panelRecord`), `rows` (`panelRecordList` / `panelRecordQuery`), `objects` (`panelOntologyObjects`), or
 * standalone `value`/`items` props. Pure presentation: business aggregations belong in a MetricView or owner read.
 */
const props = withDefaults(
  defineProps<{
    /** Fallback metric title in single-card mode; omitted on a metric `result` falls back to the column's label or key. */
    label?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the title in single-card mode. */
    labelKey?: string;
    /** Locale-keyed titles (for example `{ en: "Object types", "zh-CN": "对象类型" }`) in single-card mode. */
    labels?: Readonly<Record<string, string>>;
    /** Direct metric value in standalone mode (used when no datum is bound or when explicitly provided). */
    value?: string | number | null;
    /** Column key on a bound metric `result` (defaults to the first column) or field key on a bound `record`. */
    field?: string;
    /** Optional field key to sum across `rows` or `objects` instead of counting records. */
    sumField?: string;
    /** Zero-based row index when reading from a bound metric `result` (`metricOutput`) table. Defaults to `0`. */
    rowIndex?: number;
    /** Fallback unit suffix shown beside the numeral (for example `"%"`, `"ms"`). */
    unit?: string;
    /** Panel or platform i18n key for the unit suffix. */
    unitKey?: string;
    /** Locale-keyed unit suffixes. */
    units?: Readonly<Record<string, string>>;
    /** Optional fallback supporting description shown below the value. */
    description?: string;
    /** Panel or platform i18n key for the supporting description. */
    descriptionKey?: string;
    /** Locale-keyed supporting descriptions. */
    descriptions?: Readonly<Record<string, string>>;
    /** Semantic tone for the card value/accent (`"default" | "info" | "success" | "warning" | "danger"`). */
    tone?: PanelFieldTone;
    /** Optional `Intl.NumberFormat` options for numeric values. */
    numberFormat?: TypedNumberFormat;
    /** Multiple KPI entries evaluated from one datum read (or standalone values) without duplicating backend requests. */
    items?: readonly MetricCardItem[];
    /** Visual presentation: `"card"` (bordered KPI cards), `"compact"` (dense tiles), or `"inline"` (horizontal strip). */
    variant?: "card" | "compact" | "inline";
    /** Optional maximum number of grid columns in multi-item `"card"` / `"compact"` mode; collapses on narrow containers. */
    columns?: number;
    /** Fallback text shown when a metric `result` has no rows or a bound field is absent. Defaults to `"—"`. */
    emptyText?: string;
  }>(),
  {
    label: undefined,
    labelKey: undefined,
    labels: undefined,
    value: undefined,
    field: undefined,
    sumField: undefined,
    rowIndex: 0,
    unit: undefined,
    unitKey: undefined,
    units: undefined,
    description: undefined,
    descriptionKey: undefined,
    descriptions: undefined,
    tone: undefined,
    numberFormat: undefined,
    items: undefined,
    variant: "card",
    columns: undefined,
    emptyText: "—",
  },
);

defineSlots<{
  /** Optional leading icon rendered in single-card mode beside the label. */
  icon?(): unknown;
  /** Optional footer content rendered at the bottom of a single card. */
  footer?(): unknown;
}>();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();
const locale = computed(() => i18n?.locale.value ?? "en");
const translate = (key: string) => (i18n ? i18n.t(key) : key);
const hasTranslation = (key: string) => (i18n ? i18n.te(key) : false);

const panel = inject(panelContextKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter?.() ?? null;
const rawConfig = useProjectionConfig(member);
const boundDatum = useOptionalMemberDatum(member, ["result", "record", "rows", "objects"] as const);

function normalizeItem(raw: unknown): MetricCardItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  return {
    label: readConfigString(rec, "label"),
    labelKey: readConfigString(rec, "labelKey", "label-key"),
    labels: readConfigStringMap(rec, "labels"),
    value: typeof rec.value === "string" || typeof rec.value === "number" || rec.value === null ? rec.value : undefined,
    field: readConfigString(rec, "field"),
    sumField: readConfigString(rec, "sumField", "sum-field"),
    rowIndex: typeof rec.rowIndex === "number" ? rec.rowIndex : undefined,
    unit: readConfigString(rec, "unit"),
    unitKey: readConfigString(rec, "unitKey", "unit-key"),
    units: readConfigStringMap(rec, "units"),
    description: readConfigString(rec, "description"),
    descriptionKey: readConfigString(rec, "descriptionKey", "description-key"),
    descriptions: readConfigStringMap(rec, "descriptions"),
    tone: asTone(rec.tone),
    numberFormat: rec.numberFormat && typeof rec.numberFormat === "object" && !Array.isArray(rec.numberFormat)
      ? (rec.numberFormat as TypedNumberFormat)
      : undefined,
  };
}

const configuredItems = computed<readonly MetricCardItem[]>(() => {
  const rawItems = props.items ?? (Array.isArray(rawConfig.value?.items) ? rawConfig.value.items : undefined);
  if (rawItems && rawItems.length > 0) {
    const normalized = rawItems.map(normalizeItem).filter((item): item is MetricCardItem => item !== null);
    if (normalized.length > 0) return normalized;
  }
  return [
    {
      label: props.label ?? readConfigString(rawConfig.value, "label"),
      labelKey: props.labelKey ?? readConfigString(rawConfig.value, "labelKey", "label-key"),
      labels: props.labels ?? readConfigStringMap(rawConfig.value, "labels"),
      value: props.value,
      field: props.field ?? readConfigString(rawConfig.value, "field"),
      sumField: props.sumField ?? readConfigString(rawConfig.value, "sumField", "sum-field"),
      rowIndex: props.rowIndex,
      unit: props.unit ?? readConfigString(rawConfig.value, "unit"),
      unitKey: props.unitKey ?? readConfigString(rawConfig.value, "unitKey", "unit-key"),
      units: props.units ?? readConfigStringMap(rawConfig.value, "units"),
      description: props.description ?? readConfigString(rawConfig.value, "description"),
      descriptionKey: props.descriptionKey ?? readConfigString(rawConfig.value, "descriptionKey", "description-key"),
      descriptions: props.descriptions ?? readConfigStringMap(rawConfig.value, "descriptions"),
      tone: props.tone ?? asTone(rawConfig.value?.tone),
      numberFormat: props.numberFormat,
    },
  ];
});

interface ParsedSource {
  readonly state: DisplayDataStateKind;
  readonly metricOutput?: DashboardMetricOutput;
  readonly record?: PlatformObjectRecord;
  readonly rows?: readonly PlatformObjectRecord[];
  readonly total?: number;
  readonly hasTotal?: boolean;
  readonly truncationHint?: string;
  readonly notice?: string;
}

const parsedSource = computed<ParsedSource>(() => {
  if (!boundDatum) return { state: "standalone" };
  const current = boundDatum.state.value;
  if (current.status === "loading") return { state: "loading" };
  if (current.status === "empty") return { state: "empty" };
  if (current.status === "forbidden") return { state: "forbidden", notice: translate("platform.dataForbidden") };
  if (current.status === "awaiting") return { state: "awaiting", notice: translate("platform.dataAwaiting") };
  if (current.status === "error") {
    return { state: "error", notice: current.message || translate("platform.dataUnreachable") };
  }

  const value = current.value;
  if (boundDatum.name === "result") {
    const output = value as unknown as DashboardMetricOutput;
    const rowCount = Array.isArray(output?.rows) ? output.rows.length : 0;
    return {
      state: rowCount > 0 ? "ready" : "empty",
      metricOutput: output,
      ...(output?.truncation?.truncationHint ? { truncationHint: output.truncation.truncationHint } : {}),
    };
  }
  if (boundDatum.name === "record") {
    return { state: "ready", record: value as unknown as PlatformObjectRecord };
  }
  if (boundDatum.name === "objects") {
    const response = value as unknown as PlatformOntologyObjectsResponse;
    if (response.status === "refused") {
      return { state: "forbidden", notice: response.reason || translate("platform.graphStatusRefused") };
    }
    if (response.status !== "ok") {
      return {
        state: "error",
        notice: response.reason || (response.status === "unavailable"
          ? translate("platform.graphStatusUnavailable")
          : translate("platform.dataUnreachable")),
      };
    }
    const rows: PlatformObjectRecord[] = response.items.map((item) => {
      const fields: PlatformObjectRecord["fields"] = item.detail !== undefined ? { detail: item.detail } : {};
      return {
        primaryKey: item.node.primaryKey,
        className: item.node.className,
        label: item.label,
        ...(item.detail !== undefined ? { subtitle: item.detail } : {}),
        fields,
      };
    });
    return { state: "ready", rows, total: response.total, hasTotal: true };
  }
  if (Array.isArray(value)) {
    const rows = value as unknown as readonly PlatformObjectRecord[];
    return { state: "ready", rows, total: rows.length, hasTotal: false };
  }
  const query = value as unknown as PanelRecordQuery;
  const rows = Array.isArray(query?.rows) ? (query.rows as unknown as readonly PlatformObjectRecord[]) : [];
  const hasTotal = typeof query?.total === "number" && Number.isFinite(query.total);
  return { state: "ready", rows, total: hasTotal ? query.total! : rows.length, hasTotal };
});

function formatMetricDisplay(raw: unknown, format?: TypedNumberFormat): string {
  if (raw === undefined || raw === null || raw === "") return props.emptyText;
  const unwrapped = unwrapJsonField(raw);
  if (typeof unwrapped === "number") return formatTypedNumber(unwrapped, locale.value, format);
  if (typeof unwrapped === "string") {
    if (format && unwrapped.trim() !== "" && Number.isFinite(Number(unwrapped))) {
      return formatTypedNumber(unwrapped, locale.value, format);
    }
    return unwrapped;
  }
  return displayFieldText(raw as never, locale.value, translate) || props.emptyText;
}

interface RenderedMetricItem {
  readonly label: string;
  readonly display: string;
  readonly unit: string;
  readonly description: string;
  readonly tone: PanelFieldTone;
}

const renderedItems = computed<readonly RenderedMetricItem[]>(() => {
  const src = parsedSource.value;
  return configuredItems.value.map((item) => {
    const explicitLabel = resolveLocalizedText({
      key: item.labelKey,
      map: item.labels,
      fallback: item.label,
      locale: locale.value,
      panelText: panel?.t,
      t: translate,
      te: hasTranslation,
    });
    const unit = resolveLocalizedText({
      key: item.unitKey,
      map: item.units,
      fallback: item.unit,
      locale: locale.value,
      panelText: panel?.t,
      t: translate,
      te: hasTranslation,
    });
    const description = resolveLocalizedText({
      key: item.descriptionKey,
      map: item.descriptions,
      fallback: item.description,
      locale: locale.value,
      panelText: panel?.t,
      t: translate,
      te: hasTranslation,
    });

    let label = explicitLabel;
    let display: string;
    let tone: PanelFieldTone = item.tone ?? "default";

    if (src.state === "standalone" || item.value !== undefined) {
      display = formatMetricDisplay(item.value, item.numberFormat);
    } else if (src.state === "loading") {
      display = "…";
    } else if (src.state === "forbidden" || src.state === "error" || src.state === "awaiting") {
      display = "—";
    } else if (src.state === "empty") {
      if (boundDatum?.name === "rows" || boundDatum?.name === "objects") {
        display = formatTypedNumber(0, locale.value, item.numberFormat);
      } else {
        if (!label && src.metricOutput) {
          const cell = extractMetricCell(src.metricOutput, item.field, item.rowIndex ?? 0);
          label = cell.column?.label || cell.column?.key || "";
        }
        display = props.emptyText;
      }
    } else if (boundDatum?.name === "result" && src.metricOutput) {
      const cell = extractMetricCell(src.metricOutput, item.field, item.rowIndex ?? 0);
      if (!label) label = cell.column?.label || cell.column?.key || "";
      display = formatMetricDisplay(cell.value, item.numberFormat);
    } else if (boundDatum?.name === "record" && src.record) {
      const key = item.field ?? "label";
      const raw = rawRecordField(src.record, key);
      if (!label) label = src.record.fieldLabels?.[key] ?? "";
      if (!item.tone && src.record.tones?.[key]) tone = asTone(src.record.tones[key]) ?? "default";
      display = formatMetricDisplay(raw, item.numberFormat);
    } else {
      const rows = src.rows ?? [];
      const numeric = item.sumField
        ? sumRecordField(rows, item.sumField)
        : (src.hasTotal ? (src.total ?? rows.length) : rows.length);
      display = formatTypedNumber(numeric, locale.value, item.numberFormat);
    }

    return { label, display, unit, description, tone };
  });
});

const isSingle = computed(() => renderedItems.value.length === 1);

const gridStyle = computed(() => {
  if (props.variant === "inline" || isSingle.value) return undefined;
  if (typeof props.columns === "number" && props.columns > 0) {
    return { "--sdk-metric-columns": String(Math.floor(props.columns)) };
  }
  return undefined;
});

const accessibleSummary = computed<string | undefined>(() => {
  const parts = renderedItems.value.map((item) => {
    const val = item.unit ? `${item.display} ${item.unit}` : item.display;
    return item.label ? `${item.label}: ${val}` : val;
  });
  const text = parts.join(", ");
  if (parsedSource.value.notice) return text ? `${text} (${parsedSource.value.notice})` : parsedSource.value.notice;
  return text || undefined;
});
</script>

<template>
  <div
    class="sdk-metric-card-group"
    :class="[`is-${variant}`, { 'is-single': isSingle, 'has-fixed-cols': Boolean(columns && !isSingle && variant !== 'inline') }]"
    :style="gridStyle"
    :data-state="parsedSource.state"
    :title="parsedSource.notice"
    :aria-busy="parsedSource.state === 'loading' ? 'true' : undefined"
    :aria-label="accessibleSummary"
  >
    <article
      v-for="(item, index) in renderedItems"
      :key="index"
      class="sdk-metric-card"
      :data-tone="item.tone"
    >
      <div v-if="item.label || (isSingle && $slots.icon) || (index === 0 && parsedSource.truncationHint)" class="sdk-metric-card-head">
        <span v-if="isSingle && $slots.icon" class="sdk-metric-card-icon"><slot name="icon" /></span>
        <span v-if="item.label" class="sdk-metric-card-label">{{ item.label }}</span>
        <span
          v-if="index === 0 && parsedSource.truncationHint"
          class="sdk-metric-card-truncation"
          role="note"
          :title="parsedSource.truncationHint"
          :aria-label="parsedSource.truncationHint"
        >!</span>
      </div>
      <div class="sdk-metric-card-value-row">
        <strong class="sdk-metric-card-value">{{ item.display }}</strong>
        <span v-if="item.unit" class="sdk-metric-card-unit">{{ item.unit }}</span>
      </div>
      <p v-if="item.description" class="sdk-metric-card-description">{{ item.description }}</p>
      <div v-if="isSingle && $slots.footer" class="sdk-metric-card-footer">
        <slot name="footer" />
      </div>
    </article>
  </div>
</template>

<style scoped>
.sdk-metric-card-group {
  container: sdk-metric-card-group / inline-size;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--spacing-md);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.sdk-metric-card-group.is-single {
  grid-template-columns: minmax(0, 1fr);
}

.sdk-metric-card-group.has-fixed-cols {
  grid-template-columns: repeat(var(--sdk-metric-columns, 2), minmax(0, 1fr));
}

.sdk-metric-card-group.is-inline {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--spacing-sm);
  width: auto;
}

.sdk-metric-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
  padding: var(--spacing-lg);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  box-sizing: border-box;
}

.sdk-metric-card-group.is-compact .sdk-metric-card {
  padding: var(--spacing-md);
}

.sdk-metric-card-group.is-inline .sdk-metric-card {
  flex-direction: row;
  align-items: baseline;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--radius-sm);
}

.sdk-metric-card-head {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-metric-card-icon {
  display: inline-flex;
  flex: none;
  color: var(--el-text-color-secondary);
}

.sdk-metric-card-label {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: var(--leading-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-metric-card-truncation {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-inline-start: auto;
  border-radius: var(--radius-full);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  line-height: 1;
}

.sdk-metric-card-value-row {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-metric-card-value {
  color: var(--el-text-color-primary);
  font-size: var(--text-title-lg);
  font-weight: var(--font-semibold);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-title-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-metric-card-group.is-compact .sdk-metric-card-value {
  font-size: var(--text-xl);
  line-height: var(--leading-xl);
}

.sdk-metric-card-group.is-inline .sdk-metric-card-value {
  font-size: var(--text-base);
  line-height: var(--leading-base);
}

.sdk-metric-card[data-tone="info"] .sdk-metric-card-value {
  color: var(--brand-link, var(--el-color-primary));
}

.sdk-metric-card[data-tone="success"] .sdk-metric-card-value {
  color: var(--el-color-success-text, var(--el-color-success));
}

.sdk-metric-card[data-tone="warning"] .sdk-metric-card-value {
  color: var(--el-color-warning-text, var(--el-color-warning));
}

.sdk-metric-card[data-tone="danger"] .sdk-metric-card-value {
  color: var(--el-color-danger-text, var(--el-color-danger));
}

.sdk-metric-card-group[data-state="forbidden"] .sdk-metric-card-value,
.sdk-metric-card-group[data-state="error"] .sdk-metric-card-value,
.sdk-metric-card-group[data-state="awaiting"] .sdk-metric-card-value {
  color: var(--el-text-color-secondary);
  font-weight: var(--font-medium);
}

.sdk-metric-card-unit {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  white-space: nowrap;
}

.sdk-metric-card-description {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  overflow-wrap: anywhere;
}

.sdk-metric-card-footer {
  margin-top: var(--spacing-xs);
  padding-top: var(--spacing-xs);
  border-top: 1px solid var(--ui-divider);
}

@container sdk-metric-card-group (max-width: 480px) {
  .sdk-metric-card-group.has-fixed-cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
