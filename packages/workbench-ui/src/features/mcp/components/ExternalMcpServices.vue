<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { Pencil, Plug, RefreshCw, Search, Trash2 } from "lucide-vue-next";
import type { McpServiceView } from "@ontomato/contracts/agent-runtime-mcp";
import { PlatformPageHeader } from "@ontomato/platform-shell";
import { agentDefinitionsApi } from "../../agents/api";
import { deleteMcpService, listExternalMcpTools, listMcpServices, type McpTool } from "../api";
import McpServiceDialog from "./McpServiceDialog.vue";
import McpToolList from "./McpToolList.vue";

/**
 * The external MCP services agents can call, registered once for the platform in the system settings; each agent picks
 * the ones it uses in its own settings. The list needs only the MCP permission. Which agents use a service is shown to
 * whoever may read the agents too (`showUsage`), from a read of its own that never holds the list back.
 */
const props = defineProps<{ showUsage: boolean }>();
const { t, locale } = useI18n();

interface Row {
  service: McpServiceView;
  /** The tools the last check discovered; null until checked. */
  tools: McpTool[] | null;
  /** The last check failed. */
  failed: boolean;
}

const rows = ref<Row[]>([]);
const usage = ref<Record<string, string[]> | null>(null);
const loading = ref(true);
const loadFailed = ref(false);
const search = ref("");
const checking = ref<string | null>(null);
const dialog = ref(false);
const editing = ref<McpServiceView | null>(null);
let loadVersion = 0;

async function loadUsage() {
  const agents = await agentDefinitionsApi.list();
  usage.value = Object.fromEntries(rows.value.map((row) => [
    row.service.id,
    agents.filter((agent) => agent.enabledMcpServiceIds.includes(row.service.id)).map((agent) => agent.name),
  ]));
}

async function load() {
  const version = ++loadVersion;
  loading.value = true;
  loadFailed.value = false;
  try {
    const services = await listMcpServices();
    if (version !== loadVersion) return;
    rows.value = services.map((service) => ({ service, tools: null, failed: false }));
  } catch {
    if (version === loadVersion) loadFailed.value = true;
    return;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
  if (props.showUsage) void loadUsage();
}
onMounted(load);
watch(locale, load);

const visibleRows = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return rows.value;
  return rows.value.filter((row) =>
    row.service.name.toLowerCase().includes(keyword) || row.service.url.toLowerCase().includes(keyword));
});

function add() {
  editing.value = null;
  dialog.value = true;
}

function edit(row: Row) {
  editing.value = row.service;
  dialog.value = true;
}

/** Checking a connection discovers the service's tools; the result stays in the row it belongs to. */
async function check(row: Row) {
  checking.value = row.service.id;
  row.failed = false;
  try {
    row.tools = await listExternalMcpTools(row.service.id);
    ElMessage.success(t("capabilities.connectionOk", { count: row.tools.length }));
  } catch {
    row.failed = true;
    row.tools = null;
  } finally {
    checking.value = null;
  }
}

async function remove(row: Row) {
  try {
    await ElMessageBox.confirm(t("hotData.deleteMcpConfirm", { name: row.service.name }), t("common.tip"), { type: "warning" });
  } catch {
    return;
  }
  try {
    await deleteMcpService(row.service.id);
  } catch {
    ElMessage.error(t("admin.deleteFailed"));
    return;
  }
  rows.value = rows.value.filter((item) => item !== row);
  ElMessage.success(t("admin.deletedSuccess"));
}
</script>

