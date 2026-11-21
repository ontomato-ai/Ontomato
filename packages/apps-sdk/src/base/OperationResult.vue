<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import { useI18n } from "vue-i18n";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";

/**
 * What a read-only operation returned, as its owner described it: Markdown drawn as the product's Markdown, a JSON
 * value shown as formatted, read-only JSON, or the name of the file the reader saved (an export). Nothing is written
 * and nothing is reported as changed. The renderers are
 * fetched the first time a result of their kind is shown, never with the panel.
 */
const props = defineProps<{ result: PanelReadOperationResult }>();
const { t } = useI18n();
const MarkdownView = defineAsyncComponent(() => import("@ontomato/foundation-ui/markdown").then((module) => module.MarkdownView));
const CodeEditor = defineAsyncComponent(() => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor));
const json = computed(() => (props.result.kind === "json" ? JSON.stringify(props.result.value, null, 2) : ""));
</script>

<template>
  <div class="sdk-operation-result" role="status">
    <p v-if="result.kind === 'file'" class="sdk-operation-file">{{ t("platform.operationDownloaded", { name: result.name }) }}</p>
    <markdown-view v-else-if="result.kind === 'markdown'" :content="result.markdown"></markdown-view>
    <code-editor v-else :model-value="json" language="json" readonly :min-height="80"></code-editor>
  </div>
</template>

<style scoped>
.sdk-operation-result {
  margin-block-start: var(--spacing-sm);
}
</style>
