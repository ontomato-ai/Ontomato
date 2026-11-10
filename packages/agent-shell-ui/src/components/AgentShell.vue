<script setup lang="ts">
import { computed, onMounted, provide, ref, toRef, useSlots, watch } from "vue";
import { shellContextKey, type ShellContext } from "../context";
import type { AgentHostClient } from "../host";
import type { AgentNav } from "../useAgentNav";
import type {
  ArtifactRendererOverride,
  OpenArtifact,
  ShellFeedbackPort,
  ShellLabels,
  ShellRunChange,
  ShellWorkbenchDeclaration,
  ToolRendererOverride,
} from "../types";
import { useAgentConversation } from "../useAgentConversation";
import ShellColumn from "./ShellColumn.vue";
import ShellConversation from "./ShellConversation.vue";
import ShellNavBody from "./ShellNavBody.vue";
import ShellPagePane from "./ShellPagePane.vue";
import ShellSidePanel from "./ShellSidePanel.vue";

/**
 * A conversation application inside the area the platform gives it: its own column, then the conversation with the right
 * outlet for an artifact (the page beside it, or the page full).
 *
 * The column belongs to the application (DESIGN.md "Applications and shells"): this component draws its frame and, by
 * default, the application's navigation — the agent switch or the application's name, a new conversation, the
 * application's own pages, the recent conversations and the application's own entry at the foot. A host that needs a
 * different column (the agent platform's settings navigation) fills the `column` slot instead. One `nav` is shared with
 * the conversation, so a conversation created while sending appears in the column and the agents and sessions are read
 * once.
 *
 * Rendering defaults live here; hosts pass overrides and fill the slots `feature` (feature pages), `artifact-actions` and
 * `message-actions`.
 *
 * A feature declared `withConversation` follows the agent-app states (DESIGN "Agent apps"): conversation only, the
 * page beside the conversation, or the page full with a composer. Messages sent while such a page is open end with the
 * host's `pageContext` line, so the agent knows what "this" refers to. Such a page may fill `page-header` (its own
 * controls, in the row of the shell's expand and close buttons) and `composer-context` (shown above whichever composer
 * is in view; `pageOpen` tells whether a message sent now carries the page context).
 *
 * `run` reports the open conversation's run starting and stopping, with the workspace commit a stopped run saved.
 */
const props = withDefaults(
  defineProps<{
    workbench: ShellWorkbenchDeclaration;
    client: AgentHostClient;
    labels: ShellLabels;
    feedback?: ShellFeedbackPort;
    artifactRenderers?: readonly ArtifactRendererOverride[];
    toolRenderers?: readonly ToolRendererOverride[];
    /** One line naming the open page and its selection, appended to messages sent while a paired page is open. */
    pageContext?: string | null;
    /** Recognises an in-app address in an answer and returns how to open its page; null leaves it as text. */
    pageLinks?: ShellContext["pageLink"];
    /**
     * The navigation state the host shares with its column: one instance, so a conversation created while sending
     * appears in the column and the agents and sessions are read once.
     */
    nav: AgentNav;
    agentPicker?: boolean;
    /** The application's name, at the top of the column when the application runs on one agent. */
    title?: string;
    /** The application's own entry at the foot of its column (its settings, the model the diagnosis runs on). */
    bottom?: { label: string; icon: string } | null;
  }>(),
  { artifactRenderers: () => [], toolRenderers: () => [], title: "", bottom: null },
);
const slots = useSlots();
const emit = defineEmits<{ error: [message: string]; featureAction: [id: string]; openBottom: []; run: [change: ShellRunChange] }>();
const featureId = defineModel<string | null>("featureId", { default: null });
const agentId = defineModel<string | null>("agentId", { default: null });
const sessionId = defineModel<string | null>("sessionId", { default: null });
/** Where a paired page sits: filling the workspace, or beside the conversation. Hosts may set it. */
const pageView = defineModel<"full" | "side">("pageView", { default: "full" });
const openArtifact = ref<OpenArtifact | null>(null);

