<script setup lang="ts">
import type { ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { useArtifactUrl } from "./useArtifactBlob";

/** Raster and SVG images; SVG loads through <img>, so its scripts never run. */
const props = defineProps<ArtifactRendererProps>();
const { url, error } = useArtifactUrl(props);
</script>

<template>
  <div class="image-artifact" :class="presentation">
    <div v-if="error" class="state">{{ error }}</div>
    <img v-else-if="url" :src="url" :alt="title" />
  </div>
</template>

<style scoped>
.image-artifact {
  display: flex;
  justify-content: center;
  padding: 12px;
  min-height: 80px;
}
img {
  max-width: 100%;
  max-height: 480px;
  border-radius: 8px;
  object-fit: contain;
}
.panel img {
  max-height: none;
}
.state {
  color: var(--el-color-danger);
  font-size: var(--text-sm);
}
</style>
