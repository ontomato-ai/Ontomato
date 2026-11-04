<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { ElMessage } from "element-plus";
import { Download, RefreshCw, Search } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import type { FeedbackRating, FeedbackRecord, FeedbackSourceType } from "@ontomato/contracts/feedback";
import { usePlatformHost } from "../context";

/*
 * The feedback the domain's users gave on their conversations: ratings and comments on query and analysis results, with
 * the question and the answer they refer to. The records are the workbench's (`GET /api/feedback` through the same
 * gateway); this page reads and exports them and writes nothing.
 */
const { t } = useI18n();
const { api, separators } = usePlatformHost();

const loading = ref(false);
const exporting = ref(false);
const loadError = ref("");
const records = shallowRef<FeedbackRecord[]>([]);
const total = ref(0);
const pageNum = ref(1);
const pageSize = ref(20);
const detailVisible = ref(false);
const current = shallowRef<FeedbackRecord | null>(null);

const filters = reactive<{ sourceType: FeedbackSourceType | ""; rating: FeedbackRating | ""; keyword: string }>({
  sourceType: "",
  rating: "",
  keyword: "",
});

const sourceOptions = computed(() => [
  { label: t("admin.feedbackSources.qa"), value: "qa" },
  { label: t("admin.feedbackSources.analysis_task"), value: "analysis_task" },
]);
const ratingOptions = computed(() => [
  { label: t("admin.feedbackRatings.like"), value: "like" },
  { label: t("admin.feedbackRatings.dislike"), value: "dislike" },
]);

function sourceLabel(value: FeedbackSourceType) {
  return t(`admin.feedbackSources.${value}`);
}

function ratingLabel(value: FeedbackRating) {
  return t(`admin.feedbackRatings.${value}`);
}

/** The turn the feedback belongs to: the record's own key, or one built from the conversation and its turn number. */
function turnKey(record: FeedbackRecord) {
  const metadata = record.metadata as { turnKey?: unknown } | null | undefined;
  const fromMetadata = typeof metadata?.turnKey === "string" ? metadata.turnKey.trim() : "";
  if (fromMetadata) return fromMetadata;
  if (record.targetId?.startsWith("turn.")) return record.targetId;
  if (record.threadId && Number.isInteger(record.requestSeq)) return `turn.${record.threadId}.${record.requestSeq}`;
  return "";
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString();
}

function preview(text?: string) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  return value.length > 80 ? `${value.slice(0, 80)}…` : value;
}

const detailRows = computed(() => {
  const record = current.value;
  if (!record) return [];
  return [
    { label: t("admin.feedbackColumns.user"), value: record.userName || record.userId },
    { label: t("admin.feedbackColumns.source"), value: sourceLabel(record.sourceType) },
    { label: t("admin.feedbackColumns.rating"), value: ratingLabel(record.rating) },
    { label: t("admin.feedbackColumns.turnKey"), value: turnKey(record) || "-" },
    { label: t("admin.feedbackColumns.input"), value: record.userInput || "-" },
    { label: t("admin.feedbackColumns.output"), value: record.assistantOutput || "-" },
    { label: t("admin.feedbackColumns.feedback"), value: record.feedbackText || "-" },
    { label: t("admin.feedbackColumns.relatedId"), value: record.taskId || record.threadId || record.targetId },
  ];
});

function query(offset: number, limit: number) {
  return {
    sourceType: filters.sourceType,
    rating: filters.rating,
    keyword: filters.keyword,
    limit,
    offset,
  };
}

