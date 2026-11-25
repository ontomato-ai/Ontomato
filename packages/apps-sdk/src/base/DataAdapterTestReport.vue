<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElAlert } from "element-plus/es/components/alert/index";
import { ElDescriptions, ElDescriptionsItem } from "element-plus/es/components/descriptions/index";
import { dataAdapterTestResultSchema } from "@ontomato/contracts/data-adapters";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type { DataAdapterTestOutcome } from "./data-adapter-test-report-types";

/**
 * Dedicated structured presentation for a data adapter connection test: semantic success/error alert, bordered
 * metadata description table (duration, database/driver or search engine/cluster), and a max-height scrollable
 * table/index list with monospace names and secondary types.
 *
 * Accepts either a pre-built `outcome` or the raw `result` + `error` from an `OperationButton` `#result` slot.
 */
const props = withDefaults(
  defineProps<{
    /** Pre-parsed test outcome (`{ ok: true, result }` or `{ ok: false, message }`). */
    outcome?: DataAdapterTestOutcome | null;
    /** Raw read-only operation result (expects `kind: "json"` matching `dataAdapterTestResultSchema`). */
    result?: PanelReadOperationResult | null;
    /** Optional error raised by the connection test operation. */
    error?: Error | string | null;
  }>(),
  {
    outcome: null,
    result: null,
    error: null,
  },
);

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();

function translate(key: string, fallback: string, params?: Record<string, unknown>): string {
  if (!i18n || !i18n.te(key)) {
    if (!params) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, token: string) => String(params[token] ?? ""));
  }
  return params ? i18n.t(key, params) : i18n.t(key);
}

const resolved = computed<DataAdapterTestOutcome | null>(() => {
  if (props.outcome) return props.outcome;
  if (props.error) {
    const message = props.error instanceof Error ? props.error.message : String(props.error);
    return { ok: false, message };
  }
  if (!props.result) return null;
  if (props.result.kind === "json") {
    const parsed = dataAdapterTestResultSchema.safeParse(props.result.value);
    if (parsed.success) return { ok: true, result: parsed.data };
    if (
      props.result.value !== null
      && typeof props.result.value === "object"
      && !Array.isArray(props.result.value)
    ) {
      const record = props.result.value as Record<string, unknown>;
      if (record.ok === true) {
        const inner = dataAdapterTestResultSchema.safeParse(record.result);
        if (inner.success) return { ok: true, result: inner.data };
      }
      if (record.ok === false && typeof record.message === "string") {
        return { ok: false, message: record.message };
      }
    }
  }
  return {
    ok: false,
    message: translate(
      "admin.dataAdapterInvalidReport",
      "The connection test returned a report in an unrecognized format",
    ),
  };
});
</script>

<template>
  <div v-if="resolved" class="sdk-adapter-test-result" role="status">
    <template v-if="resolved.ok">
      <el-alert
        type="success"
        :title="translate('admin.dataAdapterTestSucceeded', 'Connection succeeded')"
        :closable="false"
        show-icon
      />
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item :label="translate('common.duration', 'Duration')">
          {{ resolved.result.elapsedMs }} ms
        </el-descriptions-item>
        <template v-if="resolved.result.kind === 'catalog'">
          <el-descriptions-item :label="translate('admin.databaseProduct', 'Database')">
            {{ resolved.result.databaseProduct }} {{ resolved.result.databaseVersion }}
          </el-descriptions-item>
          <el-descriptions-item :label="translate('admin.databaseDriver', 'Driver')">
            {{ resolved.result.driverName }} {{ resolved.result.driverVersion }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="resolved.result.catalog !== null"
            :label="translate('admin.databaseCatalog', 'Catalog')"
          >
            {{ resolved.result.catalog }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="resolved.result.schema !== null"
            :label="translate('admin.databaseSchema', 'Schema')"
          >
            {{ resolved.result.schema }}
          </el-descriptions-item>
        </template>
        <template v-else>
          <el-descriptions-item :label="translate('admin.searchEngine', 'Engine')">
            {{ resolved.result.databaseProduct }} {{ resolved.result.databaseVersion ?? "" }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="resolved.result.clusterName !== null"
            :label="translate('admin.searchCluster', 'Cluster')"
          >
            {{ resolved.result.clusterName }}
          </el-descriptions-item>
        </template>
      </el-descriptions>
      <template v-if="resolved.result.kind === 'catalog'">
        <div class="sdk-adapter-test-section">
          {{ translate("admin.dataAdapterTables", "Tables and views ({n})", { n: resolved.result.tables.length }) }}
        </div>
        <ul v-if="resolved.result.tables.length > 0" class="sdk-adapter-table-list">
          <li v-for="(table, index) in resolved.result.tables" :key="index">
            <span class="sdk-adapter-table-name">{{ table.name }}</span>
            <span class="sdk-adapter-table-type">{{ table.type }}</span>
          </li>
        </ul>
        <p v-else class="sdk-adapter-empty">{{ translate("admin.dataAdapterNoTables", "No tables or views found") }}</p>
      </template>
      <template v-else>
        <div class="sdk-adapter-test-section">
          {{ translate("admin.dataAdapterIndices", "Indices ({n})", { n: resolved.result.indices.length }) }}
        </div>
        <ul v-if="resolved.result.indices.length > 0" class="sdk-adapter-table-list">
          <li v-for="index in resolved.result.indices" :key="index">
            <span class="sdk-adapter-table-name">{{ index }}</span>
          </li>
        </ul>
        <p v-else class="sdk-adapter-empty">{{ translate("admin.dataAdapterNoIndices", "No indices found") }}</p>
      </template>
    </template>
    <el-alert
      v-else
      type="error"
      :title="translate('admin.dataAdapterTestFailed', 'Connection failed')"
      :closable="false"
      show-icon
    >
      <pre class="sdk-adapter-test-message">{{ resolved.message }}</pre>
    </el-alert>
  </div>
</template>

<style scoped>
.sdk-adapter-test-result {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-md);
  min-width: 0;
}

.sdk-adapter-test-result :deep(.el-descriptions__label) {
  width: 160px;
}

.sdk-adapter-test-result :deep(.el-descriptions__content) {
  overflow-wrap: anywhere;
}

.sdk-adapter-test-result :deep(.el-alert__content) {
  min-width: 0;
}

.sdk-adapter-test-message {
  margin: var(--spacing-xs) 0 0;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--text-mono);
  user-select: text;
}

.sdk-adapter-test-section {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}

.sdk-adapter-table-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
}

.sdk-adapter-table-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: var(--spacing-xs) var(--spacing-md);
  font-size: var(--text-sm);
}

.sdk-adapter-table-list li + li {
  border-top: 1px solid var(--el-border-color-lighter);
}

.sdk-adapter-table-name {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  color: var(--el-text-color-primary);
}

.sdk-adapter-table-type {
  flex-shrink: 0;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}

.sdk-adapter-empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
</style>
