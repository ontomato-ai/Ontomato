<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElButton, ElCheckbox, ElEmpty, ElInput, ElOption, ElSelect, vLoading } from "element-plus";
import {
  ChartColumn,
  ChevronRight,
  Clock3,
  ListChecks,
  MousePointerClick,
  Plus,
  Play,
  Sparkles,
  Search,
  SquareFunction,
  Square,
} from "lucide-vue-next";
import type { SmartAsset } from "../api";
import type { AssetTab } from "../workspace";
import { useManagerClient, useOntologyText } from "../context";
import { useManagerFeedback } from "../feedback";

const { ot } = useOntologyText();
const { loadSmartAssets, requestSmartAsset } = useManagerClient();
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
  tasks: {
    title: "tasksTitle",
    description: "tasksDesc",
    create: "createTask",
    icon: Clock3,
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
onMounted(() => void loadCatalog());
</script>

<template>
  <section v-loading="loading || saving" class="asset-catalog">
    <header class="catalog-titlebar">
      <div>
        <h1>{{ currentMeta.title }}</h1>
        <p>{{ currentMeta.description }}</p>
      </div>
      <el-button type="primary" :icon="kind === 'actions' ? Sparkles : Plus" @click="emit('create')">
        {{ currentMeta.create }}
      </el-button>
    </header>

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
        <template v-if="kind === 'tasks'">
          <el-button :icon="Play" :disabled="saving" @click="updateCheckedStatus('RUNNING')">
            {{ ot("taskBatchStart") }}
          </el-button>
          <el-button :icon="Square" :disabled="saving" @click="updateCheckedStatus('STOPPED')">
            {{ ot("taskBatchStop") }}
          </el-button>
        </template>
        <template v-else>
        <el-select v-model="targetStatus" class="batch-status" :aria-label="ot('status')">
          <el-option :label="ot('pendingReview')" value="PENDING_REVIEW" />
          <el-option :label="ot('published')" value="PUBLISHED" />
          <el-option :label="ot('unused')" value="UNUSED" />
        </el-select>
        <el-button :icon="ListChecks" :loading="saving" @click="updateCheckedStatus()">
          {{ ot("assetBatchStatus") }}
        </el-button>
        </template>
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
        <span v-if="kind !== 'functions'">{{ formatTime(asset.modifyTimestamp) }}</span>
        <ChevronRight :size="16" class="row-chevron" />
      </button>
      </div>
      <el-empty
        v-if="!loading && filteredAssets.length === 0"
        :description="ot('notFoundNamed', { title: currentMeta.title })"
      />
    </div>
  </section>
</template>

<style scoped>
.asset-catalog {
  min-height: 100%;
  flex-shrink: 0;
  padding: var(--spacing-xl) var(--spacing-2xl);
  background: var(--el-bg-color);
}
.catalog-titlebar {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-lg);
}
.catalog-titlebar :deep(.el-button) {
  display: inline-flex;
  align-items: center;
}
h1 {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
}
p {
  margin: 5px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.catalog-toolbar {
  display: flex;
  flex-wrap: wrap;
  min-height: 54px;
  align-items: center;
  gap: var(--spacing-md);
  margin-top: var(--spacing-lg);
  padding: 9px var(--spacing-md);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.catalog-toolbar :deep(.el-input) {
  width: 260px;
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
.resource-check {
  flex: 0 0 32px;
  justify-content: flex-end;
  margin-right: 0;
}
.resource-table {
  overflow: hidden;
  margin-top: var(--spacing-lg);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm);
  background: var(--el-bg-color);
}
.resource-table-head,
.resource-table-row {
  display: grid;
  grid-template-columns: minmax(250px, 1.7fr) minmax(150px, 1fr) 88px 100px 170px 20px;
  width: 100%;
  min-width: 0;
  align-items: center;
  column-gap: var(--spacing-md);
  text-align: left;
}
.resource-table-head.function-grid,
.resource-table-row.function-grid {
  grid-template-columns: minmax(250px, 1.7fr) minmax(140px, 1fr) 20px;
}
.resource-table-head {
  min-height: 40px;
  padding: 0 var(--spacing-md);
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.resource-table-row {
  min-height: 62px;
  padding: 8px var(--spacing-md);
  border: 0;
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: background-color var(--transition-fast);
}
.resource-table-row:last-child {
  border-bottom: 0;
}
.resource-table-row:hover {
  background: var(--el-fill-color-light);
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
  .asset-catalog {
    padding: var(--spacing-md);
  }
  h1 {
    font-size: var(--text-xl);
  }
  .resource-table-head,
  .resource-table-row {
    grid-template-columns: minmax(180px, 1fr) 100px 20px;
  }
  .resource-table-head.function-grid,
  .resource-table-row.function-grid {
    grid-template-columns: minmax(150px, 1fr) minmax(115px, 0.8fr) 20px;
  }
  .resource-table-head span:nth-child(2),
  .resource-table-head span:nth-child(3),
  .resource-table-head span:nth-child(5),
  .resource-table-row > span:nth-child(2),
  .resource-table-row > span:nth-child(3),
  .resource-table-row > span:nth-child(5) {
    display: none;
  }
  .resource-table-head.function-grid span:nth-child(2),
  .resource-table-row.function-grid > span:nth-child(2) {
    display: block;
  }
  .resource-table-head.function-grid span:nth-child(3),
  .resource-table-head.function-grid span:nth-child(4),
  .resource-table-head.function-grid span:nth-child(5),
  .resource-table-row.function-grid > span:nth-child(3),
  .resource-table-row.function-grid > span:nth-child(4),
  .resource-table-row.function-grid > span:nth-child(5) {
    display: none;
  }
}
@container ontology-manager (max-width: 560px) {
  .catalog-titlebar {
    align-items: flex-start;
    flex-direction: column;
  }
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
