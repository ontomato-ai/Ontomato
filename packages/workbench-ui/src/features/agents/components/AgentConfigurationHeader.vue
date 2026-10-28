<script setup lang="ts">
defineProps<{ title: string; hint?: string; count?: number }>();
</script>

<template>
  <div class="configuration-header">
    <div class="configuration-heading">
      <div class="configuration-title">
        <slot name="icon" />
        <strong>{{ title }}</strong>
        <el-tag v-if="count !== undefined" size="small" effect="plain">{{ count }}</el-tag>
      </div>
      <p v-if="hint">{{ hint }}</p>
    </div>
    <div v-if="$slots.actions" class="configuration-actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.configuration-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--spacing-md); }
.configuration-heading { flex: 1; min-width: 0; }
.configuration-title { display: flex; align-items: center; gap: var(--spacing-sm); font-size: 14px; line-height: 1.5; color: var(--el-text-color-primary); }
.configuration-title strong { min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
.configuration-title :deep(svg), .configuration-title :deep(.el-tag) { flex-shrink: 0; }
.configuration-heading p { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--el-text-color-secondary); }
.configuration-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--spacing-sm); margin-left: auto; }
.configuration-actions :deep(.el-button) { margin: 0; }
</style>
