<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  AgentChatPanel as ShellAgentChatPanel,
  usePanelChatHost,
  type AgentHostAgent,
  type AgentHostClient,
  type ShellFeedbackPort,
  type ShellLabels,
} from "@ontomato/agent-shell-ui";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import { useShellLabels } from "@ontomato/workbench-ui/composables/useShellLabels";
import { panelContextKey, projectionKey } from "../panel/context";
import { panelMemberKey, useMemberOutput } from "../panel/member";

/**
 * Official conversation component:
 * - As a panel projection (`<Projection slot="...">` with `agent` declared on the member): resolves the declared
 *   agent through the platform's authenticated `AgentHostClient` under the signed-in reader's permissions and gates,
 *   shares the platform's own session history, binds optional `sessionId` state, publishes read-only `status`,
 *   `sessionId` and `busy` outputs, and claims the page's composer surface so the page never shows a second composer.
 * - In standalone pages (`@ontomato/sdk/chat`, passing explicit `client`, `agentId`, `agent` and `labels`): delegates
 *   directly to the underlying shell conversation panel.
 */
const props = withDefaults(
  defineProps<{
    /** Show the built-in header bar (agent name and New chat action) in projection mode. */
    showHeader?: boolean;
    /** Optional panel message key (`content.messages`) overriding the input placeholder in projection mode. */
    placeholderKey?: string;
    /** Active conversation session ID; bind via `state: { sessionId: "..." }` to persist or deep-link a session. */
    sessionId?: string | null;
    /** Standalone mode only: authenticated `AgentHostClient` from `createAssistantClient(context)`. */
    client?: AgentHostClient;
    /** Standalone mode only: explicit agent ID. */
    agentId?: string;
    /** Standalone mode only: explicit agent metadata. */
    agent?: AgentHostAgent | null;
    /** Standalone mode only: localized shell labels from `useShellLabels()`. */
    labels?: ShellLabels;
    /** Optional message feedback port. */
    feedback?: ShellFeedbackPort;
  }>(),
  {
    showHeader: true,
    placeholderKey: undefined,
    sessionId: null,
    client: undefined,
    agentId: undefined,
    agent: null,
    labels: undefined,
    feedback: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when a session is created, opened, or reset to `null`. */
  "update:sessionId": [id: string | null];
  /** Emitted when a run settles in the conversation. */
  runComplete: [payload: { sessionId: string; runId: string; ok: boolean }];
  /** Emitted when loading the agent or running a turn fails. */
  error: [message: string];
}>();

const standalone = computed(() => props.client !== undefined);

const { t } = useI18n();
const panel = inject(panelContextKey, null);
const slot = inject(projectionKey, null);
const chatHost = usePanelChatHost();
const defaultLabels = useShellLabels();

type PanelChatStatus = "loading" | "ready" | "forbidden" | "error";
const status = ref<PanelChatStatus>(standalone.value ? "ready" : "loading");
const resolvedAgent = shallowRef<AgentHostAgent | null>(null);
const loadFailure = ref<string>("");
const currentSessionId = ref<string | null>(props.sessionId ?? null);

watch(
  () => props.sessionId,
  (next) => {
    currentSessionId.value = next ?? null;
  },
);

const innerRef = ref<{
  reset?: () => void;
  cancel?: () => void;
  send?: (text: string) => Promise<void>;
  busy?: boolean;
} | null>(null);

const activeClient = computed<AgentHostClient | null>(() => {
  if (props.client) return props.client;
  return chatHost ? chatHost.client() : null;
});

const effectiveLabels = computed<ShellLabels>(() => {
  const base = props.labels ?? defaultLabels.value;
  if (!props.placeholderKey || !panel) return base;
  const translated = panel.t(props.placeholderKey);
  if (!translated || translated === props.placeholderKey) return base;
  return { ...base, placeholder: translated };
});

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

let loadSeq = 0;
async function loadDeclaredAgent() {
  if (standalone.value) {
    status.value = "ready";
    return;
  }
  const seq = ++loadSeq;
  loadFailure.value = "";
  resolvedAgent.value = null;

  const target = slot?.projection.conversationEntry?.target;
  if (!target) {
    status.value = "error";
    loadFailure.value = "This AgentChatPanel projection declares no agent target";
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
    const match = matchDeclaredAgent(target, agents);
    if (!match) {
      status.value = "forbidden";
      return;
    }
    resolvedAgent.value = match;
    status.value = "ready";
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
  emit("update:sessionId", next);
}

function startNewChat() {
  handleSessionUpdate(null);
  innerRef.value?.reset?.();
}

const innerBusy = computed(() => Boolean(innerRef.value?.busy));

if (slot && inject(panelMemberKey, null)) {
  useMemberOutput("status", () => status.value);
  useMemberOutput("sessionId", () => currentSessionId.value);
  useMemberOutput("busy", () => innerBusy.value);
}

defineExpose({
  reset: startNewChat,
  cancel: () => innerRef.value?.cancel?.(),
  send: (text: string) => innerRef.value?.send?.(text),
  busy: innerBusy,
});
</script>

<template>
  <ShellAgentChatPanel
    v-if="standalone && client && agentId"
    ref="innerRef"
    :client="client"
    :agent-id="agentId"
    :agent="agent"
    :labels="effectiveLabels"
    :session-id="currentSessionId"
    :feedback="feedback"
    @update:session-id="handleSessionUpdate"
    @run-complete="emit('runComplete', $event)"
    @error="emit('error', $event)"
  />
  <div v-else class="sdk-agent-chat-panel">
    <div v-if="status === 'loading'" class="sdk-agent-chat-panel-state" role="status" aria-busy="true">
      {{ t("common.loading") }}
    </div>
    <div v-else-if="status === 'forbidden'" class="sdk-agent-chat-panel-state" role="status">
      <p class="sdk-agent-chat-panel-message">{{ t("assistant.agentUnavailable") }}</p>
    </div>
    <div v-else-if="status === 'error'" class="sdk-agent-chat-panel-state" role="alert">
      <p class="sdk-agent-chat-panel-message">{{ loadFailure || t("assistant.loadFailed") }}</p>
      <button type="button" class="sdk-agent-chat-panel-btn" @click="loadDeclaredAgent">
        {{ t("assistant.retry") }}
      </button>
    </div>
    <template v-else-if="activeClient && resolvedAgent">
      <header v-if="showHeader" class="sdk-agent-chat-panel-header">
        <span class="sdk-agent-chat-panel-title">{{ resolvedAgent.name }}</span>
        <button
          type="button"
          class="sdk-agent-chat-panel-btn"
          :disabled="!currentSessionId || innerBusy"
          @click="startNewChat"
        >
          {{ t("assistant.newConversation") }}
        </button>
      </header>
      <div class="sdk-agent-chat-panel-body">
        <ShellAgentChatPanel
          ref="innerRef"
          :key="resolvedAgent.id"
          :client="activeClient"
          :agent-id="resolvedAgent.id"
          :agent="resolvedAgent"
          :labels="effectiveLabels"
          :session-id="currentSessionId"
          :feedback="feedback"
          @update:session-id="handleSessionUpdate"
          @run-complete="emit('runComplete', $event)"
          @error="emit('error', $event)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.sdk-agent-chat-panel {
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

.sdk-agent-chat-panel-header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--sdk-border-color, var(--el-border-color-lighter, #e4e7ed));
}

.sdk-agent-chat-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--sdk-text-primary, var(--el-text-color-primary, #1f2329));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-agent-chat-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sdk-agent-chat-panel-state {
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

.sdk-agent-chat-panel-message {
  margin: 0;
  max-width: 420px;
  line-height: 1.5;
}

.sdk-agent-chat-panel-btn {
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

.sdk-agent-chat-panel-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
