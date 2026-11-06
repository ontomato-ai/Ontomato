<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PlatformSchedulesPage } from "@ontomato/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { schedulesHost } from "@ontomato/workbench-ui";

/**
 * The scheduled-tasks application: every agent's and every function's tasks, in one list.
 *
 * The page filters and edits; this wrapper supplies only what the platform owns — where a run's conversation opens, and
 * that the reader's agent filter lives in the address. The request layer and the agents a task may run come from the one
 * host both places share (`schedulesHost`).
 */
const router = useRouter();
const route = useRoute();
const { locale } = useI18n();

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
</script>

<template>
  <PlatformSchedulesPage
    :host="host"
    :task-id="taskId"
    :filter-agent-id="filterAgentId"
    @update-filter-agent="setFilterAgent"
  />
</template>

<style scoped>
/* The page is the application: it fills the surface, and its own body scrolls. */
:deep(.schedules) {
  padding: 0 28px 24px;
}
</style>
