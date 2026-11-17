<script setup lang="ts">
import { computed, inject, onMounted, ref } from "vue";
import { randomId } from "@ontomato/contracts/random-id";
import { productAssetSchema,platformWidget, type ProductAsset } from "@ontomato/contracts/product-assets";
import { AgentPicker, ShellComposer } from "@ontomato/agent-shell-ui";
import { ElMessageBox } from "element-plus";
import { readRememberedAgent } from "@ontomato/workbench-ui";
import { homeStateSchema, type HomeState } from "@ontomato/contracts/platform-home";
import type { WorkspaceObjectReference } from "@ontomato/contracts/workspace-objects";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { nodeApiRequest } from "@ontomato/workbench-ui";
import { defaultPersonalWorkspace, personalWorkspaceSchema, recentWorkListSchema, type RecentWork, type WorkspaceSection } from "@ontomato/contracts/personal-workspace";
import { ManagerFrame, ObjectViewPage, ProductAssetRuntime, useProductText } from "@ontomato/ontology-manager";
import { DashboardCardPicker, DashboardMetricPreview } from "@ontomato/workbench-ui/features/dashboard";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import { platformSchedulesPath, platformTaskListSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import {dropdownBoundaryOptions} from '@ontomato/ontology-manager';
import { useApplicationCatalog } from "../catalog";
import {openApplicationKey} from '../apps';
import {HOME_PREFERENCES_CHANGED} from '../features/home/api';
import AppPage from "./AppPage.vue";
import WorkspaceSkeleton from "./WorkspaceSkeleton.vue";
import { AppWindow, ArrowUpRight, CircleAlert, Clock3, LayoutDashboard, MoreHorizontal, Pin, RefreshCw, Settings2, Sparkles } from "lucide-vue-next";
import WorkspaceResourceDetail, { type WorkspaceResource } from "./WorkspaceResourceDetail.vue";
import { agentHostAgentListSchema, agentHostCreateSessionResponseSchema, agentHostSessionSnapshotSchema, type AgentHostAgent, type AgentHostSession } from "@ontomato/contracts/agent-host";
const { locale, t } = useI18n();
const productText = useProductText();
const props=defineProps<{productAssetId?:string;platformWidgetAsset?:ProductAsset;preview?:boolean;pinnedAssets?:ProductAsset[];embedded?:boolean;pageState?:Record<string,unknown>;unavailableAssets?:string[]}>();
const personalHome=computed(()=>!props.productAssetId&&!props.platformWidgetAsset&&!props.embedded);
const today=computed(()=>new Intl.DateTimeFormat(locale.value,{month:'long',day:'numeric',weekday:'long'}).format(new Date()));
const router = useRouter();
const openApplication=inject(openApplicationKey)!;
const catalog = useApplicationCatalog();
const config = ref(defaultPersonalWorkspace());
const homeAsset = ref<ProductAsset | null>(null);
const blockLimit=(asset?:ProductAsset)=>asset?platformWidget(asset.document)?.limit??4:4;
const productAssets = ref<ProductAsset[]>([]);
const configRevision = ref<number>();
const overlayRevision=ref(0);
async function acceptPagePreferences(asset:ProductAsset){
  if(asset.document.kind!=='page')throw new Error('Expected page');
  const overlay=await json(`/api/product-assets/${encodeURIComponent(asset.id)}/overlay`);
  overlayRevision.value=overlay.revision;
  acceptConfig({data:overlay.workspace??asset.document.workspace??defaultPersonalWorkspace(),revision:asset.revision});
}
function acceptConfig(body: {data:unknown;revision?:number}) {
  config.value=personalWorkspaceSchema.parse(body.data);configRevision.value=body.revision;
}
async function saveConfiguration(workspace:unknown) {
  if(homeAsset.value){
    const result=await json(`/api/product-assets/${encodeURIComponent(homeAsset.value.id)}/overlay`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspace,revision:overlayRevision.value})});
    overlayRevision.value=result.revision;return {data:result.workspace,revision:configRevision.value};
  }
  return json('/api/personal-workspace',{method:'PUT',headers:configurationHeaders(),body:JSON.stringify(workspace)});
}
const configurationHeaders = () => ({"Content-Type":"application/json",...(configRevision.value ? {"If-Match":String(configRevision.value)} : {})});
async function readProducts() {
  await load("products",async()=>{
    if(props.pinnedAssets){homeAsset.value=props.pinnedAssets.find(asset=>asset.id===props.productAssetId)??null;productAssets.value=props.pinnedAssets;return;}
    const home=await json(props.productAssetId?`/api/product-assets/${encodeURIComponent(props.productAssetId)}`:"/api/product-assets/home");homeAsset.value=productAssetSchema.parse(home.asset);
    productAssets.value=(await json("/api/product-assets")).assets.map((asset:unknown)=>productAssetSchema.parse(asset));
  });
}
const pageLayout=computed(()=>homeAsset.value?.document.kind==='page'?homeAsset.value.document.layout:undefined);
const pageGridStyle=computed(()=>pageLayout.value?{'--product-main-width':`${pageLayout.value.mainWidth}fr`,'--product-side-width':`${12-pageLayout.value.mainWidth}fr`,'--product-gap':pageLayout.value.gap==='compact'?'8px':pageLayout.value.gap==='comfortable'?'24px':'16px'}:{});
const productChildren = (column:number) => props.platformWidgetAsset ? column===0?[{id:props.platformWidgetAsset.id,asset:props.platformWidgetAsset,span:'full' as const,width:undefined as number|undefined,section:platformWidget(props.platformWidgetAsset.document)?.source}]:[] : homeAsset.value?.document.kind === 'page'
  ? homeAsset.value.document.children.filter(child=>pageLayout.value?.mode==='grid'||pageLayout.value?.mainWidth===12?column===0:child.column===(column===0?'main':'sidebar')).map(child=>{
  const asset=productAssets.value.find(asset=>asset.id===child.assetId);
    return {id:child.assetId,asset,span:child.span,width:child.width,section:asset?platformWidget(asset.document)?.source:undefined};
  }) : [];
