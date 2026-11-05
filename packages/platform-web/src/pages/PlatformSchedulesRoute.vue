<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PlatformSchedulesPage } from "@ontomato/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { schedulesHost } from "@ontomato/workbench-ui";

/**
 * The platform's scheduled tasks: every agent's and every function's, in one list.
 *
 * The page filters and edits; this wrapper supplies only what the platform owns — where a run's conversation opens. The
 * request layer and the agents a task may run come from the one host both places share (`schedulesHost`).
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

const host = schedulesHost({
  locale: () => locale.value,
  openSession: (sessionId) => {
    void router.push({ name: platformRoutes.chat.name, query: { sessionId } });
  },
});
</script>

<template>
  <PlatformSchedulesPage :host="host" :task-id="taskId" />
</template>
