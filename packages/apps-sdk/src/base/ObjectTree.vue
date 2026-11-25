<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { firstTreeFile, buildPathTree, PathTree, type PathTreeItem } from "@ontomato/foundation-ui/tree";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelRecordFieldText } from "@ontomato/contracts/panel-projection";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { useDataStateLabels } from "./data-state-labels";
import { readConfigString } from "./localized-text";

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
    /** Preferred file key to auto-select when nothing is selected and the file exists in `files`. */
    defaultKey?: string;
    /** With nothing selected, select the first file in tree order when `defaultKey` is unset or absent. */
    fallbackToFirst?: boolean;
    /** The panel's message key for what an empty tree says. */
    emptyText?: string;
    /** The panel's message key for the tree's accessible name. */
    label?: string;
    /** Whether to show a local search filter box above the tree (bound to public state `search`). */
    searchable?: boolean;
    /** Optional panel message key for the search box placeholder. */
    searchPlaceholder?: string;
    /** Optional panel message key shown when the search matches no files. */
    noMatchText?: string;
    /** Optional direct child filename (e.g. `"index.md"`) selected when clicking a directory node. */
    directoryIndexFile?: string;
  }>(),
  {
    pathField: "path",
    defaultKey: undefined,
    fallbackToFirst: false,
    emptyText: undefined,
    label: undefined,
    searchable: false,
    searchPlaceholder: undefined,
    noMatchText: undefined,
    directoryIndexFile: undefined,
  },
);

const { locale, t } = useI18n();
const panel = usePanelContext();
const member = useMember();
const files = useMemberData("files");
/** The selected file's key: the panel state the placement binds, else the tree's own. */
const selected = useMemberParam("selected");
/** The search keyword: bound to panel public state when wired so readers and agents share it. */
const search = useMemberParam("search");

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});
const effectiveDirectoryIndexFile = computed<string | undefined>(() => {
  const value = props.directoryIndexFile ?? readConfigString(rawConfig.value, "directoryIndexFile", "directory-index-file");
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
});

const records = computed(() => (files.value.status === "ready" ? (files.value.value as unknown as PlatformObjectRecord[]) : []));
const items = computed<readonly PathTreeItem[]>(() =>
  records.value.map((record) => ({
    key: record.primaryKey,
    path: panelRecordFieldText(record.fields[props.pathField], locale.value) || record.primaryKey,
    label: record.label,
  })));
const selectedKey = computed(() => (typeof selected.value.value === "string" ? selected.value.value : null));
const searchText = computed(() => (typeof search.value.value === "string" ? search.value.value : ""));

/**
 * Each time the owner answers with the files and nothing is selected (`selectedKey === null`), auto-select `defaultKey`
 * if present in `files`, otherwise the first file in tree order when `fallbackToFirst` is enabled. Once a selection is
 * present (from a deep link, user click, or `present({ selected, filePath })`), never overwrite or clear it even when
 * absent from `files`, so a paired reader can report the missing file in place.
 */
const answered = computed(() => files.value.status === "ready" || files.value.status === "empty");
watch([items, answered], ([next, isAnswered]) => {
  if (!isAnswered || selectedKey.value !== null) return;
  const preferred = props.defaultKey && records.value.some((record) => record.primaryKey === props.defaultKey)
    ? props.defaultKey
    : null;
  const fallback = preferred ?? (props.fallbackToFirst && next.length ? firstTreeFile(buildPathTree(next))?.key ?? null : null);
  if (fallback !== null) selected.set(fallback);
}, { immediate: true });

function onSelect(key: string | null) {
  selected.set(key);
}

function onSearch(value: string) {
  search.set(value);
}

const labels = useDataStateLabels(props.emptyText ? () => panel.t(props.emptyText!) : undefined);
</script>

<template>
  <div class="sdk-object-tree">
    <data-state :result="files as DataStateResult" :labels="labels">
      <PathTree
        :items="items"
        :selected-key="selectedKey"
        :label="label ? panel.t(label) : undefined"
        :searchable="searchable"
        :search="searchText"
        :search-placeholder="searchPlaceholder ? panel.t(searchPlaceholder) : t('common.search')"
        :no-match-text="noMatchText ? panel.t(noMatchText) : undefined"
        :directory-index-file="effectiveDirectoryIndexFile"
        @update:selected-key="onSelect"
        @update:search="onSearch"
      />
    </data-state>
  </div>
</template>

<style scoped>
.sdk-object-tree {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
</style>
