<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from "vue";
import { ArrowUp, Square } from "lucide-vue-next";
import { shellContextKey } from "../context";

const props = defineProps<{ busy: boolean; disabled?: boolean; autofocus?: boolean }>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();
const shell = inject(shellContextKey)!;
const text = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const composing = ref(false);
const canSend = computed(() => !props.busy && !props.disabled && text.value.trim().length > 0);

function resize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}
watch(text, () => nextTick(resize));

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
    <textarea
      ref="input"
      v-model="text"
      rows="1"
      :placeholder="shell.labels.value.placeholder"
      :aria-label="shell.labels.value.placeholder"
      :disabled="disabled"
      :autofocus="autofocus"
      @keydown="onKeydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <button
      v-if="busy"
      type="button"
      class="composer-button stop"
      :title="shell.labels.value.stop"
      :aria-label="shell.labels.value.stop"
      @click="emit('stop')"
    >
      <Square :size="12" fill="currentColor" />
    </button>
    <button
      v-else
      type="submit"
      class="composer-button"
      :disabled="!canSend"
      :title="shell.labels.value.send"
      :aria-label="shell.labels.value.send"
    >
      <ArrowUp :size="17" />
    </button>
  </form>
</template>

<style scoped>
.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 10px 10px 10px 18px;
  border: 1px solid var(--el-border-color);
  border-radius: 24px;
  background: var(--el-bg-color);
  box-shadow: var(--el-shadow-sm);
  transition:
    border-color var(--transition-fast, 150ms),
    box-shadow var(--transition-fast, 150ms);
}
.composer:focus-within {
  border-color: var(--el-color-primary-light-5);
  box-shadow: var(--el-shadow);
}
.composer.disabled {
  opacity: 0.6;
}
textarea {
  flex: 1;
  min-height: 24px;
  max-height: 220px;
  padding: 6px 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-base, 15px);
  line-height: 1.55;
}
textarea::placeholder {
  color: var(--el-text-color-placeholder);
}
.composer-button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 0;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: var(--on-primary, #fff);
  cursor: pointer;
  transition:
    background-color var(--transition-fast, 150ms),
    opacity var(--transition-fast, 150ms);
}
.composer-button:hover:not(:disabled) {
  background: var(--el-color-primary-dark-2);
}
.composer-button:disabled {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-tertiary);
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
