<script setup lang="ts">
import { computed, onMounted, provide, ref, toRef, useSlots, watch } from "vue";
import { Menu } from "lucide-vue-next";
import { defaultChartTheme, type ChartTheme } from "../chart-theme";
import { shellContextKey } from "../context";
import type { AgentHostAgent, AgentHostSession } from "@ontomato/contracts/agent-host";
import type { AgentHostClient } from "../host";
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
import ShellSidePanel from "./ShellSidePanel.vue";
import ShellSidebar from "./ShellSidebar.vue";

/**
 * Two-column agent shell with a right outlet: navigation (features, agent, sessions) and the
 * conversation. Rendering defaults live here; hosts pass overrides and fill the slots:
 * `brand`, `footer`, `feature` (feature pages), `artifact-actions` and `message-actions`.
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
  }>(),
  { artifactRenderers: () => [], toolRenderers: () => [], chartTheme: () => defaultChartTheme },
);
const slots = useSlots();
const emit = defineEmits<{ error: [message: string]; featureAction: [id: string] }>();
const featureId = defineModel<string | null>("featureId", { default: null });
const agentId = defineModel<string | null>("agentId", { default: null });

const agents = ref<AgentHostAgent[]>([]);
const sessions = ref<AgentHostSession[]>([]);
const sessionsState = ref<"loading" | "ready" | "error">("loading");
const nextCursor = ref<string | null>(null);
const sessionId = defineModel<string | null>("sessionId", { default: null });
const openArtifact = ref<OpenArtifact | null>(null);
const navOpen = ref(false);
let sessionsLoad = 0;

const conversation = useAgentConversation(() => props.client);
const currentAgent = computed(() => agents.value.find((agent) => agent.id === agentId.value) ?? null);
const currentSession = computed(() => sessions.value.find((session) => session.id === sessionId.value));

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
  openArtifact: (open) => {
    openArtifact.value = open;
  },
  openArtifactKey: computed(() => openArtifact.value?.key ?? null),
});

function report(error: unknown) {
  emit("error", error instanceof Error ? error.message : String(error));
}

async function loadAgents() {
  try {
    agents.value = await props.client.listAgents();
    if (!agents.value.some((agent) => agent.id === agentId.value))
      agentId.value = (agents.value.find((agent) => agent.enabled) ?? agents.value[0])?.id ?? null;
  } catch (error) {
    report(error);
  }
}

async function loadSessions(more = false) {
  const agent = agentId.value;
  if (!agent) return;
  const load = ++sessionsLoad;
  sessionsState.value = "loading";
  try {
    const page = await props.client.listSessions(agent, more ? nextCursor.value : null);
    if (load !== sessionsLoad) return;
    sessions.value = more ? [...sessions.value, ...page.sessions] : page.sessions;
    nextCursor.value = page.nextCursor;
    sessionsState.value = "ready";
  } catch {
    if (load === sessionsLoad) sessionsState.value = "error";
  }
}

function startNew() {
  featureId.value = null;
  sessionId.value = null;
  openArtifact.value = null;
  navOpen.value = false;

}

function selectSession(id: string) {
  featureId.value = null;
  navOpen.value = false;
  if (id === sessionId.value) return;
  sessionId.value = id;
  openArtifact.value = null;

}

watch(sessionId, (id) => {
  openArtifact.value = null;
  void conversation.open(id);
}, { immediate: true });

function selectFeature(id: string) {
  featureId.value = id;
  openArtifact.value = null;
  navOpen.value = false;
}

async function removeSession(id: string) {
  try {
    await props.client.deleteSession(id);
    sessions.value = sessions.value.filter((session) => session.id !== id);
    if (id === sessionId.value) startNew();
  } catch (error) {
    report(error);
  }
}

async function send(text: string) {
  const agent = agentId.value;
  if (!agent) return;
  const result = await conversation.send(agent, text);
  if (!result) return;
  const latestRun = result.snapshot.run;
  const created = result.createdSession;
  if (created) {
    sessionId.value = created.id;
    sessions.value = [{ ...created, title: created.title || text, latestRun }, ...sessions.value];
    return;
  }
  const entry = sessions.value.find((session) => session.id === sessionId.value);
  if (entry) sessions.value = [{ ...entry, latestRun }, ...sessions.value.filter((session) => session !== entry)];
}

// Keep the session list's run state in step with the conversation that is open.
watch(
  () => conversation.activeRunId.value,
  (_, previous) => {
    const entry = currentSession.value;
    const run = previous ? conversation.state.runs[previous] : undefined;
    if (entry?.latestRun && run && entry.latestRun.id === run.id && run.status === "stopped") {
      const { status, stopReason, errorMessage } = run;
      entry.latestRun = { ...entry.latestRun, status, stopReason, errorMessage };
    }
  },
);

watch(agentId, (_, previous) => {
  sessions.value = [];
  nextCursor.value = null;
  if (previous !== null) startNew();
  void loadSessions();
});

/** Hosts call this after editing agent definitions. */
defineExpose({ reloadAgents: loadAgents });

onMounted(async () => {
  const requested = agentId.value;
  await loadAgents();
  // When the host's agent was valid the watcher did not fire, so load its sessions here.
  if (agentId.value && agentId.value === requested) void loadSessions();
});
</script>

<template>
  <div class="agent-shell" :class="{ 'nav-open': navOpen, 'panel-open': openArtifact }">
    <div class="nav-scrim" @click="navOpen = false" />
    <ShellSidebar
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

    <main class="shell-main">
      <div class="mobile-bar">
        <button type="button" class="mobile-menu" :aria-label="labels.menu" @click="navOpen = true">
          <Menu :size="19" />
        </button>
        <span class="mobile-title">{{ currentSession?.title || currentAgent?.name }}</span>
      </div>
      <div v-if="featureId" class="feature-page">
        <slot name="feature" :feature-id="featureId" />
      </div>
      <ShellConversation
        v-else
        :items="conversation.items.value"
        :session-id="sessionId"
        :agent="currentAgent"
        :loading="conversation.loading.value"
        :load-error="conversation.loadError.value"
        :send-error="conversation.sendError.value"
        :pending-input="conversation.pendingInput.value"
        :busy="conversation.busy.value"
        :feedback="feedback"
        @send="send"
        @stop="conversation.cancel"
        @retry="conversation.open(sessionId)"
      />
    </main>

    <ShellSidePanel v-if="openArtifact && !featureId" :open="openArtifact" @close="openArtifact = null" />
  </div>
</template>

<style scoped>
.agent-shell {
  display: flex;
  gap: 12px;
  height: 100vh;
  height: 100dvh;
  padding: 12px 12px 12px 0;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
}
.shell-nav {
  width: var(--agent-shell-nav-width, 264px);
  flex-shrink: 0;
}
.shell-main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  border-radius: 24px;
  background: var(--el-bg-color);
  box-shadow: var(--shadow-card);
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
    background: var(--el-bg-color);
    transform: translateX(-100%);
    visibility: hidden;
    transition:
      transform var(--transition-base, 200ms),
      visibility var(--transition-base, 200ms);
  }
  .nav-open .shell-nav {
    transform: none;
    visibility: visible;
    box-shadow: var(--el-shadow-xl);
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
    height: 52px;
    padding: 0 10px;
    border-bottom: 1px solid var(--el-border-color-light);
  }
  .mobile-menu {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--el-text-color-regular);
    cursor: pointer;
  }
  .mobile-title {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
