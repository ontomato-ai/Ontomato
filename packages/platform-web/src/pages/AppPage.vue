<script setup lang="ts">
import { PlatformPageHeader, type PlatformPageAction } from "@ontomato/platform-shell";

/**
 * A page application's frame: the platform's one page header, then the page.
 *
 * The header is the platform's (the title, one line of description and the page's own buttons in the same places every
 * other page puts them); the page fills the rest and never draws a title of its own (DESIGN.md "Admin page anatomy").
 * The application's pages are not in the platform's navigation, so the shell draws no header for them; this frame does.
 * It takes the page gutter (`platform-page-gutter`) and `PlatformLayout` drops its own for an address no navigation page
 * owns, so the gutter is not given twice (DESIGN.md "Page applications").
 */
withDefaults(
  defineProps<{
    title: string;
    description?: string | null;
    navigationHeader?: boolean;
    hideHeader?: boolean;
    /** The page's own buttons at the right of the title row. */
    actions?: readonly PlatformPageAction[];
    /** The header's own words, from the host's i18n. */
    labels: { save: string; discard: string; unsavedChanges: string };
  }>(),
  { description: null, actions: undefined },
);
</script>

<template>
  <div class="app-page">
    <PlatformPageHeader v-if="!hideHeader" :class="{ 'app-navigation-header': navigationHeader }" :title="title" :description="description" :actions="actions" :labels="labels">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </PlatformPageHeader>
    <div class="app-page-body platform-page-gutter">
      <slot />
    </div>
    <!--
      What stands at the page's foot under its content (its composer): outside the part that scrolls, so the room under it
      is its own and not the page body's bottom padding added to it.
    -->
    <div v-if="$slots.foot" class="app-page-foot platform-page-gutter"><slot name="foot" /></div>
  </div>
</template>

<style scoped>
/* The page fills the application's surface under the header; the header owns the one horizontal gutter. */
.app-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.app-page-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-block: var(--page-content-gap) var(--spacing-xl);
  container: platform-page / inline-size;
}
.app-page > .app-navigation-header {
  padding-block: var(--spacing-xs);
  border-bottom: 0;
}
.app-navigation-header :deep(.header-row) {
  min-height: var(--page-header-height);
  justify-content: flex-end;
}
.app-navigation-header :deep(.header-text:empty) { display: none; }
.app-navigation-header :deep(.page-actions) { gap: var(--spacing-xs); }
</style>
