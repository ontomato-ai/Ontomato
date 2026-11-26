<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index";
import type { PanelGroupCounts } from "@ontomato/contracts/panel-projection";
import { dropdownBoundaryOptions } from "@ontomato/foundation-ui/overlay";
import { appIcon } from "@ontomato/platform-shell/icons";
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
    /** Maximum number of inline options shown before collapsing remaining options into a "More" dropdown menu. */
    maxVisible?: number;
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
    maxVisible: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: ScalarValue];
}>();

const { t, te } = useI18n();
const panel = inject(panelContextKey, null);
const memberGetter = inject(panelMemberKey, null);
const member = memberGetter ? memberGetter() : null;
const countsData = member && "counts" in member.projection.data ? useMemberData("counts") : null;
const valueParam = member && !props.state ? useMemberParam("value") : null;
const buttonRefs = ref<HTMLButtonElement[]>([]);
const chevron = appIcon("chevron-down");

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

const resolvedMoreLabel = computed<string>(() => {
  const translated = resolveKey("common.more");
  return translated !== "common.more" ? translated : "More";
});

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

const effectiveMaxVisible = computed<number | null>(() => {
  const raw = props.maxVisible;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const floored = Math.floor(raw);
  return floored > 0 ? floored : null;
});

const visibleOptions = computed<readonly ResolvedOption[]>(() => {
  const limit = effectiveMaxVisible.value;
  if (limit === null || resolvedOptions.value.length <= limit) return resolvedOptions.value;
  return resolvedOptions.value.slice(0, limit);
});

const overflowOptions = computed<readonly ResolvedOption[]>(() => {
  const limit = effectiveMaxVisible.value;
  if (limit === null || resolvedOptions.value.length <= limit) return [];
  return resolvedOptions.value.slice(limit);
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

const selectedOverflowOption = computed<ResolvedOption | null>(
  () => overflowOptions.value.find((option) => option.value === currentValue.value) ?? null,
);

const overflowDisabled = computed<boolean>(
  () => props.disabled || overflowOptions.value.every((option) => option.disabled),
);

function select(option: ResolvedOption) {
  if (props.disabled || option.disabled || option.value === currentValue.value) return;
  const finish = () => {
    emit("update:modelValue", option.value);
  };
  let applied: boolean | Promise<boolean> = true;
  if (props.state) {
    if (!panel) throw new Error(`SegmentedControl state '${props.state}' requires a panel context`);
    applied = panel.instance.state.set(props.state, option.value);
  } else if (panel && member) {
    if (panel.manifest.members[member.key]?.outputs?.value) {
      applied = panel.instance.output(member.key, "value", option.value);
    } else {
      applied = valueParam!.set(option.value);
    }
  }
  if (applied === false) return;
  if (applied && typeof applied !== "boolean") void applied.then((ok) => { if (ok) finish(); });
  else finish();
}

function onOverflowCommand(index: number) {
  const option = overflowOptions.value[index];
  if (option) select(option);
}

function isOptionTabbable(option: ResolvedOption, index: number): boolean {
  if (props.disabled || option.disabled) return false;
  if (option.value === currentValue.value) return true;
  if (selectedOverflowOption.value) return false;
  const list = visibleOptions.value;
  if (list.some((item) => !item.disabled && item.value === currentValue.value)) return false;
  return list.findIndex((item) => !item.disabled) === index;
}

const isMoreTabbable = computed<boolean>(() => {
  if (overflowDisabled.value) return false;
  if (selectedOverflowOption.value) return true;
  return visibleOptions.value.every((option) => option.disabled);
});

function onKeydown(event: KeyboardEvent, currentIndex: number) {
  if (props.disabled) return;
  const list = visibleOptions.value;
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
      v-for="(option, index) in visibleOptions"
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
    <ElDropdown
      v-if="overflowOptions.length > 0"
      trigger="click"
      :disabled="overflowDisabled"
      :popper-options="dropdownBoundaryOptions"
      @command="onOverflowCommand"
    >
      <button
        type="button"
        class="sdk-segmented-option sdk-segmented-more"
        :class="{ active: Boolean(selectedOverflowOption) }"
        :disabled="overflowDisabled"
        :tabindex="isMoreTabbable ? 0 : -1"
        :aria-checked="selectedOverflowOption ? 'true' : undefined"
        :data-value="selectedOverflowOption ? String(selectedOverflowOption.value) : undefined"
        data-overflow-trigger="true"
      >
        <span>{{ selectedOverflowOption?.label ?? resolvedMoreLabel }}</span>
        <span
          v-if="selectedOverflowOption && selectedOverflowOption.count !== undefined"
          class="sdk-segmented-count"
        >{{ selectedOverflowOption.count }}</span>
        <component :is="chevron" :size="14" aria-hidden="true" />
      </button>
      <template #dropdown>
        <ElDropdownMenu>
          <ElDropdownItem
            v-for="(option, overflowIndex) in overflowOptions"
            :key="String(option.value)"
            :command="overflowIndex"
            :disabled="disabled || option.disabled"
            :class="{ 'sdk-segmented-overflow-selected': option.value === currentValue }"
            :aria-current="option.value === currentValue ? 'true' : undefined"
            :data-value="String(option.value)"
          >
            <span>{{ option.label }}</span>
            <span v-if="option.count !== undefined" class="sdk-segmented-count">{{ option.count }}</span>
          </ElDropdownItem>
        </ElDropdownMenu>
      </template>
    </ElDropdown>
  </div>
</template>

<style scoped>
/* A segmented choice on a quiet neutral track; the chosen segment is a stronger neutral fill (DESIGN.md). */
.sdk-segmented-control {
  align-items: center;
  align-self: flex-start;
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-md);
  box-sizing: border-box;
  display: inline-flex;
  gap: calc(var(--spacing-xs) / 2);
  min-height: var(--control-height);
  padding: 3px;
}
.sdk-segmented-option {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  gap: var(--spacing-xs);
  height: var(--control-height-sm);
  padding: 0 var(--spacing-md);
  transition: background-color var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}
.sdk-segmented-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.sdk-segmented-option:hover:not(:disabled):not(.active) {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-segmented-option.active {
  background: var(--ui-fill-secondary);
  color: var(--el-text-color-primary);
}
.sdk-segmented-option:disabled {
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
}
.sdk-segmented-overflow-selected {
  color: var(--el-color-primary);
  font-weight: var(--font-medium);
}
</style>
