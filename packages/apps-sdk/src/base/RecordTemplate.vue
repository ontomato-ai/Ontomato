<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PanelFieldTone, PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import { rawPanelText } from "../panel/text";
import type { PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";
import {
  asTone,
  extractMetricRow,
  kindFromMetricColumnType,
  parseTemplateTokens,
  useOptionalMemberDatum,
  type DisplayDataStateKind,
  type TypedFieldFormat,
} from "./display-value";
import { resolveLocalizedText } from "./localized-text";
import { rawRecordField } from "./record-field";
import TypedValue from "./TypedValue.vue";

/**
 * Fills already-provided values from one record (`record`) or one metric `result` row (`rowIndex`) into a fixed
 * `{fieldKey}` sentence template (for example `"{source} → {target} ({cardinality})"` or a localized panel message
 * `"Total {total}, {pending} pending review"`). Pure presentation with no expressions, business calculations, or
 * conditional sentence branching — derived numbers and business decisions belong in a MetricView, Action, or owner read.
 * Each placeholder renders via `TypedValue`, preserving clickable object references, localized booleans/names, status
 * tones, and formatted dates/numbers.
 */
const props = withDefaults(
  defineProps<{
    /** Fallback template string with `{fieldKey}` placeholders (`{{` and `}}` escape literal braces). */
    template?: string;
    /** Panel message key (resolved via `panel.t`) or platform i18n key resolving the template in the active locale. */
    templateKey?: string;
    /** Locale-keyed map of templates (for example `{ en: "{name} · {count} items", "zh-CN": "{name} · 共 {count} 项" }`). */
    templates?: Readonly<Record<string, string>>;
    /** Direct `PlatformObjectRecord` when used standalone or inside a slot without a bound datum. */
    record?: PlatformObjectRecord | null;
    /** Direct key-value map (such as a metric row or slot payload) when used standalone without a bound datum. */
    values?: Readonly<Record<string, unknown>> | null;
    /** Zero-based row index when reading from a bound metric `result` (`metricOutput`) table. Defaults to `0`. */
    rowIndex?: number;
    /** Optional per-placeholder formatting overrides (kind, tone, unit, numberFormat, separator, listStyle). */
    fieldFormats?: Readonly<Record<string, TypedFieldFormat>>;
    /** Placeholder text rendered when an individual field referenced in the template is empty. Defaults to `"—"`. */
    emptyPlaceholder?: string;
    /** Fallback text shown when the bound record or metric row is empty. Defaults to `"—"`. */
    emptyText?: string;
    /** Panel message key or platform i18n key overriding `emptyText`. */
    emptyKey?: string;
    /** Render inline (`<span>`, default `true`) or as a block paragraph (`<p>`). */
    inline?: boolean;
  }>(),
  {
    template: "",
    templateKey: undefined,
    templates: undefined,
    record: undefined,
    values: undefined,
    rowIndex: 0,
    fieldFormats: undefined,
    emptyPlaceholder: "—",
    emptyText: "—",
    emptyKey: undefined,
    inline: true,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks an object reference placeholder inside the rendered sentence. */
  navigate: [reference: PlatformFieldReference, fieldName: string];
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
const slot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter?.() ?? null;
const boundDatum = useOptionalMemberDatum(member, ["record", "result"] as const);

interface ResolvedTemplateData {
  readonly state: DisplayDataStateKind;
  readonly record: PlatformObjectRecord | null;
  readonly row: Readonly<Record<string, unknown>> | null;
  readonly columnTypes: Readonly<Record<string, string | null>>;
  readonly notice?: string;
}

const resolvedData = computed<ResolvedTemplateData>(() => {
  if (props.record !== undefined || props.values !== undefined || !boundDatum) {
    if (props.record === null && props.values === undefined) {
      return { state: "empty", record: null, row: null, columnTypes: {} };
    }
    return {
      state: "standalone",
      record: props.record ?? null,
      row: props.values ?? null,
      columnTypes: {},
    };
  }
  const current = boundDatum.state.value;
  if (current.status === "loading") return { state: "loading", record: null, row: null, columnTypes: {} };
  if (current.status === "empty") return { state: "empty", record: null, row: null, columnTypes: {} };
  if (current.status === "forbidden") {
    return { state: "forbidden", record: null, row: null, columnTypes: {}, notice: translate("platform.dataForbidden") };
  }
  if (current.status === "awaiting") {
    return { state: "awaiting", record: null, row: null, columnTypes: {}, notice: translate("platform.dataAwaiting") };
  }
  if (current.status === "error") {
    return {
      state: "error",
      record: null,
      row: null,
      columnTypes: {},
      notice: current.message || translate("platform.dataUnreachable"),
    };
  }
  if (boundDatum.name === "result") {
    const output = current.value as unknown as DashboardMetricOutput;
    const row = extractMetricRow(output, props.rowIndex);
    if (!row) return { state: "empty", record: null, row: null, columnTypes: {} };
    const columnTypes = Object.fromEntries(
      (output.columns ?? []).map((col) => [col.key, col.type]),
    );
    return { state: "ready", record: null, row, columnTypes };
  }
  const record = current.value as unknown as PlatformObjectRecord;
  return { state: "ready", record, row: null, columnTypes: {} };
});

const resolvedTemplate = computed(() => {
  if (props.templateKey && props.templateKey.trim()) {
    const rawFromPanel = rawPanelText(panel?.t, props.templateKey);
    if (rawFromPanel !== undefined) return rawFromPanel;
    if (i18n && i18n.te(props.templateKey)) {
      const rawFromI18n = i18n.tm(props.templateKey);
      if (typeof rawFromI18n === "string") return rawFromI18n;
    }
  }
  return resolveLocalizedText({
    key: props.templateKey,
    map: props.templates,
    fallback: props.template,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  });
});

const tokens = computed(() => parseTemplateTokens(resolvedTemplate.value));

const resolvedEmptyText = computed(() =>
  resolveLocalizedText({
    key: props.emptyKey,
    fallback: props.emptyText,
    locale: locale.value,
    panelText: panel?.t,
    t: translate,
    te: hasTranslation,
  }) || "—",
);

function fieldValueFor(key: string): PanelRecordFieldValue | undefined {
  const { record, row } = resolvedData.value;
  if (record) {
    const raw = rawRecordField(record, key);
    if (raw !== undefined) return raw;
    if (record.tags?.[key]) return [...record.tags[key]!];
  }
  if (row && Object.hasOwn(row, key)) {
    return row[key] as PanelRecordFieldValue;
  }
  return undefined;
}

function fieldToneFor(key: string): PanelFieldTone | undefined {
  const explicit = props.fieldFormats?.[key]?.tone;
  if (explicit) return explicit;
  const rec = resolvedData.value.record;
  return rec?.tones?.[key] ? asTone(rec.tones[key]) : undefined;
}

function fieldKindFor(key: string) {
  const explicit = props.fieldFormats?.[key]?.kind;
  if (explicit) return explicit;
  const colType = resolvedData.value.columnTypes[key];
  return kindFromMetricColumnType(colType) ?? "auto";
}

function handleNavigate(reference: PlatformFieldReference, fieldName: string) {
  if (panel && slot) {
    const output = panel.manifest.members[slot.slot]?.outputs?.[fieldName] ? fieldName : "navigate";
    if (panel.manifest.members[slot.slot]?.outputs?.[output]) {
      void panel.instance.output(slot.slot, output, {
        className: reference.className,
        primaryKey: reference.primaryKey,
      });
    }
  }
  emit("navigate", reference, fieldName);
}
</script>

<template>
  <component
    :is="inline ? 'span' : 'p'"
    class="sdk-record-template"
    :class="{ 'is-block': !inline }"
    :data-state="resolvedData.state"
    :title="resolvedData.notice"
    :aria-busy="resolvedData.state === 'loading' ? 'true' : undefined"
  >
    <span v-if="resolvedData.state === 'loading'" class="sdk-record-template-muted">…</span>
    <span
      v-else-if="resolvedData.state === 'forbidden' || resolvedData.state === 'error' || resolvedData.state === 'awaiting'"
      class="sdk-record-template-muted"
    >—</span>
    <span v-else-if="resolvedData.state === 'empty'" class="sdk-record-template-muted">{{ resolvedEmptyText }}</span>
    <template v-else>
      <template v-for="(token, index) in tokens" :key="index">
        <span v-if="token.kind === 'text'" class="sdk-record-template-text">{{ token.text }}</span>
        <TypedValue
          v-else
          :value="fieldValueFor(token.key)"
          :field="token.key"
          :kind="fieldKindFor(token.key)"
          :tone="fieldToneFor(token.key)"
          :unit="fieldFormats?.[token.key]?.unit"
          :number-format="fieldFormats?.[token.key]?.numberFormat"
          :separator="fieldFormats?.[token.key]?.separator"
          :list-style="fieldFormats?.[token.key]?.listStyle"
          :value-map="fieldFormats?.[token.key]?.valueMap"
          :empty-text="emptyPlaceholder"
          @navigate="(ref) => handleNavigate(ref, token.key)"
        />
      </template>
    </template>
  </component>
</template>

<style scoped>
.sdk-record-template {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  min-width: 0;
  overflow-wrap: anywhere;
}

.sdk-record-template.is-block {
  margin: 0;
}

.sdk-record-template-text {
  white-space: pre-wrap;
}

.sdk-record-template-muted {
  color: var(--el-text-color-secondary);
}
</style>
