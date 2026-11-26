<script setup lang="ts">
/**
 * One status dot: a small filled circle colored by the record's own tone. Shared by `ObjectList`
 * (`statusStyle: "dot"`) and `ObjectHeader` (`statusStyle: "dot"`) so both read the same size and palette.
 */
withDefaults(defineProps<{
  /** Platform tone of the value being marked; unknown tones fall back to the placeholder color. */
  tone?: string;
  /** Hover text, usually the status text the dot stands for. */
  title?: string;
  /** Hides the dot from assistive technology when the surrounding text already names the status. */
  ariaHidden?: boolean;
}>(), {
  tone: "default",
  title: undefined,
  ariaHidden: false,
});
</script>

<template>
  <span class="sdk-status-dot" :data-tone="tone" :title="title" :aria-hidden="ariaHidden ? 'true' : undefined"></span>
</template>

<style scoped>
.sdk-status-dot {
  background: var(--el-text-color-placeholder);
  border-radius: 50%;
  flex: 0 0 auto;
  height: 7px;
  width: 7px;
}
.sdk-status-dot[data-tone="success"] {
  background: var(--el-color-success);
}
.sdk-status-dot[data-tone="warning"] {
  background: var(--el-color-warning);
}
.sdk-status-dot[data-tone="danger"] {
  background: var(--el-color-danger);
}
.sdk-status-dot[data-tone="info"] {
  background: var(--el-color-info);
}
</style>
