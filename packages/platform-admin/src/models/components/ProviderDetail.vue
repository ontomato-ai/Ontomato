<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { ChevronDown, ChevronRight, CircleCheck, CircleX, Download, Plus, Trash2 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { modelApiSchema, supportsEmbeddings, type ModelEntry } from "@ontomato/contracts/model-settings";
import { modelApiBaseUrls, modelApiLabels } from "../apis";
import type { RuntimeModelDiscoveryResponse } from "@ontomato/contracts/runtime-model-test";
import { usePlatformHost } from "../../context";
import { useModelErrors } from "../errors";
import {
  PI_CHAT_DEFAULTS,
  draftConnection,
  modelName,
  modelRef,
  retargetDefaults,
  useModelDraft,
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
const { t } = useI18n();
const { api } = usePlatformHost();
const describeError = useModelErrors();
const draft = useModelDraft();

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
    t("admin.contextValue", { n: (model.contextWindow ?? PI_CHAT_DEFAULTS.contextWindow).toLocaleString() }),
    ...(model.reasoning ? [t("admin.reasoning")] : []),
    ...(model.input?.includes("image") ? [t("admin.imageInput")] : []),
    ...(model.samplingParams && Object.keys(model.samplingParams).length > 0 ? [t("admin.samplingParams")] : []),
  ];
}

// ---- Check: one minimal call with a model of the unsaved provider ----
const checkModelId = ref<string | null>(null);
watch(
  () => provider.value.models.map((m) => m.id),
  (ids) => {
    if (checkModelId.value === null || !ids.includes(checkModelId.value)) checkModelId.value = ids[0] ?? null;
  },
  { immediate: true }
);
const checking = ref(false);
const checkResult = shallowRef<{ ok: boolean; text: string } | null>(null);
watch(() => props.providerId, () => (checkResult.value = null));

function connectionProblem(): string | null {
  if (!provider.value.baseUrl.trim()) return t("admin.baseUrlRequired");
  if (!provider.value.apiKey.trim()) return t("admin.apiKeyRequired");
  return null;
}

async function check() {
  const model = provider.value.models.find((m) => m.id === checkModelId.value);
  if (!model) return;
  const problem = connectionProblem();
  if (problem) {
    checkResult.value = { ok: false, text: problem };
    return;
  }
  checking.value = true;
  checkResult.value = null;
  try {
    const result = await api.testModel({ ...draftConnection(draft, provider.value), model });
    checkResult.value = {
      ok: true,
      text:
        result.type === "embedding"
          ? t("admin.checkEmbeddingPassed", { n: result.dimensions })
          : t("admin.checkChatPassed", { content: result.content.trim().slice(0, 200) }),
    };
  } catch (e) {
    checkResult.value = { ok: false, text: describeError(e, "admin.checkFailed") };
  } finally {
    checking.value = false;
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

function saveModel(model: ModelEntry) {
  const { index } = editing.value;
  if (index === null) {
    provider.value.models.push(model);
  } else {
    const before = provider.value.models[index]!;
    provider.value.models.splice(index, 1, model);
    const from = modelRef(provider.value.id, before.id);
    const to = modelRef(provider.value.id, model.id);
    if (from !== to) emit("renamed", from, to);
    retargetDefaults(draft, from, to);
  }
}

async function removeModel(model: ModelEntry) {
  const tag = defaultTag(model);
  if (tag) {
    const confirmed = await ElMessageBox.confirm(
      t("admin.removeDefaultModelConfirm", { name: modelName(model) }),
      t("admin.removeModel"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") }
    ).then(
      () => true,
      () => false
    );
    if (!confirmed) return;
  }
  provider.value.models = provider.value.models.filter((m) => m !== model);
  retargetDefaults(draft, null, null);
}

async function removeProvider() {
  const confirmed = await ElMessageBox.confirm(
    t("admin.removeProviderConfirm", { name: provider.value.name || provider.value.id, n: provider.value.models.length }),
    t("admin.removeProvider"),
    { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") }
  ).then(
    () => true,
    () => false
  );
  if (confirmed) emit("removed");
}

// ---- Discovery ----
const discoverVisible = ref(false);
function openDiscover() {
  const problem = connectionProblem();
  if (problem) {
    checkResult.value = { ok: false, text: problem };
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
      <el-form-item :label="t('admin.checkConnection')">
        <div class="check-row">
          <el-select
            v-model="checkModelId"
            :disabled="provider.models.length === 0"
            :placeholder="t('admin.checkNeedsModel')"
            :aria-label="t('admin.checkModel')"
            class="check-model"
          >
            <el-option
              v-for="model in provider.models"
              :key="model.id"
              :value="model.id"
              :label="`${modelName(model)} · ${t(`admin.modelTypes.${model.type}`)}`"
            />
          </el-select>
          <el-button :loading="checking" :disabled="checkModelId === null" @click="check">
            {{ t("admin.check") }}
          </el-button>
        </div>
        <p v-if="checkResult" :class="['check-result', checkResult.ok ? 'ok' : 'failed']" role="status">
          <CircleCheck v-if="checkResult.ok" :size="14" aria-hidden="true" />
          <CircleX v-else :size="14" aria-hidden="true" />
          <span>{{ checkResult.text }}</span>
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
              </span>
              <span class="model-row-actions">
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

    <ModelEditDialog
      v-model:visible="editVisible"
      :api="provider.api"
      :model="editing.model"
      :existing="editing.index !== null"
      :taken-ids="takenIds"
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
