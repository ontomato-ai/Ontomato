<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelGroupCounts } from "@ontomato/contracts/panel-projection";
import { panelContextKey } from "../panel/context";
import { panelMemberKey, useMemberData, useMemberParam } from "../panel/member";
import type { SegmentedControlOption } from "./segmented-control-types";

type ScalarValue = string | number | boolean;

interface ResolvedOption {
  readonly value: ScalarValue;
  readonly label: string;
  readonly count?: number;
  readonly disabled?: boolean;
}

/**
 * Segmented switcher for one declared scalar panel state (or a controlled `modelValue` outside a panel). When placed
 * as a member declaring `data.counts` (`panelGroupCounts`), options come directly from the owner's ordered
 * `[{ key, label, count }]` list; static `options` are used otherwise or while counts are unavailable.
 */
const props = withDefaults(
  defineProps<{
    /**
     * The choices, each a `value` and its label (`labelKey`): fixed ones, used when the projection reads no `counts` or
     * while they are read; with `counts` (an owner's group counts, such as by status), the owner's groups are the choices,
     * each with its count, read again when the panel's other filters change.
     */
    options?: readonly SegmentedControlOption<ScalarValue>[];
    /** Declared scalar panel state field name when placed directly in a panel template outside a member. */
    state?: string;
    /** Controlled scalar value when used outside a panel state binding. */
    modelValue?: ScalarValue | null;
    /** The choice shown as chosen while the bound panel state holds nothing (such as `all`). */
    defaultValue?: ScalarValue | null;
    /** Accessible label text for the segmented radio group. */
    ariaLabel?: string;
    /** Panel message key (or platform i18n key) for the accessible label. */
    ariaLabelKey?: string;
    /** Disables all options. */
    disabled?: boolean;
  }>(),
  {
    options: undefined,
    state: undefined,
    modelValue: undefined,
    defaultValue: undefined,
    ariaLabel: undefined,
    ariaLabelKey: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: ScalarValue];
  change: [value: ScalarValue];
}>();

const { t, te } = useI18n();
const panel = inject(panelContextKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter ? memberGetter() : null;
const countsData = member && "counts" in member.projection.data ? useMemberData("counts") : null;
const valueParam = member && !props.state ? useMemberParam("value") : null;
const buttonRefs = ref<HTMLButtonElement[]>([]);

function resolveKey(key: string): string {
  if (panel) {
    const fromPanel = panel.t(key);
    if (fromPanel !== key) return fromPanel;
  }
  if (te(key)) return t(key);
  return key;
}

const resolvedAriaLabel = computed<string | undefined>(() =>
  props.ariaLabelKey ? resolveKey(props.ariaLabelKey) : props.ariaLabel,
);

const resolvedOptions = computed<readonly ResolvedOption[]>(() => {
  if (countsData?.value.status === "ready") {
    const counts = countsData.value.value as unknown as PanelGroupCounts;
    return counts.map(({ key, label, count }) => ({ value: key, label, count }));
  }
  return (props.options ?? []).map((option) => ({
    value: option.value,
    label: option.label ?? (option.labelKey ? resolveKey(option.labelKey) : String(option.value)),
    disabled: option.disabled,
  }));
});

const currentValue = computed<ScalarValue | null>(() => {
  if (props.state) {
    if (!panel) throw new Error(`SegmentedControl state '${props.state}' requires a panel context`);
    const raw = panel.instance.state.values.value[props.state];
    if (raw !== null && raw !== undefined && typeof raw !== "object") return raw;
    return props.defaultValue ?? null;
  }
  if (valueParam) {
    const raw = valueParam.value.value;
    if (raw !== null && raw !== undefined && typeof raw !== "object") return raw;
    return props.defaultValue ?? null;
  }
  return props.modelValue ?? props.defaultValue ?? null;
});

function select(option: ResolvedOption) {
  if (props.disabled || option.disabled || option.value === currentValue.value) return;
  if (props.state) {
    if (!panel) throw new Error(`SegmentedControl state '${props.state}' requires a panel context`);
    panel.instance.state.set(props.state, option.value);
  } else if (panel && member) {
    if (panel.manifest.members[member.key]?.outputs?.value) {
      void panel.instance.output(member.key, "value", option.value);
    } else {
      valueParam!.set(option.value);
    }
  }
  emit("update:modelValue", option.value);
  emit("change", option.value);
}

function isOptionTabbable(option: ResolvedOption, index: number): boolean {
  if (props.disabled || option.disabled) return false;
  if (option.value === currentValue.value) return true;
  const list = resolvedOptions.value;
  if (list.some((item) => !item.disabled && item.value === currentValue.value)) return false;
  return list.findIndex((item) => !item.disabled) === index;
}

function onKeydown(event: KeyboardEvent, currentIndex: number) {
  if (props.disabled) return;
  const list = resolvedOptions.value;
  const enabledIndices = list
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
  select(list[targetIndex]!);
  buttonRefs.value[targetIndex]?.focus();
}
</script>

<template>
  <div
    class="sdk-segmented-control"
    role="radiogroup"
    :aria-label="resolvedAriaLabel"
    :aria-disabled="disabled || undefined"
  >
    <button
      v-for="(option, index) in resolvedOptions"
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
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="sdk-segmented-count">{{ option.count }}</span>
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
