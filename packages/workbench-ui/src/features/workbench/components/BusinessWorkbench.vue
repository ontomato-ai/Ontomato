<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import {
  AgentShell, useAgentNav, useConversationDisplay, useSessionRunFeed,
  type DisplayHistory, type DisplayPage, type DisplayPageController, type DisplayView, type PageContext, type PageSelection,
  type ShellBottomEntry, type ShellFeatureDeclaration, type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import { useLeaveConfirmation, usePageAccess, usePageAdmission, usePilotPage, useUnsavedChanges } from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import { panelAddress } from "@ontomato/contracts/panel-host";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { getWorkbenchAppearance } from "../api";
import { createAssistantClient, createAssistantFeedback, createPanelOperationSettings } from "../assistant-host";
import { readRememberedAgent, readRememberedSession, rememberAgent, rememberSession } from "../remembered-agent";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { dashboardSelectionFrom, useDashboardStore } from "../../dashboard";
import { formatRelativeTime } from "../../../utils/relative-time";
import { ChevronDown, ClipboardList, LayoutDashboard, ListTodo, MoreHorizontal, X } from "lucide-vue-next";
import { agentHostSessionPageSchema, type AgentHostSession } from "@ontomato/contracts/agent-host";
import { nodeApiGet } from "../../../utils/api";
import DatasetActions from "./DatasetActions.vue";
import ChartFileActions from "./ChartFileActions.vue";
import DatasetDrilldown from "./DatasetDrilldown.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import {
  DASHBOARDS_PAGE_ID,
  PANEL_APPLICATION_PAGE_ID,
  panelApplicationPageFeature,
  workbenchFeatures,
} from "../features";
import ClarificationRenderer from "./ClarificationRenderer.vue";
defineOptions({ inheritAttrs: false });
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
    splitNavigation?: boolean;
    internalPages?: { dashboard: string; schedules: string; agents: string };
  }>(),
  { features: () => [] },
);

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const client = createAssistantClient(undefined, { excludeGovernance: Boolean(props.internalPages) });
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
const resolvePilot = usePilotPage()((address) => {
  if (props.internalPages && address.split("?")[0] === routes.chat.path) {
    const query = new URLSearchParams(address.split("?")[1]);
    const sessionId = query.get("sessionId");
    if (sessionId) {
      const { page: _page, ...remaining } = route.query;
      void router.push({ query: { ...remaining, sessionId } });
    }
    return;
  }
  const target = props.internalPages && address.split("?")[0] === routes.dashboards.path
    ? props.internalPages.dashboard + address.slice(routes.dashboards.path.length)
    : address;
  void display.navigate(target, { history: "replace" });
});
function pilot(address: string) {
  if (!props.internalPages) return resolvePilot(address);
  const path = address.split("?")[0];
  if (path === props.internalPages.dashboard) {
    return resolvePilot(routes.dashboards.path + address.slice(path.length));
  }
  if (path === props.internalPages.schedules || path === props.internalPages.agents) return resolvePilot(address);
  return null;
}
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
    page && view === "full" && display.view.value === "side" && !props.internalPages
      ? page.address
      : { query: page ? { ...route.query, page: page.address } : rest };
  const failure = await (history === "push" || router.resolve(to).path !== route.path ? router.push(to) : router.replace(to));
  // The address already saying this is the router's duplicated navigation, however the link that wrote it encoded it.
  return !failure || isNavigationFailure(failure, NavigationFailureType.duplicated);
}

