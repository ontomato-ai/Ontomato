<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { copyText } from "@ontomato/foundation-ui/clipboard";
import { Check, ChevronRight, CircleAlert, CircleHelp, Copy, LoaderCircle, Square, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-vue-next";
import type { ShellFeedbackPort, ShellFeedbackValue } from "../types";
import SlotOutlet from "./SlotOutlet.vue";
import TaskCard from "./tasks/TaskCard.vue";
import QualityReview from "./tasks/QualityReview.vue";
import { shellContextKey } from "../context";
import type { ResponseItem } from "../view";
import ShellMarkdown from "./ShellMarkdown.vue";
import ShellProcess from "./ShellProcess.vue";
import ProcessDetail from "./ProcessDetail.vue";
import ProcessInput from "./ProcessInput.vue";
import { useAutoFold } from "../useAutoFold";

const props = defineProps<{
  item: ResponseItem;
  sessionId: string | null;
  feedback?: ShellFeedbackPort;
}>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);

const copied = ref(false);
const usageOpen = ref(false);
const rating = ref<ShellFeedbackValue | null>(null);
const reasonOpen = ref(false);
const reason = ref("");
const feedbackBusy = ref(false);

const hasUnknownTools = computed(() =>
  props.item.process.some(
    (block) => block.kind === "steps" && block.steps.some((step) => step.kind === "tool" && step.status === "unknown"),
  ),
);

function usageTotal(counts: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number; totalTokens: number }) {
  return counts.totalTokens || (counts.input + counts.output + counts.cacheRead + counts.cacheWrite + (counts.reasoning ?? 0));
}

const usageSummary = computed(() => {
  const usage = props.item.usage;
  if (!usage) return null;
  const total = usageTotal(usage.counts);
  const format = labels.value.usage;
  const label = format ? format.tokens(total) : `${total.toLocaleString()} tokens`;
  const parts: string[] = [
    format ? format.input(usage.counts.input) : `Input ${usage.counts.input.toLocaleString()}`,
    format ? format.output(usage.counts.output) : `Output ${usage.counts.output.toLocaleString()}`,
  ];
  if (usage.counts.cacheRead > 0)
    parts.push(format ? format.cacheRead(usage.counts.cacheRead) : `Cache read ${usage.counts.cacheRead.toLocaleString()}`);
  if (usage.counts.cacheWrite > 0)
    parts.push(format ? format.cacheWrite(usage.counts.cacheWrite) : `Cache write ${usage.counts.cacheWrite.toLocaleString()}`);
  if ((usage.counts.reasoning ?? 0) > 0)
    parts.push(format ? format.reasoning(usage.counts.reasoning!) : `Reasoning ${usage.counts.reasoning!.toLocaleString()}`);
  if (usage.last) {
    const lastTotal = usageTotal(usage.last);
    parts.push(format ? format.lastCall(lastTotal) : `Last call ${lastTotal.toLocaleString()}`);
  }
  return { label, parts, title: parts.join(" · ") };
});

/** The runtime names the answer when the run stops, so feedback has a target only then. */
const target = computed(() =>
    props.sessionId && !props.item.handoff && !props.item.running && props.item.answerMessageId && props.item.answerText.trim()
    ? { sessionId: props.sessionId, runId: props.item.runId, messageId: props.item.answerMessageId }
    : null,
);
const hasProcess = computed(() => props.item.process.length > 0);
/** The work this reply delegated and the checks of the data it cited; its entry opens the task list here. */
const taskCount = computed(() =>
  props.item.process.filter((block) => block.kind === "task").length + props.item.reviews.length);
/** Show the outer process while work continues; preserve the reader's explicit fold choice. */
const delegating = computed(() => props.item.process.some((block) =>
  block.kind === "task" && (block.task.status === "running" || block.task.status === "starting")));
const { open, toggle, reveal } = useAutoFold(() =>
  props.item.running || (!props.item.answerMessageId && (delegating.value ||
    props.item.retrievalProgress === "retrieving" || props.item.retrievalProgress === "datasetReady")));