const conversation = useAgentConversation(() => props.client);
const nav = props.nav;
const { sessions, currentAgent } = nav;
const currentSession = computed(() => sessions.value.find((session) => session.id === sessionId.value));
const currentFeature = computed(() => props.workbench.features.find((feature) => feature.id === featureId.value) ?? null);
/** A page that sits in the agent-app states rather than replacing the conversation. */
const pairedPage = computed(() => currentFeature.value?.withConversation === true);
const pageFull = computed(() => pairedPage.value && pageView.value === "full");

provide(shellContextKey, {
  labels: toRef(props, "labels"),
  artifactRenderers: toRef(props, "artifactRenderers"),
  toolRenderers: toRef(props, "toolRenderers"),
  slots: {
    get datasetSelectionActions() {
      return slots["dataset-selection-actions"];
    },
    get artifactActions() {
      return slots["artifact-actions"];
    },
    get messageActions() {
      return slots["message-actions"];
    },
  },
  resolveArtifact: conversation.resolveArtifact,
  artifactRevision: conversation.artifactRevision,
  readArtifact: (artifact) => props.client.readArtifact(artifact),
  readRetrieval: (...args) => props.client.readRetrieval(...args),
  readRetrievalRun: (...args) => props.client.readRetrievalRun(...args),
  subscribeRetrieval: (...args) => props.client.subscribeRetrieval(...args),
  openArtifact: (open) => {
    // The side holds one thing at a time: an expanded card replaces a page beside the conversation.
    if (pairedPage.value) featureId.value = null;
    openArtifact.value = open;
  },
  openArtifactKey: computed(() => openArtifact.value?.key ?? null),
  pageLink: (href) => {
    const open = props.pageLinks?.(href);
    if (!open) return null;
    return () => {
      openArtifact.value = null;
      pageView.value = "side";
      open();
    };
  },
  continueConversation: async (message) => {
    if (conversation.busy.value) throw new Error(props.labels.working);
    await send(message);
  },
  refreshConversation: async () => { await conversation.open(sessionId.value); },
});

function report(error: unknown) {
  emit("error", error instanceof Error ? error.message : String(error));
}

// A new conversation writes its id while sending; that run is already open, so opening it again
// would reset the pending message and the admitted snapshot.
watch(sessionId, (id) => {
  if (id !== null && id === conversation.state.sessionId) return;
  openArtifact.value = null;
  void conversation.open(id);
}, { immediate: true });


function closePage() {
  featureId.value = null;
  pageView.value = "full";
}

/** Sending from a full page brings the conversation back beside it, so the reply is visible. */
function sendFromPage(text: string) {
  pageView.value = "side";
  void send(text);
}

async function send(input: string) {
  const agent = agentId.value;
  if (!agent) return;
  const context = pairedPage.value ? props.pageContext?.trim() : "";
  const text = context ? `${input}\n\n${context}` : input;
  const result = await conversation.send(agent, text);
  if (!result) return;
  const latestRun = result.snapshot.run;
  const created = result.createdSession;
  if (created) {
    // The state already carries this session and its admitted run; linking the id afterwards keeps
    // the watch from opening it again and discarding the pending message.
    nav.promoteSession(created, text, latestRun);
    sessionId.value = created.id;
    return;
  }
  nav.markRun(latestRun);
}

/*
 * Keep the session list's run state in step with the conversation that is open, and tell the host. A run left behind
 * by opening another conversation is no longer in the state, so only a run of this conversation reports stopping.
 */
watch(
  () => conversation.activeRunId.value,
  (current, previous) => {
    const entry = currentSession.value;
    const run = previous ? conversation.state.runs[previous] : undefined;
    const session = conversation.state.sessionId;
    if (run?.status === "stopped") {
      if (entry?.latestRun?.id === run.id) entry.latestRun = nav.runStatus(run);
      if (session) emit("run", { sessionId: session, runId: run.id, status: "stopped", workspaceCommit: run.workspaceCommit });
    }
    if (current && session) emit("run", { sessionId: session, runId: current, status: "running", workspaceCommit: null });
  },
);

