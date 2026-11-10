<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElButton, ElCheckbox, ElEmpty, ElInput, ElOption, ElSelect, vLoading } from "element-plus";
import {
  ChartColumn,
  ChevronRight,
  MousePointerClick,
  ListChecks,
  Search,
  SquareFunction,
} from "lucide-vue-next";
import type { SmartAsset, SubjectRecord } from "../api";
import type { AssetTab } from "../workspace";
import { useManagerClient, useOntologyText } from "../context";
import { useManagerFeedback } from "../feedback";
import { PlatformPageHeader } from "@ontomato/platform-shell";

const { ot } = useOntologyText();
const { loadSmartAssets, requestSmartAsset, loadSubjects } = useManagerClient();
const subjectNames = ref<Record<string, string>>({});
function subjectName(id?: string | null) {
  if (!id) return ot("unspecified");
  return subjectNames.value[id] ?? ot("unspecified");
}
const { message } = useManagerFeedback();

const props = defineProps<{ kind: AssetTab }>();
const emit = defineEmits<{
  select: [asset: SmartAsset];
  create: [];
}>();

const assets = ref<SmartAsset[]>([]);
const loading = ref(false);
const query = ref("");
const checked = ref<string[]>([]);
const saving = ref(false);
const targetStatus = ref("PUBLISHED");
const canBatchUpdate = computed(() => props.kind !== "functions");
const selectableAssets = computed(() => filteredAssets.value.filter((asset) => asset.id));
const visibleCheckedCount = computed(() =>
  selectableAssets.value.filter((asset) => checked.value.includes(asset.id!)).length
);
const allVisibleChecked = computed(() =>
  selectableAssets.value.length > 0 && visibleCheckedCount.value === selectableAssets.value.length
);

function toggleChecked(id: string, value: boolean) {
  checked.value = value ? [...new Set([...checked.value, id])] : checked.value.filter((item) => item !== id);
}

function toggleAllVisible(value: boolean) {
  const ids = selectableAssets.value.map((asset) => asset.id!);
  checked.value = value
    ? [...new Set([...checked.value, ...ids])]
    : checked.value.filter((id) => !ids.includes(id));
}

async function updateCheckedStatus(status = targetStatus.value) {
  if (saving.value || !canBatchUpdate.value || !checked.value.length) return;
  const kind = props.kind;
  const ids = [...checked.value];
  const failed: string[] = [];
  saving.value = true;
  try {
    for (const id of ids) {
      try {
        const response = await requestSmartAsset(kind, "queryById", { id });
        const record = response?.data ?? response;
        if (record?.id !== id) throw new Error(ot("assetLoadDetailFailed"));
        if (record.status !== status) await requestSmartAsset(kind, "save", { ...record, status });
      } catch {
        failed.push(id);
      }
    }
    if (props.kind !== kind) return;
    checked.value = failed;
    if (failed.length) {
      message.warning(ot("assetBatchStatusFailed", { failed: failed.length, total: ids.length }));
    } else {
      message.success(ot("assetBatchStatusSaved", { n: ids.length }));
    }
    await loadCatalog();
  } finally {
    saving.value = false;
  }
}

const meta: Record<
  AssetTab,
  {
    title: Parameters<typeof ot>[0];
    description: Parameters<typeof ot>[0];
    create: Parameters<typeof ot>[0];
    icon: typeof ChartColumn;
  }
> = {
  metrics: {
    title: "metricsTitle",
    description: "metricsDesc",
    create: "createMetric",
    icon: ChartColumn,
  },
  actions: {
    title: "actionsTitle",
    description: "actionsDesc",
    create: "generateFromNaturalLanguage",
    icon: MousePointerClick,
  },
  functions: {
    title: "functionsTitle",
    description: "functionsDesc",
    create: "createFunction",
    icon: SquareFunction,
  },
};

const currentMeta = computed(() => {
  const item = meta[props.kind];
  return {
    ...item,
    title: ot(item.title),
    description: ot(item.description),
    create: ot(item.create),
  };
});
function operationLabel(operation?: unknown) {
  return operation === "OPERATION_WRITE"
    ? ot("assetOperationWrite")
    : operation === "OPERATION_READ"
      ? ot("assetOperationRead")
      : "-";
}
const filteredAssets = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return assets.value;
  return assets.value.filter((asset) =>
    `${asset.name} ${asset.description || ""}`.toLowerCase().includes(keyword)
  );
});

function statusLabel(status?: string) {
  if (status === "PUBLISHED" || status === "RUNNING")
    return status === "RUNNING" ? ot("running") : ot("published");
  if (status === "PENDING_REVIEW") return ot("pendingReview");
  if (status === "STOPPED") return ot("stopped");
  if (status === "UNUSED") return ot("unused");
  return status || "-";
}

