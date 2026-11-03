<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { adminApi } from "../../admin";
import QuerySettingsCard from "./business-config/QuerySettingsCard.vue";
import type { QuerySettings } from "../types";

/*
 * The workbench part of the system configuration: the query settings kept in the Node system model file. The ontology
 * service's general parameters, backend language and data adapter are configured in the Ontology Manager, and models
 * have their own page.
 */
const { t } = useI18n();

const querySettingsRef = ref<{ markSaved: () => void } | null>(null);
let querySettings = reactive<QuerySettings>({
  queryTimeoutSeconds: 600,
});
const loadingQuerySettings = ref(false);
const querySettingsLoadError = ref("");
const savingQuerySettings = ref(false);

function applyQuerySettings(data: QuerySettings) {
  querySettings.queryTimeoutSeconds = data.queryTimeoutSeconds;
}

async function loadQuerySettings() {
  loadingQuerySettings.value = true;
  querySettingsLoadError.value = "";
  try {
    const res = await adminApi.getSystemModelConfig();
    if (res.success) {
      applyQuerySettings(res.data as QuerySettings);
    } else {
      querySettingsLoadError.value = res.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    querySettingsLoadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loadingQuerySettings.value = false;
  }
}

async function saveQuerySettings() {
  savingQuerySettings.value = true;
  try {
    const res = await adminApi.saveSystemModelConfig({ ...querySettings });
    if (res.success) {
      applyQuerySettings(res.data as QuerySettings);
      querySettingsRef.value?.markSaved();
      ElMessage.success(t("admin.configSaveSuccess"));
    } else {
      ElMessage.error(res.message || t("admin.saveFailed"));
    }
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    savingQuerySettings.value = false;
  }
}

onMounted(() => {
  loadQuerySettings();
});
</script>

<template>
  <div class="system-config-container">
    <QuerySettingsCard
      ref="querySettingsRef"
      v-model:model="querySettings"
      :loading="loadingQuerySettings"
      :saving="savingQuerySettings"
      :load-error="querySettingsLoadError"
      @save="saveQuerySettings"
      @retry="loadQuerySettings"
    />
  </div>
</template>

<style scoped src="./business-config/business-config.css"></style>

<style scoped>
.system-config-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  min-width: 0;
}
</style>
