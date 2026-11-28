<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElPagination } from "element-plus/es/components/pagination/index";
import { ElTable, ElTableColumn } from "element-plus/es/components/table/index";
import ColumnFilter from "./ColumnFilter.vue";
import type { TableArrangeLabels, TableData } from "./table-data";

/**
 * A table of text cells (a CSV, TSV or dataset file, or a projection of other data) drawn with Element Plus. Cells keep
 * their spaces and line breaks, and columns whose every cell is a number align right. Given a page size, the rows come a
 * page at a time when they span more than one page. Given the labels to arrange it, its reader can sort it by a column
 * and keep only some values of a column; that changes what is shown, never the table. Other attributes go to the Element
 * Plus table (height, max-height, empty-text).
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The columns' names and the rows of text cells, such as `parseCsv` reads from a CSV or TSV text. */
  table: TableData;
  /** Rows per page: given, rows paginate when more than one page is present; otherwise all at once. */
  pageSize?: number;
  /** Given, the reader can sort the table by a column and filter a column by its values. */
  arrange?: TableArrangeLabels;
}>();

/** Content-based column width bounds; arranged columns add room for filter and sort controls. */
const WIDE_CHAR = /[\u2e80-\u9fff\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]/;
const CELL_HORIZONTAL_PADDING = 32;
const ARRANGE_CONTROLS_WIDTH = 46;
const TEXT_WIDTH_BUFFER = 8;
const HEADER_FONT_SIZE = 12;
const BODY_FONT_SIZE = 14;
const MIN_COLUMN_WIDTH = 72;
const ARRANGED_MIN_COLUMN_WIDTH = 112;
const MAX_COLUMN_WIDTH = 320;

