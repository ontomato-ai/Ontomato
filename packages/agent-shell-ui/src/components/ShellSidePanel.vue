<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { Download, X } from "lucide-vue-next";
import { fileKind, fileName, formatSize, saveBlob } from "../artifacts";
import { shellContextKey } from "../context";
import { artifactIcon } from "../icons";
import type { OpenArtifact } from "../types";
import ArtifactView from "./ArtifactView.vue";
import SlotOutlet from "./SlotOutlet.vue";

/** Right-side outlet. Absent when nothing is open, so it never reserves width. */
const props = defineProps<{ open: OpenArtifact }>();
const emit = defineEmits<{ close: [] }>();
const shell = inject(shellContextKey)!;
const width = ref(Math.round(Math.min(Math.max(window.innerWidth * 0.42, 420), 760)));
const icon = computed(() => artifactIcon(props.open.artifact.path));
let dragStart: { x: number; width: number } | null = null;

function startResize(event: PointerEvent) {
  dragStart = { x: event.clientX, width: width.value };
  window.addEventListener("pointermove", resize);
  window.addEventListener("pointerup", stopResize, { once: true });
}
function resize(event: PointerEvent) {
  if (!dragStart) return;
  const next = dragStart.width + (dragStart.x - event.clientX);
  width.value = Math.min(Math.max(next, 360), Math.round(window.innerWidth * 0.7));
}
function stopResize() {
  dragStart = null;
  window.removeEventListener("pointermove", resize);
}
onBeforeUnmount(stopResize);

async function download() {
  saveBlob(await shell.readArtifact(props.open.artifact), fileName(props.open.artifact.path));
}
</script>

<template>
  <aside class="side-panel" :style="{ '--panel-width': `${width}px` }" @keydown.escape="emit('close')">
    <div class="panel-resize" role="separator" aria-orientation="vertical" @pointerdown.prevent="startResize" />
    <header class="panel-header">
      <span class="panel-icon"><component :is="icon" :size="17" /></span>
      <span class="panel-heading">
        <span class="panel-title">{{ open.title || fileName(open.artifact.path) }}</span>
        <span class="panel-meta">
          {{ fileName(open.artifact.path) }} · {{ fileKind(open.artifact.path).toUpperCase() }} ·
          {{ formatSize(open.artifact.size) }}
        </span>
      </span>
      <SlotOutlet :content="shell.slots.artifactActions" :scope="{ artifact: open.artifact }" />
      <button type="button" class="panel-button" :title="shell.labels.value.download" :aria-label="shell.labels.value.download" @click="download">
        <Download :size="16" />
      </button>
      <button type="button" class="panel-button" :title="shell.labels.value.close" :aria-label="shell.labels.value.close" @click="emit('close')">
        <X :size="17" />
      </button>
    </header>
    <div class="panel-body">
      <ArtifactView
        :key="open.key"
        :run-id="open.artifact.runId"
        :path="open.artifact.path"
        :title="open.title"
        :artifact="open.artifact"
        presentation="panel"
      />
    </div>
  </aside>
</template>

<style scoped>
.side-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--panel-width);
  height: 100%;
  min-height: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--shell-conversation-radius);
  background: var(--el-bg-color);
  box-shadow: var(--elevation-panel);
  overflow: hidden;
  animation: slide-in var(--transition-slow);
}
.panel-resize {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  left: 0;
  width: 6px;
  cursor: col-resize;
}
.panel-resize:hover {
  background: var(--el-color-primary-light-7);
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--panel-header-height);
  padding: 6px 8px 6px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--el-border-color);
}
.panel-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
}
.panel-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.panel-title {
  font-size: var(--text-base);
  line-height: var(--leading-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-meta {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.panel-button {
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
.panel-button:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.panel-button:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(24px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .side-panel {
    animation: none;
  }
}
@media (max-width: 1100px) {
  .side-panel {
    position: fixed;
    z-index: 40;
    top: var(--shell-conversation-gutter);
    right: var(--shell-conversation-gutter);
    bottom: var(--shell-conversation-gutter);
    height: auto;
    width: min(var(--panel-width), calc(100vw - 2 * var(--shell-conversation-gutter)));
    box-shadow: var(--elevation-modal);
  }
  .panel-resize {
    display: none;
  }
}
</style>
