<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import type { ModelSettingsData, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { usePlatformHost } from "../context";
import { platformPages } from "../pages";
import AddProviderDialog from "../models/components/AddProviderDialog.vue";
import DefaultModelsPanel from "../models/components/DefaultModelsPanel.vue";
import ProviderDetail from "../models/components/ProviderDetail.vue";
import ProviderList from "../models/components/ProviderList.vue";
import {
  applyDraftChange,
  draftFromSettings,
  draftProblem,
  findModel,
  modelDraftKey,
  settingsWrite,
  type ModelSettingsDraft,
} from "../models/draft";
import { useModelErrors } from "../models/errors";
import type { VectorRebuildStatus } from "../models/types";

/*
 * Model configuration of the domain, edited as one draft and saved together: the providers with their chat and
 * embedding models, the domain defaults with each ontology service agent's model, and the provider timeout and
 * retries. The model settings are replaced as a whole on save; the agents' selections are then saved one by one
 * (the data engine accepts only models that are already saved). Agent Platform agents choose their models there.
 */
const { t } = useI18n();
const host = usePlatformHost();
const { api, separators } = host;
const describeError = useModelErrors();

const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.modelConfig.path));
const title = computed(() => page.value?.title ?? t(platformPages.modelConfig.titleKey));

type Tab = "providers" | "defaults" | "retry";
const activeTab = ref<Tab>("providers");

// ---- Model settings: the saved copy and the draft edited by every panel ----
const draft = reactive<ModelSettingsDraft>({
  savedRefs: [],
  providers: [],
  defaultModelId: null,
  embeddingModelId: null,
  retry: { provider: { timeoutMs: 1, maxRetries: 0, maxRetryDelayMs: 0 } },
});
provide(modelDraftKey, draft);
const saved = shallowRef<ModelSettingsData | null>(null);
const baseline = ref("");
const loading = ref(false);
const loadError = ref("");
const selectedProviderId = ref<string | null>(null);

function applySaved(data: ModelSettingsData) {
  saved.value = data;
  Object.assign(draft, draftFromSettings(data));
  baseline.value = JSON.stringify(settingsWrite(draft));
  if (!draft.providers.some((p) => p.id === selectedProviderId.value)) {
    selectedProviderId.value = draft.providers[0]?.id ?? null;
  }
}

async function loadSettings() {
  loading.value = true;
  loadError.value = "";
  try {
    applySaved(await api.getModelSettings());
  } catch (e) {
    loadError.value = describeError(e, "admin.loadConfigFailed");
  } finally {
    loading.value = false;
  }
}

const settingsDirty = computed(() => saved.value !== null && JSON.stringify(settingsWrite(draft)) !== baseline.value);

// ---- Ontology service agents: saved selections and their drafts ----
const agents = shallowRef<OntologyAgentModel[] | null>(null);
const agentSelections = reactive<Record<string, string | null>>({});
const agentsLoading = ref(false);
const agentsLoadError = ref("");

function applyAgents(list: OntologyAgentModel[]) {
  agents.value = list;
  for (const key of Object.keys(agentSelections)) delete agentSelections[key];
  for (const agent of list) agentSelections[agent.id] = agent.modelSelection.modelId;
}

async function loadAgents() {
  agentsLoading.value = true;
  agentsLoadError.value = "";
  try {
    applyAgents(await api.listOntologyAgentModels());
  } catch (e) {
    agentsLoadError.value = describeError(e, "admin.loadConfigFailed");
  } finally {
    agentsLoading.value = false;
  }
}

const changedAgents = computed(
  () => agents.value?.filter((agent) => agentSelections[agent.id] !== agent.modelSelection.modelId) ?? []
);
const dirty = computed(() => settingsDirty.value || changedAgents.value.length > 0);

// A renamed model takes its references on this page along; Agent Platform agents keep theirs and report them.
function followRename(from: string, to: string) {
  for (const [id, modelId] of Object.entries(agentSelections)) if (modelId === from) agentSelections[id] = to;
}

// ---- Providers ----
const addProviderVisible = ref(false);
const providerIds = computed(() => draft.providers.map((p) => p.id));

function addProvider(input: { id: string; name: string; api: ModelSettingsDraft["providers"][number]["api"] }) {
  draft.providers.push({
    id: input.id,
    savedKeyMask: null,
    name: input.name,
    baseUrl: "",
    api: input.api,
    apiKey: "",
    headers: [],
    models: [],
  });
  selectedProviderId.value = input.id;
}

function removeProvider(id: string) {
  const index = draft.providers.findIndex((p) => p.id === id);
  applyDraftChange(draft, (target) => {
    target.providers.splice(index, 1);
  });
  selectedProviderId.value = draft.providers[Math.min(index, draft.providers.length - 1)]?.id ?? null;
}

