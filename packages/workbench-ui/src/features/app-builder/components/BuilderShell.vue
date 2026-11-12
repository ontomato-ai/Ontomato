<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  AgentShell,
  ShellColumn,
  useAgentNav,
  type AgentHostAgent,
  type ShellLabels,
  type ShellRunChange,
  type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import type { Workspace } from "@ontomato/contracts/workspaces";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { useShellLabels } from "../../../composables/useShellLabels";
import { authHost } from "../../../utils/auth";
import { builderApi, createBuilderClient, WORKSPACE_PAGE } from "../api";
import { PANEL_ID, PANEL_TABS, errorText, firstLine, shortCommit, type ChangeTarget, type PanelTab } from "../panel";
import type { AppBuilderPlatform } from "../platform";
import { selectedObject, usePreviewContext } from "../preview-context";
import { applicationName, usePublication } from "../publication";
import { useWorkspaceView, type LoadState } from "../workspace-view";
import CommitMark from "./CommitMark.vue";
import ComposerContext from "./ComposerContext.vue";
import PanelHeader from "./PanelHeader.vue";
import PublishDrawer from "./PublishDrawer.vue";
import WorkspaceColumn from "./WorkspaceColumn.vue";
import WorkspacePanel from "./WorkspacePanel.vue";

/**
 * 应用构建 as an agent app (DESIGN.md "Agent apps"): the builder agent's conversations, kept per workspace, and beside them
 * the workspace they write — its preview, files, changes and history — as the one page of the application, and the
 * drawer that publishes the workspace as an application on the platform's rail. The conversation, the three states and
 * sending from the page are the shell's; this page fills its column, its page and the two lines the shell leaves to it
 * (the page's header row and what a message carries).
 *
 * The address names the workspace (`/app-builder/<id>`) and the open conversation (`?sessionId=`). The layout the reader
 * chose — only the conversation, beside it, or full — stays while they change conversation or workspace.
 */
const props = defineProps<{ agent: AgentHostAgent; platform: AppBuilderPlatform }>();
const { t, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const shellLabels = useShellLabels();

const BASE = platformRoutes.appBuilder.path.split("/:")[0]!;
const builderPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const workspaceId = computed(() => {
  const id = route.params.workspaceId;
  return typeof id === "string" && id ? id : null;
});
/** Without login every workspace is the anonymous reader's, so only a signed-in edition says they are private. */
const privateWorkspaces = authHost().getUserInfo() !== null;

/* ---- The column's workspaces ---- */
const workspaces = ref<Workspace[]>([]);
const workspacesState = ref<LoadState>("loading");
const moreWorkspaces = ref(false);
async function loadWorkspaces(more = false) {
  workspacesState.value = "loading";
  try {
    const page = await builderApi.workspaces(more ? workspaces.value.length : 0);
    workspaces.value = more ? [...workspaces.value, ...page] : page;
    moreWorkspaces.value = page.length === WORKSPACE_PAGE;
    workspacesState.value = "ready";
  } catch {
    workspacesState.value = "error";
  }
}
void loadWorkspaces();
// An address without a workspace opens the most recent one.
watch(
  [workspaceId, workspacesState],
  () => {
    const latest = workspaces.value[0];
    if (!workspaceId.value && workspacesState.value === "ready" && latest) void router.replace(builderPath(latest.id));
  },
  { immediate: true },
);

const view = useWorkspaceView(() => workspaceId.value);
// The column shows the open workspace as last read: its name and whether a run occupies it.
watch(
  () => view.workspace,
  (current) => {
    if (current) workspaces.value = workspaces.value.map((item) => (item.id === current.id ? current : item));
  },
);
const workspaceName = computed(() => view.workspace?.name ?? "");
const emptyWorkspace = computed(() => view.filesState === "ready" && view.files.length === 0);

/* ---- The conversation: the shell's, bound to the open workspace ---- */
const sessionId = ref<string | null>(typeof route.query.sessionId === "string" ? route.query.sessionId : null);
watch(
  () => route.query.sessionId,
  (id) => (sessionId.value = typeof id === "string" ? id : null),
);
// Opening a conversation reads an occupied workspace again: the run may have ended in a conversation not open here.
watch(sessionId, (id) => {
  if ((route.query.sessionId ?? null) !== id) void router.replace({ path: route.path, query: id ? { sessionId: id } : {} });
  if (view.workspace?.activeRunId) void view.refresh();
});
const agentId = ref<string | null>(props.agent.id);
const client = computed(() => (workspaceId.value ? createBuilderClient(workspaceId.value) : null));
const nav = useAgentNav({
  client: () => client.value!,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => sessionId.value,
  setSessionId: (id) => (sessionId.value = id),
});
// The one agent, named for the reader; its line under the greeting says what the workspace holds.
watchEffect(() => {
  nav.agents.value = [{
    ...props.agent,
    name: t("appBuilder.title"),
    description: t(emptyWorkspace.value ? "appBuilder.descriptionEmpty" : "appBuilder.descriptionWorkspace"),
  }];
});
/**
 * A workspace opened without a conversation in the address continues its latest one once its list is read, unless the
 * reader already chose a conversation meanwhile.
 */
let continueLatest = false;
watch(
  workspaceId,
  async (id) => {
    continueLatest = typeof route.query.sessionId !== "string";
    if (!id) return;
    await nav.loadSessions();
    if (id !== workspaceId.value || !continueLatest) return;
    continueLatest = false;
    const latest = nav.sessions.value[0];
    if (latest && sessionId.value === null) sessionId.value = latest.id;
  },
  { immediate: true },
);
function newConversation() {
  continueLatest = false;
  nav.startNew();
}
function selectSession(id: string) {
  continueLatest = false;
  nav.selectSession(id);
}

/* ---- The page: the workspace in four views, and the three states ---- */
const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: "app-builder",
  label: t("appBuilder.title"),
  // Each view scrolls itself (the preview inside the app's frame), so full, the composer floats over the whole view.
  features: [{ id: PANEL_ID, label: t("appBuilder.panel"), icon: "pages", availability: "page", withConversation: true, scrollsItself: true }],
}));
/** The builder opens beside the conversation; closing the page leaves only the conversation, expanding fills it. */
const featureId = ref<string | null>(PANEL_ID);
const pageView = ref<"full" | "side">("side");
const tab = ref<PanelTab>("preview");
const file = ref<string | null>(null);
const target = ref<ChangeTarget>("latest");
const reloadPreview = ref(0);
const flash = ref<string | null>(null);
let flashTimer: ReturnType<typeof setTimeout> | undefined;
function showFlash(text: string) {
  clearTimeout(flashTimer);
  flash.value = text;
  flashTimer = setTimeout(() => (flash.value = null), 2600);
}
onBeforeUnmount(() => clearTimeout(flashTimer));

