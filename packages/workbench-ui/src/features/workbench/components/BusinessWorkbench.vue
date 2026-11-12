<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { AgentShell, useAgentNav, useSessionRunFeed, type ShellFeatureDeclaration, type ShellWorkbenchDeclaration } from "@ontomato/agent-shell-ui";
import { AgentModelsPage, ontologyAgentModelPages, ontologyAgentModelSource, usePageAccess } from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { AgentSettingsNav, AgentSettingsPage, dataEngineTransport } from "../../agents";
import { getWorkbenchAppearance } from "../api";
import { createAssistantClient, createAssistantFeedback } from "../assistant-host";
import { readRememberedAgent, rememberAgent } from "../remembered-agent";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import DatasetActions from "./DatasetActions.vue";
import DatasetDrilldown from "./DatasetDrilldown.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import { workbenchFeatures } from "../features";
import FollowUpRenderer from "./FollowUpRenderer.vue";
import ClarificationRenderer from "./ClarificationRenderer.vue";
const artifactRenderers = [
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

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const client = createAssistantClient();
const feedback = createAssistantFeedback();
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
/**
 * `?agentId=` names the agent a link from elsewhere (the platform home) asks for: alone it opens a new conversation with
 * it, with `&prompt=` that conversation starts with the text, with `&sessionId=` it reopens that conversation. The page
 * starts from its own choice (the remembered agent, settled against the agent list as always) and the request replaces
 * it once the list shows the agent enabled; no conversation is opened before that.
 */
const queryText = (value: unknown) => (typeof value === "string" ? value : null);
const requestedAgent = () => queryText(route.query.agentId);
const agentId = ref<string | null>(readRememberedAgent());
/**
 * The application's own pages, by the name the shell shows for them. The dashboards and the scheduled tasks are
 * applications of their own now, so nothing here leaves this application.
 */
const featureRoutes = { agents: routes.agents };
/** The settings' addresses: the editor of one agent or a new one. */
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
/** The models of the ontology service agents the conversations run on: the settings' own entry at their column's foot. */
const modelsOpen = computed(() => route.path === routes.agentModels.path);
const modelsPage = ontologyAgentModelPages.find((page) => page.app === "agents")!;
const modelSource = ontologyAgentModelSource(dataEngineTransport, modelsPage);
const settingsAgentId = computed(() => {
  const id = route.params.agentId;
  return typeof id === "string" && !creatingAgent.value ? id : null;
});
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
const shell = ref<InstanceType<typeof AgentShell> | null>(null);

watch(agentId, (id) => {
  if (id) rememberAgent(id);
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
// The one list notice stream of this page: every conversation it lists follows its run, whichever one is open.
useSessionRunFeed({
  port: client.sessionRuns,
  sessions: () => nav.sessions.value,
  onError: (error) => ElMessage.error(error instanceof Error ? error.message : String(error)),
});
watch(locale, () => {
  void nav.loadAgents().catch((error) => ElMessage.error(error instanceof Error ? error.message : String(error)));
});

/** The conversation the reader came from, so leaving the settings returns to it rather than to a new one. */
const returnTo = ref<string | null>(null);
watch(inSettings, (open) => {
  if (!open) returnTo.value = null;
});

/**
 * The settings the account may open: the agents' (with the agents' permission), and the models of the ontology service
 * agents the conversations run on (with the model permission). Each is a page of the platform's navigation.
 */
const canOpen = usePageAccess();
const editsAgents = computed(() => canOpen(SETTINGS_PATH));
const opensModels = computed(() => canOpen(routes.agentModels.path));

/** The agent settings: the agent the conversation runs on (or the first one), or the models when only they are open. */
function openSettings() {
  returnTo.value = conversationId.value;
  if (!editsAgents.value) return void router.push(routes.agentModels.path);
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

function openModels() {
  void router.push(routes.agentModels.path);
}

/** The column's own entry at the foot: the agent settings, which replace the column while they are open. */
const bottomEntry = computed(() =>
  editsAgents.value || opensModels.value ? { label: t("assistant.featureAgents"), icon: "agents" } : null,
);

/**
 * Applies `?agentId=` once the agents are known. The link's parameters leave the address first, so a reload neither
 * sends its question again nor reopens what it named; the page then follows its own conversation behaviour. A disabled
 * or missing agent is reported and the page keeps the agent its own rule chose. An enabled one is selected, and then the
 * named conversation opens, or a new one starts and, with a question, sends it as its first message.
 */
async function openRequestedAgent() {
  const id = requestedAgent();
  if (!id) return;
  const session = queryText(route.query.sessionId);
  const prompt = queryText(route.query.prompt);
  const query = { ...route.query };
  delete query.agentId;
  delete query.sessionId;
  delete query.prompt;
  void router.replace({ query });
  if (!nav.agents.value.some((agent) => agent.id === id && agent.enabled)) {
    ElMessage.error(t("assistant.agentUnavailable"));
    return;
  }
  agentId.value = id;
  // Switching agents starts a new conversation in the navigation; what the link names comes after that.
  await nextTick();
  if (session) {
    nav.selectSession(session);
    return;
  }
  nav.startNew();
  if (!prompt) return;
  // The shell sends in the conversation it has open: let it take the agent and the new conversation first.
  await nextTick();
  await shell.value!.send(prompt);
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
        :models="modelsOpen"
        @back="backToChat"
        @select-agent="selectSettingsAgent"
        @create-agent="createSettingsAgent"
        @open-models="openModels"
      />
    </template>
    <template #feature="{ featureId: page }">
      <AgentModelsPage v-if="page === 'agents' && modelsOpen" :source="modelSource" :path="modelsPage.path" />
      <AgentSettingsPage
        v-else-if="page === 'agents'"
        :agent-id="settingsAgentId"
        :creating="creatingAgent"
        @changed="shell?.reloadAgents()"
      />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #dataset-selection-actions="{ artifact, title, selectedRowIndices }">
      <DatasetDrilldown :artifact="artifact" :title="title" :selected-row-indices="selectedRowIndices" />
    </template>
    <template #artifact-actions="{ artifact, title }">
      <!-- A dataset added to a board opens the dashboards application, which is where boards live. -->
      <DatasetActions :artifact="artifact" :title="title" @open-dashboard="openDashboardApplication" />
    </template>
    <template #message-actions="{ sessionId, runId }">
      <TurnDiagnoseButton v-if="sessionId && runId" :session-id="sessionId" :run-id="runId" />
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
