<script setup lang="ts">
import { computed, inject } from "vue";
import { Maximize2, Menu, Minimize2, X } from "lucide-vue-next";
import { shellContextKey } from "../context";
import { featureIcon } from "../icons";
import type { ShellFeatureDeclaration } from "../types";
import { usePanelWidth } from "../usePanelWidth";
import ShellComposer from "./ShellComposer.vue";

/**
 * One host page, rendered once and kept mounted while it moves between the two places it can sit (DESIGN "Agent
 * apps"): `full` fills the workspace with a composer below it; `side` sits beside the conversation at a draggable
 * width. Pages that are not declared `withConversation` only ever show full, without composer or controls.
 */
const props = defineProps<{
  feature: ShellFeatureDeclaration | null;
  view: "full" | "side";
  busy: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ send: [text: string]; stop: []; expand: []; collapse: []; close: []; menu: [] }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);
const { width, startResize } = usePanelWidth();
const paired = computed(() => props.feature?.withConversation === true);
</script>

<template>
  <section
    class="page-pane"
    :class="[view, { paired }]"
    :style="view === 'side' ? { '--panel-width': `${width}px` } : undefined"
    :aria-label="feature?.label"
  >
    <div v-if="view === 'side'" class="pane-resize" role="separator" aria-orientation="vertical" @pointerdown.prevent="startResize" />
    <header v-if="paired" class="pane-header">
      <button v-if="view === 'full'" type="button" class="pane-button pane-menu" :aria-label="labels.menu" @click="emit('menu')">
        <Menu :size="18" />
      </button>
      <component :is="featureIcon(feature?.icon ?? '')" :size="16" class="pane-icon" />
      <h1 class="pane-title">{{ feature?.label }}</h1>
      <button
        v-if="view === 'full'"
        type="button"
        class="pane-button"
        :title="labels.collapse"
        :aria-label="labels.collapse"
        @click="emit('collapse')"
      >
        <Minimize2 :size="16" />
      </button>
      <button v-else type="button" class="pane-button" :title="labels.expand" :aria-label="labels.expand" @click="emit('expand')">
        <Maximize2 :size="16" />
      </button>
      <button type="button" class="pane-button" :title="labels.close" :aria-label="labels.close" @click="emit('close')">
        <X :size="17" />
      </button>
    </header>
    <div class="pane-body"><slot /></div>
    <div v-if="paired && view === 'full'" class="pane-dock">
      <ShellComposer :busy="busy" :disabled="disabled" @send="emit('send', $event)" @stop="emit('stop')" />
    </div>
  </section>
</template>

<style scoped>
/*
 * Full: the page fills the application's main area the way the conversation it replaces does, flat on the area's own
 * tone with no surface, line, radius or shadow of its own, so in dark mode it is the darkest band like the conversation
 * (DESIGN.md "Colour roles", "Agent apps"). Side: a raised panel of the artifact panel's geometry. The header is the page
 * header of the data density.
 */
.page-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  container-type: inline-size;
  container-name: page;
}
.page-pane.full {
  flex: 1;
}
.page-pane.side {
  width: var(--panel-width);
  flex-shrink: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--shell-conversation-radius);
  background: var(--el-bg-color);
  box-shadow: var(--elevation-panel);
}
.pane-resize {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  left: 0;
  width: 6px;
  cursor: col-resize;
}
.pane-resize:hover {
  background: var(--el-color-primary-light-7);
}
.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--page-header-height);
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color);
}
.pane-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.pane-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-base);
  line-height: var(--leading-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pane-button {
  display: grid;
  place-items: center;
  width: var(--control-height);
  height: var(--control-height);
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.pane-button:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.pane-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
/* The menu opens the navigation drawer, which only exists below 760px. */
.pane-button.pane-menu {
  display: none;
}
.pane-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.pane-dock {
  flex-shrink: 0;
  width: min(760px, 100%);
  margin: 0 auto;
  padding: 8px 16px 16px;
  box-sizing: border-box;
}
@media (max-width: 1100px) {
  .page-pane.side {
    position: fixed;
    z-index: 40;
    top: var(--shell-conversation-gutter);
    right: var(--shell-conversation-gutter);
    bottom: var(--shell-conversation-gutter);
    height: auto;
    width: min(var(--panel-width), calc(100vw - 2 * var(--shell-conversation-gutter)));
    box-shadow: var(--elevation-modal);
  }
  .pane-resize {
    display: none;
  }
}
@media (max-width: 760px) {
  .pane-button.pane-menu {
    display: grid;
  }
}
</style>