// ---- Provider timeout and retries, shown in seconds and stored in milliseconds ----
function secondsField(field: "timeoutMs" | "maxRetryDelayMs") {
  return computed({
    get: () => draft.retry.provider[field] / 1000,
    set: (value: number | null | undefined) => {
      draft.retry.provider[field] = Math.round((value ?? 0) * 1000);
    },
  });
}
const timeoutSeconds = secondsField("timeoutMs");
const retryDelaySeconds = secondsField("maxRetryDelayMs");

// ---- Save and discard ----
const saving = ref(false);

function embeddingIdentity(data: { embeddingModelId: string | null }, source: ModelSettingsDraft) {
  const model = findModel(source, data.embeddingModelId);
  return { ref: data.embeddingModelId, dimensions: model?.type === "embedding" ? model.dimensions : null };
}

/** A changed embedding model or dimensions makes the data engine rebuild every vector of the domain. */
async function confirmEmbeddingChange(): Promise<boolean> {
  if (!saved.value) return true;
  const before = embeddingIdentity(saved.value, draftFromSettings(saved.value));
  const after = embeddingIdentity(draft, draft);
  if (before.ref === after.ref && before.dimensions === after.dimensions) return true;
  const message =
    after.ref === null ? t("admin.embeddingClearConfirm") : before.ref === null ? t("admin.embeddingSetConfirm") : t("admin.embeddingChangeConfirm");
  return ElMessageBox.confirm(message, t("admin.embeddingChangeTitle"), {
    type: "warning",
    confirmButtonText: t("common.save"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
}

async function save() {
  const problem = draftProblem(draft);
  if (problem) {
    activeTab.value = problem.tab;
    if (problem.providerId) selectedProviderId.value = problem.providerId;
    ElMessage.error(t(problem.key, problem.params));
    return;
  }
  if (settingsDirty.value && !(await confirmEmbeddingChange())) return;
  saving.value = true;
  try {
    if (settingsDirty.value) {
      try {
        applySaved(await api.saveModelSettings(settingsWrite(draft)));
      } catch (e) {
        ElMessage.error(describeError(e, "admin.saveFailed"));
        return;
      }
      void loadRebuildStatus();
    }
    // Each agent's choice is saved on its own; a rejected one keeps its draft for another try.
    const failed: string[] = [];
    for (const agent of changedAgents.value) {
      try {
        const result = await api.saveOntologyAgentModel(agent.id, { modelId: agentSelections[agent.id] ?? null });
        agents.value = agents.value?.map((a) => (a.id === agent.id ? result : a)) ?? null;
      } catch (e) {
        failed.push(`${agent.name}${separators.detail}${describeError(e, "admin.saveFailed")}`);
      }
    }
    if (failed.length > 0) ElMessage.error(t("admin.agentModelsSaveFailed", { detail: failed.join("; ") }));
    else ElMessage.success(t("admin.modelSettingsSaved"));
  } finally {
    saving.value = false;
  }
}

async function discard() {
  const confirmed = await ElMessageBox.confirm(t("admin.discardChangesConfirm"), t("admin.discardChanges"), {
    type: "warning",
    confirmButtonText: t("admin.discardChanges"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
  if (!confirmed) return;
  if (saved.value) applySaved(saved.value);
  if (agents.value) applyAgents(agents.value);
}

onBeforeRouteLeave(async () => {
  if (!dirty.value) return true;
  return ElMessageBox.confirm(t("admin.leaveUnsavedConfirm"), t("admin.unsavedChanges"), {
    type: "warning",
    confirmButtonText: t("admin.leaveWithoutSaving"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
});

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}

// ---- Vector rebuild status (data engine): polled while a round is alive, stopped when it ends or the page is left ----
const REBUILD_POLL_MS = 3000;
const rebuildStatus = shallowRef<VectorRebuildStatus | null>(null);
let rebuildPollTimer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;
// Reads overlap (polling, then a save, start or pause): only the latest may write the status and schedule the next.
let rebuildReadSeq = 0;

async function loadRebuildStatus() {
  const seq = ++rebuildReadSeq;
  let status: VectorRebuildStatus;
  try {
    status = await api.getVectorRebuildStatus();
  } catch (e) {
    if (seq === rebuildReadSeq) ElMessage.error(describeError(e, "admin.loadConfigFailed"));
    return;
  }
  if (seq !== rebuildReadSeq) return;
  rebuildStatus.value = status;
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

async function rebuildAction(request: () => Promise<unknown>) {
  try {
    await request();
  } catch (e) {
    ElMessage.error(describeError(e, "admin.operationFailed"));
  }
  // Read again either way: an accepted action shows its progress, a rejection means the shown status was stale.
  await loadRebuildStatus();
}

onMounted(() => {
  window.addEventListener("beforeunload", warnBeforeUnload);
  void loadSettings();
  void loadAgents();
  void loadRebuildStatus();
});

onBeforeUnmount(() => {
  unmounted = true;
  clearTimeout(rebuildPollTimer);
  window.removeEventListener("beforeunload", warnBeforeUnload);
});
</script>

<template>
  <div class="model-config platform-page">
    <header class="page-header">
      <h1 class="page-title">{{ title }}</h1>
      <p class="page-description">{{ t("platform.descriptions.modelConfig") }}</p>
      <div class="page-actions">
        <span v-if="dirty" class="unsaved" role="status">{{ t("admin.unsavedChanges") }}</span>
        <el-button :disabled="!dirty || saving" @click="discard">{{ t("admin.discardChanges") }}</el-button>
        <el-button type="primary" :disabled="!dirty" :loading="saving" @click="save">{{ t("common.save") }}</el-button>
      </div>
    </header>

    <div v-if="loading && !saved" class="page-state">
      <el-skeleton :rows="6" animated />
    </div>
    <div v-else-if="loadError && !saved" class="page-state load-error" role="alert">
      <span>{{ loadError }}</span>
      <el-button size="small" @click="loadSettings">{{ t("common.retry") }}</el-button>
    </div>
    <el-tabs v-else v-model="activeTab" class="model-tabs">
      <el-tab-pane :label="t('admin.modelTabs.providers')" name="providers">
        <div class="providers-split">
          <ProviderList
            class="providers-list"
            :providers="draft.providers"
            :selected-id="selectedProviderId"
            @select="selectedProviderId = $event"
            @add="addProviderVisible = true"
          />
          <div class="providers-detail">
            <ProviderDetail
              v-if="selectedProviderId !== null && providerIds.includes(selectedProviderId)"
              :key="selectedProviderId"
              :provider-id="selectedProviderId"
              @renamed="followRename"
              @removed="removeProvider(selectedProviderId)"
            />
            <div v-else class="empty-detail">
              <p class="empty-title">{{ t("admin.noProviders") }}</p>
              <p class="empty-text">{{ t("admin.noProvidersHint") }}</p>
              <el-button type="primary" @click="addProviderVisible = true">{{ t("admin.addProvider") }}</el-button>
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane :label="t('admin.modelTabs.defaults')" name="defaults">
        <div class="tab-content">
          <DefaultModelsPanel
            :agents="agents"
            :agent-selections="agentSelections"
            :agents-loading="agentsLoading"
            :agents-load-error="agentsLoadError"
            :rebuild-status="rebuildStatus"
            @agent-change="(id, modelId) => (agentSelections[id] = modelId)"
            @retry-agents="loadAgents"
            @rebuild="rebuildVectors"
            @pause="rebuildAction(api.pauseVectorRebuild)"
          />
        </div>
      </el-tab-pane>
      <el-tab-pane :label="t('admin.modelTabs.retry')" name="retry">
        <div class="tab-content">
          <section class="settings-section">
            <p class="section-hint">{{ t("admin.retryHint") }}</p>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-label">{{ t("admin.requestTimeout") }}</span>
                <span class="setting-hint">{{ t("admin.requestTimeoutHint") }}</span>
              </div>
              <div class="setting-control narrow">
                <el-input-number
                  v-model="timeoutSeconds"
                  :min="0.001"
                  :step="10"
                  controls-position="right"
                  :aria-label="t('admin.requestTimeout')"
                />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-label">{{ t("admin.maxRetries") }}</span>
                <span class="setting-hint">{{ t("admin.maxRetriesHint") }}</span>
              </div>
              <div class="setting-control narrow">
                <el-input-number
                  v-model="draft.retry.provider.maxRetries"
                  :min="0"
                  :precision="0"
                  controls-position="right"
                  :aria-label="t('admin.maxRetries')"
                />
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-label">{{ t("admin.maxRetryDelay") }}</span>
                <span class="setting-hint">{{ t("admin.maxRetryDelayHint") }}</span>
              </div>
              <div class="setting-control narrow">
                <el-input-number
                  v-model="retryDelaySeconds"
                  :min="0"
                  :step="10"
                  controls-position="right"
                  :aria-label="t('admin.maxRetryDelay')"
                />
              </div>
            </div>
          </section>
        </div>
      </el-tab-pane>
    </el-tabs>

    <AddProviderDialog v-model:visible="addProviderVisible" :taken-ids="providerIds" @add="addProvider" />
  </div>
</template>

<style scoped src="../models/models.css"></style>
