<script setup lang="ts">
import type { Component } from 'vue';
defineProps<{
  tabs: readonly { id: string; label: string; icon?:Component }[];
  activeId?: string;
  label: string;
  variant?: 'segmented';
}>();
const emit = defineEmits<{ select: [id: string] }>();

function move(event: KeyboardEvent) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tab = event.target as HTMLElement;
  const list = tab.closest('[role="tablist"]');
  if (!list || tab.getAttribute('role') !== 'tab') return;
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const index = buttons.indexOf(tab as HTMLButtonElement);
  const rtl = getComputedStyle(list).direction === 'rtl';
  const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + step + buttons.length) % buttons.length;
  event.preventDefault();
  buttons[next]?.focus();
  buttons[next]?.click();
  buttons[next]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
</script>

<template>
  <div class="page-tabs-bar" :class="{ 'is-segmented': variant === 'segmented' }" role="tablist" :aria-label="label" @keydown="move">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="page-tab"
      :class="{ active: tab.id === activeId }"
       :aria-selected="tab.id === activeId"
       :tabindex="tab.id === (activeId ?? tabs[0]?.id) ? 0 : -1"
      @click="tab.id !== activeId && emit('select', tab.id)"
    ><component :is="tab.icon" v-if="tab.icon" :size="16" aria-hidden="true"/>{{ tab.label }}</button>
  </div>
</template>

<style scoped>
.page-tabs-bar {
  display: flex;
  flex: 0 0 auto;
  gap: var(--spacing-lg);
  border-bottom: 1px solid var(--el-border-color);
  overflow-x: auto;
}
.page-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-shrink: 0;
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
.page-tab>svg{flex-shrink:0}
.page-tab:hover { color: var(--el-text-color-primary); }
.page-tab.active {
  border-bottom-color: var(--el-color-primary);
  color: var(--brand-link);
  font-weight: var(--font-medium);
}
.page-tab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.page-tabs-bar.is-segmented {
  box-sizing: border-box;
  inline-size: max-content;
  max-inline-size: 100%;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--el-fill-color-light);
  scrollbar-width: thin;
}
.page-tabs-bar.is-segmented .page-tab {
  height: var(--control-height-sm);
  padding-inline: var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.page-tabs-bar.is-segmented .page-tab:not(.active):hover {
  background: var(--ui-fill-tertiary, var(--el-fill-color));
  color: var(--el-text-color-primary);
}
.page-tabs-bar.is-segmented .page-tab.active {
  background: var(--el-bg-color-overlay);
  color: var(--el-text-color-primary);
  box-shadow: var(--elevation-panel);
  font-weight: var(--font-semibold);
}
</style>
