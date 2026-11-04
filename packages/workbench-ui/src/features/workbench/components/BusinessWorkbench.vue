<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import {
  AgentShell,
  type ShellFeatureDeclaration,
  type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { AgentsPage } from "../../agents";
import { DashboardHome } from "../../dashboard";
import { ScheduledTasksPage } from "../../scheduled-tasks";
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
import { useOntologyServiceAccess } from "../../../app/ontology-service";

/**
 * The one business workbench both editions mount. Editions add their own feature entries and render those pages through
 * the `feature` slot; everything else is shared.
 */
const props = withDefaults(
  defineProps<{
    /** Edition-specific entries, placed after the shared dashboard entry (see workbenchFeatures). */
    features?: ShellFeatureDeclaration[];
    defaultLogo: string;
    defaultBrandName: string;
    /** The edition's permission check for the function area's entries; open source shows everything. */
    can?: (permission: string) => boolean;
  }>(),
  { features: () => [], can: () => true },
);

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";
const AGENT_KEY = "ontomato.workbench.agent";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const ontologyService = useOntologyServiceAccess();
const client = createAssistantClient();
const feedback = createAssistantFeedback();
const dashboards = useDashboardStore();
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
const agentId = ref<string | null>(readRemembered());
const featureId = ref<string | null>(null);
/**
 * The feature the address asked for, kept until the shell has resolved its agents: resolving a remembered agent that no
 * longer exists clears the open feature, which would also drop the page the address asked for. It is replayed once.
 */
const requestedFeatureId = ref<string | null>(null);
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
  if (!requestedFeatureId.value) return;
  if (featureId.value === null) featureId.value = requestedFeatureId.value;
  requestedFeatureId.value = null;
});

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: WORKBENCH_ID,
  label: appearance.value?.brand.name || props.defaultBrandName,
  features: workbenchFeatures(t, props.features, props.can, ontologyService.visible()),
}));

const labels = useShellLabels();

const logo = computed(() => appearance.value?.brand.logo || props.defaultLogo);

onMounted(async () => {
  try {
    appearance.value = await getWorkbenchAppearance();
  } catch {
    ElMessage.error(t("appearance.loadFailed"));
  }
});

function openDashboard(id: string) {
  void dashboards.selectDashboard(id);
  featureId.value = "dashboards";
}

/** Opens a conversation that a scheduled run started; switching the agent first resets the shell's session. */
async function openScheduledSession(target: { agentId: string; sessionId: string }) {
  featureId.value = null;
  if (agentId.value !== target.agentId) {
    agentId.value = target.agentId;
    await nextTick();
  }
  conversationId.value = target.sessionId;
}

function appearanceSaved(value: WorkbenchAppearance) {
  appearance.value = value;
  editingBrand.value = false;
}

/** The agents page's tab is part of the address, so a link to the capability library opens it directly. */
const agentsTab = ref<"agents" | "capabilities" | null>(null);

function requestedTab(): "agents" | "capabilities" | null {
  const tab = route.query.tab;
  return tab === "capabilities" ? "capabilities" : tab === "agents" ? "agents" : null;
}

/** Entries that are pages of their own conversation shell open in a new tab, like the Ontology Service link. */
function openSeparatePage(path: string) {
  window.open(router.resolve(path).href, "_blank", "noopener");
}

function handleFeatureAction(id: string) {
  if (id === "ops-diagnosis") openSeparatePage("/observe");
  emit("featureAction", id);
}

/**
 * An address may name a feature and a tab (the legacy console addresses and deep links); the shell opens it, and drops
 * the parameters so a later navigation to plain /chat is a clean conversation. Watched on mount and on every query
 * change, because a link inside the running workbench does not remount it.
 */
watch(
  () => route.query.feature,
  (requested) => {
    if (requested !== "agents" && requested !== "dashboards" && requested !== "schedule" && requested !== "chat") return;
    // "chat" names the conversation itself: it closes whatever page was open (the retired console pages land here).
    const page = requested === "chat" ? null : requested;
    requestedFeatureId.value = page;
    featureId.value = page;
    agentsTab.value = requested === "agents" ? requestedTab() : null;
    const query = { ...route.query };
    delete query.feature;
    delete query.tab;
    void router.replace({ path: route.path, query });
  },
  { immediate: true },
);
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
    :feedback="feedback"
    :chart-theme="nativeEchartsTheme"
    @error="ElMessage.error($event)"
    @feature-action="handleFeatureAction"
  >
    <template #brand>
      <div
        class="brand"
        tabindex="0"
        @contextmenu.prevent="editingBrand = true"
        @keydown.shift.f10.prevent="editingBrand = true"
      >
        <img class="brand-logo" :src="logo" alt="" />
        <span class="brand-text">
          <span class="brand-name">{{ workbench.label }}</span>
          <span v-if="appearance?.brand.subtitle" class="brand-subtitle">{{ appearance.brand.subtitle }}</span>
        </span>
      </div>
    </template>
    <template #feature="{ featureId: page }">
      <DashboardHome v-if="page === 'dashboards'" />
      <AgentsPage v-else-if="page === 'agents'" :can="props.can" :initial-tab="agentsTab" @changed="shell?.reloadAgents()" />
      <ScheduledTasksPage v-else-if="page === 'schedule'" @open-session="openScheduledSession" />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #artifact-actions="{ artifact }">
      <DatasetActions :artifact="artifact" @open-dashboard="openDashboard" />
    </template>
    <template #message-actions="{ sessionId, runId }">
      <TurnDiagnoseButton v-if="sessionId && runId" :session-id="sessionId" :run-id="runId" />
      <ConversationActions v-if="sessionId" :session-id="sessionId" />
    </template>
    <template #footer>
      <slot name="footer" />
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
.brand:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.brand-logo {
  width: 24px;
  height: 24px;
  object-fit: contain;
  flex-shrink: 0;
}
.brand-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.brand-name {
  font-size: var(--text-base);
  line-height: var(--leading-sm);
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand-subtitle {
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