const draft = ref(defaultPersonalWorkspace());
const draftChildren=ref<Array<{assetId:string;column:'main'|'sidebar';span?:'full'|'half';width?:number}>>([]);
const draftPageLayout=ref({mode:'columns' as 'columns'|'grid',mainWidth:8,gap:'comfortable' as 'compact'|'normal'|'comfortable'});
const addProductId=ref('');
const reusableProducts=computed(()=>productAssets.value.filter(asset=>asset.id!==homeAsset.value?.id&&['page','widget','widget-group','operation-panel','dashboard','object-view','metric-widget','action-view','collection-view','object-projection','agent-profile'].includes(asset.document.kind)&&!(asset.document.kind==='page'&&asset.document.isTemplate)));
function addProduct(){if(addProductId.value&&!draftChildren.value.some(child=>child.assetId===addProductId.value))draftChildren.value.push({assetId:addProductId.value,column:'main',span:'full'});}
async function saveComposition(){
  if(!homeAsset.value || homeAsset.value.document.kind!=='page')throw new Error('Page unavailable');
  const current=homeAsset.value;
  await saveConfiguration(personalWorkspaceSchema.parse(draft.value));
  if(!current.editable||props.pinnedAssets)return {data:draft.value,revision:current.revision};
  const response=await json(`/api/product-assets/${encodeURIComponent(current.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:current.name,description:current.description,revision:configRevision.value,document:{...current.document,layout:draftPageLayout.value,children:draftChildren.value}})});
  const saved=productAssetSchema.parse(response.asset);homeAsset.value=saved;
  return {data:draft.value,revision:saved.revision};
}
const editing = ref(false);
const saving = ref(false);
const ready = ref(false);
const errors = ref<Record<string, string>>({});
const busy = ref<Record<string, boolean>>({});
const dashboards = ref<DashboardListItem[]>([]);
const tasks = ref<PlatformTask[]>([]);
const recent = ref<RecentWork[]>([]);
const previewRevision = ref(0);
const resource = ref<WorkspaceResource | null>(null);
const resourceOpen = ref(false);
const analysisBusy = ref(false);
const analysisError = ref("");
const objectPreview = ref<WorkspaceObjectReference | null>(null);
const objectPreviewOpen = ref(false);
const settingsTab = ref("layout");
const refreshing = ref(false);
function presetSections(layout: string): { main: WorkspaceSection[]; sidebar: WorkspaceSection[]; hidden: WorkspaceSection[] } {
  return layout === "tasks" ? { main: ["tasks", "data"], sidebar: ["conversations", "objects", "apps", "recent"], hidden: [] }
    : { main: layout === "data" ? ["data", "apps"] : ["apps", "data"], sidebar: ["conversations", "objects", "tasks", "recent"], hidden: [] };
}
const agents = ref<AgentHostAgent[]>([]);
const agentId = ref<string | null>(readRememberedAgent());
const homeState = ref<HomeState | null>(null);
const pinnedSessions = ref<Record<string, AgentHostSession>>({});
const pinErrors = ref<Record<string, string>>({});
const pinned = computed(() => config.value.pinnedAnalyses.map(item => ({ ...item, session: pinnedSessions.value[item.sessionId] })));
let pinReadRevision = 0;
const enabledAgents = computed(() => agents.value.filter(agent => agent.enabled));
const conversations = computed(() => (homeState.value?.recentConversations ?? []).filter(item => enabledAgents.value.some(agent => agent.id === item.agentId) && !config.value.pinnedAnalyses.some(pin => pin.sessionId === item.sessionId)));
async function readPinned() {
  const revision = ++pinReadRevision;
  await load("pins", async () => {
    const sessions: Record<string, AgentHostSession> = {}, failures: Record<string, string> = {};
    await Promise.all(config.value.pinnedAnalyses.map(async item => {
      try { sessions[item.sessionId] = agentHostSessionSnapshotSchema.parse(await json(`/api/assistant/sessions/${item.sessionId}`)).session; }
      catch { failures[item.sessionId] = t("ontology.productHomeConversationUnavailable"); }
    }));
    if (revision === pinReadRevision) { pinnedSessions.value = sessions; pinErrors.value = failures; }
  });
}
async function updatePins(next: typeof config.value.pinnedAnalyses) {
  if(props.preview)return;
  if (saving.value || editing.value || refreshing.value) return;
  saving.value = true;
  await load("pinsSave", async () => {
    const result = await saveConfiguration({ ...config.value, pinnedAnalyses: next });
    acceptConfig(result);
    await readPinned();
  });
  saving.value = false;
}
function pinConversation(item: { sessionId: string; title: string }) {
  void updatePins([...config.value.pinnedAnalyses, { sessionId: item.sessionId, title: conversationTitle(item.title).slice(0, 200) }]);
}
async function renamePin(id: string) {
  const item = config.value.pinnedAnalyses.find(item => item.sessionId === id)!;
  try {
    const result = await ElMessageBox.prompt(t("ontology.productHomeRenameAnalysisHint"), t("ontology.productHomeRenameAnalysis"), {
      inputValue: item.title, inputValidator: value => !!value?.trim() && value.trim().length <= 200,
      confirmButtonText: text.value.save, cancelButtonText: text.value.cancel,
    });
    await updatePins(config.value.pinnedAnalyses.map(pin => pin.sessionId === id ? { ...pin, title: result.value.trim() } : pin));
  } catch { /* Dismissing the name editor leaves the saved reference untouched. */ }
}
function movePin(index: number, offset: number) {
  const next = [...config.value.pinnedAnalyses];
  const [item] = next.splice(index, 1); next.splice(index + offset, 0, item!); void updatePins(next);
}
async function removeObject(item: WorkspaceObjectReference) {
  if(props.preview)return;
  if (saving.value || editing.value || refreshing.value) return;
  saving.value = true;
  await load("objectsSave", async () => {
    const next = { ...config.value, pinnedObjects: config.value.pinnedObjects.filter(value => value.className !== item.className || value.primaryKey !== item.primaryKey) };
    acceptConfig(await saveConfiguration(next));
  });
  saving.value = false;
}
function openObject(item: WorkspaceObjectReference) {
  if (config.value.objectOpening === "drawer") { objectPreview.value = item; objectPreviewOpen.value = true; return; }
  openObjectPage(item);
}
function openObjectPage(item: WorkspaceObjectReference) {
  objectPreviewOpen.value = false;
  void router.push({ name: platformRoutes.objectView.name, params: { className: item.className }, query: { key: item.primaryKey, from: "workspace" } });
}
function askObject(item: WorkspaceObjectReference) {
  const question = locale.value.startsWith("zh")
    ? `请分析对象「${item.title}」。对象引用：${JSON.stringify({ className: item.className, primaryKey: item.primaryKey })}。请先按现有权限读取并核实该对象，说明可获得的信息与数据限制；不要将该对象默认扩展为全学院或其他对象集合。`
    : `Analyze object "${item.title}". Reference: ${JSON.stringify({ className: item.className, primaryKey: item.primaryKey })}. First read and verify the object through existing permissions. Explain available evidence and limitations; do not silently expand its scope.`;
  objectPreviewOpen.value = false;
  void ask(question);
}
/** Older sessions may use the resource-analysis request as their title. Show its business label only. */
function conversationTitle(title: string) {
  const resourceTitle = title.match(/"(?:resource|kind)"[\s\S]*?"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (resourceTitle) {
    try { return JSON.parse(`"${resourceTitle[1]}"`) as string; } catch { /* Fall through to the readable request. */ }
  }
  const readable = title
    .replace(/\s*[（(][^()（）]*(?:dashboardId|cardId|sessionId|taskId|runId)\s*[:：][^()（）]*[）)]/gi, "")
    .split(/\n|\{\s*"|(?:dashboardId|cardId|sessionId|taskId|runId)\s*[:：]/i)[0]!
    .replace(/(?:个人工作台协作请求|分析上下文)\s*[:：]\s*/g, "")
    .replace(/(?:请先读取当前信息|对象引用)\s*[:：]?[\s\S]*$/, "")
    .replace(/^请分析对象[「“]([^」”]+)[」”][。.]?$/, "$1 · 对象分析")
    .replace(/[\s，,；;：:]+$/, "").trim();
  return readable || workspaceText.value.untitled;
}
const workspaceText = computed(() => ({
  heading: t("ontology.productHomeAskHeading"), description: t("ontology.productHomeAskDescription"), placeholder: t("ontology.productHomeAskPlaceholder"), send: t("ontology.productHomeSendQuestion"), stop: t("ontology.productHomeStop"), agent: t("ontology.productHomeAgent"), continue: t("ontology.productHomeContinueAnalysis"), empty: t("ontology.productHomeAnalysisEmpty"), untitled: t("ontology.productUntitledAnalysis"), resources: t("ontology.productHomeResources"), noAgent: t("ontology.productHomeNoAgent"), recent: t("ontology.productHomeRecentResources"),
}));
async function ask(question: string) {
  if(props.preview)return;
  if (!agentId.value || !enabledAgents.value.some(agent => agent.id === agentId.value)) return;
  await router.push({ path: platformRoutes.chat.path, query: { agentId: agentId.value, prompt: question } });
}
const interactionLabels = computed(() => ({
  title: t("ontology.productHomeDefaultView"), metrics: t("ontology.productHomeMetricDetails"), tasks: t("ontology.productHomeTaskResults"), drawer: t("ontology.productHomeSidePanel"), page: t("ontology.productHomeFullPage"),
  analyze: t("ontology.productHomeAnalyzeWithAssistant"), openPage: t("ontology.productHomeOpenFullPage"), intervention: t("ontology.productHomeNeedsIntervention"), finished: t("ontology.productHomeRecentlyCompleted"), density: t("ontology.productHomeDisplayDensity"), help: t("ontology.productHomeViewHelp"), configure: t("ontology.productHomeChooseResources"),
}));
async function analyze(target: WorkspaceResource, intent: "analyze" | "explain" = "analyze") {
  if (analysisBusy.value || !canChat.value) return;
  analysisBusy.value = true; analysisError.value = "";
  try {
    const agent = enabledAgents.value.find(item => item.id === agentId.value);
    if (!agent) throw new Error(t("ontology.productHomeNoEnabledAssistant"));
    const evidence = target.kind === "metric"
      ? await json("/api/dashboards/query-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dashboardId: target.dashboardId, cardId: target.cardId }) })
      : target.runId ? await json(`${platformSchedulesPath}/${target.taskId}/runs/${target.runId}`) : null;
    const session = agentHostCreateSessionResponseSchema.parse(await json("/api/assistant/sessions", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomId() }, body: JSON.stringify({ agentId: agent.id }),
    })).session;
    const message = intent === "explain"
      ? (locale.value.startsWith("zh") ? "请解释这个指标的业务含义、统计口径、实际查询参数及结果中的空值。以当前资源和查询证据为依据，缺少的说明请明确指出，不推测定义。" : "Explain this metric's business meaning, definition, saved parameters and missing values using the resource and query evidence. Explicitly identify unavailable definitions.")
      : (locale.value.startsWith("zh") ? "请分析当前指标或任务结果，以查询证据为依据解释主要发现和数据限制，并提出可继续核实的问题。区分执行状态与业务结论，不推断缺失数据。本次只分析，不执行写入。" : "Analyze this metric or task result using its evidence. Explain findings and limitations and suggest questions to verify. Distinguish run status from business conclusions; do not infer missing data or write data.");
    await json(`/api/assistant/sessions/${session.id}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomId() }, body: JSON.stringify({ message: `${message}\n${JSON.stringify({ resource: target, evidence })}` }),
    });
    resourceOpen.value = false;
    await router.push({ path: platformRoutes.chat.path, query: { agentId: agent.id, sessionId: session.id } });
  } catch (failure) { analysisError.value = failure instanceof Error ? failure.message : String(failure); }
  finally { analysisBusy.value = false; }
}
function openResource(target: WorkspaceResource) {
  resource.value = target; analysisError.value = "";
  const mode = config.value.interactions[target.kind === "metric" ? "metrics" : "tasks"];
  if (mode === "page") { void router.push(target.path); return; }
  resourceOpen.value = true;
}
function openMetric(boardId: string, card: { id: string; name: string }) {
  openResource({ kind: "metric", title: card.name, dashboardId: boardId, cardId: card.id, path: router.resolve({ path: platformRoutes.dashboards.path, query: { dashboardId: boardId } }).fullPath });
}
function openTask(task: PlatformTask) {
  const runId = task.activeRunId ?? task.lastRun?.id ?? null;
  openResource({ kind: "task", title: task.title, taskId: task.id, runId, pauseMessage: task.pause?.message,
    path: router.resolve({ path: platformRoutes.schedules.path, query: { taskId: task.id, ...(runId ? { runId } : {}) } }).fullPath });
}
const text = computed(() => ({
  title: t("ontology.productHomeTitle"), intro: t("ontology.productHomeIntro"), configure: t("ontology.productHomeConfigure"), refresh: t("ontology.productRefresh"),
  save: t("ontology.productSave"), cancel: t("ontology.productCancel"), unsaved: t("ontology.productHomeUnsaved"), layout: t("ontology.productLayoutFocus"), tasks: t("ontology.productHomeMyTasks"), data: t("ontology.productHomeFollowedData"),
  apps: t("ontology.productHomeResources"), tasksLayout: t("ontology.productLayoutTasks"), dataLayout: t("ontology.productLayoutData"), assistantLayout: t("ontology.productLayoutAssistant"),
  appsDescription: t("ontology.productHomeAppsDescription"), dataDescription: t("ontology.productHomeDataDescription"), tasksDescription: t("ontology.productHomeTasksDescription"), recentDescription: t("ontology.productHomeRecentDescription"), application: t("ontology.productApplication"), dashboard: t("ontology.productDashboard"),
  emptyTasks: t("ontology.productHomeEmptyTasks"), emptyData: t("ontology.productHomeEmptyData"), emptyApps: t("ontology.productHomeEmptyApps"),
  all: t("ontology.productHomeViewAll"), result: t("ontology.productViewResult"), running: t("ontology.productTaskRunning"), paused: t("ontology.productTaskPaused"), disabled: t("ontology.productTaskDisabled"), pending: t("ontology.productHomeTaskPending"),
  completed: t("ontology.productHomeTaskCompleted"), failed: t("ontology.productHomeTaskFailed"), skipped: t("ontology.productHomeTaskSkipped"), next: t("ontology.productHomeNextRun"), retry: t("ontology.productRetry"), loading: t("ontology.productHomeLoading"),
  chat: t("ontology.productHomeOpenAssistant"), build: t("ontology.productHomeBuildApplication"),
  unavailable: t("ontology.productHomeResourceUnavailable"), selection: t("ontology.productHomeSelectionOrder"),
  attention: t("ontology.productSourceTasks"), issues: t("ontology.productHomeNeedIntervention"), results: t("ontology.productHomeRecentResults"), runningTasks: t("ontology.productTaskRunning"), clear: t("ontology.productHomeNoInterventionTasks"), recent: t("ontology.productHomeRecentWork"), emptyRecent: t("ontology.productHomeEmptyRecent"), recentApps: t("ontology.productHomeRecentlyUsed"), pinned: t("ontology.productHomePinned"), updated: t("ontology.productVisitedAt"), noAttention: t("ontology.productHomeNoAttention"), assistantHint: t("ontology.productHomeAssistant"), assistantDescription: t("ontology.productHomeAssistantDescription"), noApps: t("ontology.productHomeNoApps"),
}));
const apps = computed(() => catalog.applications.value.filter(app => !["personal-workspace","workplace","home","application-gallery"].includes(app.id)));
const canBuild = computed(() => catalog.applications.value.some(app => app.id === "app-builder"));
const canChat = computed(() => catalog.applications.value.some(app => app.id === "agents"));
const selectedDashboards = computed(() => config.value.dashboardIds.map(id => ({ id, resource: dashboards.value.find(board => board.id === id) })));
const selectedApps = computed(() => config.value.applicationIds.map(id => ({ id, resource: apps.value.find(app => app.id === id) })));
const selectedAgents=computed(()=>config.value.agentIds.flatMap(id=>enabledAgents.value.find(agent=>agent.id===id)??[]));
function applicationHref(id: string) {
  const app=catalog.applications.value.find(app=>app.id===id);
  return router.resolve({ path: app?.kind==='native' ? app.entry.home ?? app.entry.path : `/applications/${encodeURIComponent(id)}` }).href;
}
/** Keep data on a wide working surface and activity in a compact supporting column. */
const columns = computed(() => [[],[]] as WorkspaceSection[][]);
const needsIntervention = (task: PlatformTask) => !task.activeRunId && (!!task.pause || task.lastRun?.status === "failed");
const issueTasks = computed(() => tasks.value.filter(needsIntervention));
const runningTasks = computed(() => tasks.value.filter(task => task.activeRunId));
const resultTasks = computed(() => tasks.value.filter(task => task.latestResult?.runId === task.lastRun?.id
  && !task.activeRunId && !needsIntervention(task) && task.lastRun?.status === "completed" && Date.parse(task.lastRun.finishedAt ?? "") >= Date.now() - 7 * 86400000));
