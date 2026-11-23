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
  readonly total: number | null;
  readonly notice?: string;
}

interface NormalizedCountItem {
  readonly label?: string;
  readonly labelKey?: string;
  readonly labels?: Readonly<Record<string, string>>;
}

/**
 * Compact inline metric strip displaying the owner's record count from the member's `rows` (`panelRecordList` /
 * `panelRecordQuery`) or `objects` (`panelOntologyObjects`) datum. For complete unpaged lists (`panelRecordList`),
 * displays the list length; for paged/query reads (`panelRecordQuery` / `panelOntologyObjects`), displays strictly the
 * owner-returned `total` (showing `—` when the owner omits `total`, never falling back to the current page's row count).
 */
const props = withDefaults(
  defineProps<{
    /** Fallback unit label shown beside the count in single-metric mode. */
    label?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the unit label in single-metric mode. */
    labelKey?: string;
    /** Locale-keyed unit labels (e.g. `{ en: "Object types", de: "Objekttypen" }`) in single-metric mode. */
    labels?: Readonly<Record<string, string>>;
    /** Optional item definitions rendered inline separated by a middot. */
    items?: readonly ObjectCountItem[];
  }>(),
  {
    label: undefined,
    labelKey: undefined,
    labels: undefined,
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
    },
  ];
});

const parsedData = computed<ParsedCountData>(() => {
  const state = datumState.value;
  if (state.status === "loading") return { kind: "loading", total: null };
  if (state.status === "empty") return { kind: "empty", total: 0 };
  if (state.status === "forbidden") {
    return { kind: "forbidden", total: null, notice: t("platform.dataForbidden") };
  }
  if (state.status === "awaiting") {
    return { kind: "awaiting", total: null, notice: t("platform.dataAwaiting") };
  }
  if (state.status === "error") {
    return {
      kind: "error",
      total: null,
      notice: state.message || t("platform.dataUnreachable"),
    };
  }

  const value = state.value;
  if (datumName === "objects") {
    const response = value as unknown as PlatformOntologyObjectsResponse;
    if (response.status === "refused") {
      return {
        kind: "forbidden",
        total: null,
        notice: response.reason || t("platform.graphStatusRefused"),
      };
    }
    if (response.status !== "ok") {
      return {
        kind: "error",
        total: null,
        notice: response.reason || (response.status === "unavailable" ? t("platform.graphStatusUnavailable") : t("platform.dataUnreachable")),
      };
    }
    const hasTotal = typeof response.total === "number" && Number.isFinite(response.total);
    return { kind: "ready", total: hasTotal ? response.total : null };
  }

  if (Array.isArray(value)) {
    const rows = value as unknown as readonly PlatformObjectRecord[];
    return { kind: "ready", total: rows.length };
  }
  const query = value as unknown as PanelRecordQuery;
  const hasTotal = typeof query?.total === "number" && Number.isFinite(query.total);
  return { kind: "ready", total: hasTotal ? query.total! : null };
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
    else if (data.kind !== "ready" || data.total === null) display = "—";
    else display = String(data.total);
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
  color: var(--el-text-color-secondary);
  display: inline-flex;
  flex-wrap: nowrap;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  gap: var(--spacing-sm);
  line-height: var(--leading-sm);
  min-width: 0;
  white-space: nowrap;
  width: fit-content;
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
