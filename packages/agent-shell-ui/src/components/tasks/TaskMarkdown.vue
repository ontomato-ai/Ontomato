<script setup lang="ts">
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import TaskFileName from "./TaskFileName.vue";

/** A task's own text in the product Markdown, with its files as names only. */
defineProps<{ content: string; final: boolean }>();
const nodes = { image: TaskFileName, link: TaskFileName };
</script>

<template>
  <MarkdownView class="shell-markdown" :content="content" :final="final" :nodes="nodes" />
</template>
