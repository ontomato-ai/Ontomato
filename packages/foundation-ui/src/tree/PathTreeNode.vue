<script setup lang="ts">
import { computed } from "vue";
import type { PathTreeFile, PathTreeNode } from "./types";

defineOptions({ name: "PathTreeNodeItem" });

const props = withDefaults(
  defineProps<{
    node: PathTreeNode;
    depth: number;
    selectedKey: string | null;
    collapsed: ReadonlySet<string>;
    mode?: "path" | "hierarchy";
    selectableFolders?: boolean;
  }>(),
  {
    mode: "path",
    selectableFolders: false,
  },
);

const emit = defineEmits<{
  toggle: [path: string];
  select: [file: PathTreeFile];
}>();

const isHierarchy = computed(() => props.mode === "hierarchy");
const hasChildren = computed(() => Boolean(props.node.children?.length));
const isBranch = computed(() => props.node.kind === "folder");
const isExpanded = computed(() => !props.collapsed.has(props.node.path));
const usesSplitRow = computed(() => isHierarchy.value || props.selectableFolders);
const isSelectable = computed(() => {
  if (isHierarchy.value) return true;
  if (props.node.kind === "file") return true;
  return props.selectableFolders && props.node.selectable !== false;
});
const isSelected = computed(() => isSelectable.value && props.node.key === props.selectedKey);

function onBodyClick() {
  if (isSelectable.value) {
    emit("select", { key: props.node.key, path: props.node.path, label: props.node.label });
  } else {
    emit("toggle", props.node.path);
  }
}
</script>

<template>
  <li
    role="treeitem"
    class="fui-path-tree-item"
    :data-kind="node.kind"
    :data-key="node.key"
    :data-path="node.path"
    :aria-expanded="isBranch ? isExpanded : undefined"
    :aria-selected="isSelectable ? isSelected : undefined"
  >
    <div
      v-if="usesSplitRow"
      class="fui-path-tree-row fui-path-tree-row--split"
      :class="{
        'fui-path-tree-row--hierarchy': isHierarchy,
        selected: isSelected,
      }"
      :style="{ paddingLeft: `${depth * (isHierarchy ? 18 : 14) + 6}px` }"
    >
      <button
        v-if="hasChildren"
        type="button"
        class="fui-path-tree-toggle"
        :class="{ expanded: isExpanded }"
        :aria-label="isExpanded ? 'Collapse' : 'Expand'"
        :aria-expanded="isExpanded"
        @click.stop="emit('toggle', node.path)"
      >
        <svg class="fui-path-tree-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path fill="currentColor" d="M4.2 2.5L8.5 6L4.2 9.5Z" />
        </svg>
      </button>
      <span v-else class="fui-path-tree-toggle-spacer" aria-hidden="true" />
      <button
        type="button"
        class="fui-path-tree-body"
        @click="onBodyClick"
      >
        <template v-if="!isHierarchy">
          <svg
            v-if="isBranch && isExpanded"
            class="fui-path-tree-icon"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path fill="none" stroke="currentColor" stroke-width="1.3" d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.2 1.5h5A1.5 1.5 0 0 1 14 6v1H3.2L2 12.5V4.5Zm1.2 2.5h11.3l-1.2 5.5H2L3.2 7Z" />
          </svg>
          <svg
            v-else-if="isBranch"
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
        </template>
        <span class="fui-path-tree-name">{{ node.label }}</span>
        <span v-if="node.subtitle" class="fui-path-tree-subtitle">{{ node.subtitle }}</span>
      </button>
    </div>
    <button
      v-else
      type="button"
      class="fui-path-tree-row"
      :class="{ selected: isSelected }"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      @click="isBranch ? emit('toggle', node.path) : emit('select', { key: node.key, path: node.path, label: node.label })"
    >
      <svg
        v-if="isBranch && isExpanded"
        class="fui-path-tree-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path fill="none" stroke="currentColor" stroke-width="1.3" d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.2 1.5h5A1.5 1.5 0 0 1 14 6v1H3.2L2 12.5V4.5Zm1.2 2.5h11.3l-1.2 5.5H2L3.2 7Z" />
      </svg>
      <svg
        v-else-if="isBranch"
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
      v-if="hasChildren && isExpanded"
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
        :mode="mode"
        :selectable-folders="selectableFolders"
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
  box-sizing: border-box;
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
.fui-path-tree-row--split {
  gap: 2px;
  padding: 2px 6px 2px 6px;
}
.fui-path-tree-row--hierarchy {
  font-family: var(--font-sans, inherit);
  font-size: var(--text-sm, 14px);
  min-height: 30px;
}
.fui-path-tree-row:hover {
  background: var(--el-fill-color-light);
}
.fui-path-tree-row.selected {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}
.fui-path-tree-toggle {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs, 3px);
  color: var(--el-text-color-placeholder, var(--el-text-color-secondary));
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
  height: 22px;
  justify-content: center;
  padding: 0;
  width: 22px;
}
.fui-path-tree-toggle:hover {
  color: var(--el-text-color-primary);
}
.fui-path-tree-chevron {
  transition: transform 0.15s ease;
}
.fui-path-tree-toggle.expanded .fui-path-tree-chevron {
  transform: rotate(90deg);
}
.fui-path-tree-toggle-spacer {
  display: inline-block;
  flex-shrink: 0;
  height: 22px;
  width: 22px;
}
.fui-path-tree-body {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  font: inherit;
  gap: 6px;
  min-height: 26px;
  min-width: 0;
  padding: 2px 4px;
  text-align: left;
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
.fui-path-tree-subtitle {
  color: var(--el-text-color-secondary);
  flex-shrink: 1;
  font-size: var(--text-xs, 12px);
  font-weight: 400;
  margin-left: 4px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fui-path-tree-row.selected .fui-path-tree-subtitle {
  color: var(--el-color-primary);
  opacity: 0.8;
}
</style>
