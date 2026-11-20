<script setup lang="ts">
import { computed, ref, reactive, onMounted } from "vue";
import { FileText, RefreshCw, Search } from "lucide-vue-next";
import { usePlatformHost } from "../context";
import { useI18n } from "vue-i18n";

const { t } = useI18n();
const { api } = usePlatformHost();

interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  operation: string;
  bussiness: string;
  description: string;
  /** Epoch milliseconds, as the data engine's AuditLog.operateTime. */
  operateTime: number;
}

interface AuditQuery {
  pageNum: number;
  pageSize: number;
  bussiness?: string;
  operation?: string;
}

const initialQuery: AuditQuery = { pageNum: 1, pageSize: 20 };
const loading = ref(true);
const logList = ref<AuditLog[]>([]);
const displayedQuery = ref<AuditQuery>();
const failedQuery = ref<AuditQuery>();
const requestedQuery = ref(initialQuery);
const detailOpen = ref(false);
const selectedLog = ref<AuditLog>();
let detailTrigger: HTMLElement | undefined;

function openDetail(row: AuditLog, event: MouseEvent) {
  detailTrigger = event.currentTarget as HTMLElement;
  selectedLog.value = row;
  detailOpen.value = true;
}

function restoreDetailFocus() {
  detailTrigger?.focus();
  detailTrigger = undefined;
}

const total = ref(0);

const filterForm = reactive({
  bussiness: "",
  operation: "",
});

const businessTypes = computed(() => [
  { label: t("admin.knowledgeBase"), value: "BKNOWLEDGE" },
  { label: t("admin.glossary"), value: "BTERM" },
  { label: t("admin.exampleBase"), value: "BEXAMPLE" },
  { label: "Schema", value: "SCHEMA" },
  { label: t("admin.analysisMgmt"), value: "ANALYSIS" },
]);

const operationTypes = computed(() => [
  { label: t("common.add"), value: "ADD" },
  { label: t("common.modify"), value: "UPD" },
  { label: t("common.delete"), value: "DEL" },
]);

function scopeLabel(query: AuditQuery) {
  return t("audit.resultScope", {
    page: query.pageNum,
    business: businessTypes.value.find(type => type.value === query.bussiness)?.label ?? t("audit.all"),
    operation: operationTypes.value.find(type => type.value === query.operation)?.label ?? t("audit.all"),
  });
}

const changingScope = computed(() => !!displayedQuery.value &&
  (displayedQuery.value.pageNum !== requestedQuery.value.pageNum ||
    displayedQuery.value.bussiness !== requestedQuery.value.bussiness ||
    displayedQuery.value.operation !== requestedQuery.value.operation));

