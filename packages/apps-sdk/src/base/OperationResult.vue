<script setup lang="ts">
import { computed, defineAsyncComponent } from "vue";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";

/**
 * What a read-only operation returned, as its owner described it: Markdown drawn as the product's Markdown, or a JSON
 * value shown as formatted, read-only JSON. Nothing is saved and nothing is reported as changed. The renderers are
 * fetched the first time a result of their kind is shown, never with the panel.
 */
const props = defineProps<{ result: PanelReadOperationResult }>();
const MarkdownView = defineAsyncComponent(() => import("@ontomato/foundation-ui/markdown").then((module) => module.MarkdownView));
const CodeEditor = defineAsyncComponent(() => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor));
const json = computed(() => (props.result.kind === "json" ? JSON.stringify(props.result.value, null, 2) : ""));
</script>

<template>
  <div class="sdk-operation-result" role="status">
    <markdown-view v-if="result.kind === 'markdown'" :content="result.markdown"></markdown-view>
    <code-editor v-else :model-value="json" language="json" readonly :min-height="80"></code-editor>
  </div>
</template>

<style scoped>
.sdk-operation-result {
  margin-block-start: 8px;
}
</style>
