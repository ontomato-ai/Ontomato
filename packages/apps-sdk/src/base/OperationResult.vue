<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElAlert } from "element-plus/es/components/alert/index";
import { ElRadio, ElRadioGroup } from "element-plus/es/components/radio/index";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";

/**
 * What a read-only operation returned, as its owner described it: Markdown with a preview/source toggle, a JSON value
 * with optional truncation warning shown as formatted read-only JSON, or the name of the file the reader saved (an
 * export). Nothing is written and nothing is reported as changed. The renderers are fetched the first time a result of
 * their kind is shown, never with the panel.
 */
const props = defineProps<{ result: PanelReadOperationResult }>();
const { t } = useI18n();
const MarkdownView = defineAsyncComponent(() => import("@ontomato/foundation-ui/markdown").then((module) => module.MarkdownView));
const CodeEditor = defineAsyncComponent(() => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor));
const markdownMode = ref<"preview" | "source">("preview");
watch(
  () => props.result,
  () => {
    markdownMode.value = "preview";
  },
);
const hasMarkdown = computed(() => props.result.kind === "markdown" && props.result.markdown.trim().length > 0);
const json = computed(() => (props.result.kind === "json" ? JSON.stringify(props.result.value, null, 2) : ""));
const truncation = computed(() => (props.result.kind === "json" ? props.result.truncation ?? null : null));
</script>

<template>
  <div class="sdk-operation-result" role="status">
    <p v-if="result.kind === 'file'" class="sdk-operation-file">{{ t("platform.operationDownloaded", { name: result.name }) }}</p>
    <div v-else-if="result.kind === 'markdown'" class="sdk-operation-markdown">
      <template v-if="hasMarkdown">
        <el-radio-group v-model="markdownMode" size="small" class="sdk-operation-markdown-toggle">
          <el-radio value="preview">{{ t("platform.operationPreview") }}</el-radio>
          <el-radio value="source">{{ t("platform.operationSource") }}</el-radio>
        </el-radio-group>
        <div v-if="markdownMode === 'preview'" class="sdk-operation-markdown-preview">
          <markdown-view :content="result.markdown"></markdown-view>
        </div>
        <code-editor v-else :model-value="result.markdown" language="markdown" readonly :min-height="200"></code-editor>
      </template>
      <p v-else class="sdk-operation-empty">{{ t("platform.operationNoResult") }}</p>
    </div>
    <div v-else class="sdk-operation-json">
      <el-alert
        v-if="truncation"
        type="warning"
        :closable="false"
        :title="t('platform.operationTruncated', { rows: truncation.rowLimit ?? '—' })"
        :description="truncation.hint || undefined"
      ></el-alert>
      <code-editor :model-value="json" language="json" readonly :min-height="120"></code-editor>
    </div>
  </div>
</template>

<style scoped>
.sdk-operation-result {
  margin-block-start: var(--spacing-sm);
}
.sdk-operation-markdown,
.sdk-operation-json {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}
.sdk-operation-markdown-preview {
  max-height: 28rem;
  overflow: auto;
  padding: var(--spacing-md);
  border: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  border-radius: var(--radius-sm, 6px);
  background: var(--sdk-bg-color, var(--el-bg-color));
}
.sdk-operation-empty {
  margin: 0;
  color: var(--sdk-text-color-secondary, var(--el-text-color-secondary));
  font-size: var(--text-xs);
}
</style>
