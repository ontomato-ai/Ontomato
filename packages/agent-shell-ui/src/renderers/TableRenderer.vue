<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { TablePreview, jsonTable, parseCsv, type TableData } from "@ontomato/foundation-ui/preview";
import { artifactHeaderKey, shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import type { QuerySubgraph } from "@ontomato/contracts/query-subgraph";
import { useArtifactText } from "./useArtifactBlob";
import SubgraphView from "./SubgraphView.vue";
import SlotOutlet from "../components/SlotOutlet.vue";
import DatasetSelectionButton from "../components/DatasetSelectionButton.vue";

/**
 * .csv and .json datasets in the shared table, a page at a time; JSON that is not a table shows as its formatted source.
 * A dataset carrying its source analysis can switch to that graph, and its rows can be chosen to continue the analysis.
 */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const continueConversation = computed(() => props.continueConversation ?? shell.continueConversation);
const headerControls = inject(artifactHeaderKey, ref<HTMLElement | null>(null));
const labels = computed(() => shell.labels.value);
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

const parsed = computed<{ table: TableData | null; raw: string | null; invalid: boolean; graph: QuerySubgraph | null }>(() => {
  if (text.value === null) return { table: null, raw: null, invalid: false, graph: null };
  if (props.artifact.path.toLowerCase().endsWith(".csv"))
    return { table: parseCsv(text.value), raw: null, invalid: false, graph: null };
  try {
    const value: unknown = JSON.parse(text.value);
    const table = jsonTable(value);
    const analysis = (value as { sourceAnalysis?: QuerySubgraph } | null)?.sourceAnalysis;
    const graph = table && analysis?.schema === "ontomato.query-subgraph.v1" ? analysis : null;
    return { table, raw: table ? null : JSON.stringify(value, null, 2), invalid: false, graph };
  } catch {
    return { table: null, raw: text.value, invalid: true, graph: null };
  }
});
const view = ref<"data" | "lineage">("data");
const table = computed(() => parsed.value.table);
watch(() => props.artifact.id, () => {
  view.value = "data";
  selected.value = [];
  continuationError.value = "";
});
</script>

<template>
  <div class="table-renderer" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ labels.loading }}</div>
    <template v-else-if="table">
      <Teleport v-if="parsed.graph" :to="headerControls ?? 'body'" :disabled="!headerControls">
      <div class="views" role="tablist" :aria-label="title">
        <button type="button" role="tab" :aria-selected="view === 'data'" :class="{ on: view === 'data' }" @click="view = 'data'">
          {{ labels.datasetData }}
        </button>
        <button type="button" role="tab" :aria-selected="view === 'lineage'" :class="{ on: view === 'lineage' }" @click="view = 'lineage'">
          {{ labels.datasetLineage }}
        </button>
      </div>
      </Teleport>
      <SubgraphView v-if="parsed.graph && view === 'lineage'" :graph="parsed.graph" />
      <template v-else>
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
        @update:selected="selected = $event"
      />
      </template>
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
.views {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: 0;
  flex-shrink: 0;
}
.views button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--control-height-sm);
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-xs, 12px);
  line-height: var(--leading-xs);
  cursor: pointer;
}
.views button:hover {
  background: var(--el-fill-color);
}
.views button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 1px;
}
.views button.on {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
  font-weight: 500;
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
