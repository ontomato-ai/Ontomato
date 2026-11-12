<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { modelLabel } from "@ontomato/contracts/model-selection";
import { draftChoices, findModel, useModelDraft } from "../draft";
import type { VectorRebuildState, VectorRebuildStatus } from "../types";
import ModelSelectionSelect from "./ModelSelectionSelect.vue";

/*
 * How the domain's models are used: the chat model every agent follows until it is given one of its own (in its
 * application's model page), and the embedding model of vector search with the data engine's rebuild status. The call
 * policy of every request closes the page.
 */
const props = defineProps<{ rebuildStatus: VectorRebuildStatus | null }>();
const emit = defineEmits<{ rebuild: []; pause: [] }>();
const { t } = useI18n();
const draft = useModelDraft();

const choices = computed(() => draftChoices(draft));

// ---- The chat default and the vector model ----
const embeddingOptions = computed(() => {
  const options = choices.value
    .filter((choice) => choice.type === "embedding")
    .map((choice) => {
      const model = findModel(draft, choice.ref);
      const dimensions = model?.type === "embedding" ? model.dimensions : 0;
      return {
        value: choice.ref,
        label: `${modelLabel(choice)} · ${t("admin.dimensionsValue", { n: dimensions })}`,
        disabled: false,
      };
    });
  const current = draft.embeddingModelId;
  return current && !options.some((o) => o.value === current)
    ? [...options, { value: current, label: t("admin.modelUnavailable", { id: current }), disabled: true }]
    : options;
});
const embeddingValue = computed({
  get: () => draft.embeddingModelId ?? "",
  set: (value: string) => (draft.embeddingModelId = value === "" ? null : value),
});

// The reported state is the data engine's judgement; the page only picks the action and the message.
const rebuildState = computed(() => props.rebuildStatus?.state ?? null);
const running = computed(() => rebuildState.value === "RUNNING" || rebuildState.value === "PAUSING");
const resumable = computed(
  () => rebuildState.value === "PAUSED" || rebuildState.value === "FAILED" || rebuildState.value === "INTERRUPTED"
);
type AlertType = "info" | "warning" | "error";
const stateAlerts: Record<Exclude<VectorRebuildState, "READY" | "FAILED" | null>, { type: AlertType; key: string }> = {
  PENDING: { type: "warning", key: "admin.vectorRebuildNeeded" },
  RUNNING: { type: "info", key: "admin.vectorRebuildRunning" },
  PAUSING: { type: "info", key: "admin.vectorRebuildPausing" },
  PAUSED: { type: "warning", key: "admin.vectorRebuildPaused" },
  INTERRUPTED: { type: "warning", key: "admin.vectorRebuildInterrupted" },
};
/**
 * What the rebuild has to say: nothing until an embedding model is chosen (the select already says "not set"), and
 * nothing while the vectors are simply ready except the line that offers a rebuild.
 */
const rebuildAlert = computed((): { type: AlertType; title: string } | null => {
  const status = props.rebuildStatus;
  if (!status || !status.configured || status.state === "READY") return null;
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
const rebuildLabel = computed(() =>
  !props.rebuildStatus?.configured || rebuildState.value === null ? "" : t(`admin.vectorRebuildStates.${rebuildState.value}`)
);
const embeddingDimensions = computed(() => {
  const model = findModel(draft, draft.embeddingModelId);
  return model?.type === "embedding" ? model.dimensions : null;
});

// ---- Call policy of every request in this domain ----
function secondsField(field: "timeoutMs" | "maxRetryDelayMs") {
  return computed({
    get: () => draft.retry.provider[field] / 1000,
    set: (value: number | null | undefined) => {
      draft.retry.provider[field] = Math.round((value ?? 0) * 1000);
    },
  });
}
const timeoutSeconds = secondsField("timeoutMs");
</script>

<template>
  <div class="tab-content">
    <div class="usage-panel">
      <section class="settings-section">
        <h3 class="section-title">{{ t("admin.domainDefaults") }}</h3>
        <div class="setting-row">
          <div class="setting-text">
            <span class="setting-label">{{ t("admin.domainDefaultModel") }}</span>
            <span class="setting-hint">{{ t("admin.domainDefaultModelHint") }}</span>
          </div>
          <div class="setting-control">
            <ModelSelectionSelect
              v-model="draft.defaultModelId"
              :models="choices"
              :null-label="t('admin.noDefaultModel')"
              :aria-label="t('admin.domainDefaultModel')"
            />
            <p v-if="draft.defaultModelId === null" class="field-hint warning">{{ t("admin.defaultModelUnset") }}</p>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-text">
            <span class="setting-label">{{ t("admin.embeddingModel") }}</span>
            <span class="setting-hint">{{ t("admin.embeddingModelHint") }}</span>
          </div>
          <div class="setting-control">
            <!-- "" is the "not set" choice; it is declared a real value instead of an empty one. -->
            <el-select
              v-model="embeddingValue"
              :empty-values="[null, undefined]"
              filterable
              :aria-label="t('admin.embeddingModel')"
            >
              <el-option value="" :label="t('admin.noEmbeddingModel')" />
              <el-option v-for="option in embeddingOptions" :key="option.value" v-bind="option" />
            </el-select>
            <p v-if="embeddingDimensions !== null" class="field-hint">{{ t("admin.embeddingRebuildHint") }}</p>
            <div v-if="rebuildAlert || rebuildState" class="rebuild-status">
              <el-alert v-if="rebuildAlert" :type="rebuildAlert.type" :title="rebuildAlert.title" :closable="false" show-icon />
              <div class="rebuild-actions">
                <span v-if="rebuildLabel" class="rebuild-state">{{ rebuildLabel }}</span>
                <el-button v-if="running" size="small" :disabled="rebuildState === 'PAUSING'" @click="emit('pause')">
                  {{ t("admin.pauseVectorRebuild") }}
                </el-button>
                <el-button v-else-if="resumable" size="small" @click="emit('rebuild')">
                  {{ t("admin.resumeVectorRebuild") }}
                </el-button>
                <el-button v-else-if="rebuildState === 'PENDING'" size="small" @click="emit('rebuild')">
                  {{ t("admin.rebuildVectors") }}
                </el-button>
                <el-button v-else-if="rebuildState === 'READY'" size="small" @click="emit('rebuild')">
                  {{ t("admin.rebuildVectors") }}
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h3 class="section-title">{{ t("admin.callPolicy") }}</h3>
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
      </section>
    </div>
  </div>
</template>

<style scoped src="../models.css"></style>
