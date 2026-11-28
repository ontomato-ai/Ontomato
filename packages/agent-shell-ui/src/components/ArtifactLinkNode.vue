<script setup lang="ts">
import { computed, inject, shallowRef, watch } from "vue";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { plainText, type InlineMarkdownNode } from "../artifacts";
import { messageContextKey, shellContextKey } from "../context";
import type { ArtifactLinkSlotScope } from "../types";
import ArtifactCard from "./ArtifactCard.vue";
import PptArtifactCard from "./PptArtifactCard.vue";
import SlotOutlet from "./SlotOutlet.vue";

/** markstream link node: outputs/ files become side-panel cards; web links stay links. */
const props = defineProps<{
  node: { href: string; title: string | null; text: string; children: readonly InlineMarkdownNode[]; loading?: boolean };
}>();
const message = inject(messageContextKey)!;
const shell = inject(shellContextKey)!;
const path = computed(() => (props.node.loading ? null : artifactPath(props.node.href)));
const label = computed(() => plainText(props.node.children));
const openPage = computed(() => (props.node.loading || path.value ? null : shell.pageLink(props.node.href)));
const safeHref = computed(() => (/^(https?:|mailto:)/i.test(props.node.href) ? props.node.href : null));

const resolvedArtifact = shallowRef<RuntimeArtifact | null>(null);
watch(
  [() => Boolean(shell.slots?.artifactLink), () => message.value.runId, path, shell.artifactRevision],
  async ([hasSlot, runId, currentPath], previous, onCleanup) => {
    if (!hasSlot || !currentPath) {
      resolvedArtifact.value = null;
      return;
    }
    if (previous?.[1] !== runId || previous?.[2] !== currentPath) resolvedArtifact.value = null;
    let active = true;
    onCleanup(() => { active = false; });
    const next = await shell.resolveArtifact(runId, currentPath).catch(() => null);
    if (active) resolvedArtifact.value = next;
  },
  { immediate: true },
);

const linkSlotScope = computed<ArtifactLinkSlotScope>(() => {
  const currentPath = path.value!;
  const runId = message.value.runId;
  const title = label.value;
  return {
    node: props.node,
    runId,
    path: currentPath,
    title,
    artifact: resolvedArtifact.value,
    open: () => {
      if (!resolvedArtifact.value) return;
      shell.openArtifact({ key: `${runId}:${currentPath}`, artifact: resolvedArtifact.value, title });
    },
    fallback: {
      component: /\.pptx$/i.test(currentPath) ? PptArtifactCard : ArtifactCard,
      props: { runId, path: currentPath, title },
    },
  };
});
</script>

<template>
  <span v-if="node.loading" class="link-pending">{{ node.text }}</span>
  <span v-else-if="path && shell.inlineArtifactAlreadyShown?.(message.runId, path)">{{ label }}</span>
  <SlotOutlet
    v-else-if="path && shell.slots?.artifactLink"
    :key="`${message.runId}:${path}`"
    :content="shell.slots.artifactLink"
    :scope="linkSlotScope"
  />
  <PptArtifactCard
    v-else-if="path && /\.pptx$/i.test(path)"
    :key="message.runId + ':' + path"
    :run-id="message.runId"
    :path="path"
    :title="label"
  />
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
