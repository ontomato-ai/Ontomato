<script setup lang="ts">
import { computed, inject, ref } from "vue";
import {
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Terminal,
  Wrench,
} from "lucide-vue-next";
import { shellContextKey } from "../context";
import type { ProcessStep } from "../view";

/** Generic, collapsed view of consecutive thinking and tool steps. No per-tool cards. */
const props = defineProps<{ steps: ProcessStep[]; active: boolean }>();
const shell = inject(shellContextKey)!;
const open = ref(false);
const expandedStep = ref<string | null>(null);

const current = computed(() => props.steps.at(-1));
const toolCount = computed(() => props.steps.filter((step) => step.kind === "tool").length);
/** While active: what is happening now; afterwards: how much happened. */
const summary = computed(() => {
  const labels = shell.labels.value;
  const step = current.value;
  if (props.active && step) {
    if (step.kind === "thinking") return { label: labels.thinking, tool: "", detail: "" };
    if (!step.toolName) return { label: labels.preparing, tool: "", detail: "" };
    return { label: labels.working, tool: step.toolName, detail: step.text };
  }
  return { label: toolCount.value ? labels.steps(toolCount.value) : labels.thinking, tool: "", detail: "" };
});

function toggleStep(key: string) {
  expandedStep.value = expandedStep.value === key ? null : key;
}

function argsText(step: ProcessStep) {
  return JSON.stringify(step.args, null, 2);
}
</script>

<template>
  <div class="process" :class="{ open, active }">
    <button type="button" class="process-summary" :aria-expanded="open" @click="open = !open">
      <LoaderCircle v-if="active" :size="14" class="spin" />
      <Wrench v-else-if="toolCount" :size="14" />
      <Brain v-else :size="14" />
      <span class="summary-label">{{ summary.label }}</span>
      <span v-if="summary.tool" class="summary-tool">{{ summary.tool }}</span>
      <span v-if="summary.detail" class="summary-detail">{{ summary.detail }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <ol v-if="open" class="steps">
      <li v-for="step in steps" :key="step.key" class="step">
        <template v-if="step.kind === 'thinking'">
          <div class="step-row static">
            <Brain :size="13" class="step-icon" />
            <span class="step-label">{{ shell.labels.value.thinking }}</span>
          </div>
          <p class="thinking-text">{{ step.text }}</p>
        </template>
        <template v-else>
          <button
            type="button"
            class="step-row"
            :aria-expanded="expandedStep === step.key"
            @click="toggleStep(step.key)"
          >
            <Terminal :size="13" class="step-icon" />
            <span class="step-name">{{ step.toolName || shell.labels.value.preparing }}</span>
            <span class="step-arg">{{ step.text }}</span>
            <LoaderCircle v-if="step.status === 'running' || step.status === 'streaming'" :size="13" class="spin status" />
            <CircleAlert v-else-if="step.status === 'failed'" :size="13" class="status failed" />
            <Check v-else :size="13" class="status done" />
          </button>
          <div v-if="expandedStep === step.key" class="step-detail">
            <div class="detail-label">{{ shell.labels.value.toolInput }}</div>
            <pre>{{ argsText(step) }}</pre>
            <template v-if="step.output">
              <div class="detail-label">{{ shell.labels.value.toolOutput }}</div>
              <pre>{{ step.output }}</pre>
            </template>
          </div>
        </template>
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
.process-summary:focus-visible,
.step-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.summary-label {
  flex-shrink: 0;
}
.summary-tool {
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
.step-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm, 13px);
  text-align: left;
  cursor: pointer;
}
.step-row:hover:not(.static) {
  background: var(--el-fill-color-light);
}
.step-row.static {
  cursor: default;
}
.step-icon {
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
}
.step-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  font-weight: 600;
  flex-shrink: 0;
}
.step-label {
  color: var(--el-text-color-secondary);
}
.step-arg {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status {
  flex-shrink: 0;
  color: var(--el-text-color-tertiary);
}
.status.done {
  color: var(--el-color-success);
}
.status.failed {
  color: var(--el-color-danger);
}
.thinking-text {
  margin: 0 8px 6px 29px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  line-height: 1.6;
  white-space: pre-wrap;
}
.step-detail {
  margin: 2px 8px 8px 29px;
}
.detail-label {
  margin: 6px 0 4px;
  font-size: var(--text-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--el-text-color-tertiary);
}
.step-detail pre {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
