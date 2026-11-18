<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import {
  AgentShell, useAgentNav, useConversationDisplay, useSessionRunFeed,
  type DisplayHistory, type DisplayPage, type DisplayView, type PageContext, type PageSelection,
  type ShellFeatureDeclaration, type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import { useLeaveConfirmation, usePageAccess, usePilotPage } from "@ontomato/platform-shell";
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
 * What sits beside the conversation is this application's display (`useConversationDisplay`): the one controller its
 * pages are mounted from. The address is its input and the reader's navigation is its serialised result, in this
 * application's own form — `?page=<the page's address>` beside the conversation, so the conversation stays where it is,
 * and the settings' own address (`/agents/settings`, `/new`, `/:id`) when they are shown full here.
 *
 * The pages it opens are the platform assembly's: the resolver mounts each from its own address, and a page's own move
 * (another board, another agent, a finding) goes to the display as the reader's navigation.
 */
const pilot = usePilotPage()((address) => void display.navigate(address, { history: "replace" }));
/**
 * The agents' settings at this application's own address: the settings page shown full in this shell, beside its column,
 * with the composer at its foot, as any of its pages is when enlarged. A reload or a link reopens it here.
 */
const atSettings = computed(() =>
  [routes.agents, routes.agentSettingsNew, routes.agentSettings].some((page) => page.name === route.name),
);

/** An in-app address that names a page this assembly mounts beside a conversation; a host elsewhere is never one. */
function resolvePage(href: string): DisplayPage | null {
  const address = href.replace(/^#/, "");
  if (!address.startsWith("/") || address.startsWith("//")) return null;
  const page = pilot(address);
  return page ? { featureId: page.id, address, instance: page.instance ?? address } : null;
}

/**
 * Where the reader's navigation is written. Enlarged, a page opens at its own address: the settings in this application,
 * any other page in the application that owns it. Otherwise the page rides as `?page=`, and from the settings' own address
 * that is back in the conversation. A move within the same route replaces the address unless it is a link's.
 */
async function serialize(page: DisplayPage | null, view: DisplayView, history: DisplayHistory): Promise<boolean> {
  const { page: _page, ...rest } = route.query;
  const to: RouteLocationRaw =
    page && view === "full" && (atSettings.value || display.view.value === "side")
      ? page.address
      : atSettings.value
        ? { name: routes.chat.name, query: page ? { page: page.address } : {} }
        : { query: page ? { ...route.query, page: page.address } : rest };
  const target = router.resolve(to);
  if (target.fullPath === route.fullPath) return true;
  const failure = await (history === "push" || target.path !== route.path ? router.push(to) : router.replace(to));
  return !failure;
}

/** Leaving a native page's draft asks first, by the platform's own question; a panel answers for itself. */
const leave = useLeaveConfirmation();
const display = useConversationDisplay({
  features: () => workbench.value.features,
  resolve: resolvePage,
  serialize,
  // The shell's name and address for the page from the moment it opens; what is selected is the page's report.
  context: (page, reported) => ({ url: page.address, label: pageLabel(page.featureId, reported), selection: selectionIn(page, reported) }),
  leave: { leaves: (address) => leave.leaves(address?.split("?")[0] ?? ""), confirm: () => leave.confirm() },
});
// The address bar is the display's input: the settings' own address shows them full, `?page=` carries a page beside.
watch(
  () => route.fullPath,
  () => display.follow(atSettings.value ? route.fullPath : queryText(route.query.page), atSettings.value ? "full" : undefined),
  { immediate: true },
);
/** The page the display shows, mounted from its address by the assembly's registry. */
const pilotPage = computed(() => (display.page.value ? pilot(display.page.value.address) : null));
const pageAddress = computed(() => display.page.value?.address ?? null);
const inDashboards = computed(() => display.page.value?.featureId === DASHBOARDS_PAGE_ID);
const inAgentSettings = computed(() => display.page.value?.featureId === AGENT_SETTINGS_PAGE_ID);
const inGovernanceReport = computed(() => display.page.value?.featureId === GOVERNANCE_REPORT_PAGE_ID);
const inPanelApplication = computed(() => display.page.value?.featureId === PANEL_APPLICATION_PAGE_ID);

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
 * rather than importing another application's routes. The pages the display opens beside the conversation never reach
 * here.
 *
 * Any other page of the platform that the router can resolve opens at its real address, its query kept as it was
 * written, so a draft handoff's parameters travel with it; an address the router does not resolve is no page and stays
 * text. A host outside the platform (another scheme, another host) is never one of these.
 */
function pageLinks(href: string): (() => void) | null {
  const address = href.replace(/^#/, "");
  if (!address.startsWith("/") || address.startsWith("//")) return null;
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

/**
 * What the reader calls a page this application opens beside the conversation. A panel application names its page in the
 * platform's catalog, which its page reports as it opens; before that the page has no name here, and the line names the
 * address.
 */
function pageLabel(id: string, reported: PageContext | null): string {
  if (id === DASHBOARDS_PAGE_ID) return t("assistant.featureDashboards");
  if (id === GOVERNANCE_REPORT_PAGE_ID) return t("assistant.featureGovernanceReport");
  if (id === AGENT_SETTINGS_PAGE_ID) return t("agents.title");
  return reported?.label ?? "";
}

/**
 * What the reader has selected in the page. The report page carries the finding its address names; a dashboard's address
 * names the board and the card; a panel reports its own selection once it has one.
 */
function selectionIn(page: DisplayPage, reported: PageContext | null): readonly PageSelection[] {
  const query = new URLSearchParams(page.address.split("?")[1] ?? "");
  if (page.featureId === GOVERNANCE_REPORT_PAGE_ID) {
    const issue = query.get("issue");
    return issue ? [{ kind: "issue", id: issue, label: `${t("assistant.governanceFinding")} ${issue}` }] : [];
  }
  if (page.featureId === DASHBOARDS_PAGE_ID) return dashboardSelectionFrom(Object.fromEntries(query));
  if (page.featureId === PANEL_APPLICATION_PAGE_ID) return reported?.selection ?? [];
  return [];
}

const labels = useShellLabels();

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand?.name || props.defaultBrandName,
  features: workbenchFeatures(
    props.features,
    { agents: t("assistant.featureAgents"), dashboards: t("assistant.featureDashboards") },
    {
      agents: inAgentSettings.value ? pageAddress.value! : routes.agents.path,
      dashboards: inDashboards.value ? pageAddress.value! : routes.dashboards.path,
    },
    inGovernanceReport.value
      ? governanceReportPageFeature(t("assistant.featureGovernanceReport"), pageAddress.value!)
      : null,
    inPanelApplication.value
      ? panelApplicationPageFeature(display.pageContext.value?.label || pageAddress.value!, pageAddress.value!)
      : null,
  ),
}));


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
  onLeaveConversation: () => void display.close(),
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
const editsAgents = computed(() => canOpen(routes.agents.path));
const opensModels = computed(() => canOpen(routes.agentModels.path));

/**
 * The agent settings, at this application's own address: this entry opens them at the agent in use, and the reader stays
 * in the application. An account without the agents' permission goes to the models the conversations run on, which is
 * the platform's own settings page.
 */
function openSettings() {
  if (!editsAgents.value) return void router.push(routes.systemAgentModels.path);
  void router.push(
    agentId.value
      ? { name: routes.agentSettings.name, params: { agentId: agentId.value } }
      : { name: routes.agents.name },
  );
}

/** The column's own entry at the foot: the agent settings, shown full beside the column. */
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
  // Choosing a conversation closes whatever page was open beside the old one; the page this message came from opens
  // beside the conversation it was written for.
  if (page) await display.navigate(page, { view: "side", history: "replace" });
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
    v-model:session-id="conversationId"
    :display="display"
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
  >
    <template #feature="{ featureId: page }">
      <!-- What the page hands its display: what the reader looks at, its address moves, what its loader knows, and
           whether leaving it now would drop unsaved changes. -->
      <component
        :is="pilotPage.component"
        v-if="pilotPage"
        :key="display.page.value!.instance"
        v-bind="pilotPage.props"
        @context="display.context"
        @display-address="display.address"
        @display-loaded="display.loaded"
        @display-dirty="display.dirty"
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
