<script setup lang="ts">
import { projectionElement } from "../panel/projection-element";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { panelRecordObjectRef } from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMemberData } from "../panel/member";
import type { PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";
import {
  displayFieldText,
  isRecordReference,
  recordFieldArrayItems,
  referenceDisplayLabel,
  scalarFieldText,
  toFieldReference,
} from "./record-field";
import { textHighlightSegments } from "./text-highlight";
import { useDataStateLabels } from "./data-state-labels";

/**
 * One platform object as a few facts a reader recognises it by: the member's `record` datum, which the instance reads
 * through the platform in its document and through this release's resource module in a panel's frame. Which facts
 * are shown, and in what order, is the projection's configuration; what each holds is the object's owner's. Safe range
 * highlights, status tags, tag lists and clickable reference links follow the same record contract as `ObjectList`.
 */
const props = defineProps<{
  /**
   * The owner's fields to show, by field name, in this order; absent, every field the owner's record gives, in its order.
   * A field the owner gives a tone for (`tones`) is drawn as a coloured tag, a tag list (`tags`) as tags and a reference as
   * a link the page hears as `navigate`; any other is text, its line breaks kept.
   */
  fields?: readonly string[];
}>();

const emit = defineEmits<{
  /** Emitted when a reader clicks a reference field carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, fieldName: string];
}>();

const { t, locale } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = projectionElement(slot.projection).id;
/** The summary is the member's `record` datum, read by the instance: in a panel's frame and in the platform's document. */
const recordData = useMemberData("record");

const record = computed<PlatformObjectRecord | null>(() =>
  recordData.value.status === "ready" ? (recordData.value.value as unknown as PlatformObjectRecord) : null);

const shown = computed(() => {
  const fields = record.value?.fields ?? {};
  const tags = record.value?.tags ?? {};
  const present = (name: string) => name in fields || name in tags;
  const keys = props.fields ?? [...new Set([...Object.keys(fields), ...Object.keys(tags)])];
  return keys.filter(present);
});

const result = computed(() => recordData.value as DataStateResult<PlatformObjectRecord>);
const labels = useDataStateLabels();

watch(record, (found) => {
  if (!found) return;
  const ref = panelRecordObjectRef(found, objectType);
  panel.instance.nameObjects(ref.className, [found]);
}, { immediate: true });

function fieldText(current: PlatformObjectRecord, name: string): string {
  return displayFieldText(current.fields[name], locale.value, t);
}

/** A reference the reader followed is handed over at the output named for its field, or at `navigate`. */
function navigateTo(reference: PlatformFieldReference, fieldName: string) {
  const output = panel.manifest.members[slot.slot]?.outputs?.[fieldName] ? fieldName : "navigate";
  void panel.instance.output(slot.slot, output, { className: reference.className, primaryKey: reference.primaryKey });
  emit("navigate", reference, fieldName);
}
</script>

<template>
  <div class="sdk-object-summary">
    <data-state :result="result" :labels="labels">
      <template #default="{ value: current }">
        <h3 class="sdk-object-summary-title">
          <template v-for="(part, index) in textHighlightSegments(current.label, current.highlights?.label)" :key="index">
            <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
          </template>
        </h3>
        <dl>
          <template v-for="name in shown" :key="name">
            <dt>{{ current.fieldLabels?.[name] ?? name }}</dt>
            <dd>
              <button
                v-if="isRecordReference(current.fields[name])"
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
                    v-if="isRecordReference(item)"
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
dl {
  display: grid;
  font-size: var(--text-sm);
  gap: var(--spacing-xs) var(--spacing-md);
  grid-template-columns: auto 1fr;
  margin: 0;
}
dt {
  color: var(--el-text-color-secondary);
}
dd {
  margin: 0;
}
/* An owner's text keeps its own line breaks: a knowledge item's body reads as its owner wrote it. */
.sdk-object-summary-text {
  white-space: pre-wrap;
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
