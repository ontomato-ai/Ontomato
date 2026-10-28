<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { jsonTable, parseCsv, type TableData } from "./table-data";
import { useArtifactText } from "./useArtifactBlob";

/** .csv and .json datasets: paginated table; non-tabular JSON falls back to formatted text. */
const props = defineProps<ArtifactRendererProps>();
const { t } = useI18n();
const { text, error } = useArtifactText(props);
const page = ref(1);
const pageSize = computed(() => (props.presentation === "inline" ? 8 : 50));

const parsed = computed<{ table: TableData | null; raw: string | null; invalid: boolean }>(() => {
  if (text.value === null) return { table: null, raw: null, invalid: false };
  if (props.artifact.path.toLowerCase().endsWith(".csv"))
    return { table: parseCsv(text.value), raw: null, invalid: false };
  try {
    const value: unknown = JSON.parse(text.value);
    const table = jsonTable(value);
    return { table, raw: table ? null : JSON.stringify(value, null, 2), invalid: false };
  } catch {
    return { table: null, raw: text.value, invalid: true };
  }
});
const table = computed(() => parsed.value.table);
const visibleRows = computed(() => {
  const rows = table.value?.rows ?? [];
  const start = (page.value - 1) * pageSize.value;
  return rows.slice(start, start + pageSize.value);
});
const NUMBER = /^-?\d[\d,]*(\.\d+)?%?$/;
const numericColumns = computed(() =>
  (table.value?.columns ?? []).map((_, column) => {
    const values = (table.value?.rows ?? []).map((row) => row[column] ?? "").filter((value) => value !== "");
    return values.length > 0 && values.every((value) => NUMBER.test(value));
  }),
);
watch(() => props.artifact.id, () => (page.value = 1));
</script>

<template>
  <div class="table-artifact" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ t("assistant.loading") }}</div>
    <template v-else-if="table">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th v-for="(column, index) in table.columns" :key="index" :class="{ num: numericColumns[index] }">
                {{ column }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in visibleRows" :key="rowIndex">
              <td v-for="(_, index) in table.columns" :key="index" :class="{ num: numericColumns[index] }">
                {{ row[index] ?? "" }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="table-footer">
        <span class="row-count">{{ t("assistant.rows", { n: table.rows.length }, table.rows.length) }}</span>
        <el-pagination
          v-if="table.rows.length > pageSize"
          v-model:current-page="page"
          :page-size="pageSize"
          :total="table.rows.length"
          layout="prev, pager, next"
          size="small"
          background
        />
      </div>
    </template>
    <div v-else-if="parsed.raw !== null && parsed.raw.trim() === ''" class="state">{{ t("assistant.emptyFile") }}</div>
    <pre v-else class="raw" :class="{ invalid: parsed.invalid }">{{ parsed.raw }}</pre>
  </div>
</template>

<style scoped>
.table-artifact {
  min-width: 0;
}
.table-scroll {
  overflow: auto;
}
.inline .table-scroll {
  max-height: 360px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 8px 14px;
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid var(--el-border-color-light);
}
th {
  position: sticky;
  top: 0;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-weight: 600;
  font-size: var(--text-xs);
  letter-spacing: 0.03em;
}
td {
  color: var(--el-text-color-regular);
}
tbody tr:hover td {
  background: var(--el-fill-color-extra-light);
}
.num {
  text-align: right;
}
.table-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px 8px 14px;
}
.row-count {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.state {
  padding: 18px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.state.error {
  color: var(--el-color-danger);
}
.raw {
  margin: 0;
  padding: 14px;
  max-height: 420px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--el-text-color-regular);
}
.panel .raw {
  max-height: none;
}
</style>
