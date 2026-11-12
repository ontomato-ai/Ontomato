<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { TablePreview, jsonTable, parseCsv, type TableArrangeLabels, type TableData } from "@ontomato/foundation-ui/preview";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { useArtifactText } from "./useArtifactBlob";
import SubgraphView from "./SubgraphView.vue";
import SlotOutlet from "../components/SlotOutlet.vue";
import DatasetSelectionButton from "../components/DatasetSelectionButton.vue";

/**
 * .csv and .json datasets in the shared table, a page at a time, which the reader can sort and filter without changing
 * the file; JSON that is not a table shows as its formatted source. A partial result says so under the table. A dataset
 * carrying its source analysis states it under the table, each query with its conditions, and opens the graph in place.
 * Its rows can be chosen to continue the analysis.
 */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const continueConversation = computed(() => props.continueConversation ?? shell.continueConversation);
const labels = computed(() => shell.labels.value);
const arrange = computed<TableArrangeLabels>(() => ({
  filter: labels.value.filterColumn,
  search: labels.value.filterSearch,
  all: labels.value.filterAll,
  empty: labels.value.filterEmpty,
}));
const lineageColumns = computed(() => ({
  class: labels.value.lineageSources,
  field: labels.value.lineageFields,
  operation: labels.value.lineageOperations,
  output: labels.value.lineageOutputs,
}));
const { text, error } = useArtifactText(props);
const pageSize = computed(() => (props.presentation === "inline" ? 8 : 50));
const selected = ref<number[]>([]);
const continuing = ref(false);
const continuationError = ref("");
const selectRowLabel = (row: number) => labels.value.selectRow?.(row) ?? `Select row ${row}`;
async function analyzeSelection(compare = false) {
  if (!continueConversation.value || !selected.value.length || continuing.value) return;
  continuing.value = true; continuationError.value = "";
  // Selected indices are positions in the immutable source file, so the row numbers name the same records whatever the table shows.
  const file = { title: props.title, path: props.artifact.path };
  const rows = [...selected.value].sort((left, right) => left - right).map((index) => index + 1);
  const message = compare
    ? labels.value.compareSelectionMessage?.(file, rows) ?? `Compare rows ${rows.join(", ")} of the data file "${file.title}" (${file.path}).`
    : labels.value.analyzeSelectionMessage?.(file, rows) ?? `Analyze rows ${rows.join(", ")} of the data file "${file.title}" (${file.path}).`;
  try {
    await continueConversation.value(message);
  } catch (e) { continuationError.value = e instanceof Error ? e.message : labels.value.failed; }
  finally { continuing.value = false; }
}

type Parsed = {
  table: TableData | null;
  raw: string | null;
  invalid: boolean;
  graph: QuerySubgraph | null;
  /** The row limit a partial dataset was cut at, from the file's own truncation marker. */
  rowLimit: number | null;
};
const parsed = computed<Parsed>(() => {
  const none = { graph: null, rowLimit: null };
  if (text.value === null) return { table: null, raw: null, invalid: false, ...none };
  if (props.artifact.path.toLowerCase().endsWith(".csv"))
    return { table: parseCsv(text.value), raw: null, invalid: false, ...none };
  try {
    const value: unknown = JSON.parse(text.value);
    const table = jsonTable(value);
    const dataset = value as { sourceAnalysis?: QuerySubgraph; truncation?: { rowLimit: number } | null } | null;
    const graph = table && dataset?.sourceAnalysis?.schema === "ontomato.query-subgraph.v1" ? dataset.sourceAnalysis : null;
    return {
      table, raw: table ? null : JSON.stringify(value, null, 2), invalid: false, graph,
      rowLimit: table ? dataset?.truncation?.rowLimit ?? null : null,
    };
  } catch {
    return { table: null, raw: text.value, invalid: true, ...none };
  }
});
const table = computed(() => parsed.value.table);
/** Each query of the source analysis as the file states it, with its conditions. */
const lineage = computed(() => {
  const graph = parsed.value.graph;
  return graph?.queries.map((query) => ({ ...query, filters: graph.filters.filter((filter) => filter.queryId === query.id) })) ?? [];
});
/** The graph opens in place; the side panel has room for it, so it starts open there. */
const lineageOpen = ref(props.presentation === "panel");
watch(() => props.artifact.id, () => {
  lineageOpen.value = props.presentation === "panel";
  selected.value = [];
  continuationError.value = "";
});
</script>

