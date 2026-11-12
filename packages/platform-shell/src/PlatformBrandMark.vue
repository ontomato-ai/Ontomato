<script setup lang="ts">
/**
 * The edition's mark: its logo when it has one, otherwise the first letter of its name on the primary colour. The rail
 * shows it at its head and the platform home above its greeting, from the same brand the shell is given.
 */
withDefaults(defineProps<{ brand: { name: string; logo?: string }; size?: number }>(), { size: 26 });
</script>

<template>
  <img v-if="brand.logo" class="brand-logo" :src="brand.logo" alt="" :style="{ width: `${size}px`, height: `${size}px` }" />
  <span
    v-else
    class="brand-mark"
    aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.27)}px`, fontSize: `${Math.round(size * 0.5)}px` }"
  >{{ brand.name.charAt(0) }}</span>
</template>

<style scoped>
.brand-logo {
  flex-shrink: 0;
  object-fit: contain;
}
.brand-mark {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  background: var(--el-color-primary);
  color: var(--on-primary);
  font-weight: var(--font-bold);
  line-height: 1;
}
</style>