const processVisited = ref(open.value);
watch(open, value => { if (value) processVisited.value = true; });
const retrievalStatus = computed(() => {
  const progress = props.item.retrievalProgress;
  return progress ? labels.value.retrievalProgress?.[progress] : undefined;
});

/** A task the reader picked from the task list: its card is in the process, which opens; the conversation scrolls to it. */
watch(() => shell.taskFocus?.value, (focus) => {
  if (focus && props.item.process.some((block) => block.kind === "task" && block.task.id === focus.taskId)) reveal();
});

const timingActive = computed(() => props.item.running || props.item.retrievalProgress === "retrieving" || props.item.retrievalProgress === "datasetReady");
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
watch(
  timingActive,
  (running) => {
    if (ticker) clearInterval(ticker);
    if (running) now.value = Date.now();
    ticker = running ? setInterval(() => (now.value = Date.now()), 1000) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => ticker && clearInterval(ticker));
function clock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
const status = computed(() => {
  const { startedAt, finishedAt, handoff } = props.item;
  if (timingActive.value) {
    const stage = retrievalStatus.value ?? labels.value.working;
    return startedAt === null ? stage : `${stage} · ${labels.value.elapsed(clock(now.value - startedAt))}`;
  }
  if (handoff) return labels.value.tasks?.delegated ?? labels.value.thinking;
  if (startedAt === null || finishedAt === null) return null;
  return labels.value.elapsed(clock(finishedAt - startedAt));
});

// The answer id appears after the run settles, and the component stays mounted, so read the stored
// feedback whenever the target changes rather than once on mount.
watch(target, async (next) => {
  rating.value = null;
  if (!props.feedback || !next) return;
  try {
    const stored = await props.feedback.read(next);
    if (target.value === next) rating.value = stored;
  } catch {
    if (target.value === next) rating.value = null;
  }
}, { immediate: true });

async function copy() {
  if (!(await copyText(props.item.answerText))) return;
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

async function rate(value: "like" | "dislike") {
  if (!props.feedback || !target.value || feedbackBusy.value) return;
  if (rating.value?.rating === value) {
    feedbackBusy.value = true;
    try {
      await props.feedback.remove(target.value);
      rating.value = null;
    } finally {
      feedbackBusy.value = false;
    }
    return;
  }
  if (value === "dislike") {
    reasonOpen.value = true;
    return;
  }
  await submit({ rating: "like", reason: "" });
}

async function submit(value: ShellFeedbackValue) {
  if (!props.feedback || !target.value) return;
  feedbackBusy.value = true;
  try {
    rating.value = await props.feedback.submit(target.value, value);
    reasonOpen.value = false;
    reason.value = "";
  } finally {
    feedbackBusy.value = false;
  }
}
</script>

<template>
  <div class="response" :class="{ 'collapsed-handoff': item.handoff && !open && !timingActive }">
    <section v-if="status || hasProcess || usageSummary" class="process-region" :class="{ open }">
      <div class="process-line">
        <button
          v-if="hasProcess"
          type="button"
          class="process-toggle"
          :aria-expanded="open"
          :aria-live="timingActive ? 'off' : 'polite'"
          @click="toggle"
        >
          <LoaderCircle v-if="item.running || delegating" :size="12" class="spin" />
          <span>{{ status }}</span>
          <ChevronRight :size="14" class="chevron" />
        </button>
        <div v-else-if="status" class="process-toggle" :aria-live="timingActive ? 'off' : 'polite'">
          <LoaderCircle v-if="item.running" :size="12" class="spin" />
          <span>{{ status }}</span>
        </div>
        <button
          v-if="!item.running && hasUnknownTools"
          type="button"
          class="process-unknown"
          @click="reveal()"
        >
          <CircleHelp :size="12" />
          <span>{{ labels.toolOutcomeUnknown ?? "Outcome unknown" }}</span>
        </button>
        <button v-if="taskCount && shell.openTasks" type="button" class="process-toggle tasks-entry" @click="shell.openTasks(item.runId)">
          {{ labels.tasks!.count(taskCount) }}
        </button>
        <button
          v-if="usageSummary"
          type="button"
          class="process-toggle usage-entry"
          :aria-expanded="usageOpen"
          :title="usageSummary.title"
          @click="usageOpen = !usageOpen"
        >
          <span>{{ usageSummary.label }}</span>
        </button>
      </div>
      <div v-if="usageSummary && usageOpen" class="usage-breakdown">
        <span v-for="part in usageSummary.parts" :key="part" class="usage-part">{{ part }}</span>
      </div>
      <div v-if="processVisited && hasProcess" v-show="open" class="process-body">
        <template v-for="block in item.process" :key="block.key">
          <ShellProcess v-if="block.kind === 'steps'" :steps="block.steps" :active="block.active" />
          <TaskCard v-else-if="block.kind === 'task'" :task="block.task" :session-id="sessionId ?? ''" />
          <ProcessInput v-else-if="block.kind === 'input'" :text="block.text" :answer="block.replyTo !== undefined" />
          <ProcessDetail v-else-if="block.kind === 'detail'" :detail="block.detail" :running="item.running" />
          <div v-else class="process-note">
            <ShellMarkdown :content="block.text" :final="block.final" :run-id="block.runId" />
          </div>
        </template>
      </div>
    </section>
    <div v-if="item.running && !hasProcess && !retrievalStatus" class="waiting" aria-live="polite">
      <span class="dot" /><span class="dot" /><span class="dot" />
      <span class="sr-only">{{ labels.working }}</span>
    </div>
    <div v-if="item.answerMessageId" class="response-text">
      <ShellMarkdown :content="item.answerText" final :run-id="item.runId" />
    </div>

    <div v-if="item.end?.stopReason === 'aborted'" class="end-note muted">
      <Square :size="12" /> {{ labels.stopped }}
    </div>
    <div v-else-if="item.end?.stopReason === 'length'" class="end-note warning">
      <TriangleAlert :size="14" /> {{ labels.truncated }}
    </div>
    <div v-else-if="item.end?.stopReason === 'error'" class="end-note error" role="alert">
      <CircleAlert :size="14" />
      <span>{{ item.end.errorMessage || labels.failed }}</span>
    </div>

    <div v-if="!item.handoff && !item.running && item.answerMessageId && item.answerText.trim()" class="actions">
      <button type="button" class="shell-message-action" :title="labels.copy" :aria-label="labels.copy" @click="copy">
        <Check v-if="copied" :size="15" />
        <Copy v-else :size="15" />
      </button>
      <template v-if="feedback">
        <button
          type="button"
          class="shell-message-action"
          :class="{ on: rating?.rating === 'like' }"
          :title="labels.like"
          :aria-label="labels.like"
          :aria-pressed="rating?.rating === 'like'"
          @click="rate('like')"
        >
          <ThumbsUp :size="15" />
        </button>
        <button
          type="button"
          class="shell-message-action"
          :class="{ on: rating?.rating === 'dislike' }"
          :title="labels.dislike"
          :aria-label="labels.dislike"
          :aria-pressed="rating?.rating === 'dislike'"
          @click="rate('dislike')"
        >
          <ThumbsDown :size="15" />
        </button>
      </template>
      <SlotOutlet
        :content="shell.slots.messageActions"
        :scope="{ sessionId, runId: item.runId, messageId: item.answerMessageId, text: item.answerText, workspaceCommit: item.workspaceCommit }"
      />
    </div>
    <form v-if="reasonOpen" class="reason" @submit.prevent="submit({ rating: 'dislike', reason })">
      <textarea v-model="reason" rows="2" :placeholder="labels.feedbackReason" :aria-label="labels.feedbackReason" />
      <div class="reason-actions">
        <button type="button" class="ghost" @click="reasonOpen = false">{{ labels.cancel }}</button>
        <button type="submit" class="primary" :disabled="!reason.trim() || feedbackBusy">{{ labels.submit }}</button>
      </div>
    </form>
    <!-- Reviews by other parties come after the finished answer and its actions, never inside them or before them. -->
    <div v-if="!item.running && item.answerMessageId && item.reviews.length" class="reviews">
      <QualityReview
        v-for="review in item.reviews"
        :key="review.task.id"
        :review="review"
      />
    </div>
  </div>
</template>

<style scoped>
.response {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--conversation-process-gap);
}
/* The response owns each gap; answer boundaries get more space than process metadata. */
.response > .response-text:not(:first-child) {
  margin-top: calc(var(--conversation-block-gap) - var(--conversation-process-gap));
}
.process-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin-left: -8px;
}
.process-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm, 20px);
  font-variant-numeric: tabular-nums;
}
button.process-toggle {
  cursor: pointer;
  transition: background-color var(--transition-fast, 150ms);
}
/* The reply's delegated work sits after its process line's chevron. Its own padding
   is the space from the chevron, so every language's label stands as written, with no separator glyph inside it. */
