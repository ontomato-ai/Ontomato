<script setup lang="ts">
import { computed, inject, watch } from "vue";
import {
  ChevronRight,
  CircleAlert,
  Database,
  LoaderCircle,
} from "lucide-vue-next";
import { shellContextKey } from "../context";
import { useRetrievalActivity } from "../useRetrievalActivity";
import { useAutoFold } from "../useAutoFold";
import type { RetrievalLink } from "../conversation";
import type { ProcessStepView } from "../types";
import { activitySummary, describeTool, skillOfCommand } from "../tools";
import { toolSummary } from "../view";
import ToolStep from "./ToolStep.vue";

/** The stable retrieval ID preserves fold state while continuations replace the subscribed run. */
const props = defineProps<{
  link: RetrievalLink;
  parentRunId: string;
  sessionId: string;
}>();

const shell = inject(shellContextKey)!;
const { state, run, restart } = useRetrievalActivity(() => {
  const ids = [props.sessionId, props.parentRunId, props.link.retrievalId, props.link.runId] as const;
  return {
    runId: props.link.runId,
    read: () => shell.readRetrieval(...ids),
    readRun: () => shell.readRetrievalRun(...ids),
    subscribe: (after, handlers) => shell.subscribeRetrieval(...ids, after, handlers),
  };
});
watch([
  () => props.sessionId, () => props.parentRunId,
  () => props.link.retrievalId, () => props.link.runId,
], restart);

/** The retriever's tool executions as process steps, so they read like the main process. */
const steps = computed<ProcessStepView[]>(() => Object.values(run.value?.tools ?? {}).map((tool) => {
  const command = tool.toolName === "bash" && typeof tool.args.command === "string" ? tool.args.command : "";
  return {
    key: tool.toolCallId,
    kind: "tool",
    text: toolSummary(tool.args),
    toolName: tool.toolName,
    skill: command ? skillOfCommand(command) : null,
    args: tool.args,
    status: tool.status,
    output: tool.output,
  };
}));
const running = computed(() => Boolean(state.snapshot?.retrieverPending || state.snapshot?.bindingPending));
const { open, toggle } = useAutoFold(() => running.value);
const errorMessage = computed(() => state.snapshot?.admissionError ?? run.value?.errorMessage ?? state.snapshot?.run?.errorMessage ?? null);
const labels = computed(() => shell.labels.value);
/** While running: the current action; afterwards: the actions taken and the step count. */
const detail = computed(() => {
  const current = steps.value.at(-1);
  if (running.value) return current ? describeTool(current, labels.value).verb : "";
  const actions = activitySummary(steps.value, labels.value);
  return steps.value.length ? [actions, labels.value.steps(steps.value.length)].filter(Boolean).join(" · ") : "";
});
</script>

<template>
  <div class="retrieval" :class="{ open }">
    <button
      type="button"
      class="retrieval-summary"
      :aria-expanded="open"
      @click="toggle"
    >
      <LoaderCircle v-if="running" :size="14" class="spin" />
      <CircleAlert v-else-if="errorMessage" :size="14" class="danger" />
      <Database v-else :size="14" />
      <span class="summary-label">{{ labels.activityRetrieve }}</span>
      <span v-if="detail" class="summary-detail">{{ detail }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <ol v-if="open" class="steps">
      <li v-for="result in state.snapshot?.bindings?.datasets ?? []" :key="result.id" class="binding">
        <Database :size="12" /><span>{{ result.title }}</span>
      </li>
      <li v-for="step in steps" :key="step.key"><ToolStep :step="step" /></li>
      <li v-if="steps.length === 0 && !state.snapshot?.bindings?.datasets.length" class="step-empty">{{ labels.loading }}</li>
    </ol>
    <div v-if="errorMessage" class="retrieval-error" role="alert">
      <CircleAlert :size="13" />
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>

<style scoped>
.retrieval {
  margin: 0 0 4px -8px;
}
.retrieval-summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px 4px 8px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm, 13px);
  cursor: pointer;
  transition: background-color var(--transition-fast, 150ms);
}
.retrieval-summary:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.retrieval-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.summary-label {
  flex-shrink: 0;
}
.summary-detail {
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
.steps {
  list-style: none;
  margin: 6px 0 0 14px;
  padding: 2px 0 2px 14px;
  border-left: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.binding {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm, 13px);
}
.step-empty {
  padding: 5px 8px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-sm, 13px);
}
.retrieval-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 6px 0 0 14px;
  padding: 8px 10px;
  border-radius: var(--radius-lg, 12px);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm, 13px);
}
.danger {
  color: var(--el-color-danger);
  flex-shrink: 0;
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
