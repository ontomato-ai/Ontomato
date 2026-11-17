<script setup lang="ts">
import { computed } from "vue";
import {dropdownBoundaryOptions} from '@ontomato/foundation-ui/overlay';
import { useI18n } from "vue-i18n";
import { FolderGit2, FolderPlus, Lock, MessageSquare, MoreHorizontal, SquarePen } from "lucide-vue-next";
import type { Workspace } from "@ontomato/contracts/workspaces";
import type { WorkspaceSessions } from "../column-sessions";
import { firstLine } from "../panel";
import type { LoadState } from "../workspace-view";

/**
 * The builder's column: its name, a new conversation, a new workspace, and the reader's workspaces. Any number of them
 * may be expanded at once, each listing its conversations. A workspace's row only expands or collapses it; its new
 * conversation button and its conversations open it, and the open workspace is marked. The column only says what the
 * reader asked for, the builder opens it. A workspace or conversation that a run occupies shows the running mark; the
 * rows' rhythm is the conversation column's.
 */
const props = defineProps<{
  workspaces: readonly Workspace[];
  workspacesState: LoadState;
  moreWorkspaces: boolean;
  /** The open workspace. */
  workspaceId: string | null;
  /** The expanded workspaces, each with the conversations it shows. */
  expanded: ReadonlyMap<string, WorkspaceSessions>;
  sessionId: string | null;
  /** The edition signs readers in, so a workspace is only its owner's. */
  privateWorkspaces: boolean;
}>();
const emit = defineEmits<{
  startConversation: [];
  createWorkspace: [];
  toggleWorkspace: [id: string];
  newConversation: [workspaceId: string];
  openSession: [workspaceId: string, sessionId: string];
  renameWorkspace: [workspace: Workspace];
  deleteWorkspace: [workspace: Workspace];
  moreWorkspaces: [];
  retryWorkspaces: [];
  moreSessions: [workspaceId: string];
  retrySessions: [workspaceId: string];
}>();
const { t } = useI18n();
/** Each listed workspace with its conversations, or null while it is collapsed. */
const rows = computed(() => props.workspaces.map((workspace) => ({ workspace, list: props.expanded.get(workspace.id) ?? null })));

function workspaceCommand(workspace: Workspace, command: "rename" | "delete") {
  if (command === "rename") emit("renameWorkspace", workspace);
  else emit("deleteWorkspace", workspace);
}
</script>

