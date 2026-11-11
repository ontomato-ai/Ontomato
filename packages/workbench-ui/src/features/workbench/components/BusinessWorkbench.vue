<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { AgentShell, useAgentNav, type ShellFeatureDeclaration, type ShellWorkbenchDeclaration } from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { AgentSettingsNav, AgentSettingsPage } from "../../agents";
import { getWorkbenchAppearance } from "../api";
import { createAssistantClient, createAssistantFeedback } from "../assistant-host";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import ConversationActions from "./ConversationActions.vue";
import DatasetActions from "./DatasetActions.vue";
import DatasetDrilldown from "./DatasetDrilldown.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import { workbenchFeatures } from "../features";
import ActionProposalRenderer from "./ActionProposalRenderer.vue";
import FollowUpRenderer from "./FollowUpRenderer.vue";
import ClarificationRenderer from "./ClarificationRenderer.vue";
const artifactRenderers = [
  { path: /(?:\.action\.json$|(?:^|\/)action-[^/]+\.json$)/i, component: ActionProposalRenderer },
  { path: /\.follow-ups\.json$/i, component: FollowUpRenderer },
  { path: /\.clarification\.json$/i, component: ClarificationRenderer },
];

/**
 * The agent platform: the assistant, its conversation and its settings. Both editions mount it; the edition adds
 * entries only it has and renders those pages through the `feature` slot.
 *
 * Its column is the conversation shell's, from the same navigation state this conversation sends from, so a
 * conversation created while sending appears in the column immediately. In the settings the column is the settings
 * navigation instead, and the main area holds the editor of one agent.
 */
const props = withDefaults(
  defineProps<{
    /** Edition-specific entries of this application's column (the enterprise edition's graph). */
    features?: ShellFeatureDeclaration[];
    defaultLogo: string;
    defaultBrandName: string;
  }>(),
  { features: () => [] },
);

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";
const AGENT_KEY = "ontomato.workbench.agent";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const client = createAssistantClient();
const feedback = createAssistantFeedback();
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
/**
 * `?agentId=` asks for a new conversation with that agent (the platform home's agent cards link here). It wins over the
 * remembered agent, so the page does not open the remembered agent's conversation first and then switch.
 */
const requestedAgent = () => (typeof route.query.agentId === "string" ? route.query.agentId : null);
const agentId = ref<string | null>(requestedAgent() ?? readRemembered());
/**
 * The application's own pages, by the name the shell shows for them. The dashboards and the scheduled tasks are
 * applications of their own now, so nothing here leaves this application.
 */
const featureRoutes = { agents: routes.agents };
/** The settings' addresses: the editor of one agent, a new one, or the capability library. */
const SETTINGS_PATH = routes.agents.path;
const settingsPath = (suffix = "") => `${SETTINGS_PATH}${suffix}`;
const inSettings = computed(() => route.path === SETTINGS_PATH || route.path.startsWith(`${SETTINGS_PATH}/`));
/**
 * The settings screen the address names. "new" is its own address (`/agents/settings/new`), not a parameter value, so it
 * is recognised by route name and by the path — an agent whose id happened to be "new" would still open its editor.
 */
const creatingAgent = computed(
  () => route.name === routes.agentSettingsNew.name || route.path === `${SETTINGS_PATH}/new`,
);
const settingsAgentId = computed(() => {
  const id = route.params.agentId;
  return typeof id === "string" && !creatingAgent.value ? id : null;
});
const capabilitiesOpen = computed(() => route.path === settingsPath("/capabilities"));
/**
 * The page the shell shows: the settings are the `agents` page, whose addresses are the settings' own screens; every
 * other page names its route. Closing the page (a new conversation) returns to the conversation.
 */
const featureId = computed<string | null>({
  get: () => {
    if (inSettings.value) return "agents";
    return Object.entries(featureRoutes).find(([, page]) => page.name === route.name)?.[0] ?? null;
  },
  set: (id) => {
    if (id === "agents" && inSettings.value) return;
    const target = featureRoutes[id as keyof typeof featureRoutes] ?? routes.chat;
    if (route.name !== target.name) void router.push({ name: target.name });
  },
});
/**
 * The open conversation. The address carries it while the settings are shown, so leaving them (or reloading) returns to
 * the conversation the reader came from instead of to a blank one.
 */
const conversationId = ref<string | null>(
  !requestedAgent() && typeof route.query.sessionId === "string" ? route.query.sessionId : null,
);
watch(
  () => route.query.sessionId,
  (id) => {
    if (typeof id === "string" && id !== conversationId.value) conversationId.value = id;
  },
);
const shell = ref<{ reloadAgents: () => Promise<void> } | null>(null);

function readRemembered(): string | null {
  try {
    return localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}
watch(agentId, (id) => {
  try {
    if (id) localStorage.setItem(AGENT_KEY, id);
  } catch {
    // Remembering the agent is a convenience only.
  }
});

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand?.name || props.defaultBrandName,
  features: workbenchFeatures(props.features),
}));

const labels = useShellLabels();

/**
 * The one navigation state: the platform column lists the agents and conversations from it, and this conversation
 * sends and promotes into it, so the two cannot disagree.
 */
