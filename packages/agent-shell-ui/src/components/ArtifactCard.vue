<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { ChevronRight } from "lucide-vue-next";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { fileKind, fileName, formatSize } from "../artifacts";
import { shellContextKey } from "../context";
import { artifactIcon } from "../icons";

/** A Markdown link to an outputs/ file: a card that opens the file in the side panel. */
const props = defineProps<{ runId: string; path: string; title: string }>();
const shell = inject(shellContextKey)!;
const artifact = ref<RuntimeArtifact | null>(null);
const missing = ref(false);
const key = computed(() => `${props.runId}:${props.path}`);
const active = computed(() => shell.openArtifactKey.value === key.value);
const icon = computed(() => artifactIcon(props.path));

async function resolve() {
  try {
    artifact.value = await shell.resolveArtifact(props.runId, props.path);
    missing.value = artifact.value === null;
  } catch {
    missing.value = true;
  }
}
watch(key, resolve, { immediate: true });
watch(shell.artifactRevision, () => {
  if (!artifact.value) void resolve();
});

function open() {
  if (artifact.value)
    shell.openArtifact({ key: key.value, artifact: artifact.value, title: props.title });
}
</script>

<template>
  <button
    type="button"
    class="artifact-card"
    :class="{ active, missing }"
    :disabled="!artifact"
    :aria-pressed="active"
    @click="open"
  >
    <span class="artifact-card__icon" :data-kind="fileKind(path)"><component :is="icon" :size="18" /></span>
    <span class="artifact-card__text">
      <span class="artifact-card__title">{{ title || fileName(path) }}</span>
      <span class="artifact-card__meta">
        <template v-if="missing">{{ shell.labels.value.artifactMissing }}</template>
        <template v-else>
          {{ fileKind(path).toUpperCase() }}<template v-if="artifact"> · {{ formatSize(artifact.size) }}</template>
        </template>
      </span>
    </span>
    <ChevronRight v-if="artifact" :size="16" class="artifact-card__chevron" />
  </button>
</template>

<style scoped>
.artifact-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(100%, 380px);
  margin: 2px 0;
  padding: 10px 12px 10px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-lg, 12px);
  background: var(--el-bg-color);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  vertical-align: middle;
  /* Rendered inside Markdown paragraphs, which preserve whitespace. */
  white-space: normal;
  line-height: 1.4;
  transition:
    border-color var(--transition-fast, 150ms),
    box-shadow var(--transition-fast, 150ms),
    background-color var(--transition-fast, 150ms);
}
.artifact-card:hover:not(:disabled) {
  border-color: var(--el-border-color-dark);
  box-shadow: var(--el-shadow-sm);
}
.artifact-card.active {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}
.artifact-card:disabled {
  cursor: default;
}
.artifact-card:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.artifact-card__icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 10px;
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}
.missing .artifact-card__icon {
  color: var(--el-text-color-tertiary);
}
.artifact-card__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.artifact-card__title {
  font-size: var(--text-sm, 13px);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-card__meta {
  font-size: var(--text-xs, 11px);
  color: var(--el-text-color-secondary);
  letter-spacing: 0.02em;
}
.artifact-card__chevron {
  color: var(--el-text-color-tertiary);
  flex-shrink: 0;
}
</style>
