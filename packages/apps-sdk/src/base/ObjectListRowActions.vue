<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index";

export interface ResolvedRowActionItem {
  readonly key: string;
  readonly kind: "operation" | "local";
  readonly operation?: string;
  readonly id?: string;
  readonly to?: string;
  readonly label: string;
  readonly danger: boolean;
  readonly primary: boolean;
  readonly disabled: boolean;
  readonly reason?: string;
}

const props = withDefaults(
  defineProps<{
    items: readonly ResolvedRowActionItem[];
    maxVisible?: number;
    busy?: boolean;
    rowLabel?: string;
  }>(),
  {
    maxVisible: 2,
    busy: false,
    rowLabel: "",
  },
);

const emit = defineEmits<{
  trigger: [item: ResolvedRowActionItem];
}>();

const { t } = useI18n();

const inlineLimit = computed(() => Math.max(0, Math.floor(props.maxVisible)));
const inlineItems = computed(() => props.items.slice(0, inlineLimit.value));
const overflowItems = computed(() => {
  const rest = props.items.slice(inlineLimit.value);
  const regular = rest.filter((item) => !item.danger);
  const danger = rest.filter((item) => item.danger);
  return [...regular, ...danger];
});

const moreAriaLabel = computed(() => {
  const name = props.rowLabel.trim();
  return name
    ? t("platform.objectHeaderMoreActionsFor", { name })
    : t("platform.objectHeaderMoreActions");
});

function handleOverflowCommand(command: string | number | Record<string, unknown>) {
  if (typeof command !== "string" || props.busy) return;
  const found = overflowItems.value.find((item) => item.key === command);
  if (!found || found.disabled) return;
  emit("trigger", found);
}
</script>

<template>
  <div v-if="items.length > 0" class="sdk-object-list-row-actions" @click.stop>
    <button
      v-for="item in inlineItems"
      :key="item.key"
      type="button"
      class="sdk-object-list-action-btn"
      :class="{ 'is-danger': item.danger, 'is-primary': item.primary }"
      :disabled="item.disabled || busy"
      :title="item.reason"
      :data-action-kind="item.kind"
      :data-operation="item.operation"
      :data-local-action="item.id"
      @click.stop="emit('trigger', item)"
    >
      {{ item.label }}
    </button>
    <el-dropdown
      v-if="overflowItems.length > 0"
      trigger="click"
      placement="bottom-end"
      class="sdk-object-list-action-more"
      :disabled="busy"
      @command="handleOverflowCommand"
    >
      <button
        type="button"
        class="sdk-object-list-action-more-btn"
        :aria-label="moreAriaLabel"
        :title="moreAriaLabel"
        :disabled="busy"
        @click.stop
      >
        <span aria-hidden="true">···</span>
      </button>
      <template #dropdown>
        <el-dropdown-menu class="sdk-object-list-more-menu">
          <el-dropdown-item
            v-for="(item, index) in overflowItems"
            :key="item.key"
            :command="item.key"
            :divided="item.danger && index > 0 && !overflowItems[index - 1]?.danger"
            :disabled="item.disabled || busy"
            :class="['sdk-object-list-more-item', { 'is-danger': item.danger }]"
            :data-action-kind="item.kind"
            :data-operation="item.operation"
            :data-local-action="item.id"
            :title="item.reason"
          >
            <span class="sdk-object-list-more-item-body">
              <span class="sdk-object-list-more-label">{{ item.label }}</span>
              <span v-if="item.reason" class="sdk-object-list-more-reason">{{ item.reason }}</span>
            </span>
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<style scoped>
.sdk-object-list-row-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs, 4px);
  white-space: nowrap;
}
.sdk-object-list-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px var(--spacing-xs, 6px);
  border: 1px solid transparent;
  border-radius: var(--border-radius-sm, 4px);
  background: transparent;
  color: var(--el-color-primary);
  font-size: var(--font-size-xs, 12px);
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
}
.sdk-object-list-action-btn:hover:not(:disabled) {
  background: var(--el-fill-color-light);
}
.sdk-object-list-action-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.sdk-object-list-action-btn.is-primary {
  font-weight: 600;
}
.sdk-object-list-action-btn.is-danger {
  color: var(--el-color-danger);
}
.sdk-object-list-action-btn.is-danger:hover:not(:disabled) {
  background: var(--el-color-danger-light-9);
}
.sdk-object-list-action-btn:disabled {
  color: var(--el-text-color-placeholder);
  cursor: not-allowed;
}
.sdk-object-list-action-more-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: var(--border-radius-sm, 4px);
  background: transparent;
  color: var(--el-text-color-regular);
  font-size: var(--font-size-sm, 13px);
  line-height: 1;
  cursor: pointer;
}
.sdk-object-list-action-more-btn:hover:not(:disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.sdk-object-list-action-more-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.sdk-object-list-more-item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sdk-object-list-more-reason {
  color: var(--el-text-color-secondary);
  font-size: var(--font-size-xs, 12px);
}
</style>

<style>
.sdk-object-list-more-menu .el-dropdown-menu__item.sdk-object-list-more-item.is-danger {
  color: var(--el-color-danger);
}
.sdk-object-list-more-menu .el-dropdown-menu__item.sdk-object-list-more-item.is-danger:not(.is-disabled):hover,
.sdk-object-list-more-menu .el-dropdown-menu__item.sdk-object-list-more-item.is-danger:not(.is-disabled):focus {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}
</style>
