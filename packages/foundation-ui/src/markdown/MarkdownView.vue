<script lang="ts">
import { setCustomComponents } from "markstream-vue";
import type { Component } from "vue";
import MarkdownTable from "./MarkdownTable.vue";

type Nodes = Partial<Record<"link" | "image", Component>>;

const registered: { nodes: Nodes; id: string }[] = [];

/**
 * markstream looks node components up by an id: each set of components is registered once, the first time it is drawn.
 * Every set draws tables with MarkdownTable.
 */
function nodesId(nodes: Nodes): string {
  const known = registered.find((entry) => entry.nodes.link === nodes.link && entry.nodes.image === nodes.image);
  if (known) return known.id;
  const id = `markdown-view-${registered.length + 1}`;
  setCustomComponents(id, { ...nodes, table: MarkdownTable });
  registered.push({ nodes, id });
  return id;
}
</script>

<script setup lang="ts">
import { computed } from "vue";
import MarkdownRender from "markstream-vue";
import { productMarkdown } from "@ontomato/markdown";
import { useDarkMode } from "../theme";

/**
 * Draws a text in the product Markdown (@ontomato/markdown), the one definition pages and exports read it with: GFM,
 * a single newline is a line break, only `~~` strikes through, raw HTML and syntax beyond GFM show as written. Code
 * blocks are plain preformatted text in the page's light or dark theme. What an address means (a run's files, an app
 * page, a document of the caller's own) belongs to the caller, through `nodes`.
 */
const props = withDefaults(
  defineProps<{
    /** The text to draw, in the product Markdown. */
    content: string;
    /** False while the text is still arriving: an unfinished link or image at its end reaches its node as `loading`. */
    final?: boolean;
    /** Components that draw links or images instead of the default ones; each receives the parsed `node`. */
    nodes?: Nodes;
  }>(),
  { final: true },
);
const customId = computed(() => nodesId(props.nodes ?? {}));
// The stylesheet follows the `dark` class by itself; markstream picks a code block's colours from this property only.
const isDark = useDarkMode();
</script>

<template>
  <MarkdownRender
    class="markdown-view"
    :custom-id="customId"
    :content="content"
    :final="final"
    :custom-markdown-it="productMarkdown"
    :is-dark="isDark"
    mode="chat"
    html-policy="escape"
    :render-code-blocks-as-pre="true"
    :fade="false"
  />
</template>

<style>
@import "markstream-vue/index.css";

/*
 * markstream derives its colours from HSL triplets; they are mapped onto the host's design tokens so light and dark
 * themes follow the page. Markdown is long text: it reads in the `reading` type role, 15px on a 26px line, with
 * semibold headings, tabular table figures and monospace code (DESIGN.md "Foundation tokens"). Spacing between blocks
 * is the container's. These rules follow markstream's stylesheet in this one file, so they win where both set a value.
 */
.markstream-vue.markdown-view {
  --ms-text-body: var(--text-reading);
  --ms-leading-body: 1.733;
  --ms-font-sans: var(--font-sans, inherit);
  --ms-font-mono: var(--font-mono, ui-monospace, monospace);
  --ms-radius: var(--radius-md);
  --link-color: var(--brand-link);
  --table-border: var(--el-border-color);
  --table-header-bg: var(--el-fill-color-lighter);
  --inline-code-bg: var(--el-fill-color);
  --inline-code-fg: var(--el-text-color-primary);
  --inline-code-border: transparent;
  --code-bg: var(--el-fill-color);
  --code-fg: var(--el-text-color-primary);
  --code-border: var(--el-border-color);
  --code-header-bg: var(--el-fill-color-light);
  --blockquote-border: var(--el-border-color-dark);
  --hr-border: var(--el-border-color);
  --list-marker: var(--el-text-color-tertiary);
  --list-counter-marker: var(--el-text-color-secondary);
  color: var(--el-text-color-primary);
  overflow-wrap: anywhere;
}
.markstream-vue.markdown-view :is(h1, h2, h3, h4, h5, h6) {
  font-weight: var(--font-semibold);
}
.markstream-vue.markdown-view :is(h1, h2, h3, h4) {
  color: var(--el-text-color-primary);
  letter-spacing: -0.005em;
  line-height: 1.35;
}
.markstream-vue.markdown-view h1 {
  font-size: 1.45em;
}
.markstream-vue.markdown-view h2 {
  font-size: 1.25em;
}
.markstream-vue.markdown-view h3 {
  font-size: 1.1em;
}
.markstream-vue.markdown-view strong {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.markstream-vue.markdown-view table {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.markstream-vue.markdown-view pre {
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-mono);
  line-height: var(--leading-mono);
}
</style>
