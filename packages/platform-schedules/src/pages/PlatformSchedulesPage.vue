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
 * The platform's scheduled tasks page: the list with its form and run history. The host supplies the request layer and
 * the agents; the functions a task may run come from the service's own function-targets answer, by the rule it enforces
 * when a task is saved. The page draws only the content area, because the platform shell owns the page header (DESIGN
 * "Data shell").
 */
const props = withDefaults(
  defineProps<{
    host: PlatformSchedulesHost;
    /** Show one agent's tasks only (the agent platform's entry) and preselect it for a new task. */
    agentId?: string | null;
    /** Start on one application's tasks; the reader can change the filter. */
    appId?: string | null;
  }>(),
  { agentId: null, appId: null },
);
const emit = defineEmits<{ openSession: [sessionId: string] }>();

const { t, locale } = useI18n();
/** The package's text is merged under `platformSchedules`; the list receives it already resolved. */
const text: Translate = (key, named, count) =>
  count === undefined
    ? t(`platformSchedules.${key}`, named ?? {})
    : t(`platformSchedules.${key}`, named ?? {}, count);

const api = createSchedulesApi(props.host);
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
</script>

<template>
  <PlatformSchedulesList
    :api="api"
    :agents="agents"
    :functions="functions"
    :functions-refused="functionsRefused"
    :agent-id="agentId"
    :app-id="appId"
    :locale="pageLocale"
    :t="text"
    @open-session="openSession"
  />
</template>