/** The publication drawer, opened from the page's header. */
const publishOpen = ref(false);
/** Where the workspace's application stands: the header shows that it is published, the drawer shows the rest. */
const publication = usePublication(() => workspaceId.value, props.platform.catalog);
const publishedName = computed(() => publication.application && applicationName(publication.application, locale.value));

// Another workspace keeps the layout and the open view, and drops what belonged to the one left.
watch(workspaceId, () => {
  file.value = null;
  target.value = "latest";
  flash.value = null;
  publishOpen.value = false;
});
// The open file is the page until the reader picks another, and moves on when it is gone.
watch(
  () => view.files,
  (files) => {
    if (file.value && files.some((entry) => entry.path === file.value)) return;
    file.value = files.find((entry) => entry.path === "index.html")?.path ?? files[0]?.path ?? null;
  },
);

function openPage(next: PanelTab) {
  tab.value = next;
  if (featureId.value !== null) return;
  featureId.value = PANEL_ID;
  pageView.value = "side";
}
function showChanges(commit: string) {
  target.value = commit;
  openPage("changes");
}

/** The frame the preview shows, while it shows one: what its app reports is the preview's context. */
const previewFrame = shallowRef<Window | null>(null);
const previewContext = usePreviewContext(props.platform.subscribePageContext, () => previewFrame.value, () => workspaceId.value);

