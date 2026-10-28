<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { rendererFor } from "../artifacts";
import { shellContextKey } from "../context";
import type { ArtifactPresentation } from "../types";
import FileArtifact from "./FileArtifact.vue";

/** Resolves an outputs/ reference within its run and renders it with the host's renderer. */
const props = defineProps<{
  runId: string;
  path: string;
  title: string;
  presentation: ArtifactPresentation;
  /** Already resolved (side panel); skips resolution. */
  artifact?: RuntimeArtifact;
}>();

const shell = inject(shellContextKey)!;
const resolved = ref<RuntimeArtifact | null>(props.artifact ?? null);
const state = ref<"loading" | "ready" | "missing" | "error">(props.artifact ? "ready" : "loading");
let request = 0;

async function resolve() {
  if (props.artifact) return;
  const current = ++request;
  try {
    const artifact = await shell.resolveArtifact(props.runId, props.path);
    if (current !== request) return;
    resolved.value = artifact;
    state.value = artifact ? "ready" : "missing";
  } catch {
    if (current === request) state.value = "error";
  }
}

watch(() => [props.runId, props.path], resolve, { immediate: true });
// A reference may stream before its file is registered; retry while unresolved.
watch(shell.artifactRevision, () => {
  if (state.value !== "ready") void resolve();
});

const renderer = computed(() => rendererFor(props.path, shell.renderers.value));
const read = () => shell.readArtifact(resolved.value!);
</script>

<template>
  <div v-if="state === 'loading'" class="artifact-pending" :class="presentation" aria-busy="true">
    <span class="shimmer" />
  </div>
  <div v-else-if="state !== 'ready' || !resolved" class="artifact-missing">
    {{ shell.labels.value.artifactMissing }} · {{ path }}
  </div>
  <component
    :is="renderer.component"
    v-else-if="renderer"
    :artifact="resolved"
    :title="title"
    :presentation="presentation"
    :read="read"
  />
  <FileArtifact v-else :artifact="resolved" :title="title" :presentation="presentation" :read="read" />
</template>

<style scoped>
.artifact-pending {
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  background: var(--el-fill-color-light);
  height: 72px;
}
.artifact-pending.inline {
  height: 220px;
}
.shimmer {
  display: block;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--el-fill-color) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.artifact-missing {
  padding: 10px 14px;
  border: 1px dashed var(--el-border-color-dark);
  border-radius: var(--radius-lg, 12px);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  overflow-wrap: anywhere;
}
@keyframes shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
  }
}
</style>
