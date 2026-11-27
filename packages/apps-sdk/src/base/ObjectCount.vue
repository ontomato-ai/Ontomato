<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { directReadDeclaration, type PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberOutput } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { readConfigString, resolveLocalizedText } from "./localized-text";
import type { ObjectCountItem } from "./object-count-types";
import UnavailableTooltip from "./UnavailableTooltip.vue";

type CountViewKind = "loading" | "empty" | "ready" | "forbidden" | "error" | "awaiting";

interface ParsedCountData {
  readonly kind: CountViewKind;
  readonly total: number | null;
  readonly notice?: string;
}

interface NormalizedCountItem {
  readonly label?: string;
  readonly labelKey?: string;
}

/**
 * Compact inline metric strip displaying the owner's record count from the member's `rows` (`panelRecordList` /
 * `panelRecordQuery`) datum. For complete unpaged lists (`panelRecordList`),
 * displays the list length (`0` when empty); for paged/query reads (`panelRecordQuery`),
 * displays strictly the owner-returned `total` (showing `—` when the owner omits `total` or returns an empty response
 * without `total`, never falling back to the current page's row count or inventing `0`). A badge whose read failed
 * shows a warning mark in its place, with the failure in a hover/focus tooltip, instead of disappearing.
 * Publishes `total` as a read-only member output (`number | null`).
 */
const props = withDefaults(
  defineProps<{
    /** Fallback unit label shown beside the count in single-metric mode. */
    label?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the unit label in single-metric mode. */
    labelKey?: string;
    /** Optional item definitions rendered inline separated by a middot. */
    items?: readonly ObjectCountItem[];
    /**
     * Visual presentation: `"default"` renders the inline count strip with labels and status placeholders (`…` / `—`),
     * while `"badge"` renders only a compact tabular numeral and omits the node whenever no finite count is available,
     * except a failed read, which draws a warning mark explaining the failure.
     */
    appearance?: "default" | "badge";
    /**
     * Omit rendering any DOM node while the count is unavailable (loading, awaiting, forbidden, error, or omitted by
     * the owner); a badge still marks a failed read. Defaults to `true` when `appearance` is `"badge"` and `false` for
     * `"default"`.
     */
    omitWhenUnavailable?: boolean;
  }>(),
  {
    label: undefined,
    labelKey: undefined,
    items: undefined,
    appearance: undefined,
    omitWhenUnavailable: undefined,
  },
);

const { t, te, locale } = useI18n();
const panel = usePanelContext();
const member = useMember();

const datum = member.projection.data.rows;
if (!datum) {
  throw new Error(`Projection ${member.projection.id} declares no 'rows' datum`);
}
const datumDeclaration = directReadDeclaration(member.projection, datum);
const isCompleteList = datumDeclaration?.result === "panelRecordList";
const datumState = useMemberData("rows");

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});

const resolvedAppearance = computed<"default" | "badge">(() => {
  const configured = props.appearance ?? readConfigString(rawConfig.value, "appearance");
  return configured === "badge" ? "badge" : "default";
});

const resolvedOmitWhenUnavailable = computed<boolean>(() => {
  if (typeof props.omitWhenUnavailable === "boolean") return props.omitWhenUnavailable;
  const raw = rawConfig.value?.omitWhenUnavailable ?? rawConfig.value?.["omit-when-unavailable"];
  if (typeof raw === "boolean") return raw;
  return resolvedAppearance.value === "badge";
});

function normalizeItem(raw: unknown): NormalizedCountItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    label: readConfigString(record, "label"),
    labelKey: readConfigString(record, "labelKey", "label-key"),
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
    },
  ];
});

const parsedData = computed<ParsedCountData>(() => {
  const state = datumState.value;
  if (state.status === "loading") return { kind: "loading", total: null };
  if (state.status === "empty") return { kind: "empty", total: isCompleteList ? 0 : null };
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
  if (Array.isArray(value)) {
    const rows = value as unknown as readonly PlatformObjectRecord[];
    return { kind: "ready", total: rows.length };
  }
  const query = value as unknown as PanelRecordQuery;
  const hasTotal = typeof query?.total === "number" && Number.isFinite(query.total);
  return { kind: "ready", total: hasTotal ? query.total! : null };
});

useMemberOutput("total", () => parsedData.value.total);

// A failed read is not "no count": the badge marks the failure in its place rather than vanishing or showing a dash.
const badgeReadFailed = computed(() => resolvedAppearance.value === "badge" && parsedData.value.kind === "error");

const badgeFailureLabel = computed(() => renderedItems.value.map((item) => item.label).filter(Boolean).join(", ") || undefined);

const visible = computed(() => !resolvedOmitWhenUnavailable.value || parsedData.value.total !== null);

const displayValue = computed(() => {
  const data = parsedData.value;
  if (data.kind === "loading") return "…";
  if (data.total !== null) return String(data.total);
  return "—";
});

const renderedItems = computed(() => {
  const display = displayValue.value;
  return configuredItems.value.map((item) => {
    const label = resolveLocalizedText({
      key: item.labelKey,
      fallback: item.label,
      locale: locale.value,
      panelText: panel.t,
      t,
      te,
    });
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

const badgeAccessibleLabel = computed<string | undefined>(() => {
  const hasConfiguredLabel = renderedItems.value.some((item) => Boolean(item.label));
  if (hasConfiguredLabel || parsedData.value.notice) return accessibleLabel.value;
  return undefined;
});
</script>

<template>
  <UnavailableTooltip
    v-if="badgeReadFailed"
    :reason="parsedData.notice"
    :label="badgeFailureLabel"
  >
    <span
      class="sdk-object-count sdk-object-count-badge"
      data-appearance="badge"
      data-state="error"
    >
      <svg class="sdk-object-count-failure" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
    </span>
  </UnavailableTooltip>
  <span
    v-else-if="visible && resolvedAppearance === 'badge'"
    class="sdk-object-count sdk-object-count-badge"
    data-appearance="badge"
    :data-state="parsedData.kind"
    :title="parsedData.notice"
    :aria-busy="parsedData.kind === 'loading' ? 'true' : undefined"
    :aria-label="badgeAccessibleLabel"
  >{{ displayValue }}</span>
  <span
    v-else-if="visible"
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
.sdk-object-count-badge {
  align-items: center;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
  font-size: var(--text-xs);
  font-weight: inherit;
  gap: 0;
  line-height: var(--leading-xs);
}
.sdk-object-count-failure {
  color: var(--el-color-warning);
  flex-shrink: 0;
}
</style>
