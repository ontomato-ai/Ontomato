<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { usePageActions, useUnsavedChanges } from "@ontomato/platform-shell";
import { useI18n } from "vue-i18n";
import { dataAdapterTestResultSchema, multiDataSourceRejectionSchema, multiDataSourceType } from "@ontomato/contracts/data-adapters";
import type { DataAdapterInfo, DataAdapterRequest, DataAdaptersData } from "@ontomato/contracts/data-adapters";
import DataAdapterConfigCard from "../config/components/DataAdapterConfigCard.vue";
import { PlatformBusinessError } from "../api";
import { usePlatformHost } from "../context";
import { platformPages } from "../pages";
import {
  dataAdapterRequest,
  multiDataSourceDefinition,
  multiDataSourceDraft,
  type BusinessConfig,
  type DataAdapterTestOutcome,
  type MultiDataSourceDraft,
  type MultiDataSourceSaveFailure,
  type OntologyOutline,
  type SystemSettings,
} from "../config/types";

/*
 * The data adapter of this domain: one connection, or several sources routed by class. Testing reads a candidate
 * connection without saving it or switching the domain's adapter; saving switches the domain to what the form holds.
 * The form is the page's one draft, saved from the page header; the connection test stays in the form.
 */
const { t } = useI18n();
const { api, separators, systemConfig: businessConfig } = usePlatformHost();

const loading = ref(false);
const loadError = ref("");
const config = reactive<SystemSettings>({
  knowledgeMaxResult: 10,
  dslCookerTimeout: 300000,
  lang: businessConfig.defaultLanguage,
  dataAdapter: "",
  dataAdapterConnections: {},
});
// Data adapters installed in this edition's backend, loaded together with the business config.
const dataAdapters = ref<DataAdapterInfo[]>([]);

