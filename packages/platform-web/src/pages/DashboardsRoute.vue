<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { DashboardHome, useDashboardStore } from "@ontomato/workbench-ui/features/dashboard";
import { createAssistantClient } from "@ontomato/workbench-ui/features/workbench/assistant-host";
import { readRememberedAgent } from "@ontomato/workbench-ui/features/workbench";
import { AgentPicker, ShellComposer, type AgentHostAgent } from "@ontomato/agent-shell-ui";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import AppPage from "./AppPage.vue";

/**
 * The dashboards application: the boards conversations add their charts and datasets to.
 *
 * One page, the whole of the application's area, under the platform's one page header (DESIGN.md "Admin page anatomy");
 * the boards are tabs of the page itself, and the address carries the open board as `?dashboardId=`, so a board can be
 * linked and reloaded.
 *
 * There is one counter (DESIGN.md "Applications and shells"): the page's composer carries its message to the agent
 * platform, with the same agent this tab last used and the page it was written on, so the conversation opens beside this
 * same board.
 */
const props = withDefaults(defineProps<{ paired?: boolean }>(), { paired: false });
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const store = useDashboardStore();

// The address names the board; without one the first board opens, as the page always did.
const opened = store
  .loadDashboards({ notifyError: true })
  .then(() => {
    if (!store.currentDashboardId && store.dashboardItems[0]) void store.selectDashboard(store.dashboardItems[0].id);
  })
  .catch(() => {});
void opened;

const agents = ref<AgentHostAgent[]>([]);
void createAssistantClient().listAgents().then((list) => (agents.value = list.filter((agent) => agent.enabled)));
const agentId = ref<string | null>(null);
const remembered = readRememberedAgent();
const chosen = computed(() => agentId.value ?? agents.value.find((agent) => agent.id === remembered)?.id ?? agents.value[0]?.id ?? null);
const labels = computed(() => ({ placeholder: t("assistant.placeholder"), send: t("assistant.send"), stop: t("assistant.stop") }));

function ask(text: string) {
  if (!chosen.value) return;
  void router.push({
    path: platformRoutes.chat.path,
    query: {
      agentId: chosen.value,
      prompt: text,
      page: `${route.path}${Object.keys(route.query).length ? `?${new URLSearchParams(route.query as Record<string, string>)}` : ""}`,
    },
  });
}
</script>

<template>
  <!-- Beside the conversation the shell's page pane owns the frame and the composer; enlarged, this page is the app. -->
  <component :is="props.paired ? 'div' : AppPage" v-bind="props.paired ? {} : {
    title: t('assistant.featureDashboards'),
    labels: { save: t('common.save'), discard: t('common.cancel'), unsavedChanges: t('admin.unsavedChanges') },
  }">
    <DashboardHome />
    <div v-if="!props.paired && agents.length" class="dashboard-ask">
      <ShellComposer :busy="false" :labels="labels" @send="ask">
        <template #agent>
          <AgentPicker variant="pill" :agents="agents" :agent-id="chosen" :label="t('assistant.agent')" @select="agentId = $event" />
        </template>
      </ShellComposer>
    </div>
  </component>
</template>

<style scoped>
/* At the foot of the board, the platform's one composer: what a message asks about is the board above it. */
.dashboard-ask {
  position: sticky;
  bottom: 0;
  z-index: 1;
  width: min(760px, 100%);
  margin-inline: auto;
  padding: var(--spacing-md) 0;
  background: var(--el-bg-color);
}
</style>
