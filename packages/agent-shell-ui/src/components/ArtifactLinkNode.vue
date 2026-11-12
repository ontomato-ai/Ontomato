<script setup lang="ts">
import { computed, inject } from "vue";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { plainText, type InlineMarkdownNode } from "../artifacts";
import { messageContextKey, shellContextKey } from "../context";
import ArtifactCard from "./ArtifactCard.vue";

/** markstream link node: outputs/ files become side-panel cards; web links stay links. */
const props = defineProps<{
  node: { href: string; title: string | null; text: string; children: readonly InlineMarkdownNode[]; loading?: boolean };
}>();
const message = inject(messageContextKey)!;
const shell = inject(shellContextKey)!;
const path = computed(() => (props.node.loading ? null : artifactPath(props.node.href)));
const label = computed(() => plainText(props.node.children));
/** Relative app addresses the host recognises open their page beside the conversation. */
const openPage = computed(() => (props.node.loading || path.value ? null : shell.pageLink(props.node.href)));
const safeHref = computed(() => (/^(https?:|mailto:)/i.test(props.node.href) ? props.node.href : null));
</script>

<template>
  <span v-if="node.loading" class="link-pending">{{ node.text }}</span>
  <ArtifactCard
    v-else-if="path"
    :key="`${message.runId}:${path}`"
    :run-id="message.runId"
    :path="path"
    :title="label"
  />
  <a v-else-if="openPage" :href="node.href" class="page-link" @click.prevent="openPage()">{{ node.text }}</a>
  <a v-else-if="safeHref" :href="safeHref" :title="node.title ?? undefined" target="_blank" rel="noopener noreferrer">{{
    node.text
  }}</a>
  <span v-else>{{ node.text }}</span>
</template>

<style scoped>
.link-pending {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
  border-radius: 6px;
  padding: 0 4px;
}
a {
  color: var(--el-color-primary);
  text-decoration: underline;
  text-decoration-color: var(--el-color-primary-light-5);
  text-underline-offset: 3px;
}
a:hover {
  text-decoration-color: currentColor;
}
</style>
