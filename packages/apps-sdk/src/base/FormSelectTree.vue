<script setup lang="ts">
import { computed } from "vue";
import type { PanelFormOption } from "@ontomato/contracts/form-fields";

const props = defineProps<{
  options: readonly PanelFormOption[];
  depth?: number;
  isSelected: (option: PanelFormOption) => boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ toggle: [options: PanelFormOption[], checked: boolean] }>();

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
  <div class="sdk-form-select-tree">
    <label v-for="(option, index) in nodes.leaves" :key="index" class="sdk-form-select-leaf">
      <input
        type="checkbox"
        :checked="isSelected(option)"
        :disabled="disabled || (option.disabled && !isSelected(option))"
        @change="emit('toggle', [option], ($event.target as HTMLInputElement).checked)"
      />
      <span>
        <small v-if="option.badge" class="sdk-form-option-badge">{{ option.badge }}</small>
        {{ option.label }}
        <small v-if="option.description" class="sdk-form-select-note">{{ option.description }}</small>
        <small v-if="option.disabledReason" class="sdk-form-select-note">{{ option.disabledReason }}</small>
      </span>
    </label>
    <details v-for="group in nodes.groups" :key="group.label" open>
      <summary>
        <input
          type="checkbox"
          :aria-label="group.label"
          :checked="group.available.length > 0 && group.selectedCount === group.available.length"
          :indeterminate.prop="group.selectedCount > 0 && group.selectedCount < group.available.length"
          :disabled="disabled || group.available.length === 0"
          @click.stop
          @change="emit('toggle', group.available, ($event.target as HTMLInputElement).checked)"
        />
        {{ group.label }}
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
  display: grid;
  gap: var(--spacing-xs);
}
.sdk-form-select-leaf {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-sm);
  padding-block: var(--spacing-xs);
}
.sdk-form-select-note {
  display: block;
  font-size: var(--text-xs);
}
.sdk-form-select-branch {
  margin-inline-start: var(--spacing-lg);
}
.sdk-form-option-badge {
  padding-inline: var(--spacing-xs);
  border-radius: var(--radius-xs);
  background: var(--ui-fill-secondary);
  font-size: var(--text-xs);
}
</style>
