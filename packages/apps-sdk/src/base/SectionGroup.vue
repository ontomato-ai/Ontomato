<script setup lang="ts">
import { useId } from "vue";

/**
 * One titled group of a page's content — a settings page's "Model" or "Data scope", say: its title, one line of what it
 * is for, and what it holds under them. Groups that follow one another keep the platform's spacing between them. It
 * draws what it is given and binds nothing.
 */
defineProps<{
  /** The group's title, as the reader sees it. */
  title: string;
  /** One line of what the group is for, under the title; absent draws none. */
  description?: string;
}>();
defineSlots<{
  /** What the group holds. */
  default(): unknown;
}>();

const heading = useId();
</script>

<template>
  <section class="sdk-section-group" :aria-labelledby="heading">
    <header class="sdk-section-group-header">
      <h3 :id="heading" class="sdk-section-group-title">{{ title }}</h3>
      <p v-if="description" class="sdk-section-group-description">{{ description }}</p>
    </header>
    <slot></slot>
  </section>
</template>

<style scoped>
.sdk-section-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  min-width: 0;
  min-height: 0;
}
.sdk-section-group + .sdk-section-group {
  border-block-start: 1px solid var(--ui-divider);
  margin-block-start: var(--page-content-gap);
  padding-block-start: var(--page-content-gap);
}
.sdk-section-group-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-section-group-title {
  color: var(--el-text-color-primary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  margin: 0;
}
.sdk-section-group-description {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  margin: 0;
}
</style>
