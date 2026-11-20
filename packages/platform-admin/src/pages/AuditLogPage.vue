<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
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

const loading = ref(false);
const logList = ref<AuditLog[]>([]);
const loadError = ref(false);
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

const pageNum = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filterForm = reactive({
  bussiness: "",
  operation: "",
});

const businessTypes = [
  { label: t("admin.knowledgeBase"), value: "BKNOWLEDGE" },
  { label: t("admin.glossary"), value: "BTERM" },
  { label: t("admin.exampleBase"), value: "BEXAMPLE" },
  { label: "Schema", value: "SCHEMA" },
  { label: t("admin.analysisMgmt"), value: "ANALYSIS" },
];

const operationTypes = [
  { label: t("common.add"), value: "ADD" },
  { label: t("common.modify"), value: "UPD" },
  { label: t("common.delete"), value: "DEL" },
];

async function loadLogs() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = false;
  try {
    const params: Record<string, any> = {
      pageNum: pageNum.value,
      pageSize: pageSize.value,
    };
    if (filterForm.bussiness) {
      params.bussiness = filterForm.bussiness;
    }
    if (filterForm.operation) {
      params.operation = filterForm.operation;
    }
    const res = await api.queryAuditLogs(params);
    logList.value = res.data || [];
    total.value = res.totalRows || 0;
  } catch {
    loadError.value = true;
    logList.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  if (loading.value) return;
  pageNum.value = 1;
  loadLogs();
}

function handlePageChange(page: number) {
  if (loading.value) return;
  pageNum.value = page;
  loadLogs();
}

onMounted(() => {
  loadLogs();
});
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
      <el-button :icon="RefreshCw" :disabled="loading" @click="loadLogs">{{ t("common.refresh") }}</el-button>
    </div>

    <div v-if="loadError" class="audit-load-error" role="alert">
      {{ t('audit.loadFailed') }}
      <el-button @click="loadLogs">{{ t('common.retry') }}</el-button>
    </div>
    <el-table
      v-else
      v-loading="loading"
      :data="logList"
      border
      stripe
      class="admin-table"
      style="width: 100%"
    >
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

    <div v-if="!loadError" class="pagination">
      <el-pagination
        background
        layout="total, prev, pager, next"
        :pager-count="5"
        :total="total"
        :page-size="pageSize"
        :current-page="pageNum"
        :disabled="loading"
        @current-change="handlePageChange"
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
