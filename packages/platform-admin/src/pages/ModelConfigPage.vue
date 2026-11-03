<script setup lang="ts">
import { ZodError } from "zod";
import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { usePlatformHost } from "../context";
import EmbeddingModelConfigCard from "../models/components/EmbeddingModelConfigCard.vue";
import ModelListCard from "../models/components/ModelListCard.vue";
import { modelLabel } from "@ontomato/agent-shell-ui/model-selection";
import ModelSelectionSelect from "../models/components/ModelSelectionSelect.vue";
import OntologyAgentModelsCard from "../models/components/OntologyAgentModelsCard.vue";
import TestResultDialog from "../models/components/TestResultDialog.vue";
import {
  type EmbeddingBusinessConfig,
  type EmbeddingModelConfig,
  type ModelEntry,
  type ModelSettings,
  type OntologyAgentSelection,
  type VectorRebuildStatus,
} from "../models/types";

/*
 * Model configuration page: the domain's conversation models and default, the ontology service agents' models, and the
 * Embedding model with its vector rebuild. Workbench agents choose their models in the workbench.
 */
const { t } = useI18n();
const { api, separators } = usePlatformHost();

// The list is held by a shallow ref and replaced as a whole: entries stay plain objects and opaque custom parameters never pass through Vue proxies.
const savedModels = shallowRef<ModelEntry[]>([]);
const defaultModelId = ref<string | null>(null);
const modelsLoaded = ref(false);
const loading = ref(false);
const loadError = ref("");
const saving = ref(false);

function applySaved(data: ModelSettings) {
  savedModels.value = data.models;
  defaultModelId.value = data.defaultModelId;
  modelsLoaded.value = true;
}

async function loadSettings() {
  loading.value = true;
  loadError.value = "";
  try {
    applySaved(await api.getModelSettings());
  } catch (e: any) {
    loadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loading.value = false;
  }
}

// Every save carries the whole library with its default: the service replaces both together.
async function saveSettings(settings: ModelSettings, success: string): Promise<boolean> {
  saving.value = true;
  try {
    applySaved(await api.saveModelSettings(settings));
    ElMessage.success(success);
    return true;
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
    return false;
  } finally {
    saving.value = false;
  }
}

// Adding or editing keeps the saved default; the first model of an empty library is made the default explicitly here.
async function saveModels(models: ModelEntry[]): Promise<boolean> {
  const firstModel = savedModels.value.length === 0 && models.length === 1;
  return saveSettings(
    { models, defaultModelId: firstModel ? models[0]!.name : defaultModelId.value },
    t("admin.modelSaveSuccess")
  );
}

async function selectDefault(modelId: string | null) {
  await saveSettings({ models: savedModels.value, defaultModelId: modelId }, t("admin.defaultModelSaved"));
}

// Removing the default model chooses the next default (or none) in the same save; removing another model keeps it.
const replacingDefault = ref(false);
const removingLabel = ref("");
const replacementDefault = ref<string | null>(null);
const remainingModels = shallowRef<ModelEntry[]>([]);