/** The open view as a message names it, so "this" in the reader's words means what they look at. */
const contextPage = computed(() => {
  const label = t(PANEL_TABS.find((item) => item.id === tab.value)!.label);
  if (tab.value === "preview") return `${label} · ${previewContext.value?.page ?? workspaceName.value}`;
  if (tab.value === "files") return `${label} · ${file.value ?? workspaceName.value}`;
  if (tab.value !== "changes") return `${label} · ${workspaceName.value}`;
  if (target.value === "working") return `${label} · ${t("appBuilder.uncommitted")}`;
  const id = target.value === "latest" ? view.commits[0]?.id : target.value;
  const commit = view.commits.find((item) => item.id === id);
  if (commit) return `${label} · ${shortCommit(commit.id)} ${commit.message}`;
  return id ? `${label} · ${shortCommit(id)}` : label;
});
/** The object selected in the preview's app, while the preview is the open view. */
const contextObject = computed(() => {
  const selection = tab.value === "preview" ? previewContext.value?.selection : null;
  return selection ? selectedObject(selection, t) : null;
});
const pageContext = computed(() =>
  contextObject.value
    ? t("appBuilder.contextSelection", { page: contextPage.value, object: contextObject.value })
    : t("appBuilder.context", { page: contextPage.value }),
);
const tabIcon = computed(() => PANEL_TABS.find((item) => item.id === tab.value)!.icon);

const labels = computed<ShellLabels>(() => ({
  ...shellLabels.value,
  greeting: emptyWorkspace.value ? t("appBuilder.greetingEmpty") : t("appBuilder.greetingWorkspace", { name: workspaceName.value }),
  placeholder: emptyWorkspace.value ? t("appBuilder.placeholderEmpty") : t("appBuilder.placeholder"),
}));

/** Another conversation's run occupies the workspace: which one, when its row is loaded. */
const busy = computed(() => {
  const run = view.workspace?.activeRunId;
  if (!run) return null;
  const holder = nav.sessions.value.find((session) => session.latestRun?.id === run);
  if (holder?.id === sessionId.value) return null;
  return { title: holder ? firstLine(holder.title) || t("appBuilder.newConversation") : null, sessionId: holder?.id ?? null };
});

/** A run starting or stopping changes who occupies the workspace; a stopped run's commit moves HEAD and the views follow. */
function onRun(change: ShellRunChange) {
  void view.refresh();
  if (change.status !== "stopped") return;
  // The agent may have published or rolled the application back: its exports and the catalog are read again.
  void publication.loadReleases();
  void props.platform.catalog.refresh();
  if (!change.workspaceCommit) return;
  target.value = "latest";
  showFlash(t("appBuilder.previewRefreshed", { commit: shortCommit(change.workspaceCommit) }));
}

