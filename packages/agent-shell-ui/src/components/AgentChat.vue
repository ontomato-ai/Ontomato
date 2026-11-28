<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, ref, toRef, watch } from "vue";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "../host";
import { conversationQuestions, displayQuestions, shellContextKey } from "../context";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { displayLink, type ConversationDisplay } from "../conversation-display";
import { conversationStreamShell, pageSessionStream, sessionRunNotices } from "../session-run-notices";
import type { ComposerEntry } from "../page-composer-entry";
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
    sessionContext?: Record<string, RuntimeJsonValue>;
    display?: () => ConversationDisplay | null;
    collapsed?: boolean;
    greeting?: string;
    description?: string;
    entry?: ComposerEntry | null;
    feedback?: ShellFeedbackPort;
  }>(),
  { sessionId: null },
);
const emit = defineEmits<{
  "update:sessionId": [id: string | null];
  /** A run produced its final state; the host may now consume the run's files. */
  runComplete: [payload: { sessionId: string; runId: string; ok: boolean; outcome?: RuntimeJsonValue }];
  error: [message: string];
  expand: [];
}>();

const stream = inject(pageSessionStream, null);
const notice = inject(sessionRunNotices, null);
const display = () => props.display?.() ?? null;
const conversation = useAgentConversation(
  () => props.client,
  () => props.agentId,
  () => display() ? stream?.binding ?? null : null,
  () => display()?.pageSkill.value ?? null,
  () => props.sessionContext,
);
let detach: (() => void) | undefined;
watch(display, (current) => {
  detach?.();
  detach = current ? stream?.attach(conversationStreamShell(current, () => conversation.state.sessionId)) : undefined;
}, { immediate: true });
onBeforeUnmount(() => detach?.());
if (notice) watch(notice, (frame) => {
  if (frame?.type === "run_started" && frame.sessionId === conversation.state.sessionId)
    void conversation.followRun(frame.runId).catch(report);
});

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
    process: item.process.map((block) =>
      block.kind === "steps" ? { ...block, steps: block.steps.map(sanitizeStep) } : block
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
  slots: {},
  resolveArtifact: conversation.resolveArtifact,
  artifactRevision,
  readArtifact: (artifact) => props.client.readArtifact(artifact),
  get readVectorResource() { return props.client.readVectorResource; },
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
  nameOpenArtifact: () => {},
  pageLink: (href) => {
    const current = display();
    return current ? displayLink(current)(href) : null;
  },
  questions: displayQuestions(conversationQuestions(conversation), display, () => conversation.state.sessionId),
});

watch(
  () => props.sessionId,
  (id) => {
    if (id !== conversation.state.sessionId) void conversation.open(id);
  },
  { immediate: true },
);

const lastRunId = ref<string | null>(null);
let reportedRunId: string | null = null;

function emitRunComplete(sessionId: string, runId: string, ok: boolean, outcome?: RuntimeJsonValue) {
  if (reportedRunId === runId) return;
  reportedRunId = runId;
  emit("runComplete", { sessionId, runId, ok, ...(outcome === undefined ? {} : { outcome }) });
}

watch(conversation.activeRunId, (id) => {
  if (id) lastRunId.value = id;
});

watch(
  [lastRunId, () => lastRunId.value ? conversation.state.runs[lastRunId.value]?.status : undefined],
  ([runId, status]) => {
    const sessionId = conversation.state.sessionId;
    if (!runId || !sessionId || status !== "stopped") return;
    const run = conversation.state.runs[runId];
    emitRunComplete(sessionId, runId, run.stopReason !== "aborted" && !run.errorMessage, run.outcome);
  },
);

async function send(text: string) {
  const observed = display()?.snapshot();
  const initialPage = observed?.known && observed.target?.kind === "page" ? observed.target : undefined;
  const result = await conversation.send(props.agentId, text, { initialPage });
  const sessionId = conversation.state.sessionId;
  if (result?.createdSession && result.createdSession.id === sessionId) emit("update:sessionId", sessionId);
  if (result?.delivery?.sessionRef.sessionId === sessionId) lastRunId.value = result.delivery.runId;
  return sessionId;
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
  busy: conversation.busy,
});
</script>

<template>
  <div class="agent-chat" :class="{ collapsed }">
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
      :sending="conversation.sending.value"
      :feedback="feedback"
      :collapsed="collapsed"
      :greeting="greeting"
      :description="description"
      :entry="entry"
      @expand="emit('expand')"
      @send="send"
      @stop="conversation.cancel"
      @retry="conversation.open(conversation.state.sessionId)"
      @load-older="conversation.loadOlder"
    >
      <template v-if="$slots['composer-context']" #composer-context><slot name="composer-context" /></template>
      <template v-if="$slots['message-actions']" #message-actions="{ item, runId }">
        <slot name="message-actions" :item="item" :run-id="runId" :outcome="conversation.state.runs[runId]?.outcome" />
      </template>
    </ShellConversation>
  </div>
</template>

<style scoped>
.agent-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.agent-chat.collapsed { height: auto; }
</style>
