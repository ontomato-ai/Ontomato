<script setup lang="ts">
import { computed, ref } from "vue";
import { ElCheckbox, ElInput, ElPopover } from "element-plus";
import type { TableArrangeLabels } from "./table-data";

/**
 * A column's filter in a table its reader can arrange: the column's distinct values with how many rows hold each, a
 * search over them, and a choice of the values to keep. Every value is kept until the reader clears one.
 */
const props = defineProps<{
  /** The column's name, for the button's accessible name. */
  column: string;
  /** The column's cells in every row of the table. */
  cells: string[];
  /** The values kept; null keeps every value. */
  kept: ReadonlySet<string> | null;
  labels: TableArrangeLabels;
}>();

const emit = defineEmits<{ change: [kept: Set<string> | null] }>();

const search = ref("");
const values = computed(() => {
  const counts = new Map<string, number>();
  for (const value of props.cells) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count, text: value === "" ? props.labels.empty : value }))
    .sort((a, b) => (a.value === "") !== (b.value === "") ? (a.value === "" ? 1 : -1) : a.text.localeCompare(b.text));
});
const shown = computed(() => {
  const term = search.value.trim().toLocaleLowerCase();
  return term ? values.value.filter((item) => item.text.toLocaleLowerCase().includes(term)) : values.value;
});
const isKept = (value: string) => props.kept === null || props.kept.has(value);
const allKept = computed(() => values.value.every((item) => isKept(item.value)));
const someKept = computed(() => values.value.some((item) => isKept(item.value)));

function keep(value: string, on: boolean) {
  const next = new Set(props.kept ?? values.value.map((item) => item.value));
  if (on) next.add(value);
  else next.delete(value);
  emit("change", next.size === values.value.length ? null : next);
}
</script>

<template>
  <el-popover trigger="click" placement="bottom-start" :width="240" :persistent="false" popper-class="column-filter-popper">
    <template #reference>
      <button
        type="button"
        class="column-filter-button"
        :class="{ active: kept !== null }"
        :aria-label="labels.filter(column)"
        :title="labels.filter(column)"
        @click.stop
      >
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        </svg>
      </button>
    </template>
    <div class="column-filter">
      <el-input v-model="search" size="small" clearable :placeholder="labels.search" />
      <el-checkbox
        class="column-filter-all"
        :model-value="allKept"
        :indeterminate="someKept && !allKept"
        @change="emit('change', $event ? null : new Set())"
      >
        {{ labels.all }}
      </el-checkbox>
      <div class="column-filter-values">
        <el-checkbox
          v-for="item in shown"
          :key="item.value"
          :model-value="isKept(item.value)"
          @change="keep(item.value, Boolean($event))"
        >
          <span class="column-filter-value">{{ item.text }}</span>
          <span class="column-filter-count">{{ item.count }}</span>
        </el-checkbox>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.column-filter-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: 2px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-placeholder);
  vertical-align: middle;
  cursor: pointer;
}

.column-filter-button:hover,
.column-filter-button:focus-visible {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}

.column-filter-button.active {
  color: var(--el-color-primary);
}

.column-filter {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.column-filter-all {
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.column-filter-values {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow: auto;
}

.column-filter-values :deep(.el-checkbox__label),
.column-filter-all :deep(.el-checkbox__label) {
  display: flex;
  flex: 1;
  gap: var(--spacing-sm);
  min-width: 0;
}

.column-filter-values :deep(.el-checkbox) {
  display: flex;
  margin-right: 0;
}

.column-filter-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-filter-count {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