const nav = useAgentNav({
  client: () => client,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => conversationId.value,
  setSessionId: (id) => (conversationId.value = id),
  onLeaveConversation: () => (featureId.value = null),
});
watch(locale, () => {
  void nav.loadAgents().catch((error) => ElMessage.error(error instanceof Error ? error.message : String(error)));
});

/** The conversation the reader came from, so leaving the settings returns to it rather than to a new one. */
const returnTo = ref<string | null>(null);
watch(inSettings, (open) => {
  if (!open) returnTo.value = null;
});

/** The agent settings: the agent the conversation runs on, or the first one the account has. */
function openSettings() {
  returnTo.value = conversationId.value;
  void router.push(agentId.value ? settingsPath(`/${agentId.value}`) : SETTINGS_PATH);
}

function backToChat() {
  const session = returnTo.value;
  featureId.value = null;
  conversationId.value = session;
  void router.push({ name: routes.chat.name, query: session ? { sessionId: session } : {} });
}

function selectSettingsAgent(id: string) {
  void router.push(settingsPath(`/${id}`));
}

function createSettingsAgent() {
  void router.push(settingsPath("/new"));
}

/** The capability library, from the column's row and from the editor's button alike. */
function openCapabilities() {
  void router.push({ name: routes.agentSettingsCapabilities.name });
}

/** The column's own entry at the foot: the agent settings, which replace the column while they are open. */
const bottomEntry = computed(() => ({ label: t("assistant.featureAgents"), icon: "agents" }));

/**
 * Applies `?agentId=` once the agents are known: an enabled agent is selected on an empty new conversation; any other id
 * is reported and nothing else is chosen in its place. The parameter then leaves the address (with a conversation it
 * would have overridden), so a reload or a later switch follows the page's own conversation behaviour.
 */
function openRequestedAgent() {
  const id = requestedAgent();
  if (!id) return;
  if (nav.agents.value.some((agent) => agent.id === id && agent.enabled)) {
    agentId.value = id;
    nav.startNew();
  } else {
    ElMessage.error(t("assistant.agentUnavailable"));
  }
  const query = { ...route.query };
  delete query.agentId;
  delete query.sessionId;
  void router.replace({ query });
}
// The same address entered while the page is open (another link to an agent) does the same.
watch(() => route.query.agentId, openRequestedAgent);

/** The board a conversation just added a dataset to: the dashboards application, opened on that board. */
function openDashboardApplication(dashboardId: string) {
  void router.push({ path: routes.dashboards.path, query: { dashboardId } });
}

onMounted(async () => {
  try {
    appearance.value = await getWorkbenchAppearance();
  } catch {
    ElMessage.error(t("appearance.loadFailed"));
  }
  // The column shows the list, so the agent platform loads it; the conversation only reads the state.
  await nav.loadAgents().then(openRequestedAgent, (error) => ElMessage.error(error instanceof Error ? error.message : String(error)));
  await nav.loadSessions();
});

function appearanceSaved(value: WorkbenchAppearance) {
  appearance.value = value;
  editingBrand.value = false;
}

</script>

<template>
  <AgentShell
    ref="shell"
    v-model:agent-id="agentId"
    v-model:feature-id="featureId"
    v-model:session-id="conversationId"
    agent-picker
    :workbench="workbench"
    :title="workbench.label"
    :bottom="bottomEntry"
    :client="client"
    :labels="labels"
    :nav="nav"
    :feedback="feedback"
    :artifact-renderers="artifactRenderers"
    @error="ElMessage.error($event)"
    @feature-action="emit('featureAction', $event)"
    @open-bottom="openSettings"
  >
    <!-- In the settings the application's column is the settings navigation; the editor is the whole main area. -->
    <template v-if="inSettings" #column>
      <AgentSettingsNav
        :agent-id="settingsAgentId"
        :creating="creatingAgent"
        :capabilities="capabilitiesOpen"
        @back="backToChat"
        @select-agent="selectSettingsAgent"
        @create-agent="createSettingsAgent"
        @open-capabilities="openCapabilities"
      />
    </template>
    <template #feature="{ featureId: page }">
      <AgentSettingsPage
        v-if="page === 'agents'"
        :agent-id="settingsAgentId"
        :creating="creatingAgent"
        :capabilities="capabilitiesOpen"
        @changed="shell?.reloadAgents()"
        @open-capabilities="openCapabilities"
      />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #dataset-selection-actions="{ artifact, selectedRowIndices, refreshConversation }">
      <DatasetDrilldown :artifact="artifact" :selected-row-indices="selectedRowIndices" :refresh-conversation="refreshConversation" />
    </template>
    <template #artifact-actions="{ artifact, refreshConversation }">
      <!-- A dataset added to a board opens the dashboards application, which is where boards live. -->
      <DatasetActions :artifact="artifact" :refresh-conversation="refreshConversation" @open-dashboard="openDashboardApplication" />
    </template>
    <template #message-actions="{ sessionId, runId }">
      <TurnDiagnoseButton v-if="sessionId && runId" :session-id="sessionId" :run-id="runId" />
      <ConversationActions v-if="sessionId" :session-id="sessionId" />
    </template>
  </AgentShell>
  <WorkbenchAppearanceDialog
    v-if="editingBrand"
    :default-logo="defaultLogo"
    :default-brand-name="defaultBrandName"
    @close="editingBrand = false"
    @saved="appearanceSaved"
  />
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-radius: var(--radius-sm);
}
</style>
