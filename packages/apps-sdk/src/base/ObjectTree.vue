<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { PanelStateValue } from "@ontomato/contracts/panel-manifest";
import { ElEmpty } from "element-plus/es/components/empty/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { buildPathTree, firstTreeFile, PathTree, type PathTreeFile, type PathTreeItem } from "@ontomato/foundation-ui/tree";
import {
  slotInputState,
  slotOutputState,
  usePanelContext,
  useProjectionObjectRefresh,
  useProjectionObjects,
  useProjectionSlot,
} from "../panel/context";
import { adapterPart, selectedKey, type PlatformObjectRecord, type PlatformObjectRef } from "../panel/platform-objects";
import { stateObject } from "../panel/state";

/**
 * Projection-bound folder/file tree for path-bearing platform objects (such as files inside a package).
 * Reads items through the bound type's resource adapter (optionally scoped by `parentInput`), preserves opaque
 * owner primary keys on file nodes, highlights the panel's current selected object, and toggles folders without
 * changing selection.
 */
const props = withDefaults(
  defineProps<{
    /** Slot input holding the selected object when `outputs.selected` is not declared. */
    input?: string;
    /** Slot input holding the parent object when listing child items of a selected parent. */
    parentInput?: string;
    /** Field in `record.fields` carrying the slash-separated path (falls back to `record.label`). */
    pathField?: string;
    /** Panel state fields cleared in the same atomic `setState` update when selection changes. */
    clears?: readonly string[];
    /** Select owner `defaultPrimaryKey` or first file in tree order when nothing in the result is selected. */
    fallbackToFirst?: boolean;
    /** Whether folders start expanded (default `true`). */
    defaultExpandAll?: boolean;
    /** Accessible tree name (`aria-label`). */
    label?: string;
    /** Optional empty-state text. */
    emptyText?: string;
  }>(),
  {
    input: undefined,
    parentInput: undefined,
    pathField: "path",
    clears: undefined,
    fallbackToFirst: false,
    defaultExpandAll: true,
    label: undefined,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader picks a file node. */
  "update:selected": [value: PlatformObjectRef | null];
}>();

const slot = useProjectionSlot();
const panel = usePanelContext();
const objects = useProjectionObjects();
const objectType = slot.projection.binding.id;

const records = shallowRef<readonly PlatformObjectRecord[]>([]);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);

const selectedState = computed(
  () => slotOutputState(panel.manifest, slot.slot, "selected")
    ?? slotInputState(panel.manifest, slot.slot, props.input),
);
const parentState = computed(
  () => (props.parentInput ? slotInputState(panel.manifest, slot.slot, props.parentInput) : null),
);
const parentRef = computed<PlatformObjectRef | null>(() => {
  if (!parentState.value) return null;
  const value = stateObject(panel.instance.state.values.value[parentState.value]);
  return value && { className: value.className, primaryKey: value.primaryKey };
});
const parentIdentity = computed(() => (parentRef.value ? `${parentRef.value.className}\u0000${parentRef.value.primaryKey}` : ""));

const localSelected = shallowRef<PlatformObjectRef | null>(null);
const chosen = computed<string | null>(() => {
  if (selectedState.value) return selectedKey(panel.instance.state.values.value[selectedState.value]);
  return localSelected.value?.primaryKey ?? null;
});

const treeItems = computed<readonly PathTreeItem[]>(() =>
  records.value.map((record) => ({
    key: record.primaryKey,
    path: record.fields[props.pathField] || record.label,
  })),
);

function setSelected(next: PlatformObjectRef | null) {
  if (selectedState.value) {
    const changed = (next?.primaryKey ?? null) !== chosen.value;
    if (changed && props.clears?.length) {
      const patch: Record<string, PanelStateValue> = { [selectedState.value]: next };
      for (const field of props.clears) patch[field] = null;
      panel.instance.state.setState(patch);
    } else {
      panel.instance.state.set(selectedState.value, next);
    }
  } else {
    localSelected.value = next;
  }
  emit("update:selected", next);
}

let requestSeq = 0;

function load() {
  const seq = ++requestSeq;
  failure.value = null;
  if (props.parentInput && !parentRef.value) {
    records.value = [];
    loading.value = false;
    return;
  }
  if (props.parentInput) {
    try {
      adapterPart(objectType, "query");
    } catch (reason: unknown) {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
      return;
    }
  }
  void objects.query(parentRef.value ? { parent: parentRef.value } : {}).then(
    (result) => {
      if (seq !== requestSeq) return;
      records.value = result.items;
      loading.value = false;

      if (props.fallbackToFirst) {
        const stillVisible = chosen.value !== null && result.items.some((item) => item.primaryKey === chosen.value);
        if (!stillVisible) {
          const preferred = result.defaultPrimaryKey
            ? result.items.find((item) => item.primaryKey === result.defaultPrimaryKey)
            : undefined;
          const fallbackKey = preferred?.primaryKey
            ?? firstTreeFile(buildPathTree(treeItems.value))?.key
            ?? null;
          const next = fallbackKey ? { className: objectType, primaryKey: fallbackKey } : null;
          if ((next?.primaryKey ?? null) !== chosen.value) setSelected(next);
        }
      }
    },
    (reason: unknown) => {
      if (seq !== requestSeq) return;
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
    },
  );
}

function onSelect(file: PathTreeFile) {
  setSelected({ className: objectType, primaryKey: file.key });
}

onMounted(load);
watch(parentIdentity, () => {
  if (props.parentInput) load();
});
useProjectionObjectRefresh(() => true, load);
</script>

<template>
  <div class="sdk-object-tree">
    <p v-if="failure" role="alert" class="sdk-object-tree-error">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="3" animated></el-skeleton>
    <el-empty v-else-if="!treeItems.length" :description="emptyText" :image-size="48"></el-empty>
    <PathTree
      v-else
      :items="treeItems"
      :selected-key="chosen"
      :default-expand-all="defaultExpandAll"
      :label="label"
      :empty-text="emptyText"
      @select="onSelect"
    />
  </div>
</template>

<style scoped>
.sdk-object-tree-error {
  color: var(--el-color-danger);
  margin: 0;
}
</style>