async function loadConfig() {
  loading.value = true;
  loadError.value = "";
  try {
    const [res, adaptersRes] = await Promise.all([api.getBusinessConfig(), api.listDataAdapters()]);
    if (res?.success) {
      dataAdapters.value = (adaptersRes.data as DataAdaptersData).adapters;
      const data = res.data as BusinessConfig;
      config.dataAdapter = data.dataAdapter;
      config.dataAdapterConnections = data.dataAdapterConnections;
      multiDraft.value = multiDataSourceDraft(data.multiDataSource);
      dataAdapterMode.value = config.dataAdapter;
      baseline.value = submitted();
    } else {
      loadError.value = res?.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    loadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loading.value = false;
  }
}

const dataAdapterMode = ref("");
const savingAdapter = ref(false);
const testingAdapter = ref(false);
const adapterTest = ref<DataAdapterTestOutcome | null>(null);
// Bumped whenever the type or a connection field changes, so a test answering after such a change is dropped.
let adapterFormRevision = 0;

// A previous outcome describes the values it was run with, not the edited form.
watch(
  [dataAdapterMode, () => config.dataAdapterConnections],
  () => {
    adapterFormRevision++;
    adapterTest.value = null;
  },
  { deep: true }
);

function selectedDataAdapter(): DataAdapterInfo {
  return dataAdapters.value.find(({ type }) => type === dataAdapterMode.value)!;
}

// The card form builds the connection object of the selected type.
function singleSourceRequest(adapter: DataAdapterInfo) {
  return dataAdapterRequest(adapter, config.dataAdapterConnections[adapter.type]);
}

async function saveDataAdapter() {
  if (dataAdapterMode.value === multiDataSourceType) return saveMultiDataSource();
  savingAdapter.value = true;
  try {
    const adapter = selectedDataAdapter();
    await api.useDataAdapter(singleSourceRequest(adapter));
    ElMessage.success(t("admin.switchedDataAdapter", { name: adapter.label }));
    config.dataAdapter = dataAdapterMode.value;
    baseline.value = submitted();
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingAdapter.value = false;
  }
}

// Tests a candidate connection without saving it or switching this domain's adapter.
async function testConnection(request: DataAdapterRequest): Promise<DataAdapterTestOutcome> {
  try {
    const res = await api.testDataAdapter(request);
    const report = dataAdapterTestResultSchema.safeParse(res.data);
    return report.success ? { ok: true, result: report.data } : { ok: false, message: t("admin.dataAdapterInvalidReport") };
  } catch (e: any) {
    return { ok: false, message: e.message };
  }
}

async function testDataAdapter() {
  testingAdapter.value = true;
  adapterTest.value = null;
  const revision = adapterFormRevision;
  const outcome = await testConnection(singleSourceRequest(selectedDataAdapter()));
  testingAdapter.value = false;
  if (revision === adapterFormRevision) adapterTest.value = outcome;
}

// Multi-source draft: kept apart from the single-source connections, so neither mode's save or edits touch the other.
const multiDraft = ref<MultiDataSourceDraft>(multiDataSourceDraft(null));
const multiSaveFailure = ref<MultiDataSourceSaveFailure | null>(null);
// The ontology is read for the multi-source editor only, the first time that mode is shown.
const ontology = ref<OntologyOutline | null>(null);
const loadingOntology = ref(false);
const ontologyLoadError = ref("");

async function loadOntology() {
  loadingOntology.value = true;
  ontologyLoadError.value = "";
  try {
    ontology.value = await api.getOntologyOutline();
  } catch (e: any) {
    ontologyLoadError.value = e.message;
  } finally {
    loadingOntology.value = false;
  }
}

watch(dataAdapterMode, (mode) => {
  if (mode === multiDataSourceType && ontology.value === null && !loadingOntology.value) loadOntology();
});

// The data engine checks the whole definition against the ontology; a rejection lists every located problem.
async function saveMultiDataSource() {
  savingAdapter.value = true;
  multiSaveFailure.value = null;
  try {
    await api.useMultiDataSource(multiDataSourceDefinition(multiDraft.value, ontology.value!));
    ElMessage.success(t("admin.switchedDataAdapter", { name: selectedDataAdapter().label }));
    config.dataAdapter = multiDataSourceType;
    baseline.value = submitted();
  } catch (e) {
    const rejection = e instanceof PlatformBusinessError ? multiDataSourceRejectionSchema.safeParse(e.body) : null;
    multiSaveFailure.value = {
      message: e instanceof Error ? e.message : String(e),
      problems: rejection?.success ? rejection.data.data.problems : [],
    };
  } finally {
    savingAdapter.value = false;
  }
}

/**
 * What a save would submit, for the unsaved marker: the chosen adapter with its connection, or the multi-source
 * draft. Edits to the fields of an adapter that is not chosen are not saved, so they are no change either.
 */
function submitted(): string {
  const mode = dataAdapterMode.value;
  if (mode === multiDataSourceType) return JSON.stringify({ mode, draft: multiDraft.value });
  const adapter = dataAdapters.value.find(({ type }) => type === mode);
  return JSON.stringify({ mode, request: adapter ? dataAdapterRequest(adapter, config.dataAdapterConnections[mode] ?? {}) : null });
}
const baseline = ref<string | null>(null);
const dirty = computed(() => baseline.value !== null && submitted() !== baseline.value);

async function discard() {
  const confirmed = await ElMessageBox.confirm(t("admin.discardChangesConfirm"), t("admin.discardChanges"), {
    type: "warning",
    confirmButtonText: t("admin.discardChanges"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
  if (confirmed) await loadConfig();
}

usePageActions(() => ({
  draft:
    baseline.value === null
      ? null
      : {
          dirty: dirty.value,
          // The multi-source definition is saved with the routes of the current ontology, so it waits for the ontology.
          saving: savingAdapter.value || (dataAdapterMode.value === multiDataSourceType && !ontology.value),
          save: () => void saveDataAdapter(),
          discard: () => void discard(),
        },
}));
useUnsavedChanges({ dirty: () => dirty.value, paths: () => [platformPages.dataAdapters.path] });

onMounted(loadConfig);
</script>

<template>
  <div class="settings-page">
    <div v-if="loadError" class="config-load-error" role="alert">
      <span>{{ t("admin.loadConfigFailed") }}{{ separators.detail }}{{ loadError }}</span>
      <el-button size="small" @click="loadConfig">{{ t("common.retry") }}</el-button>
    </div>

    <DataAdapterConfigCard
      v-model:config="config"
      v-model:mode="dataAdapterMode"
      v-model:multi-draft="multiDraft"
      :adapters="dataAdapters"
      :adapter-display="businessConfig.adapterDisplay"
      :testing="testingAdapter"
      :test="adapterTest"
      :disabled="loading || !!loadError"
      :ontology="ontology"
      :ontology-load-error="ontologyLoadError"
      :test-connection="testConnection"
      :multi-save-failure="multiSaveFailure"
      @test="testDataAdapter"
      @retry-ontology="loadOntology"
    />
  </div>
</template>

<style scoped src="../config/components/config.css"></style>

<style scoped>
.settings-page {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding-block: var(--spacing-lg);
}

.config-load-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
