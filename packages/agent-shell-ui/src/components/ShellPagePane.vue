<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, ref, useSlots, watch } from "vue";
import { Columns2, Maximize, Menu, X } from "lucide-vue-next";
import { ActionTooltip } from "@ontomato/foundation-ui/overlay";
import { pageDockSpaceKey, shellContextKey, useDisplayPlacement } from "../context";
import type { ShellFeatureDeclaration } from "../types";
import { usePanelWidth } from "../usePanelWidth";
import ShellComposer from "./ShellComposer.vue";
import type { ComposerEntry } from "../page-composer-entry";
import ShellQuestions from "./ShellQuestions.vue";

/**
 * One host page, rendered once and kept mounted while it moves between the two places it can sit (DESIGN "Agent
 * apps"): `full` fills the workspace with a composer floating at its foot; `side` sits beside the conversation at a
 * draggable width. Dragged on past its widest, released, the page expands; past its narrowest, it closes. Pages that
 * are not declared `withConversation` only ever show full, without composer or controls.
 *
 * The page may put its own controls in the header row (`header`, in place of its title). Full, the composer floats over
 * the bottom of the page, the host's `composer-context` inside it before the input and the conversation's questions over
 * it; the pane measures that dock and keeps as much room under the page's content, so multiline input or an open question
 * never covers the end of the page. A page that scrolls itself
 * keeps the room on its own (`scrollsItself`): the pane gives it its whole height and the measured space.
 */
const props = defineProps<{
  feature: ShellFeatureDeclaration | null;
  view: "full" | "side";
  busy: boolean;
  /** A panel's conversation entry for the composer here; see ShellComposer. */
  entry?: ComposerEntry | null;
  sending: boolean;
  disabled: boolean;
}>();
const emit = defineEmits<{ send: [text: string]; stop: []; expand: []; collapse: []; close: []; menu: [] }>();
const shell = inject(shellContextKey)!;
const labels = computed(() => shell.labels.value);
const layoutLabel = computed(() => props.view === "full" ? labels.value.collapse : labels.value.expand);
function toggleLayout() {
  if (props.view === "full") emit("collapse");
  else emit("expand");
}
const slots = useSlots();
const { width, resizing, beyond, startResize } = usePanelWidth((edge) => {
  if (edge === "expand") emit("expand");
  else emit("close");
});
const paired = computed(() => props.feature?.withConversation === true);
const root = ref<HTMLElement | null>(null);
useDisplayPlacement(root);

const dock = ref<HTMLElement | null>(null);
const dockSpace = ref(0);
const dockObserver = new ResizeObserver(([entry]) => (dockSpace.value = (entry!.target as HTMLElement).offsetHeight));
watch(dock, (element, previous) => {
  if (previous) dockObserver.unobserve(previous);
  if (element) dockObserver.observe(element);
  else dockSpace.value = 0;
}, { flush: "post" });
onBeforeUnmount(() => dockObserver.disconnect());
provide(pageDockSpaceKey, dockSpace);
const paneStyle = computed(() => ({
  ...(props.view === "side" ? { "--panel-width": `${width.value}px` } : {}),
  "--pane-dock-space": `${dockSpace.value}px`,
}));
</script>

<template>
  <section
    ref="root"
    class="page-pane"
    :class="[view, beyond && `beyond-${beyond}`, { paired, resizing, 'scrolls-itself': feature?.scrollsItself }]"
    :style="paneStyle"
    :aria-label="feature?.label"
  >
    <div v-if="view === 'side'" class="pane-resize" role="separator" aria-orientation="vertical" @pointerdown.prevent="startResize" />
    <header v-if="paired" class="pane-header platform-page-gutter" :class="{ custom: slots.header, compact: !slots.header }">
      <button v-if="view === 'full'" type="button" class="pane-button pane-menu" :aria-label="labels.menu" @click="emit('menu')">
        <Menu :size="18" />
      </button>
      <slot name="header"><span class="pane-spacer" aria-hidden="true" /></slot>
      <ActionTooltip :content="layoutLabel">
        <button type="button" class="pane-button pane-layout" :aria-label="layoutLabel" @click="toggleLayout">
          <Columns2 v-if="view === 'full'" :size="16" aria-hidden="true" />
          <Maximize v-else :size="16" aria-hidden="true" />
        </button>
      </ActionTooltip>
      <button type="button" class="pane-button" :title="labels.close" :aria-label="labels.close" @click="emit('close')">
        <X :size="17" />
      </button>
    </header>
    <div class="pane-body"><slot /></div>
    <div v-if="paired && view === 'full'" ref="dock" class="pane-dock">
      <ShellQuestions />
      <ShellComposer floating :busy="busy" :sending="sending" :disabled="disabled" :labels="labels" :entry="entry" @send="emit('send', $event)" @stop="emit('stop')">
        <template v-if="slots['composer-context']" #context><slot name="composer-context" /></template>
      </ShellComposer>
    </div>
  </section>
</template>

<style scoped>
/*
 * Full pages are continuous workspaces, not conversation cards: flat on the application's own area like the
 * conversation they replace, with no surface, line, radius or shadow of their own, so in dark mode the area stays the
 * darkest band. Only the detached side panel has a rounded, raised boundary. Keep the same page geometry in both modes;
 * the header uses the data density.
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
  border-radius: var(--radius-md);
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
/* Dragged past a bound: releasing now expands the page, or closes it (which the page fading says). */
.beyond-expand .pane-resize,
.beyond-close .pane-resize {
  background: var(--el-color-primary);
}
.beyond-close .pane-body {
  opacity: 0.5;
}
.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--page-header-height);
  padding-block: var(--spacing-md);
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color);
}
/* A page's own header row (tabs and their tools) runs the full height, so a tab's underline meets the line under it. */
.pane-header.custom {
  padding-block: 0;
  align-items: stretch;
}
.pane-header.custom > .pane-button {
  align-self: center;
}
.pane-header.compact {
  min-height: 36px;
  padding-block: var(--spacing-xs);
  border-bottom-color: var(--ui-divider);
}
.pane-spacer {
  flex: 1;
  min-width: 0;
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
  padding-bottom: var(--pane-dock-space);
}
.scrolls-itself .pane-body {
  display: flex;
  flex-direction: column;
  padding-bottom: 0;
}
/* While the edge is dragged, a frame in the page (an app's preview) must not take the pointer from it. */
.resizing .pane-body {
  pointer-events: none;
}
/*
 * Full, the composer floats over the page, the platform's one row with what a message carries inside it, the questions
 * over it; only they take the pointer, the page shows around them.
 */
.pane-dock {
  position: absolute;
  z-index: 3;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  padding: 0 var(--spacing-lg) var(--shell-composer-foot);
  box-sizing: border-box;
  pointer-events: none;
}
.pane-dock > * {
  pointer-events: auto;
}
.pane-dock > :deep(.composer),
.pane-dock > .shell-questions {
  width: min(760px, 100%);
  margin-inline: auto;
}
/* Folded with no pending questions, the dock leaves the page its whole height and pins the button to the corner. */
.pane-dock:has(> .composer-unfold:only-child) {
  padding: 0;
  height: 0;
}
.pane-dock > :deep(.composer-unfold) {
  position: absolute;
  right: var(--spacing-lg);
  bottom: var(--shell-composer-foot);
  pointer-events: auto;
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
