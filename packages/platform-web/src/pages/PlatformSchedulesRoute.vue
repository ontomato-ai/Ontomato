<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { PlatformSchedulesPage } from "@ontomato/platform-schedules";
import { platformRoutes } from "@ontomato/platform-shell/routes";
import { apiGet } from "@ontomato/workbench-ui";
import { agentHostAgentListSchema } from "@ontomato/contracts/agent-host";
import { schedulesHost } from "../schedules";

/**
 * The platform's scheduled tasks: every agent's and every function's, in one list.
 *
 * The page filters and edits; this wrapper supplies only what the platform owns — the request layer with the deployment
 * prefix and the session's credential, the agents a task may run, and the way to open a run's conversation.
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
  agents: async () => agentHostAgentListSchema.parse(await apiGet("/assistant/agents")).agents,
  locale: () => locale.value,
  openSession: (sessionId) => {
    void router.push({ name: platformRoutes.chat.name, query: { sessionId } });
  },
});
</script>

<template>
  <PlatformSchedulesPage :host="host" :task-id="taskId" />
</template>
