<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { ChevronDown, ChevronUp } from "lucide-vue-next";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { TablePreview, jsonTable, parseCsv, type TableArrangeLabels, type TableData } from "@ontomato/foundation-ui/preview";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { useArtifactText } from "./useArtifactBlob";
import SubgraphView from "./SubgraphView.vue";
import AttachmentCell from "./AttachmentCell.vue";
import { cellAttachments } from "./cell-attachments";

/**
 * .csv and .json datasets in the shared table, a page at a time, which the reader can sort and filter without changing
 * the file; JSON that is not a table shows as its formatted source. Result limits appear before the table. A dataset
 * carrying its source analysis states it under the table, each query with its conditions, and opens the graph in place.
 */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);
const arrange = computed<TableArrangeLabels>(() => ({
  filter: labels.value.filterColumn,
  search: labels.value.filterSearch,
  all: labels.value.filterAll,
  empty: labels.value.filterEmpty,
}));
const { text, error } = useArtifactText(props);
const pageSize = computed(() => (props.presentation === "inline" ? 8 : 50));

type Parsed = {
  table: TableData | null;
  raw: string | null;
  invalid: boolean;
  graph: QuerySubgraph | null;
  /** The row limit a partial dataset was cut at, from the file's own truncation marker. */
  rowLimit: number | null;
  dataset: boolean;
};
const parsed = computed<Parsed>(() => {
  const none = { graph: null, rowLimit: null, dataset: false };
  if (text.value === null) return { table: null, raw: null, invalid: false, ...none };
  if (props.artifact.path.toLowerCase().endsWith(".csv"))
    return { table: parseCsv(text.value), raw: null, invalid: false, ...none };
  try {
    const value: unknown = JSON.parse(text.value);
    const table = jsonTable(value);
    const dataset = value as { schema?: string; sourceAnalysis?: QuerySubgraph; truncation?: { rowLimit: number } | null } | null;
    const graph = table && dataset?.sourceAnalysis?.schema === "ontomato.query-subgraph.v1" ? dataset.sourceAnalysis : null;
    const formal = table && (dataset?.schema === "workbench.dataset.v1" || dataset?.schema === "workbench.dataset.v2");
    return {
      table, raw: table ? null : JSON.stringify(value, null, 2), invalid: false, graph,
      rowLimit: table ? dataset?.truncation?.rowLimit ?? null : null,
      dataset: formal || /\.dataset\.json$/i.test(props.artifact.path),
    };
  } catch {
    return { table: null, raw: text.value, invalid: true, ...none };
  }
});
const table = computed(() => parsed.value.table);
const rowGalleries = computed(() => table.value?.rows.map(row => row.flatMap(cellAttachments).filter(item => item.kind === "image")) ?? []);
function displayDate(text: string | undefined): string | null {
  if (!parsed.value.dataset || !text) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!match || !Number.isFinite(Date.parse(text))) return null;
  const [, date, time, fraction = ""] = match;
  const precision = fraction.replace(/0+$/, "").replace(/\.$/, "");
  return time === "00:00:00" && !precision ? date! : `${date} ${time}${precision}`;
}
/** Each query of the source analysis as the file states it, with its conditions. */
const lineage = computed(() => {
  const graph = parsed.value.graph;
  return graph?.queries.map((query) => ({ ...query, filters: graph.filters.filter((filter) => filter.queryId === query.id) })) ?? [];
});
/** The graph starts expanded in place so the lineage is visible by default; readers can collapse it. */
const lineageOpen = ref(true);
watch(() => props.artifact.id, () => {
  lineageOpen.value = true;
});
</script>

<template>
  <div class="table-renderer" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ labels.loading }}</div>
    <template v-else-if="table">
      <p v-if="parsed.rowLimit !== null" class="partial" role="note">{{ labels.truncatedRows(parsed.rowLimit) }}</p>
      <TablePreview
        :table="table"
        :page-size="pageSize"
        :max-height="presentation === 'inline' ? 360 : undefined"
        :arrange="arrange"
      >
        <template #cell="{ text: cellText, rowIndex }">
          <span v-if="displayDate(cellText)" :title="cellText">{{ displayDate(cellText) }}</span>
          <AttachmentCell v-else :text="cellText ?? ''" :gallery="rowGalleries[rowIndex]" />
        </template>
      </TablePreview>
      <section v-if="parsed.graph" class="lineage" :aria-label="labels.datasetLineage">
        <div class="lineage-bar">
          <div class="lineage-summary">
            <span class="lineage-title">{{ labels.datasetLineage }}</span>
            <ul v-if="lineage.length" class="lineage-queries">
              <li v-for="query in lineage" :key="query.id">
                <span class="lineage-query">{{ query.label }}</span>
                <span v-for="filter in query.filters" :key="filter.id" class="lineage-filter" :title="filter.expression">{{ filter.label }}</span>
              </li>
            </ul>
          </div>
          <button type="button" class="lineage-toggle" :aria-expanded="lineageOpen" @click="lineageOpen = !lineageOpen">
            {{ lineageOpen ? labels.hideLineage : labels.showLineage }}
            <component :is="lineageOpen ? ChevronUp : ChevronDown" :size="14" aria-hidden="true" />
          </button>
        </div>
        <div v-if="lineageOpen" class="lineage-graph">
          <SubgraphView :graph="parsed.graph" />
        </div>
      </section>
    </template>
    <div v-else-if="parsed.raw !== null && parsed.raw.trim() === ''" class="state">{{ labels.emptyFile }}</div>
    <div v-else-if="parsed.raw !== null" class="raw">
      <CodeEditor :model-value="parsed.raw" :language="parsed.invalid ? 'text' : 'json'" readonly :min-height="80" />
    </div>
  </div>
</template>

<style scoped>
.table-renderer {
  min-width: 0;
}
.partial {
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-md);
  color: var(--el-color-warning-dark-2, var(--el-text-color-primary));
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.lineage {
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.lineage-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: 8px var(--spacing-lg, 16px);
  background: transparent;
}
.inline .lineage-graph {
  max-height: 260px;
  overflow-y: auto;
}
.panel .lineage-graph {
  max-height: 440px;
  overflow-y: auto;
}
.lineage-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  min-width: 0;
  flex: 1 1 auto;
}
.lineage-title {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold, 600);
  line-height: 1.6;
}
.lineage-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  font-size: var(--text-xs);
  line-height: 1.6;
  cursor: pointer;
}
.lineage-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.lineage-toggle:hover { background: var(--el-fill-color); }
.lineage-queries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.lineage-queries li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.lineage-query {
  color: var(--el-text-color-primary);
}
.lineage-filter {
  padding: 1px 6px;
  border: 0;
  border-radius: var(--radius-xs, 4px);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}
.state {
  padding: 18px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
.state.error {
  color: var(--el-color-danger);
}
.inline .raw {
  max-height: 420px;
  overflow: auto;
}
</style>
