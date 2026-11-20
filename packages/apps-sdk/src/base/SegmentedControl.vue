<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  panelContextKey,
  projectionKey,
  slotInputState,
  slotOutputState,
} from "../panel/context";
import { panelMemberKey, useMemberData } from "../panel/member";
import type { SegmentedControlOption } from "./segmented-control-types";

type ScalarValue = string | number | boolean;

/**
 * Segmented switcher that reads and writes one declared scalar panel state (or a controlled `modelValue` when used
 * outside a panel state binding). When drawn as a projection member declaring a `counts` (`panelGroupCounts`) datum,
 * it renders each option's count beside its label while remaining interactive across all datum states.
 */
const props = withDefaults(
  defineProps<{
    /** Mutually exclusive choices with `{ value, labelKey }` or literal `label`. */
    options: readonly SegmentedControlOption<ScalarValue>[];
    /** Declared scalar panel state field name to read and write (for example `"mode"`). */
    state?: string;
    /** Controlled scalar value when not bound to panel state. */
    modelValue?: ScalarValue | null;
    /** Value treated as active when the bound panel state is currently `null`. */
    defaultValue?: ScalarValue | null;
    /** Accessible label for the segmented radio group. */
    ariaLabel?: string;
    /** Disables all options. */
    disabled?: boolean;
  }>(),
  {
    state: undefined,
    modelValue: undefined,
    defaultValue: undefined,
    ariaLabel: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: ScalarValue];
  change: [value: ScalarValue];
}>();

const { t, te } = useI18n();
const panel = inject(panelContextKey, null);
const slot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter ? memberGetter() : null;
const countsData = member && "counts" in member.projection.data ? useMemberData("counts") : null;
const buttonRefs = ref<HTMLButtonElement[]>([]);

const groupCounts = computed<Readonly<Record<string, number>> | null>(() =>
  countsData?.value.status === "ready"
    ? (countsData.value.value as unknown as Readonly<Record<string, number>>)
    : null,
);

const boundState = computed<string | null>(() => {
  if (props.state) return props.state;
  if (panel && slot) {
    return (
      slotOutputState(panel.manifest, slot.slot, "value")
      ?? slotInputState(panel.manifest, slot.slot, "value")
    );
  }
  return null;
});

const currentValue = computed<ScalarValue | null>(() => {
  if (boundState.value) {
    if (!panel) throw new Error(`SegmentedControl state '${boundState.value}' requires a panel context`);
    const raw = panel.instance.state.values.value[boundState.value];
    if (raw !== null && raw !== undefined && typeof raw !== "object") return raw;
    return props.defaultValue ?? null;
  }
  if (member && "value" in member.inputs.value) {
    const raw = member.inputs.value.value;
    if (raw !== null && raw !== undefined && typeof raw !== "object") return raw;
  }
  return props.modelValue ?? props.defaultValue ?? null;
});

function optionLabel(option: SegmentedControlOption<ScalarValue>): string {
  if (option.label !== undefined) return option.label;
  if (option.labelKey) {
    if (panel) {
      const fromPanel = panel.t(option.labelKey);
      if (fromPanel !== option.labelKey) return fromPanel;
    }
    if (te(option.labelKey)) return t(option.labelKey);
    return option.labelKey;
  }
  return String(option.value);
}

function optionCount(option: SegmentedControlOption<ScalarValue>): number | undefined {
  const count = groupCounts.value?.[String(option.value)];
  return typeof count === "number" ? count : undefined;
}

function select(option: SegmentedControlOption<ScalarValue>) {
  if (props.disabled || option.disabled || option.value === currentValue.value) return;
  if (props.state) {
    if (!panel) throw new Error(`SegmentedControl state '${props.state}' requires a panel context`);
    panel.instance.state.set(props.state, option.value);
  } else if (panel && slot) {
    if (!slotOutputState(panel.manifest, slot.slot, "value") && boundState.value) {
      panel.instance.state.set(boundState.value, option.value);
    }
    void panel.instance.output(slot.slot, "value", option.value);
  }
  emit("update:modelValue", option.value);
  emit("change", option.value);
}

function isOptionTabbable(option: SegmentedControlOption<ScalarValue>, index: number): boolean {
  if (props.disabled || option.disabled) return false;
  if (option.value === currentValue.value) return true;
  const hasActive = props.options.some((item) => !item.disabled && item.value === currentValue.value);
  if (hasActive) return false;
  return props.options.findIndex((item) => !item.disabled) === index;
}

function onKeydown(event: KeyboardEvent, currentIndex: number) {
  if (props.disabled) return;
  const enabledIndices = props.options
    .map((option, index) => (option.disabled ? -1 : index))
    .filter((index) => index >= 0);
  if (enabledIndices.length === 0) return;

  const pos = enabledIndices.indexOf(currentIndex);
  let targetIndex: number | null = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    targetIndex = enabledIndices[(pos + 1) % enabledIndices.length]!;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    targetIndex = enabledIndices[(pos - 1 + enabledIndices.length) % enabledIndices.length]!;
  } else if (event.key === "Home") {
    targetIndex = enabledIndices[0]!;
  } else if (event.key === "End") {
    targetIndex = enabledIndices[enabledIndices.length - 1]!;
  }
  if (targetIndex === null) return;
  event.preventDefault();
  select(props.options[targetIndex]!);
  buttonRefs.value[targetIndex]?.focus();
}
</script>

<template>
  <div
    class="sdk-segmented-control"
    role="radiogroup"
    :aria-label="ariaLabel"
    :aria-disabled="disabled || undefined"
  >
    <button
      v-for="(option, index) in options"
      :key="String(option.value)"
      ref="buttonRefs"
      type="button"
      role="radio"
      class="sdk-segmented-option"
      :class="{ active: option.value === currentValue }"
      :aria-checked="option.value === currentValue"
      :disabled="disabled || option.disabled"
      :tabindex="isOptionTabbable(option, index) ? 0 : -1"
      :data-value="String(option.value)"
      @click="select(option)"
      @keydown="onKeydown($event, index)"
    >
      <span>{{ optionLabel(option) }}</span>
      <span v-if="optionCount(option) !== undefined" class="sdk-segmented-count">{{ optionCount(option) }}</span>
    </button>
  </div>
</template>

<style scoped>
.sdk-segmented-control {
  align-items: center;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--radius-md, 6px);
  display: inline-flex;
  gap: 2px;
  padding: 2px;
}
.sdk-segmented-option {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: calc(var(--radius-md, 6px) - 2px);
  color: var(--el-text-color-regular);
  cursor: pointer;
  display: inline-flex;
  font-size: var(--text-sm, 13px);
  font-weight: 500;
  gap: 6px;
  line-height: 1.4;
  padding: 4px 12px;
  transition: background-color 0.15s ease, color 0.15s ease;
  white-space: nowrap;
}
.sdk-segmented-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  font-variant-numeric: tabular-nums;
}
.sdk-segmented-option:hover:not(:disabled):not(.active) {
  color: var(--el-text-color-primary);
}
.sdk-segmented-option.active {
  background: var(--el-bg-color);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  color: var(--el-color-primary);
}
.sdk-segmented-option:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
