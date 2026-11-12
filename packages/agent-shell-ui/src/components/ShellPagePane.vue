<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, ref, useSlots, watch } from "vue";
import { Maximize2, Menu, Minimize2, X } from "lucide-vue-next";
import { pageDockSpaceKey, shellContextKey } from "../context";
import type { ShellFeatureDeclaration } from "../types";
import { usePanelWidth } from "../usePanelWidth";
import ShellComposer from "./ShellComposer.vue";

/**
 * One host page, rendered once and kept mounted while it moves between the two places it can sit (DESIGN "Agent
 * apps"): `full` fills the workspace with a composer floating at its foot; `side` sits beside the conversation at a
 * draggable width. Dragged on past its widest, released, the page expands; past its narrowest, it closes. Pages that
 * are not declared `withConversation` only ever show full, without composer or controls.
 *
 * The page may put its own controls in the header row (`header`, in place of its title). Full, the composer floats over
 * the bottom of the page, the host's `composer-context` inside it before the input; the pane measures that dock and keeps
 * as much room under the page's content, so multiline input never covers the end of the page. A page that scrolls itself
 * keeps the room on its own (`scrollsItself`): the pane gives it its whole height and the measured space.
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
const slots = useSlots();
const { width, resizing, beyond, startResize } = usePanelWidth((edge) => {
  if (edge === "expand") emit("expand");
  else emit("close");
});
const paired = computed(() => props.feature?.withConversation === true);

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
    class="page-pane"
    :class="[view, beyond && `beyond-${beyond}`, { paired, resizing, 'scrolls-itself': feature?.scrollsItself }]"
    :style="paneStyle"
    :aria-label="feature?.label"
  >
    <div v-if="view === 'side'" class="pane-resize" role="separator" aria-orientation="vertical" @pointerdown.prevent="startResize" />
    <header v-if="paired" class="pane-header platform-page-gutter" :class="{ custom: slots.header }">
      <button v-if="view === 'full'" type="button" class="pane-button pane-menu" :aria-label="labels.menu" @click="emit('menu')">
        <Menu :size="18" />
      </button>
      <slot name="header"><h1 class="pane-title">{{ feature?.label }}</h1></slot>
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
    <div v-if="paired && view === 'full'" ref="dock" class="pane-dock">
      <ShellComposer :busy="busy" :disabled="disabled" :labels="labels" @send="emit('send', $event)" @stop="emit('stop')">
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
.pane-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-lg);
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
  padding-bottom: var(--pane-dock-space);
}
.scrolls-itself .pane-body {
  padding-bottom: 0;
}
/* While the edge is dragged, a frame in the page (an app's preview) must not take the pointer from it. */
.resizing .pane-body {
  pointer-events: none;
}
/*
 * Full, the composer floats over the page, one compact row with what a message carries inside it; only the composer
 * takes the pointer, the page shows around it.
 */
.pane-dock {
  --shell-composer-control: var(--control-height);
  --shell-composer-height: calc(var(--control-height) + 12px);
  position: absolute;
  z-index: 3;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: min(760px, 100%);
  padding: 0 16px 12px;
  box-sizing: border-box;
  pointer-events: none;
}
.pane-dock > * {
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
