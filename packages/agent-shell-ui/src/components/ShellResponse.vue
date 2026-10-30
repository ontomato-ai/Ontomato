<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Check, CircleAlert, Copy, LoaderCircle, Square, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-vue-next";
import type { ShellFeedbackPort, ShellFeedbackValue } from "../types";
import SlotOutlet from "./SlotOutlet.vue";
import RetrievalActivity from "./RetrievalActivity.vue";
import { shellContextKey } from "../context";
import type { ResponseItem } from "../view";
import ShellMarkdown from "./ShellMarkdown.vue";
import ShellProcess from "./ShellProcess.vue";

const props = defineProps<{
  item: ResponseItem;
  sessionId: string | null;
  feedback?: ShellFeedbackPort;
}>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);

const copied = ref(false);
const rating = ref<ShellFeedbackValue | null>(null);
const reasonOpen = ref(false);
const reason = ref("");
const feedbackBusy = ref(false);

const target = computed(() =>
  props.sessionId && props.item.answerMessageId
    ? { sessionId: props.sessionId, runId: props.item.runId, messageId: props.item.answerMessageId }
    : null,
);
const waiting = computed(() => props.item.running && props.item.blocks.length === 0);

/** Elapsed time since the request: ticking while the run is active, final once it stopped. */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
watch(
  () => props.item.running,
  (running) => {
    if (ticker) clearInterval(ticker);
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
  const { startedAt, finishedAt, running, end } = props.item;
  const until = running ? now.value : finishedAt;
  if (startedAt === null || until === null) return null;
  const state = running ? labels.value.working : end?.stopReason === "stop" ? labels.value.done : "";
  return { state, elapsed: labels.value.elapsed(clock(until - startedAt)) };
});

onMounted(async () => {
  if (!props.feedback || !target.value) return;
  try {
    rating.value = await props.feedback.read(target.value);
  } catch {
    rating.value = null;
  }
});

async function copy() {
  await navigator.clipboard.writeText(props.item.answerText);
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
  <div class="response">
    <div v-if="status" class="status-line" :aria-live="item.running ? 'off' : 'polite'">
      <LoaderCircle v-if="item.running" :size="12" class="spin" />
      <span v-if="status.state">{{ status.state }}</span>
      <span v-if="status.state" aria-hidden="true">·</span>
      <span>{{ status.elapsed }}</span>
    </div>
    <div v-if="waiting" class="waiting" aria-live="polite">
      <span class="dot" /><span class="dot" /><span class="dot" />
      <span class="sr-only">{{ labels.working }}</span>
    </div>
    <RetrievalActivity
      v-for="link in item.retrievals"
      :key="link.retrievalId"
      :link="link"
      :parent-run-id="item.runId"
      :session-id="sessionId ?? ''"
    />
    <template v-for="block in item.blocks" :key="block.key">
      <ShellProcess v-if="block.kind === 'process'" :steps="block.steps" :active="block.active" />
      <ShellMarkdown v-else :content="block.text" :final="block.final" :run-id="block.runId" />
    </template>

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

    <div v-if="!item.running && item.answerMessageId" class="actions">
      <button type="button" class="action" :title="labels.copy" :aria-label="labels.copy" @click="copy">
        <Check v-if="copied" :size="15" />
        <Copy v-else :size="15" />
      </button>
      <template v-if="feedback">
        <button
          type="button"
          class="action"
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
          class="action"
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
        :scope="{ sessionId, runId: item.runId, messageId: item.answerMessageId, text: item.answerText }"
      />
    </div>
    <form v-if="reasonOpen" class="reason" @submit.prevent="submit({ rating: 'dislike', reason })">
      <textarea v-model="reason" rows="2" :placeholder="labels.feedbackReason" :aria-label="labels.feedbackReason" />
      <div class="reason-actions">
        <button type="button" class="ghost" @click="reasonOpen = false">{{ labels.cancel }}</button>
        <button type="submit" class="primary" :disabled="!reason.trim() || feedbackBusy">{{ labels.submit }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.response {
  min-width: 0;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--el-text-color-tertiary);
  font-size: var(--text-xs, 12px);
  font-variant-numeric: tabular-nums;
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
  margin-top: 10px;
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
  padding: 10px 12px;
  border-radius: var(--radius-lg, 12px);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 2px;
  margin-top: 6px;
  margin-left: -6px;
}
.action {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-tertiary);
  cursor: pointer;
  transition:
    color var(--transition-fast, 150ms),
    background-color var(--transition-fast, 150ms);
}
.action:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.action.on {
  color: var(--el-color-primary);
}
.action:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.reason {
  margin-top: 8px;
  max-width: 480px;
}
.reason textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg, 12px);
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
  padding: 6px 14px;
  border-radius: 999px;
  font: inherit;
  font-size: var(--text-sm, 13px);
  cursor: pointer;
}
.ghost {
  border: 1px solid var(--el-border-color);
  background: transparent;
  color: var(--el-text-color-regular);
}
.primary {
  border: 0;
  background: var(--el-color-primary);
  color: var(--on-primary, #fff);
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