<template>
  <div class="external-mcp platform-page">
    <PlatformPageHeader :title="t('capabilities.mcpTitle')" :description="t('capabilities.mcpDescription')">
      <template #actions>
        <el-button :icon="RefreshCw" :loading="loading" @click="load">{{ t("common.refresh") }}</el-button>
        <el-button type="primary" :icon="Plug" @click="add">{{ t("hotData.addService") }}</el-button>
      </template>
    </PlatformPageHeader>
    <div class="mcp-body platform-page-gutter">
      <el-input v-model="search" class="search" :placeholder="t('capabilities.searchMcp')" :prefix-icon="Search" clearable />
      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon :title="t('capabilities.loadFailed')">
        <el-button text @click="load">{{ t("common.retry") }}</el-button>
      </el-alert>
      <el-table v-else v-loading="loading" :data="visibleRows" class="mcp-table" row-key="service.id">
        <el-table-column :label="t('capabilities.mcpTitle')" min-width="240">
          <template #default="{ row }">
            <span class="row-name">{{ row.service.name }}</span>
            <p class="row-address">{{ row.service.url }}</p>
          </template>
        </el-table-column>
        <el-table-column v-if="showUsage" :label="t('capabilities.usedBy')" min-width="180">
          <template #default="{ row }">
            <template v-if="usage">
              <span v-if="usage[row.service.id]?.length">{{ usage[row.service.id]!.join(", ") }}</span>
              <span v-else class="muted">{{ t("capabilities.unused") }}</span>
            </template>
          </template>
        </el-table-column>
        <el-table-column :label="t('capabilities.status')" width="140">
          <template #default="{ row }">
            <el-tag size="small" :type="row.failed ? 'danger' : 'success'" effect="plain">
              {{ row.failed ? t("capabilities.unreachable") : t("capabilities.available") }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('capabilities.actions')" width="220" align="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button size="small" text :loading="checking === row.service.id" @click="check(row)">
                {{ t("capabilities.check") }}
              </el-button>
              <el-button size="small" text :icon="Pencil" @click="edit(row)">{{ t("common.edit") }}</el-button>
              <el-button size="small" text type="danger" :icon="Trash2" :aria-label="t('common.delete')" @click="remove(row)" />
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <span class="muted">{{ search ? t("capabilities.noMatch") : t("capabilities.emptyMcp") }}</span>
        </template>
      </el-table>
      <section v-if="visibleRows.some((row) => row.tools)" class="discovered">
        <template v-for="row in visibleRows" :key="row.service.id">
          <article v-if="row.tools" class="discovered-card">
            <h4>{{ row.service.name }}</h4>
            <McpToolList :tools="row.tools" />
          </article>
        </template>
      </section>
    </div>
    <McpServiceDialog v-model:visible="dialog" :service="editing" @saved="load" />
  </div>
</template>

<style scoped>
.external-mcp {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  min-width: 0;
}
.mcp-body {
  display: flex;
  flex-direction: column;
  gap: var(--page-content-gap);
  padding-block: var(--page-content-gap) var(--spacing-xl);
  min-width: 0;
}
.search {
  width: 240px;
  max-width: 100%;
}
.mcp-table {
  --el-table-header-bg-color: var(--el-fill-color);
  --el-table-row-hover-bg-color: var(--el-fill-color-light);
  --el-table-border-color: var(--el-border-color-light);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
}
.mcp-table :deep(.el-table__inner-wrapper::before) { display: none; }
.mcp-table :deep(th.el-table__cell) {
  height: var(--table-head-height);
  padding-block: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
}
.mcp-table :deep(td.el-table__cell) {
  height: var(--list-row-height);
  padding-block: var(--spacing-sm);
  font-size: var(--text-sm);
}
.mcp-table :deep(.cell) { padding-inline: var(--spacing-md); }
.mcp-table :deep(tr:last-child td.el-table__cell) { border-bottom: 0; }
.row-name {
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.row-address {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  overflow-wrap: anywhere;
}
.muted {
  color: var(--el-text-color-secondary);
}
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}
.row-actions :deep(.el-button) {
  margin: 0;
}
.discovered {
  display: grid;
  gap: var(--spacing-md);
}
.discovered-card {
  padding: var(--page-section-padding);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--radius-md);
}
.discovered-card h4 {
  margin: 0 0 8px;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
</style>
