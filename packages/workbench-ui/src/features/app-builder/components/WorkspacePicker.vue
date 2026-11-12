<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Check, ChevronDown, FolderGit2, FolderPlus } from "lucide-vue-next";
import type { Workspace } from "@ontomato/contracts/workspaces";

/**
 * With a blank conversation's composer: the workspace the conversation is going to belong to, the open one by default.
 * Choosing another asks the builder for that workspace's blank conversation; choosing a new workspace asks for one to be
 * created first. It shows the host's workspaces and keeps no choice of its own. When squeezed, the name is cut short and
 * the button keeps its icons.
 */
const props = defineProps<{ workspaces: readonly Workspace[]; workspaceId: string }>();
const emit = defineEmits<{ select: [id: string]; create: [] }>();
const { t } = useI18n();
/** The open workspace is in the host's list unless that list has not reached it yet. */
const name = computed(() => props.workspaces.find((workspace) => workspace.id === props.workspaceId)?.name ?? "");
const label = computed(() => t("appBuilder.composerWorkspace", { name: name.value }));
</script>

<template>
  <el-dropdown class="workspace-picker" trigger="click" placement="top-start" max-height="320px">
    <button type="button" class="picker-trigger" :title="label" :aria-label="label">
      <FolderGit2 :size="13" aria-hidden="true" />
      <span class="picker-name">{{ name }}</span>
      <ChevronDown :size="13" aria-hidden="true" />
    </button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="workspace in workspaces"
          :key="workspace.id"
          class="app-builder-workspace-option"
          :aria-current="workspace.id === workspaceId ? 'true' : undefined"
          @click="emit('select', workspace.id)"
        >
          <FolderGit2 :size="14" aria-hidden="true" />
          <span class="option-name">{{ workspace.name }}</span>
          <Check v-if="workspace.id === workspaceId" :size="14" class="option-check" aria-hidden="true" />
        </el-dropdown-item>
        <el-dropdown-item divided class="app-builder-workspace-option" @click="emit('create')">
          <FolderPlus :size="14" aria-hidden="true" />
          <span class="option-name">{{ t("appBuilder.newWorkspace") }}</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
/* A chip like what the message carries; its middle track may shrink to nothing, so the name is cut before the icons. */
.picker-trigger {
  display: inline-grid;
  grid-template-columns: auto minmax(0, auto) auto;
  align-items: center;
  column-gap: 5px;
  max-width: 100%;
  height: 24px;
  padding: 0 7px 0 9px;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-full);
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.picker-trigger:hover {
  border-color: var(--el-border-color);
  color: var(--el-text-color-primary);
}
.picker-trigger:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.picker-trigger svg {
  color: var(--el-text-color-secondary);
}
.picker-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<style>
/* The menu is drawn in the page's overlay layer, outside this picker: an icon, the name cut short, the current mark. */
.el-dropdown-menu__item.app-builder-workspace-option {
  gap: 8px;
}
.app-builder-workspace-option svg {
  flex-shrink: 0;
}
.app-builder-workspace-option .option-name {
  flex: 1;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-builder-workspace-option .option-check {
  margin-left: 4px;
  color: var(--brand-link);
}
</style>
