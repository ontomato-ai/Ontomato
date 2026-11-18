<script setup lang="ts">
import { randomId } from "@ontomato/contracts/random-id";
import { computed, onMounted, provide, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import {
  AgentShell, useAgentNav, useConversationDisplay, useSessionRunFeed,
  type DisplayPage, type PageContext, type PageSelection, type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import { useAgentModelLabels, useLeaveConfirmation } from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import { DIAGNOSIS_AGENT_ID, type DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { useShellLabels } from "../../../../composables/useShellLabels";
import { workbenchContent } from "../../../../content";
import { diagnosisApi } from "../../api";
import { createDiagnosisClient, diagnosisActionKey } from "../../ops-host";
import DslTestPage from "../dsl-test/DslTestPage.vue";
import KnowledgePage from "../knowledge/KnowledgePage.vue";
import LiveLogsPage from "../live-logs/LiveLogsPage.vue";
import AutotestPage from "../test-run/AutotestPage.vue";
import TurnEvidencePage from "../turns/TurnEvidencePage.vue";
import OpsModelPage from "../model/OpsModelPage.vue";

/**
 * The operations agent app (DESIGN.md "Agent apps"): the diagnosis agent plus its pages. The address is the
 * only record of the open page; the open conversation rides along as `sessionId` and survives page navigation.
 */
const route = useRoute(), router = useRouter(), { t } = useI18n();
const client = createDiagnosisClient(), shellLabels = useShellLabels();
const labels = computed(() => ({ ...shellLabels.value, greeting: t("ops.greeting"), placeholder: t("ops.placeholder") }));
const agentId = ref<string | null>(DIAGNOSIS_AGENT_ID);

const pages = [
  { id: "turn", path: "/ops/turn", label: "ops.turns", icon: "evidence", match: ["/ops/turn"] },
  { id: "test", path: "/ops/test", label: "ops.tests", icon: "test", match: ["/ops/test", "/ops/results", "/ops/cases", "/ops/autotest"] },
  { id: "live-logs", path: "/ops/live-logs", label: "ops.logs", icon: "logs", match: ["/ops/live-logs"] },
  { id: "dsl", path: "/ops/dsl", label: "ops.dsl", icon: "query", match: ["/ops/dsl"] },
  { id: "knowledge", path: "/ops/knowledge", label: "ops.knowledge", icon: "knowledge", match: ["/ops/knowledge"] },
] as const;
/** The model the diagnosis runs on: the application's own entry at the foot of its column, not one of its pages. */
const MODEL = { id: "model", path: "/ops/model" } as const;
const modelLabels = useAgentModelLabels();
const bottomEntry = computed(() => ({ label: modelLabels.value.title, icon: "models", page: MODEL.id }));
const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: "operations",
  // The application's name is the platform's (the rail and this column read one entry): the platform decides it.
  label: t("platform.operations"),
  // Every page here draws its own pane (a list beside a detail, an editor, a log terminal) and scrolls inside it, so the
  // shell leaves it the whole height and each page marks where its content ends.
  features: pages.map(({ id, label, icon }) => ({
    id,
    label: t(label),
    icon,
    availability: "page" as const,
    withConversation: true,
    scrollsItself: true,
  })),
}));
const pageOf = (path: string) =>
  path === MODEL.path
    ? MODEL.id
    : (pages.find((page) => page.match.some((prefix) => path === prefix || path.startsWith(prefix + "/")))?.id ?? null);

/*
 * The shell may set the page and the conversation in one gesture (opening a session closes the page); both land in
 * one navigation so neither reads an address the other is about to replace.
 */
const conversation = ref<string | null>(typeof route.query.sessionId === "string" ? route.query.sessionId : null);
watch(() => route.query.sessionId, (id) => {
  if (typeof id === "string") conversation.value = id;
});
let pendingPath: string | null = null;
let scheduled: Promise<boolean> | null = null;
function navigate(): Promise<boolean> {
  scheduled ??= Promise.resolve().then(async () => {
    scheduled = null;
    const path = pendingPath ?? route.path;
    pendingPath = null;
    const changesPage = path !== route.path;
    const rest = { ...route.query };
    delete rest.sessionId;
    const query: LocationQueryRaw = { ...(changesPage ? {} : rest), ...(conversation.value ? { sessionId: conversation.value } : {}) };
    const failure = await (changesPage ? router.push({ path, query }) : router.replace({ path, query })).catch((error: unknown) => error);
    return !failure;
  });
  return scheduled;
}
const sessionId = computed({
  get: () => conversation.value,
  set: (id: string | null) => {
    conversation.value = id;
    void navigate();
  },
});

/**
 * What sits beside the conversation is this application's display: its pages are its own routes, so a page's address is
 * the route's path, a page's own navigation moves the address, and the address bar is what the display follows. Answers
 * may link the app's pages under their old prefix too (`/observe/turn/<key>`).
 */
