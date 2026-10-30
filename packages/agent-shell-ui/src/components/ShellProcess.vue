<script setup lang="ts">
import { computed, inject } from "vue";
import { Brain, ChevronRight, LoaderCircle, Wrench } from "lucide-vue-next";
import { shellContextKey } from "../context";
import { activitySummary, describeTool, resolveToolRenderer } from "../tools";
import type { ProcessStepView } from "../types";
import ToolStep from "./ToolStep.vue";
import { useAutoFold } from "../useAutoFold";

/** Consecutive thinking and tool steps: open while running, folded once done; tool steps use host overrides or ToolStep. */
const props = defineProps<{ steps: ProcessStepView[]; active: boolean }>();
const shell = inject(shellContextKey)!;
const { open, toggle } = useAutoFold(() => props.active);

const current = computed(() => props.steps.at(-1));
const toolCount = computed(() => props.steps.filter((step) => step.kind === "tool").length);
/** While active: what is happening now; afterwards: which actions were taken and how many steps. */
const summary = computed(() => {
  const labels = shell.labels.value;
  const step = current.value;
  if (props.active && step) {
    if (step.kind === "thinking") return { label: labels.thinking, subject: "", detail: "" };
    if (!step.toolName) return { label: labels.preparing, subject: "", detail: "" };
    const title = describeTool(step, labels);
    return { label: title.verb, subject: title.subject, detail: title.detail };
  }
  if (!toolCount.value) return { label: labels.thinking, subject: "", detail: "" };
  const actions = activitySummary(props.steps, labels);
  return actions
    ? { label: actions, subject: "", detail: labels.steps(toolCount.value) }
    : { label: labels.steps(toolCount.value), subject: "", detail: "" };
});

function stepComponent(step: ProcessStepView) {
  return resolveToolRenderer(step, shell.toolRenderers.value);
}
</script>

<template>
  <div class="process" :class="{ open, active }">
    <button type="button" class="process-summary" :aria-expanded="open" @click="toggle">
      <LoaderCircle v-if="active" :size="14" class="spin" />
      <Wrench v-else-if="toolCount" :size="14" />
      <Brain v-else :size="14" />
      <span class="summary-label">{{ summary.label }}</span>
      <span v-if="summary.subject" class="summary-subject">{{ summary.subject }}</span>
      <span v-if="summary.detail" class="summary-detail">{{ summary.detail }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <ol v-if="open" class="steps">
      <li v-for="step in steps" :key="step.key">
        <template v-if="step.kind === 'thinking'">
          <div class="thinking-head"><Brain :size="13" />{{ shell.labels.value.thinking }}</div>
          <p class="thinking-text">{{ step.text }}</p>
        </template>
        <component
          :is="stepComponent(step) ?? ToolStep"
          v-else
          :step="step"
          :fallback="stepComponent(step) ? ToolStep : null"
        />
      </li>
    </ol>
  </div>
</template>

<style scoped>
.process {
  margin: 0 0 4px -8px;
}
.process-summary {
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
.process-summary:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.process-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.summary-label {
  flex-shrink: 0;
}
.summary-subject {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
}
.summary-detail {
  min-width: 0;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
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
.thinking-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
.thinking-head svg {
  color: var(--el-text-color-tertiary);
}
.thinking-text {
  margin: 0 8px 6px 29px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
  white-space: pre-wrap;
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