/** Leaving a native page's draft asks first, by the platform's own question; a panel answers for itself. */
const leave = useLeaveConfirmation();
const admitPage = usePageAdmission();
const display = useConversationDisplay({
  features: () => workbench.value.features,
  resolve: resolvePage,
  ...(admitPage ? { admit: admitPage } : {}),
  serialize,
  // The shell's name and address for the page from the moment it opens; selection, highlights, public state and open forms are the page's report.
  context: (page, reported) => ({
    url: page.address,
    label: pageLabel(page.featureId, reported),
    selection: selectionIn(page, reported),
    ...(reported?.highlights?.length ? { highlights: reported.highlights } : {}),
    ...(reported?.state && Object.keys(reported.state).length ? { state: reported.state } : {}),
    ...(reported?.forms?.length ? { forms: reported.forms } : {}),
  }),
  leave: { leaves: (address) => leave.leaves(address?.split("?")[0] ?? ""), confirm: () => leave.confirm() },
});
// Keep the platform unsaved-changes guard (route leaves and beforeunload) informed when a paired page reports dirty.
useUnsavedChanges({
  dirty: () => display.isDirty.value,
  paths: () => [route.path],
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
const editorTitle = computed(() => {
  const address = pageAddress.value;
  if (!props.internalPages || !address) return undefined;
  const [path, query] = address.split("?");
  if (path !== props.internalPages.agents) return undefined;
  const creating = new URLSearchParams(query).get("mode") === "create";
  if (locale.value === "zh-CN") return creating ? "新建智能体" : "编辑智能体";
  if (locale.value === "zh-TW") return creating ? "新增智慧代理" : "編輯智慧代理";
  return creating ? t("admin.newAgent", "New agent") : t("analysis.editAgent", "Edit agent");
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

/**
 * An answer may link a page of the platform (`/ontology/knowledge?...`); the shell asks here rather than importing
 * another application's routes. The pages the display opens beside the conversation never reach here.
 *
 * Any other page of the platform that the router can resolve opens at its real address, its query kept as it was
 * written; an address the router does not resolve is no page and stays text. A host outside the platform (another
 * scheme, another host) is never one of these.
 */
function pageLinks(href: string): (() => void) | null {
  const address = href.replace(/^#/, "");
  if (props.internalPages) {
    return pilot(address) ? () => { void display.navigate(address, { history: "push" }); } : null;
  }
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

const shellLabels = useShellLabels();
const labels = computed(() => {
  const base = shellLabels.value;
  if (!props.splitNavigation) return base;
  if (locale.value === "zh-CN") return { ...base, newConversation: "新建会话", sessions: "历史会话", send: "查询" };
  if (locale.value === "zh-TW") return { ...base, newConversation: "新增會話", sessions: "歷史會話", send: "查詢" };
  return base;
});
const dashboards = useDashboardStore();
const dashboardsOpen = ref(false);
const dashboardMenu = ref<string | null>(null);

function closeDashboards() {
  dashboardsOpen.value = false;
  dashboardMenu.value = null;
  dashboards.cancelDashboardRename();
}

function toggleDashboards() {
  if (dashboardsOpen.value) return closeDashboards();
  dashboardsOpen.value = true;
  void dashboards.loadDashboards({ notifyError: true });
}

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand?.name || props.defaultBrandName,
  features: workbenchFeatures(
    props.features,
    {
      label: t("assistant.featureDashboards"),
      address: inDashboards.value ? pageAddress.value! : (props.internalPages?.dashboard ?? routes.dashboards.path),
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
const opensModels = computed(() => canOpen(routes.usage.path));

/**
 * The agent settings, at this application's own address: this entry opens them at the agent in use, and the reader stays
 * in the application. An account without the agents' permission goes to the models the conversations run on, which is
 * the platform's own settings page.
 */
function openInternalAgentEditor(mode: "create" | "edit") {
  if (!props.internalPages || !editsAgents.value) return;
  const state = mode === "edit" && agentId.value ? { mode, selected: agentId.value } : { mode };
  closeDashboards();
  void display.navigate(panelAddress(props.internalPages.agents, state), { history: "push" });
}

const agentActions = computed(() => props.internalPages && editsAgents.value ? {
  createLabel: locale.value === "zh-CN" ? "添加智能体" : locale.value === "zh-TW" ? "新增智慧代理" : (t("analysis.addAgent") === "analysis.addAgent" ? "Add Agent" : t("analysis.addAgent")),
  editLabel: locale.value === "zh-CN" ? "编辑智能体" : t("analysis.editAgent"),
  create: () => openInternalAgentEditor("create"),
  edit: () => openInternalAgentEditor("edit"),
} : undefined);

function openSettings() {
  if (!editsAgents.value) return void router.push(routes.systemAgentModels.path);
  void router.push(agentId.value
    ? panelAddress(routes.agents.path, { selected: agentId.value, mode: "edit" })
    : routes.agents.path);
}

const showingTasks = ref(false);
const taskSessions = ref<AgentHostSession[]>([]);
const taskCursor = ref<string | null>(null);
const tasksLoading = ref(false);
const tasksError = ref(false);
let taskRequest = 0;
const allTasksLabel = computed(() => locale.value === "zh-CN" ? "全部任务" : locale.value === "zh-TW" ? "全部任務" : "All tasks");
const taskGroups = computed(() => {
  const groups = {
    running: { key: "running", label: locale.value === "zh-CN" ? "执行中" : t("assistant.taskRunning"), sessions: [] as AgentHostSession[] },
    stopped: { key: "stopped", label: t("assistant.taskCompleted"), sessions: [] as AgentHostSession[] },
    pending: { key: "pending", label: locale.value === "zh-CN" ? "待运行" : locale.value === "zh-TW" ? "待執行" : "Not started", sessions: [] as AgentHostSession[] },
  };
  for (const session of taskSessions.value) {
    const run = session.latestRun;
    const group = !run ? groups.pending : run.status === "running" || run.delegatedRunning ? groups.running : groups.stopped;
    group.sessions.push(session);
  }
  return Object.values(groups).filter(group => group.sessions.length);
});

function analysisTaskStatus(session: AgentHostSession) {
  const run = session.latestRun;
  if (!run) return null;
  if (run.status === "running" || run.delegatedRunning) return "running";
  if (run.stopReason === "aborted") return "cancelled";
  if (run.stopReason === "error" || run.stopReason === "length") return "failed";
  return "completed";
}

const taskStatusLabels = computed(() => ({
  running: t("assistant.taskRunning"), completed: t("assistant.taskCompleted"),
  failed: t("assistant.taskFailed"), cancelled: t("assistant.taskCancelled"),
}));

async function loadAnalysisTasks(append = false) {
  const request = ++taskRequest;
  tasksLoading.value = true;
  tasksError.value = false;
  try {
    const cursor = append ? taskCursor.value : null;
    const path = `/assistant/analysis-sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = agentHostSessionPageSchema.parse(await nodeApiGet(path));
    if (request !== taskRequest) return;
    taskSessions.value = append ? [...taskSessions.value, ...page.sessions] : page.sessions;
    taskCursor.value = page.nextCursor;
  } catch {
    if (request === taskRequest) tasksError.value = true;
  } finally {
    if (request === taskRequest) tasksLoading.value = false;
  }
}

async function openAllTasks() {
  if (!(await display.close())) return;
  closeDashboards();
  nav.startNew();
  showingTasks.value = true;
  void loadAnalysisTasks();
}

function openAnalysisTask(session: AgentHostSession) {
  nav.adoptAgent(session.agentId);
  nav.selectSession(session.id);
}

/**
 * The column's own entry at the foot: the agent settings, shown in this application and its current row while they are;
 * for an account that only opens the models, their page in the platform's settings.
 */
const bottomEntry = computed<ShellBottomEntry | null>(() =>
  props.internalPages ? null : editsAgents.value
    ? { label: t("assistant.featureAgents"), icon: "agents", page: inAgentSettings.value ? PANEL_APPLICATION_PAGE_ID : undefined }
    : !props.internalPages && opensModels.value
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
  closeDashboards();
  if (props.internalPages) {
    void display.navigate(panelAddress(props.internalPages.dashboard, { dashboardId }), { history: "push" });
    return;
  }
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
    v-bind="$attrs"
    class="business-conversation-shell"
    v-model:agent-id="agentId"
    v-model:session-id="conversationId"
    :display="display"
    :page-links="pageLinks"
    :workbench="workbench"
    :title="workbench.label"
    agent-picker
    :split-navigation="splitNavigation"
    :editor-title="editorTitle"
    :format-session-date="splitNavigation ? formatRelativeTime : undefined"
    :agent-actions="agentActions"
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
    @rail-agent-selected="showingTasks = false"
  >
    <template v-if="$slots.brand" #brand><slot name="brand" /></template>
    <template v-if="$slots.account" #account><slot name="account" /></template>
    <template v-if="internalPages" #shortcuts>
      <button class="legacy-footer-item" type="button" :title="allTasksLabel" :aria-pressed="showingTasks" @click="openAllTasks">
        <ListTodo :size="16" aria-hidden="true" /><span>{{ allTasksLabel }}</span>
        <small v-if="taskSessions.length" class="legacy-task-badge">{{ taskSessions.length }}{{ taskCursor ? '+' : '' }}</small>
      </button>
      <section v-if="dashboardsOpen" id="data-agent-dashboard-list" class="legacy-dashboard-list" :aria-label="t('analysis.myDashboards')" @keydown.esc.stop="closeDashboards">
        <header>
          <span>{{ t('analysis.myDashboards') }}</span>
          <button type="button" :aria-label="t('common.close')" @click="closeDashboards"><X :size="14" /></button>
        </header>
        <div class="legacy-dashboard-items" :aria-busy="dashboards.loadingDashboards">
          <p v-if="!dashboards.loadingDashboards && !dashboards.dashboardItems.length">{{ t('analysis.noDashboards') }}</p>
          <div v-for="board in dashboards.dashboardItems" :key="board.id" class="legacy-dashboard-item" :class="{ active: board.id === dashboards.currentDashboardId }">
            <input v-if="dashboards.editingDashboardId === board.id" v-model="dashboards.editingDashboardName" :aria-label="t('common.rename')" maxlength="50"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" @keydown.esc.stop="dashboards.cancelDashboardRename()" @blur="dashboards.saveDashboardRename(board)" />
            <template v-else>
              <button type="button" class="legacy-dashboard-open" @click="openDashboardApplication(board.id)">
                <strong>{{ board.name }}</strong><small v-if="board.updatedAt">{{ formatRelativeTime(board.updatedAt) }}</small>
              </button>
              <button type="button" :aria-label="t('common.more')" :aria-expanded="dashboardMenu === board.id" @click="dashboardMenu = dashboardMenu === board.id ? null : board.id"><MoreHorizontal :size="16" /></button>
              <div v-if="dashboardMenu === board.id" class="legacy-dashboard-actions">
                <button type="button" @click="dashboards.startDashboardRename(board); dashboardMenu = null">{{ t('common.rename') }}</button>
                <button type="button" @click="dashboards.deleteDashboard(board); dashboardMenu = null">{{ t('common.delete') }}</button>
              </div>
            </template>
          </div>
        </div>
        <button type="button" class="legacy-dashboard-create" @click="dashboards.promptCreateDashboard(openDashboardApplication)">+ {{ locale === 'zh-CN' ? '新建仪表盘' : t('analysis.createDashboard') }}</button>
      </section>
      <button class="legacy-footer-item" type="button" :title="t('assistant.featureDashboards')" :aria-expanded="dashboardsOpen" :aria-controls="dashboardsOpen ? 'data-agent-dashboard-list' : undefined" @click="toggleDashboards">
        <LayoutDashboard :size="16" aria-hidden="true" /><span>{{ t('assistant.featureDashboards') }}</span>
        <ChevronDown class="legacy-dashboard-arrow" :size="12" aria-hidden="true" />
      </button>
    </template>
    <template v-if="showingTasks" #session-list>
      <header class="session-heading legacy-task-heading">
        <div class="legacy-task-avatar"><ClipboardList :size="22" aria-hidden="true" /></div>
        <div><strong>{{ allTasksLabel }}</strong><p>{{ locale === 'zh-CN' ? '跨智能体统一任务看板' : locale === 'zh-TW' ? '跨智慧代理任務總覽' : 'Tasks across agents' }}</p></div>
      </header>
      <p v-if="tasksLoading && !taskSessions.length" class="session-note" role="status">{{ t('common.loading') }}</p>
      <p v-if="tasksError" class="session-note" role="alert">{{ labels.loadFailed }} <button type="button" @click="loadAnalysisTasks()">{{ labels.retry }}</button></p>
      <p v-else-if="!tasksLoading && !taskSessions.length" class="session-note">{{ labels.noSessions }}</p>
      <div v-if="taskSessions.length" class="session-list legacy-task-list">
        <section v-for="group in taskGroups" :key="group.key" class="legacy-task-group" :aria-label="group.label">
          <h2><span class="history-list-marker" :data-status="group.key" aria-hidden="true" />{{ group.label }} ({{ group.sessions.length }})</h2>
          <ul>
            <li v-for="session in group.sessions" :key="session.id" class="session-item" :class="{ active: session.id === conversationId }">
              <button type="button" class="session-open" :aria-current="session.id === conversationId ? 'page' : undefined" @click="openAnalysisTask(session)">
                <span class="session-title">{{ session.title || labels.newConversation }}</span>
                <span class="history-list-meta">
                  {{ formatRelativeTime(session.createdAt) }}
                  <template v-if="analysisTaskStatus(session)">
                    <span class="legacy-task-status" :data-status="analysisTaskStatus(session)">{{ taskStatusLabels[analysisTaskStatus(session)!] }}</span>
                  </template>
                </span>
              </button>
            </li>
          </ul>
        </section>
        <button v-if="taskCursor" type="button" class="more" :disabled="tasksLoading" @click="loadAnalysisTasks(true)">{{ labels.more }}</button>
      </div>
    </template>
    <template v-if="$slots.welcome" #welcome="scope">
      <slot name="welcome" v-bind="scope" />
    </template>
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
        :live-state="display.liveState.value"
        :register-page-controller="(controller: DisplayPageController) => display.registerPageController(display.page.value!.instance, controller)"
        @context="display.context"
        @display-address="display.address"
        @display-loaded="display.loaded"
        @display-dirty="display.dirty"
        @display-skill="display.skill"
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
      <TurnDiagnoseButton v-if="!internalPages && sessionId && runId" :session-id="sessionId" :run-id="runId" />
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
