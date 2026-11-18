<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  AgentShell, useAgentNav, useSessionRunFeed,
  type PageContext, type ShellFeatureDeclaration, type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import { usePageAccess, usePilotPage } from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { getWorkbenchAppearance } from "../api";
import { createAssistantClient, createAssistantFeedback, createPanelOperationSettings } from "../assistant-host";
import { readRememberedAgent, readRememberedSession, rememberAgent, rememberSession } from "../remembered-agent";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { dashboardSelectionFrom } from "../../dashboard";
import DatasetActions from "./DatasetActions.vue";
import ChartFileActions from "./ChartFileActions.vue";
import DatasetDrilldown from "./DatasetDrilldown.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import {
  AGENT_SETTINGS_PAGE_ID,
  DASHBOARDS_PAGE_ID,
  GOVERNANCE_REPORT_PAGE_ID,
  PANEL_APPLICATION_PAGE_ID,
  governanceReportPageFeature,
  panelApplicationPageFeature,
  workbenchFeatures,
} from "../features";
import ClarificationRenderer from "./ClarificationRenderer.vue";
const artifactRenderers = [
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
const panelOperations = createPanelOperationSettings();
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
 * The application's own pages, by the name the shell shows for them. The dashboards, the scheduled tasks and the agents'
 * settings are pages of their own, so nothing here leaves this application.
 */
const featureRoutes = {} as Record<string, never>;
/**
 * The page beside the conversation is carried by this application's own address (`?page=<the page's address>`), so the
 * conversation stays where it is and the page is mounted from the assembly's registry, with the props its address gives
 * it and the way back for its own navigation.
 */
/**
 * The pages this application carries beside its conversation, from the platform's assembly: the assembly hands over a
 * resolver whose callback is this application's own address (`?page=`), so a page's own navigation never leaves it.
 */
const pilot = usePilotPage()(setPageAddress);
/** The page's address the conversation carries: one query value, so the page's own query (`?draft...`) travels with it. */
const pageAddress = computed(() => (typeof route.query.page === "string" ? route.query.page : null));
const pilotPage = computed(() => (pageAddress.value ? pilot(pageAddress.value) : null));
const inDashboards = computed(() => pilotPage.value?.id === DASHBOARDS_PAGE_ID);
const inGovernanceReport = computed(() => pilotPage.value?.id === GOVERNANCE_REPORT_PAGE_ID);
const inPanelApplication = computed(() => pilotPage.value?.id === PANEL_APPLICATION_PAGE_ID);
/**
 * The page's instance beside the conversation: its address, unless the page names less than that (a panel, whose own
 * selection is written into its address and does not make it another panel).
 */
const pageInstance = computed(() => pilotPage.value?.instance ?? pageAddress.value);
/**
 * What a page that reports it itself says the reader looks at — a panel, whose instance knows its selection. It belongs
 * to that instance: another page, or the same page opened anew, starts without one until it reports.
 */
const reportedContext = shallowRef<PageContext | null>(null);
watch(pageInstance, () => (reportedContext.value = null));
/**
 * The page the shell shows: the settings are the `agents` page, whose addresses are the settings' own screens, the
 * dashboards the `dashboards` page its own address opens, and every other page names its route. Closing the page (a new
 * conversation) returns to the conversation.
 */
const featureId = computed<string | null>({
  get: () => pilotPage.value?.id ?? null,
  set: (id) => {
    // Closing the page beside the conversation only drops the parameter: the conversation stays.
    if (id !== null) return;
    if (pageAddress.value === null) return;
    const { page: _page, ...query } = route.query;
    void router.replace({ query });
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
watch(
  () => route.query.sessionId,
  (id) => {
    if (typeof id === "string" && id !== conversationId.value) conversationId.value = id;
  },
);
const shell = ref<InstanceType<typeof AgentShell> | null>(null);

/**
 * An answer may link a page of the platform (`/governance/reports/<id>`, `/ontology/knowledge?...`); the shell asks here
 * rather than importing another application's routes.
 *
 * The pages this assembly mounts beside a conversation open there, and the application's own address does not change. Any
 * other page of the platform that the router can resolve opens at its real address, its query kept as it was written, so
 * a draft handoff's parameters travel with it; an address the router does not resolve is no page and stays text. A host
 * outside the platform (another scheme, another host) is never one of these.
 */
function pageLinks(href: string): (() => void) | null {
  const address = href.replace(/^#/, "");
  if (!address.startsWith("/") || address.startsWith("//")) return null;
  const pilotPage = pilot(address);
  if (pilotPage) return () => void router.push({ query: { ...route.query, page: address } });
  const resolved = router.resolve(address);
  // The address is a page when the route it lands on is one: the deepest record it matches. Every page of the platform sits
  // under the layout, whose own record redirects to the start page, and the catch-all answers any address the same way,
  // so it is that last record — not the layout above it — that says whether there is a page here.
  const leaf = resolved.matched.at(-1);
  if (!leaf || leaf.redirect) return null;
  return () => void router.push({ path: resolved.path, query: resolved.query, hash: resolved.hash });
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
    inPanelApplication.value ? panelApplicationPageFeature(reportedContext.value?.label ?? "", pageAddress.value!) : null,
  ),
}));

const labels = useShellLabels();

/**
 * The page beside the conversation names itself for a message sent from its composer. A governance report carries its
 * selected finding; what is selected in a dashboard is the dashboard's own to report.
 */
const pageContext = computed<PageContext | null>(() => {
  if (!pilotPage.value) return null;
  if (inGovernanceReport.value) {
    const issue = new URLSearchParams(pageAddress.value!.split("?")[1] ?? "").get("issue");
    return {
      pageKey: "governance-report",
      url: pageAddress.value!,
      label: t("assistant.featureGovernanceReport"),
      selection: issue ? [{ kind: "issue", id: issue, label: `${t("assistant.governanceFinding")} ${issue}` }] : [],
    };
  }
  // A panel says what the reader looks at itself: the use relation's page key, its address with the selection, and the
  // selected objects.
  if (inPanelApplication.value) return reportedContext.value;
  if (inDashboards.value) {
    // The selection is the page's address: the board, and the card the address names with its own name and id.
    const address = Object.fromEntries(new URLSearchParams(pageAddress.value!.split("?")[1] ?? ""));
    return { pageKey: "dashboard", url: pageAddress.value!, label: t("assistant.featureDashboards"), selection: dashboardSelectionFrom(address) };
  }
  return pilotPage.value.id === AGENT_SETTINGS_PAGE_ID
    ? { pageKey: "agent-settings", url: pageAddress.value!, label: t("agents.title"), selection: [] }
    : null;
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

/**
 * The settings the account may open: the agents' (with the agents' permission), and the models of the ontology service
 * agents the conversations run on (with the model permission). Each is a page of the platform's navigation.
 */
const canOpen = usePageAccess();
const editsAgents = computed(() => canOpen(routes.ontologyAgents.path));
const opensModels = computed(() => canOpen(routes.agentModels.path));

/**
 * The agent settings are one page of the platform's own navigation: this entry opens it at the agent in use. An account
 * without the agents' permission goes to the models the conversations run on, which is the platform's own settings page.
 */
function openSettings() {
  if (!editsAgents.value) return void router.push(routes.systemAgentModels.path);
  void router.push(
    agentId.value
      ? { name: routes.ontologyAgent.name, params: { agentId: agentId.value } }
      : { name: routes.ontologyAgents.name },
  );
}

/**
 * The page beside the conversation, enlarged: its own address, in the application that owns it. The conversation stays
 * the one this tab holds, so leaving the page returns to it.
 */
function openPageAtItsAddress(_id: string, address: string) {
  if (address) void router.push(address);
}


/** The column's own entry at the foot: the agent settings, which replace the column while they are open. */
const bottomEntry = computed(() =>
  editsAgents.value || opensModels.value ? { label: t("assistant.featureAgents"), icon: "agents" } : null,
);

/**
 * The link's own parameters, consumed once. A page's composer navigates here with `?agentId=&prompt=&page=`, and this
 * entry can run more than once on the way in — the mount, the address settling as it leaves the link's parameters, the
 * column's own reads returning — so the address they arrived on is taken once, before the first await: an entry that finds
 * the same address again has nothing to do rather than sending the same question a second time.
 *
 * `pendingLink` is set before the first await and is what tells a re-entry apart from a new message: the reader writing
 * in the same page again arrives with the same address, and that is a message, sent after the first one has been placed.
 */
let consumedLink: string | null = null;
let pendingLink: string | null = null;
const linkAddress = () =>
  JSON.stringify([requestedAgent(), queryText(route.query.sessionId), queryText(route.query.prompt), queryText(route.query.page)]);

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
  const address = linkAddress();
  if (pendingLink === address || consumedLink === address) return;
  pendingLink = address;
  const session = queryText(route.query.sessionId);
  const prompt = queryText(route.query.prompt);
  const page = queryText(route.query.page);
  // The link's own parameters go before anything is awaited; the page it was written on stays, carried by the address.
  const { agentId: _agent, sessionId: _session, prompt: _prompt, ...query } = route.query;
  await router.replace({ query: page ? { ...query, page } : query });
  if (!nav.agents.value.some((agent) => agent.id === id && agent.enabled)) {
    ElMessage.error(t("assistant.agentUnavailable"));
    return;
  }
  agentId.value = id;
  // Switching agents starts a new conversation in the navigation; what the link names comes after that.
  await nextTick();
  if (session) {
    nav.selectSession(session);
  } else {
    // The conversation this tab already holds with the agent goes on; a new tab, or another agent, starts a new one.
    // Coming from a page, this runs on the way in, before the column has read the agent's conversations: the held one is
    // looked up in the host's list rather than in a list that is still empty, or every page message would start anew.
    const held = readRememberedSession(id);
    if (held && !nav.sessions.value.some((row) => row.id === held)) await nav.loadSessions();
    const continuing = held !== null && nav.sessions.value.some((row) => row.id === held);
    if (continuing) nav.selectSession(held);
    else nav.startNew();
  }
  // Choosing a conversation closes whatever page was open beside the old one; the page this message came from stays open
  // beside the conversation it was written for.
  if (page) await router.replace({ query: { ...route.query, page } });
  if (prompt) {
    await nextTick();
    await shell.value!.send(prompt);
  }
  // Placed: the address is spent, and the same one arriving again is the reader's next message.
  pendingLink = null;
  consumedLink = address;
}
// The same address entered while the page is open (another link to an agent) does the same.
watch(
  () => route.query.agentId,
  (id) => {
    // The address no longer names an agent: the next one that does is a new message, even from the same page.
    if (!id) consumedLink = null;
    void openRequestedAgent();
  },
);

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
    agent-picker
    :bottom="bottomEntry"
    :client="client"
    :labels="labels"
    :nav="nav"
    :feedback="feedback"
    :panel-operations="panelOperations"
    :artifact-renderers="artifactRenderers"
    @error="ElMessage.error($event)"
    @feature-action="emit('featureAction', $event)"
    @open-bottom="openSettings"
    @open-page="openPageAtItsAddress"
  >
    <template #feature="{ featureId: page }">
      <component
        :is="pilotPage!.component"
        v-if="pilotPage"
        :key="pageInstance!"
        v-bind="pilotPage.props"
        @context="reportedContext = $event"
      />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #dataset-selection-actions="{ artifact, title, selectedRowIndices }">
      <DatasetDrilldown :artifact="artifact" :title="title" :selected-row-indices="selectedRowIndices" />
    </template>
    <template #artifact-actions="{ artifact, title, caption }">
      <!-- A file added to a board opens the dashboards application, which is where boards live: a dataset is planned
           into cards there, a chart file is put on the board as it is. -->
      <DatasetActions :artifact="artifact" :title="title" @open-dashboard="openDashboardApplication" />
      <ChartFileActions :artifact="artifact" :title="title" :caption="caption" @open-dashboard="openDashboardApplication" />
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