/** Hosts call this after editing agent definitions; the column reads the same state. */
defineExpose({ reloadAgents: () => nav.loadAgents().catch(report) });

onMounted(() => {
  // An address that names both a conversation and a paired page reopens them side by side.
  if (sessionId.value && pairedPage.value) pageView.value = "side";
});
</script>

<template>
  <div class="agent-shell" :class="{ 'panel-open': openArtifact }">
    <!-- The application's own column. A host with its own navigation (the agent settings) fills the slot. -->
    <ShellColumn :label="title">
      <slot name="column">
        <ShellNavBody
          :workbench="workbench"
          :title="title"
          :agents="nav.agents.value"
          :agent-picker="agentPicker"
          :agent-id="agentId"
          :sessions="nav.sessions.value"
          :sessions-state="nav.sessionsState.value"
          :has-more="nav.nextCursor.value !== null"
          :session-id="sessionId"
          :feature-id="featureId"
          :bottom="bottom"
          :labels="labels"
          @new-conversation="nav.startNew()"
          @select-feature="featureId = $event"
          @feature-action="emit('featureAction', $event)"
          @select-agent="agentId = $event"
          @select-session="nav.selectSession($event)"
          @delete-session="(id) => nav.removeSession(id).catch(report)"
          @rename-session="(id, title) => nav.renameSession(id, title).catch(report)"
          @open-bottom="emit('openBottom')"
          @load-more="void nav.loadSessions(true)"
          @retry="void nav.loadSessions()"
        />
      </slot>
    </ShellColumn>

    <main v-show="!pageFull" class="shell-main">
      <div v-if="featureId && !pairedPage" class="feature-page">
        <slot name="feature" :feature-id="featureId" view="full" />
      </div>
      <ShellConversation
        v-else
        :items="conversation.items.value"
        :session-id="sessionId"
        :agent="currentAgent"
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
        @retry="conversation.open(sessionId)"
        @load-older="conversation.loadOlder"
      >
        <template v-if="slots['composer-context']" #composer-context>
          <slot name="composer-context" :page-open="pairedPage" />
        </template>
      </ShellConversation>
    </main>

    <ShellPagePane
      v-if="featureId && pairedPage"
      :feature="currentFeature"
      :view="pageView"
      :busy="conversation.busy.value"
      :disabled="!currentAgent?.enabled"
      @send="sendFromPage"
      @stop="conversation.cancel"
      @expand="pageView = 'full'"
      @collapse="pageView = 'side'"
      @close="closePage"
    >
      <template v-if="slots['page-header']" #header>
        <slot name="page-header" :feature-id="featureId" :view="pageView" />
      </template>
      <template v-if="slots['composer-context']" #composer-context>
        <slot name="composer-context" :page-open="true" />
      </template>
      <slot name="feature" :feature-id="featureId" :view="pageView" />
    </ShellPagePane>

    <ShellSidePanel v-if="openArtifact && !featureId" :open="openArtifact" @close="openArtifact = null" />
  </div>
</template>

<style scoped>
/*
 * The conversation application, filling the surface the platform gives it: its own column, then the conversation on one
 * flat area, no gutter, no border and no shadow of its own (DESIGN.md "Applications and shells"). Its composer is raised.
 */
.agent-shell {
  --shell-composer-shadow: var(--elevation-composer);
  display: flex;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
/* The conversation's ground is the application's own area, the page tone; what fades into it fades into that. */
.shell-main {
  --shell-conversation-ground: var(--el-bg-color-page);
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.feature-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
@media (max-width: 760px) {
  .agent-shell { flex-direction: column; }
  .agent-shell > :deep(.shell-column) {
    flex: 0 0 auto;
    max-height: 240px;
    overflow: auto;
  }
  .shell-main { min-height: 0; }
}
</style>