button.process-toggle:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
button.process-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast, 150ms);
}
.process-toggle[aria-expanded="true"] > .chevron {
  transform: rotate(90deg);
}
.process-unknown {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--el-color-warning) 35%, transparent);
  border-radius: var(--radius-xs);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
  font: inherit;
  font-size: var(--text-xs, 12px);
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
}
.process-unknown:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.usage-entry {
  color: var(--el-text-color-tertiary);
}
.usage-breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: var(--text-xs, 12px);
  line-height: var(--leading-sm, 20px);
  color: var(--el-text-color-tertiary);
  font-variant-numeric: tabular-nums;
}
.process-region {
  display: flex;
  flex-direction: column;
  gap: var(--conversation-process-gap);
  min-width: 0;
}
.process-body {
  display: flex;
  flex-direction: column;
  gap: var(--conversation-process-gap);
  min-width: 0;
}
/* The agent's own notes in the process read quieter than its answer. */
.process-note {
  color: var(--el-text-color-secondary);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.waiting {
  display: flex;
  gap: 5px;
  padding: 10px 2px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  opacity: 0.35;
  animation: pulse 1.2s ease-in-out infinite;
}
.dot:nth-child(2) {
  animation-delay: 0.15s;
}
.dot:nth-child(3) {
  animation-delay: 0.3s;
}
.end-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--text-sm, 13px);
  line-height: 1.5;
}
.end-note svg {
  flex-shrink: 0;
  margin-top: 3px;
}
.end-note.muted {
  align-items: center;
  color: var(--el-text-color-secondary);
}
.end-note.muted svg {
  margin-top: 0;
}
.end-note.warning {
  color: var(--el-color-warning);
}
.end-note.error {
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: var(--spacing-xs);
  margin-left: -6px;
}
.response > .response-text:has(.artifact-card, .inline-artifact) + .actions {
  margin-top: calc(var(--conversation-block-gap) - var(--conversation-process-gap));
}
.reason {
  max-width: 480px;
}
.reviews {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  margin-top: calc(var(--conversation-block-gap) - var(--conversation-process-gap));
}
.reason textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 6px 10px;
  border: 1px solid var(--el-border-color-dark);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-sm, 13px);
}
.reason textarea:focus {
  outline: none;
  border-color: var(--el-color-primary);
}
.reason-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.reason-actions button {
  height: var(--control-height);
  padding: 0 14px;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm, 13px);
  cursor: pointer;
}
.ghost {
  border: 1px solid var(--el-border-color-dark);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
}
.primary {
  border: 0;
  background: var(--el-color-primary);
  color: var(--on-primary);
}
.primary:hover:not(:disabled) {
  background: var(--brand-primary-hover);
}
.primary:disabled {
  opacity: 0.5;
  cursor: default;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  50% {
    opacity: 0.9;
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dot,
  .spin {
    animation: none;
  }
}
</style>
