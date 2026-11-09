<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import { Info } from "lucide-vue-next";
import type { WorkspaceCommit } from "@ontomato/contracts/workspaces";
import { formatRelativeTime } from "../../../utils/relative-time";
import { errorText, shortCommit } from "../panel";
import type { WorkspaceView } from "../workspace-view";

/**
 * The workspace's commits, newest first and read page by page. Going back to one makes a new commit with its files and
 * keeps every later commit; publishing's rollback is another thing and is not here. A run that occupies the workspace
 * holds going back until it ends.
 */
const props = defineProps<{ view: WorkspaceView }>();
const emit = defineEmits<{ showChanges: [commit: string] }>();
const { t } = useI18n();
const restoring = ref<string | null>(null);

async function restore(commit: WorkspaceCommit) {
  try {
    await ElMessageBox.confirm(
      t("appBuilder.restoreConfirm", { commit: shortCommit(commit.id) }),
      t("appBuilder.restoreTitle", { message: commit.message }),
      { confirmButtonText: t("appBuilder.restoreAction"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  restoring.value = commit.id;
  try {
    const created = await props.view.restore(commit.id);
    ElMessage.success(t("appBuilder.restored", { commit: shortCommit(commit.id), created: shortCommit(created) }));
  } catch (error) {
    ElMessage.error(errorText(error));
  } finally {
    restoring.value = null;
  }
}
</script>

<template>
  <div class="history">
    <p class="history-hint"><Info :size="13" aria-hidden="true" /><span>{{ t("appBuilder.historyHint") }}</span></p>
    <div v-if="view.commitsState === 'error' && view.commits.length === 0" class="history-state" role="alert">
      {{ t("assistant.loadFailed") }}
      <el-button size="small" @click="view.loadCommits()">{{ t("common.retry") }}</el-button>
    </div>
    <div v-else-if="view.commitsState === 'loading' && view.commits.length === 0" class="history-state" aria-busy="true">
      {{ t("assistant.loading") }}
    </div>
    <ol v-else class="commits">
      <li v-for="commit in view.commits" :key="commit.id" class="commit" :class="{ head: commit.id === view.workspace?.headCommit }">
        <span class="commit-rail" aria-hidden="true"><span class="commit-dot" /></span>
        <div class="commit-main">
          <div class="commit-message">
            <span class="message-text">{{ commit.message }}</span>
            <span v-if="commit.id === view.workspace?.headCommit" class="pill">{{ t("appBuilder.current") }}</span>
          </div>
          <div class="commit-meta">
            <span class="hash">{{ shortCommit(commit.id) }}</span>
            <span>{{ formatRelativeTime(commit.createdAt) }}</span>
          </div>
        </div>
        <div class="commit-actions">
          <el-button text size="small" @click="emit('showChanges', commit.id)">{{ t("appBuilder.viewChanges") }}</el-button>
          <el-tooltip
            v-if="commit.id !== view.workspace?.headCommit"
            :disabled="!view.workspace?.activeRunId"
            :content="t('appBuilder.restoreBusy')"
            placement="top"
          >
            <span class="button-wrap">
              <el-button
                text
                size="small"
                :disabled="Boolean(view.workspace?.activeRunId) || restoring !== null"
                :loading="restoring === commit.id"
                @click="restore(commit)"
              >
                {{ t("appBuilder.restore") }}
              </el-button>
            </span>
          </el-tooltip>
        </div>
      </li>
    </ol>
    <div v-if="view.moreCommits" class="history-more">
      <el-button size="small" :loading="view.commitsState === 'loading'" @click="view.loadCommits(true)">{{ t("common.loadMore") }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.history {
  height: 100%;
  box-sizing: border-box;
  padding: var(--spacing-md) var(--spacing-md) var(--spacing-xl) var(--spacing-lg);
  overflow-y: auto;
}
.history-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 var(--spacing-sm);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.history-hint svg {
  flex-shrink: 0;
}
.history-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: var(--spacing-2xl) var(--spacing-lg);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.commits {
  margin: 0;
  padding: 0;
  list-style: none;
}
.commit {
  display: flex;
  gap: var(--spacing-md);
  padding: 10px 6px 10px 2px;
  border-radius: var(--radius-md);
}
.commit:hover {
  background: var(--el-fill-color-lighter);
}
/* The line of the history runs through every dot, from the first commit's to the last's. */
.commit-rail {
  position: relative;
  display: flex;
  justify-content: center;
  width: 16px;
  flex-shrink: 0;
}
.commit-rail::before {
  content: "";
  position: absolute;
  top: -10px;
  bottom: -10px;
  left: 7px;
  width: 2px;
  background: var(--el-border-color);
}
.commit:first-child .commit-rail::before {
  top: 12px;
}
.commit:last-child .commit-rail::before {
  bottom: auto;
  height: 22px;
}
.commit:only-child .commit-rail::before {
  display: none;
}
.commit-dot {
  position: relative;
  width: 10px;
  height: 10px;
  margin-top: 5px;
  box-sizing: border-box;
  border: 2px solid var(--el-text-color-placeholder);
  border-radius: var(--radius-full);
  background: var(--el-bg-color);
}
.commit.head .commit-dot {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary);
}
.commit-main {
  flex: 1;
  min-width: 0;
}
.commit-message {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-weight: var(--font-medium);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-primary);
}
.message-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.pill {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-xs);
  background: var(--brand-primary-tint);
  color: var(--brand-link);
  font-size: 11px;
  font-weight: var(--font-medium);
  white-space: nowrap;
}
.commit-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.hash {
  font-family: var(--font-mono);
}
.commit-actions {
  display: flex;
  align-items: flex-start;
  flex-shrink: 0;
}
.commit-actions .el-button + .button-wrap,
.button-wrap + .el-button {
  margin-left: 0;
}
.button-wrap {
  display: inline-flex;
}
.history-more {
  display: flex;
  justify-content: center;
  padding-top: var(--spacing-sm);
}
@container page (max-width: 520px) {
  .commit {
    flex-wrap: wrap;
  }
  .commit-actions {
    width: 100%;
    padding-left: 28px;
  }
}
</style>
