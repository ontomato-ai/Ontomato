<script setup lang="ts">
import type { PlatformAppPanel } from "./types";
import { resolveIcon } from "./icons";

/**
 * The second column of an application: its name, its own bottom entry (the app's settings) and, in between, whatever
 * the application puts there — a conversation's navigation or a grouped list of pages (DESIGN.md "Applications and
 * shells"). The frame owns the width, the band colour and the scroll area; the contents are the host's.
 */
defineProps<{
  panel: PlatformAppPanel;
  labels: { pages: string };
}>();

const emit = defineEmits<{ openSettings: [id: string] }>();
</script>

<template>
  <div class="app-panel">
    <div class="panel-title">{{ panel.label }}</div>
    <nav class="panel-body" :aria-label="labels.pages">
      <slot />
    </nav>
    <div v-if="panel.settings" class="panel-footer">
      <button type="button" class="settings-row" @click="emit('openSettings', panel.settings!.id)">
        <component :is="resolveIcon(panel.settings.icon)" class="settings-icon" :size="16" aria-hidden="true" />
        <span class="settings-label">{{ panel.settings.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
/*
 * The application panel is the middle band: darker than the workspace and lighter than the rail in light mode, and the
 * reverse in dark mode. No divider is drawn between the bands — only the tone separates them.
 */
.app-panel {
  display: flex;
  flex-direction: column;
  width: var(--shell-list-panel);
  flex-shrink: 0;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: var(--shell-panel-bg);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
}
.panel-title {
  display: flex;
  align-items: center;
  height: var(--page-header-height);
  padding: 0 16px;
  flex-shrink: 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-body {
  flex: 1;
  min-height: 0;
  padding: 0 8px;
  overflow-y: auto;
  overflow-x: hidden;
}
/* The one divider inside a column: it separates the settings entry from the scrolling content above it. */
.panel-footer {
  flex-shrink: 0;
  padding: 8px;
  border-top: 1px solid var(--el-border-color);
}
.settings-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.settings-row:hover {
  background: var(--el-fill-color-light);
}
.settings-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.settings-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.settings-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