async function loadLogs(query: AuditQuery) {
  requestedQuery.value = query;
  loading.value = true;
  failedQuery.value = undefined;
  try {
    const res = await api.queryAuditLogs(query);
    if (!Array.isArray(res.data) || !Number.isFinite(res.totalRows) || res.success === false) throw new Error("Invalid audit log page");
    const lastPage = Math.max(1, Math.ceil(res.totalRows / query.pageSize));
    if (query.pageNum > lastPage) {
      await loadLogs({ ...query, pageNum: lastPage });
      return;
    }
    logList.value = res.data;
    total.value = res.totalRows;
    displayedQuery.value = query;
  } catch {
    failedQuery.value = query;
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  if (loading.value) return;
  void loadLogs({ ...initialQuery, bussiness: filterForm.bussiness || undefined, operation: filterForm.operation || undefined });
}

function handlePageChange(page: number) {
  if (loading.value || !displayedQuery.value || displayedQuery.value.pageNum === page) return;
  void loadLogs({ ...displayedQuery.value, pageNum: page });
}

function refreshLogs() {
  if (!loading.value) void loadLogs(failedQuery.value ?? displayedQuery.value ?? initialQuery);
}

onMounted(() => void loadLogs(initialQuery));
</script>

<template>
  <div class="audit-log-manager">
    <div class="toolbar">
      <label class="audit-filter">
        <span>{{ t("admin.bizType") }}</span>
        <el-select
        v-model="filterForm.bussiness"
        :placeholder="t('admin.bizType')"
        clearable
        :aria-label="t('admin.bizType')"
      >
        <el-option
          v-for="item in businessTypes"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      </label>
      <label class="audit-filter">
        <span>{{ t("admin.operationType") }}</span>
        <el-select
        v-model="filterForm.operation"
        :placeholder="t('admin.operationType')"
        clearable
        :aria-label="t('admin.operationType')"
      >
        <el-option
          v-for="op in operationTypes"
          :key="op.value"
          :label="op.label"
          :value="op.value"
        />
      </el-select>
      </label>
      <el-button type="primary" :icon="Search" :loading="loading" @click="handleSearch">
        {{ t("common.query") }}
      </el-button>
      <el-button :icon="RefreshCw" :disabled="loading" @click="refreshLogs">{{ t("common.refresh") }}</el-button>
    </div>

    <div v-if="displayedQuery" class="audit-result-scope" role="status">{{ scopeLabel(displayedQuery) }}</div>
    <div v-if="failedQuery" class="audit-load-error" role="alert">
      <span>{{ t('audit.loadFailed') }}. {{ scopeLabel(failedQuery) }}{{ displayedQuery ? ` · ${t('audit.previousResults')}` : '' }}</span>
      <el-button text :icon="RefreshCw" @click="refreshLogs">{{ t('common.retry') }}</el-button>
    </div>
    <el-table
      v-if="displayedQuery || loading"
      v-loading="loading && (!displayedQuery || changingScope)"
      :aria-busy="loading"
      :data="logList"
      border
      stripe
      class="admin-table"
      style="width: 100%"
    >
      <template #empty><span v-if="!loading && displayedQuery">{{ t('audit.empty') }}</span></template>
      <el-table-column :label="t('common.time')" width="180">
        <template #default="{ row }">
          {{ new Date(row.operateTime).toLocaleString() }}
        </template>
      </el-table-column>
      <el-table-column prop="userName" :label="t('common.user')" width="120" />
      <el-table-column prop="bussiness" :label="t('admin.bizType')" width="120">
        <template #default="{ row }">
          <el-tag v-if="row.bussiness === 'BKNOWLEDGE'">{{ t("admin.knowledgeBase") }}</el-tag>
          <el-tag v-else-if="row.bussiness === 'BTERM'">{{ t("admin.glossary") }}</el-tag>
          <el-tag v-else-if="row.bussiness === 'BEXAMPLE'">{{ t("admin.exampleBase") }}</el-tag>
          <el-tag v-else-if="row.bussiness === 'SCHEMA'">Schema</el-tag>
          <el-tag v-else-if="row.bussiness === 'ANALYSIS'">{{ t("admin.analysisMgmt") }}</el-tag>
          <el-tag v-else>{{ row.bussiness }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="operation" :label="t('admin.operationType')" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.operation === 'ADD'" type="primary">{{ t("common.add") }}</el-tag>
          <el-tag v-else-if="row.operation === 'UPD'" type="warning">
            {{ t("common.modify") }}
          </el-tag>
          <el-tag v-else-if="row.operation === 'DEL'" type="danger">
            {{ t("common.delete") }}
          </el-tag>
          <el-tag v-else>{{ row.operation }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" :label="t('common.detail')" min-width="240">
        <template #default="{ row }">
          <div v-if="row.description" class="audit-detail-cell">
            <span class="audit-detail-preview" aria-hidden="true">{{ row.description }}</span>
            <el-button link type="primary" :icon="FileText" aria-haspopup="dialog" @click="openDetail(row, $event)">
              {{ t('common.detail') }}
            </el-button>
          </div>
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="displayedQuery" class="pagination">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :pager-count="5"
        :total="total"
        :page-size="displayedQuery.pageSize"
        :current-page="displayedQuery.pageNum"
        :disabled="loading"
        @update:current-page="handlePageChange"
      />
    </div>
    <el-dialog
      v-model="detailOpen"
      :title="t('common.detail')"
      width="min(640px, calc(100% - 2rem))"
      destroy-on-close
      @close-auto-focus="restoreDetailFocus"
    >
      <pre v-if="selectedLog" class="audit-detail-text" tabindex="0" role="region" :aria-label="t('common.detail')">{{ selectedLog.description }}</pre>
      <template #footer>
        <el-button @click="detailOpen = false">{{ t('common.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.audit-log-manager {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  margin-bottom: var(--spacing-lg);
  flex-wrap: wrap;
  align-items: flex-end;
}

.audit-filter {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  width: 200px;
  max-width: 100%;
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
}
.audit-filter .el-select { width: 100%; }

.audit-detail-cell { display: flex; align-items: center; gap: var(--spacing-sm); }
.audit-detail-cell .el-button { flex: none; min-height: 24px; }
.audit-detail-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audit-detail-text {
  margin: 0;
  max-block-size: 55dvh;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font: inherit;
  line-height: var(--leading-relaxed);
}
.audit-result-scope, .audit-load-error { margin-block-end: var(--spacing-sm); overflow-wrap: anywhere; }
.audit-result-scope { color: var(--el-text-color-secondary); font-size: var(--text-sm); }
.audit-load-error { color: var(--el-color-danger-text); display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-sm); }

.pagination {
  margin-top: var(--spacing-lg);
  display: flex;
  justify-content: flex-end;
  overflow-x: auto;
}

@media (max-width: 1024px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar .el-input,
  .toolbar .el-select {
    width: 100%;
  }
}

@media (max-width: 768px) {
  .operation-cell .el-button + .el-button {
    margin-left: 0;
  }
}
</style>