async function removeModel(index: number) {
  const removed = savedModels.value[index]!;
  const remaining = savedModels.value.filter((_, i) => i !== index);
  if (removed.name === defaultModelId.value) {
    removingLabel.value = modelLabel(removed);
    remainingModels.value = remaining;
    replacementDefault.value = remaining[0]?.name ?? null;
    replacingDefault.value = true;
    return;
  }
  const confirmed = await ElMessageBox.confirm(
    t("admin.deleteModelConfirm", { name: modelLabel(removed) }), t("common.deleteConfirm"),
    { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
  ).then(() => true, () => false);
  if (!confirmed) return;
  await saveSettings({ models: remaining, defaultModelId: defaultModelId.value }, t("admin.modelDeleted"));
}

async function removeDefaultModel() {
  const saved = await saveSettings(
    { models: remainingModels.value, defaultModelId: replacementDefault.value },
    t("admin.modelDeleted")
  );
  if (saved) replacingDefault.value = false;
}

const testDialogVisible = ref(false);
const testModel = shallowRef<ModelEntry | null>(null);
const testContent = ref("");
const testResult = ref("");
const testRunning = ref(false);

function openModelTest(model: ModelEntry) {
  testModel.value = model;
  testContent.value = "";
  testResult.value = "";
  testDialogVisible.value = true;
}

async function runModelTest() {
  if (!testContent.value.trim()) {
    ElMessage.warning(t("common.enterTestContent"));
    return;
  }
  testRunning.value = true;
  testResult.value = "";
  try {
    testResult.value = (await api.testModel(testModel.value!, testContent.value)).content;
  } catch (e: any) {
    testResult.value = `${t("admin.testFailed")}${separators.detail}${e.message || t("common.unknownError")}`;
  } finally {
    testRunning.value = false;
  }
}

// The ontology service's agents, each saved on its own; the row shows the service's answer, so a rejected change
// leaves the previous selection in place.
const ontologyAgents = shallowRef<OntologyAgentSelection[] | null>(null);
const agentsLoading = ref(false);
const agentsLoadError = ref("");
const savingAgents = ref<ReadonlySet<string>>(new Set());

async function loadOntologyAgents() {
  agentsLoading.value = true;
  agentsLoadError.value = "";
  try {
    ontologyAgents.value = await api.listOntologyAgentModels();
  } catch (e: any) {
    agentsLoadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    agentsLoading.value = false;
  }
}

async function saveOntologyAgent(id: string, selection: ModelSelection) {
  savingAgents.value = new Set([...savingAgents.value, id]);
  try {
    const saved = await api.saveOntologyAgentModel(id, selection);
    ontologyAgents.value = ontologyAgents.value?.map((agent) => (agent.id === id ? saved : agent)) ?? null;
    ElMessage.success(t("admin.agentModelSaved"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingAgents.value = new Set([...savingAgents.value].filter((saving) => saving !== id));
  }
}

// Embedding belongs to the business config: read with getConfig and saved separately.
const embedding = shallowRef<EmbeddingModelConfig | null>(null);
const embeddingLoading = ref(false);
const embeddingLoadError = ref("");
const savingEmbedding = ref(false);

async function loadEmbedding() {
  embeddingLoading.value = true;
  embeddingLoadError.value = "";
  try {
    const res = await api.getBusinessConfig();
    embedding.value = (res.data as EmbeddingBusinessConfig).embeddingModelProperties;
  } catch (e: any) {
    embeddingLoadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    embeddingLoading.value = false;
  }
}

// The dialog hands over the whole snapshot, which keeps fields it does not show (such as customHeaders).
async function saveEmbeddingConfig(model: EmbeddingModelConfig): Promise<boolean> {
  savingEmbedding.value = true;
  try {
    await api.saveEmbeddingModel(model);
    // Read back rather than keep the submitted snapshot, so a key just entered is not held by the page.
    await loadEmbedding();
    ElMessage.success(t("admin.embeddingSaveSuccess"));
    // A changed URL, model name or dimensions makes the backend report that a rebuild is needed.
    loadRebuildStatus();
    return true;
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
    return false;
  } finally {
    savingEmbedding.value = false;
  }
}

// This domain's vector rebuild: the backend decides whether it is needed and runs it; the page shows its status,
// polling while a run is alive and stopping when it ends or the page is left. A reload reads the same status again.
const REBUILD_POLL_MS = 3000;
const rebuildStatus = shallowRef<VectorRebuildStatus | null>(null);
let rebuildPollTimer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;
// Reads overlap (polling, then a start or pause): only the latest one may write the status and schedule the next.
let rebuildReadSeq = 0;

async function loadRebuildStatus() {
  const seq = ++rebuildReadSeq;
  let status: VectorRebuildStatus;
  try {
    status = await api.getVectorRebuildStatus();
  } catch (e: any) {
    if (seq !== rebuildReadSeq) return;
    // A failed or malformed read stops polling; the next save or rebuild reads again.
    ElMessage.error(e instanceof ZodError ? t("admin.loadConfigFailed") : e.message || t("admin.loadConfigFailed"));
    return;
  }
  if (seq !== rebuildReadSeq) return;
  rebuildStatus.value = status;
  // Overlapping reads (a save or rebuild during polling) each replace the pending timer, so at most one is scheduled.
  clearTimeout(rebuildPollTimer);
  const alive = status.state === "RUNNING" || status.state === "PAUSING";
  if (alive && !unmounted) rebuildPollTimer = setTimeout(loadRebuildStatus, REBUILD_POLL_MS);
}

async function rebuildVectors() {
  // Only a new round clears the existing vectors; resuming continues one already confirmed.
  if (rebuildStatus.value?.state === "PENDING") {
    const confirmed = await ElMessageBox.confirm(t("admin.vectorRebuildConfirm"), t("admin.rebuildVectors"), {
      type: "warning",
      confirmButtonText: t("admin.rebuildVectors"),
      cancelButtonText: t("common.cancel"),
    }).then(
      () => true,
      () => false
    );
    if (!confirmed) return;
  }
  await rebuildAction(api.rebuildVectors);
}

async function pauseVectorRebuild() {
  await rebuildAction(api.pauseVectorRebuild);
}

async function rebuildAction(request: () => Promise<unknown>) {
  try {
    await request();
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.operationFailed"));
  }
  // Read again either way: an accepted action shows its progress, and a rejection means the shown status was stale.
  await loadRebuildStatus();
}

onBeforeUnmount(() => {
  unmounted = true;
  clearTimeout(rebuildPollTimer);
});

// The test runs on the config handed over by the card: the saved one, or the dialog draft before it is saved.
const testEmbeddingTarget = shallowRef<EmbeddingModelConfig | null>(null);
const testEmbeddingDialogVisible = ref(false);
const testEmbeddingContent = ref("");
const testEmbeddingResult = ref("");
const testEmbeddingRunning = ref(false);

function openEmbeddingTest(model: EmbeddingModelConfig) {
  testEmbeddingTarget.value = model;
  testEmbeddingResult.value = "";
  testEmbeddingDialogVisible.value = true;
}

async function runEmbeddingTest() {
  if (!testEmbeddingContent.value.trim()) {
    ElMessage.warning(t("common.enterTestContent"));
    return;
  }
  testEmbeddingRunning.value = true;
  testEmbeddingResult.value = "";
  try {
    const res = await api.testEmbeddingModel({
      modelConfig: testEmbeddingTarget.value!,
      userContent: testEmbeddingContent.value,
    });
    testEmbeddingResult.value = JSON.stringify(res, null, 2);
  } catch (e: any) {
    testEmbeddingResult.value = `${t("admin.testFailed")}${separators.detail}${e.message || t("common.unknownError")}`;
  } finally {
    testEmbeddingRunning.value = false;
  }
}

onMounted(() => {
  loadSettings();
  loadOntologyAgents();
  loadEmbedding();
  loadRebuildStatus();
});
</script>

<template>
  <div class="model-config-container">
    <div v-if="loading" class="admin-card config-card">
      <el-skeleton :rows="4" animated />
    </div>
    <div v-else-if="loadError" class="load-error" role="alert">
      <span>{{ t("admin.modelListLoadFailed") }}{{ separators.detail }}{{ loadError }}</span>
      <el-button size="small" @click="loadSettings">{{ t("common.retry") }}</el-button>
    </div>
    <template v-else>
      <ModelListCard
        :models="savedModels"
        :default-model-id="defaultModelId"
        :saving="saving"
        :save="saveModels"
        @remove="removeModel"
        @test="openModelTest"
        @select-default="selectDefault"
      />
    </template>

    <OntologyAgentModelsCard
      :agents="ontologyAgents"
      :loading="agentsLoading"
      :load-error="agentsLoadError"
      :models="modelsLoaded ? savedModels : null"
      :default-model-id="defaultModelId"
      :saving="savingAgents"
      @change="saveOntologyAgent"
      @retry="loadOntologyAgents"
    />

    <EmbeddingModelConfigCard
      :model="embedding"
      :loading="embeddingLoading"
      :saving="savingEmbedding"
      :load-error="embeddingLoadError"
      :save="saveEmbeddingConfig"
      :rebuild-status="rebuildStatus"
      @test="openEmbeddingTest"
      @retry="loadEmbedding"
      @rebuild="rebuildVectors"
      @pause="pauseVectorRebuild"
    />

    <TestResultDialog
      v-model:visible="testDialogVisible"
      v-model:content="testContent"
      :title="t('admin.testModelNamed', { name: testModel && modelLabel(testModel) })"
      :result="testResult"
      :running="testRunning"
      :placeholder="t('common.enterTestMessage')"
      @submit="runModelTest"
    />

    <TestResultDialog
      v-model:visible="testEmbeddingDialogVisible"
      v-model:content="testEmbeddingContent"
      :title="t('admin.testModelNamed', { name: t('admin.embeddingModelConfig') })"
      :result="testEmbeddingResult"
      :running="testEmbeddingRunning"
      :placeholder="t('common.enterEmbeddingText')"
      @submit="runEmbeddingTest"
    />

    <el-dialog
      v-model="replacingDefault"
      :title="t('admin.deleteDefaultModel')"
      width="min(560px, calc(100vw - 32px))"
      class="model-dialog"
    >
      <p class="dialog-text">
        {{ t("admin.deleteDefaultModelHint", { name: removingLabel }) }}
      </p>
      <ModelSelectionSelect
        v-model="replacementDefault"
        :models="remainingModels"
        :null-label="t('admin.noDefaultModel')"
        :aria-label="t('admin.domainDefaultModel')"
      />
      <template #footer>
        <el-button @click="replacingDefault = false">{{ t("common.cancel") }}</el-button>
        <el-button type="danger" :loading="saving" @click="removeDefaultModel">{{ t("common.delete") }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped src="../models/models.css"></style>

<style scoped>
/* Width follows the admin main area; individual inputs limit their own width. */
.model-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}
</style>
