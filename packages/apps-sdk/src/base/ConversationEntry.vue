<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { usePanelContext, useProjectionSlot } from "../panel/context";

/**
 * Generic conversation entry button (U18): bound to a projection whose `conversationEntry` declares an agent target
 * (`id`, `preset`, or `page-default`) and optional prefill text. Clicking only asks the host to expand the page's
 * composer with that exact declaration; it never sends a message and carries no business copy of its own.
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
    await panel.expandPageComposer({
      slot: slot.slot,
      target: entry.target,
      ...(entry.prefill !== undefined ? { prefill: entry.prefill } : {}),
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
.sdk-conversation-entry {
  display: inline-flex;
  flex-direction: column;
  gap: 6px;
}
.sdk-conversation-entry-btn {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--el-font-size-small, 12px);
  min-height: 30px;
  padding: 4px 12px;
}
.sdk-conversation-entry-btn.primary {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: var(--el-color-white, #fff);
}
.sdk-conversation-entry-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.sdk-conversation-entry-error {
  color: var(--el-color-danger);
  font-size: var(--el-font-size-small, 12px);
  margin: 0;
}
</style>
