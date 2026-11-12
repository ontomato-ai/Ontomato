<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { randomId } from "@ontomato/contracts/random-id";
import { productAssetSchema, type ProductAsset } from "@ontomato/contracts/product-assets";
import { AgentPicker, ShellComposer } from "@ontomato/agent-shell-ui";
import { ElMessageBox } from "element-plus";
import { readRememberedAgent } from "@ontomato/workbench-ui";
import { homeStateSchema, type HomeState } from "@ontomato/contracts/platform-home";
import type { WorkspaceObjectReference } from "@ontomato/contracts/workspace-objects";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { nodeApiRequest } from "@ontomato/workbench-ui";
import { defaultPersonalWorkspace, personalWorkspaceSchema, recentWorkListSchema, type RecentWork, type WorkspaceSection } from "@ontomato/contracts/personal-workspace";
import { ManagerFrame, ObjectViewPage, ProductAssetRuntime } from "@ontomato/ontology-manager";
import { DashboardCardPicker, DashboardMetricPreview } from "@ontomato/workbench-ui/features/dashboard";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import { platformSchedulesPath, platformTaskListSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "../catalog";
import AppPage from "./AppPage.vue";
import WorkspaceSkeleton from "./WorkspaceSkeleton.vue";
import { AppWindow, ArrowUpRight, CircleAlert, Clock3, LayoutDashboard, MoreHorizontal, Pin, RefreshCw, Settings2, Sparkles } from "lucide-vue-next";
import WorkspaceResourceDetail, { type WorkspaceResource } from "./WorkspaceResourceDetail.vue";
import { agentHostAgentListSchema, agentHostCreateSessionResponseSchema, agentHostSessionSnapshotSchema, type AgentHostAgent, type AgentHostSession } from "@ontomato/contracts/agent-host";
const { locale } = useI18n();
const props=defineProps<{productAssetId?:string}>();
const router = useRouter();
const catalog = useApplicationCatalog();
const config = ref(defaultPersonalWorkspace());
const homeAsset = ref<ProductAsset | null>(null);
const productAssets = ref<ProductAsset[]>([]);
const configRevision = ref<number>();
function acceptConfig(body: {data:unknown;revision?:number}) {
  config.value=personalWorkspaceSchema.parse(body.data);configRevision.value=body.revision;
}
async function saveConfiguration(workspace:unknown) {
  if(props.productAssetId && homeAsset.value?.document.kind==='page') {
    const current=homeAsset.value;
    const saved=productAssetSchema.parse((await json(`/api/product-assets/${encodeURIComponent(current.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:current.name,description:current.description,visibility:current.visibility,revision:configRevision.value,document:{...current.document,workspace}})})).asset);
    homeAsset.value=saved;
    return {data:saved.document.kind==='page'?saved.document.workspace:workspace,revision:saved.revision};
  }
  return json('/api/personal-workspace',{method:'PUT',headers:configurationHeaders(),body:JSON.stringify(workspace)});
}
const configurationHeaders = () => ({"Content-Type":"application/json",...(configRevision.value ? {"If-Match":String(configRevision.value)} : {})});
async function readProducts() {
  await load("products",async()=>{
    const home=await json(props.productAssetId?`/api/product-assets/${encodeURIComponent(props.productAssetId)}`:"/api/product-assets/home");homeAsset.value=productAssetSchema.parse(home.asset);
    productAssets.value=(await json("/api/product-assets")).assets.map((asset:unknown)=>productAssetSchema.parse(asset));
  });
}
const productChildren = (column:number) => homeAsset.value?.document.kind === "page"
  ? homeAsset.value.document.children.filter(child=>child.column===(column===0?"main":"sidebar")).map(child=>({id:child.assetId,asset:productAssets.value.find(asset=>asset.id===child.assetId)})) : [];
const draft = ref(defaultPersonalWorkspace());
const draftChildren=ref<Array<{assetId:string;column:'main'|'sidebar'}>>([]);
const addProductId=ref('');
const reusableProducts=computed(()=>productAssets.value.filter(asset=>['widget','widget-group','operation-panel','dashboard','object-view'].includes(asset.document.kind)));
function addProduct(){if(addProductId.value&&!draftChildren.value.some(child=>child.assetId===addProductId.value))draftChildren.value.push({assetId:addProductId.value,column:'main'});}
async function saveComposition(){
  if(!homeAsset.value || homeAsset.value.document.kind!=='page')throw new Error('Page unavailable');
  const current=homeAsset.value;
  const response=await json(`/api/product-assets/${encodeURIComponent(current.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:current.name,description:current.description,visibility:current.visibility,revision:configRevision.value,document:{...current.document,workspace:personalWorkspaceSchema.parse(draft.value),children:draftChildren.value}})});
  const saved=productAssetSchema.parse(response.asset);homeAsset.value=saved;
  return {data:saved.document.kind==='page'?saved.document.workspace:draft.value,revision:saved.revision};
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
function sectionName(section: WorkspaceSection) {
  return ({ apps: workspaceText.value.resources, data: text.value.data, conversations: workspaceText.value.continue,
    objects: locale.value.startsWith("zh") ? "收藏的对象" : "Pinned objects", tasks: text.value.attention, recent: workspaceText.value.recent })[section];
}
function presetSections(layout: string): { main: WorkspaceSection[]; sidebar: WorkspaceSection[]; hidden: WorkspaceSection[] } {
  return layout === "tasks" ? { main: ["tasks", "data"], sidebar: ["conversations", "objects", "apps", "recent"], hidden: [] }
    : { main: layout === "data" ? ["data", "apps"] : ["apps", "data"], sidebar: ["conversations", "objects", "tasks", "recent"], hidden: [] };
}
function moveSection(section: WorkspaceSection, destination: "main" | "sidebar" | "hidden") {
  const sections = draft.value.sections!;
  for (const key of ["main", "sidebar", "hidden"] as const) sections[key] = sections[key].filter(item => item !== section);
  sections[destination].push(section);
}
function orderSection(column: "main" | "sidebar" | "hidden", index: number, offset: number) {
  const items = draft.value.sections![column]; const [item] = items.splice(index, 1); items.splice(index + offset, 0, item!);
}
const agents = ref<AgentHostAgent[]>([]);
const agentId = ref<string | null>(readRememberedAgent());
const homeState = ref<HomeState | null>(null);
const pinnedSessions = ref<Record<string, AgentHostSession>>({});
const pinErrors = ref<Record<string, string>>({});
const pinned = computed(() => config.value.pinnedAnalyses.map(item => ({ ...item, session: pinnedSessions.value[item.sessionId] })));
let pinReadRevision = 0;
const enabledAgents = computed(() => agents.value.filter(agent => agent.enabled));
const conversations = computed(() => (homeState.value?.recentConversations ?? []).filter(item => enabledAgents.value.some(agent => agent.id === item.agentId) && !config.value.pinnedAnalyses.some(pin => pin.sessionId === item.sessionId)).slice(0, 4));
async function readPinned() {
  const revision = ++pinReadRevision;
  await load("pins", async () => {
    const sessions: Record<string, AgentHostSession> = {}, failures: Record<string, string> = {};
    await Promise.all(config.value.pinnedAnalyses.map(async item => {
      try { sessions[item.sessionId] = agentHostSessionSnapshotSchema.parse(await json(`/api/assistant/sessions/${item.sessionId}`)).session; }
      catch { failures[item.sessionId] = locale.value.startsWith("zh") ? "会话暂不可访问" : "Conversation unavailable"; }
    }));
    if (revision === pinReadRevision) { pinnedSessions.value = sessions; pinErrors.value = failures; }
  });
}
async function updatePins(next: typeof config.value.pinnedAnalyses) {
  if (saving.value || editing.value || refreshing.value || homeAsset.value?.editable===false) return;
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
    const result = await ElMessageBox.prompt(locale.value.startsWith("zh") ? "仅修改工作台中的名称" : "Change the name in this workspace only", locale.value.startsWith("zh") ? "重命名分析" : "Rename analysis", {
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
  if (saving.value || editing.value || refreshing.value || homeAsset.value?.editable===false) return;
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
const workspaceText = computed(() => locale.value.startsWith("zh") ? {
  heading: "你想了解哪些数据？", description: "用日常语言提问，让智能体帮你查询和分析", placeholder: "例如：按学院统计在职教职工人数，并比较人员构成", send: "发送问题", stop: "停止", agent: "智能体", continue: "继续分析", empty: "完成一次分析后，可从这里继续", untitled: "未命名分析", resources: "常用应用", noAgent: "暂无可用智能体，请检查智能体配置", recent: "最近访问",
} : { heading: "What would you like to know?", description: "Ask in your own words to explore and analyze your data", placeholder: "For example: Compare active staff counts and composition by school", send: "Send question", stop: "Stop", agent: "Agent", continue: "Continue analysis", empty: "Return here after completing an analysis", untitled: "Untitled analysis", resources: "Applications", noAgent: "No enabled agents. Check agent configuration.", recent: "Recent resources" });
async function ask(question: string) {
  if (!agentId.value || !enabledAgents.value.some(agent => agent.id === agentId.value)) return;
  await router.push({ path: platformRoutes.chat.path, query: { agentId: agentId.value, prompt: question } });
}
const interactionLabels = computed(() => locale.value.startsWith("zh") ? {
  title: "默认查看方式", metrics: "指标详情", tasks: "任务结果", drawer: "侧栏", page: "完整页面",
  analyze: "交给助手分析", openPage: "在完整页面打开", intervention: "需要处理", finished: "最近完成", density: "展示密度", help: "点击资源标题时查看内容；需要分析时，使用独立的提问或分析按钮", configure: "选择资源",
} : { title: "Default view", metrics: "Metric details", tasks: "Task results", drawer: "Side panel", page: "Full page",
  analyze: "Analyze with assistant", openPage: "Open full page", intervention: "Needs intervention", finished: "Recently completed", density: "Display density", help: "Resource titles open content. Use the separate question or analysis actions to start an analysis.", configure: "Choose resources" });
async function analyze(target: WorkspaceResource, intent: "analyze" | "explain" = "analyze") {
  if (analysisBusy.value || !canChat.value) return;
  analysisBusy.value = true; analysisError.value = "";
  try {
    const agent = enabledAgents.value.find(item => item.id === agentId.value);
    if (!agent) throw new Error(locale.value.startsWith("zh") ? "没有可用的智能体" : "No enabled assistant available");
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
const text = computed(() => locale.value.startsWith("zh") ? {
  title: "我的主页", intro: "问数、关注数据，继续日常工作", configure: "配置主页", refresh: "刷新",
  save: "保存", cancel: "取消", unsaved: "有未保存的修改", layout: "布局重点", tasks: "我的定时任务", data: "关注的数据",
  apps: "常用应用", tasksLayout: "任务优先", dataLayout: "数据优先", assistantLayout: "应用优先",
  appsDescription: "固定工作中常用的应用，快速进入业务流程", dataDescription: "集中查看关注的仪表盘与关键指标", tasksDescription: "查看需要介入的任务和最近的执行结果", recentDescription: "回到最近打开的应用、会话与数据", application: "应用", dashboard: "仪表盘",
  emptyTasks: "暂无定时任务", emptyData: "在配置中选择要关注的仪表盘", emptyApps: "在配置中固定常用应用",
  all: "查看全部", result: "查看结果", running: "运行中", paused: "已暂停", disabled: "已停用", pending: "等待执行",
  completed: "执行完成", failed: "执行失败", skipped: "已跳过", next: "下次执行", retry: "重试", loading: "加载中…",
  chat: "打开智能助手", build: "构建应用",
  unavailable: "资源已删除或当前不可访问，请在配置中重新选择。", selection: "按选择顺序展示，可取消后重新选择来调整顺序。",
  attention: "任务动态", issues: "需介入", results: "近期结果", runningTasks: "运行中", clear: "当前没有需要介入的定时任务", recent: "最近访问", emptyRecent: "打开应用、仪表盘或分析会话后，可从这里继续", recentApps: "最近使用", pinned: "已固定", updated: "最近访问", noAttention: "异常任务和最近 7 天的结果会显示在这里", assistantHint: "智能助手", assistantDescription: "通过对话查询数据、分析问题", noApps: "暂无可用的常用应用",
} : {
  title: "Personal workspace", intro: "Ask questions, follow data and continue your work", configure: "Configure workspace", refresh: "Refresh",
  save: "Save", cancel: "Cancel", unsaved: "Unsaved changes", layout: "Layout focus", tasks: "My scheduled tasks", data: "Followed data",
  apps: "Applications", tasksLayout: "Tasks first", dataLayout: "Data first", assistantLayout: "Applications first",
  appsDescription: "Keep the applications you use for your daily workflows close", dataDescription: "Follow dashboards and their key metrics in one place", tasksDescription: "Review task issues and recent execution results", recentDescription: "Return to recently opened applications, conversations and data", application: "Application", dashboard: "Dashboard",
  emptyTasks: "No scheduled tasks yet", emptyData: "Select dashboards in workspace settings", emptyApps: "Pin applications in workspace settings",
  all: "View all", result: "View result", running: "Running", paused: "Paused", disabled: "Disabled", pending: "Waiting",
  completed: "Completed", failed: "Failed", skipped: "Skipped", next: "Next run", retry: "Retry", loading: "Loading…",
  chat: "Open assistant", build: "Build application",
  unavailable: "This resource was removed or is unavailable. Choose a replacement in settings.", selection: "Items appear in selection order. Deselect and select again to reorder.",
  attention: "Task activity", issues: "Need intervention", results: "Recent results", runningTasks: "Running", clear: "No scheduled tasks need intervention", recent: "Recent work", emptyRecent: "Open an application, dashboard or analysis conversation to resume it here", recentApps: "Recently used", pinned: "Pinned", updated: "Last visited", noAttention: "Task issues and results from the last 7 days appear here", assistantHint: "Assistant", assistantDescription: "Query data and investigate questions in a conversation", noApps: "No frequently used applications yet",
});
const apps = computed(() => catalog.applications.value.filter(app => app.id !== "personal-workspace" && app.id !== "home"));
const canBuild = computed(() => catalog.applications.value.some(app => app.id === "app-builder"));
const canChat = computed(() => catalog.applications.value.some(app => app.id === "agents"));
const selectedDashboards = computed(() => config.value.dashboardIds.map(id => ({ id, resource: dashboards.value.find(board => board.id === id) })));
const selectedApps = computed(() => config.value.applicationIds.map(id => ({ id, resource: apps.value.find(app => app.id === id) })));
function applicationHref(id: string) {
  const app=catalog.applications.value.find(app=>app.id===id);
  return router.resolve({ path: app?.kind==='native' ? app.entry.home ?? app.entry.path : `/applications/${encodeURIComponent(id)}` }).href;
}
/** Keep data on a wide working surface and activity in a compact supporting column. */
const columns = computed(() => {
  const sections = config.value.sections ?? presetSections(config.value.layout);
  return [sections.main, sections.sidebar];
});
const needsIntervention = (task: PlatformTask) => !task.activeRunId && (!!task.pause || task.lastRun?.status === "failed");
const issueTasks = computed(() => tasks.value.filter(needsIntervention));
const runningTasks = computed(() => tasks.value.filter(task => task.activeRunId));
const resultTasks = computed(() => tasks.value.filter(task => task.latestResult?.runId === task.lastRun?.id
  && !task.activeRunId && !needsIntervention(task) && task.lastRun?.status === "completed" && Date.parse(task.lastRun.finishedAt ?? "") >= Date.now() - 7 * 86400000));
const taskGroups = computed(() => [
  { id: "issues", label: interactionLabels.value.intervention, items: issueTasks.value.slice(0, 3) },
  { id: "running", label: text.value.running, items: runningTasks.value.slice(0, 2) },
  { id: "results", label: locale.value.startsWith("zh") ? "近期结果" : "Recent results", items: [...resultTasks.value].sort((a, b) => (b.lastRun?.finishedAt ?? "").localeCompare(a.lastRun?.finishedAt ?? "")).slice(0, 3) },
].filter(group => group.items.length));
const availableRecent = computed(() => recent.value.filter(item => !new URL(item.path, "https://workspace.invalid").searchParams.has("sessionId") && catalog.applications.value.some(app => app.id === item.appId)));
const recentApps = computed(() => [...new Set(availableRecent.value.map(item => item.appId))].map(id => apps.value.find(app => app.id === id)).filter((app): app is typeof apps.value[number] => !!app && !config.value.applicationIds.includes(app.id)).slice(0, 4));
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
  if (object) return `${locale.value.startsWith("zh") ? "对象" : "Object"} · ${object}`;
  if (session) return `${locale.value.startsWith("zh") ? "会话" : "Conversation"} · ${session.slice(0, 8)}`;
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
  if(props.productAssetId) {
    const asset=productAssetSchema.parse((await json(`/api/product-assets/${encodeURIComponent(props.productAssetId)}`)).asset);
    if(asset.document.kind!=='page')throw new Error('Expected a page asset');
    homeAsset.value=asset;acceptConfig({data:asset.document.workspace,revision:asset.revision});
  } else acceptConfig(await json("/api/personal-workspace"));
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
    await Promise.all([readConfig(), readProducts(), readTasks(), readDashboards(), readRecent(), readAgents(), readConversations(), catalog.refresh()]);
  } finally { refreshing.value = false; }
}
onMounted(() => { void refresh(); });
function configure(tab: "layout" | "resources" | "opening" = "layout") {
  if (saving.value || busy.value.config || busy.value.products || homeAsset.value?.editable===false) return;
  delete errors.value.save;
  draft.value = { ...config.value, dashboardCards: Object.fromEntries(Object.entries(config.value.dashboardCards).map(([id, cards]) => [id, [...cards]])), interactions: { ...config.value.interactions }, dashboardIds: [...config.value.dashboardIds], applicationIds: [...config.value.applicationIds] };
  editing.value = true;
  const sections = config.value.sections ?? presetSections(config.value.layout);
  draft.value.sections = { main: [...sections.main], sidebar: [...sections.sidebar], hidden: [...sections.hidden] };
  settingsTab.value = tab;
  draftChildren.value=homeAsset.value?.document.kind==='page'?homeAsset.value.document.children.map(child=>({...child})):[];
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  await load("save", async () => {
    const body = homeAsset.value ? await saveComposition() : await saveConfiguration(personalWorkspaceSchema.parse(draft.value));
    acceptConfig(body);
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
  {id:'applications',label:locale.value.startsWith('zh')?'全部应用':'All applications',icon:AppWindow,onClick:()=>void router.push('/applications')},
  { id: "refresh", label: text.value.refresh, icon: RefreshCw, disabled:refreshing.value||saving.value||editing.value, onClick: () => void refresh() },
    ...(ready.value && homeAsset.value?.editable!==false ? [{ id: "configure", label: text.value.configure, icon: Settings2, disabled:saving.value||!!busy.value.config||!!busy.value.products, onClick: () => configure() }] : []),
]);
</script>
<template>
  <AppPage :title="props.productAssetId?homeAsset?.name ?? text.title:text.title" :description="text.intro" :actions="actions" :labels="{ save: text.save, discard: text.cancel, unsavedChanges: text.unsaved }">
    <div v-if="errors.config" role="alert" class="workspace-error">{{ errors.config }} <el-button @click="readConfig">{{ text.retry }}</el-button></div>
    <WorkspaceSkeleton v-if="!ready && busy.config" :label="text.loading" :rows="6" />
    <el-alert v-if="analysisError" :title="analysisError" type="error" :closable="false" />
    <el-alert v-if="errors.products" :title="errors.products" type="error" :closable="false" />
    <div v-if="ready" class="workspace-grid" :class="{ 'tasks-first': config.layout === 'tasks' }">
      <div v-for="(sections, column) in columns" :key="column" class="workspace-column" :class="{ 'activity-column': sections.includes('tasks') }">
    <section v-if="column === 0 && canChat" class="workspace-welcome">
      <div class="workspace-heading"><Sparkles :size="20" aria-hidden="true" /><h1>{{ workspaceText.heading }}</h1></div>
      <p>{{ workspaceText.description }}</p>
      <WorkspaceSkeleton v-if="busy.agents" :label="text.loading" :rows="1" composer />
      <div v-else-if="errors.agents" role="alert">{{ errors.agents }} <el-button @click="readAgents">{{ text.retry }}</el-button></div>
      <div v-else-if="enabledAgents.length" class="workspace-ask">
        <ShellComposer :busy="false" :labels="{ placeholder: workspaceText.placeholder, send: workspaceText.send, stop: workspaceText.stop }" @send="ask">
          <template #tools>
            <AgentPicker variant="pill" :agents="enabledAgents" :agent-id="agentId" :label="workspaceText.agent" @select="agentId = $event" />
          </template>
        </ShellComposer>
      </div>
      <p v-else>{{ workspaceText.noAgent }}</p>
    </section>
      <section v-for="child in productChildren(column)" :key="child.id" class="workspace-section"><ManagerFrame v-if="child.asset"><ProductAssetRuntime :asset="child.asset" :revision="previewRevision" @refresh="previewRevision++"/></ManagerFrame><p v-else>{{text.unavailable}}</p></section>
      <section v-for="section in sections" :key="section" class="workspace-section" :data-section="section">
        <header><h2>{{ section === 'objects' ? (locale.startsWith('zh') ? '收藏的对象' : 'Pinned objects') : section === 'conversations' ? workspaceText.continue : section === 'apps' ? workspaceText.resources : section === 'recent' ? workspaceText.recent : section === 'tasks' ? text.attention : text.data }}</h2>
          <div v-if="section === 'apps' || section === 'data' || section === 'tasks'" class="section-actions">
            <el-button v-if="section === 'apps' && canBuild" text @click="router.push({ name: platformRoutes.appBuilder.name })">{{ text.build }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
            <el-button v-if="section === 'apps' || section === 'data'" text :disabled="saving || refreshing" @click="configure('resources')">{{ section === 'apps' ? (locale.startsWith('zh') ? '管理应用' : 'Manage applications') : (locale.startsWith('zh') ? '管理关注' : 'Manage followed data') }}</el-button>
            <el-button v-if="section === 'tasks' && catalog.applications.value.some(app => app.id === 'schedules')" text @click="router.push(platformRoutes.schedules.path)">{{ text.all }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
            <el-button v-if="section === 'data' && catalog.applications.value.some(app => app.id === 'dashboards')" text @click="router.push(platformRoutes.dashboards.path)">{{ text.all }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
          </div>
        </header>
        <template v-if="section === 'objects'">
          <p v-if="errors.objectsSave" role="alert" class="workspace-error">{{ errors.objectsSave }}</p>
          <p v-if="!config.pinnedObjects.length" class="workspace-empty">{{ locale.startsWith('zh') ? '在对象详情中收藏教职工、机构或成果，可从这里快速返回' : 'Pin a person, organization or result from its object view to return here' }}</p>
          <article v-for="item in config.pinnedObjects" :key="JSON.stringify([item.className, item.primaryKey])" class="workspace-item">
            <div class="resource-body"><button class="resource-link" @click="openObject(item)">{{ item.title }}</button>
            </div>
            <div class="object-row-actions">
              <el-button v-if="canChat && enabledAgents.length" size="small" :icon="Sparkles" @click="askObject(item)">{{ locale.startsWith('zh') ? '提问' : 'Ask' }}</el-button>
              <el-dropdown trigger="click" :disabled="saving" @command="removeObject(item)">
                <el-button class="row-icon-action" text :icon="MoreHorizontal" :disabled="saving" :aria-label="locale.startsWith('zh') ? `管理对象：${item.title}` : `Manage object: ${item.title}`" :title="locale.startsWith('zh') ? '更多操作' : 'More actions'" />
                <template #dropdown><el-dropdown-menu><el-dropdown-item>{{ locale.startsWith('zh') ? '取消收藏' : 'Unpin' }}</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
            </div>
          </article>
        </template>
        <template v-if="section === 'conversations'">
          <p v-if="errors.pinsSave" role="alert" class="workspace-error">{{ errors.pinsSave }}</p>
          <template v-if="pinned.length">
            <h3>{{ locale.startsWith('zh') ? '已固定' : 'Pinned' }}</h3>
            <WorkspaceSkeleton v-if="busy.pins" :label="text.loading" :rows="Math.min(pinned.length, 3)" />
            <article v-for="(item, index) in (busy.pins ? [] : pinned)" :key="item.sessionId" class="workspace-item pinned-analysis">
              <div class="resource-body"><button class="resource-link" :disabled="!item.session || !enabledAgents.some(agent => agent.id === item.session?.agentId)" @click="router.push({ path: platformRoutes.chat.path, query: { agentId: item.session!.agentId, sessionId: item.sessionId } })">{{ item.title }}</button><p v-if="pinErrors[item.sessionId]">{{ pinErrors[item.sessionId] }}</p><p v-else-if="item.session && !busy.agents && !enabledAgents.some(agent => agent.id === item.session?.agentId)">{{ workspaceText.noAgent }}</p><p v-else-if="item.session">{{ date(item.session.updatedAt) }}</p>
              </div>
              <el-dropdown trigger="click" :disabled="saving" @command="(command: string) => command === 'rename' ? renamePin(item.sessionId) : command === 'up' ? movePin(index, -1) : command === 'down' ? movePin(index, 1) : updatePins(config.pinnedAnalyses.filter(pin => pin.sessionId !== item.sessionId))">
                <el-button class="row-icon-action" text :disabled="saving" :icon="MoreHorizontal" :aria-label="locale.startsWith('zh') ? `管理分析：${item.title}` : `Manage analysis: ${item.title}`" :title="locale.startsWith('zh') ? '更多操作' : 'More actions'" />
                <template #dropdown><el-dropdown-menu>
                  <el-dropdown-item command="rename">{{ locale.startsWith('zh') ? '重命名' : 'Rename' }}</el-dropdown-item>
                  <el-dropdown-item command="up" :disabled="index === 0">{{ locale.startsWith('zh') ? '上移' : 'Move up' }}</el-dropdown-item>
                  <el-dropdown-item command="down" :disabled="index === pinned.length - 1">{{ locale.startsWith('zh') ? '下移' : 'Move down' }}</el-dropdown-item>
                  <el-dropdown-item command="unpin" divided>{{ locale.startsWith('zh') ? '取消固定' : 'Unpin' }}</el-dropdown-item>
                </el-dropdown-menu></template>
              </el-dropdown>
            </article>
          </template>
          <h3 v-if="pinned.length && conversations.length">{{ locale.startsWith('zh') ? '最近分析' : 'Recent analyses' }}</h3>
          <WorkspaceSkeleton v-if="busy.conversations" :label="text.loading" />
          <div v-else-if="errors.conversations" role="alert">{{ errors.conversations }} <el-button @click="readConversations">{{ text.retry }}</el-button></div>
          <p v-else-if="!conversations.length && !pinned.length" class="workspace-empty">{{ workspaceText.empty }}</p>
          <article v-for="item in conversations" :key="item.sessionId" class="workspace-item conversation-item">
            <Sparkles :size="16" class="resource-icon" aria-hidden="true" />
            <div class="resource-body"><button class="resource-link" @click="router.push({ path: platformRoutes.chat.path, query: { agentId: item.agentId, sessionId: item.sessionId } })">{{ conversationTitle(item.title) }}</button><p>{{ enabledAgents.find(agent => agent.id === item.agentId)?.name }} · {{ date(item.updatedAt) }}</p></div>
            <el-button class="row-icon-action pin-analysis" text :icon="Pin" :title="locale.startsWith('zh') ? '固定分析' : 'Pin analysis'" :aria-label="locale.startsWith('zh') ? '固定分析' : 'Pin analysis'" :disabled="saving || config.pinnedAnalyses.length >= 20" @click="pinConversation(item)" />
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
            <article v-for="task in group.items" :key="task.id" class="workspace-item" :class="{ 'needs-intervention': needsIntervention(task) }">
              <div class="resource-body"><button class="resource-link" @click="openTask(task)">{{ task.title }}</button>
                <p v-if="group.id === 'results' && task.lastRun?.finishedAt">{{ locale.startsWith('zh') ? '生成于' : 'Generated' }} {{ date(task.lastRun.finishedAt) }}</p>
                <p v-else><span class="task-status" :class="{ 'is-paused': !!task.pause, 'is-failed': !task.activeRunId && !task.pause && task.lastRun?.status === 'failed' }">{{ taskStatus(task) }}</span><span v-if="task.nextRunAt"> · {{ text.next }} {{ date(task.nextRunAt) }}</span></p>
                <p v-if="task.pause" class="task-summary" :title="task.pause.message">{{ task.pause.message }}</p>
                <p v-else-if="task.lastRun?.error?.message" class="task-summary" :title="task.lastRun.error.message">{{ task.lastRun.error.message }}</p>
                <p v-else-if="task.lastRun?.resultSummary" class="task-summary">{{ taskSummary(task.lastRun.resultSummary) }}</p>
              </div>
              <el-button v-if="needsIntervention(task)" size="small" type="primary" plain @click="router.push({ path: platformRoutes.schedules.path, query: { taskId: task.id } })">{{ locale.startsWith('zh') ? '去处理' : 'Resolve' }}</el-button>
            </article>
            </div>
          </template>
        </template>
        <template v-else-if="section === 'recent'">
          <WorkspaceSkeleton v-if="busy.recent" :label="text.loading" />
          <div v-else-if="errors.recent" role="alert">{{ errors.recent }} <el-button @click="readRecent">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!availableRecent.length" class="workspace-empty">{{ text.emptyRecent }}</p>
            <article v-for="item in availableRecent.slice(0, 4)" :key="item.path" class="workspace-item recent-item">
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
            <article v-for="(board, index) in selectedDashboards" :key="board.id" class="workspace-board">
              <button v-if="board.resource" class="resource-link board-link" @click="router.push({ path: platformRoutes.dashboards.path, query: { dashboardId: board.id } })"><LayoutDashboard :size="16" aria-hidden="true" /><span>{{ board.resource.name }}</span><ArrowUpRight :size="14" aria-hidden="true" /></button>
              <p v-else>{{ text.unavailable }}</p>
              <DashboardMetricPreview v-if="board.resource && index < 4" :dashboard-id="board.id" :card-ids="config.dashboardCards[board.id]" :revision="previewRevision" @select="openMetric(board.id, $event)" />
              <p v-else-if="board.resource" class="execution-note">{{ locale.startsWith('zh') ? '工作台预览前 4 个仪表盘，点击标题查看此仪表盘' : 'The workspace previews the first 4 dashboards. Open this title to view more.' }}</p>
            </article>
          </template>
        </template>
        <template v-else-if="section === 'apps'">
          <WorkspaceSkeleton v-if="catalog.loading.value" :label="text.loading" :rows="2" />
          <div v-else-if="catalog.error.value" role="alert">{{ catalog.error.value }} <el-button @click="catalog.refresh">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!selectedApps.length" class="workspace-empty">{{ text.emptyApps }}</p>
            <el-button v-if="!selectedApps.length" :disabled="saving || refreshing" @click="configure('resources')">{{ interactionLabels.configure }}</el-button>
            <div class="application-grid">
            <article v-for="app in selectedApps" :key="app.id" class="application-resource">
              <a v-if="app.resource" class="application-card" :href="applicationHref(app.id)" target="_blank" rel="noopener" :aria-label="`${app.resource.names[locale] ?? app.resource.names.en}（${locale.startsWith('zh') ? '在新标签页打开' : 'opens in a new tab'}）`" :title="locale.startsWith('zh') ? '在新标签页打开' : 'Opens in a new tab'">
                 <AppWindow :size="18" class="resource-icon" aria-hidden="true" />
                <span class="resource-body"><strong>{{ app.resource.names[locale] ?? app.resource.names.en }}</strong><span>{{ app.resource.descriptions[locale] ?? app.resource.descriptions.en ?? text.application }}</span></span>
                <ArrowUpRight :size="16" aria-hidden="true" />
              </a>
              <p v-else>{{ text.unavailable }}</p>
            </article>
            </div>
            <h3 v-if="recentApps.length">{{ text.recentApps }}</h3>
            <article v-for="app in recentApps" :key="app.id" class="workspace-item">
              <a class="resource-link" :href="applicationHref(app.id)" target="_blank" rel="noopener" :title="locale.startsWith('zh') ? '在新标签页打开' : 'Opens in a new tab'">{{ app.names[locale] ?? app.names.en }} <ArrowUpRight :size="14" aria-hidden="true" /></a>
            </article>
          </template>
        </template>
      </section>
      </div>
    </div>
    <el-dialog v-model="editing" :title="text.configure" width="min(740px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-position="top" :disabled="saving">
        <el-tabs v-model="settingsTab">
        <el-tab-pane name="layout" :label="locale.startsWith('zh') ? '页面布局' : 'Layout'">
        <el-form-item :label="text.layout">
          <el-select v-model="draft.layout" @change="draft.sections = presetSections(draft.layout)"><el-option value="tasks" :label="text.tasksLayout" /><el-option value="data" :label="text.dataLayout" /><el-option value="assistant" :label="text.assistantLayout" /></el-select>
        </el-form-item>
        <p class="settings-note">{{ locale.startsWith('zh') ? '选择预设会重置区块位置。问数入口始终位于主栏顶部；可调整下方区块的位置、顺序或隐藏。' : 'A preset resets section placement. The question box stays at the top of the main column; arrange or hide the sections below.' }}</p>
        <section v-for="position in (['main', 'sidebar', 'hidden'] as const)" :key="position" class="section-editor">
          <h3>{{ position === 'main' ? (locale.startsWith('zh') ? '主栏' : 'Main column') : position === 'sidebar' ? (locale.startsWith('zh') ? '侧栏' : 'Sidebar') : (locale.startsWith('zh') ? '已隐藏' : 'Hidden') }}</h3>
          <div v-for="(section, index) in draft.sections?.[position]" :key="section" class="section-editor-row">
            <span>{{ sectionName(section) }}</span>
            <el-select :model-value="position" :aria-label="sectionName(section)" @change="(value: 'main' | 'sidebar' | 'hidden') => moveSection(section, value)"><el-option value="main" :label="locale.startsWith('zh') ? '主栏' : 'Main column'" /><el-option value="sidebar" :label="locale.startsWith('zh') ? '侧栏' : 'Sidebar'" /><el-option value="hidden" :label="locale.startsWith('zh') ? '隐藏' : 'Hidden'" /></el-select>
            <el-button size="small" :disabled="saving || index === 0" @click="orderSection(position, index, -1)">{{ locale.startsWith('zh') ? '上移' : 'Up' }}</el-button>
            <el-button size="small" :disabled="saving || index === draft.sections![position].length - 1" @click="orderSection(position, index, 1)">{{ locale.startsWith('zh') ? '下移' : 'Down' }}</el-button>
          </div>
        </section>
        </el-tab-pane>
        <el-tab-pane name="resources" :label="locale.startsWith('zh') ? '资源内容' : 'Resources'">
        <el-button v-if="catalog.applications.value.some(app=>app.id==='ontology')" text @click="editing=false;router.push({path:platformRoutes.products.path,query:homeAsset?{id:homeAsset.id}:{}})">{{locale.startsWith('zh')?'管理组件与模板':'Manage components and templates'}}</el-button>
        <h3>{{locale.startsWith('zh')?'产品层组件':'Product components'}}</h3>
        <p class="settings-note">{{locale.startsWith('zh')?'选择已保存的指标展示、操作板、对象视图或仪表盘，按引用组合到主页。':'Compose saved metric views, operation panels, object views and dashboards by reference.'}}</p>
        <div v-for="(child,index) in draftChildren" :key="child.assetId" class="section-editor-row"><span>{{productAssets.find(asset=>asset.id===child.assetId)?.name??text.unavailable}}</span><el-select v-model="child.column" aria-label="组件位置"><el-option value="main" label="主栏"/><el-option value="sidebar" label="侧栏"/></el-select><el-button :disabled="index===0" @click="draftChildren.splice(index-1,0,...draftChildren.splice(index,1))">上移</el-button><el-button @click="draftChildren.splice(index,1)">移除</el-button></div>
        <div class="resource-toolbar"><el-select v-model="addProductId" filterable placeholder="选择产品资产" aria-label="选择产品资产"><el-option v-for="asset in reusableProducts" :key="asset.id" :value="asset.id" :label="asset.name"/></el-select><el-button :disabled="!addProductId" @click="addProduct">添加组件</el-button></div>
        <el-form-item :label="text.data">
          <el-select v-model="draft.dashboardIds" multiple filterable :disabled="busy.data || !!errors.data">
            <el-option v-for="board in dashboards" :key="board.id" :value="board.id" :label="board.name" />
            <el-option v-for="id in draft.dashboardIds.filter(id => !dashboards.some(board => board.id === id))" :key="id" :value="id" :label="text.unavailable" />
          </el-select>
        </el-form-item>
        <el-form-item v-for="id in draft.dashboardIds.filter(id => dashboards.some(board => board.id === id))" :key="id" :label="`${dashboards.find(board => board.id === id)?.name} · ${locale.startsWith('zh') ? '关注内容' : 'Followed cards'}`">
          <DashboardCardPicker v-model="draft.dashboardCards[id]" :dashboard-id="id" />
          <el-button v-if="draft.dashboardCards[id] !== undefined" text @click="delete draft.dashboardCards[id]">{{ locale.startsWith('zh') ? '恢复默认展示' : 'Use default selection' }}</el-button>
        </el-form-item>
        <el-form-item :label="text.apps">
          <el-select v-model="draft.applicationIds" multiple filterable :disabled="catalog.loading.value || !!catalog.error.value">
            <el-option v-for="app in apps" :key="app.id" :value="app.id" :label="app.names[locale] ?? app.names.en" />
            <el-option v-for="id in draft.applicationIds.filter(id => !apps.some(app => app.id === id))" :key="id" :value="id" :label="text.unavailable" />
          </el-select>
        </el-form-item>
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
        <el-form-item :label="locale.startsWith('zh') ? '收藏对象' : 'Pinned objects'">
          <el-select v-model="draft.objectOpening"><el-option value="drawer" :label="interactionLabels.drawer" /><el-option value="page" :label="interactionLabels.page" /></el-select>
        </el-form-item>
        <p class="settings-note">{{ locale.startsWith('zh') ? '对象内容使用已配置的对象视图；在对象详情中通过「配置视图」维护。完整页面可返回工作台。' : 'Objects use their configured object views. Edit them from the object page. Full pages can return to the workspace.' }}</p>
        </el-tab-pane>
        </el-tabs>
        <p v-if="errors.save" role="alert" class="workspace-error">{{ errors.save }}</p>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editing = false">{{ text.cancel }}</el-button><el-button type="primary" :loading="saving" @click="save">{{ text.save }}</el-button></template>
    </el-dialog>
    <el-drawer v-model="objectPreviewOpen" class="workspace-object-drawer" :title="objectPreview?.title" size="min(920px, 100vw)" destroy-on-close>
      <template v-if="objectPreview">
        <div class="resource-toolbar"><el-button @click="openObjectPage(objectPreview)">{{ interactionLabels.openPage }}</el-button><el-button v-if="canChat && enabledAgents.length" type="primary" @click="askObject(objectPreview)">{{ locale.startsWith('zh') ? '就此对象提问' : 'Ask about this object' }}</el-button></div>
        <ManagerFrame class="workspace-preview-frame"><ObjectViewPage class="workspace-object-preview" :reference="objectPreview" preview @open="objectPreview = { ...$event, title: locale.startsWith('zh') ? '关联对象' : 'Related object' }" /></ManagerFrame>
      </template>
    </el-drawer>
    <el-drawer v-model="resourceOpen" :title="resource?.title" size="min(680px, 100vw)" destroy-on-close>
      <template v-if="resource">
        <div class="resource-toolbar">
          <el-button @click="resourceOpen = false; router.push(resource.path)">{{ interactionLabels.openPage }}</el-button>
          <el-button v-if="canChat" type="primary" :disabled="!enabledAgents.length" :loading="analysisBusy" @click="analyze(resource)">{{ interactionLabels.analyze }}</el-button>
          <el-button v-if="canChat && resource.kind === 'metric'" :disabled="!enabledAgents.length" :loading="analysisBusy" @click="analyze(resource, 'explain')">{{ locale.startsWith('zh') ? '解释指标口径' : 'Explain metric definition' }}</el-button>
        </div>
        <el-alert v-if="analysisError" :title="analysisError" type="error" :closable="false" />
        <WorkspaceResourceDetail :resource="resource" />
      </template>
    </el-drawer>
  </AppPage>
</template>
<style scoped>
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
header, .workspace-item { display: flex; justify-content: space-between; align-items: center; gap: var(--spacing-md); }
header { min-height: var(--control-height); margin-bottom: var(--spacing-md); }
header > .el-button, .section-actions :deep(.el-button) { padding-inline: var(--spacing-sm); }
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
</style>
