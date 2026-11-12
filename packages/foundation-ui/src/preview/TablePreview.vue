<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElCheckbox, ElPagination, ElTable, ElTableColumn } from "element-plus";
import ColumnFilter from "./ColumnFilter.vue";
import type { TableArrangeLabels, TableData } from "./table-data";

/**
 * A table of text cells (a CSV, TSV or dataset file, or a projection of other data) drawn with Element Plus. Cells keep
 * their spaces and line breaks, and columns whose every cell is a number align right. Given a page size, the rows come a
 * page at a time with the total beside the pager. Given the chosen rows, each row can be chosen by its index in the whole
 * table, so a choice holds across pages. Given the labels to arrange it, its reader can sort it by a column and keep only
 * some values of a column; that changes what is shown, never the table, and rows are still chosen by their index in the
 * whole table. Other attributes go to the Element Plus table (height, max-height, empty-text).
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The columns' names and the rows of text cells, such as `parseCsv` reads from a CSV or TSV text. */
  table: TableData;
  /** Rows per page: given, the rows come a page at a time with the total beside the pager; otherwise all at once. */
  pageSize?: number;
  /** Indices of the chosen rows in the whole table; rows can be chosen when given. */
  selected?: number[];
  /** Accessible name of a row's checkbox, from the row's number (from 1) in the whole table. */
  selectRowLabel?: (row: number) => string;
  /** While true, the choice of rows does not change. */
  selectionDisabled?: boolean;
  /** Given, the reader can sort the table by a column and filter a column by its values. */
  arrange?: TableArrangeLabels;
}>();

const emit = defineEmits<{
  /** The chosen rows after the reader checks or clears one, by their indices in the whole table. */
  "update:selected": [rows: number[]];
}>();

type Order = "ascending" | "descending";
const sort = ref<{ column: number; order: Order } | null>(null);
/** The values each filtered column keeps; a column not in the map keeps every value. */
const kept = ref(new Map<number, Set<string>>());
const page = ref(1);
const tableRef = ref<InstanceType<typeof ElTable>>();
watch(
  () => props.table,
  () => {
    tableRef.value?.clearSort();
    sort.value = null;
    kept.value = new Map();
    page.value = 1;
  },
);
watch([sort, kept], () => {
  page.value = 1;
});

/** What a cell sorts by: the source's own value where the table carries it, its text otherwise; empty is null. */
function sortValue(row: number, column: number) {
  const value = props.table.values?.[row]?.[column];
  if (value !== undefined) return value;
  const text = props.table.rows[row]?.[column] ?? "";
  return text === "" ? null : text;
}

/** Numbers by value and text by the reader's language; empty cells stay last in either order. */
function compare(a: number | string | null, b: number | string | null, direction: number) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return direction * (a - b);
  if (typeof a === "number" || typeof b === "number") return direction * (typeof a === "number" ? -1 : 1);
  return direction * a.localeCompare(b);
}

/** The rows shown, in the order shown, by their indices in the whole table: filtered, then sorted. */
const order = computed(() => {
  let rows = props.table.rows.map((_, index) => index);
  for (const [column, values] of kept.value) rows = rows.filter((row) => values.has(props.table.rows[row]?.[column] ?? ""));
  const by = sort.value;
  if (!by) return rows;
  const direction = by.order === "ascending" ? 1 : -1;
  return [...rows].sort((a, b) => compare(sortValue(a, by.column), sortValue(b, by.column), direction));
});
const rows = computed(() => {
  const shown = props.pageSize ? order.value.slice((page.value - 1) * props.pageSize, page.value * props.pageSize) : order.value;
  return shown.map((source) => ({ source, cells: props.table.rows[source]! }));
});

const NUMBER = /^-?\d[\d,]*(\.\d+)?%?$/;
const numeric = computed(() =>
  props.table.columns.map((_, column) => {
    const values = props.table.rows.map((row) => row[column] ?? "").filter((value) => value !== "");
    return values.length > 0 && values.every((value) => NUMBER.test(value));
  }),
);

/** Each column's cells in every row, for its filter. */
const columnCells = computed(() =>
  props.arrange ? props.table.columns.map((_, column) => props.table.rows.map((row) => row[column] ?? "")) : [],
);

function filter(column: number, values: Set<string> | null) {
  const next = new Map(kept.value);
  if (values) next.set(column, values);
  else next.delete(column);
  kept.value = next;
}

function sorted({ prop, order: direction }: { prop: string | null; order: Order | null }) {
  sort.value = prop !== null && direction ? { column: Number(prop), order: direction } : null;
}

/** Rows keep their source index as identity, so a row's checkbox follows its record when the order changes. */
const sourceIndex = (row: { source: number }) => String(row.source);
const chosenRow = ({ row }: { row: { source: number } }) => (props.selected?.includes(row.source) ? "is-chosen" : "");

function toggle(row: number, selected: number[]) {
  emit("update:selected", selected.includes(row) ? selected.filter((item) => item !== row) : [...selected, row]);
}
</script>

<template>
  <div class="table-preview">
    <el-table
      ref="tableRef"
      v-bind="$attrs"
      :data="rows"
      :row-key="sourceIndex"
      :row-class-name="chosenRow"
      @sort-change="sorted"
    >
      <el-table-column v-if="selected" width="44" class-name="table-preview-choice">
        <template #default="{ row }">
          <el-checkbox
            :model-value="selected.includes(row.source)"
            :disabled="selectionDisabled"
            :aria-label="selectRowLabel?.(row.source + 1)"
            @change="toggle(row.source, selected)"
          />
        </template>
      </el-table-column>
      <el-table-column
        v-for="(column, index) in table.columns"
        :key="index"
        :prop="String(index)"
        :label="column"
        :align="numeric[index] ? 'right' : 'left'"
        :sortable="arrange ? 'custom' : false"
        :sort-orders="['ascending', 'descending', null]"
        :label-class-name="arrange ? 'table-preview-arranged' : undefined"
        min-width="120"
      >
        <template v-if="arrange" #header>
          <span class="table-preview-heading" :title="column">{{ column }}</span>
          <ColumnFilter
            :column="column"
            :cells="columnCells[index]!"
            :kept="kept.get(index) ?? null"
            :labels="arrange"
            @change="filter(index, $event)"
          />
        </template>
        <template #default="{ row }">{{ row.cells[index] }}</template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="pageSize"
      v-model:current-page="page"
      class="table-preview-pager"
      size="small"
      layout="total, prev, pager, next"
      :page-size="pageSize"
      :total="order.length"
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

/* In a narrow column the name gives way and ends in an ellipsis; the filter and the sort carets keep their place. */
.table-preview :deep(th.table-preview-arranged > .cell) {
  display: flex;
  align-items: center;
}

.table-preview :deep(th.table-preview-arranged.is-right > .cell) {
  justify-content: flex-end;
}

.table-preview :deep(th.table-preview-arranged > .cell > *:not(.table-preview-heading)) {
  flex: none;
}

.table-preview-heading {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
