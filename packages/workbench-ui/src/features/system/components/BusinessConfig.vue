<script setup lang="ts">
import {
  dataAdapterTestResultSchema,
  multiDataSourceRejectionSchema,
  multiDataSourceType,
  type DataAdapterInfo,
  type DataAdapterRequest,
  type DataAdaptersData,
} from "@ontomato/contracts/data-adapters";

import { ref, reactive, onMounted, watch } from "vue";
import { ElMessage } from "element-plus";
import { adminApi } from "../../admin";
import { ApiBusinessError } from "../../../utils/api";
import { useI18n } from "vue-i18n";
import { workbenchContent } from "../../../content";
import DataAdapterConfigCard from "./business-config/DataAdapterConfigCard.vue";
import GeneralConfigCard from "./business-config/GeneralConfigCard.vue";
import QuerySettingsCard from "./business-config/QuerySettingsCard.vue";
import SkillDirConfigCard from "./business-config/SkillDirConfigCard.vue";
import {
  dataAdapterRequest,
  multiDataSourceDefinition,
  multiDataSourceDraft,
  type BusinessConfig,
  type DataAdapterTestOutcome,
  type GeneralConfigKey,
  type MultiDataSourceDraft,
  type MultiDataSourceSaveFailure,
  type OntologyOutline,
  type QuerySettings,
  type SystemSettings,
} from "../types";
import type { BusinessConfigProps } from "../business-config";

// System config page: query settings, skill directory, general config and data adapter; models live on the model configuration page, query examples on their own page.
const props = defineProps<BusinessConfigProps>();
const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const loading = ref(false);
const backendLoadError = ref("");
const querySettingsRef = ref<{ markSaved: () => void } | null>(null);

// Draft of the general config, language and data adapter, bound two-way by the cards.
let config = reactive<SystemSettings>({
  knowledgeMaxResult: 10,
  toolAndPythonRetry: 0,
  dslCookerTries: 1,
  dslCookerTimeout: 300000,
  questionSpliterTries: 1,
  questionSpliterTimeout: 300000,
  lang: props.defaultLanguage,
  dataAdapter: "",
  dataAdapterConnections: {},
});
// Data adapters installed in this edition's backend, loaded together with the business config.
const dataAdapters = ref<DataAdapterInfo[]>([]);
// Skill directory draft: kept when loading or saving fails and untouched by navigation.
const skilldir = ref("");

