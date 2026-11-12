<script setup lang="ts">
import { computed, inject } from "vue";
import { ChevronRight, CircleAlert, Database, LoaderCircle } from "lucide-vue-next";
import type { AgentTaskError, RetrievalTask } from "@ontomato/contracts/agent-tasks";
import { shellContextKey } from "../../context";
import { useAutoFold } from "../../useAutoFold";
import TaskProcess from "./TaskProcess.vue";

/**
 * A retrieval the reply delegated, in the reply's process: who does it, how each branch ended and, while the retriever
 * works, its own live process. It shows the work only; the data reaches the reader through the reply.
 */
const props = defineProps<{ task: RetrievalTask; sessionId: string }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value.tasks!);
const running = computed(() => props.task.status === "running");
const { open, toggle } = useAutoFold(() => running.value);

function reason(error: AgentTaskError) {
  return labels.value.errors[error.code] ?? error.message ?? labels.value.status.failed;
}
</script>

<template>
  <div :id="`agent-task-${task.id}`" class="task" :class="{ open }">
    <button type="button" class="task-summary" :aria-expanded="open" @click="toggle">
      <LoaderCircle v-if="running" :size="14" class="spin" />
      <CircleAlert v-else-if="task.status === 'failed'" :size="14" class="danger" />
      <Database v-else :size="14" />
      <span class="executor">{{ labels.retriever }}</span>
      <span class="status">{{ labels.status[task.status] }}</span>
      <span class="detail">{{ task.question }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <div v-if="open" class="task-body">
      <ul class="branches">
        <li v-for="branch in task.branches" :key="branch.source" class="branch">
          <div class="branch-line">
            <span class="branch-name">{{ labels.branch[branch.source] }}</span>
            <span class="branch-status" :class="branch.status">{{ labels.status[branch.status] }}</span>
            <span v-if="branch.error" class="branch-error">{{ reason(branch.error) }}</span>
          </div>
          <ul v-if="branch.datasets.length" class="datasets">
            <li v-for="dataset in branch.datasets" :key="dataset.id">
              <Database :size="12" />
              <span class="dataset-title">{{ dataset.title }}</span>
              <span class="dataset-meta">{{ labels.rows(dataset.rowCount) }}</span>
              <span v-if="dataset.truncation" class="dataset-meta warning">{{ shell.labels.value.truncatedRows(dataset.truncation.rowLimit) }}</span>
            </li>
          </ul>
        </li>
      </ul>
      <TaskProcess
        v-if="shell.tasks && task.process.mode === 'inline'"
        :port="shell.tasks"
        :session-id="sessionId"
        :task-id="task.id"
        :run-id="task.process.runtimeRunId"
      />
    </div>
  </div>
</template>

<style scoped>
.task {
  margin: 0 0 0 -8px;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.task-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px 4px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm, 13px);
  cursor: pointer;
  transition: background-color var(--transition-fast, 150ms);
}
.task-summary:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.task-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.executor {
  flex-shrink: 0;
  color: var(--el-text-color-regular);
  font-weight: 500;
}
.status {
  flex-shrink: 0;
}
.detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-tertiary);
}
.chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast, 150ms);
}
.open .chevron {
  transform: rotate(90deg);
}
.task-body {
  display: flex;
  flex-direction: column;
  gap: var(--conversation-process-gap);
  margin: var(--conversation-process-gap) 0 0 14px;
  padding: 0 0 0 14px;
  border-left: 1px solid var(--el-border-color);
}
.branches,
.datasets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.branch-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 2px 8px;
}
.branch-name {
  color: var(--el-text-color-regular);
}
.branch-status {
  color: var(--el-text-color-secondary);
}
.branch-status.failed,
.branch-error {
  color: var(--el-color-danger);
}
.datasets li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px 2px 16px;
  color: var(--el-text-color-regular);
}
.dataset-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dataset-meta {
  flex-shrink: 0;
  color: var(--el-text-color-tertiary);
}
.dataset-meta.warning {
  color: var(--el-color-warning);
}
.danger {
  flex-shrink: 0;
  color: var(--el-color-danger);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
