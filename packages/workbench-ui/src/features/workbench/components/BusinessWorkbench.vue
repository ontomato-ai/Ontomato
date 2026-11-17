<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  AgentShell, useAgentNav, useSessionRunFeed,
  type PageContext, type ShellFeatureDeclaration, type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import {
  AgentModelsPage, ontologyAgentModelPages, ontologyAgentModelSource, usePageAccess, usePilotPage,
} from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { AgentSettingsNav, AgentSettingsPage, dataEngineTransport, useAgentDefinitions } from "../../agents";
import { getWorkbenchAppearance } from "../api";
import { createAssistantClient, createAssistantFeedback } from "../assistant-host";
import { readRememberedAgent, readRememberedSession, rememberAgent, rememberSession } from "../remembered-agent";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { dashboardSelection } from "../../dashboard";
import DatasetActions from "./DatasetActions.vue";
import ChartFileActions from "./ChartFileActions.vue";
import DatasetDrilldown from "./DatasetDrilldown.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import {
  AGENT_SETTINGS_PAGE_ID, DASHBOARDS_PAGE_ID, GOVERNANCE_REPORT_PAGE_ID, governanceReportPageFeature, workbenchFeatures,
} from "../features";
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
const inBuilder = computed(() => route.path===routes.agentBuilder.path||route.path.startsWith(`${routes.agentBuilder.path}/`));
const settingsPath = (suffix = "") => `${inBuilder.value?routes.agentBuilder.path:SETTINGS_PATH}${suffix}`;
const inSettings = computed(() => inBuilder.value||route.path === SETTINGS_PATH || route.path.startsWith(`${SETTINGS_PATH}/`));
/**
 * The settings screen the address names. "new" is its own address (`/agents/settings/new`), not a parameter value, so it
 * is recognised by route name and by the path — an agent whose id happened to be "new" would still open its editor.
 */
