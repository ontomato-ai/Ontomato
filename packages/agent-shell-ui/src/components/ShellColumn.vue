<script setup lang="ts">
/**
 * The column of a conversation application, drawn by the application inside the area the platform gives it.
 *
 * It owns the frame only: the width, the application's own band colour, the one hairline against the conversation and the
 * scroll area. What fills it is the application's — its agent switch, its pages, its settings navigation — so two
 * applications never share a column by accident and the platform never draws one for them (DESIGN.md "Applications and
 * shells").
 */
withDefaults(defineProps<{ label?: string }>(), { label: undefined });
</script>

<template>
  <aside class="shell-column" :aria-label="label">
    <slot />
  </aside>
</template>

<style scoped>
.shell-column {
  display: flex;
  flex-direction: column;
  flex: 0 0 var(--shell-app-column);
  width: var(--shell-app-column);
  min-height: 0;
  box-sizing: border-box;
  padding: 14px 10px 12px;
  background: var(--shell-panel-bg);
  border-right: 1px solid var(--el-border-color);
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  overflow: hidden;
}
@media (max-width: 760px) {
  .shell-column {
    flex-basis: auto;
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color);
  }
}
</style>
