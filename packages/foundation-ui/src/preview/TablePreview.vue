<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElPagination } from "element-plus/es/components/pagination/index";
import ColumnFilter from "./ColumnFilter.vue";
import type { TableArrangeLabels, TableData } from "./table-data";

/**
 * A table of text cells (a CSV, TSV or dataset file, or a projection of other data) drawn as a semantic native table.
 * It fills the width it is given, sizes columns naturally to content, and scrolls sideways inside its bounds when needed.
 * Single-column tables align left; in multi-column tables, columns whose every cell is a number align right. Long cells
 * truncate to one line with full text on hover by default, or wrap when `wrap` is enabled. Given a page size, rows
 * paginate when they span more than one page. Given arrange labels, readers can sort and filter columns without mutating
 * the source table.
 */
const props = withDefaults(
  defineProps<{
    /** The columns' names and the rows of text cells, such as `parseCsv` reads from a CSV or TSV text. */
    table: TableData;
    /** Rows per page: given, rows paginate when more than one page is present; otherwise all at once. */
    pageSize?: number;
    /** Given, the reader can sort the table by a column and filter a column by its values. */
    arrange?: TableArrangeLabels;
    /** Fixed outer height (CSS length or pixels); the table body scrolls inside the remaining space. */
    height?: string | number;
    /** Maximum height of the scrollable table region (CSS length or pixels). */
    maxHeight?: string | number;
    /** Text shown when there are no visible rows. */
    emptyText?: string;
    /** Wrap long cell text across multiple lines instead of single-line ellipsis with hover title. */
    wrap?: boolean;
  }>(),
  {
    wrap: false,
  },
);

type Order = "ascending" | "descending";
const sort = ref<{ column: number; order: Order } | null>(null);
/** The values each filtered column keeps; a column not in the map keeps every value. */
const kept = ref(new Map<number, Set<string>>());
const page = ref(1);

watch(
  () => props.table,
  () => {
    sort.value = null;
    kept.value = new Map();
    page.value = 1;
  },
);
watch([sort, kept], () => {
  page.value = 1;
});

function cssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

const rootStyle = computed(() => {
  const height = cssSize(props.height);
  return height ? { height } : undefined;
});

