<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { firstTreeFile, buildPathTree, PathTree, type PathTreeItem } from "@ontomato/foundation-ui/tree";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext } from "../panel/context";
import { useMemberData, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";

/**
 * The files of one object — a skill package's, say — as a folder/file tree, read through its owner's `files` read (the
 * platform's one read entry): each owner record is one file, at the path its `pathField` gives (its own key by
 * default). Clicking a file selects it: `selected` is that file's key, which the placement can bind to the panel's
 * state for another member to read the file by. Folders open and close; they are not selected.
 */
const props = withDefaults(
  defineProps<{
    /** The field of each owner record that holds its slash-separated path; absent or empty, the record's own key. */
    pathField?: string;
    /** With nothing selected, select the first file in tree order. */
    fallbackToFirst?: boolean;
    /** The panel's message key for what an empty tree says. */
    emptyText?: string;
    /** The panel's message key for the tree's accessible name. */
    label?: string;
  }>(),
  { pathField: "path", fallbackToFirst: false, emptyText: undefined, label: undefined },
);

const { t } = useI18n();
const panel = usePanelContext();
const files = useMemberData("files");
/** The selected file's key: the panel state the placement binds, else the tree's own. */
const selected = useMemberParam("selected");

const records = computed(() => (files.value.status === "ready" ? (files.value.value as unknown as PlatformObjectRecord[]) : []));
const items = computed<readonly PathTreeItem[]>(() =>
  records.value.map((record) => ({ key: record.primaryKey, path: record.fields[props.pathField] || record.primaryKey, label: record.label })));
const selectedKey = computed(() => (typeof selected.value.value === "string" ? selected.value.value : null));

// With nothing selected, the first file is, when the placement asks for it.
watch(items, (next) => {
  if (!props.fallbackToFirst || selectedKey.value !== null || next.length === 0) return;
  const first = firstTreeFile(buildPathTree(next));
  if (first) selected.set(first.key);
}, { immediate: true });

function onSelect(key: string) {
  selected.set(key);
}

const labels = computed(() => ({ empty: props.emptyText ? panel.t(props.emptyText) : t("platform.dataEmpty"), forbidden: t("platform.dataForbidden"), awaiting: t("platform.dataAwaiting") }));
</script>

<template>
  <div class="sdk-object-tree">
    <data-state :result="files as DataStateResult" :labels="labels">
      <PathTree :items="items" :selected-key="selectedKey" :label="label ? panel.t(label) : undefined" @update:selected-key="onSelect" />
    </data-state>
  </div>
</template>
