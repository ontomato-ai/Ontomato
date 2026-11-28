<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AgentChat as ShellAgentChat,
  servePageComposerKey,
  usePanelChatHost,
  type AgentArtifactTarget,
  type AgentHostAgent,
  type AgentHostClient,
  type AgentRunComplete,
  type ArtifactLinkSlotScope,
  type ArtifactRendererOverride,
  type ArtifactSlotScope,
  type ComposerEntry,
  type ConversationInputRun,
  type PageComposerExpand,
  type ShellFeedbackPort,
  type ShellLabels,
} from "@ontomato/agent-shell-ui";
import type { AgentHostSession } from "@ontomato/contracts/agent-host";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import { useShellLabels } from "@ontomato/workbench-ui/composables/useShellLabels";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey, useMemberOutput } from "../panel/member";

/**
 * Official conversation component:
 * - As a panel projection (`<Projection slot="...">` with `agent` declared on the member): resolves the declared
 *   agent (or external `agentId` input) through the platform's authenticated `AgentHostClient` under the signed-in
 *   reader's permissions and gates, shares the platform's own session history, binds optional `sessionId`, `agentId`
 *   and `artifact` state, publishes read-only `status`, `sessionId` and `busy` outputs, and claims the page's composer
 *   surface so the page never shows a second composer.
 * - In standalone pages (`@ontomato/sdk/chat`, passing explicit `client`, `agentId`, `agent` and `labels`): delegates
 *   directly to the underlying shell conversation panel.
 */
