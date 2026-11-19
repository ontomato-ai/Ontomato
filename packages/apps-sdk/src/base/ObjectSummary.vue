<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import {
  slotOutputState,
  slotState,
  usePanelContext,
  useProjectionObjectRefresh,
  useProjectionObjects,
  useProjectionSlot,
} from "../panel/context";
import {
  selectedKey,
  type PlatformFieldReference,
  type PlatformObjectRecord,
} from "../panel/platform-objects";
import { textHighlightSegments } from "./text-highlight";

/**
 * One platform object as a few facts a reader recognises it by. Which facts are shown, and in what order, is the
 * projection's `display`; what each holds is the object's owner's. Safe range highlights, status tags, tag lists and
 * clickable reference links follow the same record contract as `ObjectList`.
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

const slot = useProjectionSlot();
const panel = usePanelContext();
const objects = useProjectionObjects();
const record = shallowRef<PlatformObjectRecord | null>(null);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);

// The object this summary is about: the panel state its slot's input is filled from, so a panel never passes a state name.
const key = computed(() => selectedKey(panel.instance.state.values.value[slotState(panel.manifest, slot.slot, props.input)]));
const shown = computed(() => {
  const fields = record.value?.fields ?? {};
  const tags = record.value?.tags ?? {};
  const references = record.value?.references ?? {};
  const present = (name: string) => name in fields || name in tags || name in references;
  return (props.fields ?? Object.keys(fields)).filter(present);
});

function load(primaryKey: string | null) {
  if (!primaryKey) {
    record.value = null;
    loading.value = false;
    return;
  }
  loading.value = true;
  void objects.read(primaryKey).then(
    (found) => {
      record.value = found;
      loading.value = false;
    },
    (reason: unknown) => {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
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

onMounted(() => load(key.value));
watch(key, (next) => load(next));
useProjectionObjectRefresh(id => id === key.value, () => load(key.value));
</script>

<template>
  <div class="sdk-object-summary">
    <p v-if="failure" role="alert">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="2" animated></el-skeleton>
    <el-empty v-else-if="!record" :image-size="48"></el-empty>
    <template v-else>
      <h3 class="sdk-object-summary-title">
        <template v-for="(part, index) in textHighlightSegments(record.label, record.highlights?.label)" :key="index">
          <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
        </template>
      </h3>
      <dl>
        <template v-for="name in shown" :key="name">
          <dt>{{ record.fieldLabels?.[name] ?? name }}</dt>
          <dd>
            <button
              v-if="record.references?.[name]"
              type="button"
              class="sdk-object-ref-link"
              @click="navigateTo(record.references[name]!, name)"
            >
              <template v-for="(part, index) in textHighlightSegments(record.references[name]!.label, record.highlights?.[name])" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </button>
            <span
              v-else-if="record.tones?.[name] && record.fields[name]"
              class="sdk-object-summary-tag"
              :data-tone="record.tones[name]"
            >
              <template v-for="(part, index) in textHighlightSegments(record.fields[name]!, record.highlights?.[name])" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span v-else-if="record.tags?.[name]?.length" class="sdk-object-summary-tags">
              <span v-for="tag in record.tags[name]" :key="tag" class="sdk-object-summary-tag" data-tone="info">{{ tag }}</span>
            </span>
            <template v-else-if="record.fields[name]">
              <template v-for="(part, index) in textHighlightSegments(record.fields[name]!, record.highlights?.[name])" :key="index">
                <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
              </template>
            </template>
            <template v-else>—</template>
          </dd>
        </template>
      </dl>
    </template>
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
