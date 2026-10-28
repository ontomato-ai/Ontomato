<script setup lang="ts">
import { isMaskedSecret, parseIsoDurationSeconds } from "@ontomato/contracts/model-settings";
import { computed, reactive, ref } from "vue";
import { BarChart3 } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import {
  formatTimeout,
  type EmbeddingModelConfig,
  type SaveAction,
  type VectorRebuildState,
  type VectorRebuildStatus,
} from "../../types";
import { workbenchContent } from "../../../../content";

const { t } = useI18n();
const { businessConfigSeparator } = workbenchContent().text;

const props = defineProps<{
  /** The saved Embedding model, or null when none is configured. */
  model: EmbeddingModelConfig | null;
  loading: boolean;
  saving: boolean;
  loadError: string;
  save: SaveAction<EmbeddingModelConfig>;
  /** This domain's vector rebuild status, or null until it is first read. */
  rebuildStatus: VectorRebuildStatus | null;
}>();

const emit = defineEmits<{
  /** Test this config: the saved one from the row, or the dialog draft before saving. */
  test: [model: EmbeddingModelConfig];
  retry: [];
  /** Start a new round or resume the current one: the backend decides which. */
  rebuild: [];
  pause: [];
}>();

// While loading or after a failed load, no model row is rendered and test/edit are not allowed.
const writable = computed(() => !props.loading && !props.loadError);

// The reported state is the backend's judgement; the page does not compare configs. It only picks the action and message.
const rebuildState = computed(() => props.rebuildStatus?.state ?? null);
const running = computed(() => rebuildState.value === "RUNNING" || rebuildState.value === "PAUSING");
const resumable = computed(
  () => rebuildState.value === "PAUSED" || rebuildState.value === "FAILED" || rebuildState.value === "INTERRUPTED"
);

type AlertType = "info" | "warning" | "error";
const stateAlerts: Record<Exclude<VectorRebuildState, "READY" | "FAILED">, { type: AlertType; key: string }> = {
  PENDING: { type: "warning", key: "admin.vectorRebuildNeeded" },
  RUNNING: { type: "info", key: "admin.vectorRebuildRunning" },
  PAUSING: { type: "info", key: "admin.vectorRebuildPausing" },
  PAUSED: { type: "warning", key: "admin.vectorRebuildPaused" },
  INTERRUPTED: { type: "warning", key: "admin.vectorRebuildInterrupted" },
};

const rebuildAlert = computed((): { type: AlertType; title: string } | null => {
  const status = props.rebuildStatus;
  if (!status || status.state === "READY") return null;
  const progress = { done: status.done, total: status.total };
  if (status.state === "FAILED") {
    const { phase, itemType, itemId, reason } = status.error;
    const type = itemType === null ? "" : t(`admin.vectorRebuildType.${itemType}`);
    const step = t(`admin.vectorRebuildStep.${phase}`, { type, id: itemId ?? "" });
    return { type: "error", title: t("admin.vectorRebuildFailed", { ...progress, step, reason }) };
  }
  const alert = stateAlerts[status.state];
  return { type: alert.type, title: t(alert.key, progress) };
});

const dialogVisible = ref(false);

function emptyDraft() {
  // A new entry has no dimensions until the user fills them in: their default for new domains is owned by the backend.
  return { baseUrl: "", apiKey: "", modelName: "", timeoutSeconds: 300, dimensions: null as number | null };
}

const draft = reactive(emptyDraft());
// The saved key is write-only: its mask is the input's placeholder, and an empty input sends the mask back, which keeps it.
const savedKeyMask = ref("");

function openEditDialog() {
  if (!writable.value || props.saving) return;
  const current = props.model;
  Object.assign(
    draft,
    current
      ? {
          baseUrl: current.baseUrl,
          apiKey: isMaskedSecret(current.apiKey) ? "" : current.apiKey,
          modelName: current.modelName,
          timeoutSeconds: parseIsoDurationSeconds(current.timeout),
          dimensions: current.dimensions,
        }
      : emptyDraft()
  );
  savedKeyMask.value = current && isMaskedSecret(current.apiKey) ? current.apiKey : "";
  dialogVisible.value = true;
}

// Complete snapshot: only the fields in the dialog are overwritten; fields from GET that are not shown (such as customHeaders) are kept as-is.
// Dimensions are non-null here: save and test stay disabled while the dimensions input is empty.
function draftModel(): EmbeddingModelConfig {
  return {
    ...props.model,
    baseUrl: draft.baseUrl,
    apiKey: draft.apiKey || savedKeyMask.value,
    modelName: draft.modelName,
    timeout: formatTimeout(draft.timeoutSeconds),
    dimensions: draft.dimensions!,
  };
}