<template>
  <div class="builder-column">
    <div class="column-head">{{ t("appBuilder.title") }}</div>
    <button type="button" class="nav-item primary" @click="emit('startConversation')">
      <SquarePen :size="16" aria-hidden="true" />
      <span class="nav-label">{{ t("appBuilder.startConversation") }}</span>
    </button>
    <button type="button" class="nav-item" @click="emit('createWorkspace')">
      <FolderPlus :size="16" aria-hidden="true" />
      <span class="nav-label">{{ t("appBuilder.newWorkspace") }}</span>
    </button>

    <div class="section-title">
      <span>{{ t("appBuilder.workspaces") }}</span>
      <el-tooltip v-if="privateWorkspaces" :content="t('appBuilder.privateHint')" placement="top">
        <span class="private-mark" tabindex="0" :aria-label="t('appBuilder.privateHint')"><Lock :size="12" /></span>
      </el-tooltip>
    </div>

    <div v-if="workspacesState === 'loading' && workspaces.length === 0" class="skeleton" aria-busy="true">
      <span /><span /><span />
    </div>
    <div v-else-if="workspacesState === 'error'" class="column-note">
      {{ t("assistant.loadFailed") }}
      <button type="button" class="link" @click="emit('retryWorkspaces')">{{ t("common.retry") }}</button>
    </div>
    <div v-else-if="workspaces.length === 0" class="column-note">{{ t("appBuilder.noWorkspaces") }}</div>
    <ul v-else class="workspace-list">
      <li v-for="{ workspace, list } in rows" :key="workspace.id">
        <div class="row workspace-row" :class="{ current: workspace.id === workspaceId }">
          <button
            type="button"
            class="row-toggle"
            :aria-expanded="list !== null"
            :aria-current="workspace.id === workspaceId ? 'true' : undefined"
            @click="emit('toggleWorkspace', workspace.id)"
          >
            <FolderGit2 :size="16" aria-hidden="true" />
            <span class="row-label">{{ workspace.name }}</span>
            <span v-if="workspace.activeRunId" class="running" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="row-tool"
            :title="t('appBuilder.newConversation')"
            :aria-label="t('appBuilder.newConversationIn', { name: workspace.name })"
            @click="emit('newConversation', workspace.id)"
          >
            <SquarePen :size="15" aria-hidden="true" />
          </button>
          <el-dropdown trigger="click" placement="bottom-end" :popper-options="dropdownBoundaryOptions" @command="(command: 'rename' | 'delete') => workspaceCommand(workspace, command)">
            <button type="button" class="row-tool row-more" :aria-label="t('appBuilder.workspaceActions')"><MoreHorizontal :size="16" /></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename">{{ t("common.rename") }}</el-dropdown-item>
                <el-dropdown-item command="delete" class="app-builder-danger">{{ t("common.delete") }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <ul v-if="list" class="conversation-list">
          <li v-if="list.state === 'error'" class="column-note nested">
            {{ t("assistant.loadFailed") }}
            <button type="button" class="link" @click="emit('retrySessions', workspace.id)">{{ t("common.retry") }}</button>
          </li>
          <li v-else-if="list.state === 'loading' && list.sessions.length === 0" class="skeleton nested" aria-busy="true">
            <span />
          </li>
          <li v-else-if="list.sessions.length === 0" class="column-note nested">{{ t("assistant.noSessions") }}</li>
          <li v-for="session in list.sessions" :key="session.id">
            <button
              type="button"
              class="row conversation-row"
              :class="{ active: session.id === sessionId }"
              :aria-current="session.id === sessionId ? 'page' : undefined"
              @click="emit('openSession', workspace.id, session.id)"
            >
              <MessageSquare :size="14" aria-hidden="true" />
              <span class="row-label">{{ firstLine(session.title) || t("appBuilder.newConversation") }}</span>
              <span v-if="session.latestRun?.status === 'running'" class="running" aria-hidden="true" />
            </button>
          </li>
          <li v-if="list.more">
            <button
              type="button"
              class="row conversation-row more"
              :disabled="list.state === 'loading'"
              @click="emit('moreSessions', workspace.id)"
            >
              {{ t("assistant.more") }}
            </button>
          </li>
        </ul>
      </li>
      <li v-if="moreWorkspaces">
        <button type="button" class="row more" :disabled="workspacesState === 'loading'" @click="emit('moreWorkspaces')">
          {{ t("assistant.more") }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* The conversation column's rows (DESIGN.md "Navigation row"): 32px rows, the band's hover and selected tones. */
.builder-column {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 2px;
}
.column-head {
  display: flex;
  align-items: center;
  min-height: 36px;
  padding: 0 10px;
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.nav-item,
.row-toggle,
.conversation-row,
.more {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  height: var(--nav-row-height);
  padding: 0 10px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.nav-item svg,
.row svg {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.nav-item.primary svg {
  color: var(--brand-link);
}
.nav-item:hover,
.conversation-row:hover,
.more:hover:not(:disabled) {
  background: var(--shell-panel-hover);
  color: var(--el-text-color-primary);
}
.row-label,
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 10px 4px;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.private-mark {
  display: inline-flex;
  color: var(--el-text-color-placeholder);
  border-radius: var(--radius-xs);
  cursor: help;
}
.workspace-list,
.conversation-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.workspace-list {
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 8px;
}
.conversation-list {
  padding: 2px 0 8px;
}
.workspace-row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  transition: background-color var(--transition-fast);
}
.workspace-row:hover {
  background: var(--shell-panel-hover);
}
/* The open workspace: its name in the ink and weight of a selection, its icon in the link tone. */
.workspace-row.current .row-toggle {
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.workspace-row.current .row-toggle svg {
  color: var(--brand-link);
}
.row-toggle:hover {
  color: var(--el-text-color-primary);
}
/* The row's own buttons, a new conversation and the menu, show while the row is hovered or focused. */
.row-tool {
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  height: 28px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.row-more {
  margin-right: 2px;
}
.row-tool:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.workspace-row:hover .row-tool,
.workspace-row:focus-within .row-tool,
.row-more[aria-expanded="true"] {
  opacity: 1;
}
@media (hover: none) {
  .row-tool {
    opacity: 1;
  }
}
.conversation-row {
  padding-left: 32px;
}
.conversation-row.active {
  background: var(--shell-panel-selected);
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.conversation-row.active:hover {
  background: var(--shell-panel-selected-hover);
}
.more {
  color: var(--el-text-color-secondary);
}
.conversation-row.more {
  padding-left: 32px;
}
.more:disabled {
  cursor: default;
}
.running {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background: var(--el-color-primary);
  animation: breathe 1.6s ease-in-out infinite;
}
.column-note {
  padding: 6px 10px;
  color: var(--el-text-color-secondary);
}
.column-note.nested {
  padding-left: 32px;
}
.link {
  border: 0;
  background: none;
  color: var(--brand-link);
  font: inherit;
  cursor: pointer;
}
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 10px;
}
.skeleton span {
  height: 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--el-text-color-secondary) 15%, transparent);
}
.skeleton span:nth-child(2) {
  width: 70%;
}
.skeleton span:nth-child(3) {
  width: 85%;
}
/* A workspace's first read, as tall as one conversation row. */
.skeleton.nested {
  justify-content: center;
  height: var(--nav-row-height);
  padding: 0 10px 0 32px;
  box-sizing: border-box;
}
.skeleton.nested span {
  width: 60%;
}
.nav-item:focus-visible,
.row-toggle:focus-visible,
.row-tool:focus-visible,
.conversation-row:focus-visible,
.more:focus-visible,
.private-mark:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .running {
    animation: none;
  }
}
</style>

<style>
/* The menu is drawn in the page's overlay layer, outside this column. */
.el-dropdown-menu__item.app-builder-danger {
  color: var(--el-color-danger);
}
</style>
