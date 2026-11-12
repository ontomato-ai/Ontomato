<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { modelLabel, modelSelectionView, selectedModelId } from "@ontomato/contracts/model-selection";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { useAgentModelLabels, type AgentModelEntry, type AgentModelSource } from "./agent-models";
import { useUnsavedChanges } from "./unsaved-changes";
import PlatformPageHeader from "./PlatformPageHeader.vue";

/**
 * An application's "Models" page: which model each of its agents runs on (DESIGN.md "Page architecture"). Every agent
 * follows the domain's default chat model until it is given one of its own, and goes back to the default in one click.
 * The page is one draft saved from its header: each changed choice is stored on its own, and one the service rejects
 * keeps its draft with the reason beside it while the others stay stored. The application injects where the agents and
 * their choices are read and written; the page knows no endpoint and no application.
 */
const props = defineProps<{
  source: AgentModelSource;
  /** The page's address: leaving it with unsaved choices asks first. */
  path: string;
}>();

const labels = useAgentModelLabels();

const agents = shallowRef<AgentModelEntry[] | null>(null);
const models = shallowRef<ModelOptions | null>(null);
const loading = ref(false);
const loadError = ref("");
/** The draft choice of each agent, by its id; the saved one is the entry's. */
const selections = reactive<Record<string, string | null>>({});
/** Why the service rejected an agent's last saved choice, by its id. */
const errors = reactive<Record<string, string>>({});
const saving = ref(false);

function take(list: AgentModelEntry[]) {
  agents.value = list;
  for (const key of Object.keys(selections)) delete selections[key];
  for (const key of Object.keys(errors)) delete errors[key];
  for (const agent of list) selections[agent.id] = agent.modelId;
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await props.source.load();
    models.value = result.models;
    take(result.agents);
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    loading.value = false;
  }
}

const changed = computed(() => agents.value?.filter((agent) => selections[agent.id] !== agent.modelId) ?? []);
const dirty = computed(() => changed.value.length > 0);

async function save() {
  saving.value = true;
  let failed = 0;
  for (const agent of changed.value) {
    try {
      const stored = await props.source.save(agent.id, selections[agent.id] ?? null);
      agents.value = agents.value!.map((entry) => (entry.id === agent.id ? { ...entry, modelId: stored } : entry));
      selections[agent.id] = stored;
      delete errors[agent.id];
    } catch (error) {
      errors[agent.id] = error instanceof Error ? error.message : String(error);
      failed += 1;
    }
  }
  saving.value = false;
  if (failed > 0) ElMessage.error(labels.value.saveFailed);
  else ElMessage.success(labels.value.saved);
}

async function discard() {
  const confirmed = await ElMessageBox.confirm(labels.value.discardMessage, labels.value.discardTitle, {
    type: "warning",
    confirmButtonText: labels.value.discard,
    cancelButtonText: labels.value.cancel,
  }).then(
    () => true,
    () => false,
  );
  if (confirmed) take(agents.value!);
}

useUnsavedChanges({ dirty: () => dirty.value, paths: () => [props.path] });

const draft = computed(() => ({
  dirty: dirty.value,
  saving: saving.value,
  save: () => void save(),
  discard: () => void discard(),
}));

const followDefault = computed(() => {
  const current = models.value?.models.find((model) => model.ref === models.value?.defaultModelId);
  return labels.value.followDefault(current ? modelLabel(current) : null);
});

function view(agent: AgentModelEntry) {
  return modelSelectionView(selections[agent.id] ?? null, models.value?.models ?? null, {
    nullChoice: followDefault.value,
    unavailable: labels.value.unavailable,
  });
}

function name(agent: AgentModelEntry) {
  return agent.kind === null ? agent.name : labels.value.agentName(agent.kind, agent.name);
}

function choose(agent: AgentModelEntry, value: string) {
  selections[agent.id] = selectedModelId(value);
}

onMounted(load);
</script>

<template>
  <div class="agent-models-page">
    <PlatformPageHeader
      :title="labels.title"
      :description="labels.description"
      :draft="agents ? draft : null"
      :labels="{ save: labels.save, discard: labels.discard, unsavedChanges: labels.unsavedChanges }"
      @save="draft.save()"
      @discard="draft.discard()"
    />
    <div class="agent-models-body platform-page-gutter">
      <div v-if="loadError" class="agent-models-error" role="alert">
        <span>{{ labels.loadFailed }}</span>
        <span class="agent-models-reason">{{ loadError }}</span>
        <el-button size="small" @click="load">{{ labels.retry }}</el-button>
      </div>
      <el-skeleton v-else-if="loading && !agents" :rows="3" animated />
      <p v-else-if="agents && agents.length === 0" class="agent-models-empty">{{ labels.empty }}</p>
      <ul v-else-if="agents" class="agent-model-rows">
        <li v-for="agent in agents" :key="agent.id" class="agent-model-row">
          <div class="agent-model-text">
            <span class="agent-model-name">{{ name(agent) }}</span>
            <span v-if="agent.description" class="agent-model-hint">{{ agent.description }}</span>
          </div>
          <div class="agent-model-control">
            <!-- "" is the "follow the default" choice; it is declared a real value instead of an empty one. -->
            <el-select
              :model-value="view(agent).value"
              :empty-values="[null, undefined]"
              :disabled="saving || view(agent).disabled"
              :aria-label="name(agent)"
              filterable
              @update:model-value="choose(agent, $event)"
            >
              <el-option v-for="option in view(agent).options" :key="option.value" v-bind="option" />
            </el-select>
            <p v-if="view(agent).missingId" class="agent-model-note warning" role="alert">
              {{ labels.missing(view(agent).missingId!) }}
            </p>
            <p v-if="errors[agent.id]" class="agent-model-note danger" role="alert">{{ errors[agent.id] }}</p>
          </div>
          <el-button
            class="agent-model-reset"
            link
            size="small"
            :disabled="saving || selections[agent.id] === null"
            @click="selections[agent.id] = null"
          >
            {{ labels.backToDefault }}
          </el-button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/*
 * The page fills its area under its own header; the rows are those of the other settings pages: the agent's name on
 * the left, its model in a select of the settings' standard width, the way back to the default at the end.
 */
.agent-models-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.agent-models-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-block: var(--page-content-gap) var(--spacing-xl);
}
.agent-model-rows {
  display: flex;
  flex-direction: column;
  max-width: 960px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.agent-model-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(0, 360px) auto;
  align-items: start;
  gap: var(--spacing-lg);
  padding-block: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.agent-model-row:first-child {
  padding-top: 0;
}
.agent-model-text {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
  padding-top: 6px;
}
.agent-model-name {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}
.agent-model-hint {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.agent-model-control {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  min-width: 0;
}
.agent-model-control .el-select {
  width: 100%;
}
.agent-model-note {
  margin: 0;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}
.agent-model-note.warning {
  color: var(--el-color-warning);
}
.agent-model-note.danger {
  color: var(--el-color-danger);
}
.agent-model-reset {
  margin-top: 6px;
}
.agent-models-empty {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.agent-models-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
.agent-models-reason {
  color: var(--el-text-color-secondary);
}
@container (max-width: 640px) {
  .agent-model-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .agent-model-control {
    grid-column: 1 / -1;
    grid-row: 2;
  }
}
</style>
