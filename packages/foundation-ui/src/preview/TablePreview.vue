<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElCheckbox, ElPagination, ElTable, ElTableColumn } from "element-plus";
import type { TableData } from "./table-data";

/**
 * A table of text cells (a CSV, TSV or dataset file, or a projection of other data) drawn with Element Plus. Cells keep
 * their spaces and line breaks, and columns whose every cell is a number align right. Given a page size, the rows come a
 * page at a time with the total beside the pager. Given the chosen rows, each row can be chosen by its index in the whole
 * table, so a choice holds across pages. Other attributes go to the Element Plus table (height, max-height, empty-text).
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  table: TableData;
  pageSize?: number;
  /** Indices of the chosen rows in the whole table; rows can be chosen when given. */
  selected?: number[];
  /** Accessible name of a row's checkbox, from the row's number (from 1) in the whole table. */
  selectRowLabel?: (row: number) => string;
  /** While true, the choice of rows does not change. */
  selectionDisabled?: boolean;
}>();

const emit = defineEmits<{ "update:selected": [rows: number[]] }>();

const page = ref(1);
watch(
  () => props.table,
  () => {
    page.value = 1;
  },
);
const offset = computed(() => (props.pageSize ? (page.value - 1) * props.pageSize : 0));
const rows = computed(() =>
  props.pageSize ? props.table.rows.slice(offset.value, offset.value + props.pageSize) : props.table.rows,
);

const NUMBER = /^-?\d[\d,]*(\.\d+)?%?$/;
const numeric = computed(() =>
  props.table.columns.map((_, column) => {
    const values = props.table.rows.map((row) => row[column] ?? "").filter((value) => value !== "");
    return values.length > 0 && values.every((value) => NUMBER.test(value));
  }),
);

const chosenRow = ({ rowIndex }: { rowIndex: number }) =>
  props.selected?.includes(offset.value + rowIndex) ? "is-chosen" : "";

function toggle(row: number, selected: number[]) {
  emit("update:selected", selected.includes(row) ? selected.filter((item) => item !== row) : [...selected, row]);
}
</script>

<template>
  <div class="table-preview">
    <el-table v-bind="$attrs" :data="rows" :row-class-name="chosenRow">
      <el-table-column v-if="selected" width="44" class-name="table-preview-choice">
        <template #default="{ $index }">
          <el-checkbox
            :model-value="selected.includes(offset + $index)"
            :disabled="selectionDisabled"
            :aria-label="selectRowLabel?.(offset + $index + 1)"
            @change="toggle(offset + $index, selected)"
          />
        </template>
      </el-table-column>
      <el-table-column
        v-for="(column, index) in table.columns"
        :key="index"
        :label="column"
        :align="numeric[index] ? 'right' : 'left'"
        min-width="120"
      >
        <template #default="{ row }">{{ row[index] }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="pageSize"
      v-model:current-page="page"
      class="table-preview-pager"
      size="small"
      layout="total, prev, pager, next"
      :page-size="pageSize"
      :total="table.rows.length"
    />
  </div>
</template>

<style scoped>
/* In a box of a set height (a dashboard card, a dialog) the table takes what the pager leaves and scrolls inside. */
.table-preview {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.table-preview :deep(.el-table) {
  flex: 1 1 auto;
  min-height: 0;
  font-variant-numeric: tabular-nums;
}

.table-preview :deep(.el-table__body .cell) {
  white-space: pre-wrap;
}

.table-preview :deep(.el-table__header .cell) {
  white-space: nowrap;
}

/* Element Plus gives a checkbox a 32px line of its own; here it is only as tall as its box and sits in the middle of
   the row, so a row that can be chosen is as tall as one that cannot. */
.table-preview :deep(.table-preview-choice .cell) {
  display: flex;
  align-items: center;
  justify-content: center;
}

.table-preview :deep(.table-preview-choice .el-checkbox) {
  height: auto;
}

.table-preview :deep(.el-table__row.is-chosen > td.el-table__cell) {
  background: var(--el-color-primary-light-9);
}

.table-preview-pager {
  flex: none;
  justify-content: flex-end;
  padding: var(--spacing-sm) 0;
}
</style>