/* ---- Workspace actions, on the existing workspace interface ---- */
function nameValidator(value: string) {
  const name = value.trim();
  if (!name) return t("common.nameRequired");
  return name.length <= 200 || t("common.nameTooLong");
}
function suggestedName() {
  const names = new Set(workspaces.value.map((item) => item.name));
  let n = 1;
  while (names.has(t("appBuilder.defaultWorkspaceName", { n }))) n++;
  return t("appBuilder.defaultWorkspaceName", { n });
}
async function askName(title: string, confirm: string, value: string) {
  try {
    const answer = await ElMessageBox.prompt(t("appBuilder.workspaceName"), title, {
      confirmButtonText: confirm,
      cancelButtonText: t("common.cancel"),
      inputValue: value,
      inputValidator: nameValidator,
    });
    return answer.value.trim();
  } catch {
    return null;
  }
}
async function createWorkspace() {
  const name = await askName(t("appBuilder.newWorkspace"), t("common.create"), suggestedName());
  if (name === null) return;
  try {
    const created = await builderApi.create(name);
    workspaces.value = [created, ...workspaces.value];
    tab.value = "preview";
    void router.push(builderPath(created.id));
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}
async function renameWorkspace(workspace: Workspace) {
  const name = await askName(t("common.rename"), t("common.save"), workspace.name);
  if (name === null || name === workspace.name) return;
  try {
    const renamed = await builderApi.rename(workspace.id, name);
    workspaces.value = workspaces.value.map((item) => (item.id === renamed.id ? renamed : item));
    if (renamed.id === workspaceId.value) void view.refresh();
    ElMessage.success(t("common.renamed"));
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}
async function deleteWorkspace(workspace: Workspace) {
  try {
    await ElMessageBox.confirm(t("appBuilder.deleteWorkspaceConfirm", { name: workspace.name }), t("common.deleteConfirm"), {
      type: "warning",
      confirmButtonText: t("common.delete"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  try {
    await builderApi.remove(workspace.id);
    workspaces.value = workspaces.value.filter((item) => item.id !== workspace.id);
    ElMessage.success(t("common.deleted"));
    if (workspace.id !== workspaceId.value) return;
    const next = workspaces.value[0];
    void router.replace(next ? builderPath(next.id) : BASE);
  } catch (error) {
    ElMessage.error(errorText(error));
  }
}
function selectWorkspace(id: string) {
  if (id !== workspaceId.value) void router.push(builderPath(id));
}

const column = computed(() => ({
  workspaces: workspaces.value,
  workspacesState: workspacesState.value,
  moreWorkspaces: moreWorkspaces.value,
  workspaceId: workspaceId.value,
  sessions: nav.sessions.value,
  sessionsState: nav.sessionsState.value,
  moreSessions: nav.nextCursor.value !== null,
  sessionId: sessionId.value,
  privateWorkspaces,
}));
const columnEvents = {
  createWorkspace,
  selectWorkspace,
  renameWorkspace,
  deleteWorkspace,
  moreWorkspaces: () => void loadWorkspaces(true),
  retryWorkspaces: () => void loadWorkspaces(),
  newConversation,
  selectSession,
  moreSessions: () => void nav.loadSessions(true),
  retrySessions: () => void nav.loadSessions(),
};
</script>

<template>
  <AgentShell
    v-if="client"
    class="builder-shell"
    v-model:agent-id="agentId"
    v-model:feature-id="featureId"
    v-model:session-id="sessionId"
    v-model:page-view="pageView"
    :workbench="workbench"
    :title="t('appBuilder.title')"
    :client="client"
    :labels="labels"
    :nav="nav"
    :page-context="pageContext"
    @run="onRun"
    @error="ElMessage.error($event)"
  >
    <template #column>
      <WorkspaceColumn v-bind="column" v-on="columnEvents" />
    </template>
    <template #page-header>
      <PanelHeader
        v-model:tab="tab"
        :head-commit="view.workspace?.headCommit ?? null"
        :published="publishedName"
        @refresh-preview="reloadPreview++"
        @publish="publishOpen = true"
      />
    </template>
    <template #feature>
      <WorkspacePanel
        v-model:file="file"
        v-model:target="target"
        v-model:preview-frame="previewFrame"
        :view="view"
        :tab="tab"
        :reload="reloadPreview"
        :flash="flash"
        @show-changes="showChanges"
      />
    </template>
    <template #composer-context="{ pageOpen, inline }">
      <ComposerContext
        :page-open="pageOpen"
        :inline="inline"
        :page="contextPage"
        :icon="tabIcon"
        :selection="contextObject"
        :busy="busy"
        @open-session="selectSession"
      />
    </template>
    <template #message-actions="{ workspaceCommit }">
      <CommitMark v-if="workspaceCommit" :commit="workspaceCommit" @open="showChanges" />
    </template>
  </AgentShell>
  <!-- No workspace yet: the same column, and the way to make the first one. -->
  <div v-else class="builder-start">
    <ShellColumn :label="t('appBuilder.title')">
      <WorkspaceColumn v-bind="column" v-on="columnEvents" />
    </ShellColumn>
    <main v-loading="workspacesState === 'loading'" class="start-main" :aria-busy="workspacesState === 'loading'" :element-loading-text="t('assistant.loading')">
      <div v-if="workspacesState === 'ready' && workspaces.length === 0" class="start-empty">
        <h1>{{ t("appBuilder.startTitle") }}</h1>
        <p>{{ t("appBuilder.startHint") }}</p>
        <el-button type="primary" @click="createWorkspace">{{ t("appBuilder.newWorkspace") }}</el-button>
      </div>
    </main>
  </div>
  <PublishDrawer v-if="view.workspace" v-model:open="publishOpen" :view="view" :platform="platform" :publication="publication" />
</template>

<style scoped>
.builder-shell :deep(.page-pane.side) {
  border: 0;
  border-inline-start: 1px solid var(--el-border-color);
  border-radius: 0;
  box-shadow: none;
}
/* The start frame is the agent shell's frame without a conversation: the column, then the application's area. */
.builder-start {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base);
  line-height: var(--leading-base);
}
.start-main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-xl);
}
.start-empty {
  max-width: 440px;
  margin-top: -8vh;
  text-align: center;
}
.start-empty h1 {
  margin: 0 0 8px;
  font-size: var(--text-xl);
  line-height: var(--leading-xl);
  font-weight: var(--font-semibold);
}
.start-empty p {
  margin: 0 0 var(--spacing-lg);
  color: var(--el-text-color-secondary);
}
@media (max-width: 760px) {
  .builder-start {
    flex-direction: column;
  }
  .builder-start > :deep(.shell-column) {
    flex: 0 0 auto;
    max-height: 240px;
    overflow: auto;
  }
}
</style>
