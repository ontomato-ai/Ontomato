<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { ArtifactMarkdown, type ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { useArtifactText } from "./useArtifactBlob";

/** Reports and notes: rendered like an answer, so embedded outputs/ references work too. */
const props = defineProps<ArtifactRendererProps>();
const { t } = useI18n();
const { text, error } = useArtifactText(props);
</script>

<template>
  <div class="markdown-artifact" :class="presentation">
    <div v-if="error" class="state error">{{ error }}</div>
    <div v-else-if="text === null" class="state">{{ t("assistant.loading") }}</div>
    <ArtifactMarkdown v-else :content="text" :run-id="artifact.runId" />
  </div>
</template>

<style scoped>
.markdown-artifact.inline {
  max-height: 420px;
  overflow: auto;
  padding: 14px 18px;
}
.markdown-artifact.panel {
  padding: 4px 6px 24px;
}
.state {
  padding: 18px;
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm);
}
.state.error {
  color: var(--el-color-danger);
}
</style>
