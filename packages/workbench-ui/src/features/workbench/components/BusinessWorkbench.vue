<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from "vue";
import { platformRoutes as routes } from "@ontomato/platform-shell/routes";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  AgentShell,
  ShellNavBody,
  useAgentNav,
  useAppColumn,
  type ShellFeatureDeclaration,
  type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { AgentsPage } from "../../agents";
import { DashboardHome } from "../../dashboard";
import { useDashboardStore } from "../../dashboard/stores/dashboard";
import { getWorkbenchAppearance } from "../api";
import { nativeEchartsTheme } from "../../dashboard/components/utils/echartsTheme";
import { createAssistantClient, createAssistantFeedback } from "../assistant-host";
import { useShellLabels } from "../../../composables/useShellLabels";
import TurnDiagnoseButton from "../../diagnosis/components/TurnDiagnoseButton.vue";
import ConversationActions from "./ConversationActions.vue";
import DatasetActions from "./DatasetActions.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";
import { workbenchFeatures } from "../features";

/**
 * The agent platform's conversation area: the assistant, its conversation and its own pages. Both editions mount it; the
 * edition adds the entries only it has and renders those pages through the `feature` slot.
 *
 * The navigation is not drawn here: it is contributed to the platform's application column, from the same navigation
 * state this conversation sends from, so a conversation created while sending appears in the column immediately.
 */
type PermissionCheck = Parameters<typeof workbenchFeatures>[2];

const props = withDefaults(
  defineProps<{
    /** Edition-specific entries, placed after the shared dashboard entry (see workbenchFeatures). */
    features?: ShellFeatureDeclaration[];
    defaultLogo: string;
    defaultBrandName: string;
    /** The edition's permission check for the function area's entries; open source shows everything. */
    can?: PermissionCheck;
  }>(),
  { features: () => [], can: () => true },
);

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";
const AGENT_KEY = "ontomato.workbench.agent";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const client = createAssistantClient();
const feedback = createAssistantFeedback();
const dashboards = useDashboardStore();
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
const agentId = ref<string | null>(readRemembered());
const featureRoutes = { dashboards: routes.dashboards, agents: routes.agents };
const featureId = computed<string | null>({
  get: () => Object.entries(featureRoutes).find(([, page]) => page.name === route.name)?.[0] ?? null,
  set: (id) => {
    const target = featureRoutes[id as keyof typeof featureRoutes] ?? routes.chat;
    if (route.name !== target.name) void router.push({ name: target.name });
  },
});
const conversationId = ref<string | null>(null);
const shell = ref<{ reloadAgents: () => Promise<void> } | null>(null);

function readRemembered(): string | null {
  try {
    return localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}
watch(agentId, (id) => {
  try {
    if (id) localStorage.setItem(AGENT_KEY, id);
  } catch {
    // Remembering the agent is a convenience only.
  }
});

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand.name || props.defaultBrandName,
  features: workbenchFeatures(t, props.features, props.can),
}));

const labels = useShellLabels();

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
  onLeaveConversation: () => (featureId.value = null),
});
const { agents, sessions, sessionsState, nextCursor } = nav;

/** The column shows this application's navigation: new conversation, its entries, the agent and the history. */
useAppColumn(() => ({
  appId: "agents",
  content: () =>
    h(ShellNavBody, {
      workbench: workbench.value,
      agents: agents.value,
      agentId: agentId.value,
      sessions: sessions.value,
      sessionsState: sessionsState.value,
      hasMore: nextCursor.value !== null,
      sessionId: conversationId.value,
      featureId: featureId.value,
      // The column is drawn outside the conversation's provider, so the shell's words are passed in.
      labels: labels.value,
      onNewConversation: () => nav.startNew(),
      onSelectFeature: (id: string) => {
        featureId.value = id;
      },
      onFeatureAction: (id: string) => emit("featureAction", id),
      onSelectAgent: (id: string) => (agentId.value = id),
      onSelectSession: (id: string) => nav.selectSession(id),
      onDeleteSession: (id: string) => void nav.removeSession(id),
      onLoadMore: () => void nav.loadSessions(true),
      onRetry: () => void nav.loadSessions(),
    }),
}));

onMounted(async () => {
  try {
    appearance.value = await getWorkbenchAppearance();
  } catch {
    ElMessage.error(t("appearance.loadFailed"));
  }
  // The column shows the list, so the agent platform loads it; the conversation only reads the state.
  await nav.loadAgents().catch((error) => ElMessage.error(error instanceof Error ? error.message : String(error)));
  await nav.loadSessions();
});

function openDashboard(id: string) {
  void dashboards.selectDashboard(id);
  featureId.value = "dashboards";
}

function appearanceSaved(value: WorkbenchAppearance) {
  appearance.value = value;
  editingBrand.value = false;
}

/** The agents page's tab is part of the address, so a link to the capability library opens it directly. */
const agentsTab = computed(() => route.query.tab === "capabilities" ? "capabilities" : "agents");
</script>

<template>
  <AgentShell
    ref="shell"
    v-model:agent-id="agentId"
    v-model:feature-id="featureId"
    v-model:session-id="conversationId"
    :workbench="workbench"
    :client="client"
    :labels="labels"
    :nav="nav"
    :feedback="feedback"
    :chart-theme="nativeEchartsTheme"
    @error="ElMessage.error($event)"
    @feature-action="emit('featureAction', $event)"
  >
    <template #feature="{ featureId: page }">
      <DashboardHome v-if="page === 'dashboards'" />
      <AgentsPage v-else-if="page === 'agents'" :can="props.can" :initial-tab="agentsTab" @changed="shell?.reloadAgents()" />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #artifact-actions="{ artifact }">
      <DatasetActions :artifact="artifact" @open-dashboard="openDashboard" />
    </template>
    <template #message-actions="{ sessionId, runId }">
      <TurnDiagnoseButton v-if="sessionId && runId" :session-id="sessionId" :run-id="runId" />
      <ConversationActions v-if="sessionId" :session-id="sessionId" />
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
