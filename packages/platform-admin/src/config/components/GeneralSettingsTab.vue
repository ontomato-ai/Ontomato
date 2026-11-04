<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { usePlatformHost } from "../../context";
import { useGeneralDraft } from "../general-settings";

/*
 * The general parameters and the backend language, as rows of the data shell (label and one line of help on the left,
 * the control on the right, a hairline between). The draft and its Save belong to the page: one Save in the page header
 * writes every changed setting, and the tab only edits the draft.
 */
const { t } = useI18n();
const { separators, systemConfig: businessConfig } = usePlatformHost();
// The draft and its Save are the page's: one Save in the page header writes every changed setting.
const { draft, loading, loaded, loadError, load } = useGeneralDraft();
</script>

<template>
  <div class="settings-tab">
    <div v-if="loadError" class="config-load-error" role="alert">
      <span>{{ t("admin.loadConfigFailed") }}{{ separators.detail }}{{ loadError }}</span>
      <el-button size="small" @click="load">{{ t("common.retry") }}</el-button>
    </div>

    <el-skeleton v-if="loading && !loaded" :rows="4" animated />

    <div v-else class="setting-rows">
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
    </div>
  </div>
</template>

<style scoped>
.settings-tab {
  display: flex;
  min-width: 0;
  flex-direction: column;
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

/* Rows of the data shell, the same rules the model page's settings rows use: text left, control right, a hairline. */
.setting-rows {
  display: flex;
  max-width: 880px;
  flex-direction: column;
}

.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
  gap: var(--spacing-lg);
  align-items: start;
  padding: var(--spacing-md) 0;
  border-bottom: 1px solid var(--el-border-color);
}

.setting-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  color: var(--el-text-color-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
}

.setting-hint {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
}

.setting-control {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.setting-control .el-select {
  width: 100%;
}

.setting-control.narrow .el-input-number {
  width: 200px;
}

@media (max-width: 768px) {
  .setting-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
