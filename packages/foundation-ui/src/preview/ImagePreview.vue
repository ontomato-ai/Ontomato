<script setup lang="ts">
import { ElImage } from "element-plus/es/components/image/index";

/**
 * Thumbnail or inline image backed by Element Plus, with fallback slot support. Packages that may not depend on the
 * component library (such as the agent shell) reach `ElImage` through this wrapper.
 */
defineProps<{
  src: string;
  alt?: string;
  title?: string;
  fit?: "" | "contain" | "cover" | "fill" | "none" | "scale-down";
  loading?: "eager" | "lazy";
}>();
</script>

<template>
  <ElImage :src="src" :alt="alt" :title="title" :fit="fit" :loading="loading">
    <template v-if="$slots.error" #error><slot name="error" /></template>
  </ElImage>
</template>
