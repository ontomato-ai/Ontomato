<script setup lang="ts">
import { ref } from "vue";
import { ElButton, ElInput, ElSelect, ElOption, ElTag, ElForm, ElFormItem, ElTable, ElTableColumn, ElAlert } from "element-plus";

/** Development-only reference, mounted by the visual review harness; never registered as a product route. */
const text = ref("Quarterly revenue");
const status = ref("published");
const rows = [
  { name: "Quarterly revenue", id: "metric-revenue-2026", value: "128,400.00", status: "Published" },
  { name: "A longer business label that must remain readable at narrow widths", id: "metric-long-identifier-2026-11-06", value: "0.00", status: "Draft" },
];
</script>

<template>
  <main class="reference">
    <header><h1>Ontomato UI reference</h1><p>Shared controls, typography, status, tables and focus</p></header>
    <section aria-label="Actions" class="controls">
      <el-button type="primary">Save changes</el-button><el-button>Secondary</el-button>
      <el-button text>Text action</el-button><el-button type="danger" plain>Delete</el-button>
      <el-button disabled>Disabled</el-button><el-button size="small">Compact</el-button>
    </section>
    <section class="controls" aria-label="Status">
      <el-tag type="success">Published</el-tag><el-tag type="warning">Pending review</el-tag>
      <el-tag type="danger">Failed</el-tag><el-tag type="info">Internal</el-tag>
    </section>
    <el-form label-position="top" class="form">
      <el-form-item label="Name"><el-input v-model="text" /></el-form-item>
      <el-form-item label="Status"><el-select v-model="status"><el-option value="published" label="Published" /><el-option value="draft" label="Draft" /></el-select></el-form-item>
      <el-form-item label="Disabled field"><el-input model-value="Read only" disabled /></el-form-item>
    </el-form>
    <el-alert title="Changes are saved only when you submit the form." type="info" show-icon :closable="false" />
    <el-table :data="rows" class="admin-table" highlight-current-row>
      <el-table-column prop="name" label="Metric" min-width="220" show-overflow-tooltip />
      <el-table-column prop="value" label="Value" align="right" min-width="140" />
      <el-table-column prop="status" label="Status" min-width="120" />
    </el-table>
    <article><h2>Reading and evidence</h2><p>Answers should remain readable while execution details recede. Each visual relationship has one spacing owner.</p><pre>SELECT department, SUM(amount)
FROM ExpenseReport
GROUP BY department</pre></article>
  </main>
</template>

<style scoped>
.reference { max-width: 960px; margin: 0 auto; padding: var(--spacing-xl); color: var(--el-text-color-primary); background: var(--el-bg-color); font: var(--text-base)/var(--leading-base) var(--font-sans); }
header { margin-bottom: var(--spacing-xl); }
h1 { margin: 0; font-size: var(--text-title-lg); line-height: var(--leading-title-lg); font-weight: var(--font-semibold); }
h2 { font-size: var(--text-lg); font-weight: var(--font-semibold); }
p { color: var(--el-text-color-secondary); }
.controls { display: flex; flex-wrap: wrap; gap: var(--component-gap); margin-bottom: var(--spacing-lg); }
.controls :deep(.el-button) { margin: 0; }
.form { max-width: 520px; }
.admin-table { margin-block: var(--spacing-lg); border: 1px solid var(--el-border-color); border-radius: var(--radius-md); }
pre { padding: var(--surface-padding); border-radius: var(--radius-sm); background: var(--el-fill-color-light); font: var(--text-mono)/var(--leading-mono) var(--font-mono); overflow-x: auto; }
</style>
