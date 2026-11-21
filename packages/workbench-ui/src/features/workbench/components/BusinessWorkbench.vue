<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import {
  AgentShell, useAgentNav, useConversationDisplay, useSessionRunFeed,
  type DisplayHistory, type DisplayPage, type DisplayView, type PageContext, type PageSelection,
  type ShellBottomEntry, type ShellFeatureDeclaration, type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import { providePageActions, useLeaveConfirmation, usePageAccess, usePilotPage } from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { AGENT_DEFINITION } from "@ontomato/contracts/platform-object-types";
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
import PageCommands from "./PageCommands.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import {
  DASHBOARDS_PAGE_ID,
  PANEL_APPLICATION_PAGE_ID,
  panelApplicationPageFeature,
  workbenchFeatures,
} from "../features";
import ClarificationRenderer from "./ClarificationRenderer.vue";
const artifactRenderers = [
  { path: /\.clarification\.json$/i, component: ClarificationRenderer },
];

/**
 * The agent platform's conversation and the pages it opens beside a conversation. Both editions mount it; each
 * edition may supply entries and render their pages through the `feature` slot.
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
 * The commands of the page shown beside the conversation (or full in it): the page hands them over as it would to the
 * platform's header, and they are drawn where the conversation draws the page's title. Provided here, they stay with
 * this page and never reach the header of the conversation's own page.
 */
