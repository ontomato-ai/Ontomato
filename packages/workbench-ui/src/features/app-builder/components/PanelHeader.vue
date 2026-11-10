<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { TooltipInstance } from "element-plus";
import { BadgeCheck, Lock, RefreshCw, Upload } from "lucide-vue-next";
import { PANEL_TABS, shortCommit, type PanelTab } from "../panel";

/**
 * The workspace page's header row, beside the shell's expand and close buttons: the four views, the open view's own tools
 * as icons, then publishing — that the application is published, while it is, and the way to publish. Both open the
 * publication drawer. The tools' explanations (the commit the preview runs, that files are read only, which application
 * is published) are in their tooltips.
 *
 * The row fits the side panel down to its narrowest width: the tools drop their text first, then the views their icons,
 * and the narrowest shows the views as icons. Where a language's names are still too long, they are shortened rather
 * than pushing the tools out.
 */
defineProps<{
  tab: PanelTab;
  headCommit: string | null;
  /** The published application's name, while the workspace's application is published. */
  published: string | null;
}>();
const emit = defineEmits<{ "update:tab": [tab: PanelTab]; refreshPreview: []; publish: [] }>();
const { t } = useI18n();

const publishedTip = ref<TooltipInstance | null>(null);
/** The drawer opens where the mark's tooltip floats: the tooltip goes with the click, and one about to show stays away. */
function openFromMark() {
  publishedTip.value!.onClose(undefined, 0);
  emit("publish");
}
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
        :title="t(item.label)"
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
      <el-tooltip
        v-if="published"
        ref="publishedTip"
        :content="t('appBuilder.publishedAs', { name: published })"
        placement="bottom-end"
        :show-after="200"
      >
        <button type="button" class="published" :aria-label="t('appBuilder.publishedAs', { name: published })" @click="openFromMark">
          <BadgeCheck :size="14" aria-hidden="true" /><span class="published-label">{{ t("appBuilder.publishedBadge") }}</span>
        </button>
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
/* The views give way last: only a language whose names do not fit even then shortens them. */
.panel-tabs {
  display: flex;
  min-width: 0;
  align-items: stretch;
  gap: var(--spacing-lg);
}
.panel-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
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
.panel-tab > svg {
  flex-shrink: 0;
}
.panel-tab > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
.tool-icon:focus-visible,
.published:focus-visible {
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
.published {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: var(--control-height-sm);
  flex-shrink: 0;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  white-space: nowrap;
  cursor: pointer;
}
.published:hover {
  background: var(--el-color-success-light-8);
}
.publish {
  margin-left: 4px;
}
.publish-label {
  margin-left: 4px;
}
/* Published says it with its icon alone in the side panel; its name is in the tooltip at every width. */
@container page (max-width: 760px) {
  .published {
    justify-content: center;
    width: var(--control-height-sm);
    padding: 0;
  }
  .published-label {
    display: none;
  }
}
@container page (max-width: 600px) {
  .panel-tab > svg,
  .publish-label {
    display: none;
  }
}
/*
 * The narrowest pages (the side panel at its narrowest, a phone) show the views as icons, closer together; their names
 * stay for the tooltip and for assistive technology.
 */
@container page (max-width: 440px) {
  .panel-header,
  .panel-tabs {
    gap: var(--spacing-sm);
  }
  .tool-separator {
    display: none;
  }
  .panel-tab > svg {
    display: block;
  }
  .panel-tab > span {
    position: absolute;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
