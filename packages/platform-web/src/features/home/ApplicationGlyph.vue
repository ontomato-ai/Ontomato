<script setup lang="ts">
import { appIcon } from "@ontomato/platform-shell";

defineProps<{ icon: string; size: number }>();
</script>

<template>
  <component :is="appIcon(icon)" class="application-glyph" :size="size" aria-hidden="true" />
</template>

<style scoped>
.application-glyph {
  flex: none;
  color: var(--el-color-primary);
}
</style>
