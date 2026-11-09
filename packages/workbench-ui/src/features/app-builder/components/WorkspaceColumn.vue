<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { FolderGit2, FolderPlus, Lock, MessageSquare, MoreHorizontal, Plus } from "lucide-vue-next";
import type { AgentHostSession } from "@ontomato/contracts/agent-host";
import type { Workspace } from "@ontomato/contracts/workspaces";
import { firstLine } from "../panel";
import type { LoadState } from "../workspace-view";

/**
 * The builder's column: its name, a new workspace, the reader's workspaces, and under the open one its conversations.
 * A workspace or conversation that a run occupies shows the running mark; the rows' rhythm is the conversation column's.
 */
defineProps<{
  workspaces: readonly Workspace[];
  workspacesState: LoadState;
  moreWorkspaces: boolean;
  workspaceId: string | null;
  sessions: readonly AgentHostSession[];
  sessionsState: LoadState;
  moreSessions: boolean;
  sessionId: string | null;
  /** The edition signs readers in, so a workspace is only its owner's. */
  privateWorkspaces: boolean;
}>();
const emit = defineEmits<{
  createWorkspace: [];
  selectWorkspace: [id: string];
  renameWorkspace: [workspace: Workspace];
  deleteWorkspace: [workspace: Workspace];
  moreWorkspaces: [];
  retryWorkspaces: [];
  newConversation: [];
  selectSession: [id: string];
  moreSessions: [];
  retrySessions: [];
}>();
const { t } = useI18n();

function workspaceCommand(workspace: Workspace, command: "rename" | "delete") {
  if (command === "rename") emit("renameWorkspace", workspace);
  else emit("deleteWorkspace", workspace);
}
</script>

<template>
  <div class="builder-column">
    <div class="column-head">{{ t("appBuilder.title") }}</div>
    <button type="button" class="nav-item primary" @click="emit('createWorkspace')">
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
      <li v-for="workspace in workspaces" :key="workspace.id">
        <div class="row workspace-row" :class="{ open: workspace.id === workspaceId }">
          <button
            type="button"
            class="row-open"
            :aria-expanded="workspace.id === workspaceId"
            @click="emit('selectWorkspace', workspace.id)"
          >
            <FolderGit2 :size="16" aria-hidden="true" />
            <span class="row-label">{{ workspace.name }}</span>
            <span v-if="workspace.activeRunId" class="running" aria-hidden="true" />
          </button>
          <el-dropdown trigger="click" placement="bottom-end" @command="(command: 'rename' | 'delete') => workspaceCommand(workspace, command)">
            <button type="button" class="row-more" :aria-label="t('appBuilder.workspaceActions')"><MoreHorizontal :size="16" /></button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="rename">{{ t("common.rename") }}</el-dropdown-item>
                <el-dropdown-item command="delete" class="app-builder-danger">{{ t("common.delete") }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <ul v-if="workspace.id === workspaceId" class="conversation-list">
          <li v-if="sessionsState === 'error'" class="column-note nested">
            {{ t("assistant.loadFailed") }}
            <button type="button" class="link" @click="emit('retrySessions')">{{ t("common.retry") }}</button>
          </li>
          <li v-for="session in sessions" :key="session.id">
            <button
              type="button"
              class="row conversation-row"
              :class="{ active: session.id === sessionId }"
              :aria-current="session.id === sessionId ? 'page' : undefined"
              @click="emit('selectSession', session.id)"
            >
              <MessageSquare :size="14" aria-hidden="true" />
              <span class="row-label">{{ firstLine(session.title) || t("appBuilder.newConversation") }}</span>
              <span v-if="session.latestRun?.status === 'running'" class="running" aria-hidden="true" />
            </button>
          </li>
          <li v-if="moreSessions">
            <button type="button" class="row conversation-row more" :disabled="sessionsState === 'loading'" @click="emit('moreSessions')">
              {{ t("assistant.more") }}
            </button>
          </li>
          <li>
            <button
              type="button"
              class="row conversation-row new"
              :class="{ active: sessionId === null }"
              @click="emit('newConversation')"
            >
              <Plus :size="14" aria-hidden="true" />
              <span class="row-label">{{ t("appBuilder.newConversation") }}</span>
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
.row-open,
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
.workspace-row.open .row-open {
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.workspace-row.open .row-open svg {
  color: var(--brand-link);
}
.row-open:hover {
  color: var(--el-text-color-primary);
}
.row-more {
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  height: 28px;
  margin-right: 2px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.row-more:hover {
  background: var(--el-fill-color-light);
}
.workspace-row:hover .row-more,
.workspace-row:focus-within .row-more,
.row-more[aria-expanded="true"] {
  opacity: 1;
}
@media (hover: none) {
  .row-more {
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
.conversation-row.new:not(.active) {
  color: var(--el-text-color-secondary);
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
.nav-item:focus-visible,
.row-open:focus-visible,
.row-more:focus-visible,
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