const taskGroups = computed(() => [
  { id: "issues", label: interactionLabels.value.intervention, items: issueTasks.value },
  { id: "running", label: text.value.running, items: runningTasks.value },
  { id: "results", label: t("ontology.productHomeRecentResults"), items: [...resultTasks.value].sort((a, b) => (b.lastRun?.finishedAt ?? "").localeCompare(a.lastRun?.finishedAt ?? "")) },
].filter(group => group.items.length));
const availableRecent = computed(() => recent.value.filter(item => !new URL(item.path, "https://workspace.invalid").searchParams.has("sessionId") && catalog.applications.value.some(app => app.id === item.appId)));
function recentTitle(item: RecentWork) {
  const url = new URL(item.path, "https://workspace.invalid");
  const board = dashboards.value.find(board => board.id === url.searchParams.get("dashboardId"));
  const objectKey = url.searchParams.get("key");
  if (objectKey) {
    const object = config.value.pinnedObjects.find(object => object.primaryKey === objectKey && url.pathname.endsWith(encodeURIComponent(object.className)));
    if (object) return object.title;
  }
  return board?.name ?? (item.title !== catalog.applications.value.find(app => app.id === item.appId)?.names.en ? item.title : null)
    ?? catalog.applications.value.find(app => app.id === item.appId)?.names[locale.value] ?? item.title;
}
function recentContext(item: RecentWork) {
  const url = new URL(item.path, "https://workspace.invalid");
  const object = url.searchParams.get("key") ?? url.searchParams.get("primaryKey");
  const session = url.searchParams.get("sessionId");
  if (object) return t("ontology.productHomeObjectItem", { name: object });
  if (session) return t("ontology.productHomeConversationItem", { id: session.slice(0, 8) });
  return "";
}
async function json(path: string, init: globalThis.RequestInit = {}) {
  const response = await nodeApiRequest(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? body.error ?? `HTTP ${response.status}`);
  return body;
}
async function load(key: string, action: () => Promise<void>) {
  busy.value[key] = true;
  delete errors.value[key];
  try { await action(); }
  catch (error) { errors.value[key] = error instanceof Error ? error.message : String(error); }
  finally { busy.value[key] = false; }
}
const readConfig = () => load("config", async () => {
  if(props.pinnedAssets){const asset=props.pinnedAssets.find(asset=>asset.id===props.productAssetId);if(!asset||asset.document.kind!=='page')throw new Error('Pinned page unavailable');homeAsset.value=asset;await acceptPagePreferences(asset);ready.value=true;return;}
  if(props.productAssetId) {
    const asset=productAssetSchema.parse((await json(`/api/product-assets/${encodeURIComponent(props.productAssetId)}`)).asset);
    if(asset.document.kind!=='page')throw new Error('Expected a page asset');
    homeAsset.value=asset;await acceptPagePreferences(asset);
  } else {const asset=productAssetSchema.parse((await json('/api/product-assets/home')).asset);homeAsset.value=asset;await acceptPagePreferences(asset);}
  ready.value = true;
  await readPinned();
});
const readDashboards = () => load("data", async () => { dashboards.value = (await json("/api/dashboards")).data; });
const readTasks = () => load("tasks", async () => { tasks.value = platformTaskListSchema.parse(await json(platformSchedulesPath)).tasks; });
const readRecent = () => load("recent", async () => { recent.value = recentWorkListSchema.parse((await json("/api/personal-workspace/recent")).data); });
const readAgents = () => load("agents", async () => {
  agents.value = agentHostAgentListSchema.parse(await json("/api/assistant/agents")).agents;
  if (!enabledAgents.value.some(agent => agent.id === agentId.value)) agentId.value = enabledAgents.value[0]?.id ?? null;
});
const readConversations = () => load("conversations", async () => { homeState.value = homeStateSchema.parse(await json("/api/platform/home")); });
async function refresh() {
  if (refreshing.value || saving.value || editing.value) return;
  refreshing.value = true;
  try {
    previewRevision.value++;
    if(props.platformWidgetAsset){config.value=platformWidget(props.platformWidgetAsset.document)?.workspace??defaultPersonalWorkspace();ready.value=true;await Promise.all([readTasks(),readDashboards(),readRecent(),readAgents(),readConversations(),catalog.refresh()]);}
    else await Promise.all([readConfig(), readProducts(), readTasks(), readDashboards(), readRecent(), readAgents(), readConversations(), catalog.refresh()]);
  } finally { refreshing.value = false; }
}
onMounted(() => { void refresh(); });
function configure(tab: "layout" | "resources" | "opening" = "layout") {
  if (saving.value || busy.value.config || busy.value.products) return;
  delete errors.value.save;
  draft.value = { ...config.value, dashboardCards: Object.fromEntries(Object.entries(config.value.dashboardCards).map(([id, cards]) => [id, [...cards]])), interactions: { ...config.value.interactions }, dashboardIds: [...config.value.dashboardIds], applicationIds: [...config.value.applicationIds] };
  editing.value = true;
  const sections = config.value.sections ?? presetSections(config.value.layout);
  draft.value.sections = { main: [...sections.main], sidebar: [...sections.sidebar], hidden: [...sections.hidden] };
  settingsTab.value = tab;
  draftChildren.value=homeAsset.value?.document.kind==='page'?homeAsset.value.document.children.map(child=>({...child})):[];
  draftPageLayout.value=homeAsset.value?.document.kind==='page'&&homeAsset.value.document.layout?{...homeAsset.value.document.layout}:{mode:'columns',mainWidth:8,gap:'comfortable'};
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  await load("save", async () => {
    const body = homeAsset.value ? await saveComposition() : await saveConfiguration(personalWorkspaceSchema.parse(draft.value));
    acceptConfig(body);
    window.dispatchEvent(new Event(HOME_PREFERENCES_CHANGED));
    editing.value = false;
    await readProducts();
  });
  saving.value = false;
}
function taskStatus(task: PlatformTask) {
  if (task.activeRunId) return text.value.running;
  if (task.pause) return text.value.paused;
  if (!task.enabled) return text.value.disabled;
  return task.lastRun ? text.value[task.lastRun.status] : text.value.pending;
}
function date(value: string) { return new Date(value).toLocaleString(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
/** A task preview is a short sentence; full formatting and attachments belong to its result page. */
function taskSummary(value: string) {
  return value.replace(/!\[[\s\S]*$/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\n\s*\n/)[0]!.replace(/[*#`]/g, "").replace(/\s+/g, " ").trim();
}
const actions = computed(() => [
  {id:'applications',label:t('ontology.productHomeAllApplications'),icon:AppWindow,onClick:()=>void router.push('/applications')},
  { id: "refresh", label: text.value.refresh, icon: RefreshCw, disabled:refreshing.value||saving.value||editing.value, onClick: () => void refresh() },
    ...(ready.value ? [{ id: "configure", label: text.value.configure, icon: Settings2, disabled:saving.value||!!busy.value.config||!!busy.value.products, onClick: () => configure() }] : []),
]);
</script>
<template>
  <component :is="props.platformWidgetAsset||props.embedded?'div':AppPage" :class="{'platform-widget-host':props.platformWidgetAsset||props.embedded,'is-platform-widget':!!props.platformWidgetAsset}" :title="homeAsset ? productText(homeAsset.name) : text.title" :description="productText(homeAsset?.description ?? '')" :actions="actions" :labels="{ save: text.save, discard: text.cancel, unsavedChanges: text.unsaved }">
    <div v-if="errors.config" role="alert" class="workspace-error">{{ errors.config }} <el-button @click="readConfig">{{ text.retry }}</el-button></div>
    <WorkspaceSkeleton v-if="!ready && busy.config" :label="text.loading" :rows="6" />
    <el-alert v-if="analysisError" :title="analysisError" type="error" :closable="false" />
    <el-alert v-if="errors.products" :title="errors.products" type="error" :closable="false" />
    <section v-if="personalHome" class="personal-workspace-intro"><div><span class="workspace-date">{{today}}</span><h1>{{t('ontology.productHomeIntroTitle')}}</h1><p>{{t('ontology.productHomeIntroDescription')}}</p></div><div class="workspace-quick-links"><button v-if="canChat&&enabledAgents.length" @click="router.push({path:platformRoutes.chat.path,query:{agentId:agentId??undefined}})"><Sparkles :size="18"/><span>{{t('ontology.productHomeStartAnalysis')}}</span><ArrowUpRight :size="15"/></button><button @click="router.push('/applications')"><AppWindow :size="18"/><span>{{t('ontology.productHomeExploreApplications')}}</span><ArrowUpRight :size="15"/></button></div></section>
    <div v-if="ready" class="workspace-grid" :class="{ 'personal-workspace':personalHome,'tasks-first': config.layout === 'tasks','product-layout':!!pageLayout,'single-column':pageLayout?.mode==='grid'||pageLayout?.mainWidth===12 }" :style="pageGridStyle">
      <div v-for="(sections, column) in columns" :key="column" class="workspace-column" :class="{ 'activity-column': sections.includes('tasks') }">
      <div v-for="child in productChildren(column)" :key="child.id" class="product-placement" :style="{gridColumn:`span ${child.width??(child.span==='half'?6:12)}`}">
    <el-alert v-if="props.unavailableAssets?.includes(child.id)" :title="t('ontology.productAssetContractChanged',{name:child.asset?productText(child.asset.name):child.id})" type="error" :closable="false"/>
    <section v-else-if="child.section==='assistant'" class="workspace-welcome" :class="{'half-width':child.span==='half'}">
      <div class="workspace-heading"><Sparkles :size="20" aria-hidden="true" /><h1>{{ child.asset ? productText(child.asset.name) : '' }}</h1></div>
      <p v-if="child.asset?.description">{{ productText(child.asset.description) }}</p>
      <WorkspaceSkeleton v-if="busy.agents" :label="text.loading" :rows="1" composer />
      <div v-else-if="errors.agents" role="alert">{{ errors.agents }} <el-button @click="readAgents">{{ text.retry }}</el-button></div>
      <div v-else-if="canChat&&enabledAgents.length" class="workspace-ask">
         <ShellComposer :busy="false" :labels="{ placeholder: child.asset?productText(platformWidget(child.asset.document)?.placeholder??''):'', send: workspaceText.send, stop: workspaceText.stop }" @send="ask">
          <template #tools>
            <AgentPicker variant="pill" :agents="enabledAgents" :agent-id="agentId" :label="workspaceText.agent" @select="agentId = $event" />
          </template>
        </ShellComposer>
      </div>
      <p v-else>{{ workspaceText.noAgent }}</p>
    </section>
      <section v-else-if="!child.section" class="workspace-section workspace-product" :class="{'home-chart':child.span==='half','home-overview':child.asset?.document.kind==='widget-group'}"><header v-if="child.asset?.document.kind==='widget-group'||child.asset?.document.kind==='page'"><h2>{{productText(child.asset.name)}}</h2></header><PersonalWorkspaceRoute v-if="child.asset?.document.kind==='page'" embedded :product-asset-id="child.id" :pinned-assets="props.pinnedAssets" :unavailable-assets="props.unavailableAssets" :page-state="props.pageState"/><ManagerFrame v-else-if="child.asset"><ProductAssetRuntime :asset="child.asset" :page-state="props.pageState" :revision="previewRevision" @refresh="previewRevision++"/></ManagerFrame><p v-else>{{text.unavailable}}</p><p v-if="child.asset?.description" class="overview-note">{{productText(child.asset.description)}}</p></section>
      <template v-for="section in [child.section]" v-else :key="section">
      <section class="workspace-section" :class="{'half-width':child.span==='half'}" :data-section="section">
        <header><h2>{{ child.asset ? productText(child.asset.name) : '' }}</h2>
          <div v-if="section === 'apps' || section === 'data' || section === 'tasks'" class="section-actions">
            <el-button v-if="!props.platformWidgetAsset&&section === 'apps' && canBuild" text @click="router.push({ name: platformRoutes.appBuilder.name })">{{ text.build }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
            <el-button v-if="!props.platformWidgetAsset&&(section === 'apps' || section === 'data')" text :disabled="saving || refreshing" @click="configure('resources')">{{ section === 'apps' ? (t('ontology.productHomeManageApplications')) : (t('ontology.productHomeManageFollowed')) }}</el-button>
            <el-button v-if="section === 'tasks' && catalog.applications.value.some(app => app.id === 'schedules')" text @click="router.push(platformRoutes.schedules.path)">{{ text.all }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
            <el-button v-if="section === 'data' && catalog.applications.value.some(app => app.id === 'dashboards')" text @click="router.push(platformRoutes.dashboards.path)">{{ text.all }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
          </div>
        </header>
        <p v-if="child.asset?.description" class="overview-note">{{productText(child.asset.description)}}</p>
        <template v-if="section === 'objects'">
          <p v-if="errors.objectsSave" role="alert" class="workspace-error">{{ errors.objectsSave }}</p>
          <p v-if="!config.pinnedObjects.length" class="workspace-empty">{{ t('ontology.productHomePinObjectHint') }}</p>
          <article v-for="item in config.pinnedObjects.slice(0,blockLimit(child.asset))" :key="JSON.stringify([item.className, item.primaryKey])" class="workspace-item">
            <div class="resource-body"><button class="resource-link" @click="openObject(item)">{{ item.title }}</button>
            </div>
            <div class="object-row-actions">
              <el-button v-if="canChat && enabledAgents.length" size="small" :icon="Sparkles" @click="askObject(item)">{{ t('ontology.productHomeAsk') }}</el-button>
              <el-dropdown trigger="click" placement="bottom-end" :popper-options="dropdownBoundaryOptions" :disabled="saving" @command="removeObject(item)">
                <el-button class="row-icon-action" text :icon="MoreHorizontal" :disabled="saving" :aria-label="t('ontology.productHomeManageObject', { title: item.title })" :title="t('ontology.productHomeMoreActions')" />
                <template #dropdown><el-dropdown-menu><el-dropdown-item>{{ t('ontology.productUnpin') }}</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
            </div>
          </article>
        </template>
        <template v-if="section === 'conversations'">
          <p v-if="errors.pinsSave" role="alert" class="workspace-error">{{ errors.pinsSave }}</p>
          <template v-if="pinned.length">
            <h3>{{ t('ontology.productHomePinned') }}</h3>
            <WorkspaceSkeleton v-if="busy.pins" :label="text.loading" :rows="Math.min(pinned.length, 3)" />
            <article v-for="(item, index) in (busy.pins ? [] : pinned.slice(0,blockLimit(child.asset)))" :key="item.sessionId" class="workspace-item pinned-analysis">
              <div class="resource-body"><button class="resource-link" :disabled="!item.session || !enabledAgents.some(agent => agent.id === item.session?.agentId)" @click="router.push({ path: platformRoutes.chat.path, query: { agentId: item.session!.agentId, sessionId: item.sessionId } })">{{ item.title }}</button><p v-if="pinErrors[item.sessionId]">{{ pinErrors[item.sessionId] }}</p><p v-else-if="item.session && !busy.agents && !enabledAgents.some(agent => agent.id === item.session?.agentId)">{{ workspaceText.noAgent }}</p><p v-else-if="item.session">{{ date(item.session.updatedAt) }}</p>
              </div>
              <el-dropdown trigger="click" placement="bottom-end" :popper-options="dropdownBoundaryOptions" :disabled="saving" @command="(command: string) => command === 'rename' ? renamePin(item.sessionId) : command === 'up' ? movePin(index, -1) : command === 'down' ? movePin(index, 1) : updatePins(config.pinnedAnalyses.filter(pin => pin.sessionId !== item.sessionId))">
                <el-button class="row-icon-action" text :disabled="saving" :icon="MoreHorizontal" :aria-label="t('ontology.productHomeManageAnalysis', { title: item.title })" :title="t('ontology.productHomeMoreActions')" />
                <template #dropdown><el-dropdown-menu>
                  <el-dropdown-item command="rename">{{ t('ontology.productRename') }}</el-dropdown-item>
                  <el-dropdown-item command="up" :disabled="index === 0">{{ t('ontology.productMoveUp') }}</el-dropdown-item>
                  <el-dropdown-item command="down" :disabled="index === pinned.length - 1">{{ t('ontology.productHomeMoveDown') }}</el-dropdown-item>
                  <el-dropdown-item command="unpin" divided>{{ t('ontology.productHomeUnpinAnalysis') }}</el-dropdown-item>
                </el-dropdown-menu></template>
              </el-dropdown>
            </article>
          </template>
          <h3 v-if="pinned.length && conversations.length">{{ t('ontology.productHomeRecentAnalyses') }}</h3>
          <WorkspaceSkeleton v-if="busy.conversations" :label="text.loading" />
          <div v-else-if="errors.conversations" role="alert">{{ errors.conversations }} <el-button @click="readConversations">{{ text.retry }}</el-button></div>
          <p v-else-if="!conversations.length && !pinned.length" class="workspace-empty">{{ workspaceText.empty }}</p>
          <article v-for="item in conversations.slice(0,blockLimit(child.asset))" :key="item.sessionId" class="workspace-item conversation-item">
            <Sparkles :size="16" class="resource-icon" aria-hidden="true" />
            <div class="resource-body"><button class="resource-link" @click="router.push({ path: platformRoutes.chat.path, query: { agentId: item.agentId, sessionId: item.sessionId } })">{{ conversationTitle(item.title) }}</button><p>{{ enabledAgents.find(agent => agent.id === item.agentId)?.name }} · {{ date(item.updatedAt) }}</p></div>
            <el-button class="row-icon-action pin-analysis" text :icon="Pin" :title="t('ontology.productHomePinAnalysis')" :aria-label="t('ontology.productHomePinAnalysis')" :disabled="saving || config.pinnedAnalyses.length >= 20" @click="pinConversation(item)" />
          </article>
        </template>
        <template v-if="section === 'tasks'">
          <WorkspaceSkeleton v-if="busy.tasks" :label="text.loading" />
          <div v-else-if="errors.tasks" role="alert">{{ errors.tasks }} <el-button @click="readTasks">{{ text.retry }}</el-button></div>
          <template v-else>
            <div class="attention-summary" aria-live="polite">
              <span :class="{ 'has-issues': issueTasks.length }"><strong>{{ issueTasks.length }}</strong><CircleAlert v-if="issueTasks.length" :size="14" aria-hidden="true" />{{ text.issues }}</span>
              <span><strong>{{ resultTasks.length }}</strong>{{ text.results }}</span>
              <span v-if="runningTasks.length"><strong>{{ runningTasks.length }}</strong>{{ text.runningTasks }}</span>
            </div>
            <p v-if="!taskGroups.length" class="workspace-empty">{{ text.clear }}<br>{{ text.noAttention }}</p>
            <div v-for="group in taskGroups" :key="group.id" class="task-group" :data-task-group="group.id">
            <h3>{{ group.label }}</h3>
            <article v-for="task in group.items.slice(0,blockLimit(child.asset))" :key="task.id" class="workspace-item" :class="{ 'needs-intervention': needsIntervention(task) }">
              <div class="resource-body"><button class="resource-link" @click="openTask(task)">{{ task.title }}</button>
                <p v-if="group.id === 'results' && task.lastRun?.finishedAt">{{ t('ontology.productHomeGeneratedAt') }} {{ date(task.lastRun.finishedAt) }}</p>
                <p v-else><span class="task-status" :class="{ 'is-paused': !!task.pause, 'is-failed': !task.activeRunId && !task.pause && task.lastRun?.status === 'failed' }">{{ taskStatus(task) }}</span><span v-if="task.nextRunAt"> · {{ text.next }} {{ date(task.nextRunAt) }}</span></p>
                <p v-if="task.pause" class="task-summary" :title="task.pause.message">{{ task.pause.message }}</p>
                <p v-else-if="task.lastRun?.error?.message" class="task-summary" :title="task.lastRun.error.message">{{ task.lastRun.error.message }}</p>
                <p v-else-if="task.lastRun?.resultSummary" class="task-summary">{{ taskSummary(task.lastRun.resultSummary) }}</p>
              </div>
              <el-button v-if="needsIntervention(task)" size="small" type="primary" plain @click="router.push({ path: platformRoutes.schedules.path, query: { taskId: task.id } })">{{ t('ontology.productHomeResolve') }}</el-button>
            </article>
            </div>
          </template>
        </template>
        <template v-else-if="section === 'recent'">
          <WorkspaceSkeleton v-if="busy.recent" :label="text.loading" />
          <div v-else-if="errors.recent" role="alert">{{ errors.recent }} <el-button @click="readRecent">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!availableRecent.length" class="workspace-empty">{{ text.emptyRecent }}</p>
            <article v-for="item in availableRecent.slice(0,blockLimit(child.asset))" :key="item.path" class="workspace-item recent-item">
              <Clock3 :size="16" class="resource-icon" aria-hidden="true" />
              <div class="resource-body"><button class="resource-link" @click="router.push(item.path)">{{ recentTitle(item) }}</button>
                <p v-if="recentContext(item)">{{ recentContext(item) }}</p>
                <p>{{ date(item.visitedAt) }}</p>
              </div>
            </article>
          </template>
        </template>
        <template v-else-if="section === 'data'">
          <WorkspaceSkeleton v-if="busy.data" :label="text.loading" />
          <div v-else-if="errors.data" role="alert">{{ errors.data }} <el-button @click="readDashboards">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!selectedDashboards.length" class="workspace-empty">{{ text.emptyData }}</p>
            <el-button v-if="!selectedDashboards.length" :disabled="saving || refreshing" @click="configure('resources')">{{ interactionLabels.configure }}</el-button>
            <article v-for="board in selectedDashboards.slice(0,blockLimit(child.asset))" :key="board.id" class="workspace-board">
              <button v-if="board.resource" class="resource-link board-link" @click="router.push({ path: platformRoutes.dashboards.path, query: { dashboardId: board.id } })"><LayoutDashboard :size="16" aria-hidden="true" /><span>{{ board.resource.name }}</span><ArrowUpRight :size="14" aria-hidden="true" /></button>
              <p v-else>{{ text.unavailable }}</p>
              <DashboardMetricPreview v-if="board.resource" :dashboard-id="board.id" :card-ids="config.dashboardCards[board.id]" :revision="previewRevision" @select="openMetric(board.id, $event)" />
            </article>
          </template>
        </template>
        <template v-else-if="section === 'apps'">
          <WorkspaceSkeleton v-if="catalog.loading.value" :label="text.loading" :rows="2" />
          <div v-else-if="catalog.error.value" role="alert">{{ catalog.error.value }} <el-button @click="catalog.refresh">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!selectedApps.length&&!selectedAgents.length" class="workspace-empty">{{ text.emptyApps }}</p>
            <el-button v-if="!selectedApps.length&&!selectedAgents.length" :disabled="saving || refreshing" @click="configure('resources')">{{ interactionLabels.configure }}</el-button>
            <div class="application-grid">
            <article v-for="app in selectedApps.slice(0,blockLimit(child.asset))" :key="app.id" class="application-resource">
              <a v-if="app.resource" class="application-card" :href="applicationHref(app.id)" @click.prevent="openApplication(app.id)">
                 <AppWindow :size="18" class="resource-icon" aria-hidden="true" />
                <span class="resource-body"><strong>{{ app.resource.names[locale] ?? app.resource.names.en }}</strong><span>{{ app.resource.descriptions[locale] ?? app.resource.descriptions.en ?? text.application }}</span></span>
              </a>
              <p v-else>{{ text.unavailable }}</p>
            </article>
            <article v-for="agent in selectedAgents.slice(0,blockLimit(child.asset))" :key="agent.id" class="application-resource"><button class="application-card" @click="router.push({path:platformRoutes.chat.path,query:{agentId:agent.id}})"><Sparkles :size="18" class="resource-icon"/><span class="resource-body"><strong>{{agent.name}}</strong><span>{{agent.description}}</span></span></button></article>
            </div>
          </template>
        </template>
      </section>
      </template>
      </div>
      </div>
    </div>
    <el-dialog v-model="editing" :title="text.configure" width="min(740px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-position="top" :disabled="saving">
        <el-tabs v-model="settingsTab">
        <el-tab-pane name="layout" :label="t('ontology.productHomeLayoutTab')">
         <template v-if="homeAsset?.document.kind==='page'"><el-form-item :label="t('ontology.productLayoutMode')"><el-select v-model="draftPageLayout.mode"><el-option value="columns" :label="t('ontology.productMainAreaAndSidebar')"/><el-option value="grid" :label="t('ontology.productSingleGrid')"/></el-select></el-form-item><el-form-item v-if="draftPageLayout.mode==='columns'" :label="t('ontology.productMainAreaWidth')"><el-select v-model="draftPageLayout.mainWidth"><el-option :value="8" :label="t('ontology.productWidthTwoThirds')"/><el-option :value="9" :label="t('ontology.productWidthThreeQuarters')"/><el-option :value="12" :label="t('ontology.productWidthFullPage')"/></el-select></el-form-item><el-form-item :label="t('ontology.productBlockGap')"><el-select v-model="draftPageLayout.gap"><el-option value="compact" :label="t('ontology.productGapCompact')"/><el-option value="normal" :label="t('ontology.productGapNormal')"/><el-option value="comfortable" :label="t('ontology.productGapComfortable')"/></el-select></el-form-item></template>
         <el-form-item v-else :label="text.layout">
          <el-select v-model="draft.layout" @change="draft.sections = presetSections(draft.layout)"><el-option value="tasks" :label="text.tasksLayout" /><el-option value="data" :label="text.dataLayout" /><el-option value="assistant" :label="text.assistantLayout" /></el-select>
        </el-form-item>
         <p class="settings-note">{{t('ontology.productHomeLayoutNote')}}</p>
        </el-tab-pane>
        <el-tab-pane name="resources" :label="t('ontology.productHomeResourcesTab')">
        <el-button v-if="catalog.applications.value.some(app=>app.id==='ontology')" text @click="editing=false;router.push({path:platformRoutes.products.path,query:homeAsset?{id:homeAsset.id}:{}})">{{t('ontology.productHomeManageComponents')}}</el-button>
        <template v-if="homeAsset?.editable&&!props.pinnedAssets"><h3>{{t('ontology.productHomeProductComponents')}}</h3>
         <p class="settings-note">{{t('ontology.productHomeComposeHint')}}</p>
        <div v-for="(child,index) in draftChildren" :key="child.assetId" class="section-editor-row"><span>{{productText(productAssets.find(asset=>asset.id===child.assetId)?.name??text.unavailable)}}</span><el-select v-model="child.column" :aria-label="t('ontology.productComponentPlacement')"><el-option value="main" :label="t('ontology.productMainColumn')"/><el-option value="sidebar" :label="t('ontology.productSidebar')"/></el-select><el-select :model-value="child.width??(child.span==='half'?6:12)" :aria-label="t('ontology.productComponentWidth')" @update:model-value="child.width=Number($event)"><el-option v-for="width in [2,3,4,6,12]" :key="width" :value="width" :label="width===12?t('ontology.productFullRow'):t('ontology.productColumnsOf12',{width})"/></el-select><el-button :disabled="index===0" @click="draftChildren.splice(index-1,0,...draftChildren.splice(index,1))">{{t('ontology.productMoveUp')}}</el-button><el-button @click="draftChildren.splice(index,1)">{{t('ontology.productRemove')}}</el-button></div>
        <div class="resource-toolbar"><el-select v-model="addProductId" filterable :placeholder="t('ontology.productChooseAsset')" :aria-label="t('ontology.productChooseAsset')"><el-option v-for="asset in reusableProducts" :key="asset.id" :value="asset.id" :label="productText(asset.name)"/></el-select><el-button :disabled="!addProductId" @click="addProduct">{{t('ontology.productAddComponent')}}</el-button></div>
        </template><el-form-item :label="text.data">
          <el-select v-model="draft.dashboardIds" multiple filterable :disabled="busy.data || !!errors.data">
            <el-option v-for="board in dashboards" :key="board.id" :value="board.id" :label="board.name" />
            <el-option v-for="id in draft.dashboardIds.filter(id => !dashboards.some(board => board.id === id))" :key="id" :value="id" :label="text.unavailable" />
          </el-select>
        </el-form-item>
        <el-form-item v-for="id in draft.dashboardIds.filter(id => dashboards.some(board => board.id === id))" :key="id" :label="`${dashboards.find(board => board.id === id)?.name} · ${t('ontology.productHomeFollowedCards')}`">
          <DashboardCardPicker v-model="draft.dashboardCards[id]" :dashboard-id="id" />
          <el-button v-if="draft.dashboardCards[id] !== undefined" text @click="delete draft.dashboardCards[id]">{{ t('ontology.productHomeUseDefaultSelection') }}</el-button>
        </el-form-item>
        <el-form-item :label="text.apps">
          <el-select v-model="draft.applicationIds" multiple filterable :disabled="catalog.loading.value || !!catalog.error.value">
            <el-option v-for="app in apps" :key="app.id" :value="app.id" :label="app.names[locale] ?? app.names.en" />
            <el-option v-for="id in draft.applicationIds.filter(id => !apps.some(app => app.id === id))" :key="id" :value="id" :label="text.unavailable" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('ontology.productHomePinnedAgents')"><el-select v-model="draft.agentIds" multiple filterable :disabled="busy.agents||!!errors.agents"><el-option v-for="agent in enabledAgents" :key="agent.id" :value="agent.id" :label="agent.name"/></el-select></el-form-item>
        <p>{{ text.selection }}</p>
        </el-tab-pane>
        <el-tab-pane name="opening" :label="interactionLabels.title">
        <h3>{{ interactionLabels.title }}</h3>
        <p>{{ interactionLabels.help }}</p>
        <el-form-item v-for="kind in (['metrics', 'tasks'] as const)" :key="kind" :label="interactionLabels[kind]">
          <el-select v-model="draft.interactions[kind]">
            <el-option v-for="mode in (['drawer', 'page'] as const)" :key="mode" :value="mode" :label="interactionLabels[mode]" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('ontology.productSourceObjects')">
          <el-select v-model="draft.objectOpening"><el-option value="drawer" :label="interactionLabels.drawer" /><el-option value="page" :label="interactionLabels.page" /></el-select>
        </el-form-item>
        <p class="settings-note">{{ t('ontology.productHomeObjectViewNote') }}</p>
        </el-tab-pane>
        </el-tabs>
        <p v-if="errors.save" role="alert" class="workspace-error">{{ errors.save }}</p>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editing = false">{{ text.cancel }}</el-button><el-button type="primary" :loading="saving" @click="save">{{ text.save }}</el-button></template>
    </el-dialog>
    <el-drawer v-model="objectPreviewOpen" class="workspace-object-drawer" :title="objectPreview?.title" size="min(920px, 100vw)" destroy-on-close>
      <template v-if="objectPreview">
        <div class="resource-toolbar"><el-button @click="openObjectPage(objectPreview)">{{ interactionLabels.openPage }}</el-button><el-button v-if="canChat && enabledAgents.length" type="primary" @click="askObject(objectPreview)">{{ t('ontology.productHomeAskAboutObject') }}</el-button></div>
        <ManagerFrame class="workspace-preview-frame"><ObjectViewPage class="workspace-object-preview" :reference="objectPreview" preview @open="objectPreview = { ...$event, title: t('ontology.productHomeRelatedObject') }" /></ManagerFrame>
      </template>
    </el-drawer>
    <el-drawer v-model="resourceOpen" :title="resource?.title" size="min(680px, 100vw)" destroy-on-close>
      <template v-if="resource">
        <div class="resource-toolbar">
          <el-button @click="resourceOpen = false; router.push(resource.path)">{{ interactionLabels.openPage }}</el-button>
          <el-button v-if="canChat" type="primary" :disabled="!enabledAgents.length" :loading="analysisBusy" @click="analyze(resource)">{{ interactionLabels.analyze }}</el-button>
          <el-button v-if="canChat && resource.kind === 'metric'" :disabled="!enabledAgents.length" :loading="analysisBusy" @click="analyze(resource, 'explain')">{{ t('ontology.productHomeExplainMetric') }}</el-button>
        </div>
        <el-alert v-if="analysisError" :title="analysisError" type="error" :closable="false" />
        <WorkspaceResourceDetail :resource="resource" />
      </template>
    </el-drawer>
  </component>
</template>
<style scoped>
.platform-widget-host:not(.is-platform-widget)>.workspace-grid>.workspace-column{display:grid}
.workspace-column{grid-template-columns:repeat(12,minmax(0,1fr))!important}.product-placement{min-width:0}.product-placement>.workspace-section,.product-placement>.workspace-welcome{width:100%}.product-placement .workspace-welcome{margin-bottom:0}.workspace-column:empty{display:none}@container platform-page (max-width:600px){.product-placement{grid-column:1/-1!important}}
.platform-widget-host{min-width:0}.platform-widget-host>.workspace-grid{display:block}.platform-widget-host>.workspace-grid>.workspace-column{display:block;border:0;padding:0}.platform-widget-host>.workspace-grid>.workspace-column:empty{display:none}.platform-widget-host .workspace-welcome{margin:0;padding:0}.platform-widget-host .workspace-section{padding:0;border:0}
.workspace-welcome { width: 100%; padding-top: var(--spacing-sm); }
.settings-note { font-size: var(--text-sm); color: var(--el-text-color-secondary); }
:global(.workspace-object-drawer > .el-drawer__body) { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.workspace-object-drawer .resource-toolbar { flex-shrink: 0; }
.workspace-preview-frame { flex: 1; min-height: 0; height: auto; }
.workspace-preview-frame :deep(main.ontology-manager-shell) { flex: 1; min-height: 0; height: 100%; }
.workspace-object-preview { flex: 1; min-height: 0; height: 100%; overflow: auto; }
.workspace-object-preview :deep(.object-view-runtime) { padding-inline: 0; }
.section-editor { margin-top: var(--spacing-lg); }
.section-editor-row { display: flex; align-items: center; gap: var(--spacing-sm); padding-block: var(--spacing-sm); border-bottom: 1px solid var(--el-border-color-lighter); }
.section-editor-row > span { flex: 1; min-width: 0; }
.section-editor-row .el-select { width: 110px; }
.section-editor-row :deep(.el-button + .el-button) { margin-left: 0; }
.workspace-heading { display: flex; align-items: center; gap: var(--spacing-md); }
.workspace-heading > svg { color: var(--el-color-primary); flex-shrink: 0; }
.workspace-heading h1 { margin: 0; font-size: var(--text-2xl); font-weight: var(--font-semibold); line-height: 1.4; }
.workspace-welcome > p { margin: var(--spacing-sm) 0 var(--spacing-lg); font-size: var(--text-sm); }
.workspace-ask { --shell-composer-shadow: var(--elevation-composer); }
.workspace-grid { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(300px, 1fr); gap: var(--page-section-padding); align-items: start; }
.workspace-grid.product-layout{grid-template-columns:minmax(0,var(--product-main-width)) minmax(0,var(--product-side-width));gap:var(--product-gap)}
.workspace-grid.product-layout>.workspace-column{gap:var(--product-gap)}
.workspace-grid.product-layout.single-column{grid-template-columns:minmax(0,1fr)}
.conversation-item { align-items: flex-start; }
.conversation-item > svg { margin-top: 2px; }
.conversation-item .resource-link { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.object-row-actions { display: flex; align-items: center; gap: var(--spacing-xs); flex-shrink: 0; }
.resource-link:disabled { color: var(--el-text-color-secondary); cursor: default; }
.row-icon-action { flex-shrink: 0; width: var(--control-height-sm); min-height: var(--control-height-sm); padding: 0; color: var(--el-text-color-secondary); }
.row-icon-action :deep(svg) { width: 16px; height: 16px; }
.pinned-analysis { align-items: flex-start; }
.pinned-analysis > .el-dropdown { flex-shrink: 0; }
.resource-toolbar { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); margin-bottom: var(--spacing-lg); }
.resource-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.section-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--spacing-sm); }
.section-actions :deep(.el-button + .el-button) { margin-left: 0; }
.section-actions :deep(svg) { margin-left: var(--spacing-xs); }
.workspace-column { display: flex; flex-direction: column; gap: var(--spacing-xl); min-width: 0; }
.workspace-column + .workspace-column { border-left: 1px solid var(--el-border-color); padding-left: var(--page-section-padding); }
.workspace-section { min-width: 0; }
.workspace-section > :deep(.ontology-manager){height:auto;container-type:inline-size;contain:none}
.workspace-section > :deep(.ontology-manager > .ontology-manager-shell){height:auto;overflow:visible}
.workspace-section + .workspace-section { padding-top: var(--spacing-md); border-top: 1px solid var(--el-border-color-lighter); }
.workspace-section > .workspace-item:first-of-type, .task-group > .workspace-item:first-of-type { border-top: 0; padding-top: var(--spacing-xs); }
.workspace-section > .workspace-item:last-child, .task-group > .workspace-item:last-child { padding-bottom: 0; }
.workspace-section > header, .workspace-item { display: flex; justify-content: space-between; align-items: center; gap: var(--spacing-md); }
.workspace-section > header { min-height: var(--control-height); margin-bottom: var(--spacing-md); flex-wrap:wrap; }
.workspace-section > header > .el-button, .section-actions :deep(.el-button) { padding-inline: var(--spacing-sm); }
h2 { margin: 0; font-size: var(--text-base); font-weight: var(--font-semibold); line-height: 1.4; }
h3 { margin: var(--spacing-lg) 0 var(--spacing-sm); font-size: var(--text-sm); line-height: 1.5; font-weight: var(--font-semibold); color: var(--el-text-color-secondary); }
p { color: var(--el-text-color-secondary); line-height: 1.6; overflow-wrap: anywhere; }
.workspace-item { border-top: 1px solid var(--el-border-color-lighter); padding-block: var(--spacing-md); }
.workspace-item p { margin: var(--spacing-xs) 0 0; font-size: var(--text-sm); }
.workspace-item .resource-link { font-weight: var(--font-medium); }
.workspace-item .resource-body > p:first-of-type { font-size: var(--text-xs); line-height: 1.5; }
.task-summary { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.resource-body { flex: 1; min-width: 0; }
.resource-icon { flex-shrink: 0; color: var(--el-text-color-secondary); }
.application-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-md); }
.application-card { box-sizing: border-box; text-decoration: none; width: 100%; height: 100%; display: flex; align-items: flex-start; gap: var(--spacing-md); padding: var(--spacing-lg); border: 1px solid var(--el-border-color); border-radius: var(--radius-md); color: var(--el-text-color-primary); font: inherit; text-align: left; cursor: pointer; }
.application-card:hover { background: var(--el-fill-color-light); border-color: var(--el-border-color-dark); }
.application-card:focus-visible, .resource-link:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.application-card .resource-body { display: flex; flex-direction: column; gap: var(--spacing-xs); overflow-wrap: anywhere; }
.application-card strong { font-weight: var(--font-semibold); font-size: var(--text-sm); line-height: 20px; }
.application-card .resource-body > span { color: var(--el-text-color-secondary); font-size: var(--text-sm); line-height: 20px; }
.application-card > svg { margin-top: 1px; flex-shrink: 0; }
.board-link { display: flex; align-items: center; gap: var(--spacing-sm); width: 100%; color: var(--el-text-color-primary); }
.board-link > span { flex: 1; }
.workspace-board { padding: 0; }
.workspace-board + .workspace-board { margin-top: var(--spacing-xl); border-top: 1px solid var(--el-border-color); padding-top: var(--spacing-lg); }
.workspace-board > .resource-link { font-weight: var(--font-medium); min-height: var(--control-height); margin-bottom: var(--spacing-sm); }
.attention-summary { display: flex; flex-wrap: wrap; gap: var(--spacing-lg); padding-block: var(--spacing-xs) var(--spacing-md); border-bottom: 1px solid var(--el-border-color-lighter); margin-bottom: var(--spacing-md); }
.attention-summary > span { display: flex; align-items: baseline; gap: var(--spacing-xs); color: var(--el-text-color-secondary); font-size: var(--text-xs); }
.attention-summary strong { font-size: var(--text-xl); line-height: 1.4; color: var(--el-text-color-primary); font-variant-numeric: tabular-nums; }
.attention-summary .has-issues svg { color: var(--el-color-warning); align-self: center; flex-shrink: 0; }
.task-status.is-paused, .task-status.is-failed { display: inline-flex; align-items: center; gap: var(--spacing-xs); }
.task-status.is-paused::before, .task-status.is-failed::before { content: ""; width: 6px; height: 6px; border-radius: var(--radius-full); background: var(--el-color-warning); }
.task-status.is-failed { color: var(--el-color-danger); }
.task-status.is-failed::before { background: var(--el-color-danger); }
.resource-meta { color: var(--el-text-color-secondary); font-size: var(--text-sm); }
.resource-link { border: 0; padding: 0; background: transparent; color: var(--el-text-color-primary); font: inherit; font-size: var(--text-sm); line-height: 20px; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.resource-link:hover { color: var(--brand-link, var(--el-color-primary)); text-decoration: underline; }
.workspace-empty { font-size: var(--text-sm); padding-block: var(--spacing-md); }
.execution-note { margin: 0 0 var(--spacing-md); font-size: var(--text-xs); line-height: 1.5; }
.task-group + .task-group { margin-top: var(--spacing-xl); }
.task-group > h3 { margin-top: 0; }
.recent-item { align-items: flex-start; }
.recent-item .resource-icon { margin-top: 2px; }
.activity-column .workspace-item { align-items: flex-start; }
.activity-column .workspace-item > .el-button { margin-top: 0; flex-shrink: 0; }
.workspace-error { color: var(--el-color-danger); }
.el-select { width: 100%; }
@container platform-page (max-width: 1050px) { .workspace-grid { grid-template-columns: minmax(0, 1fr); } .workspace-column + .workspace-column { border-left: 0; padding-left: 0; padding-top: var(--spacing-xl); border-top: 1px solid var(--el-border-color); } }
@container platform-page (max-width: 600px) { .application-grid { grid-template-columns: minmax(0, 1fr); } .workspace-heading h1 { font-size: var(--text-title); } }

/* The question entry is shared by both columns; content starts on one baseline. */
.workspace-welcome{margin-bottom:var(--page-content-gap);max-width:100%;min-width:0}
.workspace-heading h1{font-size:var(--text-title);line-height:1.4}
.workspace-welcome>p{margin:var(--spacing-xs) 0 var(--spacing-lg)}
.workspace-grid{grid-template-columns:minmax(0,2fr) minmax(280px,1fr)}
.workspace-column{gap:var(--page-content-gap)}
.workspace-section+.workspace-section{padding-top:0;border-top:0}
.workspace-section:not(.workspace-product){padding-top:var(--spacing-lg);border-top:1px solid var(--el-border-color-light)}
.workspace-column>.workspace-section:first-child:not(.workspace-product){padding-top:0;border-top:0}
.workspace-section>header{gap:var(--spacing-sm)}
.section-actions{gap:var(--spacing-xs)}
.application-card{min-height:88px;background:var(--el-bg-color);padding:var(--spacing-lg);gap:var(--spacing-sm)}
.application-card .resource-body>span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.workspace-empty{margin:0;padding-block:var(--spacing-sm)}
.workspace-product :deep(.view-grid){gap:var(--manager-content-gap)}
.workspace-column:nth-child(2) .object-row-actions{gap:var(--spacing-xs)}
@container platform-page (max-width:1000px){.workspace-grid{grid-template-columns:minmax(0,1fr)}.workspace-column+.workspace-column{border-inline-start:0;padding-inline-start:0;padding-top:var(--page-content-gap);border-top:1px solid var(--el-border-color)}}
/* Overview figures share a baseline; charts remain secondary to daily entry points. */
.home-overview{margin-bottom:var(--page-content-gap);min-width:0;flex-shrink:0}
.home-overview>header{display:flex;align-items:center;justify-content:space-between;gap:var(--spacing-md);margin-bottom:var(--spacing-md);flex-wrap:wrap}
.home-overview>header>span{font-size:var(--text-xs);color:var(--el-text-color-secondary)}
.home-overview>:deep(.ontology-manager),.home-overview>:deep(.ontology-manager>.ontology-manager-shell){height:auto;min-height:0;overflow:visible;contain:none;container-type:inline-size;flex:none}
.home-overview :deep(.object-view-runtime){height:auto;min-height:0}
.home-overview :deep(.widget-card){padding:var(--spacing-lg);border-color:var(--el-border-color-light)}
.home-overview :deep(.widget-card h4){font-size:var(--text-xs);font-weight:var(--font-medium);color:var(--el-text-color-secondary);margin-bottom:var(--spacing-sm)}
.home-overview :deep(.metric){font-size:var(--text-2xl);line-height:1.3;font-weight:var(--font-semibold);font-variant-numeric:tabular-nums}
.home-overview :deep(.view-grid){display:flex;flex-wrap:wrap}.home-overview :deep(.widget-card){flex:1 1 150px;width:auto;min-width:0}.overview-note{font-size:var(--text-xs);margin:var(--spacing-sm) 0 0}
.workspace-grid{grid-template-columns:minmax(0,2.2fr) minmax(300px,1fr);gap:var(--page-section-padding)}
.workspace-grid,.workspace-welcome{flex-shrink:0}
.workspace-column{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--spacing-lg)}
.workspace-column>.workspace-section,.workspace-column>.workspace-welcome{grid-column:1/-1}
.workspace-column>.home-chart,.workspace-column>.half-width{grid-column:auto}
.workspace-column>.home-overview{margin-bottom:0}
.workspace-column+.workspace-column{padding-inline-start:var(--spacing-xl)}
.workspace-column>[data-section='apps']{border-top:0;padding-top:0}
.workspace-product :deep(.widget-card){border-color:var(--el-border-color-light);padding:var(--spacing-lg)}
.workspace-product :deep(.widget-card h4){font-size:var(--text-sm);margin-bottom:var(--spacing-sm)}
.workspace-column:nth-child(2) .workspace-item{padding-block:var(--spacing-md)}
.workspace-welcome{padding:var(--spacing-sm) 0 0;box-sizing:border-box;margin-bottom:var(--spacing-sm)}
.workspace-heading h1{font-size:var(--text-2xl)}
.workspace-column:nth-child(2)>.workspace-section:first-child{padding-top:var(--spacing-sm)}
@container platform-page (max-width:1050px){.workspace-grid,.workspace-grid.product-layout{grid-template-columns:minmax(0,1fr)}.workspace-column+.workspace-column{padding-inline-start:0}.home-overview :deep(.widget-card){grid-column:span 4!important}}
@container platform-page (max-width:600px){.workspace-column:first-child{grid-template-columns:minmax(0,1fr)}.workspace-column:first-child>.home-chart{grid-column:1/-1}.home-overview :deep(.widget-card){grid-column:span 6!important}.home-overview :deep(.view-grid){gap:var(--spacing-sm)}.home-overview :deep(.widget-card){padding:var(--spacing-md);flex-basis:120px}}
</style>
<style scoped>
.personal-workspace-intro{display:flex;align-items:center;justify-content:space-between;gap:24px;margin:0 0 28px;padding:24px;background:linear-gradient(120deg,var(--el-fill-color-light),var(--el-bg-color));border:1px solid var(--el-border-color-light);border-radius:12px;flex-shrink:0}
.workspace-date{font-size:var(--text-xs);color:var(--el-text-color-secondary)}.personal-workspace-intro h1{font-size:24px;line-height:1.4;margin:8px 0;font-weight:600}.personal-workspace-intro p{margin:0;font-size:var(--text-sm)}
.workspace-quick-links{display:flex;flex-direction:column;gap:10px;min-width:210px}.workspace-quick-links button{display:flex;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--el-border-color-light);border-radius:8px;background:var(--el-bg-color);color:var(--el-text-color-primary);font:inherit;font-size:var(--text-sm);cursor:pointer}.workspace-quick-links button span{flex:1;text-align:start}.workspace-quick-links button:hover{border-color:var(--el-color-primary);color:var(--el-color-primary)}
.workspace-grid.personal-workspace{gap:24px}.personal-workspace .workspace-column{display:flex;flex-direction:column;gap:20px}.personal-workspace .workspace-column+.workspace-column{border:0;padding:0}.personal-workspace .workspace-product{padding:20px;border:1px solid var(--el-border-color-light);border-radius:10px;background:var(--el-bg-color)}.personal-workspace .product-placement{min-width:0}.personal-workspace :deep(.collection-projection>h3){font-size:15px;margin-bottom:8px}.personal-workspace :deep(.overview-note){display:none}
@container platform-page (max-width:760px){.personal-workspace-intro{align-items:stretch;flex-direction:column;padding:20px}.personal-workspace-intro h1{font-size:21px}.workspace-quick-links{min-width:0}.workspace-grid.personal-workspace{grid-template-columns:minmax(0,1fr)}.personal-workspace .workspace-product{padding:16px}}
</style>