async function loadConfig() {
  loading.value = true;
  backendLoadError.value = "";
  try {
    const [res, adaptersRes] = await Promise.all([
      adminApi.getBusinessConfig(),
      adminApi.listDataAdapters(),
    ]);
    if (res?.success) {
      dataAdapters.value = (adaptersRes.data as DataAdaptersData).adapters;
      const data = res.data as BusinessConfig;
      // The skill directory hangs on the coding role and is empty when unset.
      skilldir.value = data.agents.coding.skilldir ?? "";
      config.knowledgeMaxResult = data.knowledgeMaxResult ?? 10;
      config.toolAndPythonRetry = data.toolAndPythonRetry ?? 0;
      config.dslCookerTries = data.dslCookerTries ?? 1;
      config.dslCookerTimeout = data.dslCookerTimeout ?? 300000;
      config.questionSpliterTries = data.questionSpliterTries ?? 1;
      config.questionSpliterTimeout = data.questionSpliterTimeout ?? 300000;
      // Only languages this edition ships are selectable; any other stored value shows the default until saved explicitly.
      config.lang = props.languageOptions.some(({ value }) => value === data.lang)
        ? data.lang
        : props.defaultLanguage;
      config.dataAdapter = data.dataAdapter;
      config.dataAdapterConnections = data.dataAdapterConnections;
      multiDraft.value = multiDataSourceDraft(data.multiDataSource);
      dataAdapterMode.value = config.dataAdapter;
    } else {
      backendLoadError.value = res?.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    backendLoadError.value = e.message || t("admin.loadConfigFailed");
    ElMessage.error(e.message || t("admin.loadConfigFailed"));
  } finally {
    loading.value = false;
  }
}

const savingSkillDir = ref(false);

async function saveSkillDir() {
  if (loading.value || backendLoadError.value || savingSkillDir.value) {
    if (backendLoadError.value) ElMessage.error(backendLoadError.value);
    return;
  }
  savingSkillDir.value = true;
  try {
    const res = await adminApi.saveToolSkillDir(skilldir.value);
    if (res?.success) {
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingSkillDir.value = false;
  }
}

const savingGeneral: Record<string, boolean> = reactive({
  knowledgeMaxResult: false,
  toolAndPythonRetry: false,
  dslCookerTries: false,
  dslCookerTimeout: false,
  questionSpliterTries: false,
  questionSpliterTimeout: false,
  lang: false,
});

async function saveGeneralConfig(key: GeneralConfigKey, value: unknown) {
  savingGeneral[key] = true;
  try {
    const res = await adminApi.saveGeneralConfig(key, value);
    if (res?.success) {
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res?.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingGeneral[key] = false;
  }
}

async function saveGeneralField(key: GeneralConfigKey) {
  await saveGeneralConfig(key, config[key]);
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
    await adminApi.useDataAdapter(singleSourceRequest(adapter));
    ElMessage.success(t("admin.switchedDataAdapter", { name: adapter.label }));
    config.dataAdapter = dataAdapterMode.value;
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingAdapter.value = false;
  }
}

// Tests a candidate connection without saving it or switching this domain's adapter.
async function testConnection(request: DataAdapterRequest): Promise<DataAdapterTestOutcome> {
  try {
    const res = await adminApi.testDataAdapter(request);
    const report = dataAdapterTestResultSchema.safeParse(res.data);
    return report.success
      ? { ok: true, result: report.data }
      : { ok: false, message: t("admin.dataAdapterInvalidReport") };
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
    ontology.value = await adminApi.getOntologyOutline();
  } catch (e: any) {
    ontologyLoadError.value = e.message;
  } finally {
    loadingOntology.value = false;
  }
}

watch(dataAdapterMode, (mode) => {
  if (mode === multiDataSourceType && ontology.value === null && !loadingOntology.value) {
    loadOntology();
  }
});

// The data engine checks the whole definition against the ontology; a rejection lists every located problem.
async function saveMultiDataSource() {
  savingAdapter.value = true;
  multiSaveFailure.value = null;
  try {
    await adminApi.useMultiDataSource(multiDataSourceDefinition(multiDraft.value, ontology.value!));
    ElMessage.success(t("admin.switchedDataAdapter", { name: selectedDataAdapter().label }));
    config.dataAdapter = multiDataSourceType;
  } catch (e: any) {
    const rejection = e instanceof ApiBusinessError ? multiDataSourceRejectionSchema.safeParse(e.body) : null;
    multiSaveFailure.value = {
      message: e.message,
      problems: rejection?.success ? rejection.data.data.problems : [],
    };
  } finally {
    savingAdapter.value = false;
  }
}

// Query settings live in the Node system model file and hold only the total time limit.
let querySettings = reactive<QuerySettings>({
  queryTimeoutSeconds: 600,
});
const loadingQuerySettings = ref(false);
const querySettingsLoadError = ref("");
const savingQuerySettings = ref(false);

function applyQuerySettings(data: QuerySettings) {
  querySettings.queryTimeoutSeconds = data.queryTimeoutSeconds;
}

async function loadQuerySettings() {
  loadingQuerySettings.value = true;
  querySettingsLoadError.value = "";
  try {
    const res = await adminApi.getSystemModelConfig();
    if (res.success) {
      applyQuerySettings(res.data as QuerySettings);
    } else {
      querySettingsLoadError.value = res.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    querySettingsLoadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loadingQuerySettings.value = false;
  }
}

async function saveQuerySettings() {
  savingQuerySettings.value = true;
  try {
    const res = await adminApi.saveSystemModelConfig({ ...querySettings });
    if (res.success) {
      applyQuerySettings(res.data as QuerySettings);
      querySettingsRef.value?.markSaved();
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingQuerySettings.value = false;
  }
}

onMounted(() => {
  loadConfig();
  loadQuerySettings();
});
</script>

<template>
  <div class="system-config-container">
    <QuerySettingsCard
      ref="querySettingsRef"
      v-model:model="querySettings"
      :loading="loadingQuerySettings"
      :saving="savingQuerySettings"
      :load-error="querySettingsLoadError"
      @save="saveQuerySettings"
      @retry="loadQuerySettings"
    />

    <div v-if="backendLoadError" class="config-load-error" role="alert">
      <span>{{ t("admin.loadConfigFailed") }}{{ businessConfigSeparator }}{{ backendLoadError }}</span>
      <el-button size="small" @click="loadConfig">{{ t("common.retry") }}</el-button>
    </div>

    <SkillDirConfigCard
      v-model:skilldir="skilldir"
      :saving="savingSkillDir"
      :disabled="loading || !!backendLoadError"
      @save="saveSkillDir"
    />

    <GeneralConfigCard
      v-model:config="config"
      :saving="savingGeneral"
      :language-options="languageOptions"
      :default-language="defaultLanguage"
      :disabled="loading || !!backendLoadError"
      @save="saveGeneralField"
    />

    <DataAdapterConfigCard
      v-model:config="config"
      v-model:mode="dataAdapterMode"
      :adapters="dataAdapters"
      :adapter-display="adapterDisplay"
      :saving="savingAdapter"
      :testing="testingAdapter"
      :test="adapterTest"
      :disabled="loading || !!backendLoadError"
      v-model:multi-draft="multiDraft"
      :ontology="ontology"
      :ontology-load-error="ontologyLoadError"
      :test-connection="testConnection"
      :multi-save-failure="multiSaveFailure"
      @save="saveDataAdapter"
      @test="testDataAdapter"
      @retry-ontology="loadOntology"
    />
  </div>
</template>

<style scoped src="./business-config/business-config.css"></style>

<style scoped>
.system-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}

.config-load-error {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  margin: var(--spacing-lg) 0;
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
  flex-wrap: wrap;
}
</style>
