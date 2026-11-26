<script setup lang="ts">
import { computed, inject, useSlots } from "vue";
import { useI18n } from "vue-i18n";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PanelFieldTone, PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { appIcon, hasAppIcon } from "@ontomato/platform-shell";
import { panelContextKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import {
  asTone,
  extractMetricCell,
  extractMetricRow,
  resolveValueMapEntry,
  useOptionalMemberDatum,
  type DisplayDataStateKind,
  type TypedFieldFormat,
  type TypedValueMap,
} from "./display-value";
import { resolveLocalizedText } from "./localized-text";
import { displayFieldText, isRecordTag, rawRecordField } from "./record-field";
import RecordTemplate from "./RecordTemplate.vue";

type BannerTone = "info" | "success" | "warning" | "danger";

/**
 * Standardized informational, reminder, warning, success, or danger callout banner (for example relationship detail
 * guidance cards or read-only explanations). Supports static or localized copy, custom slot content, or binding to a
 * projection's `record` (`panelRecord`) or metric `result` (`metricOutput`) datum via `field` or a fixed `{fieldKey}`
 * `template` (with no calculation or conditional branching).
 */
const props = withDefaults(
  defineProps<{
    /** Semantic banner tone (`"info"`, `"success"`, `"warning"`, `"danger"`). Defaults to `"info"`. */
    tone?: BannerTone;
    /** Optional field/column key on a bound `record` or metric `result` whose value (tag tone, `record.tones[toneField]`, or tone string) determines the banner tone. */
    toneField?: string;
    /** Optional exact raw-value to display label/icon mapping applied to `toneField` / `field` (pure exact match; no tone or threshold expressions). */
    valueMap?: TypedValueMap;
    /** Optional platform icon name overriding the default semantic status icon. */
    icon?: string;
    /** Optional fallback heading text. */
    title?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the heading. */
    titleKey?: string;
    /** Optional fallback body text. */
    text?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key for the body text. */
    textKey?: string;
    /** Optional field key on a bound `record` or column key on a bound metric `result` providing the body text. */
    field?: string;
    /** Optional fixed `{fieldKey}` sentence template formatted against the bound `record` or metric `result` row. */
    template?: string;
    /** Panel or platform i18n key resolving `template` in the active locale. */
    templateKey?: string;
    /** Optional per-placeholder formatting overrides (including `valueMap`) passed to `RecordTemplate`. */
    fieldFormats?: Readonly<Record<string, TypedFieldFormat>>;
    /** Zero-based row index when reading from a bound metric `result` (`metricOutput`) table. Defaults to `0`. */
    rowIndex?: number;
    /** Tighter padding for dense sidebars and narrow detail cards. Defaults to `false`. */
    compact?: boolean;
    /** Omit the leading status icon. Defaults to `false`. */
    hideIcon?: boolean;
    /** Also hide an empty banner without an explicit record field driving its visibility. Defaults to `false`. */
    hideWhenEmpty?: boolean;
  }>(),
  {
    tone: "info",
    toneField: undefined,
    valueMap: undefined,
    icon: undefined,
    title: undefined,
    titleKey: undefined,
    text: undefined,
    textKey: undefined,
    field: undefined,
    template: undefined,
    templateKey: undefined,
    fieldFormats: undefined,
    rowIndex: 0,
    compact: false,
    hideIcon: false,
    hideWhenEmpty: false,
  },
);

defineSlots<{
  /** Optional custom body content rendered beneath the title instead of or beside plain `text`. */
  default?(): unknown;
  /** Optional right-aligned action buttons or links inside the banner. */
  actions?(): unknown;
}>();

const slots = useSlots();
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
const boundDatum = useOptionalMemberDatum(member, ["record", "result"] as const);

interface ResolvedBound {
  readonly state: DisplayDataStateKind;
  readonly record: PlatformObjectRecord | null;
  readonly metricRow: Readonly<Record<string, unknown>> | null;
  readonly rawFieldValue: unknown;
  readonly rawToneFieldValue: unknown;
  readonly fieldText: string;
  readonly notice?: string;
}

const resolvedBound = computed<ResolvedBound>(() => {
  if (!boundDatum) {
    return { state: "standalone", record: null, metricRow: null, rawFieldValue: undefined, rawToneFieldValue: undefined, fieldText: "" };
  }
  const current = boundDatum.state.value;
  if (current.status === "loading") {
    return { state: "loading", record: null, metricRow: null, rawFieldValue: undefined, rawToneFieldValue: undefined, fieldText: "" };
  }
  if (current.status === "empty") {
    return { state: "empty", record: null, metricRow: null, rawFieldValue: undefined, rawToneFieldValue: undefined, fieldText: "" };
  }
  if (current.status === "forbidden") {
    return { state: "forbidden", record: null, metricRow: null, rawFieldValue: undefined, rawToneFieldValue: undefined, fieldText: "", notice: translate("platform.dataForbidden") };
  }
  if (current.status === "awaiting") {
    return { state: "awaiting", record: null, metricRow: null, rawFieldValue: undefined, rawToneFieldValue: undefined, fieldText: "", notice: translate("platform.dataAwaiting") };
  }
  if (current.status === "error") {
    return {
      state: "error",
      record: null,
      metricRow: null,
      rawFieldValue: undefined,
      rawToneFieldValue: undefined,
      fieldText: "",
      notice: current.message || translate("platform.dataUnreachable"),
    };
  }
  if (boundDatum.name === "result") {
    const output = current.value as unknown as DashboardMetricOutput;
    const row = extractMetricRow(output, props.rowIndex);
    if (!row) {
      return { state: "empty", record: null, metricRow: null, rawFieldValue: undefined, rawToneFieldValue: undefined, fieldText: "" };
    }
    const cell = extractMetricCell(output, props.field, props.rowIndex);
    const toneCell = props.toneField ? extractMetricCell(output, props.toneField, props.rowIndex) : null;
    const fieldText = cell.value === undefined || cell.value === null ? "" : String(cell.value);
    return {
      state: "ready",
      record: null,
      metricRow: row,
      rawFieldValue: cell.value,
      rawToneFieldValue: toneCell ? toneCell.value : undefined,
      fieldText,
    };
  }
  const record = current.value as unknown as PlatformObjectRecord;
  const fieldKey = props.field;
  const raw = fieldKey ? rawRecordField(record, fieldKey) : undefined;
  const rawTone = props.toneField ? rawRecordField(record, props.toneField) : undefined;
  const fieldText = raw !== undefined ? displayFieldText(raw as PanelRecordFieldValue, locale.value, translate) : "";
  return { state: "ready", record, metricRow: null, rawFieldValue: raw, rawToneFieldValue: rawTone, fieldText };
});

function toBannerTone(tone: PanelFieldTone | undefined): BannerTone | undefined {
  if (tone === "info" || tone === "success" || tone === "warning" || tone === "danger") return tone;
  return undefined;
}

const mappedFieldEntry = computed(() =>
  resolveValueMapEntry(resolvedBound.value.rawFieldValue, props.valueMap, {
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  }),
);

const mappedToneEntry = computed(() => {
  if (props.toneField) {
    return resolveValueMapEntry(resolvedBound.value.rawToneFieldValue, props.valueMap, {
      locale: locale.value,
      panelText: panel?.t,
      t: translate,
      te: hasTranslation,
    });
  }
  return mappedFieldEntry.value;
});

const effectiveTone = computed<BannerTone>(() => {
  const rec = resolvedBound.value.record;
  if (props.toneField) {
    const rawTone = resolvedBound.value.rawToneFieldValue;
    if (isRecordTag(rawTone as PanelRecordFieldValue | undefined)) {
      const fromTag = toBannerTone((rawTone as { readonly tone?: PanelFieldTone }).tone);
      if (fromTag) return fromTag;
    }
    if (rec) {
      const fromTones = toBannerTone(asTone(rec.tones?.[props.toneField]));
      if (fromTones) return fromTones;
    }
    const fromValue = toBannerTone(asTone(rawTone));
    if (fromValue) return fromValue;
  } else {
    const rawField = resolvedBound.value.rawFieldValue;
    if (isRecordTag(rawField as PanelRecordFieldValue | undefined)) {
      const fromTag = toBannerTone((rawField as { readonly tone?: PanelFieldTone }).tone);
      if (fromTag) return fromTag;
    }
    if (rec && props.field) {
      const fromTones = toBannerTone(asTone(rec.tones?.[props.field]));
      if (fromTones) return fromTones;
    }
  }
  return props.tone;
});

const customIconName = computed<string | undefined>(() => {
  const explicit = props.icon?.trim();
  if (explicit && hasAppIcon(explicit)) return explicit;
  return mappedToneEntry.value?.icon ?? mappedFieldEntry.value?.icon;
});

const resolvedTitle = computed(() =>
  resolveLocalizedText({
    key: props.titleKey,
    fallback: props.title,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  }),
);

const resolvedStaticText = computed(() =>
  resolveLocalizedText({
    key: props.textKey,
    fallback: props.text,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  }),
);

const hasTemplate = computed(() => Boolean(props.template || props.templateKey));

const bodyText = computed(() => {
  if (boundDatum && props.field) {
    return mappedFieldEntry.value?.label ?? resolvedBound.value.fieldText;
  }
  if (boundDatum && !hasTemplate.value && !resolvedStaticText.value && !slots.default && boundDatum.name === "result") {
    return mappedFieldEntry.value?.label ?? resolvedBound.value.fieldText;
  }
  return resolvedStaticText.value;
});

const isHidden = computed(() => {
  if (slots.default) return false;
  const { state, record, fieldText } = resolvedBound.value;
  if (state === "loading") return false;
  if (boundDatum?.name === "record") {
    const bodyField = hasTemplate.value ? undefined : props.field;
    const sourceField = bodyField || props.toneField;
    if (sourceField && state === "empty") return true;
    if (sourceField && record) {
      const sourceText = bodyField
        ? fieldText
        : displayFieldText(rawRecordField(record, sourceField), locale.value, translate);
      const hasBoundTone = !bodyField && asTone(record.tones?.[sourceField]);
      if (!sourceText.trim() && !hasBoundTone) return true;
    }
  }
  if (!props.hideWhenEmpty) return false;
  if (state === "empty") return true;
  if (hasTemplate.value) {
    return Boolean(boundDatum && state !== "ready");
  }
  return !resolvedTitle.value && !bodyText.value;
});

const ariaRole = computed(() => (effectiveTone.value === "warning" || effectiveTone.value === "danger" ? "alert" : "status"));
</script>

<template>
  <aside
    v-if="!isHidden"
    class="sdk-info-banner"
    :class="{ 'is-compact': compact }"
    :data-tone="effectiveTone"
    :data-state="resolvedBound.state"
    :role="ariaRole"
    :aria-busy="resolvedBound.state === 'loading' ? 'true' : undefined"
  >
    <span v-if="!hideIcon" class="sdk-info-banner-icon" :data-icon="customIconName" aria-hidden="true">
      <component :is="appIcon(customIconName)" v-if="customIconName" :size="16" :stroke-width="2" />
      <svg v-else-if="effectiveTone === 'success'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <svg v-else-if="effectiveTone === 'warning'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
      </svg>
      <svg v-else-if="effectiveTone === 'danger'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
    </span>

    <div class="sdk-info-banner-content">
      <strong v-if="resolvedTitle" class="sdk-info-banner-title">{{ resolvedTitle }}</strong>
      <div class="sdk-info-banner-body">
        <slot>
          <span v-if="resolvedBound.state === 'loading'" class="sdk-info-banner-muted">…</span>
          <span v-else-if="resolvedBound.notice" class="sdk-info-banner-muted">{{ resolvedBound.notice }}</span>
          <RecordTemplate
            v-else-if="hasTemplate"
            :template="template"
            :template-key="templateKey"
            :field-formats="fieldFormats"
            :record="resolvedBound.record"
            :values="resolvedBound.metricRow"
            :row-index="rowIndex"
            :inline="true"
          />
          <span v-else-if="bodyText">{{ bodyText }}</span>
        </slot>
      </div>
    </div>

    <div v-if="$slots.actions" class="sdk-info-banner-actions">
      <slot name="actions" />
    </div>
  </aside>
</template>

<style scoped>
.sdk-info-banner {
  container: sdk-info-banner / inline-size;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--spacing-sm) var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  border: 1px solid var(--el-color-primary-light-7, var(--ui-border));
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9, var(--ui-fill-tertiary));
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  min-width: 0;
  box-sizing: border-box;
}

