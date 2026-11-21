<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { usePanelContext, useProjectionSlot } from "../panel/context";

/**
 * Generic conversation entry button (U18): bound to a projection whose `conversationEntry` declares an agent target
 * (`id`, `preset`, or `page-default`) and an optional opening sentence — written out (`prefill`), or a key into the
 * panel's messages (`prefillKey`), read in the reader's language and else the deployment's default. Clicking only asks
 * the host to expand the page's composer with that declaration; it never sends a message and carries no business copy
 * of its own.
 */
const props = withDefaults(
  defineProps<{
    /** Optional panel message key for the button label (resolved via `panel.t`; falls back to projection name). */
    labelKey?: string;
    /** Button visual emphasis. */
    type?: "primary" | "default";
    /** Disables the entry button. */
    disabled?: boolean;
  }>(),
  {
    labelKey: undefined,
    type: "default",
    disabled: false,
  },
);

const emit = defineEmits<{
  /** Emitted after the host accepts the request to expand the page's composer. */
  expanded: [];
  /** Emitted when the projection lacks a declared conversationEntry or the host refuses the request. */
  error: [error: Error];
}>();

const { t } = useI18n();
const panel = usePanelContext();
const slot = useProjectionSlot();

const opening = ref(false);
const failure = shallowRef<Error | null>(null);

const buttonLabel = computed(() => {
  if (props.labelKey) return panel.t(props.labelKey);
  if (slot.projection.name) return slot.projection.name;
  return t("platform.conversationEntryOpen");
});

async function openComposer() {
  if (props.disabled || opening.value) return;
  failure.value = null;
  const entry = slot.projection.conversationEntry;
  if (!entry) {
    const err = new Error(`The projection in slot '${slot.slot}' declares no conversationEntry`);
    failure.value = err;
    emit("error", err);
    return;
  }
  opening.value = true;
  try {
    // The panel's text answers the key itself where neither the reader's language nor the default has words for it:
    // the composer then opens with no sentence, never with the key.
    const keyed = entry.prefillKey !== undefined ? panel.t(entry.prefillKey) : undefined;
    const prefill = entry.prefillKey !== undefined ? (keyed === entry.prefillKey ? undefined : keyed) : entry.prefill;
    await panel.expandPageComposer({
      slot: slot.slot,
      target: entry.target,
      ...(prefill !== undefined ? { prefill } : {}),
    });
    emit("expanded");
  } catch (reason: unknown) {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    failure.value = err;
    emit("error", err);
  } finally {
    opening.value = false;
  }
}
</script>

<template>
  <div class="sdk-conversation-entry">
    <button
      type="button"
      class="sdk-conversation-entry-btn"
      :class="{ primary: type === 'primary' }"
      :disabled="disabled || opening"
      @click="openComposer"
    >
      {{ buttonLabel }}
    </button>
    <p v-if="failure" role="alert" class="sdk-conversation-entry-error">{{ failure.message }}</p>
  </div>
</template>

<style scoped>
/* A primary action is solid; any other is a neutral outline with a quiet fill on hover and press (DESIGN.md). */
.sdk-conversation-entry {
  display: inline-flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-conversation-entry-btn {
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--text-sm);
  height: var(--control-height);
  padding: 0 var(--spacing-lg);
  transition: background-color var(--transition-fast);
}
.sdk-conversation-entry-btn:hover:not(:disabled) {
  background: var(--ui-fill-tertiary);
}
.sdk-conversation-entry-btn:active:not(:disabled) {
  background: var(--ui-fill-quaternary);
}
.sdk-conversation-entry-btn.primary {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: var(--on-primary);
}
.sdk-conversation-entry-btn.primary:hover:not(:disabled) {
  background: var(--brand-primary-hover);
  border-color: var(--brand-primary-hover);
}
.sdk-conversation-entry-btn:focus-visible {
  outline: 2px solid var(--brand-link);
  outline-offset: 2px;
}
.sdk-conversation-entry-btn:disabled {
  background: var(--el-fill-color-light);
  border-color: var(--ui-divider);
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
}
.sdk-conversation-entry-error {
  color: var(--el-color-danger-text);
  font-size: var(--text-xs);
  margin: 0;
}
</style>
