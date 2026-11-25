<script setup lang="ts">
import { computed, type Directive } from "vue";
import { ElCheckbox } from "element-plus/es/components/checkbox/index";
import { ElTag } from "element-plus/es/components/tag/index";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";

const props = defineProps<{
  options: readonly PanelFormOption[];
  depth?: number;
  isSelected: (option: PanelFormOption) => boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ toggle: [options: PanelFormOption[], checked: boolean] }>();

const isRoot = computed(() => props.depth === undefined || props.depth === 0);
const isFlat = computed(() => props.depth === undefined);

interface CheckboxSyncBinding {
  indeterminate?: boolean;
  ariaLabel?: string;
}

function syncCheckboxInput(el: HTMLElement, binding: CheckboxSyncBinding | undefined) {
  const input = el.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input || !binding) return;
  if (binding.indeterminate !== undefined) {
    input.indeterminate = binding.indeterminate;
  }
  if (binding.ariaLabel !== undefined) {
    input.setAttribute("aria-label", binding.ariaLabel);
  }
}

/** Keeps the underlying native checkbox input's indeterminate property and aria-label synchronized. */
const vSyncCheckbox: Directive<HTMLElement, CheckboxSyncBinding> = {
  mounted(el, binding) {
    syncCheckboxInput(el, binding.value);
  },
  updated(el, binding) {
    syncCheckboxInput(el, binding.value);
  },
};

const nodes = computed(() => {
  const leaves: PanelFormOption[] = [];
  const groups = new Map<string, PanelFormOption[]>();
  for (const option of props.options) {
    const group = props.depth === undefined ? undefined : option.groupPath?.[props.depth];
    if (group === undefined) leaves.push(option);
    else if (groups.has(group)) groups.get(group)!.push(option);
    else groups.set(group, [option]);
  }
  return {
    leaves,
    groups: Array.from(groups, ([label, options]) => {
      const available = options.filter(option => !option.disabled);
      const selectedCount = available.filter(props.isSelected).length;
      return { label, options, available, selectedCount };
    }),
  };
});
</script>

<template>
  <div
    class="sdk-form-select-tree"
    :class="{ 'is-root-box': isRoot, 'is-flat-list': isFlat }"
  >
    <div
      v-for="(option, index) in nodes.leaves"
      :key="index"
      class="sdk-form-select-leaf"
      :class="{ 'is-flat-row': isFlat, 'is-disabled': disabled || (option.disabled && !isSelected(option)) }"
    >
      <el-checkbox
        :model-value="isSelected(option)"
        :disabled="disabled || (option.disabled && !isSelected(option))"
        class="sdk-form-select-leaf-checkbox"
        @update:model-value="emit('toggle', [option], Boolean($event))"
      >
        <span class="sdk-form-select-leaf-body">
          <span
            v-if="isFlat && option.badge"
            class="sdk-form-option-method-pill"
          >{{ option.badge }}</span>
          <span class="sdk-form-select-leaf-text">
            <span class="sdk-form-select-leaf-label">{{ option.label }}</span>
            <small v-if="option.description" class="sdk-form-select-note">{{ option.description }}</small>
            <small v-if="option.disabledReason" class="sdk-form-select-note is-disabled-reason">{{ option.disabledReason }}</small>
          </span>
          <el-tag
            v-if="!isFlat && option.badge"
            size="small"
            type="info"
            effect="plain"
            class="sdk-form-option-code-tag"
          >{{ option.badge }}</el-tag>
        </span>
      </el-checkbox>
    </div>
    <details v-for="group in nodes.groups" :key="group.label" open class="sdk-form-select-group">
      <summary class="sdk-form-select-group-summary">
        <el-checkbox
          v-sync-checkbox="{
            indeterminate: group.selectedCount > 0 && group.selectedCount < group.available.length,
            ariaLabel: group.label,
          }"
          :model-value="group.available.length > 0 && group.selectedCount === group.available.length"
          :indeterminate="group.selectedCount > 0 && group.selectedCount < group.available.length"
          :disabled="disabled || group.available.length === 0"
          @click.stop
          @update:model-value="emit('toggle', group.available, Boolean($event))"
        >
          <span class="sdk-form-select-group-label">{{ group.label }}</span>
        </el-checkbox>
      </summary>
      <form-select-tree
        class="sdk-form-select-branch"
        :options="group.options"
        :depth="depth! + 1"
        :is-selected="isSelected"
        :disabled="disabled"
        @toggle="(options, checked) => emit('toggle', options, checked)"
      ></form-select-tree>
    </details>
  </div>
</template>

<style scoped>
.sdk-form-select-tree {
  display: flex;
  flex-direction: column;
}
.sdk-form-select-tree.is-root-box {
  max-height: 460px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
  padding: var(--spacing-xs) 0;
}
.sdk-form-select-tree.is-root-box.is-flat-list {
  padding: 0;
}
.sdk-form-select-leaf {
  display: flex;
  align-items: center;
  padding: 4px var(--spacing-sm);
  transition: background-color 0.15s ease;
}
.sdk-form-select-leaf:hover:not(.is-disabled) {
  background: var(--el-fill-color-light);
}
.sdk-form-select-leaf.is-flat-row {
  padding: 8px var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.sdk-form-select-leaf.is-flat-row:last-child {
  border-bottom: 0;
}
.sdk-form-select-leaf-checkbox {
  width: 100%;
  height: auto;
  align-items: flex-start;
  margin-right: 0;
}
.sdk-form-select-leaf-checkbox :deep(.el-checkbox__input) {
  margin-top: 2px;
}
.sdk-form-select-leaf-checkbox :deep(.el-checkbox__label) {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
  line-height: 1.4;
}
.sdk-form-select-leaf-body {
  display: flex;
  align-items: flex-start;
  gap: var(--spacing-sm);
  width: 100%;
  min-width: 0;
}
.sdk-form-select-leaf-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1 1 auto;
}
.sdk-form-select-leaf-label {
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.sdk-form-select-note {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
.sdk-form-option-method-pill {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 54px;
  padding: 1px 6px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  line-height: 1.4;
}
.sdk-form-option-code-tag {
  flex: 0 0 auto;
  margin-inline-start: auto;
  font-family: var(--font-mono);
}
.sdk-form-select-group {
  min-width: 0;
}
.sdk-form-select-group-summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 4px var(--spacing-sm);
  cursor: pointer;
  list-style: none;
  user-select: none;
  border-radius: var(--radius-xs);
  transition: background-color 0.15s ease;
}
.sdk-form-select-group-summary:hover {
  background: var(--el-fill-color-light);
}
.sdk-form-select-group-summary::before {
  content: "";
  display: inline-block;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid var(--el-text-color-placeholder);
  transition: transform 0.15s ease;
  flex: 0 0 auto;
}
.sdk-form-select-group[open] > .sdk-form-select-group-summary::before {
  transform: rotate(90deg);
}
.sdk-form-select-group-summary::-webkit-details-marker {
  display: none;
}
.sdk-form-select-group-label {
  font-weight: var(--font-medium);
  color: var(--el-text-color-primary);
}
.sdk-form-select-branch {
  padding-inline-start: var(--spacing-lg);
}
</style>
