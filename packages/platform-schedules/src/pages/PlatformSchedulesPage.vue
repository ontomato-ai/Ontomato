<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import { createSchedulesApi } from "../api";
import type { PlatformScheduleFunction, PlatformSchedulesHost } from "../host";
import type { Translate } from "../i18n";
import PlatformSchedulesList from "../components/PlatformSchedulesList.vue";

/**
 * The platform's scheduled tasks page: the list with its form and run history. The host supplies the request layer and
 * the two target catalogs; the page draws only the content area, because the platform shell owns the page header (DESIGN
 * "Data shell"). Which tasks exist, who may see them and which function tasks exist are the service's answers.
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
const functions = ref<readonly PlatformScheduleFunction[]>([]);
const pageLocale = computed(() => props.host.locale?.() ?? locale.value);

/** Both catalogs are the host's; a picker that fails to load leaves the list usable. */
onMounted(async () => {
  const [agentList, functionList] = await Promise.all([
    props.host.agents().catch(() => [] as readonly AgentHostAgent[]),
    props.host.functions().catch(() => [] as readonly PlatformScheduleFunction[]),
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
    :agent-id="agentId"
    :app-id="appId"
    :locale="pageLocale"
    :t="text"
    @open-session="openSession"
  />
</template>
