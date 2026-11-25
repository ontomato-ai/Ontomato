<script setup lang="ts">
import { projectionElement } from "../panel/projection-element";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { panelRecordObjectRef } from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMemberData, useMemberOutput } from "../panel/member";
import type { PlatformChildFieldReference, PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";
import {
  childReferenceDisplayLabel,
  displayFieldText,
  isRecordChildReference,
  isRecordReference,
  recordFieldArrayItems,
  referenceDisplayLabel,
  scalarFieldText,
  toChildFieldReference,
  toFieldReference,
} from "./record-field";
import { extractSummaryKeyValueEntries, type SummaryKeyValueEntry } from "./summary-key-value";
import { textHighlightSegments } from "./text-highlight";
import { useDataStateLabels } from "./data-state-labels";

/**
 * One platform object as a few facts a reader recognises it by: the member's `record` datum, which the instance reads
 * through the platform in its document and through this release's resource module in a panel's frame. Which facts
 * are shown, and in what order, is the projection's configuration; what each holds is the object's owner's. Safe range
 * highlights, status tags, tag lists and clickable reference links follow the same record contract as `ObjectList`.
 */
const props = withDefaults(
  defineProps<{
    /**
     * The owner's fields to show, by field name, in this order; absent, every field the owner's record gives, in its order.
     * A field the owner gives a tone for (`tones`) is drawn as a coloured tag, a tag list (`tags`) as tags and a reference as
     * a link the page hears as `navigate`; any other is text, its line breaks kept.
     */
    fields?: readonly string[];
    /**
     * Whether to render the `record.label` heading above the field list; defaults to `true`. Set to `false` when an
     * `ObjectHeader` or section heading above this summary already introduces the object.
     */
    showTitle?: boolean;
    /**
     * Visual layout: `"fields"` (default) draws a definition list of field labels and values; `"article"` draws a
     * document reading layout with title and optional status badge on the top row, tags underneath when non-empty, a
     * hairline divider, and full-width body prose.
     */
    layout?: "fields" | "article";
    /** Field key drawn as a right-aligned status tag in `"article"` layout. */
    statusField?: string;
    /** Field key drawn as a row of tags below the heading in `"article"` layout when non-empty. */
    tagsField?: string;
    /** Field key drawn as full-width reading prose below the divider in `"article"` layout. */
    bodyField?: string;
    /** Optional panel message key shown in a centered empty state when no object is selected yet. */
    emptyText?: string;
    /** Optional panel message key shown when the requested object cannot be found or has been removed. */
    missingText?: string;
    /** Field keys that show a one-click copy button beside their displayed value; hash routes (`#/...`) resolve to the full browser URL. */
    copyableFields?: readonly string[];
    /**
     * Presentation mode: `"fields"` (default) renders structured fields or article layout; `"pre"` renders a single
     * focusable scrollable `<pre tabindex="0">` block capped at `55dvh` showing the full text of `textField` (or the
     * first text field when omitted).
     */
    presentation?: "fields" | "pre";
    /** Field key displayed in `presentation="pre"` mode; omitted, uses the first text field on the record. */
    textField?: string;
    /**
     * Spacing and column ratio for the `"fields"` definition list: `"comfortable"` (default) uses an airy `1fr 2fr`
     * two-column layout with `12px` row gap and `16px` column gap; `"compact"` uses tighter `auto 1fr` spacing for dense containers.
     */
    density?: "comfortable" | "compact";
    /** Field keys whose structured map or `{ key, label?, value }` entry list renders as an aligned two-column `<dl>` grid instead of raw JSON text. */
    keyValueFields?: readonly string[];
    /** Renders the field list as a bordered description table with subtle cell borders and a muted label column background. Defaults to `false`. */
    bordered?: boolean;
    /** Number of label/value column pairs per row in `"fields"` layout. Defaults to `1`. */
    columns?: number;
  }>(),
  {
    showTitle: true,
    layout: "fields",
    statusField: undefined,
    tagsField: undefined,
    bodyField: undefined,
    emptyText: undefined,
    missingText: undefined,
    copyableFields: undefined,
    presentation: "fields",
    textField: undefined,
    density: "comfortable",
    keyValueFields: undefined,
    bordered: false,
    columns: 1,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks a reference field carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, fieldName: string];
  /** Emitted when a reader clicks a parent-scoped child reference field or item. */
  "navigate-child": [reference: PlatformChildFieldReference, fieldName: string];
}>();

const { t, locale } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = projectionElement(slot.projection).id;
/** The summary is the member's `record` datum, read by the instance: in a panel's frame and in the platform's document. */
const recordData = useMemberData("record");

const record = computed<PlatformObjectRecord | null>(() =>
  recordData.value.status === "ready" ? (recordData.value.value as unknown as PlatformObjectRecord) : null);

useMemberOutput("label", () => record.value?.label ?? null);
useMemberOutput("status", () => recordData.value.status);

const shown = computed(() => {
  const fields = record.value?.fields ?? {};
  const tags = record.value?.tags ?? {};
  const present = (name: string) => name in fields || name in tags;
  const keys = props.fields ?? [...new Set([...Object.keys(fields), ...Object.keys(tags)])];
  return keys.filter(present);
});

const isPre = computed(() => props.presentation === "pre");
const isArticle = computed(() => !isPre.value && props.layout === "article");
const articleExtraFields = computed(() => {
  if (!isArticle.value) return shown.value;
  const reserved = new Set([props.statusField, props.tagsField, props.bodyField].filter(Boolean));
  return shown.value.filter((name) => !reserved.has(name));
});

function resolvePreFieldKey(current: PlatformObjectRecord): string | null {
  if (props.textField) return props.textField;
  const candidates = props.fields ? [...props.fields] : Object.keys(current.fields);
  const firstNonEmptyString = candidates.find((key) => typeof current.fields[key] === "string" && current.fields[key].trim() !== "");
  if (firstNonEmptyString) return firstNonEmptyString;
  const firstString = candidates.find((key) => typeof current.fields[key] === "string");
  if (firstString) return firstString;
  const firstText = candidates.find((key) => fieldText(current, key) !== "");
  return firstText ?? candidates[0] ?? null;
}

function preText(current: PlatformObjectRecord): string {
  const key = resolvePreFieldKey(current);
  if (key && key in current.fields) return fieldText(current, key);
  if (current.subtitle) return current.subtitle;
  return current.label;
}

function preAriaLabel(current: PlatformObjectRecord): string {
  const key = resolvePreFieldKey(current);
  return (key && current.fieldLabels?.[key]) || current.label || t("common.detail");
}

const result = computed(() => recordData.value as DataStateResult<PlatformObjectRecord>);
const labels = useDataStateLabels();
const resolvedEmptyText = computed(() => (props.emptyText ? panel.t(props.emptyText) : ""));
const resolvedMissingText = computed(() => (props.missingText ? panel.t(props.missingText) : ""));
const showArticleEmpty = computed(
  () => isArticle.value && Boolean(resolvedEmptyText.value) && result.value.status === "awaiting",
);
const showArticleMissing = computed(
  () =>
    isArticle.value
    && Boolean(resolvedMissingText.value)
    && result.value.status === "error"
    && !("unreachable" in recordData.value && recordData.value.unreachable),
);

watch(record, (found) => {
  if (!found) return;
  const ref = panelRecordObjectRef(found, objectType);
  panel.instance.nameObjects(ref.className, [found]);
}, { immediate: true });

const effectiveColumns = computed(() => Math.max(1, Math.floor(props.columns || 1)));
const summaryListStyle = computed(() =>
  effectiveColumns.value > 1
    ? ({ "--sdk-summary-columns": String(effectiveColumns.value) } as Record<string, string>)
    : undefined,
);

function fieldText(current: PlatformObjectRecord, name: string): string {
  return displayFieldText(current.fields[name], locale.value, t);
}

function isKeyValueField(name: string): boolean {
  return Boolean(props.keyValueFields?.includes(name));
}

function keyValueEntries(current: PlatformObjectRecord, name: string): readonly SummaryKeyValueEntry[] | null {
  if (!isKeyValueField(name)) return null;
  return extractSummaryKeyValueEntries(current.fields[name], t);
}

const copiedField = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
onBeforeUnmount(() => {
  if (copiedTimer !== null) clearTimeout(copiedTimer);
});

function isCopyableField(name: string): boolean {
  return Boolean(props.copyableFields?.includes(name));
}

function resolvedFieldText(current: PlatformObjectRecord, name: string): string {
  const text = fieldText(current, name);
  if (isCopyableField(name) && text.startsWith("#/") && typeof window !== "undefined") {
    return `${window.location.origin}${window.location.pathname}${text}`;
  }
  return text;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to a hidden textarea so plain-HTTP deployments can still copy.
  }
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

async function copyFieldValue(name: string, text: string) {
  if (!text) return;
  if (!(await copyText(text))) return;
  copiedField.value = name;
  if (copiedTimer !== null) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    if (copiedField.value === name) copiedField.value = null;
    copiedTimer = null;
  }, 1800);
}

