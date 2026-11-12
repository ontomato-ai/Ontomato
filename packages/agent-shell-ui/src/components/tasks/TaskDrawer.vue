<script setup lang="ts">
import { computed, inject } from "vue";
import { ChevronLeft, ChevronRight, Database, ShieldCheck, X } from "lucide-vue-next";
import type { AgentTask, AgentTasksSnapshot, RetrievalTask } from "@ontomato/contracts/agent-tasks";
import { shellContextKey } from "../../context";

/**
 * The work one reply delegated, as a list: each retrieval with the quality checks of its branches beneath it. It shows
 * status only and leads to where the task is shown, the card in the reply's process or the review after the reply.
 */
const props = defineProps<{ snapshot: AgentTasksSnapshot; rounds: string[] }>();
const runId = defineModel<string>("runId", { required: true });
const emit = defineEmits<{ locate: [taskId: string]; close: [] }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value.tasks!);
const index = computed(() => props.rounds.indexOf(runId.value));
const retrievals = computed(() => props.snapshot.tasks.filter((task): task is RetrievalTask =>
  task.kind === "retrieval" && task.root.runId === runId.value));
const checks = (parent: AgentTask) => props.snapshot.tasks.filter((task) => task.kind === "quality" && task.parentTaskId === parent.id);
const result = (task: AgentTask) => props.snapshot.qualityResults.find((value) => value.taskId === task.id);
</script>

<template>
  <aside class="task-drawer" :aria-label="labels.listTitle">
    <header class="drawer-header">
      <h2>{{ labels.listTitle }}</h2>
      <div class="round">
        <button type="button" :disabled="index <= 0" :title="labels.previousRound" :aria-label="labels.previousRound" @click="runId = rounds[index - 1]!">
          <ChevronLeft :size="14" />
        </button>
        <span>{{ labels.round(index + 1, rounds.length) }}</span>
        <button type="button" :disabled="index >= rounds.length - 1" :title="labels.nextRound" :aria-label="labels.nextRound" @click="runId = rounds[index + 1]!">
          <ChevronRight :size="14" />
        </button>
      </div>
      <button type="button" class="close" :title="shell.labels.value.close" :aria-label="shell.labels.value.close" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>
    <ol class="tasks">
      <li v-for="task in retrievals" :key="task.id">
        <button type="button" class="task-row" @click="emit('locate', task.id)">
          <Database :size="14" />
          <span class="name">{{ labels.retriever }}</span>
          <span class="question">{{ task.question }}</span>
          <span class="status" :class="task.status">{{ labels.status[task.status] }}</span>
        </button>
        <ol v-if="checks(task).length" class="checks">
          <li v-for="check in checks(task)" :key="check.id">
            <button type="button" class="task-row" @click="emit('locate', check.id)">
              <ShieldCheck :size="14" />
              <span class="name">{{ labels.quality }}</span>
              <span v-if="check.kind === 'quality'" class="source">{{ labels.checkedBranch[check.checks.source] }}</span>
              <span class="status" :class="check.status">
                {{ result(check) ? labels.score(Math.round(result(check)!.score)) : labels.status[check.status] }}
              </span>
            </button>
          </li>
        </ol>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.task-drawer {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: var(--shell-task-drawer-width);
  border-left: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
  box-shadow: var(--el-box-shadow-light);
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm);
}
.drawer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
h2 {
  flex: 1;
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.round {
  display: flex;
  align-items: center;
  gap: 2px;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
button {
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.round button,
.close {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
}
.round button:disabled {
  opacity: 0.35;
  cursor: default;
}
.round button:hover:not(:disabled),
.close:hover {
  background: var(--el-fill-color);
}
.tasks,
.checks {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tasks {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-sm);
}
.checks {
  margin-left: 18px;
  border-left: 1px solid var(--el-border-color);
  padding-left: 6px;
}
.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-regular);
  text-align: left;
}
.task-row:hover {
  background: var(--el-fill-color);
}
.task-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.name {
  flex-shrink: 0;
  white-space: nowrap;
}
.source {
  flex-shrink: 0;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
}
.question {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-tertiary);
}
.status {
  flex-shrink: 0;
  white-space: nowrap;
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.status.failed {
  color: var(--el-color-danger);
}
</style>
