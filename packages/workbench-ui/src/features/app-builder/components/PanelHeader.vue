<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { RefreshCw } from "lucide-vue-next";
import { PANEL_TABS, shortCommit, type PanelTab } from "../panel";

/**
 * The workspace page's header row, beside the shell's expand and close buttons: the four views, then the open view's
 * own tools (the preview's current commit and refresh).
 */
defineProps<{ tab: PanelTab; headCommit: string | null }>();
const emit = defineEmits<{ "update:tab": [tab: PanelTab]; refreshPreview: [] }>();
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
      <template v-if="tab === 'preview'">
        <span class="tool-text" :title="t('appBuilder.previewHint')">
          {{ t("appBuilder.currentFiles") }}<template v-if="headCommit"> · <span class="mono">{{ shortCommit(headCommit) }}</span></template>
        </span>
        <button
          type="button"
          class="tool-button"
          :title="t('appBuilder.refreshPreview')"
          :aria-label="t('appBuilder.refreshPreview')"
          @click="emit('refreshPreview')"
        >
          <RefreshCw :size="14" />
        </button>
      </template>
      <span v-else-if="tab === 'files'" class="tool-text">{{ t("appBuilder.readOnly") }}</span>
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
.tool-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.panel-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.tool-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--font-mono);
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
@container page (max-width: 520px) {
  .panel-tab > svg,
  .tool-text {
    display: none;
  }
}
</style>
