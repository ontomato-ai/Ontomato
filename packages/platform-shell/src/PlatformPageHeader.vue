<script setup lang="ts">
import type { PlatformPageAction, PlatformPageDraft } from "./page-actions";

/**
 * The one page header every page of the platform uses (DESIGN.md "Page architecture"): one row in the page gutter, the
 * page's name with one line of description after it on the left, the page's own actions on the right. The application's
 * name is not here: it heads the application's own column.
 *
 * A page holding a draft saves it here: without changes only a disabled Save shows; with changes the unsaved marker,
 * Discard and Save. A page either shows under a frame that draws this header for it, or draws it itself; never both.
 */
withDefaults(
  defineProps<{
    /** The page's title; absent on a header that only carries actions. */
    title?: string;
    description?: string | null;
    /** Dense technical pages keep the shared title/actions in a single compact row. */
    compact?: boolean;
    /** The page's own buttons at the right of the title row. */
    actions?: readonly PlatformPageAction[];
    /** The one Save of a page holding a draft, with its unsaved marker. */
    draft?: PlatformPageDraft | null;
    /** The header's own words, from the host's i18n; read only by the draft's Save and its unsaved marker. */
    labels?: { save: string; discard: string; unsavedChanges: string };
  }>(),
  {
    title: "",
    description: null,
    compact: true,
    actions: undefined,
    draft: null,
    labels: () => ({ save: "", discard: "", unsavedChanges: "" }),
  },
);

const emit = defineEmits<{ discard: []; save: [] }>();
</script>

<template>
  <header class="platform-page-header platform-page-gutter" :class="{ compact }">
    <div v-if="title || description || actions?.length || draft || $slots.actions" class="header-row">
      <div class="header-text">
        <!-- What stands for the page's subject before its name (an agent's avatar). -->
        <span v-if="$slots.leading" class="header-leading"><slot name="leading" /></span>
        <h1 v-if="title" class="page-title">{{ title }}</h1>
        <p v-if="description" class="page-description">{{ description }}</p>
      </div>
      <div v-if="actions?.length || draft || $slots.actions" class="page-actions">
        <span v-if="draft?.dirty" class="unsaved" role="status">{{ labels.unsavedChanges }}</span>
        <!-- A page's own buttons, when it hands over markup rather than a list of actions. -->
        <slot name="actions" />
        <button
          v-for="action in actions ?? []"
          :key="action.id"
          type="button"
          class="action"
          :class="action.primary ? 'primary' : action.danger ? 'danger' : 'secondary'"
          :disabled="action.disabled || action.loading"
          :aria-busy="action.loading || undefined"
          @click="action.onClick()"
        >
          <component :is="action.icon" v-if="action.icon" :size="16" aria-hidden="true" />
          <span>{{ action.label }}</span>
        </button>
        <button
          v-if="draft?.dirty"
          type="button"
          class="action secondary"
          :disabled="draft.saving"
          @click="emit('discard')"
        >
          {{ labels.discard }}
        </button>
        <button
          v-if="draft"
          type="button"
          class="action primary"
          :disabled="!draft.dirty || draft.saving"
          :aria-busy="draft.saving || undefined"
          @click="emit('save')"
        >
          {{ labels.save }}
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
/*
 * One header for every page: the title and its description in one block, actions at the right (DESIGN.md "Page
 * architecture"). Its side padding is the page gutter (`platform-page-gutter`), the one the content
 * under it takes too, so a title and the content start at the same place.
 */
.platform-page-header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  padding-top: var(--page-gutter);
  box-sizing: border-box;
  container: page-header / inline-size;
}
.header-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding-bottom: var(--spacing-lg);
}
.header-text {
  min-width: 0;
  flex: 1 1 240px;
}
.page-title {
  margin: 0 0 2px;
  font-size: var(--text-title);
  line-height: var(--leading-title);
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
.header-leading {
  display: inline-flex;
  align-self: center;
  flex-shrink: 0;
}
.page-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
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
  font-family: var(--font-sans);
  line-height: var(--leading-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast), border-color var(--transition-fast), color var(--transition-fast);
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
.action.secondary:not(:disabled):hover {
  background: var(--el-fill-color-light);
}
.action.primary:not(:disabled):hover {
  background: var(--brand-primary-hover);
  border-color: var(--brand-primary-hover);
}
.action.primary:not(:disabled):active {
  background: var(--el-color-primary-dark-2);
}
.action.danger {
  border: 1px solid var(--el-border-color-dark);
  background: var(--el-bg-color);
  color: var(--el-color-danger);
}
.action.danger:not(:disabled):hover {
  background: var(--el-color-danger-light-9);
}
.action:disabled {
  cursor: not-allowed;
  color: var(--el-disabled-text-color);
  background: var(--el-fill-color-light);
  border-color: var(--el-border-color-light);
}
.action:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
/* The compact row is denser only vertically: its sides are the page gutter, like every header's and the content's. */
.platform-page-header.compact {
  padding-block: var(--spacing-md);
  border-bottom: 1px solid var(--el-border-color);
}
.compact .header-row {
  min-height: var(--control-height);
  align-items: center;
  gap: var(--component-gap) var(--spacing-lg);
  padding: 0;
}
.compact .header-text {
  flex: 1 1 160px;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-md);
}
.compact .page-title {
  margin: 0;
  font-size: var(--text-lg);
  line-height: var(--leading-lg);
  text-wrap: wrap;
  flex-shrink: 0;
}
.compact .page-description {
  flex: 1 1 180px;
  min-width: 0;
  line-height: var(--leading-sm);
  overflow-wrap: anywhere;
}
.compact .page-actions {
  padding-top: 0;
  gap: var(--component-gap);
}
.compact .page-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
