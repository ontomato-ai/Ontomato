<script setup lang="ts">
import { projectionElement } from "../panel/projection-element";
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMemberData } from "../panel/member";
import type { PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";
import { textHighlightSegments } from "./text-highlight";

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

const { t } = useI18n();
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
  const references = record.value?.references ?? {};
  const present = (name: string) => name in fields || name in tags || name in references;
  return (props.fields ?? Object.keys(fields)).filter(present);
});

const result = computed(() => recordData.value as DataStateResult<PlatformObjectRecord>);
const labels = computed(() => ({
  empty: t("platform.dataEmpty"),
  forbidden: t("platform.dataForbidden"),
  awaiting: t("platform.dataAwaiting"),
}));

watch(record, (found) => {
  if (found) panel.instance.nameObjects(found.className ?? objectType, [found]);
}, { immediate: true });

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
                v-if="current.references?.[name]"
                type="button"
                class="sdk-object-ref-link"
                @click="navigateTo(current.references[name]!, name)"
              >
                <template v-for="(part, index) in textHighlightSegments(current.references[name]!.label, current.highlights?.[name])" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </button>
              <span
                v-else-if="current.tones?.[name] && current.fields[name]"
                class="sdk-object-summary-tag"
                :data-tone="current.tones[name]"
              >
                <template v-for="(part, index) in textHighlightSegments(current.fields[name]!, current.highlights?.[name])" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-else-if="current.tags?.[name]?.length" class="sdk-object-summary-tags">
                <span v-for="tag in current.tags[name]" :key="tag" class="sdk-object-summary-tag" data-tone="info">{{ tag }}</span>
              </span>
              <span v-else-if="current.fields[name]" class="sdk-object-summary-text">
                <template v-for="(part, index) in textHighlightSegments(current.fields[name]!, current.highlights?.[name])" :key="index">
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
dl {
  display: grid;
  gap: 4px 12px;
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
  font-size: 14px;
  margin: 0 0 8px;
}
.sdk-object-ref-link {
  background: none;
  border: 0;
  color: var(--el-color-primary);
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
  gap: 4px;
}
.sdk-object-summary-tag {
  background: var(--el-fill-color-light);
  border-radius: 4px;
  color: var(--el-text-color-regular);
  display: inline-block;
  font-size: 11px;
  line-height: 1.4;
  padding: 1px 6px;
}
.sdk-object-summary-tag[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
}
.sdk-object-summary-tag[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}
.sdk-object-summary-tag[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}
.sdk-object-summary-tag[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
mark {
  background: var(--el-color-warning-light-7, #f8e3c5);
  border-radius: 2px;
  color: inherit;
  padding: 0 1px;
}
</style>