.sdk-info-banner.is-compact {
  padding: var(--spacing-sm) var(--spacing-md);
}

.sdk-info-banner[data-tone="info"] {
  border-color: var(--el-color-primary-light-7, var(--ui-border));
  background: var(--el-color-primary-light-9, var(--ui-fill-tertiary));
}

.sdk-info-banner[data-tone="info"] .sdk-info-banner-icon {
  color: var(--brand-link, var(--el-color-primary));
}

.sdk-info-banner[data-tone="success"] {
  border-color: var(--el-color-success-light-7, var(--ui-border));
  background: var(--el-color-success-light-9, var(--ui-fill-tertiary));
}

.sdk-info-banner[data-tone="success"] .sdk-info-banner-icon {
  color: var(--el-color-success-text, var(--el-color-success));
}

.sdk-info-banner[data-tone="warning"] {
  border-color: var(--el-color-warning-light-7, var(--ui-border));
  background: var(--el-color-warning-light-9, var(--ui-fill-tertiary));
}

.sdk-info-banner[data-tone="warning"] .sdk-info-banner-icon {
  color: var(--el-color-warning-text, var(--el-color-warning));
}

.sdk-info-banner[data-tone="danger"] {
  border-color: var(--el-color-danger-light-7, var(--ui-border));
  background: var(--el-color-danger-light-9, var(--ui-fill-tertiary));
}

.sdk-info-banner[data-tone="danger"] .sdk-info-banner-icon {
  color: var(--el-color-danger-text, var(--el-color-danger));
}

.sdk-info-banner-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}

.sdk-info-banner-content {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sdk-info-banner-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: var(--leading-sm);
}

.sdk-info-banner-body {
  color: var(--el-text-color-regular);
  overflow-wrap: anywhere;
}

.sdk-info-banner-muted {
  color: var(--el-text-color-secondary);
}

.sdk-info-banner-actions {
  display: inline-flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  margin-inline-start: auto;
}

@container sdk-info-banner (max-width: 420px) {
  .sdk-info-banner-actions {
    flex-basis: 100%;
    margin-inline-start: 0;
  }
}
</style>
