<script setup lang="ts">
import { projectionElement } from "../panel/direct";
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import type { PanelChildObjectIdentity, PanelObjectIdentity, PanelStateValue } from "@ontomato/contracts/panel-manifest";
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
import { adapterPart, type PlatformObjectRecord, type PlatformObjectRef } from "../panel/platform-objects";
import { stateChildObject, stateObject } from "../panel/state";

type ObjectTreeSelection = PlatformObjectRef | PanelChildObjectIdentity;

/**
 * Projection-bound folder/file tree for path-bearing platform objects or declared child collections (such as files
 * inside a skill package). Reads items through the bound type's resource adapter (optionally scoped by `parentInput`
 * and `collection`), preserves opaque owner primary keys on file nodes, highlights the panel's current selected item,
 * and toggles folders without changing selection.
 */
const props = withDefaults(
  defineProps<{
    /** Slot input holding the selected item when `outputs.selected` is not declared. */
    input?: string;
    /** Slot input holding the parent object when listing a declared child collection. */
    parentInput?: string;
    /** Declared child collection name owned by the parent type (e.g. `"files"`). */
    collection?: string;
    /** Field in `record.fields` carrying the slash-separated path (falls back to `record.label`). */
    pathField?: string;
    /** Panel state fields cleared in the same atomic `setState` update when selection changes. */
    clears?: readonly string[];
    /** Select owner `defaultPrimaryKey` or first file in tree order when nothing in the result is selected. */
    fallbackToFirst?: boolean;
    /** Whether folders start expanded (default `true`). */
    defaultExpandAll?: boolean;
    /** Accessible tree name (`aria-label`), resolved through `panel.t`. */
    label?: string;
    /** Optional empty-state text, resolved through `panel.t`. */
    emptyText?: string;
  }>(),
  {
    input: undefined,
    parentInput: undefined,
    collection: undefined,
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
  "update:selected": [value: ObjectTreeSelection | null];
}>();

const slot = useProjectionSlot();
const panel = usePanelContext();
const objects = useProjectionObjects();
const objectType = projectionElement(slot.projection).id;

const records = shallowRef<readonly PlatformObjectRecord[]>([]);
const loading = ref(true);
const failure = shallowRef<Error | null>(null);

const selectedState = computed(() => {
  const output = slotOutputState(panel.manifest, slot.slot, "selected");
  if (output) return output;
  if (props.input) return slotInputState(panel.manifest, slot.slot, props.input);
  if (props.parentInput || props.collection) return slotInputState(panel.manifest, slot.slot, "selected");
  return slotInputState(panel.manifest, slot.slot);
});
const selectedField = computed(() => (selectedState.value ? panel.manifest.state[selectedState.value] : undefined));
const childCollection = computed<string | null>(() => {
  if (props.collection) return props.collection;
  return selectedField.value?.type.kind === "child-object" ? selectedField.value.type.collection : null;
});
const childMode = computed(() => Boolean(props.parentInput || childCollection.value));
const parentState = computed(
  () => (props.parentInput ? slotInputState(panel.manifest, slot.slot, props.parentInput) : null),
);
const parentRef = computed<PanelObjectIdentity | null>(() => {
  if (!parentState.value) return null;
  const value = stateObject(panel.instance.state.values.value[parentState.value]);
  return value && { objectType: value.className, primaryKey: value.primaryKey };
});
const parentIdentity = computed(() => (parentRef.value ? `${parentRef.value.objectType}\u0000${parentRef.value.primaryKey}` : ""));

const localSelected = shallowRef<ObjectTreeSelection | null>(null);

function selectionIdentity(value: ObjectTreeSelection | null): string | null {
  if (!value) return null;
  if ("parent" in value) return `child\u0000${value.parent.objectType}\u0000${value.parent.primaryKey}\u0000${value.primaryKey}`;
  return `${value.className}\u0000${value.primaryKey}`;
}

const chosenSelection = computed<ObjectTreeSelection | null>(() => {
  if (selectedState.value) {
    const value = panel.instance.state.values.value[selectedState.value];
    return stateChildObject(value) ?? stateObject(value);
  }
  return localSelected.value;
});

const chosenIdentity = computed(() => selectionIdentity(chosenSelection.value));

const chosen = computed<string | null>(() => {
  const value = chosenSelection.value;
  if (!value) return null;
  if (childMode.value) {
    if (!("parent" in value) || !parentRef.value) return null;
    return value.parent.objectType === parentRef.value.objectType && value.parent.primaryKey === parentRef.value.primaryKey
      ? value.primaryKey
      : null;
  }
  return value.primaryKey;
});

const treeItems = computed<readonly PathTreeItem[]>(() =>
  records.value.map((record) => ({
    key: record.primaryKey,
    path: record.fields[props.pathField] || record.label,
  })),
);

function makeSelection(primaryKey: string): ObjectTreeSelection {
  if (childMode.value && parentRef.value) {
    return { parent: parentRef.value, primaryKey };
  }
  return { className: objectType, primaryKey };
}

function setSelected(next: ObjectTreeSelection | null) {
  if (selectedState.value) {
    const changed = selectionIdentity(next) !== chosenIdentity.value;
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
  if (childMode.value && !parentRef.value) {
    records.value = [];
    loading.value = false;
    return;
  }
  if (childMode.value) {
    try {
      adapterPart(objectType, "query");
    } catch (reason: unknown) {
      failure.value = reason instanceof Error ? reason : new Error(String(reason));
      loading.value = false;
      return;
    }
  }
  void objects.query(
    childMode.value
      ? { ...(parentRef.value ? { parent: parentRef.value } : {}), ...(childCollection.value ? { collection: childCollection.value } : {}) }
      : {},
  ).then(
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
          const next = fallbackKey ? makeSelection(fallbackKey) : null;
          if (selectionIdentity(next) !== chosenIdentity.value) setSelected(next);
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
  setSelected(makeSelection(file.key));
}

onMounted(load);
watch(parentIdentity, () => {
  if (childMode.value) load();
});
useProjectionObjectRefresh(() => true, load);
</script>

<template>
  <div class="sdk-object-tree">
    <p v-if="failure" role="alert" class="sdk-object-tree-error">{{ failure.message }}</p>
    <el-skeleton v-else-if="loading" :rows="3" animated></el-skeleton>
    <el-empty v-else-if="!treeItems.length" :description="emptyText ? panel.t(emptyText) : undefined" :image-size="48"></el-empty>
    <PathTree
      v-else
      :items="treeItems"
      :selected-key="chosen"
      :default-expand-all="defaultExpandAll"
      :label="label ? panel.t(label) : undefined"
      :empty-text="emptyText ? panel.t(emptyText) : undefined"
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
