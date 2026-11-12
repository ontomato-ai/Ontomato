<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { nodeApiRequest } from "@ontomato/workbench-ui";
import { defaultPersonalWorkspace, personalWorkspaceSchema, recentWorkListSchema, type RecentWork } from "@ontomato/contracts/personal-workspace";
import { DashboardCardPicker, DashboardMetricPreview } from "@ontomato/workbench-ui/features/dashboard";
import type { DashboardListItem } from "@ontomato/contracts/dashboard";
import { platformSchedulesPath, platformTaskListSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useApplicationCatalog } from "../catalog";
import AppPage from "./AppPage.vue";
import { AppWindow, ArrowUpRight, CircleAlert, Clock3, LayoutDashboard, RefreshCw, Settings2, Sparkles } from "lucide-vue-next";
import WorkspaceResourceDetail, { type WorkspaceResource } from "./WorkspaceResourceDetail.vue";
import { agentHostAgentListSchema, agentHostCreateSessionResponseSchema } from "@ontomato/contracts/agent-host";
const { locale } = useI18n();
const router = useRouter();
const catalog = useApplicationCatalog();
const config = ref(defaultPersonalWorkspace());
const draft = ref(defaultPersonalWorkspace());
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
const presentation = ref<"drawer" | "dialog">("drawer");
const resourceOpen = ref(false);
const analysisBusy = ref(false);
const analysisError = ref("");
const interactionLabels = computed(() => locale.value.startsWith("zh") ? {
  title: "打开方式", metrics: "指标详情", tasks: "任务结果", drawer: "侧滑面板", dialog: "弹窗", page: "完整页面", conversation: "助手对话",
  analyze: "交给助手分析", openPage: "在完整页面打开", intervention: "需要处理", finished: "最近完成", density: "展示密度", help: "点击指标或任务时使用所选方式；打开后仍可切换", configure: "选择资源",
} : { title: "Open with", metrics: "Metric details", tasks: "Task results", drawer: "Side panel", dialog: "Dialog", page: "Full page", conversation: "Assistant conversation",
  analyze: "Analyze with assistant", openPage: "Open full page", intervention: "Needs intervention", finished: "Recently completed", density: "Display density", help: "Choose how metrics and tasks open. You can also switch after opening.", configure: "Choose resources" });
