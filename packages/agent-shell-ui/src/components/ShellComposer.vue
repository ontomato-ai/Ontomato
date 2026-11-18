<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";
import { ArrowUp, Square } from "lucide-vue-next";
import type { ShellLabels } from "../types";

/**
 * The one message box of the platform: the conversation shell's, the platform home's question box and the composer at
 * the foot of a full page. It is one control with one layout in two states.
 *
 * Collapsed it is a single row — the agent it goes to (`agent`), the input, what the message carries (`context`), send —
 * at the height of one control, so a page it sits on keeps its room. Expanded it is two rows, the way Codex lays its box
 * out: the input on top, across the whole width, and under it the controls, the agent and what the message carries on the
 * left and send or stop on the right.
 *
 * A conversation's composer is `expanded` from the start: it is the page's own subject, and one row in the middle of an
 * empty conversation looks lost. A page's composer starts collapsed and expands once what is written takes more than one
 * line, then collapses again when it is emptied. That is the one difference between them; the layout is the same.
 *
 * A host may put more controls after the agent (`tools`, the home's own choices). A narrow width gives way in the input,
 * never in the send button.
 *
 * While the agent works (`busy`) the reader still sends: the message goes into the running reply. The stop button stands
 * beside the send button then, which shows once there is something to send. Only a message still on its way (`sending`)
 * holds the next one back, and the box keeps its text until it can go.
 */
const props = defineProps<{
  busy: boolean;
  sending?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  /** Two rows from the start (a conversation's composer); otherwise one row until the message takes more than one line. */
  expanded?: boolean;
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop">;
}>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();
const slots = useSlots();
const text = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const composing = ref(false);
const hasText = computed(() => text.value.trim().length > 0);
const canSend = computed(() => !props.sending && !props.disabled && hasText.value);

/**
 * The input is as tall as the message: one line while it is empty, however long its placeholder, and taller as the reader
 * writes. It is measured again whenever the text or its width changes. The placeholder itself is a single line, cut with
 * an ellipsis.
 */
const multiline = ref(false);
/** The input's height holding one line: what it measures while empty. */
let oneLine = 0;
function resize() {
  const el = input.value!;
  el.style.height = "auto";
  const height = el.scrollHeight;
  el.style.height = `${Math.min(height, 220)}px`;
  if (!text.value) oneLine = height;
  // More than one line of message expands a collapsed composer; once open it stays open until the message is gone, so the
  // wider input of the expanded layout cannot fold it back to one row while the reader is writing.
  multiline.value = text.value.length > 0 && (multiline.value || height > oneLine);
}
const open = computed(() => props.expanded || multiline.value);
// After the textarea shows the change; a composer closed meanwhile (sent from the full page) is not measured.
watch(text, resize, { flush: "post" });
const sizer = new ResizeObserver(() => resize());
onMounted(() => {
  resize();
  sizer.observe(input.value!);
});
onBeforeUnmount(() => sizer.disconnect());

function submit() {
  if (!canSend.value) return;
  emit("send", text.value);
  text.value = "";
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !composing.value && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <form class="composer" :class="{ disabled, open }" @submit.prevent="submit">
    <div v-if="$slots.agent" class="composer-agent"><slot name="agent" /></div>
    <textarea
      ref="input"
      v-model="text"
      rows="1"
      :placeholder="labels.placeholder"
      :aria-label="labels.placeholder"
      :disabled="disabled"
      :autofocus="autofocus"
      @keydown="onKeydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <div v-if="$slots.tools" class="composer-tools"><slot name="tools" /></div>
    <div v-if="$slots.context" class="composer-context"><slot name="context" /></div>
    <div class="composer-actions">
      <button
        v-if="busy"
        type="button"
        class="composer-button stop"
        :title="labels.stop"
        :aria-label="labels.stop"
        @click="emit('stop')"
      >
        <Square :size="12" fill="currentColor" />
      </button>
      <button
        v-if="!busy || hasText"
        type="submit"
        class="composer-button"
        :disabled="!canSend"
        :title="labels.send"
        :aria-label="labels.send"
      >
        <ArrowUp :size="16" />
      </button>
    </div>
  </form>
</template>

<style scoped>
/*
 * One control, one layout, two states. Collapsed, its parts stand on one row in the order they are written — agent,
 * input, tools, what the message carries, send — at the height of one control. Open, the same row wraps: the input moves
 * to the first line and takes the whole width from the left edge, and the controls take the line under it, the agent and
 * what the message carries on the left and send on the right. The conversation shell raises it through
 * --shell-composer-shadow; embedded chats keep it flat.
 */
.composer {
  container: shell-composer / inline-size;
  --composer-control: var(--control-height);
  --composer-height: var(--control-height-lg);
  --composer-inset: calc((var(--composer-height) - var(--composer-control) - 2px) / 2);
  display: flex;
  align-items: flex-end;
  gap: 6px;
  min-height: var(--composer-height);
  padding: var(--composer-inset);
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-dark);
  border-radius: calc(var(--composer-height) / 2);
  background: var(--el-bg-color);
  box-shadow: var(--shell-composer-shadow, none);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}
/* Open: the input first, across the whole width; the controls on the line under it; corners for the taller box. */
.composer.open {
  flex-wrap: wrap;
  row-gap: var(--spacing-xs);
  padding-inline-start: var(--spacing-md);
  border-radius: var(--radius-2xl);
}
.composer.open textarea {
  order: -1;
  flex-basis: 100%;
}
.composer.open .composer-actions {
  margin-inline-start: auto;
}
.composer:focus-within {
  border-color: var(--el-color-primary);
}
.composer.disabled {
  opacity: 0.6;
}
.composer-agent,
.composer-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}
/*
 * Narrow, the agent choice gives way before the input does: the name is cut to an ellipsis and, below that, to the
 * avatar and chevron, so the row stays one row and the message keeps the width.
 */
.composer-agent {
  flex-shrink: 1;
  max-width: 40%;
}
@container shell-composer (max-width: 300px) {
  .composer-agent .switch-name {
    display: none;
  }
}
/* The message takes the rest of its row; the controls beside it keep their size however narrow the width gets. */
textarea {
  flex: 1;
  min-width: 0;
  min-height: var(--composer-control);
  max-height: 220px;
  padding: calc((var(--composer-control) - var(--leading-base)) / 2) 0;
  box-sizing: border-box;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
textarea::placeholder {
  color: var(--el-text-color-placeholder);
  /* One line, cut short: a long hint never makes the box taller than a message. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* What the message carries, after the input on one row and after the agent when open; cut short rather than pushing. */
.composer-context {
  flex: 0 1 auto;
  max-width: 45%;
  min-width: 0;
  margin-bottom: calc((var(--composer-control) - 24px) / 2);
}
.composer-context:empty {
  display: none;
}
.composer-actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
}
.composer-button {
  display: grid;
  place-items: center;
  width: var(--composer-control);
  height: var(--composer-control);
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--el-color-primary);
  color: var(--on-primary);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    opacity var(--transition-fast);
}
.composer-button:hover:not(:disabled) {
  background: var(--brand-primary-hover);
}
.composer-button:disabled {
  background: var(--el-fill-color);
  color: var(--el-text-color-disabled);
  cursor: default;
}
.composer-button.stop {
  background: var(--el-text-color-primary);
  color: var(--el-bg-color);
}
.composer-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
