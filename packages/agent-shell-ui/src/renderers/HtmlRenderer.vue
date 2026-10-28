<script setup lang="ts">
import type { ArtifactRendererProps } from "../types";
import { useArtifactText } from "./useArtifactBlob";

/**
 * Agent HTML runs in an opaque-origin sandbox: scripts only, no same-origin, forms, popups or
 * top navigation, so it cannot read the workbench session.
 */
const props = defineProps<ArtifactRendererProps>();
const { text, error } = useArtifactText(props);
</script>

<template>
  <div class="html-artifact" :class="presentation">
    <div v-if="error" class="state">{{ error }}</div>
    <iframe v-else-if="text !== null" :srcdoc="text" sandbox="allow-scripts" :title="title" referrerpolicy="no-referrer" />
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
  border-radius: 10px;
}
.state {
  padding: 18px;
  color: var(--el-color-danger);
  font-size: var(--text-sm, 13px);
}
</style>
