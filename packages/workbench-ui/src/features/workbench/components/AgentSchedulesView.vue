<script setup lang="ts">
import { PlatformSchedulesPage, type PlatformSchedulesHost } from "@ontomato/platform-schedules";
import { useI18n } from "vue-i18n";
import { agentHostAgentListSchema } from "@ontomato/contracts/agent-host";
import { apiGet, nodeApiRequest } from "../../../utils/api";

/**
 * The agent platform's scheduled tasks: the platform's one list, limited to the agent this application is showing.
 *
 * The list is the same component the scheduled-tasks application shows, so a task looks and behaves the same wherever it
 * is read; this view only narrows it to one agent and supplies the platform's request layer.
 */
const props = defineProps<{ agentId: string | null }>();
const emit = defineEmits<{ openSession: [sessionId: string] }>();
const { locale } = useI18n();

/**
 * The page's paths start at the gateway's `/api`; the app's requests already carry this deployment's prefix, so the
 * request layer adds the prefix and strips that one segment rather than doubling it.
 */
const host: PlatformSchedulesHost = {
  request: (path, init) => nodeApiRequest(path, init),
  agents: async () => agentHostAgentListSchema.parse(await apiGet("/assistant/agents")).agents,
  openSession: (sessionId) => emit("openSession", sessionId),
  locale: () => locale.value,
};
</script>

<template>
  <PlatformSchedulesPage :host="host" :agent-id="props.agentId" @open-session="emit('openSession', $event)" />
</template>
