<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElLoading, ElMessage } from "element-plus";
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
import { createSchedulesApi } from "@ontomato/platform-schedules";
import type { DisplayPageAddressInput } from "@ontomato/contracts/agent-presentation";
import { PLATFORM_SCHEDULE_TEXT_MAX, PLATFORM_SCHEDULE_TITLE_MAX, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { nodeApiRequest } from "../../../utils/api";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { getWorkbenchAppearance } from "../api";
import { createAssistantClient, createAssistantFeedback, createPanelOperationSettings } from "../assistant-host";
import { readRememberedAgent, readRememberedSession, rememberAgent, rememberSession } from "../remembered-agent";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import { useDashboardStore } from "../../dashboard";
import { formatRelativeTime } from "../../../utils/relative-time";
import { ArrowLeft, CalendarClock, ChevronDown, ClipboardList, LayoutDashboard, ListTodo, MoreHorizontal, Plus, X } from "lucide-vue-next";
import { agentHostSessionPageSchema, type AgentHostSession } from "@ontomato/contracts/agent-host";
import { nodeApiGet } from "../../../utils/api";
import DatasetActions from "./DatasetActions.vue";
import ChartFileActions from "./ChartFileActions.vue";
import ReportActions from "./ReportActions.vue";
import AgentScheduleRows from "./AgentScheduleRows.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import {
  PANEL_APPLICATION_PAGE_ID,
  panelApplicationPageFeature,
  workbenchFeatures,
} from "../features";
import ClarificationRenderer from "./ClarificationRenderer.vue";
defineOptions({ inheritAttrs: false });
const vLoading = ElLoading.directive;
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
    internalPages?: { dashboard: string; agents: string; schedules?: string };
  }>(),
  { features: () => [] },
);

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";

const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const client = createAssistantClient(undefined, {
  excludeGovernance: Boolean(props.internalPages),
});
const feedback = createAssistantFeedback();
const panelOperations = createPanelOperationSettings();
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
/**
 * `?agentId=` or `?agentKind=` names the agent a link from elsewhere asks for: alone it opens a new conversation with
 * it, with `&prompt=` that conversation starts with the text, with `&prefill=` the text is placed in the composer for
 * human review without auto-sending, and with `&sessionId=` it reopens that conversation. The page starts from its own
 * choice (the remembered agent, settled against the agent list as always) and the request replaces it once the list
 * shows the agent enabled; no conversation is opened before that.
 */
