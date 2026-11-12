<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";
import { ArrowUp, Square } from "lucide-vue-next";
import type { ShellLabels } from "../types";

/**
 * The one message box of the platform: the conversation shell's, and the platform home's question box. Its words come
 * from the host that places it. A host may put controls at its lower left (`tools`, the home's agent picker); the box
 * then holds the message above a row with those controls and the send button, otherwise it is one row.
 */
const props = defineProps<{
  busy: boolean;
  disabled?: boolean;
  autofocus?: boolean;
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop">;
}>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();
const slots = useSlots();
const stacked = computed(() => slots.tools !== undefined);
const text = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const composing = ref(false);
const canSend = computed(() => !props.busy && !props.disabled && text.value.trim().length > 0);

/**
 * The composer is as tall as what it shows: the message, or while it is empty its placeholder, so a long hint is read in
 * full. It is measured again whenever the text, the placeholder or its width changes.
 */
function resize() {
  const el = input.value!;
  el.style.height = "auto";
  el.style.height = `${Math.min(textHeight(el), 220)}px`;
}
/** The height of the textarea's text; an empty one is measured with its placeholder written in. */
function textHeight(el: HTMLTextAreaElement) {
  if (el.value) return el.scrollHeight;
  el.value = el.placeholder;
  const height = el.scrollHeight;
  el.value = "";
  return height;
}
// After the textarea shows the change; a composer closed meanwhile (sent from the full page) is not measured.
watch([text, () => props.labels.placeholder], resize, { flush: "post" });
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
  <form class="composer" :class="{ disabled, stacked }" @submit.prevent="submit">
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
    <div v-if="stacked" class="composer-tools"><slot name="tools" /></div>
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
      v-else
      type="submit"
      class="composer-button"
      :disabled="!canSend"
      :title="labels.send"
      :aria-label="labels.send"
    >
      <ArrowUp :size="17" />
    </button>
  </form>
</template>

<style scoped>
/*
 * The chat composer: a pill of the composer height (radius = height / 2) with a round send button. The conversation
 * shell raises it through --shell-composer-shadow; embedded chats keep it flat.
 */
.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-height: var(--shell-composer-height);
  padding: 7px 7px 7px 20px;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-dark);
  border-radius: calc(var(--shell-composer-height) / 2);
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
/* With controls of the host's: the message on its own row, the controls and the send button under it. */
.composer.stacked {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "input input"
    "tools send";
  align-items: center;
  row-gap: 4px;
  padding: 10px 10px 10px 20px;
}
.composer.stacked textarea {
  grid-area: input;
}
.composer.stacked .composer-button {
  grid-area: send;
}
.composer-tools {
  grid-area: tools;
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
  margin-left: -10px;
}
textarea {
  flex: 1;
  min-height: var(--control-height-lg);
  max-height: 220px;
  padding: 9px 0;
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
}
.composer-button {
  display: grid;
  place-items: center;
  width: var(--control-height-lg);
  height: var(--control-height-lg);
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
