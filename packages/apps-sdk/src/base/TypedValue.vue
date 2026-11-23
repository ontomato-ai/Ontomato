<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PanelFieldTone, PanelRecordFieldArrayItem, PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";
import type { PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";
import {
  asTone,
  extractMetricCell,
  formatTypedNumber,
  formatTypedTime,
  inferValueKind,
  unwrapJsonField,
  useOptionalMemberDatum,
  type DisplayDataStateKind,
  type TypedNumberFormat,
  type TypedValueKind,
} from "./display-value";
import { resolveLocalizedText } from "./localized-text";
import {
  displayFieldText,
  isRecordReference,
  rawRecordField,
  recordFieldArrayItems,
  referenceDisplayLabel,
  scalarFieldText,
  toFieldReference,
} from "./record-field";

/**
 * Displays a single typed field value according to its owner-declared type — text, tabular number, localized date/time,
 * localized boolean, status/enum tag, tag list, clickable object reference, multi-language name, list, or code/JSON —
 * without computing business logic. Reads from its projection's `record` (`panelRecord`) or `result` (`metricOutput`,
 * scalar/first-row cell) datum, or renders a direct `value` prop standalone or inside a slot.
 */
const props = withDefaults(
  defineProps<{
    /** Direct value to display when used standalone or inside a slot (takes precedence when no datum is bound). */
    value?: PanelRecordFieldValue | RuntimeJsonValue | null;
    /** Field key on the bound `record` (`"label"`, `"subtitle"`, `fields[key]`, or `tags[key]`) or column key on `result`. */
    field?: string;
    /** Zero-based row index when reading from a bound metric `result` (`metricOutput`) table. Defaults to `0`. */
    rowIndex?: number;
    /** Display kind: `"auto"` infers from runtime value shape, record tones/tags, or metric column type. */
    kind?: TypedValueKind;
    /** Optional semantic tone for `"tag"` or badge display; falls back to `record.tones[field]` when bound. */
    tone?: PanelFieldTone;
    /** Optional unit suffix rendered beside numeric or scalar values (for example `"%"`, `"ms"`). */
    unit?: string;
    /** Optional `Intl.NumberFormat` options applied when formatting `"number"` values. */
    numberFormat?: TypedNumberFormat;
    /** Separator between inline list elements when `listStyle` is `"inline"`. Defaults to `", "`. */
    separator?: string;
    /** How array values are rendered: `"inline"` (default) joins items inline; `"tags"` renders chips. */
    listStyle?: "inline" | "tags";
    /** Fallback text shown when the value is missing, empty, or the metric returned no rows. Defaults to `"—"`. */
    emptyText?: string;
    /** Optional panel message key or platform i18n key overriding `emptyText`. */
    emptyKey?: string;
    /** Clamp single-line text with an ellipsis and expose the full text on `title`. */
    truncate?: boolean;
  }>(),
  {
    value: undefined,
    field: undefined,
    rowIndex: 0,
    kind: "auto",
    tone: undefined,
    unit: undefined,
    numberFormat: undefined,
    separator: ", ",
    listStyle: "inline",
    emptyText: "—",
    emptyKey: undefined,
    truncate: false,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks an object reference value (or a reference item inside a list). */
  navigate: [reference: PlatformFieldReference, fieldName?: string];
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

interface ResolvedSource {
  readonly state: DisplayDataStateKind;
  readonly raw: unknown;
  readonly record: PlatformObjectRecord | null;
  readonly fieldKey?: string;
  readonly columnType?: string | null;
  readonly notice?: string;
}

const resolved = computed<ResolvedSource>(() => {
  if (!boundDatum || props.value !== undefined) {
    return {
      state: "standalone",
      raw: props.value,
      record: null,
      fieldKey: props.field,
    };
  }
  const current = boundDatum.state.value;
  if (current.status === "loading") return { state: "loading", raw: undefined, record: null, fieldKey: props.field };
  if (current.status === "empty") return { state: "empty", raw: undefined, record: null, fieldKey: props.field };
  if (current.status === "forbidden") {
    return {
      state: "forbidden",
      raw: undefined,
      record: null,
      fieldKey: props.field,
      notice: translate("platform.dataForbidden"),
    };
  }
  if (current.status === "awaiting") {
    return {
      state: "awaiting",
      raw: undefined,
      record: null,
      fieldKey: props.field,
      notice: translate("platform.dataAwaiting"),
    };
  }
  if (current.status === "error") {
    return {
      state: "error",
      raw: undefined,
      record: null,
      fieldKey: props.field,
      notice: current.message || translate("platform.dataUnreachable"),
    };
  }

  if (boundDatum.name === "result") {
    const output = current.value as unknown as DashboardMetricOutput;
    const cell = extractMetricCell(output, props.field, props.rowIndex);
    if (cell.rowCount === 0) {
      return {
        state: "empty",
        raw: undefined,
        record: null,
        fieldKey: cell.column?.key ?? props.field,
        columnType: cell.column?.type ?? null,
      };
    }
    return {
      state: "ready",
      raw: cell.value,
      record: null,
      fieldKey: cell.column?.key ?? props.field,
      columnType: cell.column?.type ?? null,
    };
  }

  const record = current.value as unknown as PlatformObjectRecord;
  const fieldKey = props.field ?? "label";
  const raw = rawRecordField(record, fieldKey);
  const tagFallback = raw === undefined && record.tags?.[fieldKey] ? record.tags[fieldKey] : undefined;
  return {
    state: "ready",
    raw: raw ?? tagFallback,
    record,
    fieldKey,
  };
});

const effectiveTone = computed<PanelFieldTone | undefined>(() => {
  if (props.tone) return props.tone;
  const rec = resolved.value.record;
  const key = resolved.value.fieldKey;
  if (rec && key && rec.tones?.[key]) return asTone(rec.tones[key]);
  return undefined;
});

const isTagsField = computed(() => {
  const rec = resolved.value.record;
  const key = resolved.value.fieldKey;
  return Boolean(rec && key && Array.isArray(rec.tags?.[key]) && rawRecordField(rec, key) === undefined);
});

const effectiveKind = computed(() =>
  inferValueKind(resolved.value.raw, {
    explicitKind: props.kind,
    hasTone: effectiveTone.value !== undefined,
    isTagsField: isTagsField.value,
    columnType: resolved.value.columnType,
  }),
);

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

const isEmptyValue = computed(() => {
  const raw = resolved.value.raw;
  if (raw === undefined || raw === null || raw === "") return true;
  if (Array.isArray(raw) && raw.length === 0) return true;
  return false;
});

const referenceValue = computed<PlatformFieldReference | null>(() => {
  const raw = resolved.value.raw;
  if (isRecordReference(raw as PanelRecordFieldValue | undefined)) {
    return toFieldReference(raw as Extract<PanelRecordFieldValue, { kind: "reference" }>);
  }
  if (
    raw
    && typeof raw === "object"
    && !Array.isArray(raw)
    && typeof (raw as { className?: unknown }).className === "string"
    && typeof (raw as { primaryKey?: unknown }).primaryKey === "string"
  ) {
    const obj = raw as { className: string; primaryKey: string; label?: string };
    return {
      className: obj.className,
      primaryKey: obj.primaryKey,
      label: typeof obj.label === "string" ? obj.label : obj.primaryKey,
    };
  }
  return null;
});

interface NormalizedListItem {
  readonly text: string;
  readonly reference: PlatformFieldReference | null;
}

const listItems = computed<readonly NormalizedListItem[]>(() => {
  const rec = resolved.value.record;
  const key = resolved.value.fieldKey;
  let source: readonly unknown[];
  if (rec && key) {
    source = recordFieldArrayItems(rec, key);
  } else {
    const unwrapped = unwrapJsonField(resolved.value.raw);
    source = Array.isArray(unwrapped) ? unwrapped : unwrapped === undefined || unwrapped === null ? [] : [unwrapped];
  }
  return source
    .map((item): NormalizedListItem | null => {
      if (item === undefined || item === null) return null;
      if (isRecordReference(item as PanelRecordFieldArrayItem)) {
        const refObj = item as Extract<PanelRecordFieldArrayItem, { kind: "reference" }>;
        return {
          text: referenceDisplayLabel(refObj),
          reference: toFieldReference(refObj),
        };
      }
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
        return { text: scalarFieldText(item, translate), reference: null };
      }
      return { text: displayFieldText(item as PanelRecordFieldValue, locale.value, translate), reference: null };
    })
    .filter((entry): entry is NormalizedListItem => entry !== null && entry.text.length > 0);
});

const formattedTime = computed(() => {
  const kind = effectiveKind.value;
  if (kind !== "date" && kind !== "datetime" && kind !== "relative-time") return null;
  const unwrapped = unwrapJsonField(resolved.value.raw);
  return formatTypedTime(unwrapped, kind, locale.value);
});

const displayText = computed<string>(() => {
  const raw = resolved.value.raw;
  if (isEmptyValue.value) return "";
  const kind = effectiveKind.value;
  if (kind === "number") {
    return formatTypedNumber(unwrapJsonField(raw), locale.value, props.numberFormat);
  }
  if (kind === "date" || kind === "datetime" || kind === "relative-time") {
    return formattedTime.value?.text ?? "";
  }
  if (kind === "boolean") {
    const unwrapped = unwrapJsonField(raw);
    const boolVal = typeof unwrapped === "boolean"
      ? unwrapped
      : unwrapped === "true" || unwrapped === 1
        ? true
        : unwrapped === "false" || unwrapped === 0
          ? false
          : null;
    if (boolVal !== null) return scalarFieldText(boolVal, translate);
    return String(unwrapped);
  }
  if (kind === "json" || kind === "code") {
    const unwrapped = unwrapJsonField(raw);
    if (typeof unwrapped === "string") return unwrapped;
    try {
      return JSON.stringify(unwrapped);
    } catch {
      return String(unwrapped);
    }
  }
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return scalarFieldText(raw, translate);
  }
  return displayFieldText(raw as PanelRecordFieldValue, locale.value, translate);
});

const tooltipTitle = computed<string | undefined>(() => {
  if (resolved.value.notice) return resolved.value.notice;
  if (formattedTime.value?.title) return formattedTime.value.title;
  if (props.truncate && displayText.value) return props.unit ? `${displayText.value} ${props.unit}` : displayText.value;
  return undefined;
});

function navigateTo(reference: PlatformFieldReference) {
  const fieldName = resolved.value.fieldKey;
  if (panel && slot) {
    const output = fieldName && panel.manifest.members[slot.slot]?.outputs?.[fieldName] ? fieldName : "navigate";
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
  <span
    class="sdk-typed-value"
    :class="{ 'is-truncate': truncate, 'is-numeric': effectiveKind === 'number' }"
    :data-kind="effectiveKind"
    :data-state="resolved.state"
    :title="tooltipTitle"
    :aria-busy="resolved.state === 'loading' ? 'true' : undefined"
  >
    <span v-if="resolved.state === 'loading'" class="sdk-typed-value-muted">…</span>
    <span
      v-else-if="resolved.state === 'forbidden' || resolved.state === 'error' || resolved.state === 'awaiting'"
      class="sdk-typed-value-muted"
    >—</span>
    <span v-else-if="resolved.state === 'empty' || isEmptyValue" class="sdk-typed-value-empty">{{ resolvedEmptyText }}</span>

    <button
      v-else-if="effectiveKind === 'reference' && referenceValue"
      type="button"
      class="sdk-typed-value-link"
      @click="navigateTo(referenceValue)"
    >{{ referenceValue.label || referenceValue.primaryKey }}</button>

    <span
      v-else-if="effectiveKind === 'tag'"
      class="sdk-typed-value-tag"
      :data-tone="effectiveTone ?? 'default'"
    >{{ displayText }}</span>

    <span v-else-if="effectiveKind === 'tags' || (effectiveKind === 'list' && listStyle === 'tags')" class="sdk-typed-value-tags">
      <template v-for="(item, idx) in listItems" :key="idx">
        <button
          v-if="item.reference"
          type="button"
          class="sdk-typed-value-tag is-link"
          :data-tone="effectiveTone ?? 'info'"
          @click="navigateTo(item.reference)"
        >{{ item.text }}</button>
        <span v-else class="sdk-typed-value-tag" :data-tone="effectiveTone ?? 'default'">{{ item.text }}</span>
      </template>
    </span>

    <span v-else-if="effectiveKind === 'list'" class="sdk-typed-value-list">
      <template v-for="(item, idx) in listItems" :key="idx">
        <span v-if="idx > 0" class="sdk-typed-value-sep">{{ separator }}</span>
        <button
          v-if="item.reference"
          type="button"
          class="sdk-typed-value-link"
          @click="navigateTo(item.reference)"
        >{{ item.text }}</button>
        <span v-else>{{ item.text }}</span>
      </template>
    </span>

    <code v-else-if="effectiveKind === 'code' || effectiveKind === 'json'" class="sdk-typed-value-code">{{ displayText }}</code>

    <span v-else class="sdk-typed-value-text">
      <span>{{ displayText }}</span><template v-if="unit">{{ " " }}<span class="sdk-typed-value-unit">{{ unit }}</span></template>
    </span>
  </span>
</template>

<style scoped>
.sdk-typed-value {
  display: inline-flex;
  align-items: baseline;
  max-width: 100%;
  min-width: 0;
  color: var(--el-text-color-primary);
  font-size: inherit;
  line-height: inherit;
}

.sdk-typed-value.is-numeric {
  font-variant-numeric: tabular-nums;
}

.sdk-typed-value.is-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-typed-value-text {
  display: inline-flex;
  align-items: baseline;
  min-width: 0;
}

.sdk-typed-value.is-truncate .sdk-typed-value-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-typed-value-unit {
  margin-inline-start: var(--spacing-xs);
  color: var(--el-text-color-secondary);
  font-size: 0.9em;
  white-space: nowrap;
}

.sdk-typed-value-muted,
.sdk-typed-value-empty {
  color: var(--el-text-color-secondary);
}

.sdk-typed-value-link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--brand-link, var(--el-color-primary));
  font: inherit;
  text-align: start;
  text-decoration: none;
  cursor: pointer;
}

.sdk-typed-value-link:hover {
  text-decoration: underline;
}

.sdk-typed-value-link:focus-visible {
  outline: none;
  border-radius: var(--radius-xs);
  box-shadow: var(--focus-ring);
}

.sdk-typed-value-tags {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}

.sdk-typed-value-tag {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-xs);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-regular);
  font-family: inherit;
  font-size: var(--text-xs);
  line-height: var(--leading-sm);
  white-space: nowrap;
}

.sdk-typed-value-tag.is-link {
  cursor: pointer;
}

.sdk-typed-value-tag.is-link:hover {
  text-decoration: underline;
}

.sdk-typed-value-tag.is-link:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}

.sdk-typed-value-tag[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info-text);
}

.sdk-typed-value-tag[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}

.sdk-typed-value-tag[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
}

.sdk-typed-value-tag[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}

.sdk-typed-value-list {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  min-width: 0;
}

.sdk-typed-value-sep {
  white-space: pre;
  color: var(--el-text-color-secondary);
}

.sdk-typed-value-code {
  padding: 1px var(--spacing-xs);
  border-radius: var(--radius-xs);
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
  font-family: var(--font-mono);
  font-size: var(--text-mono);
  line-height: var(--leading-mono);
  overflow-wrap: anywhere;
}
</style>
