<script setup lang="ts">
import { nextTick, computed, onMounted, provide, ref, toRef, useSlots, watch } from "vue";
import { Menu } from "lucide-vue-next";
import { defaultChartTheme, type ChartTheme } from "../chart-theme";
import { shellContextKey, type ShellContext } from "../context";
import type { AgentHostClient } from "../host";
import { useAgentNav, type AgentNav } from "../useAgentNav";
import type {
  ArtifactRendererOverride,
  OpenArtifact,
  ShellFeedbackPort,
  ShellLabels,
  ShellWorkbenchDeclaration,
  ToolRendererOverride,
} from "../types";
import { useAgentConversation } from "../useAgentConversation";
import ShellConversation from "./ShellConversation.vue";
import ShellPagePane from "./ShellPagePane.vue";
import ShellSidePanel from "./ShellSidePanel.vue";
import ShellSidebar from "./ShellSidebar.vue";

/**
 * Two-column agent shell with a right outlet: navigation (features, agent, sessions) and the
 * conversation. Rendering defaults live here; hosts pass overrides and fill the slots:
 * `brand`, `footer`, `feature` (feature pages), `artifact-actions` and `message-actions`.
 *
 * `embedded` is for a host that already draws the navigation around the shell: it renders the conversation area alone,
 * with no sidebar, gutter, radius or shadow, and it owns no navigation state of its own — the host passes its `nav`, so
 * the panel beside the conversation and the conversation itself read and write one list.
 *
 * A feature declared `withConversation` follows the agent-app states (DESIGN "Agent apps"): conversation only, the
 * page beside the conversation, or the page full with a composer. Messages sent while such a page is open end with the
 * host's `pageContext` line, so the agent knows what "this" refers to.
 */
const props = withDefaults(
  defineProps<{
    workbench: ShellWorkbenchDeclaration;
    client: AgentHostClient;
    labels: ShellLabels;
    feedback?: ShellFeedbackPort;
    artifactRenderers?: readonly ArtifactRendererOverride[];
    toolRenderers?: readonly ToolRendererOverride[];
    chartTheme?: ChartTheme;
    /** One line naming the open page and its selection, appended to messages sent while a paired page is open. */
    pageContext?: string | null;
    /** Recognises an in-app address in an answer and returns how to open its page; null leaves it as text. */
    pageLinks?: ShellContext["pageLink"];
    /**
     * The host's navigation state, when the host draws the navigation itself (the platform shell's application panel).
     * One instance is shared by that panel and this shell, so a conversation created while sending appears in the panel
     * and the agents and sessions are read once. Embedded, this is required; standalone, the shell keeps its own.
     */
    nav?: AgentNav;
  }>(),
  { artifactRenderers: () => [], toolRenderers: () => [], chartTheme: () => defaultChartTheme, nav: undefined },
);
const slots = useSlots();
const emit = defineEmits<{ error: [message: string]; featureAction: [id: string] }>();
const featureId = defineModel<string | null>("featureId", { default: null });
const agentId = defineModel<string | null>("agentId", { default: null });
const sessionId = defineModel<string | null>("sessionId", { default: null });
/** Where a paired page sits: filling the workspace, or beside the conversation. Hosts may set it. */
const pageView = defineModel<"full" | "side">("pageView", { default: "full" });
const openArtifact = ref<OpenArtifact | null>(null);
const navOpen = ref(false);

const conversation = useAgentConversation(() => props.client);
/** Embedded means the host owns the navigation: it passes one `nav` and this shell must not build a second. */
const embedded = computed(() => props.nav !== undefined);

/**
 * The navigation state: the host's when it passed one, otherwise the shell's own for its sidebar. Building a second one
 * while embedded would show a stale list in the panel and read the agents and sessions twice.
 */
const ownNav = props.nav ? null : useAgentNav({
  client: () => props.client,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => sessionId.value,
  setSessionId: (id) => (sessionId.value = id),
  onLeaveConversation: () => {
    featureId.value = null;
    openArtifact.value = null;
    navOpen.value = false;
  },
});
const nav = props.nav ?? ownNav!;
const { agents, sessions, sessionsState, nextCursor, currentAgent, loadSessions } = nav;
const currentSession = computed(() => sessions.value.find((session) => session.id === sessionId.value));
const currentFeature = computed(() => props.workbench.features.find((feature) => feature.id === featureId.value) ?? null);
/** A page that sits in the agent-app states rather than replacing the conversation. */
const pairedPage = computed(() => currentFeature.value?.withConversation === true);
const pageFull = computed(() => pairedPage.value && pageView.value === "full");

