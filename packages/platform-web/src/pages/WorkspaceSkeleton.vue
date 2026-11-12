<script setup lang="ts">
withDefaults(defineProps<{ label: string; rows?: number; composer?: boolean }>(), { rows: 3, composer: false });
</script>
<template>
  <div class="workspace-skeleton" :class="{ 'is-composer': composer }" role="status" aria-busy="true" :aria-label="label">
    <div v-for="row in rows" :key="row" class="skeleton-row" aria-hidden="true"><span class="skeleton-mark" /><div class="skeleton-lines"><span /><span /></div></div>
  </div>
</template>
<style scoped>
.workspace-skeleton { display: flex; flex-direction: column; gap: var(--spacing-lg); padding-block: var(--spacing-sm); }
.skeleton-row { display: flex; align-items: center; gap: var(--spacing-md); min-height: 44px; }
.skeleton-mark, .skeleton-lines span { display: block; border-radius: var(--radius-sm); background: color-mix(in srgb, var(--el-text-color-secondary) 15%, transparent); animation: workspace-pulse 1.4s ease-in-out infinite; }
.skeleton-mark { width: 28px; height: 28px; flex-shrink: 0; }
.skeleton-lines { flex: 1; display: flex; flex-direction: column; gap: var(--spacing-sm); }
.skeleton-lines span { height: 12px; width: 72%; }
.skeleton-lines span + span { height: 10px; width: 48%; }
.is-composer { padding: var(--spacing-lg); border: 1px solid var(--el-border-color-lighter); border-radius: var(--radius-lg); min-height: 104px; justify-content: center; }
.is-composer .skeleton-lines span:first-child { width: 85%; }
@keyframes workspace-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .skeleton-mark, .skeleton-lines span { animation: none; } }
</style>
