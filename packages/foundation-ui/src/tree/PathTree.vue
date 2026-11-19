<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PathTreeNodeItem from "./PathTreeNode.vue";
import { buildPathTree, type PathTreeFile, type PathTreeItem, type PathTreeNode } from "./types";

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
  }>(),
  {
    selectedKey: null,
    label: undefined,
    defaultExpandAll: true,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when a reader clicks a file node. */
  select: [file: PathTreeFile];
  /** Emitted with the clicked file's key for `v-model:selectedKey`. */
  "update:selectedKey": [key: string];
}>();

const tree = computed(() => buildPathTree(props.items));
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
</script>

<template>
  <div class="fui-path-tree">
    <p v-if="!tree.length && emptyText" class="fui-path-tree-empty">{{ emptyText }}</p>
    <ul v-else role="tree" class="fui-path-tree-root" :aria-label="label">
      <PathTreeNodeItem
        v-for="node in tree"
        :key="node.key"
        :node="node"
        :depth="0"
        :selected-key="selectedKey"
        :collapsed="collapsed"
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
