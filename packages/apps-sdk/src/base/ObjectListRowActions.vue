<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index";
import { appIcon } from "@ontomato/platform-shell";

export interface ResolvedRowActionItem {
  readonly key: string;
  readonly kind: "operation" | "local";
  readonly operation?: string;
  readonly id?: string;
  readonly to?: string;
  readonly label: string;
  readonly icon?: string;
  readonly iconOnly?: boolean;
  readonly active?: boolean;
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
      :class="{
        'is-danger': item.danger,
        'is-primary': item.primary,
        'is-icon-only': item.iconOnly,
        'is-active': item.active,
      }"
      :disabled="item.disabled || busy"
      :aria-label="item.iconOnly ? item.label : undefined"
      :aria-pressed="item.active !== undefined ? item.active : undefined"
      :title="item.reason ?? (item.iconOnly ? item.label : undefined)"
      :data-action-kind="item.kind"
      :data-operation="item.operation"
      :data-local-action="item.id"
      @click.stop="emit('trigger', item)"
    >
      <svg
        v-if="item.icon === 'star' || item.icon === 'star-filled'"
        class="sdk-object-list-action-icon"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        :fill="item.icon === 'star-filled' ? 'currentColor' : 'none'"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      <component
        :is="appIcon(item.icon)"
        v-else-if="item.icon"
        class="sdk-object-list-action-icon"
        :size="14"
        aria-hidden="true"
      />
      <span v-if="!item.iconOnly">{{ item.label }}</span>
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
  gap: 4px;
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
.sdk-object-list-action-btn.is-icon-only {
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--el-text-color-secondary);
}
.sdk-object-list-action-btn.is-icon-only:hover:not(:disabled) {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.sdk-object-list-action-btn.is-active {
  color: var(--el-color-warning);
}
.sdk-object-list-action-btn.is-active:hover:not(:disabled) {
  color: var(--el-color-warning);
}
.sdk-object-list-action-icon {
  flex: 0 0 auto;
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
