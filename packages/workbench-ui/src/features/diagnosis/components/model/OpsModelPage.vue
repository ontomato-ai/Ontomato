<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { AgentModelsPage, type AgentModelSource } from "@ontomato/platform-shell";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { DIAGNOSIS_AGENT_ID } from "@ontomato/contracts/ops-diagnosis";
import { diagnosisModelApi } from "../../api/diagnosis-model";
// The domain's models: the picker shows them, the agent editor is the other reader.
import { loadModelOptions } from "../../../agents/api";

/**
 * The operations agent's model, as the operations application's own page at the foot of its column: the platform's model
 * page over the diagnosis model's own endpoint and permission (`analysis-agent`), which are not the ontology service
 * agents'. The built-in agent has no other setting.
 */
const { t } = useI18n();

const source: AgentModelSource = {
  async load() {
    const [selection, models] = await Promise.all([diagnosisModelApi.get(), loadModelOptions()]);
    return {
      agents: [
        {
          id: DIAGNOSIS_AGENT_ID,
          kind: null,
          name: t("admin.opsAgent"),
          description: t("admin.opsAgentDescription"),
          modelId: selection.modelId,
        },
      ],
      models,
    };
  },
  async save(_id, modelId) {
    return (await diagnosisModelApi.save({ modelId })).modelId;
  },
};
</script>

<template>
  <AgentModelsPage :source="source" :path="platformRoutes.opsModel.path" />
</template>
