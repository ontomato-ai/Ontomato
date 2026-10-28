<script setup lang="ts">
import { computed, provide } from "vue";
import MarkdownRender, { setCustomComponents } from "markstream-vue";
import { messageContextKey } from "../context";
import { SHELL_MARKDOWN_ID, shellParseOptions } from "../markdown";
import ArtifactImageNode from "./ArtifactImageNode.vue";
import ArtifactLinkNode from "./ArtifactLinkNode.vue";

setCustomComponents(SHELL_MARKDOWN_ID, { image: ArtifactImageNode, link: ArtifactLinkNode });

/** Standard Markdown of one assistant text block; raw HTML is escaped, files go through renderers. */
const props = defineProps<{ content: string; final: boolean; runId: string }>();
provide(
  messageContextKey,
  computed(() => ({ runId: props.runId })),
);
</script>

<template>
  <MarkdownRender
    class="shell-markdown"
    :custom-id="SHELL_MARKDOWN_ID"
    :content="content"
    :final="final"
    :parse-options="shellParseOptions"
    mode="chat"
    html-policy="escape"
    :render-code-blocks-as-pre="true"
    :fade="false"
  />
</template>
