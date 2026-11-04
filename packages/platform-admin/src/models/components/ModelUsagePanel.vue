<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { modelLabel } from "@ontomato/contracts/model-selection";
import { usePlatformHost } from "../../context";
import { agentPurpose, specifiedAgents, type AgentPurpose } from "../agents";
import { draftChoices, findModel, useModelDraft } from "../draft";
import type { VectorRebuildState, VectorRebuildStatus } from "../types";
import ModelSelectionSelect from "./ModelSelectionSelect.vue";

/*
 * How the domain's models are used: the chat model every agent follows, the embedding model of vector search with the
 * data engine's rebuild status, and the ontology service agents that depart from the chat default (all of them follow
 * it until one is given a model of its own). The call policy of every request closes the screen.
 */
const props = defineProps<{
  /** The ontology service's agents as last saved; null until read. */
  agents: readonly OntologyAgentModel[] | null;
  /** The draft selection of each agent, by agent ID; null follows the chat default. */
  agentSelections: Readonly<Record<string, string | null>>;
  agentsLoading: boolean;
  agentsLoadError: string;
  rebuildStatus: VectorRebuildStatus | null;
}>();
const emit = defineEmits<{
  agentChange: [id: string, modelId: string | null];
  retryAgents: [];
  rebuild: [];
  pause: [];
}>();
const { t, te } = useI18n();
const { separators } = usePlatformHost();
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

const followDefaultLabel = computed(() => {
  const current = choices.value.find((model) => model.ref === draft.defaultModelId);
  return t("admin.followDomainDefault", { model: current ? modelLabel(current) : t("admin.noDefaultModel") });
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

// ---- The agents that depart from the chat default ----
function agentName(agent: OntologyAgentModel): string {
  const key = `admin.ontologyAgentKinds.${agent.kind}`;
  return te(key) ? t(key) : agent.name;
}

const specified = computed(() => specifiedAgents(props.agents ?? [], props.agentSelections));
const followed = computed(() => (props.agents ?? []).filter((agent) => (props.agentSelections[agent.id] ?? null) === null));
const showAll = ref(false);

/** Whether the list of agents still following the default is open, to give one of them a model. */
const addVisible = ref(false);

function addAgent(agent: OntologyAgentModel) {
  // The agent starts from the chat default; the row's select then points it elsewhere.
  emit("agentChange", agent.id, draft.defaultModelId);
  addVisible.value = false;
}

function purposeTitle(purpose: AgentPurpose) {
  return t(`admin.agentPurposes.${purpose}`);
}

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
        <div class="section-bar">
          <h3 class="section-title">{{ t("admin.ontologyAgentModels") }}</h3>
          <div class="section-actions">
            <el-button v-if="props.agents && (followed.length > 0 || showAll)" link size="small" @click="showAll = !showAll">
              {{ showAll ? t("admin.hideAllAgents") : t("admin.showAllAgents") }}
            </el-button>
            <el-button v-if="props.agents && !showAll" size="small" @click="addVisible = !addVisible">
              {{ t("admin.specifyAgent") }}
            </el-button>
          </div>
        </div>
        <p class="section-hint">{{ t("admin.ontologyAgentModelsHint") }}</p>
        <el-skeleton v-if="props.agentsLoading && !props.agents" :rows="3" animated />
        <div v-else-if="props.agentsLoadError" class="load-error" role="alert">
          <span>{{ t("admin.ontologyAgentModelsLoadFailed") }}{{ separators.detail }}{{ props.agentsLoadError }}</span>
          <el-button size="small" @click="emit('retryAgents')">{{ t("common.retry") }}</el-button>
        </div>
        <template v-else-if="props.agents">
          <!-- The agents given a model of their own, one table row each: purpose, name, model, back to default. -->
          <div v-if="specified.length > 0" class="agent-table">
            <div v-for="group in specified" :key="group.purpose" class="agent-group">
              <div v-for="agent in group.agents" :key="agent.id" class="agent-line">
                <span class="agent-purpose">{{ purposeTitle(group.purpose) }}</span>
                <span class="agent-name">{{ agentName(agent) }}</span>
                <ModelSelectionSelect
                  class="agent-model"
                  :model-value="props.agentSelections[agent.id] ?? null"
                  :models="choices"
                  :null-label="followDefaultLabel"
                  :aria-label="agentName(agent)"
                  @update:model-value="emit('agentChange', agent.id, $event)"
                />
                <el-button class="agent-reset" link size="small" @click="emit('agentChange', agent.id, null)">
                  {{ t("admin.followDefaultAction") }}
                </el-button>
              </div>
            </div>
          </div>
          <p v-else class="empty-note">{{ t("admin.allAgentsFollowDefault") }}</p>

          <!-- Adding one: an agent of a purpose that still follows the default. -->
          <ul v-if="addVisible && !showAll && followed.length > 0" class="agent-picker">
            <li v-for="agent in followed" :key="agent.id">
              <button type="button" class="agent-pick" @click="addAgent(agent)">
                <span class="agent-pick-name">{{ agentName(agent) }}</span>
                <span class="agent-pick-meta">{{ purposeTitle(agentPurpose(agent.kind)) }}</span>
              </button>
            </li>
          </ul>

          <!-- Everything, for reference: the rows above stay the ones with a model of their own. -->
          <div v-if="showAll" class="agent-table">
            <p class="group-label">{{ t("admin.allAgents") }}</p>
            <div v-for="agent in props.agents" :key="agent.id" class="agent-line">
              <span class="agent-purpose">{{ purposeTitle(agentPurpose(agent.kind)) }}</span>
              <span class="agent-name">{{ agentName(agent) }}</span>
              <ModelSelectionSelect
                class="agent-model"
                :model-value="props.agentSelections[agent.id] ?? null"
                :models="choices"
                :null-label="followDefaultLabel"
                :aria-label="agentName(agent)"
                @update:model-value="emit('agentChange', agent.id, $event)"
              />
              <el-button class="agent-reset" link size="small" @click="emit('agentChange', agent.id, null)">
                {{ t("admin.followDefaultAction") }}
              </el-button>
            </div>
          </div>
        </template>
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
