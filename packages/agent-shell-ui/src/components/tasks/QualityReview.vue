<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { ChevronRight, LoaderCircle, ShieldCheck } from "lucide-vue-next";
import { shellContextKey } from "../../context";
import type { ResponseReview } from "../../view";

/**
 * Another party's review of the reply's data, beside the reply and never part of it: folded to one line (the score, or
 * that it is checking or could not complete, and what it checked), opened for the whole conclusion, the score, a
 * better-fitting question and the checked datasets. It updates the moment the check settles, whether or not the reply
 * is still running.
 */
const props = defineProps<{ review: ResponseReview }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value.tasks!);
const open = ref(false);
const task = computed(() => props.review.task);
const result = computed(() => props.review.result);
const source = computed(() => labels.value.checkedBranch[task.value.checks.source]);
const score = computed(() => (result.value ? labels.value.score(Math.round(result.value.score)) : ""));
const reason = computed(() => {
  const error = task.value.error;
  if (task.value.status === "cancelled") return labels.value.status.cancelled;
  return error ? labels.value.errors[error.code] ?? error.message ?? labels.value.reviewFailed : labels.value.reviewFailed;
});

watch(() => shell.taskFocus?.value, (focus) => {
  if (focus?.taskId === task.value.id) open.value = true;
});
</script>

<template>
  <section :id="`agent-task-${task.id}`" class="review" :class="{ open }">
    <button type="button" class="review-line" :aria-expanded="open" @click="open = !open">
      <ShieldCheck :size="14" class="review-icon" />
      <span class="review-name">{{ labels.review }}</span>
      <span v-if="result" class="review-part score">{{ score }}</span>
      <span v-else-if="task.status === 'running'" class="review-part">
        <LoaderCircle :size="12" class="spin" /> {{ labels.reviewRunning }}
      </span>
      <span v-else class="review-part failed">{{ reason }}</span>
      <span class="review-part source">{{ labels.checkedSource(source) }}</span>
      <ChevronRight :size="14" class="chevron" />
    </button>
    <dl v-if="open" class="review-body">
      <template v-if="result">
        <dt>{{ labels.conclusion }}</dt>
        <dd>{{ result.conclusion }}</dd>
        <dt>{{ labels.scoreLabel }}</dt>
        <dd>{{ score }}</dd>
        <dt>{{ labels.fittedQuestion }}</dt>
        <dd>{{ result.fittedQuestion }}</dd>
      </template>
      <template v-else-if="task.status !== 'running'">
        <dt>{{ labels.reviewFailed }}</dt>
        <dd>{{ reason }}</dd>
      </template>
      <dt>{{ labels.checked }}</dt>
      <dd>{{ source }}<template v-if="review.datasets.length">: {{ review.datasets.map((dataset) => dataset.title).join("、") }}</template></dd>
    </dl>
  </section>
</template>

<style scoped>
/* Signed and set apart from the answer: another party's opinion, not the agent's text. */
.review {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md);
  background: var(--el-fill-color-lighter);
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm);
}
.review-line {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 6px 10px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.review-line:hover {
  background: var(--el-fill-color-light);
}
.review-line:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.review-icon {
  flex-shrink: 0;
  color: var(--el-color-primary);
}
.review-name {
  flex-shrink: 0;
  color: var(--el-text-color-regular);
  font-weight: 500;
}
.review-part {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.review-part::before {
  content: "·";
  margin-right: 2px;
  color: var(--el-text-color-tertiary);
}
.score {
  color: var(--el-text-color-regular);
  font-variant-numeric: tabular-nums;
}
.source {
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.failed {
  flex-shrink: 1;
  min-width: 0;
  color: var(--el-color-danger);
}
.chevron {
  flex-shrink: 0;
  margin-left: auto;
  transition: transform var(--transition-fast, 150ms);
}
.open .chevron {
  transform: rotate(90deg);
}
.review-body {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 12px;
  margin: 0;
  padding: 4px 12px 10px 30px;
  color: var(--el-text-color-regular);
}
.review-body dt {
  color: var(--el-text-color-secondary);
}
.review-body dd {
  margin: 0;
  overflow-wrap: anywhere;
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