function statusClass(status?: string) {
  if (status === "PUBLISHED" || status === "RUNNING") return "success";
  if (status === "PENDING_REVIEW") return "warning";
  return "info";
}

function formatTime(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : "-";
}

async function loadCatalog() {
  loading.value = true;
  try {
    assets.value = await loadSmartAssets(props.kind);
  } catch {
    assets.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.kind,
  () => {
    checked.value = [];
    void loadCatalog();
  }
);
onMounted(async () => {
  void loadCatalog();
  try {
    // Names are a display concern: a missing directory must not hide the catalogue.
    const subjects = await loadSubjects();
    subjectNames.value = Object.fromEntries(
      subjects.map((subject: SubjectRecord) => [
        subject.id,
        subject.displayName || subject.loginCode || subject.id,
      ])
    );
  } catch {
    subjectNames.value = {};
  }
});
</script>

<template>
  <section v-loading="loading || saving" class="asset-catalog">
    <!-- The platform's one page header: the title, its line of description, and this page's own button. -->
    <PlatformPageHeader compact :title="currentMeta.title" :description="currentMeta.description">
      <template #actions>
        <el-button type="primary" @click="emit('create')">
          <component :is="currentMeta.icon" :size="16" />
          {{ currentMeta.create }}
        </el-button>
      </template>
    </PlatformPageHeader>

    <!-- The page under the header takes the page gutter, so the filter and the table start where the title does. -->
    <div class="catalog-body platform-page-gutter">
      <div class="catalog-toolbar">
        <el-input
          v-model="query"
          :prefix-icon="Search"
          :placeholder="ot('filterPrefix', { title: currentMeta.title })"
          clearable
        />
        <span class="resource-count">{{ filteredAssets.length }} {{ ot("items") }}</span>
      <template v-if="canBatchUpdate && checked.length">
        <span class="resource-count">{{ ot("assetChecked", { n: checked.length }) }}</span>
        <el-select v-model="targetStatus" class="batch-status" :aria-label="ot('status')">
          <el-option :label="ot('pendingReview')" value="PENDING_REVIEW" />
          <el-option :label="ot('published')" value="PUBLISHED" />
          <el-option :label="ot('unused')" value="UNUSED" />
        </el-select>
        <el-button :icon="ListChecks" :loading="saving" @click="updateCheckedStatus()">
          {{ ot("assetBatchStatus") }}
        </el-button>
        <el-button link @click="checked = []">{{ ot("assetClearChecked") }}</el-button>
      </template>
      </div>

      <div class="resource-table">
      <div class="resource-table-heading">
        <el-checkbox
          v-if="canBatchUpdate"
          class="resource-check"
          :model-value="allVisibleChecked"
          :indeterminate="visibleCheckedCount > 0 && !allVisibleChecked"
          :disabled="!selectableAssets.length"
          :aria-label="ot('assetCheckAll')"
          @update:model-value="toggleAllVisible(Boolean($event))"
        />
        <div :class="['resource-table-head', { 'function-grid': kind === 'functions' }]">
          <span>{{ currentMeta.title }}</span>
          <span v-if="kind === 'functions'">{{ ot("assetOperationType") }}</span>
          <span v-else>{{ ot("linkedFunction") }}</span>
          <span v-if="kind !== 'functions'">{{ ot("source") }}</span>
          <span v-if="kind !== 'functions'">{{ ot("status") }}</span>
          <span v-if="kind !== 'functions'">{{ ot("createdBy") }}</span>
          <span v-if="kind !== 'functions'">{{ ot("reviewedBy") }}</span>
          <span v-if="kind !== 'functions'">{{ ot("lastUpdated") }}</span>
          <span></span>
        </div>
      </div>
      <div
          v-for="asset in filteredAssets"
          :key="asset.id || asset.name"
        class="resource-table-entry"
      >
        <el-checkbox
          v-if="canBatchUpdate"
          class="resource-check"
          :model-value="Boolean(asset.id && checked.includes(asset.id))"
          :disabled="!asset.id"
          :aria-label="ot('assetCheckNamed', { name: asset.name })"
          @update:model-value="asset.id && toggleChecked(asset.id, Boolean($event))"
        />
      <button
        type="button"
          :class="['resource-table-row', { 'function-grid': kind === 'functions' }]"
          @click="emit('select', asset)"
        >
          <span class="resource-name">
            <span>
              <strong>{{ asset.name }}</strong>
              <small>{{ asset.description || ot("notFilledDescription") }}</small>
            </span>
          </span>
          <span v-if="kind === 'functions'">{{ operationLabel(asset.operation) }}</span>
          <span v-else>{{ asset.function?.name || "-" }}</span>
          <span v-if="kind !== 'functions'">
            {{
              asset.origin === "SYSTEM" ? ot("system") : asset.origin === "USER" ? ot("user") : "-"
            }}
          </span>
          <span v-if="kind !== 'functions'">
            <span :class="['status-pill', statusClass(asset.status)]">
              {{ statusLabel(asset.status) }}
            </span>
          </span>
          <span v-if="kind !== 'functions'">{{ subjectName(asset.createdBy) }}</span>
          <span v-if="kind !== 'functions'">{{ subjectName(asset.reviewedBy) }}</span>
          <span v-if="kind !== 'functions'">{{ formatTime(asset.modifyTimestamp) }}</span>
          <ChevronRight :size="16" class="row-chevron" />
        </button>
      </div>
        <el-empty
          v-if="!loading && filteredAssets.length === 0"
          :description="ot('notFoundNamed', { title: currentMeta.title })"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * The page paints no background of its own: it sits on the application's area, the darkest band in dark mode
 * (DESIGN.md "Colour roles"); the table keeps its own surface.
 */
.asset-catalog {
  min-height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.catalog-titlebar :deep(.el-button) {
  display: inline-flex;
  align-items: center;
}
.catalog-toolbar {
  display: flex;
  flex-wrap: wrap;
  min-height: 40px;
  align-items: center;
  gap: var(--spacing-sm);
  margin-top: var(--manager-content-gap);
}
.catalog-toolbar :deep(.el-input) {
  width: 260px;
  max-width: 100%;
}
.resource-count {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.batch-status {
  width: 150px;
}
.resource-table-heading,
.resource-table-entry {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color-light);
}
.resource-table-heading {
  background: var(--el-fill-color-light);
}
.resource-table-entry:last-child {
  border-bottom: 0;
}
.resource-table-entry {
  transition: background-color var(--transition-fast);
}
.resource-table-entry:hover,
.resource-table-entry:focus-within {
  background: var(--el-fill-color-light);
}
.resource-check {
  flex: 0 0 32px;
  justify-content: flex-end;
  margin-right: 0;
}
.resource-table {
  overflow: auto;
  margin: var(--manager-content-gap) 0 var(--manager-module-gap);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.resource-table-head,
.resource-table-row {
  display: grid;
  box-sizing: border-box;
  grid-template-columns: minmax(220px, 1.7fr) minmax(140px, 1fr) 88px 100px 110px 110px 170px 20px;
  width: 100%;
  min-width: 0;
  align-items: center;
  column-gap: var(--spacing-md);
  text-align: left;
}
.resource-table-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-table-row > .resource-name { white-space: normal; }
.resource-table-head.function-grid,
.resource-table-row.function-grid {
  grid-template-columns: minmax(250px, 1.7fr) minmax(140px, 1fr) 20px;
}
.resource-table-head {
  min-height: var(--table-head-height);
  padding: 0 var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.02em;
}
.resource-table-row {
  min-height: var(--list-row-height);
  padding: 8px var(--spacing-md);
  border: 0;
  color: var(--el-text-color-regular);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-sm);
  transition: background-color var(--transition-fast);
}
.resource-table-head > span,
.resource-table-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-table-row:last-child {
  border-bottom: 0;
}
.resource-name {
  display: flex;
  min-width: 0;
  align-items: center;
}
.resource-name > span:last-child {
  min-width: 0;
}
.resource-name strong,
.resource-name small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-name strong {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
}
.resource-name small {
  margin-top: 2px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.status-pill {
  display: inline-flex;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 16px;
}
.status-pill.success {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}
.status-pill.warning {
  color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
.status-pill.info {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}
.row-chevron {
  color: var(--el-text-color-tertiary);
}
@container ontology-manager (max-width: 900px) {
  .resource-table-head,
  .resource-table-row {
    grid-template-columns: minmax(0, 1fr) 90px 20px;
  }
  .resource-table-head.function-grid,
  .resource-table-row.function-grid {
    grid-template-columns: minmax(0, 1fr) minmax(80px, 0.8fr) 20px;
  }
  .resource-table-head span:nth-child(2),
  .resource-table-head span:nth-child(3),
  .resource-table-head span:nth-child(5),
  .resource-table-head span:nth-child(6),
  .resource-table-head span:nth-child(7),
  .resource-table-row > span:nth-child(2),
  .resource-table-row > span:nth-child(3),
  .resource-table-row > span:nth-child(5),
  .resource-table-row > span:nth-child(6),
  .resource-table-row > span:nth-child(7) {
    display: none;
  }
  .resource-table-head.function-grid span:nth-child(2),
  .resource-table-row.function-grid > span:nth-child(2) {
    display: block;
  }
}
@container ontology-manager (max-width: 560px) {
  .catalog-titlebar :deep(.el-button),
  .catalog-toolbar :deep(.el-input) {
    width: 100%;
  }
  .catalog-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
