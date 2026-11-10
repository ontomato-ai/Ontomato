<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Lock, RefreshCw, Upload } from "lucide-vue-next";
import { PANEL_TABS, shortCommit, type PanelTab } from "../panel";

/**
 * The workspace page's header row, beside the shell's expand and close buttons: the four views, the open view's own tools
 * as icons, then publishing. The tools' explanations (the commit the preview runs, that files are read only) are in their
 * tooltips, and publishing keeps only its icon on a narrow page, so the row keeps room for the views and the shell's
 * buttons at the side panel's width.
 */
defineProps<{ tab: PanelTab; headCommit: string | null }>();
const emit = defineEmits<{ "update:tab": [tab: PanelTab]; refreshPreview: []; publish: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="panel-header">
    <div class="panel-tabs" role="tablist" :aria-label="t('appBuilder.panel')">
      <button
        v-for="item in PANEL_TABS"
        :key="item.id"
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ active: item.id === tab }"
        :aria-selected="item.id === tab"
        @click="emit('update:tab', item.id)"
      >
        <component :is="item.icon" :size="14" aria-hidden="true" />
        <span>{{ t(item.label) }}</span>
      </button>
    </div>
    <div class="panel-tools">
      <el-tooltip v-if="tab === 'preview'" placement="bottom-end" :show-after="200">
        <template #content>
          <div>{{ t("appBuilder.refreshPreview") }}</div>
          <div v-if="headCommit" class="tip-detail">{{ t("appBuilder.currentFiles") }} · {{ shortCommit(headCommit) }}</div>
          <div class="tip-detail">{{ t("appBuilder.previewHint") }}</div>
        </template>
        <button type="button" class="tool-button" :aria-label="t('appBuilder.refreshPreview')" @click="emit('refreshPreview')">
          <RefreshCw :size="14" />
        </button>
      </el-tooltip>
      <el-tooltip v-else-if="tab === 'files'" :content="t('appBuilder.readOnly')" placement="bottom-end" :show-after="200">
        <span class="tool-icon" tabindex="0" :aria-label="t('appBuilder.readOnly')"><Lock :size="14" /></span>
      </el-tooltip>
      <el-button
        type="primary"
        size="small"
        class="publish"
        :title="t('appBuilder.publish')"
        :aria-label="t('appBuilder.publish')"
        @click="emit('publish')"
      >
        <Upload :size="14" aria-hidden="true" /><span class="publish-label">{{ t("appBuilder.publish") }}</span>
      </el-button>
      <span class="tool-separator" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
/* Tabs run the header's full height, so the current tab's underline meets the line under the header. */
.panel-header {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: stretch;
  gap: var(--spacing-md);
}
/* The views keep their width; the tools' text gives way first, and narrow pages drop the icons and the text. */
.panel-tabs {
  display: flex;
  flex-shrink: 0;
  align-items: stretch;
  gap: var(--spacing-lg);
}
.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  margin-bottom: -1px;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
}
.panel-tab:hover {
  color: var(--el-text-color-primary);
}
.panel-tab.active {
  border-bottom-color: var(--el-color-primary);
  color: var(--brand-link);
  font-weight: var(--font-medium);
}
.panel-tab:focus-visible,
.tool-button:focus-visible,
.tool-icon:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.panel-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
  color: var(--el-text-color-secondary);
}
.tip-detail {
  max-width: 280px;
  margin-top: 2px;
  opacity: 0.8;
}
.tool-icon {
  display: grid;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  border-radius: var(--radius-sm);
  color: var(--el-text-color-placeholder);
  cursor: help;
}
.tool-button {
  display: grid;
  place-items: center;
  width: var(--control-height-sm);
  height: var(--control-height-sm);
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.tool-button:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.tool-separator {
  width: 1px;
  height: 16px;
  margin-left: 4px;
  flex-shrink: 0;
  background: var(--el-border-color);
}
.publish {
  margin-left: 4px;
}
.publish-label {
  margin-left: 4px;
}
@container page (max-width: 520px) {
  .panel-tab > svg,
  .publish-label {
    display: none;
  }
}
</style>
