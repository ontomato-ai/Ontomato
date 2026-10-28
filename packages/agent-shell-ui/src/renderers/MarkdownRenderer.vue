<script setup lang="ts">
import { inject } from "vue";
import ShellMarkdown from "../components/ShellMarkdown.vue";
import { shellContextKey } from "../context";
import type { ArtifactRendererProps } from "../types";
import { useArtifactText } from "./useArtifactBlob";

/** Reports and notes: rendered like an answer, so their own outputs/ references resolve in their run. */
const props = defineProps<ArtifactRendererProps>();
const shell = inject(shellContextKey)!;
const { text, error } = useArtifactText(props);
</script>

<template>
  <div class="markdown-renderer-file" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ shell.labels.value.loading }}</div>
    <ShellMarkdown v-else :content="text" :final="true" :run-id="artifact.runId" />
  </div>
</template>

<style scoped>
.markdown-renderer-file.inline {
  max-height: 420px;
  overflow: auto;
  padding: 14px 18px;
}
.markdown-renderer-file.panel {
  padding: 4px 6px 24px;
}
.state {
  padding: 18px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}
.state.error {
  color: var(--el-color-danger);
}
</style>
