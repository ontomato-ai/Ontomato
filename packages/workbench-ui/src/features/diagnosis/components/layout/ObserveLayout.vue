<script setup lang="ts">
import { randomId } from "@ontomato/contracts/random-id";
import { computed, h, onMounted, provide, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import {
  AgentShell,
  ShellNavBody,
  useAgentNav,
  useAppColumn,
  type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import { DIAGNOSIS_AGENT_ID, type DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { agentHostCreateSessionResponseSchema, agentHostAdmissionSchema } from "@ontomato/contracts/agent-host";
import { nodeApiFetch } from "../../../../utils/api";
import { useShellLabels } from "../../../../composables/useShellLabels";
import { workbenchContent } from "../../../../content";
import { diagnosisApi } from "../../api";
import { createDiagnosisClient, diagnosisActionKey } from "../../ops-host";
import DslTestPage from "../dsl-test/DslTestPage.vue";
import KnowledgePage from "../knowledge/KnowledgePage.vue";
import LiveLogsPage from "../live-logs/LiveLogsPage.vue";
import AutotestPage from "../test-run/AutotestPage.vue";
import TurnEvidencePage from "../turns/TurnEvidencePage.vue";

/**
 * The operations agent app (DESIGN.md "Agent apps"): the diagnosis agent plus its pages. The address is the
 * only record of the open page; the open conversation rides along as `sessionId` and survives page navigation.
 */
const route = useRoute(), router = useRouter(), { t } = useI18n();
const client = createDiagnosisClient(), shellLabels = useShellLabels();
const labels = computed(() => ({ ...shellLabels.value, greeting: t("ops.greeting"), placeholder: t("ops.placeholder") }));
const agentId = ref<string | null>(DIAGNOSIS_AGENT_ID);
const pageView = ref<"full" | "side">("full");

const pages = [
  { id: "turn", path: "/ops/turn", label: "ops.turns", icon: "evidence", match: ["/ops/turn"] },
  { id: "test", path: "/ops/test", label: "ops.tests", icon: "test", match: ["/ops/test", "/ops/results", "/ops/cases", "/ops/autotest"] },
  { id: "live-logs", path: "/ops/live-logs", label: "ops.logs", icon: "logs", match: ["/ops/live-logs"] },
  { id: "dsl", path: "/ops/dsl", label: "ops.dsl", icon: "query", match: ["/ops/dsl"] },
  { id: "knowledge", path: "/ops/knowledge", label: "ops.knowledge", icon: "knowledge", match: ["/ops/knowledge"] },
] as const;
const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: "operations",
  label: t("ops.title"),
  features: pages.map(({ id, label, icon }) => ({ id, label: t(label), icon, availability: "page" as const, withConversation: true })),
}));
const pageOf = (path: string) =>
  pages.find((page) => page.match.some((prefix) => path === prefix || path.startsWith(prefix + "/")))?.id ?? null;

/*
 * The shell may set the page and the conversation in one gesture (opening a session closes the page); both land in
 * one navigation so neither reads an address the other is about to replace.
 */
const conversation = ref<string | null>(typeof route.query.sessionId === "string" ? route.query.sessionId : null);
watch(() => route.query.sessionId, (id) => {
  if (typeof id === "string") conversation.value = id;
});
const pendingPage = ref<string | null | undefined>(undefined);
let scheduled = false;
function navigate() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    const page = pendingPage.value;
    const changesPage = page !== undefined && page !== pageOf(route.path);
    const path = !changesPage ? route.path : pages.find((item) => item.id === page)?.path ?? "/ops/diagnosis";
    const rest = { ...route.query };
    delete rest.sessionId;
    const query: LocationQueryRaw = { ...(changesPage ? {} : rest), ...(conversation.value ? { sessionId: conversation.value } : {}) };
    const done = changesPage ? router.push({ path, query }) : router.replace({ path, query });
    void done.catch(() => {}).finally(() => (pendingPage.value = undefined));
  });
}
const featureId = computed({
  get: () => (pendingPage.value !== undefined ? pendingPage.value : pageOf(route.path)),
  set: (id: string | null) => {
    pendingPage.value = id;
    navigate();
  },
});
const sessionId = computed({
  get: () => conversation.value,
  set: (id: string | null) => {
    conversation.value = id;
    navigate();
  },
});

