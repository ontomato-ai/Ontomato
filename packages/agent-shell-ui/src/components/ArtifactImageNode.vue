<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { Maximize2 } from "lucide-vue-next";
import { artifactPath } from "@ontomato/contracts/agent-artifact-markdown";
import { fileName } from "../artifacts";
import { messageContextKey, shellContextKey } from "../context";
import ArtifactView from "./ArtifactView.vue";
import SlotOutlet from "./SlotOutlet.vue";

/** markstream image node: outputs/ files render inline through the host renderer. */
const props = defineProps<{
  node: { src: string; alt: string; title: string | null; loading?: boolean };
}>();
const shell = inject(shellContextKey)!;
const message = inject(messageContextKey)!;
const path = computed(() => (props.node.loading ? null : artifactPath(props.node.src)));
const title = computed(() => props.node.alt || (path.value ? fileName(path.value) : ""));

const artifact = ref<RuntimeArtifact | null>(null);
async function resolve() {
  if (!path.value || artifact.value) return;
  artifact.value = await shell.resolveArtifact(message.value.runId, path.value).catch(() => null);
}
watch([path, shell.artifactRevision], resolve, { immediate: true });

function expand() {
  if (path.value && artifact.value)
    shell.openArtifact({ key: `${message.value.runId}:${path.value}`, artifact: artifact.value, title: title.value });
}
</script>

<template>
  <span v-if="node.loading" class="inline-artifact pending" aria-busy="true" />
  <figure v-else-if="path" class="inline-artifact">
    <figcaption class="inline-caption">
      <span class="inline-title">{{ title }}</span>
      <SlotOutlet v-if="artifact" :slot="shell.slots.artifactActions" :scope="{ artifact }" />
      <button
        type="button"
        class="inline-expand"
        :title="shell.labels.value.open"
        :aria-label="shell.labels.value.open"
        @click="expand"
      >
        <Maximize2 :size="14" />
      </button>
    </figcaption>
    <ArtifactView
      :key="`${message.runId}:${path}`"
      :run-id="message.runId"
      :path="path"
      :title="title"
      presentation="inline"
    />
  </figure>
  <img v-else class="external-image" :src="node.src" :alt="node.alt" loading="lazy" />
</template>

<style scoped>
.inline-artifact {
  display: block;
  white-space: normal;
  line-height: 1.5;
  margin: 12px 0;
  padding: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-xl, 14px);
  background: var(--el-bg-color);
  overflow: hidden;
}
.inline-artifact.pending {
  height: 240px;
  background: var(--el-fill-color-light);
}
.inline-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 8px 8px 14px;
  border-bottom: 1px solid var(--el-border-color-light);
}
.inline-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inline-expand {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.inline-expand:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.inline-expand:focus-visible {
  outline: 2px solid var(--el-color-primary);
}
.inline-artifact :deep(.artifact-pending),
.inline-artifact :deep(.artifact-missing) {
  margin: 12px;
}
.external-image {
  max-width: 100%;
  border-radius: var(--radius-lg, 12px);
}
</style>
