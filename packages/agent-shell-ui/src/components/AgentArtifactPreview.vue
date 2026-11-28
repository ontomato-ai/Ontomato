<script setup lang="ts">
import { computed, provide, reactive, ref, shallowRef, toRef, useSlots, watch } from "vue";
import { X } from "lucide-vue-next";
import type { AgentArtifactTarget } from "@ontomato/contracts/agent-host";
import type { DisplayLoad } from "@ontomato/contracts/agent-presentation";
import { fileName } from "../artifacts";
import {
  artifactTargetOf,
  nameArtifactInTrail,
  popArtifactTrail,
  pushArtifactTrail,
  sameArtifactTarget,
} from "../artifact-trail";
import { shellContextKey, type QuestionView, type ShellQuestions } from "../context";
import type { AgentHostClient } from "../host";
import type {
  ArtifactRendererOverride,
  OpenArtifact,
  ShellLabels,
  ToolRendererOverride,
} from "../types";
import ArtifactPreviewCore from "./ArtifactPreviewCore.vue";

/**
 * Standalone artifact preview block sharing the exact preview core and trail navigation with `AgentShell`.
 * Resolves serializable `AgentArtifactTarget` values via `AgentHostClient` and emits `update:artifact` on close or
 * nested artifact navigation.
 */
const props = withDefaults(
  defineProps<{
    client: AgentHostClient;
    labels: ShellLabels;
    artifact?: AgentArtifactTarget | null;
    inline?: boolean;
    showHeader?: boolean;
    artifactRenderers?: readonly ArtifactRendererOverride[];
    continueConversation?: (message: string) => Promise<void>;
  }>(),
  {
    artifact: null,
    inline: false,
    showHeader: true,
    artifactRenderers: undefined,
    continueConversation: undefined,
  },
);

const emit = defineEmits<{
  "update:artifact": [target: AgentArtifactTarget | null];
  error: [message: string];
  loaded: [load: DisplayLoad];
}>();

const slots = useSlots();
const trail = shallowRef<readonly OpenArtifact[]>([]);
const resolveState = ref<"idle" | "loading" | "ready" | "missing" | "error">("idle");
const artifactRevision = ref(0);
const noTools = computed<readonly ToolRendererOverride[]>(() => []);
const renderers = computed<readonly ArtifactRendererOverride[]>(() => props.artifactRenderers ?? []);

const inertQuestions: ShellQuestions = {
  pending: ref([]),
  sending: ref(false),
  answer: async () => false,
  view: reactive<QuestionView>({ open: false, current: null, drafts: {}, skipped: [] }),
};

const activeOpen = computed(() => trail.value.at(-1) ?? null);
const currentSessionId = computed(() => activeOpen.value?.artifact.sessionId ?? props.artifact?.sessionId ?? null);

provide(shellContextKey, {
  labels: toRef(props, "labels"),
  artifactRenderers: renderers,
  toolRenderers: noTools,
  slots: {
    get artifactActions() {
      return slots["artifact-actions"];
    },
    get artifact() {
      return slots.artifact;
    },
    get artifactLink() {
      return slots["artifact-link"];
    },
  },
  resolveArtifact: (runId, path) => {
    const sessionId = currentSessionId.value;
    return sessionId ? props.client.resolveArtifact(sessionId, runId, path) : Promise.resolve(null);
  },
  artifactRevision,
  readArtifact: (artifact) => props.client.readArtifact(artifact),
  openArtifact: (open, parentKey) => {
    const next = pushArtifactTrail(trail.value, open, parentKey);
    if (!next) return;
    trail.value = next;
    resolveState.value = "ready";
    emit("update:artifact", artifactTargetOf(next.at(-1)!));
  },
  openArtifactKey: computed(() => activeOpen.value?.key ?? null),
  nameOpenArtifact: (key, title) => {
    const next = nameArtifactInTrail(trail.value, key, title);
    if (next !== trail.value) trail.value = next;
  },
  pageLink: () => null,
  continueConversation: props.continueConversation,
  questions: inertQuestions,
});

