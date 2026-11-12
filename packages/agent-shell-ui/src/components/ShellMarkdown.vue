<script setup lang="ts">
import { computed, provide } from "vue";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { messageContextKey } from "../context";
import ArtifactImageNode from "./ArtifactImageNode.vue";
import ArtifactLinkNode from "./ArtifactLinkNode.vue";

/** A run's `outputs/` files and the host's page addresses are the conversation's own: its nodes draw them. */
const artifactNodes = { image: ArtifactImageNode, link: ArtifactLinkNode };

/** One `outputs/` reference, a link or an image, with its own brackets and destination. */
const reference = String.raw`!?\[[^\]\n]+\]\((?:\./)?outputs/[^\n)]+\)`;
/** One reference, what the reply wrote after it on that line, then another reference. */
const beforeAnotherReference = new RegExp(`(${reference})([^\\[\\n]*?)(?=${reference})`, "g");
/** Text that is only separator punctuation, carrying no word of its own. */
const separatorOnly = /^[\s·•,，、|/]+$/;

/**
 * Artifact references draw as blocks, so a separator the reply wrote between two of them has no inline text to share a
 * line with and would stand alone on one. That run is dropped and the two blocks follow each other; a run carrying
 * words is the reply's own text and stays. Each pass joins one pair, so a row of three takes two passes.
 */
function joinSeparatedReferences(text: string): string {
  let joined = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = joined.replace(beforeAnotherReference, (whole, before: string, between: string) =>
      separatorOnly.test(between) ? `${before}\n\n` : whole,
    );
    if (next === joined) break;
    joined = next;
  }
  return joined;
}

/** The same, leaving fenced code alone: there the reply shows Markdown as text, and its separators are content. */
function dropSeparatorRuns(content: string): string {
  return content
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((part, index) => (index % 2 === 1 ? part : joinSeparatedReferences(part)))
    .join("");
}

/** One assistant text block in the product Markdown; files go through renderers. */
const props = defineProps<{ content: string; final: boolean; runId: string }>();
// Artifact links render as blocks, so a trailing sentence mark must not occupy its own line.
const displayContent = computed(() => dropSeparatorRuns(props.content.replace(
  /完整分析见\s*[：:]?\s*(\[[^\]\n]+\]\((?:\.\/)?outputs\/[^\n)]+\))/g,
  "\n\n完整分析见：\n$1",
).replace(
  /(\[[^\]\n]+\]\(outputs\/[^\n)]+\))[。.!！](?=\s*(?:\n|$))/g,
  "$1",
)));
provide(
  messageContextKey,
  computed(() => ({ runId: props.runId })),
);
</script>

<template>
  <MarkdownView class="shell-markdown" :content="displayContent" :final="final" :nodes="artifactNodes" />
</template>