const props = withDefaults(
  defineProps<{
    /** Show the built-in header bar (session/agent title, header actions and New chat action) in projection mode. */
    showHeader?: boolean;
    /** Optional panel message key (`content.messages`) overriding the input placeholder in projection mode. */
    placeholderKey?: string;
    /** Active conversation session ID; bind via `state: { sessionId: "..." }` to persist or deep-link a session. */
    sessionId?: string | null;
    /** Active agent ID override; in projection mode overrides the declared target and follows cross-agent sessions. */
    agentId?: string | null;
    /** Active artifact target selected from conversation cards; bind with `AgentArtifactPreview`. */
    artifact?: AgentArtifactTarget | null;
    sessionContext?: Record<string, RuntimeJsonValue>;
    collapsed?: boolean;
    greeting?: string;
    greetingKey?: string;
    description?: string;
    descriptionKey?: string;
    /** Predicate selecting user messages rendered through the `#input` slot instead of the default bubble. */
    customInput?: (text: string) => boolean;
    /** Custom artifact renderers overriding shell defaults inside inline conversation artifacts. */
    artifactRenderers?: readonly ArtifactRendererOverride[];
    /** Predicate suppressing Markdown artifact cards already rendered inline by the host (e.g. custom input cards). */
    inlineArtifactAlreadyShown?: (runId: string, path: string) => boolean;
    /** Standalone mode only: authenticated `AgentHostClient` from `createAssistantClient(context)`. */
    client?: AgentHostClient;
    /** Standalone mode only: explicit agent metadata. */
    agent?: AgentHostAgent | null;
    /** Standalone mode only: localized shell labels from `useShellLabels()`. */
    labels?: ShellLabels;
    /** Optional message feedback port. */
    feedback?: ShellFeedbackPort;
  }>(),
  {
    showHeader: true,
    collapsed: false,
    placeholderKey: undefined,
    sessionId: null,
    agentId: null,
    artifact: null,
    customInput: undefined,
    artifactRenderers: undefined,
    inlineArtifactAlreadyShown: undefined,
    client: undefined,
    agent: null,
    labels: undefined,
    feedback: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when a session is created, opened, or reset to `null`. */
  "update:sessionId": [id: string | null];
  /** Emitted when opening a historical session reveals it belongs to another agent. */
  "update:agentId": [id: string];
  /** Emitted when the reader opens an artifact card or an open artifact receives its title. */
  "update:artifact": [target: AgentArtifactTarget | null];
  /** Emitted when a run settles, carrying persisted run artifacts when available. */
  runComplete: [payload: AgentRunComplete];
  /** Emitted when loading the agent, reading run artifacts, or running a turn fails. */
  error: [message: string];
  /** Emitted when the reader expands a collapsed conversation surface. */
  expand: [];
  /** Emitted after a sibling `ConversationEntry` activates this chat. */
  entryTriggered: [payload: { slot?: string; submit?: boolean; newSession?: boolean; sessionId?: string | null }];
}>();

defineSlots<{
  /** Actions rendered beside the built-in header title with current session metadata and initial instruction reader. */
  "header-actions"?(scope: {
    sessionId: string | null;
    agentId: string | null;
    title: string | undefined;
    origin: AgentHostSession["origin"];
    hasInitialInstruction: boolean;
    initialInstruction: () => Promise<string>;
  }): unknown;
  /** Custom welcome block above the composer when no session has started yet (keeps the composer). */
  welcome?(scope: { agent: AgentHostAgent | null }): unknown;
  /** Full empty-state replacement when no session has started yet (omits the composer). */
  "conversation-empty"?(): unknown;
  /** Custom rendering for user messages matched by `customInput`. */
  input?(scope: {
    inputId: string | null;
    text: string;
    queued: boolean;
    run: ConversationInputRun | null;
    preparationFailed: boolean;
  }): unknown;
  /** Context strip rendered directly above the composer. */
  "composer-context"?(): unknown;
  /** Custom actions rendered beneath a settled assistant response. */
  "message-actions"?(scope: { item: unknown; runId: string; outcome?: RuntimeJsonValue }): unknown;
  /** Custom Markdown artifact card renderer with fallback component and props. */
  "artifact-link"?(scope: ArtifactLinkSlotScope): unknown;
  /** Custom inline artifact body renderer with fallback component and props. */
  artifact?(scope: ArtifactSlotScope): unknown;
  /** Custom actions rendered in inline artifact headers. */
  "artifact-actions"?(scope: { artifact: RuntimeArtifact; title: string; caption?: string }): unknown;
}>();

const standalone = computed(() => props.client !== undefined);

const { t } = useI18n();
const panel = inject(panelContextKey, null);
const slot = inject(projectionKey, null);
const memberGetter = inject(panelMemberKey, null);
const chatHost = usePanelChatHost();
const defaultLabels = useShellLabels();
const serve = inject(servePageComposerKey, null);

type PanelChatStatus = "loading" | "ready" | "forbidden" | "error";
const status = ref<PanelChatStatus>(standalone.value ? "ready" : "loading");
const availableAgents = shallowRef<readonly AgentHostAgent[]>([]);
const agentsLoaded = ref(false);
const resolvedAgent = shallowRef<AgentHostAgent | null>(null);
const loadFailure = ref<string>("");
const currentSessionId = ref<string | null>(props.sessionId ?? null);
const currentAgentId = ref<string | null>(props.agentId ?? null);
const currentArtifact = shallowRef<AgentArtifactTarget | null>(props.artifact ?? null);

watch(
  () => props.sessionId,
  (next) => {
    currentSessionId.value = next ?? null;
  },
);
watch(
  () => props.agentId,
  (next) => {
    currentAgentId.value = next ?? null;
  },
);
watch(
  () => props.artifact,
  (next) => {
    currentArtifact.value = next ?? null;
  },
);

const innerRef = ref<InstanceType<typeof ShellAgentChat> | null>(null);

const activeClient = computed<AgentHostClient | null>(() => {
  if (props.client) return props.client;
  return chatHost ? chatHost.client() : null;
});

function translated(key: string | undefined) {
  if (!key || !panel) return undefined;
  const value = panel.t(key);
  return value === key ? undefined : value;
}

const effectiveLabels = computed<ShellLabels>(() => {
  const base = props.labels ?? defaultLabels.value;
  return { ...base, placeholder: translated(props.placeholderKey) ?? base.placeholder };
});
const greeting = computed(() => translated(props.greetingKey) ?? props.greeting);
const description = computed(() => translated(props.descriptionKey) ?? props.description);
const activeAgent = computed(() => (standalone.value ? props.agent : resolvedAgent.value));
const activeAgentId = computed(() =>
  standalone.value ? (props.agentId ?? undefined) : (currentAgentId.value ?? resolvedAgent.value?.id),
);
const entry = shallowRef<ComposerEntry | null>(null);

function writeMemberOutput(name: string, value: RuntimeJsonValue | null) {
  if (!slot || !memberGetter) return;
  const member = memberGetter();
  if (member.scoped) return;
  panel?.instance?.output?.(member.key, name, value);
}

function matchDeclaredAgent(
  target: PanelConversationEntry["target"],
  agents: readonly AgentHostAgent[],
): AgentHostAgent | null {
  const enabled = agents.filter((agent) => agent.enabled);
  const resolvedTarget =
    target.kind === "page-default"
      ? (chatHost?.defaultAgent ?? { kind: "preset" as const, agentKind: "regular" })
      : target;
  if (resolvedTarget.kind === "id") {
    return enabled.find((agent) => agent.id === resolvedTarget.id) ?? null;
  }
  return enabled.find((agent) => agent.kind === resolvedTarget.agentKind) ?? null;
}

function syncResolvedAgent() {
  if (standalone.value || !agentsLoaded.value) return;
  const agents = availableAgents.value;
  if (currentAgentId.value) {
    const found = agents.find((agent) => agent.id === currentAgentId.value) ?? null;
    if (found && found.enabled) {
      resolvedAgent.value = found;
      status.value = "ready";
      return;
    }
    if (currentSessionId.value) {
      resolvedAgent.value = found;
      status.value = "ready";
      return;
    }
    resolvedAgent.value = null;
    status.value = "forbidden";
    return;
  }
  const target = slot?.projection.conversationEntry?.target;
  if (!target) {
    resolvedAgent.value = null;
    status.value = "error";
    loadFailure.value = "This AgentChat projection declares no agent target";
    return;
  }
  const match = matchDeclaredAgent(target, agents);
  if (!match) {
    resolvedAgent.value = null;
    status.value = "forbidden";
    return;
  }
  resolvedAgent.value = match;
  status.value = "ready";
}

let loadSeq = 0;
async function loadDeclaredAgent() {
  if (standalone.value) {
    status.value = "ready";
    return;
  }
  const seq = ++loadSeq;
  loadFailure.value = "";
  resolvedAgent.value = null;
  agentsLoaded.value = false;

  const target = slot?.projection.conversationEntry?.target;
  if (!target && !currentAgentId.value) {
    status.value = "error";
    loadFailure.value = "This AgentChat projection declares no agent target";
    emit("error", loadFailure.value);
    return;
  }
  const client = activeClient.value;
  if (!client) {
    status.value = "error";
    loadFailure.value = "No platform agent chat host is available in this container";
    emit("error", loadFailure.value);
    return;
  }

  status.value = "loading";
  try {
    const agents = await client.listAgents();
    if (seq !== loadSeq) return;
    availableAgents.value = agents;
    agentsLoaded.value = true;
    syncResolvedAgent();
  } catch (reason: unknown) {
    if (seq !== loadSeq) return;
    status.value = "error";
    loadFailure.value = reason instanceof Error ? reason.message : String(reason);
    emit("error", loadFailure.value);
  }
}

watch(
  () => [standalone.value, slot?.projection.id, slot?.projection.conversationEntry?.target] as const,
  () => {
    void loadDeclaredAgent();
  },
  { immediate: true },
);

watch([currentAgentId, currentSessionId], () => {
  if (!standalone.value && agentsLoaded.value) syncResolvedAgent();
});

let releaseComposerClaim: (() => void) | null = null;
watch(
  () => !standalone.value && chatHost?.claimComposer !== undefined,
  (shouldClaim) => {
    releaseComposerClaim?.();
    releaseComposerClaim = shouldClaim && chatHost?.claimComposer ? chatHost.claimComposer() : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  releaseComposerClaim?.();
  releaseComposerClaim = null;
});

function handleSessionUpdate(next: string | null) {
  currentSessionId.value = next;
  writeMemberOutput("sessionId", next);
  emit("update:sessionId", next);
}

function handleAgentUpdate(next: string) {
  currentAgentId.value = next;
  if (!standalone.value && agentsLoaded.value) syncResolvedAgent();
  writeMemberOutput("agentId", next);
  emit("update:agentId", next);
}

function handleArtifactUpdate(next: AgentArtifactTarget | null) {
  currentArtifact.value = next;
  writeMemberOutput("artifact", next);
  emit("update:artifact", next);
}

function startNewChat() {
  handleSessionUpdate(null);
  void innerRef.value?.reset();
  entry.value = { text: "", seq: (entry.value?.seq ?? 0) + 1 };
}

const innerBusy = computed(() => Boolean(innerRef.value?.busy));
const currentSession = computed<AgentHostSession | null>(() => innerRef.value?.session ?? null);
const hasInitialInstruction = computed(() => Boolean(innerRef.value?.hasInitialInstruction));
const headerTitle = computed(() => currentSession.value?.title || activeAgent.value?.name || "");
const headerAgentId = computed(() => currentSession.value?.agentId ?? activeAgentId.value ?? null);
const readInitialInstruction = () =>
  innerRef.value ? innerRef.value.initialInstruction() : Promise.resolve("");

if (slot && memberGetter) {
  useMemberOutput("status", () => status.value);
  useMemberOutput("sessionId", () => currentSessionId.value);
  useMemberOutput("busy", () => innerBusy.value);
}

const expandEntry: PageComposerExpand = async (request) => {
  const chat = innerRef.value!;
  const target = request.target;
  if (
    (target.kind === "id" && target.id !== activeAgentId.value)
    || (target.kind === "preset" && target.agentKind !== activeAgent.value?.kind)
  ) {
    if (props.collapsed) emit("expand");
    return;
  }

  const text = request.prefill?.trim();
  const submit = request.submit && Boolean(text);
  if (request.newSession) {
    if (submit) {
      await chat.reset();
      entry.value = { text: "", seq: (entry.value?.seq ?? 0) + 1 };
    }
    else startNewChat();
  }
  if (props.collapsed) emit("expand");
  if (submit) {
    const id = await chat.send(text!);
    if (request.newSession && id === null) handleSessionUpdate(null);
  } else if (request.prefill !== undefined) {
    entry.value = { text: request.prefill, seq: (entry.value?.seq ?? 0) + 1 };
  }
  emit("entryTriggered", {
    slot: request.slot,
    submit: request.submit,
    newSession: request.newSession,
    sessionId: currentSessionId.value,
  });
};
watch(
  () => !standalone.value && Boolean(slot && innerRef.value) && (chatHost?.shown?.() ?? true),
  (serving, _, onCleanup) => {
    if (serving && serve) onCleanup(serve(expandEntry));
  },
);

defineExpose({
  cancel: () => innerRef.value?.cancel(),
  busy: innerBusy,
  session: currentSession,
  hasInitialInstruction,
  initialInstruction: readInitialInstruction,
});
</script>

<template>
  <div class="sdk-agent-chat" :class="{ standalone, collapsed }">
    <div v-if="status === 'loading'" class="sdk-agent-chat-state" role="status" aria-busy="true">
      {{ t("common.loading") }}
    </div>
    <div v-else-if="status === 'forbidden'" class="sdk-agent-chat-state" role="status">
      <p class="sdk-agent-chat-message">{{ t("assistant.agentUnavailable") }}</p>
    </div>
    <div v-else-if="status === 'error'" class="sdk-agent-chat-state" role="alert">
      <p class="sdk-agent-chat-message">{{ loadFailure || t("assistant.loadFailed") }}</p>
      <button type="button" class="sdk-agent-chat-btn" @click="loadDeclaredAgent">
        {{ t("assistant.retry") }}
      </button>
    </div>
    <template v-else-if="activeClient && activeAgentId">
      <header v-if="!standalone && showHeader && !collapsed" class="sdk-agent-chat-header">
        <span class="sdk-agent-chat-title">{{ headerTitle }}</span>
        <div class="sdk-agent-chat-header-actions">
          <slot
            name="header-actions"
            :session-id="currentSessionId"
            :agent-id="headerAgentId"
            :title="currentSession?.title"
            :origin="currentSession?.origin"
            :has-initial-instruction="hasInitialInstruction"
            :initial-instruction="readInitialInstruction"
          />
          <button
            type="button"
            class="sdk-agent-chat-btn"
            :disabled="!currentSessionId || innerBusy"
            @click="startNewChat"
          >
            {{ t("assistant.newConversation") }}
          </button>
        </div>
      </header>
      <div class="sdk-agent-chat-body">
        <ShellAgentChat
          ref="innerRef"
          :client="activeClient"
          :agent-id="activeAgentId"
          :agent="activeAgent"
          :labels="effectiveLabels"
          :session-id="currentSessionId"
          :artifact="currentArtifact"
          :session-context="sessionContext"
          :display="chatHost?.display"
          :collapsed="collapsed"
          :greeting="greeting"
          :description="description"
          :entry="entry"
          :feedback="feedback"
          :custom-input="customInput"
          :artifact-renderers="artifactRenderers"
          :inline-artifact-already-shown="inlineArtifactAlreadyShown"
          @expand="emit('expand')"
          @update:session-id="handleSessionUpdate"
          @update:agent-id="handleAgentUpdate"
          @update:artifact="handleArtifactUpdate"
          @run-complete="emit('runComplete', $event)"
          @error="emit('error', $event)"
        >
          <template v-if="$slots.welcome" #welcome="scope"><slot name="welcome" v-bind="scope" /></template>
          <template v-if="$slots['conversation-empty']" #conversation-empty><slot name="conversation-empty" /></template>
          <template v-if="$slots.input" #input="scope"><slot name="input" v-bind="scope" /></template>
          <template v-if="$slots['composer-context']" #composer-context><slot name="composer-context" /></template>
          <template v-if="$slots['message-actions']" #message-actions="scope"><slot name="message-actions" v-bind="scope" /></template>
          <template v-if="$slots['artifact-link']" #artifact-link="scope"><slot name="artifact-link" v-bind="scope" /></template>
          <template v-if="$slots.artifact" #artifact="scope"><slot name="artifact" v-bind="scope" /></template>
          <template v-if="$slots['artifact-actions']" #artifact-actions="scope"><slot name="artifact-actions" v-bind="scope" /></template>
        </ShellAgentChat>
      </div>
    </template>
  </div>
</template>

<style scoped>
.sdk-agent-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 360px;
  min-width: 0;
  background: var(--sdk-bg-color, var(--el-bg-color, #ffffff));
  border: 1px solid var(--sdk-border-color, var(--el-border-color-lighter, #e4e7ed));
  border-radius: var(--el-border-radius-base, 6px);
  overflow: hidden;
}

.sdk-agent-chat.collapsed {
  min-height: 0;
  height: auto;
}
.sdk-agent-chat.standalone,
.sdk-agent-chat.standalone > .sdk-agent-chat-body {
  display: contents;
}

.sdk-agent-chat-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sdk-border-color, var(--el-border-color-lighter, #e4e7ed));
}

.sdk-agent-chat-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}

.sdk-agent-chat-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sdk-text-primary, var(--el-text-color-primary, #1f2329));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-agent-chat-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sdk-agent-chat-state {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 16px;
  text-align: center;
  color: var(--sdk-text-secondary, var(--el-text-color-secondary, #646a73));
  font-size: 13px;
}

.sdk-agent-chat-message {
  margin: 0;
  max-width: 420px;
  line-height: 1.5;
}

.sdk-agent-chat-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  border-radius: var(--el-border-radius-base, 6px);
  border: 1px solid var(--sdk-border-color, var(--el-border-color, #d4d7de));
  background: var(--sdk-bg-color, var(--el-fill-color-blank, #ffffff));
  color: var(--sdk-text-primary, var(--el-text-color-primary, #1f2329));
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.sdk-agent-chat-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
