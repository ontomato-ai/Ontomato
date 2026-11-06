<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Plus } from "lucide-vue-next";
import { PlatformSchedulesPage } from "@ontomato/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { schedulesHost } from "@ontomato/workbench-ui";
import AppPage from "./AppPage.vue";

/**
 * The scheduled-tasks application: every agent's and every function's tasks, in one list.
 *
 * The header is the platform's one page header, and its button is the page's own: it opens the list's "new task" form.
 * The page itself draws the content only — the filters, the table and the run history. The request layer and the agents
 * a task may run come from the one host both places share (`schedulesHost`); the reader's agent filter and the task a
 * link names live in the address.
 */
const router = useRouter();
const route = useRoute();
const { locale, t } = useI18n();
const page = ref<{ openNewTask: () => void } | null>(null);

/**
 * The task an address points at. The old function deep links and the Manager's asset links arrive as `?taskId=`, so the
 * page opens that task's run history; an id it cannot see only leaves the list.
 */
const taskId = computed(() => {
  const value = route.query.taskId;
  return typeof value === "string" && value ? value : null;
});

/** The agent the reader narrowed to (`?agent=`), so the filter survives a reload and can be linked. */
const filterAgentId = computed(() => {
  const value = route.query.agent;
  return typeof value === "string" && value ? value : null;
});

function setFilterAgent(agentId: string) {
  const query = { ...route.query };
  if (agentId) query.agent = agentId;
  else delete query.agent;
  void router.replace({ path: route.path, query });
}

const host = schedulesHost({
  locale: () => locale.value,
  openSession: (sessionId) => {
    void router.push({ name: platformRoutes.chat.name, query: { sessionId } });
  },
});

const actions = computed(() => [
  {
    id: "new-task",
    label: t("platformSchedules.newTask"),
    primary: true,
    icon: Plus,
    onClick: () => page.value?.openNewTask(),
  },
]);
</script>

<template>
  <AppPage
    :title="t('platformSchedules.title')"
    :description="t('platformSchedules.intro')"
    :actions="actions"
    :labels="{ save: t('common.save'), discard: t('common.cancel'), unsavedChanges: t('admin.unsavedChanges') }"
  >
    <PlatformSchedulesPage
      ref="page"
      :host="host"
      :task-id="taskId"
      :filter-agent-id="filterAgentId"
      @update-filter-agent="setFilterAgent"
    />
  </AppPage>
</template>
