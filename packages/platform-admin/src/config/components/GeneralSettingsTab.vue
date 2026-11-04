<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import GeneralConfigCard from "./GeneralConfigCard.vue";
import type { BusinessConfig, GeneralConfigKey, SystemSettings } from "../types";
import { usePlatformHost } from "../../context";

/*
 * The general parameters and the backend language of the ontology service. Each field saves on its own request, as it
 * always has (the data engine replaces one setting at a time); the embedded model settings have their own page.
 */
const { t } = useI18n();
const { api, separators, systemConfig: businessConfig } = usePlatformHost();

const loading = ref(false);
const loadError = ref("");
const config = reactive<SystemSettings>({
  knowledgeMaxResult: 10,
  dslCookerTimeout: 300000,
  lang: businessConfig.defaultLanguage,
  dataAdapter: "",
  dataAdapterConnections: {},
});

async function loadConfig() {
  loading.value = true;
  loadError.value = "";
  try {
    const res = await api.getBusinessConfig();
    if (res?.success) {
      const data = res.data as BusinessConfig;
      config.knowledgeMaxResult = data.knowledgeMaxResult ?? 10;
      config.dslCookerTimeout = data.dslCookerTimeout ?? 300000;
      // Only languages this edition ships are selectable; any other stored value shows the default until saved explicitly.
      config.lang = businessConfig.languageOptions.some(({ value }) => value === data.lang)
        ? data.lang
        : businessConfig.defaultLanguage;
      config.dataAdapter = data.dataAdapter;
      config.dataAdapterConnections = data.dataAdapterConnections;
    } else {
      loadError.value = res?.message || t("admin.loadConfigFailed");
    }
  } catch (e: any) {
    loadError.value = e.message || t("admin.loadConfigFailed");
  } finally {
    loading.value = false;
  }
}

const saving: Record<string, boolean> = reactive({
  knowledgeMaxResult: false,
  dslCookerTimeout: false,
  lang: false,
});

async function saveField(key: GeneralConfigKey) {
  saving[key] = true;
  try {
    const res = await api.saveGeneralConfig(key, config[key]);
    if (res?.success) ElMessage.success(t("admin.configSaveSuccess"));
    else ElMessage.error(res?.message || t("admin.saveFailed"));
  } catch (e: any) {
    ElMessage.error(e.message || t("admin.saveFailed"));
  } finally {
    saving[key] = false;
  }
}

onMounted(loadConfig);
</script>

<template>
  <div class="settings-tab">
    <div v-if="loadError" class="config-load-error" role="alert">
      <span>{{ t("admin.loadConfigFailed") }}{{ separators.detail }}{{ loadError }}</span>
      <el-button size="small" @click="loadConfig">{{ t("common.retry") }}</el-button>
    </div>

    <GeneralConfigCard
      v-model:config="config"
      :saving="saving"
      :language-options="businessConfig.languageOptions"
      :default-language="businessConfig.defaultLanguage"
      :disabled="loading || !!loadError"
      @save="saveField"
    />
  </div>
</template>

<style scoped>
.settings-tab {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg);
}

.config-load-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-md);
  padding: var(--spacing-md);
  border: 1px solid var(--el-color-danger-light-5);
  border-radius: var(--radius-md);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