const pageActions = providePageActions();
/** An in-app address that names a page this assembly mounts beside a conversation; a host elsewhere is never one. */
function resolvePage(href: string): DisplayPage | null {
  const address = href.replace(/^#/, "");
  if (!address.startsWith("/") || address.startsWith("//")) return null;
  const page = pilot(address);
  return page ? { featureId: page.id, address, instance: page.instance ?? address } : null;
}

/**
 * Enlarging a page opens its own address. A page beside the conversation rides as `?page=`; a move within the same
 * route replaces the address unless it follows a link.
 */
async function serialize(page: DisplayPage | null, view: DisplayView, history: DisplayHistory): Promise<boolean> {
  const { page: _page, ...rest } = route.query;
  const to: RouteLocationRaw =
    page && view === "full" && display.view.value === "side"
      ? page.address
      : { query: page ? { ...route.query, page: page.address } : rest };
  const failure = await (history === "push" || router.resolve(to).path !== route.path ? router.push(to) : router.replace(to));
  // The address already saying this is the router's duplicated navigation, however the link that wrote it encoded it.
  return !failure || isNavigationFailure(failure, NavigationFailureType.duplicated);
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
// A native entry becomes resolvable beside the conversation when the reader's application catalog arrives.
watch(
  () => {
    const address = queryText(route.query.page);
    return address && pilot(address) ? address : null;
  },
  (address) => display.follow(address),
  { immediate: true },
);
/** The page the display shows, mounted from its address by the assembly's registry. */
const pilotPage = computed(() => (display.page.value ? pilot(display.page.value.address) : null));
const pageAddress = computed(() => display.page.value?.address ?? null);
const inDashboards = computed(() => display.page.value?.featureId === DASHBOARDS_PAGE_ID);
const inAgentSettings = computed(() => pageAddress.value?.split("?")[0] === routes.agents.path);
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
 * An answer may link a page of the platform (`/ontology/knowledge?...`); the shell asks here rather than importing
 * another application's routes. The pages the display opens beside the conversation never reach here.
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
  return reported?.label ?? "";
}

/**
 * What the reader has selected in the page. A dashboard's address names the board and the card; a panel reports its
 * own selection once it has one.
 */
function selectionIn(page: DisplayPage, reported: PageContext | null): readonly PageSelection[] {
  const query = new URLSearchParams(page.address.split("?")[1] ?? "");
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
    {
      label: t("assistant.featureDashboards"),
      address: inDashboards.value ? pageAddress.value! : routes.dashboards.path,
    },
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
  // Choosing a conversation closes the page open beside the one left, except the page a link is placing a message from:
  // that page is the message's, and drawing it again would only read it again.
  onLeaveConversation: () => {
    if (placingFrom === null || display.page.value?.address.split("?")[0] !== placingFrom) void display.close();
  },
});
// The one list notice stream of this page: every conversation it lists follows its run, whichever one is open.
useSessionRunFeed({
  port: client.sessionRuns,
  sessions: () => nav.sessions.value,
  // The conversation's display takes what its runs present; the stream asks for the binding that lets them.
  presentation: true,
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
  void router.push(agentId.value
    ? panelAddress(routes.agents.path, { selected: { className: AGENT_DEFINITION, primaryKey: agentId.value }, mode: "edit" })
    : routes.agents.path);
}

/**
 * The column's own entry at the foot: the agent settings, shown in this application and its current row while they are;
 * for an account that only opens the models, their page in the platform's settings.
 */
const bottomEntry = computed<ShellBottomEntry | null>(() =>
  editsAgents.value
    ? { label: t("assistant.featureAgents"), icon: "agents", page: inAgentSettings.value ? PANEL_APPLICATION_PAGE_ID : undefined }
    : opensModels.value
      ? { label: t("assistant.featureAgents"), icon: "agents" }
      : null,
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
/** The page a link's message comes from while the link chooses its conversation; that page stays open. */
let placingFrom: string | null = null;
/**
 * The link's message could not be sent here: it waits in the composer for the reader, who has been told why. The same
 * address arriving again is the reader trying again.
 */
function giveBack(prompt: string | null) {
  pendingLink = null;
  if (prompt) void nextTick(() => shell.value?.fill(prompt));
}
/**
 * The conversation knows the page beside it: the page has said which skill a message written beside it reaches (a
 * native page declares it; a panel reports it with its read, before it has loaded), and the agents offered on that page
 * have been read. Until then the agent list is the one before the page, or empty while the page's own is read.
 */
const knowsPage = () =>
  display.load.value.status !== "loading" && nav.agentsState.value === "ready"
  && (display.pageSkill.value === null || nav.pageAgents.value !== null);
/**
 * Waits for the conversation to know the page beside it. False when the agents could not be read: the read's own error
 * was shown where it failed, and there is nothing to check a link's agent against or to send it with.
 */
async function pageKnown(): Promise<boolean> {
  const settled = () => knowsPage() || nav.agentsState.value === "error";
  if (!settled()) {
    await new Promise<void>((resolve) => {
      const stop = watch(settled, (now) => {
        if (!now) return;
        stop();
        resolve();
      });
    });
  }
  return nav.agentsState.value !== "error";
}
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
  // The page the message was written on is beside the conversation from the start: the agent is one of those offered on
  // it, and the message carries its skill, once the conversation knows it. Its agents not read, the message ends here,
  // unsent; the same address arriving again is the reader trying again.
  if (page && !(await pageKnown())) return giveBack(prompt);
  if (!nav.agents.value.some((agent) => agent.id === id && agent.enabled)) {
    ElMessage.error(t("assistant.agentUnavailable"));
    return giveBack(prompt);
  }
  agentId.value = id;
  // Switching agents starts a new conversation in the navigation; what the link names comes after that.
  await nextTick();
  placingFrom = page?.split("?")[0] ?? null;
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
  placingFrom = null;
  // The page this message came from stays beside the conversation it was written for, or opens there when it was not
  // shown; opened anew, it says again which skill it reaches once drawn, and the message carries that.
  if (page) {
    await display.navigate(page, { view: "side", history: "replace" });
    await nextTick();
    if (!(await pageKnown())) return giveBack(prompt);
  }
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
    class="business-conversation-shell"
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
           whether leaving it now would drop unsaved changes. What the display hands the page: when to read its objects
           again. -->
      <component
        :is="pilotPage.component"
        v-if="pilotPage"
        :key="display.page.value!.instance"
        v-bind="pilotPage.props"
        :object-refresh="display.objectRefresh.value"
        @context="display.context"
        @display-address="display.address"
        @display-loaded="display.loaded"
        @display-dirty="display.dirty"
        @display-skill="display.skill"
      />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #page-actions="{ view }">
      <PageCommands v-if="pageActions?.actions?.length" :actions="pageActions.actions" :view="view" />
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
