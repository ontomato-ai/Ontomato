<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { Check, CircleAlert, FilePen, FileText, LoaderCircle, Puzzle, Terminal, Wrench } from "lucide-vue-next";
import { shellContextKey } from "../context";
import { describeTool } from "../tools";
import type { ToolStepProps } from "../types";

/** Default view of one tool call: read, write, edit, bash (skill scripts by skill name), others generic. */
const props = defineProps<ToolStepProps>();
const shell = inject(shellContextKey)!;
const open = ref(false);
const title = computed(() => describeTool(props.step, shell.labels.value));
const icon = computed(() => {
  if (props.step.skill) return Puzzle;
  switch (props.step.toolName) {
    case "read":
      return FileText;
    case "write":
    case "edit":
      return FilePen;
    case "bash":
      return Terminal;
    default:
      return Wrench;
  }
});
const running = computed(() => props.step.status === "running" || props.step.status === "streaming");
const argsText = computed(() => JSON.stringify(props.step.args, null, 2));
</script>

<template>
  <button type="button" class="step-row" :aria-expanded="open" @click="open = !open">
    <component :is="icon" :size="13" class="step-icon" />
    <span class="step-verb">{{ step.toolName ? title.verb : shell.labels.value.preparing }}</span>
    <span v-if="title.subject" class="step-subject">{{ title.subject }}</span>
    <span class="step-detail">{{ title.detail }}</span>
    <LoaderCircle v-if="running" :size="13" class="spin status" />
    <CircleAlert v-else-if="step.status === 'failed'" :size="13" class="status failed" />
    <Check v-else :size="13" class="status done" />
  </button>
  <div v-if="open" class="step-body">
    <div class="body-label">{{ shell.labels.value.toolInput }}</div>
    <pre>{{ argsText }}</pre>
    <template v-if="step.output">
      <div class="body-label">{{ shell.labels.value.toolOutput }}</div>
      <pre>{{ step.output }}</pre>
    </template>
  </div>
</template>

<style scoped>
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
.step-row:hover {
  background: var(--el-fill-color-light);
}
.step-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.step-icon {
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
}
.step-verb {
  flex-shrink: 0;
  font-weight: 500;
}
.step-subject {
  flex-shrink: 0;
  max-width: 45%;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--el-fill-color);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.step-detail {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-tertiary);
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
.step-body {
  margin: 2px 8px 8px 29px;
}
.body-label {
  margin: 6px 0 4px;
  font-size: var(--text-xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--el-text-color-tertiary);
}
pre {
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
