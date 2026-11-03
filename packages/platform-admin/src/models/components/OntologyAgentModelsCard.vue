<script setup lang="ts">
import type { ModelSelection } from "@ontomato/contracts/model-settings";
import { Bot } from "lucide-vue-next";
import { useI18n } from "vue-i18n";
import { modelLabel, type OntologyAgentSelection } from "../types";
import { usePlatformHost } from "../../context";
import ModelSelectionSelect from "./ModelSelectionSelect.vue";

/*
 * The ontology service's agents (data retrieval, Action creation, each generation, knowledge governance) as the
 * service lists them, each with its own model. A change is saved at once for that agent alone.
 */
const props = defineProps<{
  /** Null until the catalog is first read. */
  agents: OntologyAgentSelection[] | null;
  loading: boolean;
  loadError: string;
  /** The domain's models; null while the model library is not read, when no choice can be offered. */
  models: readonly { name: string; displayName: string }[] | null;
  defaultModelId: string | null;
  /** IDs of the agents whose selection is being saved. */
  saving: ReadonlySet<string>;
}>();

const emit = defineEmits<{
  change: [id: string, selection: ModelSelection];
  retry: [];
}>();

const { t, te } = useI18n();
const { separators } = usePlatformHost();

// The service's catalog decides which agents exist; known kinds get a name in the page language, others keep the
// service's own name.
function agentName(agent: OntologyAgentSelection): string {
  const key = `admin.ontologyAgentKinds.${agent.kind}`;
  return te(key) ? t(key) : agent.name;
}

function followDefaultLabel(): string {
  const current = props.models?.find((model) => model.name === props.defaultModelId);
  return t("admin.followDomainDefault", {
    model: current ? modelLabel(current) : t("admin.noDefaultModel"),
  });
}
</script>

<template>
  <div class="admin-card config-card">
    <div class="card-header">
      <el-icon :size="20"><Bot /></el-icon>
      <span>{{ t("admin.ontologyAgentModels") }}</span>
    </div>
    <div class="card-body">
      <p class="card-hint">{{ t("admin.ontologyAgentModelsHint") }}</p>
      <el-skeleton v-if="props.loading && !props.agents" :rows="3" animated />
      <div v-else-if="props.loadError" class="load-error" role="alert">
        <span>{{ t("admin.ontologyAgentModelsLoadFailed") }}{{ separators.detail }}{{ props.loadError }}</span>
        <el-button size="small" @click="emit('retry')">{{ t("common.retry") }}</el-button>
      </div>
      <ul v-else-if="props.agents" class="agent-model-grid">
        <li v-for="agent in props.agents" :key="agent.id" class="agent-model-cell">
          <span class="agent-model-name">{{ agentName(agent) }}</span>
          <ModelSelectionSelect
            :model-value="agent.modelSelection.modelId"
            :models="props.models"
            :null-label="followDefaultLabel()"
            :disabled="props.saving.has(agent.id)"
            :aria-label="agentName(agent)"
            @update:model-value="emit('change', agent.id, { modelId: $event })"
          />
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped src="../models.css"></style>