function estimateTextWidth(text: string, fontSize: number, limit: number): number {
  let maxLine = 0;
  let line = 0;
  for (const ch of text) {
    if (ch === "\n") {
      if (line > maxLine) maxLine = line;
      line = 0;
      continue;
    }
    if (WIDE_CHAR.test(ch)) line += fontSize * 1.04;
    else if (/[0-9]/.test(ch)) line += fontSize * 0.64;
    else if (/[A-ZMW@#%&]/.test(ch)) line += fontSize * 0.72;
    else if (/[il.,:;|!'" ]/.test(ch)) line += fontSize * 0.36;
    else line += fontSize * 0.58;
    if (line >= limit) return limit;
  }
  return Math.max(maxLine, line);
}

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

/** Content-sized pixel widths so sparse tables pack from the left instead of stretching across the card. */
const columnWidths = computed(() => {
  const arranged = Boolean(props.arrange);
  const minWidth = arranged ? ARRANGED_MIN_COLUMN_WIDTH : MIN_COLUMN_WIDTH;
  const headerChrome = CELL_HORIZONTAL_PADDING + TEXT_WIDTH_BUFFER + (arranged ? ARRANGE_CONTROLS_WIDTH : 0);
  const bodyChrome = CELL_HORIZONTAL_PADDING + TEXT_WIDTH_BUFFER;
  const headerLimit = MAX_COLUMN_WIDTH - headerChrome;
  const bodyLimit = MAX_COLUMN_WIDTH - bodyChrome;

  return props.table.columns.map((column, index) => {
    let width = Math.max(minWidth, Math.ceil(estimateTextWidth(column, HEADER_FONT_SIZE, headerLimit) + headerChrome));
    if (width >= MAX_COLUMN_WIDTH) return MAX_COLUMN_WIDTH;
    for (const row of props.table.rows) {
      const cell = row[index];
      if (!cell) continue;
      const cellWidth = Math.ceil(estimateTextWidth(cell, BODY_FONT_SIZE, bodyLimit) + bodyChrome);
      if (cellWidth > width) {
        if (cellWidth >= MAX_COLUMN_WIDTH) return MAX_COLUMN_WIDTH;
        width = cellWidth;
      }
    }
    return width;
  });
});

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

/** Rows keep their source index as stable identity when the display order changes. */
const sourceIndex = (row: { source: number }) => String(row.source);
</script>

<template>
  <div class="table-preview">
    <el-table
      ref="tableRef"
      v-bind="$attrs"
      :data="rows"
      :row-key="sourceIndex"
      @sort-change="sorted"
    >
      <el-table-column
        v-for="(column, index) in table.columns"
        :key="index"
        :prop="String(index)"
        :label="column"
        :align="numeric[index] ? 'right' : 'left'"
        :sortable="arrange ? 'custom' : false"
        :sort-orders="['ascending', 'descending', null]"
        :label-class-name="arrange ? 'table-preview-arranged' : undefined"
        :width="columnWidths[index]"
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
        <template #default="{ row }">
          <slot name="cell" :text="row.cells[index]" :row-index="row.source" :column-index="index">{{ row.cells[index] }}</slot>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-if="pageSize && order.length > pageSize"
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

.table-preview :deep(.el-table__header-wrapper) {
  background-color: var(--el-table-header-bg-color);
  box-shadow: inset 0 -1px 0 var(--el-table-border-color);
}

.table-preview :deep(.el-table th.el-table__cell) {
  padding: 5px 16px !important;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
  font-weight: var(--font-medium, 500);
}

.table-preview :deep(.el-table td.el-table__cell) {
  padding: 8px 16px !important;
}

.table-preview :deep(.el-table .cell) {
  padding: 0;
}

.table-preview :deep(.el-table__body .cell) {
  white-space: pre-wrap;
}

.table-preview :deep(.el-table__header .cell) {
  line-height: 22px;
  white-space: nowrap;
}

/* In a narrow column the name gives way and ends in an ellipsis; the filter and the sort carets keep their place. */
.table-preview :deep(th.table-preview-arranged > .cell) {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 22px;
}

.table-preview :deep(th.table-preview-arranged.is-right > .cell) {
  justify-content: flex-end;
}

/* Right-aligned columns place filter and sort controls to the left so the heading shares the numbers' right edge. */
.table-preview :deep(th.table-preview-arranged.is-right > .cell > .table-preview-heading) {
  order: 1;
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

.table-preview :deep(.caret-wrapper) {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  margin-left: 0;
  border-radius: 5px;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.table-preview :deep(th.table-preview-arranged .column-filter-button) {
  opacity: 0;
}

.table-preview :deep(th.table-preview-arranged:hover .caret-wrapper),
.table-preview :deep(th.table-preview-arranged:focus-within .caret-wrapper),
.table-preview :deep(th.table-preview-arranged.ascending .caret-wrapper),
.table-preview :deep(th.table-preview-arranged.descending .caret-wrapper),
.table-preview :deep(th.table-preview-arranged:hover .column-filter-button),
.table-preview :deep(th.table-preview-arranged:focus-within .column-filter-button),
.table-preview :deep(th.table-preview-arranged .column-filter-button.active),
.table-preview :deep(th.table-preview-arranged .column-filter-button.open) {
  opacity: 1;
}

@media (hover: none) {
  .table-preview :deep(th.table-preview-arranged .caret-wrapper),
  .table-preview :deep(th.table-preview-arranged .column-filter-button) {
    opacity: 0.72;
  }
}

.table-preview :deep(.caret-wrapper:hover) {
  background: var(--el-fill-color-light);
}

/* Keep the table's sorting controls and hit targets, with light outline chevrons. */
.table-preview :deep(.sort-caret) {
  width: 5px;
  height: 5px;
  left: 6px;
  border: 0;
  border-top: 1.5px solid var(--el-text-color-placeholder);
  border-left: 1.5px solid var(--el-text-color-placeholder);
  opacity: 0.62;
}

.table-preview :deep(.sort-caret.ascending) {
  top: 6px;
  transform: rotate(45deg);
}

.table-preview :deep(.sort-caret.descending) {
  bottom: 6px;
  transform: rotate(225deg);
}

.table-preview :deep(.ascending .sort-caret.ascending),
.table-preview :deep(.descending .sort-caret.descending) {
  border-color: var(--el-color-primary);
  opacity: 1;
}

.table-preview-pager {
  flex: none;
  justify-content: flex-end;
  padding: 6px var(--spacing-md);
}

@media (prefers-reduced-motion: reduce) {
  .table-preview :deep(.caret-wrapper) {
    transition: none;
  }
}
</style>
