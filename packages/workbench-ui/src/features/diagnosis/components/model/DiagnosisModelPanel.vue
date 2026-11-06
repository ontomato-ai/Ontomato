<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { ScanEye } from "lucide-vue-next";
import type { ModelOptions, ModelSelection } from "@ontomato/contracts/model-settings";
import { diagnosisModelApi } from "../../api/diagnosis-model";
import ModelSelectionSelect from "../../../agents/components/ModelSelectionSelect.vue";

/** The operations agent is built in: its only setting here is its model, saved as soon as it is chosen. */
defineProps<{ modelOptions: ModelOptions | null; modelOptionsFailed: boolean }>();
const emit = defineEmits<{ reloadModelOptions: [] }>();
const { t } = useI18n();

const selection = ref<ModelSelection | null>(null);
const loadFailed = ref(false);
const saving = ref(false);

async function load() {
  loadFailed.value = false;
  try {
    selection.value = await diagnosisModelApi.get();
  } catch {
    loadFailed.value = true;
  }
}
onMounted(load);

// The shown choice is the saved one: a rejected save leaves the previous model selected.
async function choose(modelId: string | null) {
  saving.value = true;
  try {
    selection.value = await diagnosisModelApi.save({ modelId });
    ElMessage.success(t("agents.modelSaved"));
  } catch (error) {
    ElMessage.error(error instanceof Error && error.message ? error.message : t("analysis.updateFailed"));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="diagnosis-model">
    <header class="panel-bar">
      <span class="panel-avatar"><ScanEye :size="18" /></span>
      <div class="panel-title">
        <strong>{{ t("admin.opsAgent") }}</strong>
        <small>{{ t("admin.opsAgentDescription") }}</small>
      </div>
    </header>
    <div class="panel-body">
      <section class="panel-section">
        <h3>{{ t("agents.model") }}</h3>
        <p>{{ t("agents.opsAgentModelHint") }}</p>
        <div v-if="loadFailed" class="model-note" role="alert">
          <span>{{ t("agents.opsAgentModelLoadFailed") }}</span>
          <el-button size="small" link type="primary" @click="load">{{ t("common.retry") }}</el-button>
        </div>
        <el-skeleton v-else-if="!selection" :rows="1" animated />
        <ModelSelectionSelect
          v-else
          :model-value="selection.modelId"
          :options="modelOptions"
          :disabled="saving"
          :aria-label="t('agents.model')"
          @update:model-value="choose"
        />
        <div v-if="modelOptionsFailed" class="model-note" role="alert">
          <span>{{ t("agents.modelOptionsLoadFailed") }}</span>
          <el-button size="small" link type="primary" @click="emit('reloadModelOptions')">{{ t("common.retry") }}</el-button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.diagnosis-model {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.panel-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.panel-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.panel-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.panel-title strong {
  font-size: var(--text-base);
  color: var(--el-text-color-primary);
}
.panel-title small {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
}
.panel-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 24px 40px;
}
.panel-section {
  max-width: 820px;
  margin: 0 auto;
  padding: 22px 0;
}
.panel-section h3 {
  margin: 0 0 4px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.panel-section p {
  margin: 0 0 14px;
  font-size: var(--text-sm);
  color: var(--el-text-color-secondary);
}
.model-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: var(--text-sm);
  color: var(--el-color-warning);
}
</style>
