<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import {
  slotOutputState,
  slotState,
  usePanelContext,
  useProjectionObjectRefresh,
  useProjectionObjects,
  useProjectionSlot,
} from "../panel/context";
import { useMember, useMemberData } from "../panel/member";
import {
  selectedKey,
  type PlatformFieldReference,
  type PlatformObjectRecord,
} from "../panel/platform-objects";
import { textHighlightSegments } from "./text-highlight";

/**
 * One platform object as a few facts a reader recognises it by. In a directly rendered panel the instance supplies its
 * `record` datum through the host read port; in a panel frame the bound type's resource adapter reads it. Which facts
 * are shown, and in what order, is the projection's configuration; what each holds is the object's owner's. Safe range
 * highlights, status tags, tag lists and clickable reference links follow the same record contract as `ObjectList`.
 */
const props = defineProps<{
  /** The facts to show, by the owner's field name, in this order; absent shows all of them in the owner's order. */
  fields?: readonly string[];
  /** The slot input whose panel state names the object; the first, by default. */
  input?: string;
}>();

const emit = defineEmits<{
  /** Emitted when a reader clicks a reference field carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, fieldName: string];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const objectType = slot.projection.binding.id;
const member = useMember();
/** In a directly rendered panel, the summary is the member's `record` datum, read by the instance. */
const recordData = member ? useMemberData("record") : null;

const frameRecord = shallowRef<PlatformObjectRecord | null>(null);
const frameLoading = ref(true);
const frameFailure = shallowRef<Error | null>(null);
const frameKey = computed(() =>
  recordData ? null : selectedKey(panel.instance.state.values.value[slotState(panel.manifest, slot.slot, props.input)]),
);

const record = computed<PlatformObjectRecord | null>(() => {
  if (!recordData) return frameRecord.value;
  return recordData.value.status === "ready" ? (recordData.value.value as unknown as PlatformObjectRecord) : null;
});

const shown = computed(() => {
  const fields = record.value?.fields ?? {};
  const tags = record.value?.tags ?? {};
  const references = record.value?.references ?? {};
  const present = (name: string) => name in fields || name in tags || name in references;
  return (props.fields ?? Object.keys(fields)).filter(present);
});

const result = computed<DataStateResult<PlatformObjectRecord>>(() => {
  if (recordData) return recordData.value as DataStateResult<PlatformObjectRecord>;
  if (frameFailure.value) return { status: "error", message: frameFailure.value.message };
  if (frameLoading.value) return { status: "loading" };
  if (!frameKey.value) return { status: "awaiting" };
  return frameRecord.value ? { status: "ready", value: frameRecord.value } : { status: "empty" };
});
const labels = computed(() => ({
  empty: t("platform.dataEmpty"),
  forbidden: t("platform.dataForbidden"),
  awaiting: t("platform.dataAwaiting"),
}));

if (recordData) {
  watch(record, (found) => {
    if (found) panel.instance.nameObjects(found.className ?? objectType, [found]);
  }, { immediate: true });
} else {
  const objects = useProjectionObjects();
  let requestSeq = 0;

  const load = (primaryKey: string | null) => {
    const seq = ++requestSeq;
    frameFailure.value = null;
    if (!primaryKey) {
      frameRecord.value = null;
      frameLoading.value = false;
      return;
    }
    frameLoading.value = true;
    void objects.read(primaryKey).then(
      (found) => {
        if (seq !== requestSeq) return;
        frameRecord.value = found;
        frameLoading.value = false;
      },
      (reason: unknown) => {
        if (seq !== requestSeq) return;
        frameFailure.value = reason instanceof Error ? reason : new Error(String(reason));
        frameLoading.value = false;
      },
    );
  };

  onMounted(() => load(frameKey.value));
  watch(frameKey, (next) => load(next));
  useProjectionObjectRefresh((id) => id === frameKey.value, () => load(frameKey.value));
}

function navigateTo(reference: PlatformFieldReference, fieldName: string) {
  const targetState =
    slotOutputState(panel.manifest, slot.slot, fieldName)
    ?? slotOutputState(panel.manifest, slot.slot, "navigate");
  if (targetState) {
    panel.instance.state.set(targetState, { className: reference.className, primaryKey: reference.primaryKey });
  }
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
              <template v-else-if="current.fields[name]">
                <template v-for="(part, index) in textHighlightSegments(current.fields[name]!, current.highlights?.[name])" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </template>
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
