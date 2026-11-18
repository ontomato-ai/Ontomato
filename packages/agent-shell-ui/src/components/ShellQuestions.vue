<script setup lang="ts">
import { computed, inject, nextTick, ref, useId, watch } from "vue";
import { ChevronLeft, ChevronRight, MessageCircleQuestionMark } from "lucide-vue-next";
import { shellContextKey, type QuestionDraft } from "../context";
import ShellMarkdown from "./ShellMarkdown.vue";

/**
 * The questions the conversation's agents asked the reader, right over the composer (as Codex shows its asynchronous
 * questions). It opens as soon as there is a question and shows one at a time: the question and its options numbered,
 * the agent's default marked, with the reader's own answer last; a number key picks an option. The reader may fold it to
 * the number of questions while the agents go on working. The reader moves between the questions, each keeping its
 * unsent draft, and may skip one: skipping only hides it here and sends nothing, so the agent keeps its default and a
 * reload lists the question again. Once every question is answered or skipped the panel is gone; the next question opens
 * it again. The panel and the composer keep their own text.
 */
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);
const { pending, sending, view } = shell.questions;
const bodyId = useId();
const other = ref<HTMLInputElement | null>(null);
const submitButton = ref<HTMLButtonElement | null>(null);

const questions = computed(() => pending.value.filter((question) => !view.skipped.includes(question.requestId)));
const index = computed(() => Math.max(0, questions.value.findIndex((question) => question.requestId === view.current)));
const question = computed(() => questions.value[index.value]);
const options = computed(() => question.value?.options ?? []);
const draft = computed<QuestionDraft>(() => view.drafts[question.value!.requestId] ?? { choice: null, other: "" });
const answer = computed(() => {
  const { choice, other } = draft.value;
  if (choice === "other") return other.trim();
  return choice === null ? "" : options.value[choice]!.label;
});

// Once no question is left the panel is gone, and the next one arrives open even if the reader had folded it.
watch(() => questions.value.length === 0, (none) => {
  if (none) view.open = true;
});

function edit(change: Partial<QuestionDraft>) {
  view.drafts[question.value!.requestId] = { ...draft.value, ...change };
}

/** Picks an option, or the reader's own answer; the next step is sending it, or typing it. */
async function choose(choice: number | "other") {
  edit({ choice });
  await nextTick();
  (choice === "other" ? other.value : submitButton.value)?.focus();
}

function move(step: number) {
  view.current = questions.value[index.value + step]!.requestId;
}

function skip() {
  const skipped = question.value!.requestId;
  view.current = (questions.value[index.value + 1] ?? questions.value[index.value - 1])?.requestId ?? null;
  view.skipped.push(skipped);
}

/** A picked option goes with its index, the reader's own words without one. */
async function submit() {
  const current = question.value;
  if (!current || !answer.value || sending.value) return;
  const text = answer.value;
  const { choice } = draft.value;
  const next = (questions.value[index.value + 1] ?? questions.value[index.value - 1])?.requestId ?? null;
  if (!(await shell.questions.answer(current.requestId, text, typeof choice === "number" ? choice : undefined))) return;
  delete view.drafts[current.requestId];
  view.current = next;
}

/** A number key picks that option, unless the reader is typing their own answer. */
function onKeydown(event: KeyboardEvent) {
  if (!view.open || event.target instanceof HTMLInputElement || event.altKey || event.ctrlKey || event.metaKey) return;
  const number = Number(event.key);
  if (!Number.isInteger(number) || number < 1 || number > options.value.length + 1) return;
  event.preventDefault();
  void choose(number <= options.value.length ? number - 1 : "other");
}
</script>