/** One line telling the agent which page and item "this" refers to. */
const pageContext = computed(() => {
  const page = pages.find((item) => item.id === featureId.value);
  if (!page) return null;
  const name = t(page.label), params = route.params, query = route.query;
  let item = "";
  if (page.id === "turn" && typeof params.turnKey === "string") item = t("ops.contextTurn", { key: params.turnKey });
  else if (page.id === "test" && typeof params.caseId === "string") item = t("ops.contextCase", { run: String(params.runId), case: params.caseId });
  else if (page.id === "test" && typeof query.runId === "string") item = t("ops.contextRun", { run: query.runId });
  return t("ops.context", { page: item ? `${name} · ${item}` : name });
});

/** Answers may link the app's own pages (e.g. `/observe/turn/<key>`); they open beside the conversation. */
function pageLinks(href: string) {
  const path = href.replace(/^#/, "").replace(/^\/observe(?=\/)/, "/ops").split("?")[0] ?? "";
  if (!pageOf(path)) return null;
  return () => {
    const query = conversation.value ? { sessionId: conversation.value } : {};
    void router.push({ path, query }).catch(() => {});
  };
}

const starting = ref(false);
async function startDiagnosis(target: DiagnosisTarget, fromRoute = false) {
  if (starting.value) return false;
  starting.value = true;
  const session = fromRoute && typeof route.query.diagnosisSessionId === "string" ? route.query.diagnosisSessionId : randomId();
  const run = fromRoute && typeof route.query.diagnosisRunId === "string" ? route.query.diagnosisRunId : randomId();
  try {
    if (fromRoute) await router.replace({ path: route.path, query: { ...route.query, diagnosisSessionId: session, diagnosisRunId: run } });
    const created = await nodeApiFetch("/observe/diagnoses", "POST", { target }, { headers: { "Idempotency-Key": session } });
    agentHostCreateSessionResponseSchema.parse(await created.json());
    const admitted = await nodeApiFetch(`/observe/agent/sessions/${session}/runs`, "POST", { message: workbenchContent().text.observe.autoTurnDiagnosisMessage }, { headers: { "Idempotency-Key": run } });
    agentHostAdmissionSchema.parse(await admitted.json());
    // Started from a page, the diagnosis opens beside the evidence it is about.
    if (pageOf(route.path)) pageView.value = "side";
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
 * The one navigation state of this application: the platform column lists the diagnosis conversation from it, and the
 * conversation promotes into it while sending.
 */
const nav = useAgentNav({
  client: () => client,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => sessionId.value,
  setSessionId: (id) => (sessionId.value = id),
  onLeaveConversation: () => (featureId.value = null),
});
const { agents, sessions, sessionsState, nextCursor } = nav;

useAppColumn(() => ({
  appId: "ops",
  content: () =>
    h(ShellNavBody, {
      workbench: workbench.value,
      agents: agents.value,
      agentId: agentId.value,
      sessions: sessions.value,
      sessionsState: sessionsState.value,
      hasMore: nextCursor.value !== null,
      sessionId: sessionId.value,
      featureId: featureId.value,
      // The column is drawn outside the conversation's provider, so the shell's words are passed in.
      labels: labels.value,
      onNewConversation: () => nav.startNew(),
      onSelectFeature: (id: string) => (featureId.value = id),
      onFeatureAction: () => {},
      onSelectAgent: (id: string) => (agentId.value = id),
      onSelectSession: (id: string) => (sessionId.value = id),
      onDeleteSession: (id: string) => void nav.removeSession(id),
      onLoadMore: () => void nav.loadSessions(true),
      onRetry: () => void nav.loadSessions(),
    }),
}));

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
    v-model:feature-id="featureId"
    v-model:session-id="sessionId"
    v-model:page-view="pageView"
    :workbench="workbench"
    :client="client"
    :labels="labels"
    :nav="nav"
    :page-context="pageContext"
    :page-links="pageLinks"
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
    </template>
  </AgentShell>
</template>

<style scoped>
.ops-padded {
  box-sizing: border-box;
  height: 100%;
  padding: 12px;
}
</style>
