<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { panelOperationId, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import { invokeAppBridge } from "../bridge";
import { slotInputState, usePanelContext, useProjectionSlot } from "../panel/context";

/**
 * Owner-download trigger bound to a declared `PlatformOperation` (such as a skill package export or filtered CSV
 * export). The sandboxed frame never enables `allow-downloads` and never fetches or saves files itself: clicking only
 * dispatches a structured download request over the bridge so the host executes the declared owner action with the
 * reader's own credential.
 */
const props = withDefaults(
  defineProps<{
    /** Operation published by this projection; defaults to the first published operation. */
    operation?: string;
    /** Optional slot input whose panel state holds the target object (omitted for collection exports). */
    input?: string;
    /** Optional query/filter parameters passed in `request.input` (for example active list filters). */
    params?: Readonly<Record<string, unknown>>;
    /** Button text (panel message key via `panel.t` or literal; defaults to the published operation label). */
    label?: string;
    /** Button emphasis: `"primary"` or `"default"`. */
    type?: "primary" | "default";
    /** Disables the download trigger. */
    disabled?: boolean;
  }>(),
  {
    operation: "",
    input: undefined,
    params: undefined,
    label: undefined,
    type: "default",
    disabled: false,
  },
);

const emit = defineEmits<{
  /** Emitted once the host accepts and completes the download request. */
  downloaded: [];
  /** Emitted when the host rejects or fails the download request. */
  error: [error: Error];
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const downloading = ref(false);
const failure = shallowRef<Error | null>(null);

const published = computed(() => {
  const registration = panel.instance.projections.value.find((item) => item.slot === slot.slot);
  if (!registration) throw new Error(`The projection in slot '${slot.slot}' is not registered yet`);
  const found = props.operation
    ? registration.ports.operations.find((item) => item.name === props.operation)
    : registration.ports.operations[0];
  if (!found) throw new Error(`The projection in slot '${slot.slot}' publishes no operation '${props.operation}'`);
  return found;
});

const targetState = computed(() => slotInputState(panel.manifest, slot.slot, props.input));
const target = computed<PanelOperationCall["target"]>(() => {
  if (!targetState.value) return null;
  const selected = panel.instance.state.values.value[targetState.value];
  return selected && typeof selected === "object"
    ? { kind: "object", objectType: selected.className, primaryKey: selected.primaryKey }
    : null;
});

const buttonLabel = computed(() => (props.label ? panel.t(props.label) : published.value.label));
const isDisabled = computed(() => props.disabled || downloading.value || (targetState.value !== null && target.value === null));

async function requestDownload() {
  downloading.value = true;
  failure.value = null;
  try {
    await invokeAppBridge("download", {
      slot: slot.slot,
      operationId: panelOperationId(slot.slot, published.value.name),
      handlerRef: published.value.handlerRef,
      target: target.value,
      input: JSON.parse(JSON.stringify(props.params ?? {})) as Record<string, unknown>,
    });
    emit("downloaded");
  } catch (reason: unknown) {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    failure.value = err;
    emit("error", err);
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <div class="sdk-download-button">
    <button
      type="button"
      class="sdk-download-btn"
      :class="{ primary: type === 'primary' }"
      :disabled="isDisabled"
      @click="requestDownload"
    >
      {{ downloading ? t("platform.downloadPreparing") : buttonLabel }}
    </button>
    <p v-if="failure" role="alert" class="sdk-download-error">{{ failure.message }}</p>
  </div>
</template>

<style scoped>
.sdk-download-button {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
}
.sdk-download-btn {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--el-font-size-small, 12px);
  min-height: 30px;
  padding: 4px 12px;
}
.sdk-download-btn.primary {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: var(--el-color-white, #fff);
}
.sdk-download-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.sdk-download-error {
  color: var(--el-color-danger);
  font-size: var(--el-font-size-small, 12px);
  margin: 0;
}
</style>
