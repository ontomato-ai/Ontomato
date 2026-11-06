<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import type { ModelSettingsData, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { usePageActions, usePlatformHost } from "../context";
import { modelConfigTabs, platformPages } from "../pages";
import ModelUsagePanel from "../models/components/ModelUsagePanel.vue";
import ModelProvidersPanel from "../models/components/ModelProvidersPanel.vue";
import PageTabs from "../layout/PageTabs.vue";
import {
  draftFromSettings,
  draftProblem,
  findModel,
  modelDraftKey,
  settingsWrite,
  type ModelSettingsDraft,
} from "../models/draft";
import { useModelErrors } from "../models/errors";
import { agentModelsDraftKey, type AgentModelsDraft } from "../models/agents";
import { rebuildStatusKey } from "../models/types";
import type { VectorRebuildStatus } from "../models/types";

/*
 * Model configuration of the domain, edited as one draft and saved together: the providers with their chat and
 * embedding models, the domain defaults with each ontology service agent's model, and the provider timeout and
 * retries. The model settings are replaced as a whole on save; the agents' selections are then saved one by one
 * (the data engine accepts only models that are already saved). Agent Platform agents choose their models there.
 *
 * The page is two screens: Usage (the domain defaults, the vector model and the ontology agents that depart from the
 * chat default, with the call policy at the bottom) and Providers (the provider list with its connection and models).
 */
const { t } = useI18n();
const host = usePlatformHost();
const { api, separators } = host;
const describeError = useModelErrors();
const router = useRouter();

const page = computed(() => host.navigation.value.pages.find((p) => p.path === platformPages.modelConfig.path));

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
const agentsDraft = reactive<AgentModelsDraft>({ saved: null, selections: {} });
provide(agentModelsDraftKey, agentsDraft);
const agentsLoading = ref(false);
const agentsLoadError = ref("");

function applyAgents(list: OntologyAgentModel[]) {
  agentsDraft.saved = list;
  for (const key of Object.keys(agentsDraft.selections)) delete agentsDraft.selections[key];
  for (const agent of list) agentsDraft.selections[agent.id] = agent.modelSelection.modelId;
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
  () =>
    agentsDraft.saved?.filter((agent) => agentsDraft.selections[agent.id] !== agent.modelSelection.modelId) ?? []
);
const dirty = computed(() => settingsDirty.value || changedAgents.value.length > 0);
// The one header's Save and its unsaved marker: the page hands its draft over instead of drawing a second header.
usePageActions(() => ({ get dirty() { return dirty.value; }, get saving() { return saving.value; }, save: () => void save(), discard }));

// A renamed model takes its references on this page along; Agent Platform agents keep theirs and report them.
function followRename(from: string, to: string) {
  for (const [id, modelId] of Object.entries(agentsDraft.selections)) if (modelId === from) agentsDraft.selections[id] = to;
}

// ---- Providers ----
function removeProvider(id: string) {
  const index = draft.providers.findIndex((p) => p.id === id);
  // The models' references follow the removal: a default whose model is gone is unset (the panel confirmed it).
  draft.providers.splice(index, 1);
  selectedProviderId.value = draft.providers[Math.min(index, draft.providers.length - 1)]?.id ?? null;
}

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

/** Where a draft problem is shown: the tab the problem belongs to, and the provider whose panel must be open. */
function showProblem(problem: NonNullable<ReturnType<typeof draftProblem>>) {
  if (problem.providerId) selectedProviderId.value = problem.providerId;
  void router.push(problem.tab === "providers" ? modelConfigTabs.providers.path : modelConfigTabs.usage.path);
  ElMessage.error(t(problem.key, problem.params));
}

async function save() {
  const problem = draftProblem(draft);
  if (problem) {
    showProblem(problem);
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
        const result = await api.saveOntologyAgentModel(agent.id, { modelId: agentsDraft.selections[agent.id] ?? null });
        agentsDraft.saved = agentsDraft.saved?.map((a) => (a.id === agent.id ? result : a)) ?? null;
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
  if (agentsDraft.saved) applyAgents(agentsDraft.saved);
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
provide(rebuildStatusKey, rebuildStatus);
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
    <div v-if="loading && !saved" class="page-state">
      <el-skeleton :rows="6" animated />
    </div>
    <div v-else-if="loadError && !saved" class="page-state load-error" role="alert">
      <span>{{ loadError }}</span>
      <el-button size="small" @click="loadSettings">{{ t("common.retry") }}</el-button>
    </div>
    <PageTabs v-else :page="page!">
      <template #default="{ tab }">
        <ModelUsagePanel
          v-if="tab?.path !== modelConfigTabs.providers.path"
          :agents="agentsDraft.saved"
          :agent-selections="agentsDraft.selections"
          :agents-loading="agentsLoading"
          :agents-load-error="agentsLoadError"
          :rebuild-status="rebuildStatus"
          @agent-change="(id, modelId) => (agentsDraft.selections[id] = modelId)"
          @retry-agents="loadAgents"
          @rebuild="rebuildVectors"
          @pause="rebuildAction(api.pauseVectorRebuild)"
        />
        <ModelProvidersPanel
          v-else
          :selected-id="selectedProviderId"
          @select="selectedProviderId = $event"
          @renamed="followRename"
          @removed="selectedProviderId !== null && removeProvider(selectedProviderId)"
        />
      </template>
    </PageTabs>
  </div>
</template>

<style scoped src="../models/models.css"></style>
