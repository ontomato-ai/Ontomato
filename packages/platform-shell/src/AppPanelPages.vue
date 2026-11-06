<script setup lang="ts">
import type { PlatformPanelGroup } from "./types";
import { resolveIcon } from "./icons";

/**
 * The pages of an application whose pages are its own menu (the ontology manager), listed by group in the order the host
 * gives. Groups and their order belong to the application, not to this component.
 */
defineProps<{ groups: readonly PlatformPanelGroup[]; activePageId: string | null }>();
const emit = defineEmits<{ selectPage: [id: string] }>();
</script>

<template>
  <div class="app-panel-pages">
    <section v-for="group in groups" :key="group.key" class="page-group">
      <p class="group-heading">{{ group.label }}</p>
      <template v-for="page in group.pages" :key="page.id">
        <span
          v-if="page.unavailableHint"
          class="page-row unavailable"
          aria-disabled="true"
          :title="page.unavailableHint"
        >
          <component :is="resolveIcon(page.icon)" class="page-icon" :size="16" aria-hidden="true" />
          <span class="page-label">{{ page.label }}</span>
        </span>
        <button
          v-else
          type="button"
          class="page-row"
          :class="{ active: page.id === activePageId }"
          :aria-current="page.id === activePageId ? 'page' : undefined"
          @click="emit('selectPage', page.id)"
        >
          <component :is="resolveIcon(page.icon)" class="page-icon" :size="16" aria-hidden="true" />
          <span class="page-label">{{ page.label }}</span>
          <span v-if="page.count !== null && page.count !== undefined" class="page-count">{{ page.count }}</span>
        </button>
      </template>
    </section>
  </div>
</template>

<style scoped>
.app-panel-pages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 8px;
}
.page-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-heading {
  margin: 0;
  padding: 8px 8px 4px;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-weight: 600;
  letter-spacing: var(--tracking-label);
  color: var(--el-text-color-secondary);
}
.page-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: var(--nav-row-height);
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.page-icon {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.page-row:hover:not(.unavailable) {
  background: var(--el-fill-color-light);
}
.page-row.active {
  background: var(--shell-panel-selected);
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.page-row.active .page-icon {
  color: var(--el-text-color-primary);
}
.page-row.unavailable {
  cursor: default;
  color: var(--el-text-color-tertiary);
}
.page-row.unavailable .page-icon {
  color: var(--el-text-color-tertiary);
}
.page-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-count {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  font-variant-numeric: tabular-nums;
}
.page-row:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
</style>
