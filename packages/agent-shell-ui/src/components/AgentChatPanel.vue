<script setup lang="ts">
import { computed, provide, ref, toRef, watch } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "../host";
import { defaultChartTheme } from "../chart-theme";
import { shellContextKey } from "../context";
import type { ConversationItem } from "../view";
import type {
  ArtifactRendererOverride,
  ProcessStepView,
  ShellFeedbackPort,
  ShellLabels,
  ToolRendererOverride,
} from "../types";
import { useAgentConversation } from "../useAgentConversation";
import ShellConversation from "./ShellConversation.vue";

/**
 * A conversation without the shell navigation. Hosts embed it in dialogs and side panels where
 * the session is owned by the host: it still subscribes to run events, so tool steps appear live.
 */
const props = withDefaults(
  defineProps<{
    client: AgentHostClient;
    agentId: string;
    agent: AgentHostAgent | null;
    labels: ShellLabels;
    sessionId?: string | null;
    feedback?: ShellFeedbackPort;
  }>(),
  { sessionId: null },
);
const emit = defineEmits<{
  "update:sessionId": [id: string | null];
  /** A run produced its final state; the host may now consume the run's files. */
  runComplete: [payload: { sessionId: string; runId: string; ok: boolean }];
  error: [message: string];
}>();

const conversation = useAgentConversation(() => props.client);

/** Host paths are execution details, never user-facing content. */
function redact(value: string): string {
  return value
    .replace(/\/Users\/[^\s"'`]*\/workspace/g, "workspace")
    .replace(/\/Users\/[^\s"'`]*/g, "<path>")
    .replace(/\/home\/[^\s"'`]*/g, "<path>")
    .replace(/\/private\/(?:tmp|var)\/[^\s"'`]*/g, "<path>")
    .replace(/[A-Za-z]:\\Users\\[^\s"'`]*/g, "<path>");
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactValue(item)])
    );
  return value;
}

function sanitizeStep(step: ProcessStepView): ProcessStepView {
  return {
    ...step,
    text: redact(step.text),
    output: redact(step.output),
    args: redactValue(step.args) as ProcessStepView["args"],
  };
}

function sanitizeItem(item: ConversationItem): ConversationItem {
  if (item.kind !== "response") return item;
  return {
    ...item,
    blocks: item.blocks.map((block) =>
      block.kind === "process" ? { ...block, steps: block.steps.map(sanitizeStep) } : block
    ),
  };
}

const safeItems = computed(() => conversation.items.value.map(sanitizeItem));
const artifactRevision = computed(() => conversation.artifactRevision.value);
const noArtifacts = computed<readonly ArtifactRendererOverride[]>(() => []);
const noTools = computed<readonly ToolRendererOverride[]>(() => []);
const noOpenArtifact = ref<string | null>(null);

provide(shellContextKey, {
  labels: toRef(props, "labels"),
  artifactRenderers: noArtifacts,
  toolRenderers: noTools,
  chartTheme: computed(() => defaultChartTheme),
  slots: {},
  resolveArtifact: conversation.resolveArtifact,
  artifactRevision,
  readArtifact: (artifact) => props.client.readArtifact(artifact),
  readRetrieval: (...args) => props.client.readRetrieval(...args),
  readRetrievalRun: (...args) => props.client.readRetrievalRun(...args),
  subscribeRetrieval: (...args) => props.client.subscribeRetrieval(...args),
  openArtifact: (open) => {
    void props.client
      .readArtifact(open.artifact)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch((error) => emit("error", error instanceof Error ? error.message : String(error)));
  },
  openArtifactKey: noOpenArtifact,
});

watch(
  () => props.sessionId,
  (id) => {
    void conversation.open(id ?? null);
  },
  { immediate: true },
);

let lastRunId: string | null = null;
let awaitingRun = false;
watch(
  () => conversation.activeRunId.value,
  (id) => {
    if (id) {
      lastRunId = id;
      awaitingRun = true;
    }
  },
);
watch(
  () => conversation.busy.value,
  (busy) => {
    if (busy || !awaitingRun || !lastRunId) return;
    awaitingRun = false;
    const sessionId = conversation.state.sessionId;
    const run = conversation.state.runs[lastRunId];
    // The host decides from its own run record when the live projection is already gone.
    const ok = run
      ? run.status === "stopped" && run.stopReason === "stop" && !run.errorMessage
      : true;
    if (sessionId) emit("runComplete", { sessionId, runId: lastRunId, ok });
  },
);

async function send(text: string) {
  const result = await conversation.send(props.agentId, text);
  if (!result) return;
  if (result.createdSession) emit("update:sessionId", result.createdSession.id);
}

function report(error: unknown) {
  emit("error", error instanceof Error ? error.message : String(error));
}

watch(
  () => conversation.loadError.value,
  (value) => {
    if (value) report(value);
  },
);
watch(
  () => conversation.sendError.value,
  (value) => {
    if (value) report(value);
  },
);

defineExpose({
  reset: () => conversation.open(null),
  cancel: conversation.cancel,
  send,
});
</script>

<template>
  <div class="agent-chat-panel">
    <ShellConversation
      :items="safeItems"
      :session-id="conversation.state.sessionId"
      :agent="agent"
      :loading="conversation.loading.value"
      :load-error="conversation.loadError.value"
      :has-older="conversation.olderCursor.value !== null"
      :loading-older="conversation.loadingOlder.value"
      :older-error="conversation.olderError.value"
      :history-revision="conversation.historyRevision.value"
      :send-error="conversation.sendError.value"
      :pending-input="conversation.pendingInput.value"
      :busy="conversation.busy.value"
      :feedback="feedback"
      @send="send"
      @stop="conversation.cancel"
      @retry="conversation.open(conversation.state.sessionId)"
      @load-older="conversation.loadOlder"
    />
  </div>
</template>

<style scoped>
.agent-chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
</style>