<template>
  <div class="table-renderer" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ labels.loading }}</div>
    <template v-else-if="table">
      <div v-if="continueConversation && selected.length" class="selection-actions">
        <span>{{ labels.selectedRows?.(selected.length) ?? `${selected.length} selected` }}</span>
        <SlotOutlet :content="shell.slots?.datasetSelectionActions" :scope="{ artifact, title, selectedRowIndices: selected }" />
        <DatasetSelectionButton :disabled="continuing" @click="analyzeSelection()">{{ labels.analyzeSelection ?? 'Analyze selection' }}</DatasetSelectionButton>
        <DatasetSelectionButton v-if="selected.length > 1" :disabled="continuing" @click="analyzeSelection(true)">{{ labels.compareSelection ?? 'Compare selection' }}</DatasetSelectionButton>
        <DatasetSelectionButton :disabled="continuing" @click="selected = []">{{ labels.clearSelection ?? 'Clear selection' }}</DatasetSelectionButton>
      </div>
      <p v-if="continuationError" class="selection-error" role="alert">{{ continuationError }}</p>
      <TablePreview
        :table="table"
        :page-size="pageSize"
        :max-height="presentation === 'inline' ? 360 : undefined"
        :selected="continueConversation ? selected : undefined"
        :select-row-label="selectRowLabel"
        :selection-disabled="continuing"
        :arrange="arrange"
        @update:selected="selected = $event"
      />
      <p v-if="parsed.rowLimit !== null" class="partial" role="note">{{ labels.truncatedRows(parsed.rowLimit) }}</p>
      <section v-if="parsed.graph" class="lineage" :aria-label="labels.datasetLineage">
        <div class="lineage-head">
          <span class="lineage-title">{{ labels.datasetLineage }}</span>
          <button type="button" class="lineage-toggle" :aria-expanded="lineageOpen" @click="lineageOpen = !lineageOpen">
            {{ lineageOpen ? labels.hideLineage : labels.showLineage }}
          </button>
        </div>
        <ul class="lineage-queries">
          <li v-for="query in lineage" :key="query.id">
            <span class="lineage-query">{{ query.label }}</span>
            <span v-for="filter in query.filters" :key="filter.id" class="lineage-filter" :title="filter.expression">{{ filter.label }}</span>
          </li>
        </ul>
        <SubgraphView v-if="lineageOpen" :graph="parsed.graph" :columns="lineageColumns" />
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
.selection-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); padding: var(--spacing-sm) var(--spacing-md); border-bottom: 1px solid var(--el-border-color-light); font-size: var(--text-xs); }
.selection-error { margin: 0; padding: var(--spacing-sm) var(--spacing-md); color: var(--el-color-danger); }
.partial {
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-md);
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.lineage {
  border-top: 1px solid var(--el-border-color-lighter);
}
.lineage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md) 0;
}
.lineage-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold, 600);
}
.lineage-toggle {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.lineage-toggle:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.lineage-queries {
  list-style: none;
  margin: 0;
  padding: var(--spacing-xs) var(--spacing-md) var(--spacing-sm);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.lineage-queries li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  color: var(--el-text-color-regular);
  font-size: var(--text-xs);
  line-height: var(--leading-xs, 1.5);
}
.lineage-query {
  margin-right: var(--spacing-xs);
}
.lineage-filter {
  padding: 0 6px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
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
