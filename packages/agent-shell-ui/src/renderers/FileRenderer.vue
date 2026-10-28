<script setup lang="ts">
import { inject, ref } from "vue";
import { Download, FileText } from "lucide-vue-next";
import { fileKind, fileName, formatSize, saveBlob } from "../artifacts";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";

/** Fallback for extensions without a registered renderer: name, size and download. */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const saving = ref(false);

async function download() {
  saving.value = true;
  try {
    saveBlob(await props.read(), fileName(props.artifact.path));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="file-artifact">
    <span class="file-icon"><FileText :size="18" /></span>
    <span class="file-text">
      <span class="file-title">{{ title || fileName(artifact.path) }}</span>
      <span class="file-meta">{{ fileKind(artifact.path).toUpperCase() }} · {{ formatSize(artifact.size) }}</span>
    </span>
    <button type="button" class="file-download" :disabled="saving" @click="download">
      <Download :size="15" />
      <span>{{ shell.labels.value.download }}</span>
    </button>
  </div>
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
  border-radius: 10px;
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
.file-download:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
