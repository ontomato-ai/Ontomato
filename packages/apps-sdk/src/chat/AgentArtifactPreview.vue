<script setup lang="ts">
import { computed, inject, shallowRef, watch } from "vue";
import {
  AgentArtifactPreview as ShellAgentArtifactPreview,
  usePanelChatHost,
  type AgentArtifactTarget,
  type AgentHostClient,
  type ArtifactLinkSlotScope,
  type ArtifactRendererOverride,
  type ArtifactSlotScope,
  type ShellLabels,
} from "@ontomato/agent-shell-ui";
import type { DisplayLoad } from "@ontomato/contracts/agent-presentation";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { useShellLabels } from "@ontomato/workbench-ui/composables/useShellLabels";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey } from "../panel/member";

/**
 * Official standalone artifact preview block:
 * - As a panel projection (`<Projection slot="...">`), resolves the platform chat host's `AgentHostClient` and
 *   localized shell labels, binds optional `artifact` panel state, and delegates rendering/trail/download to the
 *   shared shell preview core.
 * - In standalone pages (`@ontomato/sdk/chat`, passing explicit `client` and optional `labels`), delegates directly
 *   to the same shell preview core.
 */
const props = withDefaults(
  defineProps<{
    /** Serializable artifact target (`{ sessionId, runId, path, title? }`) or `null` when closed. */
    artifact?: AgentArtifactTarget | null;
    /** Whether to show the preview header bar (back, icon, title, actions, download, close). */
    showHeader?: boolean;
    /** Render inline to fill the panel's layout container (`true`) or as a resizable side panel (`false`). */
    inline?: boolean;
    /** Custom artifact renderers overriding shell defaults. */
    artifactRenderers?: readonly ArtifactRendererOverride[];
    /** Optional continuation callback for renderers that support continuing a conversation. */
    continueConversation?: (message: string) => Promise<void>;
    /** Standalone mode only: authenticated `AgentHostClient`. */
    client?: AgentHostClient;
    /** Standalone mode only: localized shell labels from `useShellLabels()`. */
    labels?: ShellLabels;
  }>(),
  {
    artifact: null,
    showHeader: true,
    inline: true,
    artifactRenderers: undefined,
    continueConversation: undefined,
    client: undefined,
    labels: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the preview closes (`null`) or follows a nested artifact link / Back step. */
  "update:artifact": [target: AgentArtifactTarget | null];
  /** Emitted when resolving or reading the artifact fails. */
  error: [message: string];
  /** Emitted as the preview resolves and renders the artifact. */
  loaded: [load: DisplayLoad];
}>();

defineSlots<{
  /** Custom artifact body renderer with default renderer fallback. */
  artifact?(scope: ArtifactSlotScope): unknown;
  /** Custom actions rendered in the preview header bar. */
  "artifact-actions"?(scope: { artifact: RuntimeArtifact; title: string; caption?: string }): unknown;
  /** Custom Markdown artifact card renderer for links inside Markdown artifacts. */
  "artifact-link"?(scope: ArtifactLinkSlotScope): unknown;
}>();

const panel = inject(panelContextKey, null);
const slot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const chatHost = usePanelChatHost();
const defaultLabels = useShellLabels();

const currentArtifact = shallowRef<AgentArtifactTarget | null>(props.artifact ?? null);
watch(
  () => props.artifact,
  (next) => {
    currentArtifact.value = next ?? null;
  },
);

const activeClient = computed<AgentHostClient | null>(() => {
  if (props.client) return props.client;
  return chatHost ? chatHost.client() : null;
});
const effectiveLabels = computed<ShellLabels>(() => props.labels ?? defaultLabels.value);

function handleArtifactUpdate(next: AgentArtifactTarget | null) {
  currentArtifact.value = next;
  if (slot && memberGetter) {
    const member = memberGetter();
    if (!member.scoped) panel?.instance?.output?.(member.key, "artifact", next);
  }
  emit("update:artifact", next);
}
</script>

<template>
  <div v-if="activeClient && currentArtifact" class="sdk-agent-artifact-preview" :class="{ inline }">
    <ShellAgentArtifactPreview
      :client="activeClient"
      :labels="effectiveLabels"
      :artifact="currentArtifact"
      :inline="inline"
      :show-header="showHeader"
      :artifact-renderers="artifactRenderers"
      :continue-conversation="continueConversation"
      @update:artifact="handleArtifactUpdate"
      @error="emit('error', $event)"
      @loaded="emit('loaded', $event)"
    >
      <template v-if="$slots.artifact" #artifact="scope"><slot name="artifact" v-bind="scope" /></template>
      <template v-if="$slots['artifact-actions']" #artifact-actions="scope"><slot name="artifact-actions" v-bind="scope" /></template>
      <template v-if="$slots['artifact-link']" #artifact-link="scope"><slot name="artifact-link" v-bind="scope" /></template>
    </ShellAgentArtifactPreview>
  </div>
</template>

<style scoped>
.sdk-agent-artifact-preview {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
</style>
