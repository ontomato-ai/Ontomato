<script setup lang="ts">
import { PlatformPageHeader, providePageActions, type PlatformPageAction, type PlatformPageHeading } from "@ontomato/platform-shell";

/**
 * One entry's page as an application's frame holds it (big main's ruling, 2026-11-21): the platform's page header — the
 * entry's title, description, way back and the page's commands — above the entry's content. It is the same unit a
 * conversation shows beside it; inside a frame it stands where the frame's `<current-entry>` is, at the width the frame
 * gives it, and the frame can neither remove nor change it. The page's commands reach this header, not the layout's.
 */
defineProps<{
  heading: PlatformPageHeading | null;
  /** The header's own words: its Save, Discard and unsaved marker, and the way back. */
  labels: { save: string; discard: string; unsavedChanges: string };
  backLabel: string;
  /** The header's "more": the entry's external link. */
  more?: readonly PlatformPageAction[];
  moreLabel?: string;
}>();

const actions = providePageActions();
</script>

<template>
  <div class="panel-entry-unit">
    <PlatformPageHeader
      v-if="heading"
      :title="heading.title"
      :description="heading.description ?? null"
      :actions="actions?.actions"
      :draft="actions?.draft ?? null"
      :labels="labels"
      :back-label="heading.back ? backLabel : undefined"
      :more="more ?? []"
      :more-label="moreLabel ?? ''"
      @back="heading.back?.()"
      @save="actions?.draft?.save()"
      @discard="actions?.draft?.discard()"
    />
    <div class="panel-entry-unit-body">
      <slot />
    </div>
    <div v-if="$slots.foot" class="panel-entry-unit-foot platform-page-gutter">
      <slot name="foot" />
    </div>
  </div>
</template>

<style scoped>
.panel-entry-unit {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.panel-entry-unit-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.panel-entry-unit-foot {
  position: absolute;
  z-index: 5;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}
</style>
