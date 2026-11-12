<script setup lang="ts">
import { onMounted } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { usePageActions, useUnsavedChanges } from "@ontomato/platform-shell";
import { usePlatformHost } from "../context";
import { platformPages } from "../pages";
import { useGeneralSettings } from "../config/general-settings";

/*
 * The general parameters and the backend language, as rows of the data shell (label and one line of help on the left,
 * the control on the right, a hairline between). The screen is one draft saved from the page header: one Save writes
 * every changed setting.
 */
const { t } = useI18n();
const host = usePlatformHost();
const { separators, systemConfig: businessConfig } = host;
const general = useGeneralSettings({ api: host.api, businessConfig, detail: separators.detail });
const { draft, loading, loaded, loadError, load } = general;

async function discard() {
  const confirmed = await ElMessageBox.confirm(t("admin.discardChangesConfirm"), t("admin.discardChanges"), {
    type: "warning",
    confirmButtonText: t("admin.discardChanges"),
    cancelButtonText: t("common.cancel"),
  }).then(
    () => true,
    () => false
  );
  if (confirmed) await load();
}

usePageActions(() => ({
  draft: loaded.value
    ? { dirty: general.dirty.value, saving: general.saving.value, save: () => void general.save(), discard: () => void discard() }
    : null,
}));
useUnsavedChanges({ dirty: () => general.dirty.value, paths: () => [platformPages.general.path] });

onMounted(load);
</script>

<template>
  <div class="settings-page">
    <div v-if="loadError" class="config-load-error" role="alert">
      <span>{{ t("admin.loadConfigFailed") }}{{ separators.detail }}{{ loadError }}</span>
      <el-button size="small" @click="load">{{ t("common.retry") }}</el-button>
    </div>

    <el-skeleton v-if="loading && !loaded" :rows="4" animated />

    <section v-else class="setting-rows" :aria-label="t('admin.generalParamConfig')">
      <div class="setting-row">
        <div class="setting-text">
          <span class="setting-label">{{ t("admin.knowledgeMaxResults") }}</span>
          <span class="setting-hint">{{ t("admin.knowledgeMaxResultsHint") }}</span>
        </div>
        <div class="setting-control narrow">
          <el-input-number
            v-model="draft.knowledgeMaxResult"
            :min="1"
            :step="1"
            controls-position="right"
            :aria-label="t('admin.knowledgeMaxResults')"
          />
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-text">
          <span class="setting-label">{{ t("admin.dslCookerTimeoutSeconds") }}</span>
          <span class="setting-hint">{{ t("admin.dslCookerTimeoutSecondsHint") }}</span>
        </div>
        <div class="setting-control narrow">
          <el-input-number
            v-model="draft.dslCookerTimeoutSeconds"
            :min="1"
            :step="10"
            controls-position="right"
            :aria-label="t('admin.dslCookerTimeoutSeconds')"
          />
        </div>
      </div>

      <div class="setting-row">
        <div class="setting-text">
          <span class="setting-label">{{ t("admin.backendLanguage") }}</span>
          <span class="setting-hint">{{ t("admin.backendLanguageHint") }}</span>
        </div>
        <div class="setting-control narrow">
          <el-select v-model="draft.lang" :aria-label="t('admin.backendLanguage')">
            <el-option
              v-for="option in businessConfig.languageOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
@import "../styles/settings-rows.css";
.settings-page {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding-block: var(--spacing-lg);
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

/* Rows of the data shell, the same rules the model page's settings rows use: text left, control right, a hairline. */
.setting-rows {
  display: flex;
  width: 100%;
  max-width: 960px;
  flex-direction: column;
}

.setting-row {
  grid-template-columns: minmax(0, 1fr) minmax(0, 240px);
  padding-block: var(--spacing-lg);
}

.setting-row:first-child {
  padding-top: 0;
}

.setting-row:last-child {
  border-bottom: 0;
}

.setting-control.narrow .el-input-number {
  width: 100%;
}

@container platform-page (max-width: 680px) {
  .setting-row { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 768px) {
  .setting-row { grid-template-columns: minmax(0, 1fr); }
}
</style>
