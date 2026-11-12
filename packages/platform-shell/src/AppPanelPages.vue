<script setup lang="ts">
import type { PlatformPanelGroup, PlatformPanelPage } from "./types";
import { resolveIcon } from "./icons";

/**
 * The pages of an application whose pages are its own menu (the ontology manager, the system settings, the
 * permissions), listed by group in the order the host gives, and the application's own entry at the foot of the column
 * (its models), like the foot of a conversation application's column. Groups and their order belong to the application,
 * not to this component.
 */
withDefaults(
  defineProps<{ groups: readonly PlatformPanelGroup[]; foot?: PlatformPanelPage | null; activePageId: string | null }>(),
  { foot: null },
);
const emit = defineEmits<{ selectPage: [id: string] }>();
</script>

<template>
  <div class="app-panel-pages">
    <section v-for="group in groups" :key="group.key" class="page-group">
      <p v-if="group.label" class="group-heading">{{ group.label }}</p>
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
    <div v-if="foot" class="page-foot">
      <button
        type="button"
        class="page-row"
        :class="{ active: foot.id === activePageId }"
        :aria-current="foot.id === activePageId ? 'page' : undefined"
        @click="emit('selectPage', foot.id)"
      >
        <component :is="resolveIcon(foot.icon)" class="page-icon" :size="16" aria-hidden="true" />
        <span class="page-label">{{ foot.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-panel-pages {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 100%;
  box-sizing: border-box;
  padding: 4px 0 8px;
}
/* The application's own entry stays at the foot of the column, under a hairline. */
.page-foot {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-light);
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
  font-weight: var(--font-semibold);
  letter-spacing: var(--tracking-label);
  color: var(--el-text-color-secondary);
}
.page-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: var(--nav-row-height);
  padding: var(--spacing-xs) var(--spacing-sm);
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--el-text-color-regular);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  font-weight: var(--font-normal);
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
  background: var(--shell-panel-hover);
  color: var(--el-text-color-primary);
}
.page-row.active {
  background: var(--shell-panel-selected);
  color: var(--el-text-color-primary);
  font-weight: var(--font-semibold);
}
.page-row.active .page-icon {
  color: var(--brand-link);
}
.page-row.active:hover {
  background: var(--shell-panel-selected-hover);
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
