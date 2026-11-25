<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  buildParentTree,
  buildPathTree,
  firstTreeFile,
  firstTreeNode,
  PathTree,
  type ParentTreeItem,
  type PathTreeItem,
} from "@ontomato/foundation-ui/tree";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelRecordFieldText, type PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { usePanelContext } from "../panel/context";
import { useMember, useMemberData, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import { readConfigString } from "./localized-text";

/**
 * Renders either a slash-separated folder/file tree (`files` + `pathField`) or a parent-linked object hierarchy
 * (`rows` or `files` + `parentField`). Clicking a selectable node writes its primary key string — or its object
 * reference `{ className, primaryKey }` when `selected` binds object state — to the panel's `selected` state.
 */
const props = withDefaults(
  defineProps<{
    /** The field of each owner record that holds its slash-separated path; absent or empty, the record's own key. */
    pathField?: string;
    /** Optional field holding each record's parent key (string scalar or reference); enables parent-linked hierarchy mode. */
    parentField?: string;
    /** In path mode, allow selecting record-backed folder nodes while keeping the disclosure chevron dedicated to folding. */
    selectableFolders?: boolean;
    /** Preferred record key to auto-select when nothing is selected and the record exists in the loaded data. */
    defaultKey?: string;
    /** With nothing selected, select the first node in tree order when `defaultKey` is unset or absent. */
    fallbackToFirst?: boolean;
    /** The panel's message key for what an empty tree says. */
    emptyText?: string;
    /** The panel's message key for the tree's accessible name. */
    label?: string;
    /** Whether to show a local search filter box above the tree (bound to public state `search`). */
    searchable?: boolean;
    /** Optional panel message key for the search box placeholder. */
    searchPlaceholder?: string;
    /** Optional panel message key shown when the search matches no items. */
    noMatchText?: string;
    /** Optional direct child filename (e.g. `"index.md"`) selected when clicking a directory node in path mode. */
    directoryIndexFile?: string;
  }>(),
  {
    pathField: "path",
    parentField: undefined,
    selectableFolders: undefined,
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
const declaredData = member.projection.data ?? {};
const hasRowsDatum = Object.hasOwn(declaredData, "rows");
const hasFilesDatum = Object.hasOwn(declaredData, "files");
const rowsData = hasRowsDatum ? useMemberData("rows") : null;
const filesData = hasFilesDatum || !hasRowsDatum ? useMemberData("files") : null;
const sourceData = computed(() => {
  if (rowsData && (!filesData || rowsData.value.status === "ready" || filesData.value.status !== "ready")) {
    return rowsData.value;
  }
  return filesData!.value;
});

/** The selected record's key or object reference: the panel state the placement binds, else the tree's own. */
const selected = useMemberParam("selected");
/** The search keyword: bound to panel public state when wired so readers and agents share it. */
const search = useMemberParam("search");

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});

function readConfigBoolean(
  config: Readonly<Record<string, unknown>> | undefined,
  ...keys: readonly string[]
): boolean | undefined {
  if (!config) return undefined;
  for (const key of keys) {
    if (typeof config[key] === "boolean") return config[key];
  }
  return undefined;
}

const effectiveParentField = computed<string | undefined>(() => {
  const value = props.parentField ?? readConfigString(rawConfig.value, "parentField", "parent-field");
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
});
const effectiveSelectableFolders = computed<boolean>(() =>
  props.selectableFolders ?? readConfigBoolean(rawConfig.value, "selectableFolders", "selectable-folders") ?? false,
);
const effectiveDirectoryIndexFile = computed<string | undefined>(() => {
  const value = props.directoryIndexFile ?? readConfigString(rawConfig.value, "directoryIndexFile", "directory-index-file");
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
});
const isHierarchyMode = computed(() => effectiveParentField.value !== undefined);

function extractParentKey(value: PanelRecordFieldValue | undefined): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ((value.kind === "reference" || value.kind === "child-reference") && typeof value.primaryKey === "string") {
      const trimmed = value.primaryKey.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

const records = computed(() =>
  sourceData.value.status === "ready" ? (sourceData.value.value as unknown as PlatformObjectRecord[]) : [],
);
const recordsByKey = computed(() => {
  const map = new Map<string, PlatformObjectRecord>();
  for (const record of records.value) {
    if (!map.has(record.primaryKey)) map.set(record.primaryKey, record);
  }
  return map;
});

const pathItems = computed<readonly PathTreeItem[]>(() =>
  records.value.map((record) => ({
    key: record.primaryKey,
    path: panelRecordFieldText(record.fields[props.pathField], locale.value) || record.primaryKey,
    label: record.label,
  })),
);
const hierarchyItems = computed<readonly ParentTreeItem[]>(() => {
  const fieldName = effectiveParentField.value;
  if (!fieldName) return [];
  return records.value.map((record) => ({
    key: record.primaryKey,
    parentKey: extractParentKey(record.fields[fieldName]),
    label: record.label,
    ...(record.subtitle ? { subtitle: record.subtitle } : {}),
  }));
});
const treeItems = computed<readonly (PathTreeItem | ParentTreeItem)[]>(() =>
  isHierarchyMode.value ? hierarchyItems.value : pathItems.value,
);

const selectedOutputPort = computed(() => member.projection.outputs?.selected);
const selectedBindingType = computed<string | undefined>(() => {
  const port = selectedOutputPort.value;
  if (port?.kind === "object") return port.objectType;
  const current = stateObject(selected.value.value as PanelFieldValue | undefined);
  return current?.className;
});
const isObjectSelection = computed<boolean>(() => {
  if (selectedOutputPort.value?.kind === "object") return true;
  return stateObject(selected.value.value as PanelFieldValue | undefined) !== null;
});

const selectedKey = computed<string | null>(() => {
  const current = selected.value.value;
  if (typeof current === "string") return current;
  return stateObject(current as PanelFieldValue | undefined)?.primaryKey ?? null;
});
const searchText = computed(() => (typeof search.value.value === "string" ? search.value.value : ""));

function writeSelection(key: string | null, source: "human" | "auto" = "human") {
  const writeOptions = { source };
  if (key === null) {
    selected.set(null, writeOptions);
    return;
  }
  const record = recordsByKey.value.get(key);
  if (isObjectSelection.value) {
    const className = record?.className || selectedBindingType.value;
    if (className) {
      selected.set({ className, primaryKey: record?.primaryKey ?? key }, writeOptions);
      return;
    }
  }
  selected.set(record?.primaryKey ?? key, writeOptions);
}

/**
 * Each time the owner answers and nothing is selected (`selectedKey === null`), auto-select `defaultKey` if present,
 * otherwise the first node in depth-first tree order when `fallbackToFirst` is enabled. Once a selection is present
 * (from a deep link, user click, or `present(...)`), never overwrite or clear it even when absent from the loaded data,
 * so a paired reader or detail panel can report the missing target in place.
 */
const answered = computed(() => sourceData.value.status === "ready" || sourceData.value.status === "empty");
watch([treeItems, answered], ([next, isAnswered]) => {
  if (!isAnswered || selectedKey.value !== null) return;
  const preferred = props.defaultKey && recordsByKey.value.has(props.defaultKey)
    ? props.defaultKey
    : null;
  let fallback = preferred;
  if (fallback === null && props.fallbackToFirst && next.length) {
    if (isHierarchyMode.value) {
      fallback = firstTreeNode(buildParentTree(hierarchyItems.value))?.key ?? null;
    } else if (effectiveSelectableFolders.value) {
      fallback = firstTreeNode(buildPathTree(pathItems.value, { mergeFolderItems: true }))?.key ?? null;
    } else {
      fallback = firstTreeFile(buildPathTree(pathItems.value))?.key ?? null;
    }
  }
  if (fallback !== null) writeSelection(fallback, "auto");
}, { immediate: true });

function onSelect(key: string | null) {
  writeSelection(key, "human");
}

function onSearch(value: string) {
  search.set(value);
}

const labels = useDataStateLabels(props.emptyText ? () => panel.t(props.emptyText!) : undefined);
</script>

<template>
  <div class="sdk-object-tree">
    <data-state :result="sourceData as DataStateResult" :labels="labels">
      <PathTree
        :items="treeItems"
        :mode="isHierarchyMode ? 'hierarchy' : 'path'"
        :selected-key="selectedKey"
        :label="label ? panel.t(label) : undefined"
        :searchable="searchable"
        :search="searchText"
        :search-placeholder="searchPlaceholder ? panel.t(searchPlaceholder) : t('common.search')"
        :no-match-text="noMatchText ? panel.t(noMatchText) : undefined"
        :directory-index-file="isHierarchyMode ? undefined : effectiveDirectoryIndexFile"
        :selectable-folders="effectiveSelectableFolders"
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