const scrollStyle = computed(() => {
  const maxHeight = cssSize(props.maxHeight);
  return maxHeight ? { maxHeight } : undefined;
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

/** Single-column tables align left even for numbers; multi-column tables align numeric columns right. */
const rightAligned = computed(() =>
  props.table.columns.length > 1 ? numeric.value : props.table.columns.map(() => false),
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

function cycleSort(column: number) {
  if (sort.value?.column !== column) {
    sort.value = { column, order: "ascending" };
  } else if (sort.value.order === "ascending") {
    sort.value = { column, order: "descending" };
  } else {
    sort.value = null;
  }
}

function toggleSort(column: number, direction: Order) {
  if (sort.value?.column === column && sort.value.order === direction) {
    sort.value = null;
  } else {
    sort.value = { column, order: direction };
  }
}

function sortOrderFor(column: number): Order | null {
  return sort.value?.column === column ? sort.value.order : null;
}

function ariaSortFor(column: number): "ascending" | "descending" | "none" | undefined {
  if (!props.arrange) return undefined;
  return sortOrderFor(column) ?? "none";
}

function headerClass(column: number) {
  const direction = sortOrderFor(column);
  return {
    "table-preview-arranged": Boolean(props.arrange),
    "is-right": rightAligned.value[column],
    ascending: direction === "ascending",
    descending: direction === "descending",
  };
}
</script>

<template>
  <div class="table-preview" :class="{ 'is-wrap': wrap }" :style="rootStyle">
    <div class="table-preview-scroll" :style="scrollStyle">
      <table
        class="table-preview-table"
        :class="{
          'is-single': table.columns.length === 1,
          'is-two': table.columns.length === 2,
          'is-wrap': wrap,
        }"
      >
        <thead>
          <tr>
            <th
              v-for="(column, index) in table.columns"
              :key="index"
              scope="col"
              class="table-preview-th"
              :class="headerClass(index)"
              :aria-sort="ariaSortFor(index)"
            >
              <div v-if="arrange" class="table-preview-th-inner">
                <button
                  type="button"
                  class="table-preview-heading-button"
                  :title="column"
                  @click="cycleSort(index)"
                >
                  <span class="table-preview-heading">{{ column }}</span>
                </button>
                <ColumnFilter
                  :column="column"
                  :cells="columnCells[index]!"
                  :kept="kept.get(index) ?? null"
                  :labels="arrange"
                  @change="filter(index, $event)"
                />
                <span class="caret-wrapper">
                  <button
                    type="button"
                    class="sort-caret ascending"
                    :aria-label="`${column} ascending`"
                    @click="toggleSort(index, 'ascending')"
                  />
                  <button
                    type="button"
                    class="sort-caret descending"
                    :aria-label="`${column} descending`"
                    @click="toggleSort(index, 'descending')"
                  />
                </span>
              </div>
              <span v-else class="table-preview-heading" :title="column">{{ column }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="rows.length === 0" class="table-preview-empty-row">
            <td :colspan="Math.max(table.columns.length, 1)" class="table-preview-empty">
              {{ emptyText || "—" }}
            </td>
          </tr>
          <tr v-for="row in rows" v-else :key="row.source" class="table-preview-row">
            <td
              v-for="(_, index) in table.columns"
              :key="index"
              class="table-preview-td"
              :class="{ 'is-right': rightAligned[index] }"
            >
              <div class="table-preview-cell" :title="wrap ? undefined : (row.cells[index] || undefined)">
                <slot name="cell" :text="row.cells[index]" :row-index="row.source" :column-index="index">{{ row.cells[index] }}</slot>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
/* In a box of a set height (a dashboard card, a dialog) the scroll region takes what the pager leaves. */
.table-preview {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.table-preview-scroll {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.table-preview-table {
  width: 100%;
  margin: 0;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: auto;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm, 13px);
  line-height: var(--leading-sm, 20px);
  font-variant-numeric: tabular-nums;
}

.table-preview-table.is-single {
  table-layout: fixed;
}

.table-preview-th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px var(--spacing-md, 16px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  line-height: var(--leading-sm, 20px);
  text-align: left;
  white-space: nowrap;
  box-shadow: inset 0 -1px 0 var(--el-border-color-light);
}

.table-preview-th.is-right,
.table-preview-td.is-right {
  text-align: right;
}

.table-preview-td {
  padding: 10px var(--spacing-md, 16px);
  border-bottom: 1px solid var(--el-border-color-lighter);
  vertical-align: middle;
}

.table-preview-table.is-wrap .table-preview-td {
  vertical-align: top;
}

.table-preview-row:last-child .table-preview-td {
  border-bottom: 0;
}

.table-preview-row:hover .table-preview-td {
  background: var(--el-fill-color-lighter);
}

.table-preview-cell {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-preview-table.is-single .table-preview-cell {
  max-width: 100%;
}

.table-preview-table.is-two .table-preview-cell {
  max-width: 480px;
}

.table-preview-td.is-right .table-preview-cell {
  margin-left: auto;
}

.table-preview-table.is-wrap .table-preview-cell {
  max-width: none;
  overflow: visible;
  text-overflow: clip;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.table-preview-th-inner {
  display: flex;
  align-items: center;
  gap: 3px;
  min-height: 20px;
}

.table-preview-th.is-right .table-preview-th-inner {
  justify-content: flex-end;
}

/* Right-aligned columns place filter and sort controls to the left so the heading shares the numbers' right edge. */
.table-preview-th.is-right .table-preview-heading-button {
  order: 1;
}

.table-preview-heading-button {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: inherit;
  cursor: pointer;
}

.table-preview-heading-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: 3px;
}

.table-preview-heading {
  display: block;
  min-width: 0;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-preview-table.is-single .table-preview-heading {
  max-width: 100%;
}

.table-preview-table.is-wrap .table-preview-heading {
  max-width: none;
  white-space: normal;
  overflow-wrap: anywhere;
}

.table-preview-th-inner > :not(.table-preview-heading-button) {
  flex: none;
}

.caret-wrapper {
  position: relative;
  display: inline-flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 20px;
  border-radius: 5px;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}

.table-preview-th.table-preview-arranged :deep(.column-filter-button) {
  opacity: 0;
}

.table-preview-th.table-preview-arranged:hover .caret-wrapper,
.table-preview-th.table-preview-arranged:focus-within .caret-wrapper,
.table-preview-th.table-preview-arranged.ascending .caret-wrapper,
.table-preview-th.table-preview-arranged.descending .caret-wrapper,
.table-preview-th.table-preview-arranged:hover :deep(.column-filter-button),
.table-preview-th.table-preview-arranged:focus-within :deep(.column-filter-button),
.table-preview-th.table-preview-arranged :deep(.column-filter-button.active),
.table-preview-th.table-preview-arranged :deep(.column-filter-button.open) {
  opacity: 1;
}

@media (hover: none) {
  .table-preview-th.table-preview-arranged .caret-wrapper,
  .table-preview-th.table-preview-arranged :deep(.column-filter-button) {
    opacity: 0.72;
  }
}

.caret-wrapper:hover {
  background: var(--el-fill-color-light);
}

/* Keep light outline chevrons with comfortable clickable halves. */
.sort-caret {
  position: relative;
  display: block;
  width: 18px;
  height: 10px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.sort-caret::before {
  content: "";
  position: absolute;
  left: 6px;
  width: 5px;
  height: 5px;
  border-top: 1.5px solid var(--el-text-color-placeholder);
  border-left: 1.5px solid var(--el-text-color-placeholder);
  opacity: 0.62;
}

.sort-caret.ascending::before {
  top: 4px;
  transform: rotate(45deg);
}

.sort-caret.descending::before {
  bottom: 4px;
  transform: rotate(225deg);
}

.ascending .sort-caret.ascending::before,
.descending .sort-caret.descending::before {
  border-color: var(--el-color-primary);
  opacity: 1;
}

.sort-caret:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -1px;
  border-radius: 3px;
}

.table-preview-empty {
  padding: 24px var(--spacing-md, 16px);
  color: var(--el-text-color-secondary);
  text-align: center;
}

.table-preview-pager {
  flex: none;
  justify-content: flex-end;
  padding: 6px var(--spacing-md, 16px);
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (prefers-reduced-motion: reduce) {
  .caret-wrapper {
    transition: none;
  }
}
</style>
