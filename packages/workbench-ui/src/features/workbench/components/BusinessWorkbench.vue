<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import {
  AgentShell,
  type ShellFeatureDeclaration,
  type ShellLabels,
  type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { AgentSettingsPage } from "../../agents";
import { DashboardHome } from "../../dashboard";
import { useDashboardStore } from "../../dashboard/stores/dashboard";
import { getWorkbenchAppearance } from "../api";
import { nativeEchartsTheme } from "../../dashboard/components/utils/echartsTheme";
import { createAssistantClient, createAssistantFeedback } from "../assistant-host";
import ConversationActions from "./ConversationActions.vue";
import DatasetActions from "./DatasetActions.vue";
import WorkbenchAppearanceDialog from "./WorkbenchAppearanceDialog.vue";

/**
 * The one business workbench both editions mount. Editions add their own feature entries and
 * render those pages through the `feature` slot; everything else is shared.
 */
const props = defineProps<{
  /** Edition-specific entries, placed after the shared dashboard entry. */
  features?: ShellFeatureDeclaration[];
  defaultLogo: string;
  defaultBrandName: string;
  /** Whether the current user may manage agent definitions (the edition's permission). */
  canManageAgents: boolean;
}>();

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";
const AGENT_KEY = "ontomato.workbench.agent";

const { t } = useI18n();
const client = createAssistantClient();
const feedback = createAssistantFeedback();
const dashboards = useDashboardStore();
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
const agentId = ref<string | null>(readRemembered());
const featureId = ref<string | null>(null);
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
  features: [
    { id: "dashboards", label: t("assistant.featureDashboards"), icon: "dashboard", availability: "page" },
    ...(props.features ?? []),
    ...(props.canManageAgents
      ? [{ id: "agent-config", label: t("assistant.featureAgentConfig"), icon: "agents", availability: "page" as const }]
      : []),
    {
      id: "schedule",
      label: t("assistant.featureSchedule"),
      icon: "schedule",
      availability: "unavailable",
      hint: t("assistant.unavailable"),
    },
  ],
}));

const labels = computed<ShellLabels>(() => ({
  newConversation: t("assistant.newConversation"),
  agent: t("assistant.agent"),
  sessions: t("assistant.sessions"),
  noSessions: t("assistant.noSessions"),
  more: t("assistant.more"),
  loadFailed: t("assistant.loadFailed"),
  retry: t("assistant.retry"),
  deleteSession: t("assistant.deleteSession"),
  deleteConfirm: t("assistant.deleteConfirm"),
  unavailable: t("assistant.unavailable"),
  placeholder: t("assistant.placeholder"),
  send: t("assistant.send"),
  stop: t("assistant.stop"),
  greeting: t("assistant.greeting"),
  steps: (count) => t("assistant.steps", { n: count }, count),
  thinking: t("assistant.thinking"),
  working: t("assistant.working"),
  toolInput: t("assistant.toolInput"),
  toolOutput: t("assistant.toolOutput"),
  stopped: t("assistant.stopped"),
  truncated: t("assistant.truncated"),
  failed: t("assistant.failed"),
  copy: t("assistant.copy"),
  copied: t("assistant.copied"),
  like: t("assistant.like"),
  dislike: t("assistant.dislike"),
  feedbackReason: t("assistant.feedbackReason"),
  submit: t("assistant.submit"),
  cancel: t("assistant.cancel"),
  open: t("assistant.open"),
  download: t("assistant.download"),
  close: t("assistant.close"),
  preparing: t("assistant.preparing"),
  artifactMissing: t("assistant.artifactMissing"),
  menu: t("assistant.menu"),
  scrollToBottom: t("assistant.scrollToBottom"),
  loading: t("assistant.loading"),
  rows: (count) => t("assistant.rows", { n: count }, count),
  emptyFile: t("assistant.emptyFile"),
  invalidChart: t("assistant.invalidChart"),
  previousPage: t("assistant.previousPage"),
  nextPage: t("assistant.nextPage"),
  toolRead: t("assistant.toolRead"),
  toolWrite: t("assistant.toolWrite"),
  toolEdit: t("assistant.toolEdit"),
  toolBash: t("assistant.toolBash"),
  toolSkill: t("assistant.toolSkill"),
}));

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

function appearanceSaved(value: WorkbenchAppearance) {
  appearance.value = value;
  editingBrand.value = false;
}
</script>

<template>
  <AgentShell
    ref="shell"
    v-model:agent-id="agentId"
    v-model:feature-id="featureId"
    :workbench="workbench"
    :client="client"
    :labels="labels"
    :feedback="feedback"
    :chart-theme="nativeEchartsTheme"
    @error="ElMessage.error($event)"
    @feature-action="emit('featureAction', $event)"
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
      <AgentSettingsPage v-else-if="page === 'agent-config'" @changed="shell?.reloadAgents()" />
      <slot v-else name="feature" :feature-id="page" />
    </template>
    <template #artifact-actions="{ artifact }">
      <DatasetActions :artifact="artifact" @open-dashboard="openDashboard" />
    </template>
    <template #message-actions="{ sessionId }">
      <ConversationActions v-if="sessionId" :session-id="sessionId" />
    </template>
    <template #footer>
      <slot name="footer" />
    </template>
  </AgentShell>
  <WorkbenchAppearanceDialog
    v-if="editingBrand"
    :default-logo="defaultLogo"
    @close="editingBrand = false"
    @saved="appearanceSaved"
  />
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  border-radius: 10px;
}
.brand:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.brand-logo {
  width: 30px;
  height: 30px;
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
  font-weight: 700;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brand-subtitle {
  font-size: var(--text-xs);
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