async function analyze(target: WorkspaceResource) {
  if (analysisBusy.value || !canChat.value) return;
  analysisBusy.value = true; analysisError.value = "";
  try {
    const evidence = target.kind === "metric"
      ? await json("/api/dashboards/query-card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dashboardId: target.dashboardId, cardId: target.cardId }) })
      : target.runId ? await json(`${platformSchedulesPath}/${target.taskId}/runs/${target.runId}`) : null;
    const agents = agentHostAgentListSchema.parse(await json("/api/assistant/agents"));
    const agent = agents.agents.find(item => item.enabled);
    if (!agent) throw new Error(locale.value.startsWith("zh") ? "没有可用的智能体" : "No enabled assistant available");
    const session = agentHostCreateSessionResponseSchema.parse(await json("/api/assistant/sessions", {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ agentId: agent.id }),
    })).session;
    const message = locale.value.startsWith("zh") ? "请协助分析个人工作台中的这项内容。先读取当前资源与最新数据，解释口径或执行结果，再给出下一步建议。本次只分析，不执行任何写入。" : "Analyze this workspace resource. Read its current data, explain the metric or execution result and suggest next steps. Only analyze; do not write data.";
    await json(`/api/assistant/sessions/${session.id}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ message: `${message}\n${JSON.stringify({ resource: target, evidence })}` }),
    });
    resourceOpen.value = false;
    await router.push({ path: platformRoutes.chat.path, query: { sessionId: session.id } });
  } catch (failure) { analysisError.value = failure instanceof Error ? failure.message : String(failure); }
  finally { analysisBusy.value = false; }
}
function openResource(target: WorkspaceResource) {
  resource.value = target; analysisError.value = "";
  const mode = config.value.interactions[target.kind === "metric" ? "metrics" : "tasks"];
  if (mode === "page") { void router.push(target.path); return; }
  if (mode === "conversation" && canChat.value) { void analyze(target); return; }
  presentation.value = mode === "dialog" ? "dialog" : "drawer"; resourceOpen.value = true;
}
function openMetric(boardId: string, card: { id: string; name: string }) {
  openResource({ kind: "metric", title: card.name, dashboardId: boardId, cardId: card.id, path: router.resolve({ path: platformRoutes.dashboards.path, query: { dashboardId: boardId } }).fullPath });
}
function openTask(task: PlatformTask) {
  openResource({ kind: "task", title: task.title, taskId: task.id, runId: task.lastRun?.id ?? null, path: task.latestResult?.link.path ?? router.resolve({ path: platformRoutes.schedules.path, query: { taskId: task.id } }).fullPath });
}
const text = computed(() => locale.value.startsWith("zh") ? {
  title: "个人工作台", intro: "你的应用、关注的数据与最近的工作", configure: "配置工作台", refresh: "刷新",
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
  title: "Personal workspace", intro: "Your applications, followed data and recent work", configure: "Configure workspace", refresh: "Refresh",
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
const apps = computed(() => catalog.applications.value.filter(app => app.kind === "hosted" || app.kind === "connected"));
const canBuild = computed(() => catalog.applications.value.some(app => app.id === "app-builder"));
const canChat = computed(() => catalog.applications.value.some(app => app.id === "agents"));
const selectedDashboards = computed(() => config.value.dashboardIds.map(id => ({ id, resource: dashboards.value.find(board => board.id === id) })));
const selectedApps = computed(() => config.value.applicationIds.map(id => ({ id, resource: apps.value.find(app => app.id === id) })));
function applicationHref(id: string) {
  return router.resolve({ path: `/applications/${encodeURIComponent(id)}` }).href;
}
/** Keep data on a wide working surface and activity in a compact supporting column. */
const columns = computed(() => {
  return config.value.layout === "data" ? [["data", "apps"], ["tasks", "recent"]]
    : config.value.layout === "tasks" ? [["tasks", "recent"], ["apps", "data"]] : [["apps", "data"], ["tasks", "recent"]];
});
const needsIntervention = (task: PlatformTask) => !task.activeRunId && (!!task.pause || task.lastRun?.status === "failed");
const issueTasks = computed(() => tasks.value.filter(needsIntervention));
const runningTasks = computed(() => tasks.value.filter(task => task.activeRunId));
const resultTasks = computed(() => tasks.value.filter(task => task.latestResult?.runId === task.lastRun?.id
  && task.lastRun?.status === "completed" && Date.parse(task.lastRun.finishedAt ?? "") >= Date.now() - 7 * 86400000));
const attentionTasks = computed(() => [...tasks.value].filter(task => needsIntervention(task) || task.activeRunId || resultTasks.value.includes(task)).sort((a, b) => {
  const priority = (task: PlatformTask) => needsIntervention(task) ? 0 : task.activeRunId ? 1 : 2;
  return priority(a) - priority(b) || (b.lastRun?.finishedAt ?? "").localeCompare(a.lastRun?.finishedAt ?? "");
}).slice(0, 6));
const availableRecent = computed(() => recent.value.filter(item => catalog.applications.value.some(app => app.id === item.appId)));
const recentApps = computed(() => [...new Set(availableRecent.value.map(item => item.appId))].map(id => apps.value.find(app => app.id === id)).filter((app): app is typeof apps.value[number] => !!app && !config.value.applicationIds.includes(app.id)).slice(0, 4));
function recentTitle(item: RecentWork) {
  const url = new URL(item.path, "https://workspace.invalid");
  const board = dashboards.value.find(board => board.id === url.searchParams.get("dashboardId"));
  return board?.name ?? (item.title !== catalog.applications.value.find(app => app.id === item.appId)?.names.en ? item.title : null)
    ?? catalog.applications.value.find(app => app.id === item.appId)?.names[locale.value] ?? item.title;
}
function recentContext(item: RecentWork) {
  const url = new URL(item.path, "https://workspace.invalid");
  const object = url.searchParams.get("primaryKey");
  const session = url.searchParams.get("sessionId");
  if (object) return `${locale.value.startsWith("zh") ? "对象" : "Object"} · ${object}`;
  if (session) return `${locale.value.startsWith("zh") ? "会话" : "Conversation"} · ${session.slice(0, 8)}`;
  return "";
}
async function json(path: string, init: RequestInit = {}) {
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
  config.value = personalWorkspaceSchema.parse((await json("/api/personal-workspace")).data);
  ready.value = true;
});
const readDashboards = () => load("data", async () => { dashboards.value = (await json("/api/dashboards")).data; });
const readTasks = () => load("tasks", async () => { tasks.value = platformTaskListSchema.parse(await json(platformSchedulesPath)).tasks; });
const readRecent = () => load("recent", async () => { recent.value = recentWorkListSchema.parse((await json("/api/personal-workspace/recent")).data); });
async function refresh() {
  previewRevision.value++;
  await Promise.all([readTasks(), readDashboards(), readRecent(), catalog.refresh()]);
}
onMounted(() => { void readConfig(); void refresh(); });
function configure() {
  delete errors.value.save;
  draft.value = { ...config.value, dashboardCards: Object.fromEntries(Object.entries(config.value.dashboardCards).map(([id, cards]) => [id, [...cards]])), interactions: { ...config.value.interactions }, dashboardIds: [...config.value.dashboardIds], applicationIds: [...config.value.applicationIds] };
  editing.value = true;
}
async function save() {
  saving.value = true;
  await load("save", async () => {
    const body = await json("/api/personal-workspace", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(personalWorkspaceSchema.parse(draft.value)),
    });
    config.value = personalWorkspaceSchema.parse(body.data);
    editing.value = false;
  });
  saving.value = false;
}
function taskStatus(task: PlatformTask) {
  if (task.activeRunId) return text.value.running;
  if (task.pause) return text.value.paused;
  if (!task.enabled) return text.value.disabled;
  return task.lastRun ? text.value[task.lastRun.status] : text.value.pending;
}
function taskGroup(task: PlatformTask) {
  return needsIntervention(task) ? interactionLabels.value.intervention : task.activeRunId ? text.value.running : interactionLabels.value.finished;
}
function date(value: string) { return new Date(value).toLocaleString(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
/** A task preview is a short sentence; full formatting and attachments belong to its result page. */
function taskSummary(value: string) {
  return value.replace(/!\[[\s\S]*$/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*#`]/g, "").replace(/\s+/g, " ").trim();
}
const actions = computed(() => [
  ...(canChat.value ? [{ id: "assistant", label: text.value.chat, icon: Sparkles, onClick: () => void router.push(platformRoutes.chat.path) }] : []),
  { id: "refresh", label: text.value.refresh, icon: RefreshCw, onClick: () => void refresh() },
  ...(ready.value ? [{ id: "configure", label: text.value.configure, icon: Settings2, onClick: configure }] : []),
]);
</script>
<template>
  <AppPage :title="text.title" :description="text.intro" :actions="actions" :labels="{ save: text.save, discard: text.cancel, unsavedChanges: text.unsaved }">
    <div v-if="errors.config" role="alert" class="workspace-error">{{ errors.config }} <el-button @click="readConfig">{{ text.retry }}</el-button></div>
    <p v-if="!ready && busy.config" role="status">{{ text.loading }}</p>
    <el-alert v-if="analysisError" :title="analysisError" type="error" :closable="false" />
    <div v-if="ready" class="workspace-grid" :class="{ 'tasks-first': config.layout === 'tasks' }">
      <div v-for="(sections, column) in columns" :key="column" class="workspace-column" :class="{ 'activity-column': sections.includes('tasks') }">
      <section v-for="section in sections" :key="section" class="workspace-section" :data-section="section">
        <header><h2>{{ section === 'tasks' ? text.attention : text[section as 'recent' | 'data' | 'apps'] }}</h2>
          <el-button v-if="section === 'tasks' || section === 'data'" text @click="router.push(section === 'tasks' ? platformRoutes.schedules.path : platformRoutes.dashboards.path)">{{ text.all }}</el-button>
          <div v-if="section === 'apps'" class="section-actions">
            <el-button v-if="canBuild" text @click="router.push({ name: platformRoutes.appBuilder.name })">{{ text.build }} <ArrowUpRight :size="14" aria-hidden="true" /></el-button>
            <el-button text @click="configure">{{ locale.startsWith('zh') ? '管理应用' : 'Manage applications' }}</el-button>
          </div>
        </header>
        <template v-if="section === 'tasks'">
          <p v-if="busy.tasks" role="status">{{ text.loading }}</p>
          <div v-else-if="errors.tasks" role="alert">{{ errors.tasks }} <el-button @click="readTasks">{{ text.retry }}</el-button></div>
          <template v-else>
            <div class="attention-summary" aria-live="polite">
              <span :class="{ 'has-issues': issueTasks.length }"><strong>{{ issueTasks.length }}</strong><CircleAlert v-if="issueTasks.length" :size="14" aria-hidden="true" />{{ text.issues }}</span>
              <span><strong>{{ resultTasks.length }}</strong>{{ text.results }}</span>
              <span><strong>{{ runningTasks.length }}</strong>{{ text.runningTasks }}</span>
            </div>
            <p v-if="resultTasks.length" class="execution-note">{{ locale.startsWith('zh') ? '执行完成表示运行已结束，数据是否取到及结论是否可用请查看结果' : 'Completed means the run ended. Check the result for data availability and usable conclusions.' }}</p>
            <p v-if="!attentionTasks.length" class="workspace-empty">{{ text.clear }}<br>{{ text.noAttention }}</p>
            <template v-for="(task, taskIndex) in attentionTasks" :key="task.id">
            <h3 v-if="taskIndex === 0 || taskGroup(task) !== taskGroup(attentionTasks[taskIndex - 1]!)">{{ taskGroup(task) }}</h3>
            <article class="workspace-item" :class="{ 'needs-intervention': needsIntervention(task) }">
              <div class="resource-body"><button class="resource-link" @click="openTask(task)">{{ task.title }}</button>
                <p><span class="task-status" :class="{ 'is-paused': !!task.pause, 'is-failed': !task.activeRunId && !task.pause && task.lastRun?.status === 'failed' }">{{ taskStatus(task) }}</span><span v-if="task.nextRunAt"> · {{ text.next }} {{ date(task.nextRunAt) }}</span></p>
                <p v-if="task.pause" class="task-summary" :title="task.pause.message">{{ task.pause.message }}</p>
                <p v-else-if="task.lastRun?.error?.message" class="task-summary" :title="task.lastRun.error.message">{{ task.lastRun.error.message }}</p>
                <p v-else-if="task.lastRun?.resultSummary" class="task-summary">{{ taskSummary(task.lastRun.resultSummary) }}</p>
              </div>
              <el-button v-if="needsIntervention(task)" size="small" type="primary" plain @click="router.push({ path: platformRoutes.schedules.path, query: { taskId: task.id } })">{{ locale.startsWith('zh') ? '去处理' : 'Resolve' }}</el-button>
              <el-button v-else-if="task.latestResult" size="small" text @click="openTask(task)">{{ text.result }}</el-button>
            </article>
            </template>
          </template>
        </template>
        <template v-else-if="section === 'recent'">
          <p v-if="busy.recent" role="status">{{ text.loading }}</p>
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
          <p v-if="busy.data" role="status">{{ text.loading }}</p>
          <div v-else-if="errors.data" role="alert">{{ errors.data }} <el-button @click="readDashboards">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!selectedDashboards.length" class="workspace-empty">{{ text.emptyData }}</p>
            <el-button v-if="!selectedDashboards.length" @click="configure">{{ interactionLabels.configure }}</el-button>
            <article v-for="(board, index) in selectedDashboards" :key="board.id" class="workspace-board">
              <button v-if="board.resource" class="resource-link board-link" @click="router.push({ path: platformRoutes.dashboards.path, query: { dashboardId: board.id } })"><LayoutDashboard :size="16" aria-hidden="true" /><span>{{ board.resource.name }}</span><ArrowUpRight :size="14" aria-hidden="true" /></button>
              <p v-else>{{ text.unavailable }}</p>
              <DashboardMetricPreview v-if="board.resource && index < 4" :dashboard-id="board.id" :card-ids="config.dashboardCards[board.id]" :revision="previewRevision" @select="openMetric(board.id, $event)" />
            </article>
          </template>
        </template>
        <template v-else-if="section === 'apps'">
          <p v-if="catalog.loading.value" role="status">{{ text.loading }}</p>
          <div v-else-if="catalog.error.value" role="alert">{{ catalog.error.value }} <el-button @click="catalog.refresh">{{ text.retry }}</el-button></div>
          <template v-else>
            <p v-if="!selectedApps.length" class="workspace-empty">{{ text.emptyApps }}</p>
            <el-button v-if="!selectedApps.length" @click="configure">{{ interactionLabels.configure }}</el-button>
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
    <el-dialog v-model="editing" :title="text.configure" width="min(560px, 94vw)" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-position="top" :disabled="saving">
        <el-form-item :label="text.layout">
          <el-select v-model="draft.layout"><el-option value="tasks" :label="text.tasksLayout" /><el-option value="data" :label="text.dataLayout" /><el-option value="assistant" :label="text.assistantLayout" /></el-select>
        </el-form-item>
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
        <h3>{{ interactionLabels.title }}</h3>
        <p>{{ interactionLabels.help }}</p>
        <el-form-item v-for="kind in (['metrics', 'tasks'] as const)" :key="kind" :label="interactionLabels[kind]">
          <el-select v-model="draft.interactions[kind]">
            <el-option v-for="mode in (['drawer', 'dialog', 'page', 'conversation'] as const)" :key="mode" :value="mode" :label="interactionLabels[mode]" :disabled="mode === 'conversation' && !canChat" />
          </el-select>
        </el-form-item>
        <p v-if="errors.save" role="alert" class="workspace-error">{{ errors.save }}</p>
      </el-form>
      <template #footer><el-button :disabled="saving" @click="editing = false">{{ text.cancel }}</el-button><el-button type="primary" :loading="saving" @click="save">{{ text.save }}</el-button></template>
    </el-dialog>
    <component :is="presentation === 'drawer' ? 'el-drawer' : 'el-dialog'" v-model="resourceOpen" :title="resource?.title" :size="'min(680px, 100vw)'" :width="'min(760px, 94vw)'" destroy-on-close>
      <template v-if="resource">
        <div class="resource-toolbar">
          <el-button @click="resourceOpen = false; router.push(resource.path)">{{ interactionLabels.openPage }}</el-button>
          <el-button v-if="canChat" type="primary" :loading="analysisBusy" @click="analyze(resource)">{{ interactionLabels.analyze }}</el-button>
          <el-button @click="presentation = presentation === 'drawer' ? 'dialog' : 'drawer'">{{ presentation === 'drawer' ? interactionLabels.dialog : interactionLabels.drawer }}</el-button>
        </div>
        <el-alert v-if="analysisError" :title="analysisError" type="error" :closable="false" />
        <WorkspaceResourceDetail :resource="resource" />
      </template>
    </component>
  </AppPage>
