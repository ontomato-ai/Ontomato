<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

export interface ColumnToggleOption {
  readonly key: string;
  readonly label: string;
}

const props = defineProps<{
  open: boolean;
  columns: readonly ColumnToggleOption[];
  hiddenKeys: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
  toggle: [key: string, visible: boolean];
  reset: [];
}>();

const { t } = useI18n();
const rootRef = ref<HTMLElement | null>(null);

function handleDocumentPointerDown(event: PointerEvent) {
  if (!props.open) return;
  const target = event.target as Node | null;
  if (target && rootRef.value?.contains(target)) return;
  emit("update:open", false);
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (props.open && event.key === "Escape") emit("update:open", false);
}

function detachListeners() {
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  document.removeEventListener("keydown", handleDocumentKeyDown);
}

watch(
  () => props.open,
  (isOpen) => {
    detachListeners();
    if (isOpen) {
      document.addEventListener("pointerdown", handleDocumentPointerDown, true);
      document.addEventListener("keydown", handleDocumentKeyDown);
    }
  },
  { immediate: true },
);

onBeforeUnmount(detachListeners);

function toggleOpen() {
  if (props.columns.length === 0) return;
  emit("update:open", !props.open);
}

const visibleCount = computed(() => {
  if (props.columns.length === 0) return 0;
  const count = props.columns.filter((column) => !props.hiddenKeys.has(column.key)).length;
  return count > 0 ? count : 1;
});

const hiddenCount = computed(() => Math.max(0, props.columns.length - visibleCount.value));

function isColumnVisible(key: string): boolean {
  if (!props.hiddenKeys.has(key)) return true;
  // When every key is marked hidden, the first column stays visible as fallback.
  return props.columns.every((column) => props.hiddenKeys.has(column.key)) && props.columns[0]?.key === key;
}

function isLastVisible(key: string): boolean {
  return visibleCount.value <= 1 && isColumnVisible(key);
}
</script>

<template>
  <div ref="rootRef" class="sdk-object-list-col-toggle">
    <button
      type="button"
      class="sdk-object-list-col-toggle-btn"
      data-testid="object-list-column-toggle"
      :disabled="columns.length === 0"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :title="t('platform.listColumns')"
      @click="toggleOpen"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
        <path d="M15 3v18" />
      </svg>
      <span>{{ t("platform.listColumns") }}</span>
      <span v-if="hiddenCount > 0" class="sdk-object-list-col-toggle-count">{{ visibleCount }}/{{ columns.length }}</span>
    </button>
    <div
      v-if="open && columns.length > 0"
      class="sdk-object-list-columns-popover"
      role="dialog"
      :aria-label="t('platform.listColumns')"
    >
      <div class="sdk-object-list-columns-panel">
        <div class="sdk-object-list-columns-head">
          <span class="sdk-object-list-columns-title">{{ t("platform.listColumns") }}</span>
          <div class="sdk-object-list-columns-actions">
            <button
              type="button"
              class="sdk-object-list-columns-link"
              data-testid="object-list-columns-select-all"
              :disabled="hiddenCount === 0"
              @click="emit('reset')"
            >
              {{ t("platform.listSelectAll") }}
            </button>
            <button
              type="button"
              class="sdk-object-list-columns-link"
              data-testid="object-list-columns-reset"
              :disabled="hiddenCount === 0"
              @click="emit('reset')"
            >
              {{ t("platform.listColumnsReset") }}
            </button>
          </div>
        </div>
        <div class="sdk-object-list-columns-list" role="group" :aria-label="t('platform.listColumns')">
          <label
            v-for="column in columns"
            :key="column.key"
            class="sdk-object-list-columns-item"
            :class="{ disabled: isLastVisible(column.key) }"
            :title="isLastVisible(column.key) ? t('platform.listColumnsKeepOne') : undefined"
          >
            <input
              type="checkbox"
              :data-column-key="column.key"
              :checked="isColumnVisible(column.key)"
              :disabled="isLastVisible(column.key)"
              @change="emit('toggle', column.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="sdk-object-list-columns-item-label">{{ column.label }}</span>
          </label>
        </div>
        <p v-if="visibleCount <= 1 && columns.length > 1" class="sdk-object-list-columns-hint" role="note">
          {{ t("platform.listColumnsKeepOne") }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sdk-object-list-col-toggle {
  display: inline-flex;
  position: relative;
}
.sdk-object-list-col-toggle-btn {
  align-items: center;
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: inline-flex;
  font-size: var(--text-sm);
  gap: var(--spacing-xs);
  height: var(--control-height-sm);
  padding: 0 var(--spacing-sm);
  transition: background-color var(--transition-fast);
  white-space: nowrap;
}
.sdk-object-list-col-toggle-btn:hover:not(:disabled) {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-col-toggle-btn:active:not(:disabled) {
  background: var(--ui-fill-quaternary);
}
.sdk-object-list-col-toggle-btn:disabled {
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
}
.sdk-object-list-col-toggle-btn:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
.sdk-object-list-col-toggle-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-columns-popover {
  background: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
  box-shadow: var(--el-box-shadow-light);
  min-width: 240px;
  padding: var(--spacing-sm);
  position: absolute;
  inset-inline-end: 0;
  top: calc(100% + 6px);
  z-index: 20;
}
.sdk-object-list-columns-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-object-list-columns-head {
  align-items: center;
  border-bottom: 1px solid var(--ui-divider);
  display: flex;
  gap: var(--spacing-xs);
  justify-content: space-between;
  padding-bottom: var(--spacing-xs);
}
.sdk-object-list-columns-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  font-weight: 600;
}
.sdk-object-list-columns-actions {
  align-items: center;
  display: inline-flex;
  gap: var(--spacing-xs);
}
.sdk-object-list-columns-link {
  background: transparent;
  border: 0;
  color: var(--brand-link);
  cursor: pointer;
  font-size: var(--text-xs);
  padding: 0 2px;
}
.sdk-object-list-columns-link:hover:not(:disabled) {
  text-decoration: underline;
}
.sdk-object-list-columns-link:disabled {
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
}
.sdk-object-list-columns-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
}
.sdk-object-list-columns-item {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: flex;
  font-size: var(--text-sm);
  gap: var(--spacing-xs);
  padding: 4px var(--spacing-xs);
}
.sdk-object-list-columns-item:hover:not(.disabled) {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-columns-item.disabled {
  color: var(--el-text-color-secondary);
  cursor: not-allowed;
}
.sdk-object-list-columns-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-object-list-columns-hint {
  border-top: 1px solid var(--ui-divider);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  margin: 0;
  padding-top: var(--spacing-xs);
}
</style>