const queryText = (value: unknown) => (typeof value === "string" ? value : null);
const requestedAgent = () => queryText(route.query.agentId);
const requestedAgentKind = () => queryText(route.query.agentKind);
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
      void openPanelConversation(sessionId);
    } else if (query.has("agentId")) {
      void openPanelAgent(query.get("agentId")!);
    }
    return;
  }
  void display.navigate(internalPageAddress(address), { history: "push" });
});
function internalPageAddress(address: string) {
  const path = address.split("?")[0];
  const pages = props.internalPages;
  if (pages && path === routes.dashboards.path) return pages.dashboard + address.slice(path.length);
  if (pages?.schedules && path === routes.schedules.path) return pages.schedules + address.slice(path.length);
  return address;
}
function platformPanelAddress(address: string) {
  const path = address.split("?")[0];
  if (path === props.internalPages?.dashboard) return routes.dashboards.path + address.slice(path.length);
  if (path === props.internalPages?.agents) {
    const query = new URLSearchParams(address.slice(path.length));
    const mode = query.get("mode");
    query.delete("mode");
    if (mode === "create") query.set("creating", "true");
    return panelAddress(query.has("selected") ? `${routes.agents.path}/detail` : routes.agents.path,
      Object.fromEntries(query));
  }
  if (props.internalPages?.schedules && (path === props.internalPages.schedules || path === routes.schedules.path)) {
    const query = new URLSearchParams(address.slice(path.length));
    query.set("workspace", "agent");
    query.set("app", "agents");
    return routes.schedules.path + "?" + query;
  }
  return address;
}
function pilot(address: string) {
  if (!props.internalPages) return resolvePilot(address);
  const target = platformPanelAddress(address);
  const path = target.split("?")[0];
  if (path === routes.dashboards.path || (props.internalPages.schedules && path === routes.schedules.path)
    || path === routes.agents.path || path === `${routes.agents.path}/detail`) return resolvePilot(target);
  return null;
}
/** An in-app address that names a page this assembly mounts beside a conversation; a host elsewhere is never one. */
function resolvePage(href: string): DisplayPage | null {
  const address = href.replace(/^#/, "");
  if (!address.startsWith("/") || address.startsWith("//")) return null;
  const page = pilot(address);
  return page ? { featureId: page.id, address, instance: page.instance ?? address } : null;
}

let displayNavigation: string | null = null;

/**
 * Enlarging a page opens its own address. A page beside the conversation rides as `?page=`; a move within the same
 * route replaces the address unless it follows a link.
 */
async function serialize(page: DisplayPage | null, view: DisplayView, history: DisplayHistory): Promise<boolean> {
  const { page: _page, ...rest } = route.query;
  const address = page && internalPageAddress(page.address);
  if (address && props.internalPages?.dashboard === address.split("?")[0]) delete rest.taskView;
  const query = props.internalPages && !requestedAgent() && !requestedAgentKind()
    ? { ...rest, sessionId: conversationId.value ?? undefined }
    : rest;
  const to: RouteLocationRaw =
    page && view === "full" && display.view.value === "side" && !props.internalPages
      ? page.address
      : { query: address ? { ...query, page: address } : query, hash: route.hash };
  const destination = router.resolve(to);
  const target = destination.fullPath;
  displayNavigation = target;
  try {
    const failure = await (history === "push" || destination.path !== route.path ? router.push(to) : router.replace(to));
    return !failure || isNavigationFailure(failure, NavigationFailureType.duplicated);
  } finally {
    if (displayNavigation === target) displayNavigation = null;
  }
}

/** Leaving a native page's draft asks first, by the platform's own question; a panel answers for itself. */
const leave = useLeaveConfirmation();
const admitPage = usePageAdmission();
const display = useConversationDisplay({
  features: () => workbench.value.features,
  resolve: resolvePage,
  ...(admitPage ? { admit: (address: string) => admitPage(platformPanelAddress(address)) } : {}),
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
let activePageController: DisplayPageController | null = null;
function registerActivePageController(instance: string, controller: DisplayPageController) {
  activePageController = controller;
  const unregister = display.registerPageController(instance, controller);
  return () => {
    if (activePageController === controller) activePageController = null;
    unregister();
  };
}
// Keep the platform unsaved-changes guard (route leaves, same-path side-pane history Back, and beforeunload) informed.
useUnsavedChanges({
  dirty: () => display.isDirty.value,
  paths: () => [route.path],
  guardSamePath: (fullPath) => {
    // The display has already handled its own transition. Browser navigation still needs the route guard.
    if (fullPath === displayNavigation) return Promise.resolve(true);
    const nextPage = queryText(router.resolve(fullPath).query.page);
    const currentPage = queryText(route.query.page);
    if (nextPage === currentPage) return Promise.resolve(true);
    const nextBase = nextPage?.split("?", 1)[0] ?? null;
    const currentBase = currentPage?.split("?", 1)[0] ?? null;
    if (nextBase !== currentBase) return leave.confirm();
    return activePageController?.guardNavigation?.({ address: nextPage! }) ?? Promise.resolve(true);
  },
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
const inStandaloneDashboard = computed(() => Boolean(props.internalPages && pageAddress.value
  && platformPanelAddress(pageAddress.value).split("?")[0] === routes.dashboards.path));
const inStandaloneSchedules = computed(() => Boolean(props.internalPages?.schedules && pageAddress.value
  && platformPanelAddress(pageAddress.value).split("?")[0] === routes.schedules.path));
const scheduleQuery = computed(() => new URLSearchParams(pageAddress.value?.split("?")[1]));
const selectedSchedule = computed(() => inStandaloneSchedules.value ? scheduleQuery.value.get("selectedTask") : null);
const creatingSchedule = computed(() => inStandaloneSchedules.value && scheduleQuery.value.get("workspaceCompose") === "new");
const scheduleReturnPage = computed(() => {
  const address = queryText(route.query.scheduleFrom);
  return address && address.split("?")[0] === props.internalPages?.schedules ? address : null;
});

async function openPanelConversation(sessionId: string) {
  const { page: _page, scheduleFrom: _from, scheduleFromSession: _fromSession, ...query } = route.query;
  const from = inStandaloneSchedules.value ? queryText(route.query.page) : null;
  await router.push({
    hash: route.hash,
    query: {
      ...query,
      sessionId,
      ...(from ? { scheduleFrom: internalPageAddress(from), scheduleFromSession: queryText(query.sessionId) ?? undefined } : {}),
    },
  });
}

async function openPanelAgent(agentId: string) {
  if (!agentId || !(await display.close())) return;
  const { taskView: _taskView, sessionId: _session, scheduleFrom: _from, scheduleFromSession: _fromSession, ...query } = route.query;
  await router.push({ query: { ...query, agentId }, hash: route.hash });
}

async function returnToSchedule() {
  const page = scheduleReturnPage.value;
  if (!page) return;
  const { scheduleFrom: _from, scheduleFromSession, ...query } = route.query;
  const target = { query: { ...query, page, sessionId: queryText(scheduleFromSession) ?? undefined }, hash: route.hash };
  if (router.options.history.state.back === router.resolve(target).fullPath) {
    router.back();
    return;
  }
  await router.replace(target);
}

const scheduleTasks = ref<PlatformTask[]>([]);
const schedulesLoading = ref(false);
const scheduleLoadFailed = ref(false);
const schedulesApi = createSchedulesApi({ request: nodeApiRequest });
function scheduleAgentId(task: PlatformTask | undefined) {
  return task?.targetKind === "application" && task.appId === "agents" ? task.content.agentId : undefined;
}
const allAgentSchedules = computed(() => scheduleTasks.value.filter(task => typeof scheduleAgentId(task) === "string"));
const agentSchedules = computed(() => allAgentSchedules.value.filter(task => scheduleAgentId(task) === agentId.value));
let scheduleRead = 0;
async function loadSchedules() {
  if (!props.internalPages?.schedules) return;
  const read = ++scheduleRead;
  schedulesLoading.value = true;
  scheduleLoadFailed.value = false;
  try {
    const { tasks } = await schedulesApi.list("agents");
    if (read !== scheduleRead) return;
    scheduleTasks.value = tasks;
  } catch {
    if (read === scheduleRead) scheduleLoadFailed.value = true;
  } finally {
    if (read === scheduleRead) schedulesLoading.value = false;
  }
}
const selectedDashboardId = computed(() => inStandaloneDashboard.value
  ? new URLSearchParams(pageAddress.value?.split("?")[1]).get("dashboardId")
  : null);

const inAgentSettings = computed(() => {
  const path = pageAddress.value && platformPanelAddress(pageAddress.value).split("?")[0];
  return path === routes.agents.path || path === `${routes.agents.path}/detail`;
});
const showPanelBack = computed(() => inStandaloneDashboard.value
  || Boolean(props.internalPages && pageAddress.value && platformPanelAddress(pageAddress.value).split("?")[0] === routes.agents.path));
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
  (id, previous) => {
    if (typeof id === "string" && id !== conversationId.value) conversationId.value = id;
    else if (props.internalPages && id == null && typeof previous === "string") conversationId.value = null;
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
  // The standalone application can reopen this conversation after a document reload.
  if (!props.internalPages || requestedAgent() || requestedAgentKind() || queryText(route.query.sessionId) === id) return;
  const { scheduleFrom: _from, scheduleFromSession: _fromSession, ...query } = route.query;
  void router.replace({ query: { ...query, sessionId: id ?? undefined }, hash: route.hash });
});

/**
 * What the reader calls a page this application opens beside the conversation. A panel application names its page in the
 * platform's catalog, which its page reports as it opens; before that the page has no name here, and the line names the
 * address.
 */
function pageLabel(_id: string, reported: PageContext | null): string {
  return reported?.label ?? "";
}

/**
 * What the reader has selected in the page. A panel reports its own selection once it has one.
 */
function selectionIn(page: DisplayPage, reported: PageContext | null): readonly PageSelection[] {
  if (page.featureId === PANEL_APPLICATION_PAGE_ID) return reported?.selection ?? [];
  return [];
}

const shellLabels = useShellLabels();
const labels = computed(() => {
  const base = shellLabels.value;
  if (!props.splitNavigation) return base;
  if (locale.value === "zh-CN") return { ...base, newConversation: "新建会话", sessions: "历史会话", conversationTab: "会话", reportTab: "报告", fileTab: "文件预览" };
  if (locale.value === "zh-TW") return { ...base, newConversation: "新增會話", sessions: "歷史會話", conversationTab: "會話", reportTab: "報告", fileTab: "檔案預覽" };
  return { ...base, conversationTab: "Conversation", reportTab: "Report", fileTab: "File preview" };
});
function isReportPath(path: string) {
  return path.startsWith("outputs/") && /\.md$/i.test(path);
}

async function requestReportPpt(sessionId: string, message: string) {
  if (sessionId !== conversationId.value || !shell.value?.canRequestArtifactAction) {
    throw new Error(labels.value.working);
  }
  await shell.value.requestArtifactAction(message);
}

const dashboards = props.internalPages ? useDashboardStore() : null;
if (dashboards) {
  dashboards.bindSurface({
    get dashboardId() { return selectedDashboardId.value ?? ""; },
    navigate(id) {
      if (id) openDashboardApplication(id);
      else void display.close();
    },
  });
  onBeforeUnmount(() => dashboards.bindSurface(null));
}
const dashboardsOpen = ref(false);
const dashboardMenu = ref<string | null>(null);

function closeDashboards() {
  dashboardsOpen.value = false;
  dashboardMenu.value = null;
  dashboards?.cancelDashboardRename();
}

function toggleDashboards() {
  if (!dashboards) return;
  if (dashboardsOpen.value) return closeDashboards();
  dashboardsOpen.value = true;
  void dashboards.loadDashboards({ notifyError: true });
}

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand?.name || props.defaultBrandName,
  features: workbenchFeatures(
    props.features,
    inPanelApplication.value
      ? panelApplicationPageFeature(display.pageContext.value?.label || pageAddress.value!, pageAddress.value!,
          !inStandaloneDashboard.value && !inStandaloneSchedules.value && !(props.internalPages && inAgentSettings.value))
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
// Align the conversation list with a schedule reached from a saved link.
watch(
  () => [selectedSchedule.value, creatingSchedule.value, scheduleTasks.value, nav.agents.value] as const,
  ([taskId, creating]) => {
    const target = creating ? scheduleQuery.value.get("workspaceAgent") : scheduleAgentId(scheduleTasks.value.find(task => task.id === taskId));
    if (typeof target === "string" && nav.agents.value.some(agent => agent.id === target) && target !== agentId.value) {
      nav.adoptAgent(target);
    }
  },
);
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
function openInternalAgentSettings() {
  if (!props.internalPages || !editsAgents.value) return;
  closeDashboards();
  void display.navigate(routes.agents.path, { history: "push" });
}

const agentSettings = computed(() => props.internalPages && editsAgents.value ? {
  label: t("assistant.featureAgents"),
  open: openInternalAgentSettings,
} : undefined);

function openSettings() {
  if (!editsAgents.value) return void router.push(routes.usage.path);
  void router.push(routes.agents.path);
}

const showingTasks = computed(() => Boolean(props.internalPages && route.query.taskView === "all"));
const scheduleAgentNames = computed(() => nav.agentsState.value === "ready"
  ? new Map(nav.agents.value.map(agent => [agent.id, agent.name]))
  : undefined);
const scheduleAgent = computed(() => nav.agents.value.find((agent) => agent.id === agentId.value));
function isSchedulableAgent(agent: typeof scheduleAgent.value) {
  return Boolean(agent?.enabled && agent.kind !== "app-builder" && agent.kind !== "ops-diagnosis");
}
const canScheduleAgent = computed(() => isSchedulableAgent(scheduleAgent.value));

const taskSessions = ref<AgentHostSession[]>([]);
const taskCursor = ref<string | null>(null);
const tasksLoading = ref(false);
const tasksError = ref<"initial" | "more" | null>(null);
let taskRequest = 0;
// Both sidebar views follow their runs through the same page-level stream.
useSessionRunFeed({
  port: client.sessionRuns,
  sessions: () => showingTasks.value ? taskSessions.value : nav.sessions.value,
  presentation: true,
  onError: (error) => ElMessage.error(error instanceof Error ? error.message : String(error)),
});
const allTasksLabel = computed(() => locale.value === "zh-CN" ? "全部任务" : locale.value === "zh-TW" ? "全部任務" : "All tasks");
const visibleTaskCount = computed(() => taskSessions.value.length + allAgentSchedules.value.length);
const taskStatusLabels = computed(() => ({
  running: locale.value === "zh-CN" ? "执行中" : t("assistant.taskRunning"),
  completed: t("assistant.taskCompleted"),
  failed: t("assistant.taskFailed"),
  cancelled: t("assistant.taskCancelled"),
  pending: locale.value === "zh-CN" ? "待运行" : locale.value === "zh-TW" ? "待執行" : "Not started",
}));
const taskGroups = computed(() => {
  const groups = new Map(Object.entries(taskStatusLabels.value).map(([key, label]) =>
    [key, { key, label, sessions: [] as AgentHostSession[] }]));
  for (const session of taskSessions.value) {
    groups.get(analysisTaskStatus(session))!.sessions.push(session);
  }
  return [...groups.values()].filter(group => group.sessions.length);
});

function analysisTaskStatus(session: AgentHostSession) {
  const run = session.latestRun;
  if (!run) return "pending";
  if (run.status === "running" || run.delegatedRunning) return "running";
  if (run.stopReason === "aborted") return "cancelled";
  if (run.stopReason === "error" || run.stopReason === "length") return "failed";
  return "completed";
}

async function loadAnalysisTasks(append = false) {
  if (append && (tasksLoading.value || !taskCursor.value)) return;
  const request = ++taskRequest;
  tasksLoading.value = true;
  tasksError.value = null;
  try {
    const cursor = append ? taskCursor.value : null;
    const path = `/assistant/analysis-sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
    const page = agentHostSessionPageSchema.parse(await nodeApiGet(path));
    if (request !== taskRequest) return;
    taskSessions.value = append ? [...taskSessions.value, ...page.sessions] : page.sessions;
    taskCursor.value = page.nextCursor;
  } catch {
    if (request === taskRequest) tasksError.value = append ? "more" : "initial";
  } finally {
    if (request === taskRequest) tasksLoading.value = false;
  }
}

async function openAllTasks() {
  if (showingTasks.value) {
    shell.value?.showHistory();
    return;
  }
  if (!(await display.close())) return;
  closeDashboards();
  const { sessionId: _session, scheduleFrom: _from, scheduleFromSession: _fromSession, ...query } = route.query;
  const failure = await router.push({ query: { ...query, taskView: "all" }, hash: route.hash });
  if (failure) return;
  if (conversationId.value) nav.startNew();
  shell.value?.showHistory();
}

async function leaveAllTasks() {
  if (!showingTasks.value) return;
  // Use the conversation left by the rail selection, which may have started a new one.
  await nextTick();
  const { taskView: _taskView, ...query } = route.query;
  await router.replace({ query: { ...query, sessionId: conversationId.value ?? undefined }, hash: route.hash });
}

watch(showingTasks, (open) => {
  if (!open) return;
  void loadAnalysisTasks();
  void loadSchedules();
}, { immediate: true });

async function openAnalysisTask(session: AgentHostSession) {
  if (display.page.value && !(await display.close())) return;
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
let linkRequest = 0;
const unmounted = ref(false);
onBeforeUnmount(() => {
  unmounted.value = true;
});
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
  const settled = () => unmounted.value || knowsPage() || nav.agentsState.value === "error";
  if (!settled()) {
    await new Promise<void>((resolve) => {
      const stop = watch(settled, (now) => {
        if (!now) return;
        stop();
        resolve();
      });
    });
  }
  return !unmounted.value && nav.agentsState.value !== "error";
}
/**
 * Waits for the agent directory to finish loading before judging whether a requested agent is available. If an earlier
 * read had already failed, retries once so the reader either reaches the agent or sees why the directory failed.
 */
async function agentsKnown(): Promise<boolean> {
  if (nav.agentsState.value === "error") {
    await nav.loadAgents().catch((error) => {
      if (!unmounted.value) ElMessage.error(error instanceof Error ? error.message : String(error));
    });
  }
  const settled = () => unmounted.value || nav.agentsState.value !== "loading";
  if (!settled()) {
    await new Promise<void>((resolve) => {
      const stop = watch(settled, (now) => {
        if (!now) return;
        stop();
        resolve();
      });
    });
  }
  return !unmounted.value && nav.agentsState.value === "ready";
}
const linkAddress = () =>
  JSON.stringify([
    requestedAgent(),
    requestedAgentKind(),
    queryText(route.query.sessionId),
    queryText(route.query.prompt),
    queryText(route.query.prefill),
    queryText(route.query.page),
  ]);

/**
 * Applies `?agentId=` or `?agentKind=` once the agents are known. The link's parameters leave the address first, so a
 * reload neither sends its question again nor reopens what it named; the page then follows its own conversation
 * behaviour. A disabled or missing agent is reported and the page keeps the agent its own rule chose. An enabled one
 * is selected, and then the named conversation opens, or a new one starts and, with `&prompt=`, sends it as its first
 * message, or with `&prefill=`, fills the composer without sending.
 *
 * A page's own composer (a dashboard's) sends its question here with `&page=`: the page it was written on opens beside
 * the conversation and stays there, so the reader's next message carries it and its answer can name what the page shows.
 */
async function openRequestedAgent() {
  const id = requestedAgent();
  const kind = requestedAgentKind();
  if (!id && !kind) return;
  const address = linkAddress();
  if (pendingLink === address || consumedLink === address) return;
  pendingLink = address;
  const request = ++linkRequest;
  const stale = () => unmounted.value || request !== linkRequest;
  const session = queryText(route.query.sessionId);
  const prompt = queryText(route.query.prompt);
  const prefill = queryText(route.query.prefill);
  const draft = prompt ?? prefill;
  const page = queryText(route.query.page);
  // The link's own parameters go before anything is awaited; the page it was written on stays, carried by the address.
  const {
    agentId: _agent,
    agentKind: _agentKind,
    sessionId: _session,
    prompt: _prompt,
    prefill: _prefill,
    ...query
  } = route.query;
  await router.replace({ query: page ? { ...query, page } : query });
  if (stale()) return;
  // The page the message was written on is beside the conversation from the start: the agent is one of those offered on
  // it, and the message carries its skill, once the conversation knows it. Without a page, wait for the agent directory
  // to finish loading before concluding the requested agent is unavailable. Its agents not read, the message ends here,
  // unsent; the same address arriving again is the reader trying again.
  const ready = page ? await pageKnown() : await agentsKnown();
  if (stale()) return;
  if (!ready) return giveBack(draft);
  const matched = id
    ? nav.agents.value.find((agent) => agent.id === id && agent.enabled)
    : nav.agents.value.find((agent) => agent.kind === kind && agent.enabled);
  if (!matched) {
    ElMessage.error(t("assistant.agentUnavailable"));
    return giveBack(draft);
  }
  const targetId = matched.id;
  agentId.value = targetId;
  // Switching agents starts a new conversation in the navigation; what the link names comes after that.
  await nextTick();
  if (stale()) return;
  placingFrom = page?.split("?")[0] ?? null;
  if (session) {
    nav.selectSession(session);
  } else if (prefill && !page) {
    nav.startNew();
  } else {
    // The conversation this tab already holds with the agent goes on; a new tab, or another agent, starts a new one.
    // Coming from a page, this runs on the way in, before the column has read the agent's conversations: the held one is
    // looked up in the host's list rather than in a list that is still empty, or every page message would start anew.
    const held = readRememberedSession(targetId);
    if (held && !nav.sessions.value.some((row) => row.id === held)) await nav.loadSessions();
    if (stale()) {
      placingFrom = null;
      return;
    }
    const continuing = held !== null && nav.sessions.value.some((row) => row.id === held);
    if (continuing) nav.selectSession(held);
    else nav.startNew();
  }
  placingFrom = null;
  // The page this message came from stays beside the conversation it was written for, or opens there when it was not
  // shown; opened anew, it says again which skill it reaches once drawn, and the message carries that.
  if (page) {
    await display.navigate(page, { view: "side", history: "replace" });
    if (stale()) return;
    await nextTick();
    if (stale()) return;
    if (!(await pageKnown())) {
      if (stale()) return;
      return giveBack(draft);
    }
    if (stale()) return;
  }
  if (prompt) {
    await nextTick();
    if (stale()) return;
    await shell.value!.send(prompt);
  } else if (prefill) {
    await nextTick();
    if (stale()) return;
    shell.value!.fill(prefill);
  }
  if (stale()) return;
  // Placed: the address is spent, and the same one arriving again is the reader's next message.
  pendingLink = null;
  consumedLink = address;
}
// The same address entered while the page is open (another link to an agent) does the same.
watch(
  () => [route.query.agentId, route.query.agentKind] as const,
  ([id, kind]) => {
    // The address no longer names an agent: the next one that does is a new message, even from the same page.
    if (!id && !kind) consumedLink = null;
    void openRequestedAgent();
  },
);

/** Open a board from the workbench's dashboard list. */
function openDashboardApplication(dashboardId: string) {
  if (props.internalPages) {
    closeDashboards();
    void display.navigate(panelAddress(props.internalPages.dashboard, { dashboardId }), { history: "push" });
    return;
  }
  openDashboardPage(dashboardId);
}

/** The dashboard entry loads its own application before opening the saved board. */
function openDashboardPage(dashboardId: string) {
  closeDashboards();
  void router.push({ path: routes.dashboards.path, query: { dashboardId } });
}

function openSchedule(task?: PlatformTask) {
  const workspaceAgent = task ? scheduleAgentId(task) : agentId.value;
  if (!props.internalPages?.schedules || typeof workspaceAgent !== "string" || (!task && !canScheduleAgent.value)) return;
  closeDashboards();
  const state = { workspaceAgent, ...(task ? { selectedTask: task.id } : { workspaceCompose: "new" }) };
  void display.navigate(panelAddress(props.internalPages.schedules, state), { history: "push" });
}

type ConversationScheduleSource = {
  sessionId: string;
  agentId: string | null;
  title?: string;
  origin?: AgentHostSession["origin"];
  initialInstruction: () => Promise<string>;
};
const preparingConversationSchedule = ref(false);
let conversationScheduleDraft: {
  agentId: string;
  values: Record<string, string>;
  filled: boolean;
} | null = null;

function sessionForSchedule(sessionId: string) {
  return taskSessions.value.find(session => session.id === sessionId) ?? nav.currentSession.value;
}

function canScheduleConversation(source: ConversationScheduleSource) {
  const origin = source.origin ?? sessionForSchedule(source.sessionId)?.origin ?? "user";
  return Boolean(props.internalPages?.schedules && !scheduleReturnPage.value
    && isSchedulableAgent(nav.agents.value.find(agent => agent.id === source.agentId))
    && origin === "user");
}

async function scheduleConversation(source: ConversationScheduleSource) {
  if (!props.internalPages?.schedules || !source.agentId || !canScheduleConversation(source) || preparingConversationSchedule.value) return;
  preparingConversationSchedule.value = true;
  try {
    const instruction = await source.initialInstruction();
    if (conversationId.value !== source.sessionId || display.page.value || !canScheduleConversation(source)) return;
    if (!instruction || instruction.length > PLATFORM_SCHEDULE_TEXT_MAX) {
      ElMessage.warning(t(instruction ? "scheduledTasks.instructionTooLong" : "scheduledTasks.instructionMissing", { max: PLATFORM_SCHEDULE_TEXT_MAX }));
      return;
    }
    const address = panelAddress(props.internalPages.schedules, { workspaceAgent: source.agentId, workspaceCompose: "new" });
    const title = (sessionForSchedule(source.sessionId)?.title || source.title || "").slice(0, PLATFORM_SCHEDULE_TITLE_MAX);
    const draft = { agentId: source.agentId, values: { ...(title && { "/task/title": title }), "/instruction": instruction }, filled: false };
    conversationScheduleDraft = draft;
    closeDashboards();
    if (!(await display.navigate(address, { history: "push" })) && conversationScheduleDraft === draft) {
      conversationScheduleDraft = null;
    }
  } catch {
    ElMessage.error(t("scheduledTasks.prefillFailed"));
  } finally {
    preparingConversationSchedule.value = false;
  }
}

async function reportPanelContext(context: PageContext) {
  display.context(context);
  const draft = conversationScheduleDraft;
  const form = context.forms?.find(form => form.member === "newForm" && !form.memberPath?.length);
  if (!draft || draft.filled || !creatingSchedule.value || scheduleQuery.value.get("workspaceAgent") !== draft.agentId
    || !form || !activePageController?.fillForm) return;
  if (form.dirty) {
    draft.filled = true;
    return;
  }
  draft.filled = true;
  try {
    const outcome = await activePageController.fillForm({
      member: form.member, values: draft.values, expectedFormInstanceId: form.formInstanceId,
    });
    if (conversationScheduleDraft === draft && (!outcome.ok || outcome.rejectedFields?.length)) {
      ElMessage.warning(t("scheduledTasks.prefillFailed"));
    }
  } catch {
    if (conversationScheduleDraft === draft) ElMessage.warning(t("scheduledTasks.prefillFailed"));
  }
}

function reportPanelAddress(input: DisplayPageAddressInput) {
  const draft = conversationScheduleDraft;
  if (draft && input.kind === "state" && creatingSchedule.value
    && internalPageAddress(input.address).split("?")[0] === props.internalPages?.schedules) {
    const query = new URLSearchParams(input.address.split("?")[1]);
    if (query.get("workspaceCompose") !== "new" && !query.get("selectedTask")) {
      // The native form has already handled discarding edits before it reports cancel.
      conversationScheduleDraft = null;
      void display.close();
      return;
    }
  }
  display.address(input);
}

watch(creatingSchedule, (creating) => {
  if (!creating) conversationScheduleDraft = null;
});

onMounted(async () => {
  if (!showingTasks.value) void loadSchedules();
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
    :inline-artifacts="splitNavigation"
    :primary-artifact-path="internalPages && splitNavigation ? isReportPath : undefined"
    :history-page-selected="inStandaloneSchedules || inStandaloneDashboard || Boolean(internalPages && inAgentSettings)"
    :conversation-back-label="scheduleReturnPage ? t('common.back') : undefined"
    :neutral-agent-selection="showingTasks || inStandaloneDashboard"
    :format-session-date="splitNavigation ? formatRelativeTime : undefined"
    :agent-settings="agentSettings"
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
    @conversation-back="returnToSchedule"
    @rail-agent-selected="leaveAllTasks"
  >
    <template v-if="$slots.brand" #brand><slot name="brand" /></template>
    <template v-if="$slots.account" #account><slot name="account" /></template>
    <template v-if="internalPages" #shortcuts>
      <button class="legacy-footer-item" type="button" :title="allTasksLabel" :aria-pressed="showingTasks" @click="openAllTasks">
        <ListTodo :size="16" aria-hidden="true" /><span>{{ allTasksLabel }}</span>
        <small v-if="visibleTaskCount" class="legacy-task-badge">{{ visibleTaskCount }}{{ taskCursor ? '+' : '' }}</small>
      </button>
      <section v-if="dashboardsOpen && dashboards" id="data-agent-dashboard-list" class="legacy-dashboard-list" :aria-label="t('analysis.myDashboards')" @keydown.esc.stop="closeDashboards">
        <header>
          <span>{{ t('analysis.myDashboards') }}</span>
          <button type="button" :aria-label="t('common.close')" @click="closeDashboards"><X :size="14" /></button>
        </header>
        <div v-loading="dashboards.loadingDashboards" class="legacy-dashboard-items" :aria-busy="dashboards.loadingDashboards">
          <p v-if="!dashboards.loadingDashboards && !dashboards.dashboardItems.length">{{ t('analysis.noDashboards') }}</p>
          <div v-for="board in dashboards.dashboardItems" :key="board.id" class="legacy-dashboard-item" :class="{ active: inStandaloneDashboard && board.id === selectedDashboardId }">
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
    <template v-if="internalPages?.schedules && (canScheduleAgent || agentSchedules.length)" #before-history>
      <section class="agent-schedules" :aria-label="t('scheduledTasks.title')">
        <div class="section-title agent-schedules-heading">
          <span class="history-list-marker" aria-hidden="true" />
          <span>{{ t('scheduledTasks.title') }}<template v-if="agentSchedules.length"> ({{ agentSchedules.length }})</template></span>
          <button v-if="canScheduleAgent"
            type="button" :title="t('scheduledTasks.newTask')" :aria-label="t('scheduledTasks.newTask')"
            :aria-pressed="creatingSchedule" @click="openSchedule()">
            <Plus :size="15" aria-hidden="true" />
          </button>
        </div>
        <p v-if="scheduleLoadFailed" class="session-note" role="alert">
          {{ labels.loadFailed }} <button type="button" @click="loadSchedules">{{ labels.retry }}</button>
        </p>
        <AgentScheduleRows v-if="agentSchedules.length" class="session-list" :tasks="agentSchedules"
          :selected-id="selectedSchedule" @select="openSchedule" />
      </section>
    </template>
    <template v-if="showingTasks" #session-list>
      <header class="session-heading legacy-task-heading">
        <div class="legacy-task-avatar"><ClipboardList :size="22" aria-hidden="true" /></div>
        <div><strong>{{ allTasksLabel }}</strong><p>{{ locale === 'zh-CN' ? '跨智能体统一任务看板' : locale === 'zh-TW' ? '跨智慧代理任務總覽' : 'Tasks across agents' }}</p></div>
      </header>
      <div class="legacy-task-body" :aria-busy="tasksLoading || schedulesLoading">
        <div class="session-list legacy-task-list">
          <section v-if="internalPages?.schedules" class="legacy-task-group" :aria-label="t('scheduledTasks.title')">
            <h2 class="agent-schedules-heading"><span class="history-list-marker" aria-hidden="true" />{{ t('scheduledTasks.title') }}<template v-if="allAgentSchedules.length"> ({{ allAgentSchedules.length }})</template></h2>
            <p v-if="scheduleLoadFailed" class="legacy-task-note" role="alert">
              {{ t('scheduledTasks.loadFailed') }} <button type="button" @click="loadSchedules">{{ labels.retry }}</button>
            </p>
            <p v-else-if="!allAgentSchedules.length" class="legacy-task-note">
              {{ schedulesLoading ? t('common.loading') : t('scheduledTasks.empty') }}
            </p>
            <AgentScheduleRows v-if="allAgentSchedules.length" :tasks="allAgentSchedules" :selected-id="selectedSchedule"
              :agent-names="scheduleAgentNames" @select="openSchedule" />
          </section>
          <section class="legacy-task-history" :aria-label="t('assistant.conversationHistory')">
            <p v-if="tasksError === 'initial'" class="legacy-task-note" role="alert">
              {{ labels.loadFailed }} <button type="button" @click="loadAnalysisTasks()">{{ labels.retry }}</button>
            </p>
            <p v-else-if="!taskSessions.length && !taskCursor" class="legacy-task-note">{{ tasksLoading ? t('common.loading') : labels.noSessions }}</p>
            <section v-for="group in taskGroups" :key="group.key" class="legacy-task-group" :aria-label="group.label">
              <h2><span class="history-list-marker" :data-status="group.key" aria-hidden="true" />{{ group.label }} ({{ group.sessions.length }})</h2>
              <ul>
                <li v-for="session in group.sessions" :key="session.id" class="session-item" :class="{ active: !inStandaloneSchedules && session.id === conversationId }">
                  <button type="button" class="session-open" :aria-current="!inStandaloneSchedules && session.id === conversationId ? 'page' : undefined" @click="openAnalysisTask(session)">
                    <span class="session-title">{{ session.title || labels.newConversation }}</span>
                    <span class="history-list-meta">
                      <span v-if="session.origin === 'scheduled'" role="img" :title="labels.scheduledSession" :aria-label="labels.scheduledSession">
                        <CalendarClock :size="12" aria-hidden="true" />
                      </span>
                      {{ formatRelativeTime(session.createdAt) }}
                      <span v-if="group.key !== 'pending'" class="legacy-task-status" :data-status="group.key">{{ group.label }}</span>
                    </span>
                  </button>
                </li>
              </ul>
            </section>
            <p v-if="tasksError === 'more'" class="legacy-task-note" role="alert">{{ labels.loadFailed }}</p>
            <button v-if="taskCursor && tasksError !== 'initial'" type="button" class="more" :disabled="tasksLoading" @click="loadAnalysisTasks(true)">
              {{ tasksLoading ? t('common.loading') : tasksError === 'more' ? labels.retry : labels.more }}
            </button>
          </section>
        </div>
      </div>
    </template>
    <template v-if="showingTasks" #conversation-empty>
      <p>{{ locale === 'zh-CN' ? '从列表中选择任务查看详情' : locale === 'zh-TW' ? '從清單中選擇任務查看詳情' : 'Choose a task to view its details' }}</p>
    </template>
    <template v-if="$slots.welcome" #welcome="scope">
      <slot name="welcome" v-bind="scope" />
    </template>
    <template v-if="internalPages?.schedules" #conversation-heading-actions="source">
      <button v-if="canScheduleConversation(source)" type="button" class="workbench-conversation-schedule"
        :disabled="preparingConversationSchedule" @click="scheduleConversation(source)">
        <CalendarClock :size="16" aria-hidden="true" />
        {{ t('scheduledTasks.newTask') }}
      </button>
    </template>
    <template #feature="{ featureId: page }">
      <div v-if="showPanelBack" class="workbench-panel-nav">
        <button type="button" class="workbench-panel-back" @click="display.close()">
          <ArrowLeft :size="16" aria-hidden="true" />
          {{ t('common.back') }}
        </button>
      </div>
      <!-- What the page hands its display: what the reader looks at, its address moves, what its loader knows, and
           whether leaving it now would drop unsaved changes. What the display hands the page: when to read its objects
           again. -->
      <component
        :is="pilotPage.component"
        v-if="pilotPage"
        :key="display.page.value!.instance"
        v-bind="pilotPage.props"
        :class="{ 'legacy-dashboard-surface': inStandaloneDashboard, 'legacy-schedules-surface': inStandaloneSchedules }"
        v-bind:legacy-dashboard-layout="inStandaloneDashboard || undefined"
        :take-opened-entry="display.page.value?.takeOpenedEntry"
        :object-refresh="display.objectRefresh.value"
        :live-state="display.liveState.value"
        :register-page-controller="(controller: DisplayPageController) => registerActivePageController(display.page.value!.instance, controller)"
        @context="reportPanelContext"
        @display-address="reportPanelAddress"
        @display-loaded="display.loaded"
        @display-dirty="display.dirty"
        @display-skill="display.skill"
        @objects-changed="inStandaloneSchedules ? loadSchedules() : internalPages && inAgentSettings ? nav.loadAgents() : undefined"
      />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #artifact-actions="{ artifact, title, caption }">
      <ReportActions
        v-if="splitNavigation && isReportPath(artifact.path)"
        :key="artifact.id"
        :artifact="artifact"
        :title="title"
        :can-generate-ppt="Boolean(shell?.canRequestArtifactAction)"
        :request-ppt="requestReportPpt"
        @open-dashboard="openDashboardApplication"
      />
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
.workbench-panel-nav {
  flex: none;
  padding: var(--spacing-xs) var(--spacing-md);
  border-block-end: 1px solid var(--el-border-color-lighter);
}
.workbench-panel-back {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--el-text-color-secondary);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.workbench-panel-back:hover { background: var(--el-fill-color); color: var(--el-text-color-primary); }
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  border-radius: var(--radius-sm);
}
</style>
