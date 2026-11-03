<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { DataAdapterTestOutcome } from "../types";

// The outcome of one connection test: the adapter's catalog or search report, or the failure message verbatim.
const { t } = useI18n();

defineProps<{ test: DataAdapterTestOutcome }>();
</script>

<template>
  <div class="adapter-test-result">
    <template v-if="test.ok">
      <el-alert
        type="success"
        :title="t('admin.dataAdapterTestSucceeded')"
        :closable="false"
        show-icon
      />
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item :label="t('common.duration')">
          {{ test.result.elapsedMs }} ms
        </el-descriptions-item>
        <template v-if="test.result.kind === 'catalog'">
          <el-descriptions-item :label="t('admin.databaseProduct')">
            {{ test.result.databaseProduct }} {{ test.result.databaseVersion }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('admin.databaseDriver')">
            {{ test.result.driverName }} {{ test.result.driverVersion }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="test.result.catalog !== null"
            :label="t('admin.databaseCatalog')"
          >
            {{ test.result.catalog }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="test.result.schema !== null"
            :label="t('admin.databaseSchema')"
          >
            {{ test.result.schema }}
          </el-descriptions-item>
        </template>
        <template v-else>
          <el-descriptions-item :label="t('admin.searchEngine')">
            {{ test.result.databaseProduct }} {{ test.result.databaseVersion }}
          </el-descriptions-item>
          <el-descriptions-item
            v-if="test.result.clusterName !== null"
            :label="t('admin.searchCluster')"
          >
            {{ test.result.clusterName }}
          </el-descriptions-item>
        </template>
      </el-descriptions>
      <template v-if="test.result.kind === 'catalog'">
        <div class="adapter-test-section">
          {{ t("admin.dataAdapterTables", { n: test.result.tables.length }) }}
        </div>
        <ul v-if="test.result.tables.length > 0" class="adapter-table-list">
          <li v-for="(table, index) in test.result.tables" :key="index">
            <span class="adapter-table-name">{{ table.name }}</span>
            <span class="adapter-table-type">{{ table.type }}</span>
          </li>
        </ul>
        <p v-else class="card-empty">{{ t("admin.dataAdapterNoTables") }}</p>
      </template>
      <template v-else>
        <div class="adapter-test-section">
          {{ t("admin.dataAdapterIndices", { n: test.result.indices.length }) }}
        </div>
        <ul v-if="test.result.indices.length > 0" class="adapter-table-list">
          <li v-for="index in test.result.indices" :key="index">
            <span class="adapter-table-name">{{ index }}</span>
          </li>
        </ul>
        <p v-else class="card-empty">{{ t("admin.dataAdapterNoIndices") }}</p>
      </template>
    </template>
    <el-alert
      v-else
      type="error"
      :title="t('admin.dataAdapterTestFailed')"
      :closable="false"
      show-icon
    >
      <pre class="adapter-test-message">{{ test.message }}</pre>
    </el-alert>
  </div>
</template>

<style scoped src="./config.css"></style>