</template>
<style scoped>
.workspace-grid { display: grid; grid-template-columns: minmax(0, 2.2fr) minmax(300px, 1fr); gap: var(--spacing-xl); align-items: start; }
.workspace-grid.tasks-first { grid-template-columns: minmax(300px, 1fr) minmax(0, 2.2fr); }
.resource-toolbar { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); margin-bottom: var(--spacing-lg); }
.resource-toolbar :deep(.el-button + .el-button) { margin-left: 0; }
.section-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--spacing-sm); }
.section-actions :deep(.el-button + .el-button) { margin-left: 0; }
.section-actions :deep(svg) { margin-left: var(--spacing-xs); }
.workspace-column { display: flex; flex-direction: column; gap: var(--spacing-xl); min-width: 0; }
.workspace-column + .workspace-column { border-left: 1px solid var(--el-border-color); padding-left: var(--page-section-padding); }
.workspace-section { min-width: 0; }
.workspace-section + .workspace-section { padding-top: var(--spacing-lg); border-top: 1px solid var(--el-border-color); }
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
.attention-summary { display: flex; flex-wrap: wrap; gap: var(--spacing-lg); padding-block: var(--spacing-md); border-block: 1px solid var(--el-border-color-lighter); margin-bottom: var(--spacing-md); }
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
.recent-item { align-items: flex-start; }
.recent-item .resource-icon { margin-top: 2px; }
.activity-column .workspace-item { align-items: flex-start; }
.activity-column .workspace-item > .el-button { margin-top: 0; flex-shrink: 0; }
.workspace-error { color: var(--el-color-danger); }
.el-select { width: 100%; }
@container platform-page (max-width: 1050px) { .workspace-grid, .workspace-grid.tasks-first { grid-template-columns: minmax(0, 1fr); } .workspace-column + .workspace-column { border-left: 0; padding-left: 0; padding-top: var(--spacing-xl); border-top: 1px solid var(--el-border-color); } .activity-column { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .activity-column .workspace-section + .workspace-section { border-top: 0; padding-top: 0; } }
@container platform-page (max-width: 600px) { .application-grid, .activity-column { grid-template-columns: minmax(0, 1fr); } .activity-column .workspace-section + .workspace-section { border-top: 1px solid var(--el-border-color); padding-top: var(--spacing-lg); } }
</style>
