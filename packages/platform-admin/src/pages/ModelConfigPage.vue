<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { usePageActions, useUnsavedChanges } from "@ontomato/platform-shell";
import type { ModelSettingsData, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { usePlatformHost } from "../context";
import { platformPages } from "../pages";
import ModelUsagePanel from "../models/components/ModelUsagePanel.vue";
import ModelProvidersPanel from "../models/components/ModelProvidersPanel.vue";
import {
  draftFromSettings,
  draftProblem,
  findModel,
  modelDraftKey,
  settingsWrite,
  type ModelSettingsDraft,
} from "../models/draft";
import { useModelErrors } from "../models/errors";
import { ontologyAgentsKey } from "../models/agents";
import { rebuildStatusKey } from "../models/types";
import type { VectorRebuildStatus } from "../models/types";

/*
 * The domain's model library, edited as one draft and saved as a whole: the providers with their chat and embedding
 * models, the domain defaults and the provider timeout and retries. It is two pages of the system settings, Model usage
 * (the defaults, the vector model, the call policy) and Providers (each provider's connection and models), drawn by
 * this one screen: moving between them keeps the draft, and either page's Save and Discard act on the whole library.
 *
 * Which model each agent runs on is chosen in the agent's own application. The ontology service agents are read here
 * only to say who uses a model and whom a renamed model leaves without one.
 */
const { t } = useI18n();
const host = usePlatformHost();
const { api } = host;
const describeError = useModelErrors();
const route = useRoute();
const router = useRouter();
const onProviders = computed(() => route.path === platformPages.modelProviders.path);

// ---- Model settings: the saved copy and the draft edited by both pages ----
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

const dirty = computed(() => saved.value !== null && JSON.stringify(settingsWrite(draft)) !== baseline.value);

// ---- The ontology service agents, read only: who uses a model, and whom a rename leaves without one ----
const ontologyAgents = shallowRef<OntologyAgentModel[] | null>(null);
provide(ontologyAgentsKey, ontologyAgents);

async function loadOntologyAgents() {
  try {
    ontologyAgents.value = await api.listOntologyAgentModels();
  } catch (e) {
    ElMessage.error(describeError(e, "admin.ontologyAgentModelsLoadFailed"));
  }
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

/** Where a draft problem is shown: the page the problem belongs to, and the provider whose panel must be open. */
function showProblem(problem: NonNullable<ReturnType<typeof draftProblem>>) {
  if (problem.providerId) selectedProviderId.value = problem.providerId;
  void router.push(problem.page === "providers" ? platformPages.modelProviders.path : platformPages.modelUsage.path);
  ElMessage.error(t(problem.key, problem.params));
}

async function save() {
  const problem = draftProblem(draft);
  if (problem) {
    showProblem(problem);
    return;
  }
  if (!(await confirmEmbeddingChange())) return;
  saving.value = true;
  try {
    applySaved(await api.saveModelSettings(settingsWrite(draft)));
    ElMessage.success(t("admin.modelSettingsSaved"));
    void loadRebuildStatus();
  } catch (e) {
    ElMessage.error(describeError(e, "admin.saveFailed"));
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
  if (confirmed && saved.value) applySaved(saved.value);
}

// The header's Save and its unsaved marker, on either page: both are the one library. Moving between the two pages keeps
// the draft; leaving them with changes asks first.
usePageActions(() => ({
  draft: saved.value
    ? { dirty: dirty.value, saving: saving.value, save: () => void save(), discard: () => void discard() }
    : null,
}));
useUnsavedChanges({
  dirty: () => dirty.value,
  paths: () => [platformPages.modelUsage.path, platformPages.modelProviders.path],
});

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
  void loadSettings();
  void loadOntologyAgents();
  void loadRebuildStatus();
});

onBeforeUnmount(() => {
  unmounted = true;
  clearTimeout(rebuildPollTimer);
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
    <ModelProvidersPanel
      v-else-if="onProviders"
      :selected-id="selectedProviderId"
      @select="selectedProviderId = $event"
      @removed="selectedProviderId !== null && removeProvider(selectedProviderId)"
    />
    <ModelUsagePanel
      v-else
      :rebuild-status="rebuildStatus"
      @rebuild="rebuildVectors"
      @pause="rebuildAction(api.pauseVectorRebuild)"
    />
  </div>
</template>

<style scoped src="../models/models.css"></style>