provide(shellContextKey, {
  labels: toRef(props, "labels"),
  artifactRenderers: toRef(props, "artifactRenderers"),
  toolRenderers: toRef(props, "toolRenderers"),
  chartTheme: toRef(props, "chartTheme"),
  slots: {
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
});

function report(error: unknown) {
  emit("error", error instanceof Error ? error.message : String(error));
}

/** The nav reports read failures to the host; `useAgentNav` itself only records the state. */
function loadAgentsFromHost() {
  return nav.loadAgents().catch(report);
}

/** The selection moves: the page beside the conversation closes with it, as it always has. */
function startNew() {
  nav.startNew();
}

function selectSession(id: string) {
  nav.selectSession(id);
}

async function removeSession(id: string) {
  try {
    await nav.removeSession(id);
  } catch (error) {
    report(error);
  }
}

// A new conversation writes its id while sending; that run is already open, so opening it again
// would reset the pending message and the admitted snapshot.
watch(sessionId, (id) => {
  if (id !== null && id === conversation.state.sessionId) return;
  openArtifact.value = null;
  void conversation.open(id);
}, { immediate: true });

function selectFeature(id: string) {
  featureId.value = id;
  pageView.value = "full";
  openArtifact.value = null;
  navOpen.value = false;
}

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

// Keep the session list's run state in step with the conversation that is open.
watch(
  () => conversation.activeRunId.value,
  (_, previous) => {
    const entry = currentSession.value;
    const run = previous ? conversation.state.runs[previous] : undefined;
    if (entry?.latestRun && run && entry.latestRun.id === run.id && run.status === "stopped")
      entry.latestRun = nav.runStatus(run);
  },
);

/** Hosts call this after editing agent definitions. */
defineExpose({ reloadAgents: loadAgentsFromHost });

onMounted(async () => {
  // An address that names both a conversation and a paired page reopens them side by side.
  if (sessionId.value && pairedPage.value) pageView.value = "side";
  // Embedded, the host loaded the agents and sessions for the panel it draws; reading them again here would duplicate
  // both requests and could resolve the selected agent a second time.
  if (embedded.value) return;
  const requested = agentId.value;
  await loadAgentsFromHost();
  // When the host's agent was valid the watcher did not fire, so load its sessions here.
  if (agentId.value && agentId.value === requested) void loadSessions();
});
</script>

<template>
  <div
    class="agent-shell"
    :class="{ 'nav-open': navOpen, 'panel-open': openArtifact, embedded }"
  >
    <div v-if="!embedded" class="nav-scrim" @click="navOpen = false" />
    <ShellSidebar
      v-if="!embedded"
      class="shell-nav"
      :workbench="workbench"
      :agents="agents"
      :agent-id="agentId"
      :sessions="sessions"
      :sessions-state="sessionsState"
      :has-more="nextCursor !== null"
      :session-id="sessionId"
      :feature-id="featureId"
      @new-conversation="startNew"
      @select-feature="selectFeature"
      @feature-action="emit('featureAction', $event); navOpen = false"
      @select-agent="agentId = $event"
      @select-session="selectSession"
      @delete-session="removeSession"
      @load-more="loadSessions(true)"
      @retry="loadSessions()"
    >
      <template #brand><slot name="brand" /></template>
      <template #footer><slot name="footer" /></template>
    </ShellSidebar>

    <main v-show="!pageFull" class="shell-main">
      <div v-if="!embedded" class="mobile-bar">
        <button type="button" class="mobile-menu" :aria-label="labels.menu" @click="navOpen = true">
          <Menu :size="19" />
        </button>
        <span class="mobile-title">{{ currentSession?.title || currentAgent?.name }}</span>
      </div>
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
      />
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
      @menu="navOpen = true"
    >
      <slot name="feature" :feature-id="featureId" :view="pageView" />
    </ShellPagePane>

    <ShellSidePanel v-if="openArtifact && !featureId" :open="openArtifact" @close="openArtifact = null" />
  </div>
</template>

<style scoped>
/*
 * Conversation shell (DESIGN.md "Applications and shells"): the sidebar sits on canvas with no divider; the
 * conversation is one raised surface panel with the conversation gutter around it. Its composer is raised too.
 */
.agent-shell {
  --shell-composer-shadow: var(--elevation-composer);
  display: flex;
  gap: var(--shell-conversation-gutter);
  height: 100vh;
  height: 100dvh;
  padding: var(--shell-conversation-gutter) var(--shell-conversation-gutter) var(--shell-conversation-gutter) 0;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
.shell-nav {
  width: var(--shell-agent-rail);
  flex-shrink: 0;
}
/*
 * Embedded in the platform shell: the host draws the navigation and the three bands, so the conversation sits flat on
 * the workspace instead of being a raised panel with a gutter around it.
 */
.agent-shell.embedded {
  gap: 0;
  padding: 0;
  height: 100%;
  background: transparent;
}
.agent-shell.embedded .shell-main {
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}
.shell-main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--el-border-color);
  border-radius: var(--shell-conversation-radius);
  background: var(--el-bg-color);
  box-shadow: var(--elevation-panel);
  overflow: hidden;
}
.feature-page {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.mobile-bar,
.nav-scrim {
  display: none;
}
@media (max-width: 760px) {
  .agent-shell {
    padding: 0;
  }
  .shell-main {
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .shell-nav {
    position: fixed;
    z-index: 50;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(86vw, 300px);
    background: var(--el-bg-color-page);
    transform: translateX(-100%);
    visibility: hidden;
    transition:
      transform var(--transition-base, 200ms),
      visibility var(--transition-base, 200ms);
  }
  .nav-open .shell-nav {
    transform: none;
    visibility: visible;
    box-shadow: var(--elevation-modal);
  }
  .nav-scrim {
    position: fixed;
    z-index: 45;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
  }
  .nav-open .nav-scrim {
    display: block;
  }
  .mobile-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--panel-header-height);
    padding: 0 8px;
    border-bottom: 1px solid var(--el-border-color);
  }
  .mobile-menu {
    display: grid;
    place-items: center;
    width: var(--control-height);
    height: var(--control-height);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
  }
  .mobile-title {
    font-size: var(--text-base);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
