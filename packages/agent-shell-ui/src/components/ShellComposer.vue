<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";
import { ArrowUp, Square } from "lucide-vue-next";
import type { ShellLabels } from "../types";

/**
 * The one message box of the platform: the conversation shell's, the platform home's question box and the composer at
 * the foot of a full page. Every one of them is the same control at the same height — a single row of what the message
 * is written as: the agent it goes to (`agent`), the input, what the message carries (`context`) and send.
 *
 * A host may put more controls after the agent (`tools`, the home's own choices); they stay on the row, and the message
 * that follows the input takes what is left. Long input grows the row rather than being cut, and a narrow width gives way
 * in the input, never in the send button.
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
 * The composer is as tall as the message: one line while it is empty, however long its placeholder, and taller as the
 * reader writes. It is measured again whenever the text or its width changes. The placeholder itself is a single line,
 * cut with an ellipsis, so a narrow row keeps the agent choice and send on their row instead of widening them away.
 */
function resize() {
  const el = input.value!;
  el.style.height = "auto";
  el.style.height = `${Math.min(textHeight(el), 220)}px`;
}
/** The height of the textarea's text: one line while it is empty, however long the placeholder is. */
function textHeight(el: HTMLTextAreaElement) {
  return el.scrollHeight;
}
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
  <form class="composer" :class="{ disabled }" @submit.prevent="submit">
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
 * One row, one height for every host: a 40px container around 32px controls (the input line, the send button, whatever
 * a host puts on the row), its radius half its height. The conversation shell raises it through --shell-composer-shadow;
 * embedded chats keep it flat.
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
/* The message takes the rest of the row; the controls beside it keep their size however narrow the width gets. */
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
  /* One line, cut short: a long hint never makes the row taller than a message. */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* What the message carries, beside the input on its last line; cut short rather than pushing the input away. */
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
