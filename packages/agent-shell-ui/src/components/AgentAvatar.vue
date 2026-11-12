<script setup lang="ts">
import { computed } from "vue";
import { agentAvatar, avatarIcon, avatarSwatch } from "../avatar";

/**
 * An agent's avatar: the icon its definition chose on its swatch, or the default avatar when it chose none. The swatch
 * follows the theme: its light value in the light theme, its dark value in the dark one.
 */
const props = withDefaults(defineProps<{ icon: string | null; size?: number }>(), { size: 24 });
const avatar = computed(() => agentAvatar(props.icon));
const style = computed(() => {
  const swatch = avatarSwatch(avatar.value.color);
  return { "--avatar-light": swatch.light, "--avatar-dark": swatch.dark, width: `${props.size}px`, height: `${props.size}px` };
});
</script>

<template>
  <span class="agent-avatar" :style="style" aria-hidden="true">
    <component :is="avatarIcon(avatar.key)" :size="Math.round(size * 0.6)" />
  </span>
</template>

<style scoped>
.agent-avatar {
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  box-sizing: border-box;
  border-radius: 30%;
  background: var(--avatar-light);
  color: var(--el-color-primary);
}
/* The document's theme; `html.dark` is named plainly so only `.agent-avatar` is scoped (see PlatformBrandMark). */
html.dark .agent-avatar {
  background: var(--avatar-dark);
}
</style>
