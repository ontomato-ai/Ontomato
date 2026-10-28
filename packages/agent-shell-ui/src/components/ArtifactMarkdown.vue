<script setup lang="ts">
import ShellMarkdown from "./ShellMarkdown.vue";

/** A Markdown file rendered like a message, so its own outputs/ references resolve in its run. */
defineProps<{ content: string; runId: string }>();
</script>

<template>
  <ShellMarkdown :content="content" :final="true" :run-id="runId" />
</template>
