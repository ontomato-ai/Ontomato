<script setup lang="ts">
import { computed, provide } from "vue";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { messageContextKey } from "../context";
import ArtifactImageNode from "./ArtifactImageNode.vue";
import ArtifactLinkNode from "./ArtifactLinkNode.vue";
import ArtifactParagraphNode from "./ArtifactParagraphNode.vue";

/** A run's `outputs/` files and the host's page addresses are the conversation's own: its nodes draw them. */
const artifactNodes = { image: ArtifactImageNode, link: ArtifactLinkNode, paragraph: ArtifactParagraphNode };

/** One assistant text block in the product Markdown; files go through renderers. */
const props = defineProps<{ content: string; final: boolean; runId: string }>();
// Artifact links render as blocks, so a trailing sentence mark must not occupy its own line.
const displayContent = computed(() => props.content.replace(
  /完整分析见\s*[：:]?\s*(\[[^\]\n]+\]\((?:\.\/)?outputs\/[^\n)]+\))/g,
  "\n\n完整分析见：\n$1",
).replace(
  /(\[[^\]\n]+\]\(outputs\/[^\n)]+\))[。.!！](?=\s*(?:\n|$))/g,
  "$1",
));
provide(
  messageContextKey,
  computed(() => ({ runId: props.runId })),
);
</script>

<template>
  <MarkdownView class="shell-markdown" :content="displayContent" :final="final" :nodes="artifactNodes" />
</template>
