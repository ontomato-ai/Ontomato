<script setup lang="ts">
import type { PlatformPageActions } from "./types";

/**
 * The 48px page header the platform draws above a page that does not draw its own: the title, one line of description,
 * and the actions a page hands to the header (the one Save of a page holding a draft).
 *
 * A page's own header stays its own: pages that draw one (the ontology graph, the model settings, the conversation) are
 * left alone, which is why the declaration says so per page.
 */
withDefaults(
  defineProps<{
    /** The page's title; absent on a header that carries only its tabs (a page that draws its own title below). */
    title?: string;
    description?: string | null;
    /**
     * The pages of an application that holds several, in its own order: the header switches between them, so an
     * application with two screens is one header with two tabs rather than a second navigation band.
     */
    tabs?: readonly { path: string; label: string }[];
    /** The address the tabs mark as current. */
    activePath?: string;
    actions?: PlatformPageActions | null;
    /** The header's own words, from the host's i18n. */
    labels: { save: string; discard: string; unsavedChanges: string };
  }>(),
  { title: "", description: null, tabs: undefined, activePath: undefined, actions: null },
);

const emit = defineEmits<{ save: []; discard: []; selectTab: [path: string] }>();
</script>

<template>
  <header class="platform-page-header" :class="{ 'has-tabs': tabs && tabs.length > 0 }">
    <div v-if="title || description || actions" class="header-row">
      <h1 v-if="title" class="page-title">{{ title }}</h1>
      <p v-if="description" class="page-description">{{ description }}</p>
      <div v-if="actions" class="page-actions">
        <span v-if="actions.dirty" class="unsaved" role="status">{{ labels.unsavedChanges }}</span>
        <button type="button" class="action secondary" :disabled="!actions.dirty || actions.saving" @click="emit('discard')">
          {{ labels.discard }}
        </button>
        <button type="button" class="action primary" :disabled="!actions.dirty || actions.saving" @click="emit('save')">
          {{ labels.save }}
        </button>
      </div>
    </div>
    <!-- The pages of one application, switched in its header: a tab is the page's own address. -->
    <div v-if="tabs && tabs.length > 0" class="page-tabs" role="tablist" :aria-label="title">
      <button
        v-for="tab in tabs"
        :key="tab.path"
        type="button"
        role="tab"
        class="page-tab"
        :class="{ active: tab.path === activePath }"
        :aria-selected="tab.path === activePath"
        @click="emit('selectTab', tab.path)"
      >
        {{ tab.label }}
      </button>
    </div>
  </header>
</template>

<style scoped>
/* 48px: the platform's one page-header height (DESIGN.md "Admin page anatomy"); with tabs it also carries their row. */
.platform-page-header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding: 0 24px;
  box-sizing: border-box;
}
.header-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--page-header-height);
}
.page-tabs {
  display: flex;
  gap: var(--spacing-xl);
  border-bottom: 1px solid var(--el-border-color);
}
.page-tab {
  height: 40px;
  padding: 0;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--el-text-color-regular);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.page-tab:hover {
  color: var(--el-text-color-primary);
}
.page-tab.active {
  border-bottom-color: var(--el-color-primary);
  color: var(--brand-link);
  font-weight: var(--font-medium);
}
.page-tab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.page-title {
  margin: 0;
  font-size: var(--text-lg);
  line-height: var(--leading-lg);
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}
.page-description {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}
.unsaved {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.action {
  height: var(--control-height);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
}
.action.secondary {
  border: 1px solid var(--el-border-color-dark);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
}
.action.primary {
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: var(--on-primary);
}
.action:disabled {
  cursor: default;
  opacity: 0.6;
}
.action:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
