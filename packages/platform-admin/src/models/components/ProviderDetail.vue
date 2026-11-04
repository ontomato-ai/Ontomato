<script setup lang="ts">
import { computed, reactive, ref, shallowRef, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Download, Plus, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import {
  PI_CHAT_MODEL_DEFAULTS,
  modelApiSchema,
  supportsEmbeddings,
  type ModelEntry,
} from "@ontomato/contracts/model-settings";
import { modelLabel } from "@ontomato/contracts/model-selection";
import { modelApiBaseUrls, modelApiLabels } from "../apis";
import type { RuntimeModelDiscoveryResponse } from "@ontomato/contracts/runtime-model-test";
import { useAgentModelsDraft } from "../agents";
import { usePlatformHost } from "../../context";
import { useModelErrors } from "../errors";
import {
  applyDraftChange,
  defaultsClearedBy,
  draftChoices,
  draftConnection,
  modelName,
  modelRef,
  splitModelRef,
  useModelDraft,
  type ClearedDefault,
  type DraftChange,
} from "../draft";
import DiscoverDialog from "./DiscoverDialog.vue";
import ModelEditDialog from "./ModelEditDialog.vue";

/*
 * One provider of the draft: its connection (protocol, address, key, headers), a check with one of its models, and
 * its chat and embedding models. Every change stays in the page draft until the page is saved.
 */
const props = defineProps<{ providerId: string }>();
const emit = defineEmits<{
  /** A model of this provider was renamed: references to `from` follow it to `to`. */
  renamed: [from: string, to: string];
  removed: [];
}>();
const { t, te } = useI18n();
const { api } = usePlatformHost();
const describeError = useModelErrors();
const draft = useModelDraft();
const agentDraft = useAgentModelsDraft();

// The provider lives in the shared draft and the panel edits it there. The page shows the panel only for a provider of
// the draft; right after the provider is removed, until the page drops the panel, the last one found stands in.
let found = draft.providers.find((p) => p.id === props.providerId)!;
const provider = computed(() => (found = draft.providers.find((p) => p.id === props.providerId) ?? found));

const apis = modelApiSchema.options;

// The key input starts empty for a saved provider; leaving it empty submits the saved mask, which keeps the key.
const keyInput = computed({
  get: () => (provider.value.apiKey === provider.value.savedKeyMask ? "" : provider.value.apiKey),
  set: (value: string) => {
    provider.value.apiKey = value === "" && provider.value.savedKeyMask ? provider.value.savedKeyMask : value;
  },
});

const advancedOpen = ref(provider.value.headers.length > 0);
function addHeader() {
  provider.value.headers.push({ name: "", value: "" });
  advancedOpen.value = true;
}

const chatModels = computed(() => provider.value.models.filter((m) => m.type === "chat"));
const embeddingModels = computed(() => provider.value.models.filter((m) => m.type === "embedding"));
const groups = computed(() => [
  { type: "chat" as const, models: chatModels.value },
  { type: "embedding" as const, models: embeddingModels.value },
]);
const embeddingsMisplaced = computed(() => embeddingModels.value.length > 0 && !supportsEmbeddings(provider.value.api));

function defaultTag(model: ModelEntry): string | null {
  const ref = modelRef(provider.value.id, model.id);
  if (ref === draft.defaultModelId) return t("admin.defaultModelTag");
  if (ref === draft.embeddingModelId) return t("admin.embeddingDefaultTag");
  return null;
}

function modelMeta(model: ModelEntry): string[] {
  if (model.type === "embedding") return [t("admin.dimensionsValue", { n: model.dimensions })];
  return [
    t("admin.contextValue", { n: (model.contextWindow ?? PI_CHAT_MODEL_DEFAULTS.contextWindow).toLocaleString() }),
    ...(model.reasoning ? [t("admin.reasoning")] : []),
    ...(model.input?.includes("image") ? [t("admin.imageInput")] : []),
    ...(model.samplingParams && Object.keys(model.samplingParams).length > 0 ? [t("admin.samplingParams")] : []),
  ];
}

// ---- Check: one minimal call with one model of the unsaved provider, row by row ----
const checking = ref<string | null>(null);
const checkResults = reactive(new Map<string, { ok: boolean; text: string }>());
watch(() => props.providerId, () => checkResults.clear());

function connectionProblem(): string | null {
  if (!provider.value.baseUrl.trim()) return t("admin.baseUrlRequired");
  if (!provider.value.apiKey.trim()) return t("admin.apiKeyRequired");
  return null;
}

async function check(model: ModelEntry) {
  const problem = connectionProblem();
  if (problem) {
    checkResults.set(model.id, { ok: false, text: problem });
    return;
  }
  checking.value = model.id;
  checkResults.delete(model.id);
  try {
    const result = await api.testModel({ ...draftConnection(draft, provider.value), model });
    checkResults.set(model.id, {
      ok: true,
      text:
        result.type === "embedding"
          ? t("admin.checkEmbeddingPassed", { n: result.dimensions })
          : t("admin.checkChatPassed", { content: result.content.trim().slice(0, 200) }),
    });
  } catch (e) {
    checkResults.set(model.id, { ok: false, text: describeError(e, "admin.checkFailed") });
  } finally {
    checking.value = null;
  }
}

// ---- Models ----
const editVisible = ref(false);
const editing = shallowRef<{ index: number | null; model: Partial<ModelEntry> | null }>({ index: null, model: null });
const takenIds = computed(() =>
  provider.value.models.filter((_, i) => i !== editing.value.index).map((m) => m.id)
);

function openModel(index: number | null, model: Partial<ModelEntry> | null) {
  editing.value = { index, model };
  editVisible.value = true;
}

// A change that renames a saved model or unsets a domain default is confirmed first, naming what it affects.
function labelOf(ref: string): string {
  const choice = draftChoices(draft).find((c) => c.ref === ref);
  return choice ? modelLabel(choice) : ref;
}

function clearedText(cleared: ClearedDefault[]): string[] {
  return cleared.map((c) =>
    t(c.kind === "chat" ? "admin.chatDefaultCleared" : "admin.embeddingDefaultCleared", { name: labelOf(c.ref) })
  );
}

function confirmChange(title: string, lines: string[], confirmText: string): Promise<boolean> {
  return ElMessageBox.confirm(lines.join(" "), title, {
    type: "warning",
    confirmButtonText: confirmText,
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
}

function replaceChange(index: number, model: ModelEntry): DraftChange {
  const providerId = provider.value.id;
  const from = modelRef(providerId, provider.value.models[index]!.id);
  return (target) => {
    target.providers.find((p) => p.id === providerId)!.models.splice(index, 1, model);
    return { from, to: modelRef(providerId, model.id) };
  };
}

async function beforeSaveModel(model: ModelEntry): Promise<boolean> {
  const { index } = editing.value;
  if (index === null) return true;
  const from = modelRef(provider.value.id, provider.value.models[index]!.id);
  const to = modelRef(provider.value.id, model.id);
  const lines = [
    ...(from !== to && draft.savedRefs.includes(from) ? [t("admin.modelRenameConfirm", { from, to })] : []),
    ...clearedText(defaultsClearedBy(draft, replaceChange(index, model))),
  ];
  if (lines.length === 0) return true;
  const title = from !== to ? t("admin.modelRenameTitle") : t("admin.clearDefaultsTitle");
  return confirmChange(title, [...lines, t("admin.continueConfirm")], t("common.confirm"));
}

function saveModel(model: ModelEntry) {
  const { index } = editing.value;
  if (index === null) {
    provider.value.models.push(model);
    return;
  }
  const moved = applyDraftChange(draft, replaceChange(index, model));
  if (moved && moved.from !== moved.to) emit("renamed", moved.from, moved.to);
}

async function removeModel(model: ModelEntry) {
  const providerId = provider.value.id;
  const change: DraftChange = (target) => {
    const owner = target.providers.find((p) => p.id === providerId)!;
    owner.models = owner.models.filter((m) => m.id !== model.id);
  };
  const cleared = clearedText(defaultsClearedBy(draft, change));
  if (cleared.length > 0) {
    const lines = [t("admin.removeModelConfirm", { name: modelName(model) }), ...cleared];
    if (!(await confirmChange(t("admin.removeModel"), lines, t("common.delete")))) return;
  }
  applyDraftChange(draft, change);
}

async function removeProvider() {
  const providerId = provider.value.id;
  const cleared = clearedText(
    defaultsClearedBy(draft, (target) => {
      target.providers = target.providers.filter((p) => p.id !== providerId);
    })
  );
  const lines = [
    t("admin.removeProviderConfirm", { name: provider.value.name || providerId, n: provider.value.models.length }),
    ...cleared,
  ];
  if (await confirmChange(t("admin.removeProvider"), lines, t("common.delete"))) emit("removed");
}

// ---- Who uses this provider's models: the domain defaults and the ontology agents (Agent Platform agents are its own) ----
const usages = computed(() => {
  const providerId = provider.value.id;
  const owns = (ref: string | null) => ref !== null && ref.startsWith(`${providerId}/`);
  const rows: { kind: "chatDefault" | "embeddingDefault" | "agent"; name: string; ref: string }[] = [];
  if (owns(draft.defaultModelId)) {
    rows.push({ kind: "chatDefault", name: t("admin.domainDefaultModel"), ref: draft.defaultModelId! });
  }
  if (owns(draft.embeddingModelId)) {
    rows.push({ kind: "embeddingDefault", name: t("admin.embeddingModel"), ref: draft.embeddingModelId! });
  }
  for (const agent of agentDraft.saved ?? []) {
    const ref = agentDraft.selections[agent.id] ?? null;
    if (owns(ref)) rows.push({ kind: "agent", name: agentName(agent), ref: ref! });
  }
  return rows;
});

function agentName(agent: { kind: string; name: string }) {
  const key = `admin.ontologyAgentKinds.${agent.kind}`;
  return te(key) ? t(key) : agent.name;
}

/** The model's name in this provider (the ID when it has no other). */
function refLabel(ref: string) {
  const { modelId } = splitModelRef(ref);
  const model = provider.value.models.find((candidate) => candidate.id === modelId);
  return model ? modelName(model) : modelId;
}

// ---- Discovery ----
const discoverVisible = ref(false);
function openDiscover() {
  const problem = connectionProblem();
  if (problem) {
    ElMessage.warning(problem);
    return;
  }
  discoverVisible.value = true;
}
const discover = (): Promise<RuntimeModelDiscoveryResponse> =>
  api.discoverModels(draftConnection(draft, provider.value));
const allIds = computed(() => provider.value.models.map((m) => m.id));
function addCandidate(candidate: RuntimeModelDiscoveryResponse["models"][number]) {
  openModel(null, { id: candidate.id, ...(candidate.name && candidate.name !== candidate.id ? { name: candidate.name } : {}) });
}
function addManually() {
  discoverVisible.value = false;
  openModel(null, null);
}
</script>

<template>
  <section class="provider-detail" :aria-label="provider.name || provider.id">
    <header class="detail-header">
      <h2 class="detail-title">{{ provider.name || provider.id }}</h2>
      <span class="detail-id">{{ provider.id }}</span>
      <el-button class="detail-remove" link type="danger" :icon="Trash2" @click="removeProvider">
        {{ t("admin.removeProvider") }}
      </el-button>
    </header>

    <el-form label-position="left" label-width="120px" class="provider-form" @submit.prevent>
      <el-form-item :label="t('admin.providerName')">
        <el-input v-model="provider.name" :placeholder="provider.id" />
      </el-form-item>
      <el-form-item :label="t('admin.providerId')">
        <span class="readonly-value mono">{{ provider.id }}</span>
      </el-form-item>
      <el-form-item :label="t('admin.providerApi')">
        <el-select v-model="provider.api" :aria-label="t('admin.providerApi')">
          <el-option v-for="value in apis" :key="value" :value="value" :label="modelApiLabels[value]" />
        </el-select>
        <p v-if="embeddingsMisplaced" class="field-hint warning" role="alert">{{ t("admin.embeddingNeedsOpenAi") }}</p>
      </el-form-item>
      <el-form-item :label="t('admin.baseUrl')">
        <el-input v-model="provider.baseUrl" :placeholder="modelApiBaseUrls[provider.api]" />
      </el-form-item>
      <el-form-item :label="t('admin.apiKey')">
        <el-input
          v-model="keyInput"
          type="password"
          show-password
          autocomplete="new-password"
          :placeholder="provider.savedKeyMask ?? 'sk-...'"
          :aria-label="t('admin.apiKey')"
        />
        <p class="field-hint">
          {{ provider.savedKeyMask ? t("admin.savedKeyHint") : t("admin.apiKeyHint") }}
        </p>
      </el-form-item>
    </el-form>

    <div class="advanced">
      <button type="button" class="disclosure" :aria-expanded="advancedOpen" @click="advancedOpen = !advancedOpen">
        <ChevronDown v-if="advancedOpen" :size="14" aria-hidden="true" />
        <ChevronRight v-else :size="14" aria-hidden="true" />
        <span>{{ t("admin.advancedSettings") }}</span>
        <span v-if="provider.headers.length > 0" class="disclosure-count">
          {{ t("admin.headerCount", { n: provider.headers.length }) }}
        </span>
      </button>
      <div v-if="advancedOpen" class="advanced-body">
        <p class="field-label">{{ t("admin.requestHeaders") }}</p>
        <div v-for="(header, index) in provider.headers" :key="index" class="header-row">
          <el-input v-model="header.name" :placeholder="t('admin.headerName')" :aria-label="t('admin.headerName')" />
          <el-input v-model="header.value" :placeholder="t('admin.headerValue')" :aria-label="t('admin.headerValue')" />
          <el-button
            link
            :icon="Trash2"
            :aria-label="t('common.delete')"
            :title="t('common.delete')"
            @click="provider.headers.splice(index, 1)"
          />
        </div>
        <el-button size="small" :icon="Plus" @click="addHeader">{{ t("admin.addHeader") }}</el-button>
        <p class="field-hint">{{ t("admin.requestHeadersHint") }}</p>
      </div>
    </div>

    <div class="models-section">
      <div class="section-bar">
        <h3 class="section-title">{{ t("admin.models") }}</h3>
        <span class="section-count">{{ provider.models.length }}</span>
        <div class="section-actions">
          <el-button size="small" :icon="Download" @click="openDiscover">{{ t("admin.discoverModels") }}</el-button>
          <el-button size="small" :icon="Plus" @click="openModel(null, null)">{{ t("admin.addModel") }}</el-button>
        </div>
      </div>
      <p v-if="provider.models.length === 0" class="model-empty">{{ t("admin.providerNoModels") }}</p>
      <template v-for="group in groups" :key="group.type">
        <div v-if="group.models.length > 0" class="model-group">
          <p class="group-label">{{ t(`admin.modelGroups.${group.type}`) }} · {{ group.models.length }}</p>
          <ul class="model-rows bordered">
            <li v-for="model in group.models" :key="model.id" class="model-row">
              <span class="model-row-text">
                <span class="model-row-name">
                  {{ modelName(model) }}
                  <el-tag v-if="defaultTag(model)" size="small" type="success" disable-transitions>
                    {{ defaultTag(model) }}
                  </el-tag>
                </span>
                <span class="model-row-id">{{ model.id }}</span>
              </span>
              <span class="model-row-meta">
                <span v-for="item in modelMeta(model)" :key="item">{{ item }}</span>
                <p v-if="checkResults.get(model.id)" :class="['check-result', checkResults.get(model.id)!.ok ? 'ok' : 'failed']" role="status">
                  <CircleCheck v-if="checkResults.get(model.id)!.ok" :size="14" aria-hidden="true" />
                  <CircleX v-else :size="14" aria-hidden="true" />
                  <span>{{ checkResults.get(model.id)!.text }}</span>
                </p>
              </span>
              <span class="model-row-actions">
                <el-button link size="small" :loading="checking === model.id" @click="check(model)">
                  {{ t("admin.check") }}
                </el-button>
                <el-button
                  link
                  type="primary"
                  size="small"
                  @click="openModel(provider.models.indexOf(model), model)"
                >
                  {{ t("common.edit") }}
                </el-button>
                <el-button link type="danger" size="small" @click="removeModel(model)">
                  {{ t("common.delete") }}
                </el-button>
              </span>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <div class="usage-section">
      <h3 class="section-title">{{ t("admin.providerUsage") }}</h3>
      <p v-if="usages.length === 0" class="model-empty">{{ t("admin.providerUnused") }}</p>
      <ul v-else class="usage-rows">
        <li v-for="row in usages" :key="`${row.kind}:${row.name}:${row.ref}`" class="usage-row">
          <span class="usage-where">{{ row.name }}</span>
          <span class="usage-model">{{ refLabel(row.ref) }}</span>
        </li>
      </ul>
    </div>

    <ModelEditDialog
      v-model:visible="editVisible"
      :api="provider.api"
      :model="editing.model"
      :existing="editing.index !== null"
      :taken-ids="takenIds"
      :before-save="beforeSaveModel"
      @save="saveModel"
    />
    <DiscoverDialog
      v-model:visible="discoverVisible"
      :provider-label="provider.name || provider.id"
      :discover="discover"
      :taken-ids="allIds"
      @add="addCandidate"
      @manual="addManually"
    />
  </section>
</template>

<style scoped src="../models.css"></style>
