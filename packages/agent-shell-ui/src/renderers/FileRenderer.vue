<script setup lang="ts">
import { computed, inject } from "vue";
import { Download, FileText, Presentation } from "lucide-vue-next";
import { fileKind, fileName, formatSize } from "../artifacts";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import { useArtifactDownload } from "../useArtifactDownload";

/** Fallback for extensions without a registered renderer: name, size and download. */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const ppt = computed(() => fileKind(props.artifact.path) === "pptx");
const { saving, failed, download } = useArtifactDownload(() => props.read());
</script>

<template>
  <div class="file-artifact">
    <span class="file-icon"><Presentation v-if="ppt" :size="18" /><FileText v-else :size="18" /></span>
    <span class="file-text">
      <span class="file-title">{{ title || fileName(artifact.path) }}</span>
      <span class="file-meta">{{ fileKind(artifact.path).toUpperCase() }} · {{ formatSize(artifact.size) }}</span>
    </span>
    <button type="button" class="file-download" :disabled="saving" :aria-busy="saving" @click="download(artifact)">
      <Download :size="15" />
      <span>{{ saving ? shell.labels.value.loading : (ppt ? shell.labels.value.downloadPptx : undefined) ?? shell.labels.value.download }}</span>
    </button>
  </div>
  <p v-if="failed" class="file-error" role="alert">{{ shell.labels.value.downloadFailed ?? shell.labels.value.loadFailed }}</p>
</template>

<style scoped>
.file-artifact {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg, 12px);
  background: var(--el-bg-color);
}
.file-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
}
.file-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.file-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-meta {
  font-size: var(--text-xs, 11px);
  color: var(--el-text-color-secondary);
}
.file-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--el-border-color);
  background: transparent;
  color: var(--el-text-color-regular);
  border-radius: 999px;
  padding: 6px 12px;
  font: inherit;
  font-size: var(--text-sm, 13px);
  cursor: pointer;
}
.file-download:hover {
  background: var(--el-fill-color);
}
.file-error { color: var(--el-color-danger); font-size: var(--text-sm, 13px); }
.file-download:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
