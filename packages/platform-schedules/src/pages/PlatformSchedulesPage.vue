<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PlatformTaskFunctionTarget } from "@ontomato/contracts/platform-schedules";
import { createSchedulesApi } from "../api";
import type { PlatformSchedulesHost } from "../host";
import type { Translate } from "../i18n";
import PlatformSchedulesList from "../components/PlatformSchedulesList.vue";

/**
 * The platform's scheduled tasks: the filters and the list with its form and run history. It draws the content area
 * only — the page's header (its title, its description and the "new task" button) belongs to the shell that mounts it —
 * and it knows no router. The host supplies the request layer and the agents; the functions a task may run come from the
 * service's own function-targets answer, by the rule it enforces when a task is saved.
 */
const props = withDefaults(
  defineProps<{
    host: PlatformSchedulesHost;
    /**
     * The agent the reader narrowed to, kept in the address by the host: the service returns that agent's tasks, and
     * "all agents" clears it. Absent when the host has no agent filter (the agent platform's own entry fixes the scope).
     */
    filterAgentId?: string | null;
    /**
     * The task a link points at (the platform reads it from the address and hands it over; the package knows no router).
     * Its run history opens under its row; a task this caller cannot see only leaves the list, with no error.
     */
    taskId?: string | null;
  }>(),
  { filterAgentId: null, taskId: null },
);
const emit = defineEmits<{ openSession: [sessionId: string]; updateFilterAgent: [agentId: string] }>();

const { t, locale } = useI18n();
/** The package's text is merged under `platformSchedules`; the list receives it already resolved. */
const text: Translate = (key, named, count) =>
  count === undefined
    ? t(`platformSchedules.${key}`, named ?? {})
    : t(`platformSchedules.${key}`, named ?? {}, count);

const api = createSchedulesApi(props.host);
const list = ref<{ openNewTask: () => void; reload: () => Promise<void> } | null>(null);
const agents = ref<readonly AgentHostAgent[]>([]);
const functions = ref<readonly PlatformTaskFunctionTarget[]>([]);
/** 403 on the function targets: this account may not schedule functions. Agent tasks stay available. */
const functionsRefused = ref(false);
const pageLocale = computed(() => props.host.locale?.() ?? locale.value);

/**
 * The agents are the host's; the function targets are the service's. Either one failing leaves the list usable, and a
 * refused function list is not an error: the account simply may not schedule functions.
 */
onMounted(async () => {
  const [agentList, functionList] = await Promise.all([
    props.host.agents().catch(() => [] as readonly AgentHostAgent[]),
    api.functionTargets().catch((error: unknown) => {
      functionsRefused.value = api.statusOf(error) === 403;
      return [] as PlatformTaskFunctionTarget[];
    }),
  ]);
  agents.value = agentList;
  functions.value = functionList;
});

function openSession(sessionId: string) {
  props.host.openSession?.(sessionId);
  emit("openSession", sessionId);
}

/** The header's "new task" button belongs to the page that mounts this one; this is how it reaches the list. */
defineExpose({ openNewTask: () => list.value?.openNewTask(), reload: () => list.value?.reload() });
</script>

<template>
  <!-- The list's table scrolls inside its own box, so a narrow window never cuts a column off. -->
  <PlatformSchedulesList
    ref="list"
    :api="api"
    :agents="agents"
    :functions="functions"
    :functions-refused="functionsRefused"
    :agent-filter="filterAgentId"
    :task-id="taskId"
    :locale="pageLocale"
    :t="text"
    @open-session="openSession"
    @update-agent-filter="emit('updateFilterAgent', $event)"
  />
</template>

<style scoped>
/* The page's own body: the list's padding, so the content lines up with the page header above it. */
:deep(.schedules) {
  padding: 0 0 24px;
}
</style>