let resolveSeq = 0;
watch(
  () => props.artifact,
  async (target) => {
    const seq = ++resolveSeq;
    if (!target) {
      trail.value = [];
      resolveState.value = "idle";
      return;
    }
    const top = trail.value.at(-1);
    if (top && sameArtifactTarget(target, artifactTargetOf(top))) {
      if (target.title && target.title !== top.title) {
        trail.value = [...trail.value.slice(0, -1), { ...top, title: target.title }];
      }
      resolveState.value = "ready";
      return;
    }
    trail.value = [];
    resolveState.value = "loading";
    emit("loaded", { status: "loading" });
    try {
      const resolved = await props.client.resolveArtifact(target.sessionId, target.runId, target.path);
      if (seq !== resolveSeq) return;
      if (!resolved) {
        resolveState.value = "missing";
        emit("loaded", { status: "error", error: { code: "artifact_missing", message: target.path } });
        return;
      }
      trail.value = [{
        key: `${target.runId}:${target.path}`,
        artifact: resolved,
        title: target.title || fileName(target.path),
      }];
      resolveState.value = "ready";
    } catch (error) {
      if (seq !== resolveSeq) return;
      resolveState.value = "error";
      emit("error", error instanceof Error ? error.message : String(error));
      emit("loaded", { status: "error", error: { code: "artifact_unavailable", message: target.path } });
    }
  },
  { immediate: true },
);

function handleClose(key: string) {
  const next = popArtifactTrail(trail.value, key);
  if (!next) return;
  trail.value = next;
  if (!next.length) resolveState.value = "idle";
  emit("update:artifact", next.length ? artifactTargetOf(next.at(-1)!) : null);
}

function handleLoaded(key: string, load: DisplayLoad) {
  if (activeOpen.value?.key === key) emit("loaded", load);
}

function dismissFallback() {
  resolveSeq++;
  trail.value = [];
  resolveState.value = "idle";
  emit("update:artifact", null);
}
</script>

<template>
  <div v-if="artifact" class="agent-artifact-preview" :class="{ inline }">
    <ArtifactPreviewCore
      v-if="trail.length"
      :trail="trail"
      :inline="inline"
      :show-header="showHeader"
      @close="handleClose"
      @loaded="handleLoaded"
    />
    <aside v-else class="preview-state" :class="{ inline }">
      <header v-if="showHeader" class="preview-state-header">
        <span class="preview-state-title">{{ artifact.title || fileName(artifact.path) }}</span>
        <button
          type="button"
          class="preview-state-close"
          :title="labels.close"
          :aria-label="labels.close"
          @click="dismissFallback"
        >
          <X :size="17" />
        </button>
      </header>
      <div class="preview-state-body">
        <div v-if="resolveState === 'loading'" class="preview-loading" aria-busy="true">
          <span class="preview-shimmer" />
        </div>
        <div v-else class="preview-missing">
          {{ labels.artifactMissing }} · {{ artifact.path }}
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.agent-artifact-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.preview-state {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--el-bg-color);
  border-left: 1px solid var(--el-border-color);
}
.preview-state.inline {
  border-left: 0;
}
.preview-state-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: var(--panel-header-height, 44px);
  padding: 6px 8px 6px 16px;
  box-sizing: border-box;
  border-bottom: 1px solid var(--el-border-color);
}
.preview-state-title {
  font-size: var(--text-base, 14px);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-state-close {
  display: grid;
  place-items: center;
  width: var(--control-height, 32px);
  height: var(--control-height, 32px);
  flex-shrink: 0;
  border: 0;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.preview-state-close:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.preview-state-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}
.preview-loading {
  height: 72px;
  border-radius: var(--radius-lg, 12px);
  overflow: hidden;
  background: var(--el-fill-color-light);
}
.preview-shimmer {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, transparent 0%, var(--el-fill-color) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
.preview-missing {
  padding: 10px 14px;
  border: 1px dashed var(--el-border-color-dark);
  border-radius: var(--radius-lg, 12px);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
  overflow-wrap: anywhere;
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .preview-shimmer { animation: none; }
}
</style>