const creatingAgent = computed(
  () => route.name === routes.agentSettingsNew.name || route.name === routes.agentBuilderNew.name || route.path === `${SETTINGS_PATH}/new`,
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
 * The page beside the conversation is carried by this application's own address (`?page=<the page's address>`), so the
 * conversation stays where it is and the page is mounted from the assembly's registry, with the props its address gives
 * it and the way back for its own navigation.
 */
const pilot = usePilotPage();
const pageAddress = computed(() => (typeof route.query.page === "string" ? route.query.page : null));
const pilotPage = computed(() => (pageAddress.value ? pilot(pageAddress.value) : null));
/** Which of the platform's pages the parameter names: the dashboards application, or one governance record's report. */
const pilotFeatureId = computed(() => {
  const path = pageAddress.value?.split("?")[0];
  if (!path || !pilotPage.value) return null;
  if (path === routes.dashboards.path) return DASHBOARDS_PAGE_ID;
  if (path.startsWith("/governance/reports/")) return GOVERNANCE_REPORT_PAGE_ID;
  return null;
});
const inPilotPage = computed(() => pilotFeatureId.value !== null);
const inDashboards = computed(() => pilotFeatureId.value === DASHBOARDS_PAGE_ID);
const inGovernanceReport = computed(() => pilotFeatureId.value === GOVERNANCE_REPORT_PAGE_ID);
/**
 * The page the shell shows: the settings are the `agents` page, whose addresses are the settings' own screens, the
 * dashboards the `dashboards` page its own address opens, and every other page names its route. Closing the page (a new
 * conversation) returns to the conversation.
 */
const featureId = computed<string | null>({
  get: () => {
    if (inSettings.value) return AGENT_SETTINGS_PAGE_ID;
    if (pilotFeatureId.value) return pilotFeatureId.value;
    return Object.entries(featureRoutes).find(([, page]) => page.name === route.name)?.[0] ?? null;
  },
  set: (id) => {
    if (id === AGENT_SETTINGS_PAGE_ID && inSettings.value) return;
    // Closing the page beside the conversation only drops the parameter: the conversation stays.
    if (inPilotPage.value || id === DASHBOARDS_PAGE_ID || id === GOVERNANCE_REPORT_PAGE_ID) {
      const { page: _page, ...query } = route.query;
      void router.replace({ query });
      return;
    }
    const target = featureRoutes[id as keyof typeof featureRoutes] ?? routes.chat;
    if (route.name !== target.name) void router.push({ name: target.name });
  },
});

/** The page beside the conversation says where it moved: the parameter is its address, changed in place. */
function setPageAddress(address: string) {
  void router.replace({ query: { ...route.query, page: address } });
}
/**
 * The open conversation. The address carries it while the settings are shown, so leaving them (or reloading) returns to
 * the conversation the reader came from instead of to a blank one.
 */
const conversationId = ref<string | null>(
  !requestedAgent() && typeof route.query.sessionId === "string" ? route.query.sessionId : null,
);
/**
 * The address names the conversation on a page that has one of its own, and only until the platform's own pages (a
 * dashboard beside it) carry it: leaving those returns to the conversation the reader came from.
 */
const carriesSession = computed(() => !inSettings.value);
watch(
  () => route.query.sessionId,
  (id) => {
    if (carriesSession.value && typeof id === "string" && id !== conversationId.value) conversationId.value = id;
  },
);
const shell = ref<InstanceType<typeof AgentShell> | null>(null);

/**
 * An answer may link to a dashboard (`/dashboards?dashboardId=...`); the shell asks here rather than importing another
 * application's routes, and the address opens the page beside the conversation.
 */
function pageLinks(href: string): (() => void) | null {
  const address = href.replace(/^#/, "");
  if (!pilot(address)) return null;
  // The page opens beside the conversation; the application's own address does not change.
  return () => void router.push({ query: { ...route.query, page: address } });
}

watch(agentId, (id) => {
  if (id) rememberAgent(id);
});
// The conversation this tab holds is what a page's own composer goes on in: same tab, same agent.
watch(conversationId, (id) => {
  if (id && agentId.value) rememberSession(agentId.value, id);
});

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand?.name || props.defaultBrandName,
  features: workbenchFeatures(
    props.features,
    { agents: t("assistant.featureAgents"), dashboards: t("assistant.featureDashboards") },
    inDashboards.value ? pageAddress.value! : routes.dashboards.path,
    inGovernanceReport.value
      ? governanceReportPageFeature(t("assistant.featureGovernanceReport"), pageAddress.value!)
      : null,
  ),
}));

const labels = useShellLabels();

/**
 * The page beside the conversation: the settings name the agent they show, a dashboard names itself, a governance report
 * names the record and the finding selected in it, for a message sent from its composer. What is selected in a
 * dashboard is the dashboard's own to report.
 */
const settingsAgents = useAgentDefinitions();
const pageContext = computed<PageContext | null>(() => {
  if (inDashboards.value)
    return { pageKey: "dashboard", url: pageAddress.value!, label: t("assistant.featureDashboards"), selection: dashboardSelection.value };
  if (inGovernanceReport.value) {
    const issue = new URLSearchParams(pageAddress.value!.split("?")[1] ?? "").get("issue");
    return {
      pageKey: "governance-report",
      url: pageAddress.value!,
      label: t("assistant.featureGovernanceReport"),
      selection: issue ? [{ kind: "issue", id: issue, label: `${t("assistant.governanceFinding")} ${issue}` }] : [],
    };
  }
  if (!inSettings.value) return null;
  const agent = settingsAgents.find(settingsAgentId.value);
  return {
    pageKey: "agent-settings",
    url: route.fullPath,
    label: agent ? `${t("agents.title")} · ${agent.name}` : t("agents.title"),
    selection: settingsAgentId.value && agent ? [{ kind: "agent", id: agent.id, label: agent.name }] : [],
  };
});

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

/**
 * The page beside the conversation, enlarged: its own address, in the application that owns it. The conversation stays
 * the one this tab holds, so leaving the page returns to it.
 */
function openPageAtItsAddress(_id: string, address: string) {
  if (address) void router.push(address);
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
 *
 * A page's own composer (a dashboard's) sends its question here with `&page=`: the page it was written on opens beside
 * the conversation and stays there, so the reader's next message carries it and its answer can name what the page shows.
 */
async function openRequestedAgent() {
  const id = requestedAgent();
  if (!id) return;
  const session = queryText(route.query.sessionId);
  const prompt = queryText(route.query.prompt);
  const page = queryText(route.query.page);
  // The link's own parameters go; the page it was written on stays, carried by the address from here on.
  const { agentId: _agent, sessionId: _session, prompt: _prompt, ...query } = route.query;
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
  // The conversation this tab already holds with the agent goes on; a new tab, or another agent, starts a new one.
  // Coming from a page, this runs on the way in, before the column has read the agent's conversations: the held one is
  // looked up in the host's list rather than in a list that is still empty, or every page message would start anew.
  const held = readRememberedSession(id);
  if (held && !nav.sessions.value.some((row) => row.id === held)) await nav.loadSessions();
  const continuing = held !== null && nav.sessions.value.some((row) => row.id === held);
  if (continuing) nav.selectSession(held);
  else nav.startNew();
  if (page) void router.replace({ query: { ...query, page } });
  if (prompt) {
    await nextTick();
    await shell.value!.send(prompt);
  }
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
    :page-context="pageContext"
    :page-links="pageLinks"
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
    @open-page="openPageAtItsAddress"
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
      <AgentModelsPage v-if="page === AGENT_SETTINGS_PAGE_ID && modelsOpen" :source="modelSource" :path="modelsPage.path" />
      <AgentSettingsPage
        v-else-if="page === AGENT_SETTINGS_PAGE_ID"
        :agent-id="settingsAgentId"
        :creating="creatingAgent"
        @changed="shell?.reloadAgents()"
      />
      <component
        :is="pilotPage!.component"
        v-else-if="inPilotPage && page === pilotFeatureId && pilotPage"
        :key="pageAddress!"
        v-bind="pilotPage.props"
        :navigate="(next: Record<string, string | undefined>) => setPageAddress(pilotPage!.navigate?.(next) ?? pageAddress!)"
      />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #dataset-selection-actions="{ artifact, title, selectedRowIndices }">
      <DatasetDrilldown :artifact="artifact" :title="title" :selected-row-indices="selectedRowIndices" />
    </template>
    <template #artifact-actions="{ artifact, title }">
      <!-- A file added to a board opens the dashboards application, which is where boards live: a dataset is planned
           into cards there, a chart file is put on the board as it is. -->
      <DatasetActions :artifact="artifact" :title="title" @open-dashboard="openDashboardApplication" />
      <ChartFileActions :artifact="artifact" :title="title" @open-dashboard="openDashboardApplication" />
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
