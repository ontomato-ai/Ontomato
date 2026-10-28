<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { AgentShell, type ShellLabels } from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import type {
  ShellFeatureDeclaration,
  ShellWorkbenchDeclaration,
} from "@ontomato/contracts/agent-shell";
import type { WorkbenchAppearance } from "@ontomato/contracts/workbench-appearance";
import { DashboardHome } from "../../dashboard";
import { getWorkbenchAppearance } from "../api";
import { businessArtifactRenderers } from "../artifacts";
import { createAssistantPort } from "../assistant-port";
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
}>();

const emit = defineEmits<{ featureAction: [id: string] }>();

const WORKBENCH_ID = "business";
const AGENT_KEY = "ontomato.workbench.agent";

const { t } = useI18n();
const port = createAssistantPort(WORKBENCH_ID);
const appearance = ref<WorkbenchAppearance | null>(null);
const editingBrand = ref(false);
const agentId = ref<string | null>(readRemembered());
const featureId = ref<string | null>(null);

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
    {
      id: "agent-config",
      label: t("assistant.featureAgentConfig"),
      icon: "agents",
      availability: "unavailable",
      hint: t("assistant.pending"),
    },
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
}));

const logo = computed(() => appearance.value?.brand.logo || props.defaultLogo);

onMounted(async () => {
  try {
    appearance.value = await getWorkbenchAppearance();
  } catch {
    ElMessage.error(t("appearance.loadFailed"));
  }
});

function appearanceSaved(value: WorkbenchAppearance) {
  appearance.value = value;
  editingBrand.value = false;
}
</script>

<template>
  <AgentShell
    v-model:agent-id="agentId"
    v-model:feature-id="featureId"
    :workbench="workbench"
    :port="port"
    :labels="labels"
    :renderers="businessArtifactRenderers"
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
      <slot v-else name="feature" :feature-id="page" />
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
