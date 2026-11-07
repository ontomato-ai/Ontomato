<script setup lang="ts">
defineProps<{
  tabs: readonly { id: string; label: string }[];
  activeId?: string;
  label: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();
</script>

<template>
  <div class="page-tabs-bar" role="tablist" :aria-label="label">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="page-tab"
      :class="{ active: tab.id === activeId }"
      :aria-selected="tab.id === activeId"
      @click="tab.id !== activeId && emit('select', tab.id)"
    >{{ tab.label }}</button>
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
</style>
