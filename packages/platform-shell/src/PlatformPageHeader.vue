<script setup lang="ts">
import type { Component } from "vue";
import type { PlatformPageActions } from "./types";

/**
 * The one page header every page of the platform uses: the title on top, one line of description under it, the page's
 * own actions on the right, and — for an application of several pages — its tabs in a row below them (DESIGN.md
 * "Admin page anatomy").
 *
 * It is the only header: a page either uses it or, for a page that draws its own toolbars, the application passes no
 * title and only the tabs appear above it. A second-level tab of one page stays in the page's content, under this.
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
    /** The page's own buttons at the right of the title row. */
    actions?: readonly { id: string; label: string; primary?: boolean; icon?: Component; onClick: () => void }[];
    /** The one Save of a page holding a draft, with its unsaved marker. */
    draft?: PlatformPageActions | null;
    /** The header's own words, from the host's i18n; read only by the draft's Save and its unsaved marker. */
    labels?: { save: string; discard: string; unsavedChanges: string };
  }>(),
  {
    title: "",
    description: null,
    tabs: undefined,
    activePath: undefined,
    actions: undefined,
    draft: null,
    labels: () => ({ save: "", discard: "", unsavedChanges: "" }),
  },
);

const emit = defineEmits<{ discard: []; save: []; selectTab: [path: string] }>();
</script>

<template>
  <header class="platform-page-header platform-page-gutter" :class="{ 'has-tabs': tabs && tabs.length > 0 }">
    <div v-if="title || description || actions?.length || draft || $slots.actions" class="header-row">
      <div class="header-text">
        <h1 v-if="title" class="page-title">{{ title }}</h1>
        <p v-if="description" class="page-description">{{ description }}</p>
      </div>
      <div v-if="actions?.length || draft || $slots.actions" class="page-actions">
        <span v-if="draft?.dirty" class="unsaved" role="status">{{ labels.unsavedChanges }}</span>
        <button
          v-if="draft"
          type="button"
          class="action secondary"
          :disabled="!draft.dirty || draft.saving"
          @click="emit('discard')"
        >
          {{ labels.discard }}
        </button>
        <button
          v-if="draft"
          type="button"
          class="action primary"
          :disabled="!draft.dirty || draft.saving"
          @click="emit('save')"
        >
          {{ labels.save }}
        </button>
        <!-- A page's own buttons, when it hands over markup rather than a list of actions. -->
        <slot name="actions" />
        <button
          v-for="action in actions ?? []"
          :key="action.id"
          type="button"
          class="action"
          :class="action.primary ? 'primary' : 'secondary'"
          @click="action.onClick()"
        >
          <component :is="action.icon" v-if="action.icon" :size="16" aria-hidden="true" />
          <span>{{ action.label }}</span>
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
/*
 * One header for every page: the title and its description in one block, actions at the right, tabs under a hairline
 * (DESIGN.md "Admin page anatomy"). Its side padding is the page gutter (`platform-page-gutter`), the one the content
 * under it takes too, so a title and the content start at the same place.
 */
.platform-page-header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding-top: var(--page-gutter);
  box-sizing: border-box;
}
.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding-bottom: 14px;
}
.header-text {
  min-width: 0;
}
.page-title {
  margin: 0 0 2px;
  font-size: var(--text-xl);
  line-height: var(--leading-xl);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
  text-wrap: balance;
}
.page-description {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding-top: 2px;
}
.unsaved {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
}
.action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: var(--control-height);
  padding: 0 12px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
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
</style>
