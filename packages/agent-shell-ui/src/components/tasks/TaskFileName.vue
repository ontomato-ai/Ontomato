<script setup lang="ts">
import { computed } from "vue";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { fileName, plainText, type InlineMarkdownNode } from "../../artifacts";

/**
 * A task's own text names its files as plain names: they belong to the task's run, not to this conversation, so they
 * are neither resolved nor opened here. Web links stay links.
 */
const props = defineProps<{
  node: { href?: string; src?: string; text?: string; alt?: string; title: string | null; children?: readonly InlineMarkdownNode[]; loading?: boolean };
}>();
const path = computed(() => artifactPath(props.node.href ?? props.node.src ?? ""));
/** The label's words, not its Markdown marks: a title like `*Last Question*` reads as Last Question. */
const label = computed(() => plainText(props.node.children ?? []) || props.node.text || props.node.alt || "");
const web = computed(() => (props.node.href && /^https?:/i.test(props.node.href) ? props.node.href : null));
</script>

<template>
  <a v-if="!path && web" :href="web" target="_blank" rel="noopener noreferrer">{{ label }}</a>
  <code v-else-if="path" class="task-file">{{ fileName(path) }}</code>
  <span v-else>{{ label }}</span>
</template>

<style scoped>
.task-file {
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--el-fill-color);
  font-size: 0.92em;
}
a {
  color: var(--el-color-primary);
}
</style>