function pageAt(path: string): DisplayPage | null {
  const id = pageOf(path);
  return id ? { featureId: id, address: path, instance: id } : null;
}
/** A page holding unsaved changes (the model) stays until the reader confirms leaving it. */
const leave = useLeaveConfirmation();
const display = useConversationDisplay({
  features: () => workbench.value.features,
  resolve: (href) => pageAt(href.replace(/^#/, "").replace(/^\/observe(?=\/)/, "/ops").split("?")[0] ?? ""),
  feature: (id) => pageAt([...pages, MODEL].find((item) => item.id === id)?.path ?? ""),
  serialize: (page) => {
    const path = page?.address ?? "/ops/diagnosis";
    if (path === route.path) return Promise.resolve(true);
    pendingPath = path;
    return navigate();
  },
  context: (page) => pageContext(page.featureId),
  leave: { leaves: (address) => leave.leaves(address ?? "/ops/diagnosis"), confirm: () => leave.confirm() },
});
watch(() => route.path, (path) => display.follow(path), { immediate: true });

/** Which page "this" refers to, and the item it names: the message carries the item, and the page once. */
function pageContext(id: string): PageContext {
  const page = pages.find((item) => item.id === id);
  if (!page) return { pageKey: `ops.${id}`, url: route.fullPath, label: modelLabels.value.title, selection: [] };
  const params = route.params, query = route.query;
  let selection: PageSelection | null = null;
  if (page.id === "turn" && typeof params.turnKey === "string")
    selection = { kind: "turn", id: params.turnKey, label: t("ops.contextTurn", { key: params.turnKey }) };
  else if (page.id === "test" && typeof params.caseId === "string")
    selection = { kind: "case", id: params.caseId, label: t("ops.contextCase", { run: String(params.runId), case: params.caseId }) };
  else if (page.id === "test" && typeof query.runId === "string")
    selection = { kind: "run", id: query.runId, label: t("ops.contextRun", { run: query.runId }) };
  return { pageKey: `ops.${page.id}`, url: route.fullPath, label: t(page.label), selection: selection ? [selection] : [] };
}

const starting = ref(false);
async function startDiagnosis(target: DiagnosisTarget, fromRoute = false) {
  if (starting.value) return false;
  starting.value = true;
  const session = fromRoute && typeof route.query.diagnosisSessionId === "string" ? route.query.diagnosisSessionId : randomId();
  const run = fromRoute && typeof route.query.diagnosisRunId === "string" ? route.query.diagnosisRunId : randomId();
  try {
    if (fromRoute) await router.replace({ path: route.path, query: { ...route.query, diagnosisSessionId: session, diagnosisRunId: run } });
    await diagnosisApi.startDiagnosis(target, session, run, workbenchContent().text.observe.autoTurnDiagnosisMessage);
    // Started from a page, the diagnosis opens beside the evidence it is about.
    if (pageOf(route.path)) void display.setView("side");
    conversation.value = session;
    await router.replace({ path: route.path, query: { sessionId: session } });
    return true;
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : t("diagnosis.requestFailed")); return false; }
  finally { starting.value = false; }
}
provide(diagnosisActionKey, startDiagnosis);
watch(() => [route.query.diagnose, route.query.sourceSessionId, route.query.sourceRunId], () => {
  if (route.query.diagnose === "1" && typeof route.query.sourceSessionId === "string" && typeof route.query.sourceRunId === "string")
    void startDiagnosis({ kind: "assistant-run", sessionId: route.query.sourceSessionId, runId: route.query.sourceRunId }, true);
}, { immediate: true });

/**
 * The one navigation state of this application: its column lists the diagnosis conversation from it, and the
 * conversation promotes into it while sending.
 */
const nav = useAgentNav({
  client: () => client,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => sessionId.value,
  setSessionId: (id) => (sessionId.value = id),
  onLeaveConversation: () => void display.close(),
});
// The one list notice stream of this page: every diagnosis conversation it lists follows its run, open or not.
useSessionRunFeed({
  port: client.sessionRuns,
  sessions: () => nav.sessions.value,
  // The conversation's display takes what its runs present; the stream asks for the binding that lets them.
  presentation: true,
  onError: (error) => ElMessage.error(error instanceof Error ? error.message : String(error)),
});

onMounted(async () => {
  await nav.loadAgents().catch(() => {});
  await nav.loadSessions();
  // Entering operations is the explicit lazy-load boundary for the log source configuration.
  void diagnosisApi.initializeLogSourceConfig().catch((error) => console.warn("Failed to initialize observe backend config", error));
});
</script>

<template>
  <AgentShell
    v-model:agent-id="agentId"
    v-model:session-id="sessionId"
    :display="display"
    :workbench="workbench"
    :title="t('platform.operations')"
    :bottom="bottomEntry"
    :client="client"
    :labels="labels"
    :nav="nav"
    @open-bottom="display.openFeature('model')"
    @error="ElMessage.error($event)"
  >
    <template #feature="{ featureId: page }">
      <TurnEvidencePage v-if="page === 'turn'" />
      <AutotestPage v-else-if="page === 'test'" />
      <LiveLogsPage v-else-if="page === 'live-logs'" class="ops-padded" />
      <DslTestPage v-else-if="page === 'dsl'" class="ops-padded">
        <template #result-tabs="scope"><slot name="dsl-result-tabs" v-bind="scope" /></template>
      </DslTestPage>
      <KnowledgePage v-else-if="page === 'knowledge'" class="ops-padded" />
      <OpsModelPage v-else-if="page === 'model'" />
    </template>
  </AgentShell>
</template>

<style scoped>
.ops-padded {
  box-sizing: border-box;
  height: 100%;
  padding: var(--page-section-padding);
}
</style>
