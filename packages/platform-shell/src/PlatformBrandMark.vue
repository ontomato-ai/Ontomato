<script setup lang="ts">
import type { PlatformBrand } from "./types";

/**
 * The edition's mark: its logo when it has one (its dark version on the dark theme, when it has that), otherwise the
 * first letter of its name on the primary colour. The rail shows it at its head and the platform home above its
 * greeting, from the same brand the shell is given. The theme is the document's (`html.dark`), so both versions are in
 * the page and the stylesheet shows the one that fits. The theme rules name `html.dark` plainly, not through `:global()`:
 * in a scoped block `:global(html.dark) .x` compiles to a bare `html.dark` rule, while `html.dark .x` scopes `.x` only.
 */
withDefaults(defineProps<{ brand: PlatformBrand; size?: number }>(), { size: 26 });
</script>

<template>
  <template v-if="brand.logo">
    <img
      class="brand-logo"
      :class="{ 'brand-logo-light': brand.logoDark }"
      :src="brand.logo"
      alt=""
      :style="{ width: `${size}px`, height: `${size}px` }"
    />
    <img
      v-if="brand.logoDark"
      class="brand-logo brand-logo-dark"
      :src="brand.logoDark"
      alt=""
      :style="{ width: `${size}px`, height: `${size}px` }"
    />
  </template>
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
.brand-logo-dark,
html.dark .brand-logo-light {
  display: none;
}
html.dark .brand-logo-dark {
  display: block;
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