<template>
  <section v-if="question" class="questions" :class="{ open: view.open }" @keydown="onKeydown">
    <div class="questions-head">
      <button
        type="button"
        class="questions-toggle"
        :aria-expanded="view.open"
        :aria-controls="bodyId"
        @click="view.open = !view.open"
      >
        <MessageCircleQuestionMark :size="14" class="questions-icon" />
        <span>{{ labels.questionsWaiting(questions.length) }}</span>
        <ChevronRight :size="14" class="chevron" />
      </button>
      <template v-if="view.open">
        <div v-if="questions.length > 1" class="questions-nav">
          <button
            type="button"
            class="questions-step"
            :disabled="index === 0"
            :title="labels.questionPrevious"
            :aria-label="labels.questionPrevious"
            @click="move(-1)"
          >
            <ChevronLeft :size="14" />
          </button>
          <span class="questions-position">{{ index + 1 }} / {{ questions.length }}</span>
          <button
            type="button"
            class="questions-step"
            :disabled="index === questions.length - 1"
            :title="labels.questionNext"
            :aria-label="labels.questionNext"
            @click="move(1)"
          >
            <ChevronRight :size="14" />
          </button>
        </div>
        <button type="button" class="questions-skip" @click="skip">{{ labels.questionSkip }}</button>
      </template>
    </div>
    <form v-if="view.open" :id="bodyId" class="questions-body" @submit.prevent="submit">
      <div class="question">
        <ShellMarkdown class="question-text" :content="question.message" final :run-id="question.source.runId" />
        <div class="question-options">
          <button
            v-for="(option, i) in options"
            :key="i"
            type="button"
            class="question-option"
            :class="{ chosen: draft.choice === i }"
            :aria-pressed="draft.choice === i"
            @click="choose(i)"
          >
            <span class="option-number">{{ i + 1 }}</span>
            <span class="option-label">
              {{ option.label }}
              <span v-if="option.isDefault" class="option-default">{{ labels.questionOptionDefault }}</span>
            </span>
          </button>
          <label class="question-option other" :class="{ chosen: draft.choice === 'other', alone: !options.length }">
            <span v-if="options.length" class="option-number">{{ options.length + 1 }}</span>
            <span v-if="options.length" class="option-label">{{ labels.questionOptionOther }}</span>
            <input
              ref="other"
              :value="draft.other"
              :placeholder="labels.questionOtherPlaceholder"
              :aria-label="labels.questionOptionOther"
              @input="edit({ choice: 'other', other: ($event.target as HTMLInputElement).value })"
            >
          </label>
        </div>
      </div>
      <div class="questions-actions">
        <button ref="submitButton" type="submit" class="questions-submit" :disabled="!answer || sending">
          {{ labels.submit }}
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
/*
 * Folded, the panel is one quiet pill over the composer; open, it is a surface of the composer's own elevation with
 * the questions inside, so it reads as part of the composer area rather than of the conversation.
 */
.questions {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.questions.open {
  padding: var(--spacing-xs) var(--spacing-md) var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg);
  background: var(--el-bg-color);
  box-shadow: var(--shell-composer-shadow, none);
}
.questions-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.questions-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control-height-sm);
  margin-inline-end: auto;
  padding: 0 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-full);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font: inherit;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.questions.open .questions-toggle {
  margin-inline-start: -8px;
  padding: 0 8px;
  border-color: transparent;
  border-radius: var(--radius-sm);
  font-weight: 500;
}
.questions-toggle:hover {
  background: var(--el-fill-color);
}
.questions-icon {
  color: var(--el-color-primary);
}
.chevron {
  color: var(--el-text-color-tertiary);
  transition: transform var(--transition-fast);
}
.open .chevron {
  transform: rotate(90deg);
}
.questions-nav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.questions-position {
  min-width: 36px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.questions-step,
.questions-skip {
  display: inline-grid;
  place-items: center;
  height: var(--control-height-inline);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  cursor: pointer;
}
.questions-step {
  width: var(--control-height-inline);
}
.questions-skip {
  padding: 0 8px;
}
.questions-step:hover:not(:disabled),
.questions-skip:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.questions-step:disabled {
  color: var(--el-text-color-disabled);
  cursor: default;
}
.questions-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-top: var(--spacing-xs);
}
/* A long question or many options scroll inside the panel; its actions stay in view. */
.question {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  max-height: min(45vh, 420px);
  overflow-y: auto;
}
.question-text {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  line-height: var(--leading-base);
  overflow-wrap: anywhere;
}
.question-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.question-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}
.question-option:hover {
  background: var(--el-fill-color-light);
}
.question-option.chosen {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.question-option:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -1px;
}
.option-number {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.chosen .option-number {
  background: var(--el-color-primary);
  color: var(--on-primary);
}
.option-label {
  min-width: 0;
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.option-default {
  margin-inline-start: 6px;
  padding: 0 4px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-xs);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  white-space: nowrap;
}
/* The reader's own answer is typed in place, the last option of the list. */
.question-option.other {
  align-items: center;
  cursor: text;
}
.question-option.other .option-label {
  flex: none;
}
/* With no options to pick from, it is the question's one answer field. */
.question-option.other.alone {
  border-color: var(--el-border-color-dark);
}
.question-option.other:focus-within {
  border-color: var(--el-color-primary);
}
.question-option input {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
}
.question-option input::placeholder {
  color: var(--el-text-color-placeholder);
}
.questions-actions {
  display: flex;
  justify-content: flex-end;
}
.questions-submit {
  height: var(--control-height-sm);
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--el-color-primary);
  color: var(--on-primary);
  font: inherit;
  cursor: pointer;
}
.questions-submit:hover:not(:disabled) {
  background: var(--brand-primary-hover);
}
.questions-submit:disabled {
  background: var(--el-fill-color);
  color: var(--el-text-color-disabled);
  cursor: default;
}
.questions-toggle:focus-visible,
.questions-step:focus-visible,
.questions-skip:focus-visible,
.questions-submit:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}
</style>
