<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PathTreeNodeItem from "./PathTreeNode.vue";
import { buildPathTree, filterPathTree, type PathTreeFile, type PathTreeItem, type PathTreeNode } from "./types";

/**
 * Folder/file tree built from a flat list of slash-separated paths: folders appear before files, siblings sort by name,
 * and folders are expanded by default. Clicking a folder only collapses or expands it; clicking a file emits its key
 * and path without storing business selection internally.
 */
const props = withDefaults(
  defineProps<{
    /** Flat path strings or `{ key, path, label? }` items to arrange into a folder/file tree. */
    items: readonly PathTreeItem[];
    /** Key of the currently selected file row (highlighted whenever it matches a file node). */
    selectedKey?: string | null;
    /** Accessible name of the tree (`aria-label`). */
    label?: string;
    /** Whether folders start expanded (default `true`). */
    defaultExpandAll?: boolean;
    /** Optional empty-state text when `items` is empty. */
    emptyText?: string;
    /** Whether to render a local text filter input above the tree. */
    searchable?: boolean;
    /** Current filter keyword when `searchable` is enabled (controlled via `v-model:search`). */
    search?: string;
    /** Optional placeholder for the search input. */
    searchPlaceholder?: string;
    /** Optional empty-state text when search matches no items. */
    noMatchText?: string;
  }>(),
  {
    selectedKey: null,
    label: undefined,
    defaultExpandAll: true,
    emptyText: undefined,
    searchable: false,
    search: "",
    searchPlaceholder: undefined,
    noMatchText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks a file node. */
  select: [file: PathTreeFile];
  /** Emitted with the clicked file's key for `v-model:selectedKey`. */
  "update:selectedKey": [key: string];
  /** Emitted when the reader updates the search keyword. */
  "update:search": [value: string];
}>();

const tree = computed(() => buildPathTree(props.items));
const activeSearch = computed(() => (props.search ?? "").trim());
const visibleTree = computed(() => (activeSearch.value ? filterPathTree(tree.value, activeSearch.value) : tree.value));
const collapsed = ref<ReadonlySet<string>>(new Set());

function collectFolders(nodes: readonly PathTreeNode[], target: Set<string>) {
  for (const node of nodes) {
    if (node.kind === "folder") {
      target.add(node.path);
      if (node.children) collectFolders(node.children, target);
    }
  }
}

watch(
  [tree, () => props.defaultExpandAll],
  ([nodes, expandAll]) => {
    if (expandAll) {
      collapsed.value = new Set();
    } else {
      const folders = new Set<string>();
      collectFolders(nodes, folders);
      collapsed.value = folders;
    }
  },
  { immediate: true },
);

const effectiveCollapsed = computed<ReadonlySet<string>>(() => (activeSearch.value ? new Set() : collapsed.value));

function toggleFolder(path: string) {
  const next = new Set(collapsed.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsed.value = next;
}

function pickFile(file: PathTreeFile) {
  emit("update:selectedKey", file.key);
  emit("select", file);
}

function onSearchInput(event: Event) {
  emit("update:search", (event.target as HTMLInputElement).value);
}

function clearSearch() {
  emit("update:search", "");
}
</script>

<template>
  <div class="fui-path-tree">
    <div v-if="searchable" class="fui-path-tree-search">
      <input
        type="search"
        class="fui-path-tree-search-input"
        :value="search"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder || label"
        @input="onSearchInput"
      />
      <button
        v-if="search"
        type="button"
        class="fui-path-tree-search-clear"
        aria-label="Clear"
        @click="clearSearch"
      >
        ×
      </button>
    </div>
    <p v-if="!tree.length && emptyText" class="fui-path-tree-empty">{{ emptyText }}</p>
    <p v-else-if="!visibleTree.length" class="fui-path-tree-empty">{{ noMatchText || emptyText }}</p>
    <ul v-else role="tree" class="fui-path-tree-root" :aria-label="label">
      <PathTreeNodeItem
        v-for="node in visibleTree"
        :key="node.key"
        :node="node"
        :depth="0"
        :selected-key="selectedKey"
        :collapsed="effectiveCollapsed"
        @toggle="toggleFolder"
        @select="pickFile"
      />
    </ul>
  </div>
</template>

<style scoped>
.fui-path-tree {
  min-width: 0;
}
.fui-path-tree-search {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: var(--spacing-sm, 8px);
}
.fui-path-tree-search-input {
  width: 100%;
  box-sizing: border-box;
  height: 30px;
  padding: 0 26px 0 10px;
  border: 1px solid var(--ui-border, var(--el-border-color));
  border-radius: var(--radius-sm, 6px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-xs, 12px);
  outline: none;
}
.fui-path-tree-search-input:focus {
  border-color: var(--el-color-primary);
}
.fui-path-tree-search-clear {
  position: absolute;
  right: 6px;
  border: 0;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
}
.fui-path-tree-search-clear:hover {
  color: var(--el-text-color-primary);
}
.fui-path-tree-root {
  list-style: none;
  margin: 0;
  padding: 0;
}
.fui-path-tree-empty {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  margin: 0;
  padding: 8px;
}
</style>
