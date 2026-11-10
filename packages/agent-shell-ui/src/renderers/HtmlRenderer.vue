<script setup lang="ts">
import type { ArtifactRendererProps } from "../types";
import { useArtifactText } from "./useArtifactBlob";
import { computed } from "vue";
import { useChartTheme } from "@ontomato/foundation-ui/chart";
import { themedChartHtml } from "@ontomato/contracts/chart-presentation";

/**
 * Agent HTML runs in an opaque-origin sandbox: scripts only, no same-origin, forms, popups or
 * top navigation, so it cannot read the workbench session.
 */
const props = defineProps<ArtifactRendererProps>();
const { text, error } = useArtifactText(props);
const theme = useChartTheme();
// Read again with the theme when the page switches mode, so the variables are the new mode's.
const html = computed(() => {
  const css = getComputedStyle(document.documentElement);
  const properties = Object.fromEntries(Array.from(css).filter((key) => key.startsWith("--el-") || key.startsWith("--chart-")).map((key) => [key, css.getPropertyValue(key).trim()]));
  return themedChartHtml(text.value ?? "", theme.value, properties);
});
</script>

<template>
  <div class="html-artifact" :class="presentation">
    <div v-if="error" class="state">{{ error }}</div>
    <iframe v-else-if="text !== null" :srcdoc="html" sandbox="allow-scripts" :title="title" referrerpolicy="no-referrer" />
  </div>
</template>

<style scoped>
.html-artifact iframe {
  display: block;
  width: 100%;
  height: 380px;
  border: 0;
  background: #fff;
}
.panel iframe {
  height: calc(100vh - 140px);
  border-radius: var(--radius-md);
}
.state {
  padding: 18px;
  color: var(--el-color-danger);
  font-size: var(--text-sm, 13px);
}
</style>
