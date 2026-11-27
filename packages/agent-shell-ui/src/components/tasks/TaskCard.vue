<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { Bot, ChevronRight, CircleAlert, LoaderCircle } from "lucide-vue-next";
import type { AgentTaskError, ChannelAgentTask } from "@ontomato/contracts/agent-tasks";
import { shellContextKey } from "../../context";
import { useAutoFold } from "../../useAutoFold";
import TaskProcess from "./TaskProcess.vue";

/**
 * A delegated agent task in the reply's process: rendered as a light
 * bounded card so its own work stays visually distinct from the main assistant's flat process stream.
 */
const props = defineProps<{ task: ChannelAgentTask; sessionId: string }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value.tasks!);
const running = computed(() => props.task.status === "running" || props.task.status === "starting");
const roleLabel = computed(() => labels.value.delegatedAgent ?? "Delegated agent");
const hasBody = computed(
  () =>
    props.task.process.mode === "inline" ||
    Boolean(props.task.error),
);
const { open, toggle } = useAutoFold(() => running.value);
const visited = ref(open.value);
watch(open, (value) => {
  if (value) visited.value = true;
});

function reason(error: AgentTaskError) {
  return labels.value.errors[error.code] ?? error.message ?? labels.value.status.failed;
}
</script>

<template>
  <div
    :id="`agent-task-${task.id}`"
    class="task"
    :class="[`status-${task.status}`, { open }]"
  >
    <component
      :is="task.process.mode === 'page' ? 'a' : 'button'"
      :type="task.process.mode === 'page' ? undefined : 'button'"
      :href="task.process.mode === 'page' ? task.process.href : undefined"
      class="task-summary"
      :aria-expanded="task.process.mode === 'page' || !hasBody ? undefined : open"
      @click="task.process.mode !== 'page' && hasBody && toggle()"
    >
      <LoaderCircle v-if="running" :size="14" class="task-icon spin active" />
      <CircleAlert v-else-if="task.status === 'failed'" :size="14" class="task-icon danger" />
      <Bot v-else :size="14" class="task-icon" />
      <span class="executor">{{ roleLabel }}</span>
      <span class="detail" :title="task.title">{{ task.title }}</span>
      <span class="status" :class="task.status">
        <span v-for="(label, state) in labels.status" :key="state" class="status-size" aria-hidden="true">{{ label }}</span>
        <span>{{ labels.status[task.status] }}</span>
      </span>
      <ChevronRight v-if="task.process.mode === 'page' || hasBody" :size="14" class="chevron" />
    </component>
    <div v-if="visited && task.process.mode !== 'page' && hasBody" v-show="open" class="task-body">
      <p v-if="task.error" class="task-error">{{ reason(task.error) }}</p>
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
  margin: 2px 0;
  border: 1px solid var(--el-border-color-lighter);
  border-left: 3px solid var(--task-accent, var(--el-color-primary-light-5));
  border-radius: var(--radius-md, 8px);
  background: var(--el-fill-color-lighter);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  overflow: hidden;
}
.task.status-starting,
.task.status-running {
  --task-accent: var(--el-color-primary);
}
.task.status-failed {
  --task-accent: var(--el-color-danger);
}
.task.status-cancelled {
  --task-accent: var(--el-text-color-placeholder);
}
.task-summary {
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  text-align: start;
  padding: 7px 10px;
  border: 0;
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast, 150ms);
}
.task-summary:hover {
  background: var(--el-fill-color-light);
}
.task-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.task-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.task-icon.active {
  color: var(--el-color-primary);
}
.task-icon.danger {
  color: var(--el-color-danger);
}
.executor {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-xs, 4px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs, 12px);
  font-weight: 500;
  line-height: 1.4;
}
.detail {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-regular);
}
.status {
  display: inline-grid;
  justify-items: center;
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  line-height: 1.4;
  white-space: nowrap;
}
.status.starting,
.status.running {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.status.failed {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
.status > span {
  grid-area: 1 / 1;
}
.status-size {
  visibility: hidden;
}
.chevron {
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
  transition: transform var(--transition-fast, 150ms);
}
.task-summary[aria-expanded="true"] > .chevron {
  transform: rotate(90deg);
}
.task-body {
  display: flex;
  flex-direction: column;
  gap: var(--conversation-process-gap);
  padding: 8px 12px 10px 18px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.datasets {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.task-error {
  margin: 0;
  color: var(--el-color-danger);
}
.datasets li {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 0;
  color: var(--el-text-color-regular);
}
.dataset-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
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
  font-size: var(--text-xs, 12px);
}
.dataset-meta.warning {
  color: var(--el-color-warning);
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
