<script setup lang="ts">
import { computed } from "vue";
import { ParagraphNode } from "@ontomato/foundation-ui/markdown";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";

/**
 * A paragraph whose children include files of the reply's run. Those draw as blocks, so punctuation the reply wrote
 * between two of them has no inline text to share a line with and would stand alone on one. A child that is only
 * separator punctuation, with a block on each side, is left out; the blocks' own spacing separates them. A run carrying
 * words is the reply's own text and is drawn as written, and so is everything outside such a run.
 */
defineOptions({ inheritAttrs: false });

interface MarkdownChild {
  type: string;
  raw: string;
  content?: string;
  href?: string;
  src?: string;
  [key: string]: unknown;
}

const props = defineProps<{
  node: { type: "paragraph"; children: readonly MarkdownChild[]; raw: string };
}>();

/** Punctuation a reply puts between two things, with no word of its own. */
const separatorOnly = /^[\s·•,，、|/]+$/;

/** A link or image of the run's own files, which the shell draws as a block. */
function isRunFile(child: MarkdownChild | undefined): boolean {
  if (!child) return false;
  const target = child.type === "link" ? child.href : child.type === "image" ? child.src : undefined;
  return target !== undefined && artifactPath(String(target)) !== null;
}

const node = computed(() => ({
  ...props.node,
  children: props.node.children.filter((child, index, all) => !(
    child.type === "text" &&
    separatorOnly.test(String(child.content ?? "")) &&
    isRunFile(all[index - 1]) &&
    isRunFile(all[index + 1])
  )),
}));
</script>

<template>
  <ParagraphNode v-bind="$attrs" :node="node" />
</template>
