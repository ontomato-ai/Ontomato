<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PathTreeNodeItem from "./PathTreeNode.vue";
import {
  buildParentTree,
  buildPathTree,
  filterPathTree,
  type ParentTreeItem,
  type PathTreeFile,
  type PathTreeItem,
  type PathTreeNode,
} from "./types";

/**
 * Folder/file tree (`mode="path"`) or parent-linked object hierarchy (`mode="hierarchy"`).
 * In path mode, folders appear before files, siblings sort by name, and folders are expanded by default; when
 * `selectableFolders` is enabled, record-backed folders can be selected independently of their disclosure chevron.
 * In hierarchy mode, sibling input order is preserved, every node (parent or leaf) is selectable, and the chevron
 * expands/collapses children without changing selection.
 */
const props = withDefaults(
  defineProps<{
    /** Flat path items (`mode="path"`) or parent-linked items (`mode="hierarchy"`). */
    items: readonly (PathTreeItem | ParentTreeItem)[];
    /** Tree mode: `"path"` for slash-separated paths, `"hierarchy"` for parent-linked object trees. */
    mode?: "path" | "hierarchy";
    /** Key of the currently selected node (highlighted whenever it matches a selectable node). */
    selectedKey?: string | null;
    /** Accessible name of the tree (`aria-label`). */
    label?: string;
    /** Whether branches/folders start expanded (default `true`). */
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
    /** Optional direct child filename (e.g. `"index.md"`) opened automatically when clicking a folder node in path mode. */
    directoryIndexFile?: string;
    /** In path mode, allow selecting record-backed folder nodes while keeping the disclosure chevron dedicated to folding. */
    selectableFolders?: boolean;
  }>(),
  {
    mode: "path",
    selectedKey: null,
    label: undefined,
    defaultExpandAll: true,
    emptyText: undefined,
    searchable: false,
    search: "",
    searchPlaceholder: undefined,
    noMatchText: undefined,
    directoryIndexFile: undefined,
    selectableFolders: false,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader selects a file or hierarchy node. */
  select: [file: PathTreeFile];
  /** Emitted with the selected node's key (or `null` when cleared by clicking a folder without an index file). */
  "update:selectedKey": [key: string | null];
  /** Emitted when the reader updates the search keyword. */
  "update:search": [value: string];
}>();

const isHierarchy = computed(() => props.mode === "hierarchy");
const tree = computed(() =>
  isHierarchy.value
    ? buildParentTree(props.items as readonly ParentTreeItem[])
    : buildPathTree(props.items as readonly PathTreeItem[], { mergeFolderItems: props.selectableFolders }),
);
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

function findFolderNode(nodes: readonly PathTreeNode[], path: string): PathTreeNode | null {
  for (const node of nodes) {
    if (node.kind === "folder") {
      if (node.path === path) return node;
      if (node.children) {
        const found = findFolderNode(node.children, path);
        if (found) return found;
      }
    }
  }
  return null;
}

function findDirectoryIndexFile(folderPath: string): PathTreeFile | null {
  const indexFile = props.directoryIndexFile?.trim().replace(/^\/+/, "");
  if (!indexFile) return null;
  const folder = findFolderNode(tree.value, folderPath);
  if (!folder?.children?.length) return null;
  const expectedPath = `${folder.path}/${indexFile}`;
  const match = folder.children.find((child) => child.kind === "file" && child.path === expectedPath);
  return match ? { key: match.key, path: match.path, label: match.label } : null;
}

function toggleFolder(path: string) {
  if (!isHierarchy.value && !props.selectableFolders) {
    const indexFileName = props.directoryIndexFile?.trim();
    if (indexFileName) {
      const indexFile = findDirectoryIndexFile(path);
      if (indexFile) {
        if (collapsed.value.has(path)) {
          const next = new Set(collapsed.value);
          next.delete(path);
          collapsed.value = next;
        }
        pickFile(indexFile);
        return;
      }
      const next = new Set(collapsed.value);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      collapsed.value = next;
      emit("update:selectedKey", null);
      return;
    }
  }
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
  <div class="fui-path-tree" :class="{ 'fui-path-tree--hierarchy': isHierarchy }">
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
        :mode="mode"
        :selectable-folders="selectableFolders"
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
