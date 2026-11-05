<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import DiagnosisModelPanel from "./DiagnosisModelPanel.vue";
// The domain's models: the picker shows them, the agent editor is the other reader.
import { loadModelOptions } from "../../../agents/api";

/**
 * The operations agent's model, as the operations application's own page.
 *
 * It used to be reached from the agent platform's list, where the built-in agent sat among the business ones; the model
 * belongs to the diagnosis that uses it, so it lives here and the platform shell's column opens it at its foot.
 */
const modelOptions = ref<ModelOptions | null>(null);
const modelOptionsFailed = ref(false);

async function reloadModelOptions() {
  modelOptionsFailed.value = false;
  try {
    modelOptions.value = await loadModelOptions();
  } catch {
    modelOptionsFailed.value = true;
  }
}

onMounted(reloadModelOptions);
</script>

<template>
  <div class="ops-model">
    <DiagnosisModelPanel
      :model-options="modelOptions"
      :model-options-failed="modelOptionsFailed"
      @reload-model-options="reloadModelOptions"
    />
  </div>
</template>

<style scoped>
.ops-model {
  box-sizing: border-box;
  padding: 12px 16px;
}
</style>
