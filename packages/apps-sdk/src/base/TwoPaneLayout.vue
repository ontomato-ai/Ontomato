<script setup lang="ts">
/**
 * Two panes of one page side by side — a list and the detail of what is chosen in it, say — as the platform draws a
 * page's several panes: one block with a hairline between them, the first at the platform's list width, the second
 * taking the rest. Where the panel is narrower than both need, the first stacks above the second. It lays out what it
 * is given and knows nothing about it.
 */
defineSlots<{
  /** The first pane: the list, or what the second pane is about. */
  aside(): unknown;
  /** The second pane: the detail. */
  default(): unknown;
}>();
</script>

<template>
  <div class="sdk-two-pane">
    <div class="sdk-two-pane-block">
      <aside class="sdk-two-pane-aside"><slot name="aside"></slot></aside>
      <section class="sdk-two-pane-main"><slot></slot></section>
    </div>
  </div>
</template>

<style scoped>
.sdk-two-pane {
  container-type: inline-size;
}
.sdk-two-pane-block {
  display: grid;
  grid-template-columns: var(--shell-list-panel) minmax(0, 1fr);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.sdk-two-pane-aside {
  border-inline-end: 1px solid var(--ui-divider);
  min-width: 0;
  padding: var(--spacing-md);
}
.sdk-two-pane-main {
  min-width: 0;
  padding: var(--page-section-padding);
}
@container (max-width: 640px) {
  .sdk-two-pane-block {
    grid-template-columns: minmax(0, 1fr);
  }
  .sdk-two-pane-aside {
    border-inline-end: 0;
    border-block-end: 1px solid var(--ui-divider);
  }
}
</style>