async function loadRecords() {
  loading.value = true;
  loadError.value = "";
  try {
    const data = await api.listFeedback(query((pageNum.value - 1) * pageSize.value, pageSize.value));
    records.value = data.records;
    total.value = data.total;
  } catch (e) {
    loadError.value = e instanceof Error && e.message ? e.message : t("admin.feedbackLoadFailed");
    records.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function search() {
  pageNum.value = 1;
  void loadRecords();
}

function changePage(value: number) {
  pageNum.value = value;
  void loadRecords();
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(rows: FeedbackRecord[]) {
  const headers = [
    t("admin.feedbackColumns.time"),
    t("admin.feedbackColumns.source"),
    t("admin.feedbackColumns.rating"),
    t("admin.feedbackColumns.user"),
    t("admin.feedbackColumns.turnKey"),
    t("admin.feedbackColumns.input"),
    t("admin.feedbackColumns.output"),
    t("admin.feedbackColumns.feedback"),
  ];
  const lines = rows.map((row) =>
    [
      formatTime(row.createdAt),
      sourceLabel(row.sourceType),
      ratingLabel(row.rating),
      row.userName || row.userId,
      turnKey(row),
      row.userInput ?? "",
      row.assistantOutput ?? "",
      row.feedbackText ?? "",
    ]
      .map(csvCell)
      .join(",")
  );
  const csv = [headers.map(csvCell).join(","), ...lines].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `feedback_records_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Every record of the current filter, read page by page so a large domain exports in one file. */
async function exportRecords() {
  exporting.value = true;
  try {
    const limit = 500;
    const rows: FeedbackRecord[] = [];
    let offset = 0;
    let readTotal = Infinity;
    while (offset < readTotal) {
      const data = await api.listFeedback(query(offset, limit));
      rows.push(...data.records);
      readTotal = data.total;
      if (data.records.length === 0) break;
      offset += data.records.length;
    }
    if (rows.length === 0) {
      ElMessage.warning(t("admin.feedbackExportEmpty"));
      return;
    }
    downloadCsv(rows);
    ElMessage.success(t("admin.feedbackExportSucceeded"));
  } catch (e) {
    ElMessage.error(e instanceof Error && e.message ? e.message : t("admin.feedbackExportFailed"));
  } finally {
    exporting.value = false;
  }
}

function showDetail(record: FeedbackRecord) {
  current.value = record;
  detailVisible.value = true;
}

onMounted(loadRecords);
</script>

<template>
  <div class="feedback-records platform-page">
    <div class="page-body">
      <div class="toolbar">
        <el-select v-model="filters.sourceType" clearable :placeholder="t('admin.feedbackColumns.source')" class="filter-source">
          <el-option v-for="item in sourceOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="filters.rating" clearable :placeholder="t('admin.feedbackColumns.rating')" class="filter-rating">
          <el-option v-for="item in ratingOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-input
          v-model="filters.keyword"
          clearable
          :placeholder="t('admin.feedbackSearchPlaceholder')"
          class="filter-keyword"
          @keyup.enter="search"
        />
        <el-button type="primary" :icon="Search" @click="search">{{ t("common.query") }}</el-button>
        <div class="toolbar-actions">
          <el-button :icon="RefreshCw" :loading="loading" @click="loadRecords">{{ t("common.refresh") }}</el-button>
          <el-button :icon="Download" :loading="exporting" @click="exportRecords">{{ t("admin.feedbackExport") }}</el-button>
        </div>
      </div>

      <p v-if="loadError" class="load-error" role="alert">{{ t("admin.feedbackLoadFailed") }}{{ separators.detail }}{{ loadError }}</p>

      <el-table v-loading="loading" :data="records" class="admin-table" style="width: 100%">
        <el-table-column :label="t('admin.feedbackColumns.time')" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.source')" width="120">
          <template #default="{ row }">{{ sourceLabel(row.sourceType) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.rating')" width="100">
          <template #default="{ row }">
            <el-tag :type="row.rating === 'like' ? 'success' : 'danger'" disable-transitions>
              {{ ratingLabel(row.rating) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.user')" width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.userName || row.userId }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.turnKey')" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ turnKey(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.input')" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ preview(row.userInput) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.output')" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ preview(row.assistantOutput) }}</template>
        </el-table-column>
        <el-table-column :label="t('admin.feedbackColumns.feedback')" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ preview(row.feedbackText) }}</template>
        </el-table-column>
        <el-table-column :label="t('common.detail')" width="90" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">{{ t("common.detail") }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="admin-pagination">
        <el-pagination
          background
          layout="prev, pager, next, jumper, ->, total"
          :total="total"
          :page-size="pageSize"
          :current-page="pageNum"
          @current-change="changePage"
        />
      </div>
    </div>

    <el-dialog v-model="detailVisible" :title="t('admin.feedbackDetailTitle')" width="min(760px, calc(100vw - 32px))" append-to-body>
      <dl class="feedback-detail">
        <template v-for="item in detailRows" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </template>
      </dl>
    </el-dialog>
  </div>
</template>

<style scoped>
.feedback-records {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: var(--el-bg-color);
}

.page-body {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: var(--spacing-lg);
}

.filter-source {
  width: 140px;
}

.filter-rating {
  width: 120px;
}

.filter-keyword {
  width: 280px;
}

.load-error {
  margin: 0 0 var(--spacing-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}

.feedback-detail {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--spacing-sm) var(--spacing-md);
  margin: 0;
}

.feedback-detail dt {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}

.feedback-detail dd {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
}
</style>