async function saveDialog() {
  const saved = await props.save(draftModel());
  if (saved) dialogVisible.value = false;
}
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><BarChart3 /></el-icon>
      <span>{{ t("admin.embeddingModelConfig") }}</span>
    </div>
    <div class="card-body">
      <el-skeleton v-if="props.loading" :rows="2" animated />
      <div v-else-if="props.loadError" class="load-error" role="alert">
        <span>{{ t("admin.modelListLoadFailed") }}{{ businessConfigSeparator }}{{ props.loadError }}</span>
        <el-button size="small" @click="emit('retry')">{{ t("common.retry") }}</el-button>
      </div>
      <template v-else>
        <div v-if="!props.model" class="card-empty-row">
          <p class="card-empty">{{ t("admin.modelListEmpty") }}</p>
          <el-button type="primary" size="small" @click="openEditDialog">{{ t("admin.addModel") }}</el-button>
        </div>
        <ul v-else class="model-list">
          <li class="model-item">
            <div class="model-info">
              <span class="model-name">{{ props.model.modelName }}</span>
              <div class="model-meta">
                <el-tooltip :content="props.model.baseUrl" placement="top" :disabled="!props.model.baseUrl">
                  <span class="model-url">{{ props.model.baseUrl }}</span>
                </el-tooltip>
                <span class="model-keys">
                  {{ props.model.apiKey ? t("admin.keyCountConfigured", { n: 1 }) : t("admin.keyMissing") }}
                </span>
                <span class="model-keys">
                  {{ t("common.timeoutSec") }}{{ businessConfigSeparator }}{{ parseIsoDurationSeconds(props.model.timeout) }}
                </span>
                <span class="model-keys">
                  {{ t("admin.embeddingDimensions") }}{{ businessConfigSeparator }}{{ props.model.dimensions }}
                </span>
              </div>
            </div>
            <div class="model-actions">
              <el-button link type="primary" :disabled="props.saving" @click="emit('test', props.model)">
                {{ t("common.testModel") }}
              </el-button>
              <el-button link type="primary" :disabled="props.saving" @click="openEditDialog">
                {{ t("common.edit") }}
              </el-button>
              <el-button
                v-if="running"
                link
                type="primary"
                :disabled="rebuildState === 'PAUSING'"
                @click="emit('pause')"
              >
                {{ t("admin.pauseVectorRebuild") }}
              </el-button>
              <el-button v-else-if="resumable" link type="primary" @click="emit('rebuild')">
                {{ t("admin.resumeVectorRebuild") }}
              </el-button>
              <el-button v-else link type="primary" :disabled="rebuildState !== 'PENDING'" @click="emit('rebuild')">
                {{ t("admin.rebuildVectors") }}
              </el-button>
            </div>
          </li>
        </ul>
        <div v-if="rebuildAlert" class="vector-rebuild-status">
          <el-alert :type="rebuildAlert.type" :title="rebuildAlert.title" :closable="false" show-icon />
        </div>
      </template>

      <el-dialog
        v-model="dialogVisible"
        :title="t('admin.embeddingModelConfig')"
        width="min(720px, calc(100vw - 32px))"
        class="model-dialog"
        destroy-on-close
      >
        <el-form class="model-editor-form" label-width="140px" label-position="left" size="default">
          <el-form-item label="Base URL">
            <el-input
              v-model="draft.baseUrl"
              placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            />
          </el-form-item>
          <el-form-item label="API Key">
            <div class="api-keys-wrap">
              <el-input
                v-model="draft.apiKey"
                type="password"
                :placeholder="savedKeyMask || 'sk-...'"
                show-password
              />
              <p v-if="savedKeyMask" class="saved-key-hint">{{ t("admin.savedKeyHint") }}</p>
            </div>
          </el-form-item>
          <el-form-item :label="t('admin.modelName')">
            <el-input v-model="draft.modelName" placeholder="text-embedding-v3" />
          </el-form-item>
          <el-form-item :label="t('admin.timeoutSec')">
            <el-input-number
              v-model="draft.timeoutSeconds"
              :min="1"
              :step="10"
              controls-position="right"
            />
          </el-form-item>
          <el-form-item :label="t('admin.embeddingDimensions')">
            <el-input-number
              v-model="draft.dimensions"
              :min="1"
              :precision="0"
              controls-position="right"
            />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">{{ t("common.cancel") }}</el-button>
          <el-button :disabled="draft.dimensions === null" @click="emit('test', draftModel())">
            {{ t("common.testModel") }}
          </el-button>
          <el-button
            type="primary"
            :loading="props.saving"
            :disabled="draft.dimensions === null"
            @click="saveDialog"
          >
            {{ t("common.save") }}
          </el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped src="./business-config.css"></style>
