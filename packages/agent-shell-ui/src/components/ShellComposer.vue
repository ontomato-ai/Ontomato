<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots, watch } from "vue";
import { ArrowUp, MessageSquare, Minus, Square } from "lucide-vue-next";
import type { ShellLabels } from "../types";
import { useComposerCollapsed } from "../composer-collapsed";

/**
 * The one message box of the platform: the conversation shell's, the platform home's question box and the composer at
 * the foot of a page. One control; where it stands decides its shape (the user's decision, 2026-11-18, against Codex).
 *
 * In a conversation it is one block three lines high: two lines to write in and a line of controls under them — what the
 * message carries on the left, send or stop on the right. Two lines are not a limit: the block grows upward with the
 * message to eight lines and scrolls inside after that.
 *
 * Floating over a page (`floating`) it takes as little of the page as it can. Its upper layer holds its fold button and
 * the agent the message goes to (`agent`); its lower layer is one line of input and send, growing upward to six lines and
 * scrolling after that. Folded, the whole box becomes a round button at the page's lower right; opened again, what was
 * being written is still there. The fold is the reader's own choice and this browser remembers it.
 *
 * A host may put more controls beside the agent (`tools`, the home's own choices). A narrow width gives way in the input,
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
  /** The box floats over a page (a page's foot, a full page beside the conversation) rather than standing under a conversation. */
  floating?: boolean;
  /** A floating box also names its fold and its round button; a conversation's box has neither. */
  labels: Pick<ShellLabels, "placeholder" | "send" | "stop"> & Partial<Pick<ShellLabels, "collapseComposer" | "expandComposer">>;
}>();
const emit = defineEmits<{ send: [text: string]; stop: [] }>();
const slots = useSlots();
const text = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const composing = ref(false);
const hasText = computed(() => text.value.trim().length > 0);
const canSend = computed(() => !props.sending && !props.disabled && hasText.value);
const { collapsed, setCollapsed } = useComposerCollapsed();
/** Only a floating box folds; the conversation's own is always there. */
const folded = computed(() => props.floating && collapsed.value);

/** The lines the input shows before it grows, and the lines it grows to before it scrolls. */
const lines = computed(() => (props.floating ? { least: 1, most: 6 } : { least: 2, most: 8 }));

/**
 * The input is as tall as the message, between its least and most lines; past the most, it scrolls inside. It is
 * measured again whenever the text or its width changes; the placeholder is a single line, cut with an ellipsis.
 */
function resize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  const style = getComputedStyle(el);
  const line = Number.parseFloat(style.lineHeight);
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const written = Math.max(1, Math.round((el.scrollHeight - padding) / line));
  const shown = Math.min(Math.max(written, lines.value.least), lines.value.most);
  el.style.height = `${shown * line + padding}px`;
  el.style.overflowY = written > lines.value.most ? "auto" : "hidden";
}
// After the textarea shows the change; a composer closed meanwhile (sent from the full page) is not measured.
watch([text, lines, folded], resize, { flush: "post" });
const sizer = new ResizeObserver(() => resize());
watch(input, (el, previous) => {
  if (previous) sizer.unobserve(previous);
  if (el) sizer.observe(el);
});
onMounted(resize);
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

/** Folding keeps what was written: it is the same box, out of the page's way. */
function fold() {
  setCollapsed(true);
}
function unfold() {
  setCollapsed(false);
  void Promise.resolve().then(() => input.value?.focus());
}

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <button
    v-if="folded"
    type="button"
    class="composer-unfold"
    :title="labels.expandComposer"
    :aria-label="labels.expandComposer"
    @click="unfold"
  >
    <MessageSquare :size="18" />
  </button>
  <form v-else class="composer" :class="{ disabled, floating }" @submit.prevent="submit">
    <!-- A floating box's upper layer: its fold, then the agent the message goes to and the host's own choices. -->
    <div v-if="floating" class="composer-bar">
      <button type="button" class="composer-fold" :title="labels.collapseComposer" :aria-label="labels.collapseComposer" @click="fold">
        <Minus :size="16" />
      </button>
      <div v-if="$slots.agent" class="composer-agent"><slot name="agent" /></div>
      <div v-if="$slots.tools" class="composer-tools"><slot name="tools" /></div>
    </div>
    <div class="composer-body">
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
      <div class="composer-controls">
        <template v-if="!floating">
          <div v-if="$slots.agent" class="composer-agent"><slot name="agent" /></div>
          <div v-if="$slots.tools" class="composer-tools"><slot name="tools" /></div>
        </template>
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
      </div>
    </div>
  </form>
</template>

<style scoped>
/*
 * One block. Under a conversation: the input across the whole width, two lines high to start, and the controls on the
 * line under it — what the message carries on the left, send on the right. Floating over a page: an upper layer with the
 * fold and the agent, and a lower layer where the input and send share one line. The conversation shell raises it through
 * --shell-composer-shadow; embedded chats keep it flat.
 */
.composer {
  container: shell-composer / inline-size;
  --composer-control: var(--control-height);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  border: 1px solid var(--el-border-color-dark);
  border-radius: var(--radius-2xl);
  background: var(--el-bg-color);
  box-shadow: var(--shell-composer-shadow, none);
  overflow: hidden;
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
.composer-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-md);
}
.composer-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
/* Floating: the lower layer is one line, input and send, the input growing upward and send staying at its foot. */
.composer.floating .composer-body {
  flex-direction: row;
  align-items: flex-end;
}
.composer.floating .composer-controls {
  flex-shrink: 0;
}
.composer.floating textarea {
  flex: 1 1 auto;
}
.composer-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
  padding: var(--spacing-xs) var(--spacing-sm);
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
.composer-fold,
.composer-unfold {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  border: 0;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.composer-fold {
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border-radius: var(--radius-md);
  background: transparent;
}
.composer-fold:hover {
  background: var(--el-fill-color);
}
/*
 * Folded: a round button at the page's lower right, the room under it the same as under the box it folds from; the page
 * shows everywhere else. A floating box is the page's own, and the page reaches the window's lower right.
 */
.composer-unfold {
  position: fixed;
  z-index: 5;
  right: var(--spacing-lg);
  bottom: var(--shell-composer-foot);
  width: var(--control-height-lg);
  height: var(--control-height-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-full);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  box-shadow: var(--elevation-composer);
}
.composer-agent,
.composer-tools {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--spacing-xs);
  min-width: 0;
}
/* Narrow, the agent choice gives way before anything else: its name is cut to an ellipsis, then to the avatar alone. */
.composer-agent {
  flex-shrink: 1;
  max-width: 60%;
}
@container shell-composer (max-width: 300px) {
  .composer-agent .switch-name {
    display: none;
  }
}
/*
 * The message takes the width; its height is the one its lines set as it grows. Under a conversation it stands in a
 * column, where a flexible basis would override that height, so it does not flex there; floating, it shares one line with
 * send and takes what that line leaves.
 */
textarea {
  flex: none;
  width: 100%;
  min-width: 0;
  padding: calc((var(--composer-control) - var(--leading-base)) / 2) 0;
  box-sizing: border-box;
  border: 0;
  outline: none;
  resize: none;
  overflow-y: hidden;
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
/* What the message carries, on the controls' line at the left; cut short rather than pushing send away. */
.composer-context {
  flex: 0 1 auto;
  max-width: 60%;
  min-width: 0;
}
.composer-context:empty {
  display: none;
}
.composer-actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  margin-inline-start: auto;
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
.composer-button:focus-visible,
.composer-fold:focus-visible,
.composer-unfold:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
