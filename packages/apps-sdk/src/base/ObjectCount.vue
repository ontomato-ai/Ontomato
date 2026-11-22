<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyObjectsResponse } from "@ontomato/contracts/platform-ontology";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { readConfigString, readConfigStringMap, resolveLocalizedText } from "./localized-text";
import type { ObjectCountItem } from "./object-count-types";

type CountViewKind = "loading" | "empty" | "ready" | "forbidden" | "error" | "awaiting";

interface ParsedCountData {
  readonly kind: CountViewKind;
  readonly rows: readonly PlatformObjectRecord[];
  readonly total: number;
  readonly hasTotal: boolean;
  readonly notice?: string;
}

interface NormalizedCountItem {
  readonly label?: string;
  readonly labelKey?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly sumField?: string;
}

/**
 * Compact inline metric strip counting records (or summing a numeric/array field across records) from the member's
 * `rows` (`panelRecordList` / `panelRecordQuery`) or `objects` (`panelOntologyObjects`) datum. Supports either a
 * single metric (`label` / `labelKey` / `labels` + optional `sumField`) or multiple metrics from the same read via
 * `items` (for example counting object types and summing their attributes in one request).
 */
const props = withDefaults(
  defineProps<{
    /** Fallback unit label shown beside the count in single-metric mode. */
    label?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the unit label in single-metric mode. */
    labelKey?: string;
    /** Locale-keyed unit labels (e.g. `{ en: "Object types", de: "Objekttypen" }`) in single-metric mode. */
    labels?: Readonly<Record<string, string>>;
    /**
     * Optional field key on each record to sum instead of counting rows in single-metric mode. Supports finite
     * numbers, numeric strings, arrays (counted by length), and `{ kind: "json", value: [...] }` field wrappers.
     */
    sumField?: string;
    /**
     * Multiple metric definitions evaluated against the same datum read, rendered inline separated by a middot
     * (e.g. `18 Object types · 193 Properties`) to avoid duplicate reads of the same collection.
     */
    items?: readonly ObjectCountItem[];
  }>(),
  {
    label: undefined,
    labelKey: undefined,
    labels: undefined,
    sumField: undefined,
    items: undefined,
  },
);

const { t, te, locale } = useI18n();
const panel = usePanelContext();
const member = useMember();

const datumName: "rows" | "objects" = "rows" in member.projection.data
  ? "rows"
  : "objects" in member.projection.data
    ? "objects"
    : (() => {
        throw new Error(`Projection ${member.projection.id} declares neither 'rows' nor 'objects' datum`);
      })();

const datumState = useMemberData(datumName);

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});

function normalizeItem(raw: unknown): NormalizedCountItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    label: readConfigString(record, "label"),
    labelKey: readConfigString(record, "labelKey", "label-key"),
    labels: readConfigStringMap(record, "labels"),
    sumField: readConfigString(record, "sumField", "sum-field"),
  };
}

const configuredItems = computed<readonly NormalizedCountItem[]>(() => {
  const rawItems = props.items ?? (Array.isArray(rawConfig.value?.items) ? rawConfig.value.items : undefined);
  if (rawItems && rawItems.length > 0) {
    const normalized = rawItems.map(normalizeItem).filter((item): item is NormalizedCountItem => item !== null);
    if (normalized.length > 0) return normalized;
  }
  return [
    {
      label: props.label ?? readConfigString(rawConfig.value, "label"),
      labelKey: props.labelKey ?? readConfigString(rawConfig.value, "labelKey", "label-key"),
      labels: props.labels ?? readConfigStringMap(rawConfig.value, "labels"),
      sumField: props.sumField ?? readConfigString(rawConfig.value, "sumField", "sum-field"),
    },
  ];
});