/** A reference the reader followed is handed over at the output named for its field, or at `navigate`. */
function navigateTo(reference: PlatformFieldReference, fieldName: string) {
  const output = panel.manifest.members[slot.slot]?.outputs?.[fieldName] ? fieldName : "navigate";
  void panel.instance.output(slot.slot, output, { className: reference.className, primaryKey: reference.primaryKey });
  emit("navigate", reference, fieldName);
}

function navigateToChild(reference: PlatformChildFieldReference, fieldName: string) {
  emit("navigate-child", reference, fieldName);
}
</script>

<template>
  <div
    class="sdk-object-summary"
    :class="{
      'sdk-object-summary-article': isArticle,
      'sdk-object-summary-pre-mode': isPre,
      'sdk-object-summary-centered': showArticleEmpty || showArticleMissing,
      'sdk-object-summary-compact': density === 'compact',
    }"
    :data-density="density"
  >
    <div v-if="showArticleEmpty || showArticleMissing" class="sdk-object-summary-empty" role="status">
      <svg
        class="sdk-object-summary-empty-icon"
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 13h5l1.5 3h5L16 13h5"></path>
        <path d="M5.5 5.5 3 13v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5l-2.5-7.5a1 1 0 0 0-.95-.7H6.45a1 1 0 0 0-.95.7Z"></path>
      </svg>
      <p>{{ showArticleMissing ? resolvedMissingText : resolvedEmptyText }}</p>
    </div>
    <data-state v-else :result="result" :labels="labels">
      <template #default="{ value: current }">
        <pre
          v-if="isPre"
          class="sdk-object-summary-pre"
          tabindex="0"
          role="region"
          :aria-label="preAriaLabel(current)"
        >{{ preText(current) }}</pre>
        <template v-else-if="isArticle">
          <div class="sdk-object-summary-article-head">
            <h2 v-if="showTitle" class="sdk-object-summary-article-title">
              <template v-for="(part, index) in textHighlightSegments(current.label, current.highlights?.label)" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </h2>
            <span
              v-if="statusField && fieldText(current, statusField) !== ''"
              class="sdk-object-summary-tag sdk-object-summary-status-badge"
              :data-tone="current.tones?.[statusField] ?? 'default'"
            >{{ fieldText(current, statusField) }}</span>
          </div>
          <div v-if="tagsField && recordFieldArrayItems(current, tagsField).length" class="sdk-object-summary-article-tags">
            <template v-for="(item, itemIndex) in recordFieldArrayItems(current, tagsField)" :key="itemIndex">
              <button
                v-if="isRecordChildReference(item)"
                type="button"
                class="sdk-object-ref-link"
                @click="navigateToChild(toChildFieldReference(item), tagsField)"
              >
                {{ childReferenceDisplayLabel(item) }}
              </button>
              <button
                v-else-if="isRecordReference(item)"
                type="button"
                class="sdk-object-ref-link"
                @click="navigateTo(toFieldReference(item), tagsField)"
              >
                {{ referenceDisplayLabel(item) }}
              </button>
              <span v-else class="sdk-object-summary-tag" data-tone="info">{{ scalarFieldText(item, t) }}</span>
            </template>
          </div>
          <div v-if="bodyField" class="sdk-object-summary-article-body">
            <template v-for="(part, index) in textHighlightSegments(fieldText(current, bodyField), current.highlights?.[bodyField])" :key="index">
              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
            </template>
          </div>
          <dl
            v-if="articleExtraFields.length"
            class="sdk-object-summary-list sdk-object-summary-article-extra"
            :class="{ 'is-bordered': bordered, 'is-multi-col': effectiveColumns > 1 }"
            :style="summaryListStyle"
          >
            <template v-for="name in articleExtraFields" :key="name">
              <dt>{{ current.fieldLabels?.[name] ?? name }}</dt>
              <dd>
                <span v-if="isCopyableField(name) && resolvedFieldText(current, name) !== ''" class="sdk-object-summary-copyable">
                  <span class="sdk-object-summary-text sdk-object-summary-copyable-value">{{ resolvedFieldText(current, name) }}</span>
                  <button
                    type="button"
                    class="sdk-object-summary-copy-btn"
                    :class="{ copied: copiedField === name }"
                    :title="copiedField === name ? t('common.copied') : t('common.copy')"
                    :aria-label="copiedField === name ? t('common.copied') : t('common.copy')"
                    @click="void copyFieldValue(name, resolvedFieldText(current, name))"
                  >
                    <svg v-if="copiedField === name" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </span>
                <template v-else-if="keyValueEntries(current, name) !== null">
                  <dl v-if="keyValueEntries(current, name)!.length" class="sdk-object-summary-kv">
                    <template v-for="entry in keyValueEntries(current, name)!" :key="entry.key">
                      <dt>{{ entry.key }}</dt>
                      <dd>{{ entry.value }}</dd>
                    </template>
                  </dl>
                  <template v-else>—</template>
                </template>
                <template v-else>{{ fieldText(current, name) || "—" }}</template>
              </dd>
            </template>
          </dl>
        </template>
        <template v-else>
          <h3 v-if="showTitle" class="sdk-object-summary-title">
            <template v-for="(part, index) in textHighlightSegments(current.label, current.highlights?.label)" :key="index">
              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
            </template>
          </h3>
          <dl
            class="sdk-object-summary-list"
            :class="{ 'is-bordered': bordered, 'is-multi-col': effectiveColumns > 1 }"
            :style="summaryListStyle"
          >
            <template v-for="name in shown" :key="name">
              <dt>{{ current.fieldLabels?.[name] ?? name }}</dt>
              <dd>
                <button
                  v-if="isRecordChildReference(current.fields[name])"
                  type="button"
                  class="sdk-object-ref-link"
                  @click="navigateToChild(toChildFieldReference(current.fields[name]!), name)"
                >
                  <template v-for="(part, index) in textHighlightSegments(childReferenceDisplayLabel(current.fields[name]!), current.highlights?.[name])" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </button>
                <button
                  v-else-if="isRecordReference(current.fields[name])"
                  type="button"
                  class="sdk-object-ref-link"
                  @click="navigateTo(toFieldReference(current.fields[name]!), name)"
                >
                  <template v-for="(part, index) in textHighlightSegments(referenceDisplayLabel(current.fields[name]!), current.highlights?.[name])" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </button>
                <span v-else-if="recordFieldArrayItems(current, name).length" class="sdk-object-summary-tags">
                  <template v-for="(item, itemIndex) in recordFieldArrayItems(current, name)" :key="itemIndex">
                    <button
                      v-if="isRecordChildReference(item)"
                      type="button"
                      class="sdk-object-ref-link"
                      @click="navigateToChild(toChildFieldReference(item), name)"
                    >
                      {{ childReferenceDisplayLabel(item) }}
                    </button>
                    <button
                      v-else-if="isRecordReference(item)"
                      type="button"
                      class="sdk-object-ref-link"
                      @click="navigateTo(toFieldReference(item), name)"
                    >
                      {{ referenceDisplayLabel(item) }}
                    </button>
                    <span v-else class="sdk-object-summary-tag" data-tone="info">{{ scalarFieldText(item, t) }}</span>
                  </template>
                </span>
                <span
                  v-else-if="current.tones?.[name] && fieldText(current, name) !== ''"
                  class="sdk-object-summary-tag"
                  :data-tone="current.tones[name]"
                >
                  <template v-for="(part, index) in textHighlightSegments(fieldText(current, name), current.highlights?.[name])" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span v-else-if="isCopyableField(name) && resolvedFieldText(current, name) !== ''" class="sdk-object-summary-copyable">
                  <span class="sdk-object-summary-text sdk-object-summary-copyable-value">{{ resolvedFieldText(current, name) }}</span>
                  <button
                    type="button"
                    class="sdk-object-summary-copy-btn"
                    :class="{ copied: copiedField === name }"
                    :title="copiedField === name ? t('common.copied') : t('common.copy')"
                    :aria-label="copiedField === name ? t('common.copied') : t('common.copy')"
                    @click="void copyFieldValue(name, resolvedFieldText(current, name))"
                  >
                    <svg v-if="copiedField === name" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </span>
                <template v-else-if="keyValueEntries(current, name) !== null">
                  <dl v-if="keyValueEntries(current, name)!.length" class="sdk-object-summary-kv">
                    <template v-for="entry in keyValueEntries(current, name)!" :key="entry.key">
                      <dt>{{ entry.key }}</dt>
                      <dd>{{ entry.value }}</dd>
                    </template>
                  </dl>
                  <template v-else>—</template>
                </template>
                <span v-else-if="fieldText(current, name) !== ''" class="sdk-object-summary-text">
                  <template v-for="(part, index) in textHighlightSegments(fieldText(current, name), current.highlights?.[name])" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <template v-else>—</template>
              </dd>
            </template>
          </dl>
        </template>
      </template>
    </data-state>
  </div>
