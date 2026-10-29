<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import {
  ChevronRight,
  CircleAlert,
  Database,
  LoaderCircle,
} from "lucide-vue-next";
import type { RuntimeRunSnapshot } from "@ontomato/contracts/agent-runtime";
import { shellContextKey } from "../context";
import { useRetrievalActivity } from "../useRetrievalActivity";
import type { RetrievalLink } from "../conversation";
import { toolSummary } from "../view";

/**
 * Collapsible retrieval activity area. Polls the retrieval snapshot while the owning run is
 * active and renders the toolCall/toolResult messages as steps. The retrieval ID is the stable
 * key across continuations and is used for the fold state, so a retrieval that resumes keeps its
 * place in the list and its open/closed state.
 */
const props = defineProps<{
  link: RetrievalLink;
  /** The parent run's id — used to scope the retrieval snapshot proxy route. */
  parentRunId: string;
  sessionId: string;
  runActive: () => boolean;
}>();

const shell = inject(shellContextKey)!;
const open = ref(false);

const { state, restart } = useRetrievalActivity(
  (retrievalId) =>
    shell.readRetrieval(props.sessionId, props.parentRunId, retrievalId),
  props.link.retrievalId,
  props.runActive,
);
// A continuation moves this retrieval to a new run; same component, so the fold state stays.
watch(() => props.link.runId, restart);

interface ActivityStep {
  key: string;
  toolCallId: string;
  toolName: string;
  summary: string;
  status: "running" | "completed" | "failed";
  output: string;
}

/** Projects the snapshot's messages into tool-call activity steps. */
function activitySteps(records: RuntimeRunSnapshot["messages"]): ActivityStep[] {
  type ToolResultMsg = Extract<RuntimeRunSnapshot["messages"][number]["message"], { role: "toolResult" }>;
  const results = new Map<string, ToolResultMsg>();
  for (const record of records) {
    if (record.message.role === "toolResult") results.set(record.message.toolCallId, record.message as ToolResultMsg);
  }
  const steps: ActivityStep[] = [];
  for (const record of records) {
    const message = record.message;
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const result = results.get(block.id);
      const status: ActivityStep["status"] = result
        ? result.isError
          ? "failed"
          : "completed"
        : "running";
      steps.push({
        key: `${record.id}:${block.id}`,
        toolCallId: block.id,
        toolName: block.name,
        summary: toolSummary(block.arguments),
        status,
        output: result ? result.content.map((part) => (part.type === "text" ? part.text : "")).join("") : "",
      });
    }
  }
  return steps;
}

const steps = computed<ActivityStep[]>(() => state.snapshot ? activitySteps(state.snapshot.messages) : []);
const runStatus = computed(() => state.snapshot?.run?.status ?? null);
const running = computed(() => (state.snapshot?.retrieverPending ?? runStatus.value === "running") || (state.snapshot?.bindingPending ?? state.snapshot?.bindings?.status === "running"));
const errorMessage = computed(() => state.snapshot?.admissionError ?? state.snapshot?.run?.errorMessage ?? null);
const labels = computed(() => shell.labels.value);
</script>

<template>
  <div class="retrieval" :class="{ open }">
    <button
      type="button"
      class="retrieval-summary"
      :aria-expanded="open"
      @click="open = !open"
    >
      <LoaderCircle v-if="running" :size="14" class="spin" />
      <CircleAlert v-else-if="errorMessage" :size="14" class="danger" />
      <Database v-else :size="14" />
      <span class="summary-label">{{ labels.thinking }}</span>
      <span class="summary-subject">{{ link.retrievalId.slice(0, 8) }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <ol v-if="open" class="steps">
      <li v-for="result in state.snapshot?.bindings?.datasets ?? []" :key="result.id" class="step">
        <div class="step-head"><Database :size="12" /><span>{{ result.title }}</span></div>
      </li>
      <li v-for="step in steps" :key="step.key" class="step">
        <div class="step-head">
          <LoaderCircle v-if="step.status === 'running'" :size="12" class="spin" />
          <CircleAlert v-else-if="step.status === 'failed'" :size="12" class="danger" />
          <span class="step-name">{{ step.toolName }}</span>
          <span v-if="step.summary" class="step-summary">{{ step.summary }}</span>
        </div>
        <pre v-if="step.output" class="step-output">{{ step.output }}</pre>
      </li>
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
.summary-subject {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
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
.step {
  padding: 5px 8px;
}
.step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
.step-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-regular);
}
.step-summary {
  min-width: 0;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-tertiary);
}
.step-output {
  margin: 6px 0 0 18px;
  max-height: 240px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: var(--radius-lg, 12px);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--text-xs, 12px);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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