function numericContribution(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === "object" && "kind" in raw && (raw as { kind?: unknown }).kind === "json") {
    const inner = (raw as { value?: unknown }).value;
    if (Array.isArray(inner)) return inner.length;
    if (typeof inner === "number") return Number.isFinite(inner) ? inner : 0;
    if (typeof inner === "string") {
      const trimmed = inner.trim();
      if (!trimmed) return 0;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  return 0;
}

function sumFieldAcrossRows(rows: readonly PlatformObjectRecord[], fieldKey: string): number {
  let total = 0;
  for (const row of rows) {
    total += numericContribution(row?.fields?.[fieldKey]);
  }
  return total;
}

const parsedData = computed<ParsedCountData>(() => {
  const state = datumState.value;
  if (state.status === "loading") return { kind: "loading", rows: [], total: 0, hasTotal: false };
  if (state.status === "empty") return { kind: "empty", rows: [], total: 0, hasTotal: true };
  if (state.status === "forbidden") {
    return { kind: "forbidden", rows: [], total: 0, hasTotal: false, notice: t("platform.dataForbidden") };
  }
  if (state.status === "awaiting") {
    return { kind: "awaiting", rows: [], total: 0, hasTotal: false, notice: t("platform.dataAwaiting") };
  }
  if (state.status === "error") {
    return {
      kind: "error",
      rows: [],
      total: 0,
      hasTotal: false,
      notice: state.message || t("platform.dataUnreachable"),
    };
  }

  const value = state.value;
  if (datumName === "objects") {
    const response = value as unknown as PlatformOntologyObjectsResponse;
    if (response.status === "refused") {
      return {
        kind: "forbidden",
        rows: [],
        total: 0,
        hasTotal: false,
        notice: response.reason || t("platform.graphStatusRefused"),
      };
    }
    if (response.status !== "ok") {
      return {
        kind: "error",
        rows: [],
        total: 0,
        hasTotal: false,
        notice: response.reason || (response.status === "unavailable" ? t("platform.graphStatusUnavailable") : t("platform.dataUnreachable")),
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
    return { kind: "ready", rows, total: response.total, hasTotal: true };
  }

  if (Array.isArray(value)) {
    const rows = value as unknown as readonly PlatformObjectRecord[];
    return { kind: "ready", rows, total: rows.length, hasTotal: false };
  }
  const query = value as unknown as PanelRecordQuery;
  const rows = Array.isArray(query?.rows) ? (query.rows as unknown as readonly PlatformObjectRecord[]) : [];
  const hasTotal = typeof query?.total === "number" && Number.isFinite(query.total);
  return { kind: "ready", rows, total: hasTotal ? query.total! : rows.length, hasTotal };
});

const renderedItems = computed(() => {
  const data = parsedData.value;
  return configuredItems.value.map((item) => {
    const label = resolveLocalizedText({
      key: item.labelKey,
      map: item.labels,
      fallback: item.label,
      locale: locale.value,
      panelText: panel.t,
      t,
      te,
    });
    let display: string;
    if (data.kind === "loading") display = "…";
    else if (data.kind === "empty") display = "0";
    else if (data.kind !== "ready") display = "—";
    else if (item.sumField) display = String(sumFieldAcrossRows(data.rows, item.sumField));
    else display = String(data.hasTotal ? data.total : data.rows.length);
    return { label, display };
  });
});

const accessibleLabel = computed<string | undefined>(() => {
  const summary = renderedItems.value
    .map((item) => (item.label ? `${item.display} ${item.label}` : item.display))
    .join(", ");
  if (parsedData.value.notice) {
    return summary ? `${summary} (${parsedData.value.notice})` : parsedData.value.notice;
  }
  return summary || undefined;
});
</script>

<template>
  <span
    class="sdk-object-count"
    :data-state="parsedData.kind"
    :title="parsedData.notice"
    :aria-busy="parsedData.kind === 'loading' ? 'true' : undefined"
    :aria-label="accessibleLabel"
  >
    <template v-for="(item, index) in renderedItems" :key="index">
      <span v-if="index > 0" class="sdk-object-count-sep" aria-hidden="true">·</span>
      <span class="sdk-object-count-item">
        <strong class="sdk-object-count-value">{{ item.display }}</strong>
        <span v-if="item.label" class="sdk-object-count-label">{{ item.label }}</span>
      </span>
    </template>
  </span>
</template>

<style scoped>
.sdk-object-count {
  align-items: baseline;
  align-self: flex-start;
  color: var(--el-text-color-secondary);
  display: inline-flex;
  flex-wrap: nowrap;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  gap: var(--spacing-sm);
  line-height: var(--leading-sm);
  min-width: 0;
  white-space: nowrap;
}
.sdk-object-count-item {
  align-items: baseline;
  display: inline-flex;
  gap: var(--spacing-xs);
}
.sdk-object-count-value {
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.sdk-object-count[data-state="forbidden"] .sdk-object-count-value,
.sdk-object-count[data-state="error"] .sdk-object-count-value,
.sdk-object-count[data-state="awaiting"] .sdk-object-count-value {
  color: var(--el-text-color-secondary);
  font-weight: var(--font-medium);
}
.sdk-object-count-sep {
  color: var(--el-text-color-placeholder);
  user-select: none;
}
</style>