</template>

<style scoped>
.sdk-object-summary {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.sdk-object-summary-article,
.sdk-object-summary-pre-mode {
  flex: 0 0 auto;
  height: auto;
  overflow: visible;
}
.sdk-object-summary-pre {
  margin: 0;
  max-block-size: 55dvh;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  line-height: var(--leading-relaxed, 1.6);
}
.sdk-object-summary-pre:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.sdk-object-summary-centered {
  align-items: center;
  flex: 1 1 auto;
  justify-content: center;
  min-height: 240px;
}
.sdk-object-summary-empty {
  align-items: center;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-direction: column;
  font-size: var(--text-sm);
  gap: var(--spacing-sm);
  padding: var(--spacing-2xl) var(--spacing-lg);
  text-align: center;
}
.sdk-object-summary-empty p {
  margin: 0;
}
.sdk-object-summary-empty-icon {
  color: var(--el-text-color-placeholder);
  flex: none;
}
.sdk-object-summary-article-head {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  justify-content: space-between;
}
.sdk-object-summary-article-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  line-height: var(--leading-lg, 1.4);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sdk-object-summary-status-badge {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  line-height: 22px;
  padding: 2px var(--spacing-sm);
}
.sdk-object-summary-article-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-top: var(--spacing-md);
}
.sdk-object-summary-article-body {
  border-top: 1px solid var(--ui-divider);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: 1.8;
  margin-top: var(--spacing-md);
  padding-top: var(--spacing-md);
  white-space: pre-wrap;
  word-break: break-word;
}
.sdk-object-summary-article-extra {
  margin-top: var(--spacing-md);
}
.sdk-object-summary-list {
  display: grid;
  font-size: var(--text-sm);
  column-gap: var(--spacing-md, 16px);
  row-gap: 12px;
  grid-template-columns: repeat(var(--sdk-summary-columns, 1), minmax(0, 1fr) minmax(0, 2fr));
  margin: 0;
}
.sdk-object-summary-compact .sdk-object-summary-list {
  gap: var(--spacing-xs, 4px) var(--spacing-md, 16px);
  grid-template-columns: repeat(var(--sdk-summary-columns, 1), minmax(0, max-content) minmax(0, 1fr));
}
.sdk-object-summary-list > dt {
  color: var(--el-text-color-secondary);
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: break-word;
  word-break: break-word;
}
.sdk-object-summary-list > dd {
  color: var(--el-text-color-primary);
  line-height: 1.5;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.sdk-object-summary-list.is-bordered,
.sdk-object-summary-compact .sdk-object-summary-list.is-bordered {
  gap: 0;
  grid-template-columns: repeat(var(--sdk-summary-columns, 1), minmax(112px, max-content) minmax(0, 1fr));
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-sm, 4px);
  overflow: hidden;
}
.sdk-object-summary-list.is-bordered > dt {
  padding: 10px 12px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-weight: 500;
  border-right: 1px solid var(--el-border-color-lighter);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.sdk-object-summary-list.is-bordered > dd {
  padding: 10px 12px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  border-bottom: 1px solid var(--el-border-color-lighter);
  word-break: break-word;
}
.sdk-object-summary-list.is-bordered:not(.is-multi-col) > dt:nth-last-of-type(1),
.sdk-object-summary-list.is-bordered:not(.is-multi-col) > dd:last-of-type {
  border-bottom: 0;
}
.sdk-object-summary-list.is-bordered.is-multi-col {
  border-right: 0;
  border-bottom: 0;
}
.sdk-object-summary-list.is-bordered.is-multi-col > dd {
  border-right: 1px solid var(--el-border-color-lighter);
}
.sdk-object-summary-kv {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
  font-size: var(--text-sm);
}
.sdk-object-summary-kv > dt {
  color: var(--el-text-color-secondary);
}
.sdk-object-summary-kv > dd {
  margin: 0;
  min-width: 0;
  word-break: break-word;
}
/* An owner's text keeps its own line breaks: a knowledge item's body reads as its owner wrote it. */
.sdk-object-summary-text {
  white-space: pre-wrap;
}
.sdk-object-summary-copyable {
  align-items: flex-start;
  display: inline-flex;
  gap: var(--spacing-xs);
  max-width: 100%;
}
.sdk-object-summary-copyable-value {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-all;
}
.sdk-object-summary-copy-btn {
  align-items: center;
  background: transparent;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: inline-flex;
  flex: none;
  height: 24px;
  justify-content: center;
  padding: 0;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
  width: 24px;
}
.sdk-object-summary-copy-btn:hover {
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}
.sdk-object-summary-copy-btn.copied {
  border-color: var(--el-color-success-light-5);
  color: var(--el-color-success);
}
.sdk-object-summary-copy-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.sdk-object-summary-title {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  margin: 0 0 var(--spacing-sm);
}
.sdk-object-ref-link {
  background: none;
  border: 0;
  color: var(--brand-link);
  cursor: pointer;
  font-size: inherit;
  padding: 0;
  text-align: left;
}
.sdk-object-ref-link:hover {
  text-decoration: underline;
}
.sdk-object-summary-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
/* Tags are light fills: neutral, or a status's soft fill with its readable text colour. */
.sdk-object-summary-tag {
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--el-text-color-regular);
  display: inline-block;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  padding: 0 var(--spacing-xs);
}
.sdk-object-summary-tag[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info-text);
}
.sdk-object-summary-tag[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}
.sdk-object-summary-tag[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
}
.sdk-object-summary-tag[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}
mark {
  background: var(--el-color-warning-light-7);
  border-radius: var(--radius-xs);
  color: inherit;
  padding: 0 calc(var(--spacing-xs) / 4);
}
</style>
