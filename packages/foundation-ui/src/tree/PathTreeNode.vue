<script setup lang="ts">
import type { PathTreeFile, PathTreeNode } from "./types";

defineOptions({ name: "PathTreeNodeItem" });

defineProps<{
  node: PathTreeNode;
  depth: number;
  selectedKey: string | null;
  collapsed: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  toggle: [path: string];
  select: [file: PathTreeFile];
}>();
</script>

<template>
  <li
    role="treeitem"
    class="fui-path-tree-item"
    :data-kind="node.kind"
    :data-path="node.path"
    :aria-expanded="node.kind === 'folder' ? !collapsed.has(node.path) : undefined"
    :aria-selected="node.kind === 'file' ? node.key === selectedKey : undefined"
  >
    <button
      type="button"
      class="fui-path-tree-row"
      :class="{ selected: node.kind === 'file' && node.key === selectedKey }"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      @click="node.kind === 'folder' ? emit('toggle', node.path) : emit('select', { key: node.key, path: node.path, label: node.label })"
    >
      <svg
        v-if="node.kind === 'folder' && !collapsed.has(node.path)"
        class="fui-path-tree-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path fill="none" stroke="currentColor" stroke-width="1.3" d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.2 1.5h5A1.5 1.5 0 0 1 14 6v1H3.2L2 12.5V4.5Zm1.2 2.5h11.3l-1.2 5.5H2L3.2 7Z" />
      </svg>
      <svg
        v-else-if="node.kind === 'folder'"
        class="fui-path-tree-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path fill="none" stroke="currentColor" stroke-width="1.3" d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.2 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
      </svg>
      <svg
        v-else
        class="fui-path-tree-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path fill="none" stroke="currentColor" stroke-width="1.3" d="M4 2.5h5.2L12.5 5.8V13a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm5 0V6h3.5" />
      </svg>
      <span class="fui-path-tree-name">{{ node.label }}</span>
    </button>
    <ul
      v-if="node.kind === 'folder' && node.children?.length && !collapsed.has(node.path)"
      role="group"
      class="fui-path-tree-group"
    >
      <PathTreeNodeItem
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        :depth="depth + 1"
        :selected-key="selectedKey"
        :collapsed="collapsed"
        @toggle="emit('toggle', $event)"
        @select="emit('select', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
.fui-path-tree-item {
  list-style: none;
}
.fui-path-tree-group {
  list-style: none;
  margin: 0;
  padding: 0;
}
.fui-path-tree-row {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  color: var(--el-text-color-regular);
  cursor: pointer;
  display: flex;
  font-family: var(--font-mono, monospace);
  font-size: var(--text-xs, 12px);
  gap: 6px;
  min-height: 28px;
  padding: 4px 8px;
  text-align: left;
  width: 100%;
}
.fui-path-tree-row:hover {
  background: var(--el-fill-color-light);
}
.fui-path-tree-row.selected {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}
.fui-path-tree-icon {
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.fui-path-tree-row.selected .fui-path-tree-icon {
  color: var(--el-color-primary);
}
.fui-path-tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
