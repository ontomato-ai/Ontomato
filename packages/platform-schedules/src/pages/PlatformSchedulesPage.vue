<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Plus } from "lucide-vue-next";
import type { AgentHostAgent } from "@ontomato/contracts/agent-host";
import type { PlatformTaskFunctionTarget } from "@ontomato/contracts/platform-schedules";
import { createSchedulesApi } from "../api";
import type { PlatformSchedulesHost } from "../host";
import type { Translate } from "../i18n";
import PlatformSchedulesList from "../components/PlatformSchedulesList.vue";

/**
 * The platform's scheduled tasks: one application, one page, with its own header — the title, one line of description
 * and the "new task" button — then the filters and the list with its form and run history (DESIGN.md "Applications and
 * shells"). The host supplies the request layer and the agents; the functions a task may run come from the service's own
 * function-targets answer, by the rule it enforces when a task is saved.
 */
const props = withDefaults(
  defineProps<{
    host: PlatformSchedulesHost;
    /** Show one agent's tasks only (the agent platform's entry) and preselect it for a new task. */
    agentId?: string | null;
    /** Start on one application's tasks; the reader can change the filter. */
    appId?: string | null;
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
  { agentId: null, appId: null, filterAgentId: null, taskId: null },
);
const emit = defineEmits<{ openSession: [sessionId: string]; updateFilterAgent: [agentId: string] }>();

const { t, locale } = useI18n();
/** The package's text is merged under `platformSchedules`; the list receives it already resolved. */
const text: Translate = (key, named, count) =>
  count === undefined
    ? t(`platformSchedules.${key}`, named ?? {})
    : t(`platformSchedules.${key}`, named ?? {}, count);

const api = createSchedulesApi(props.host);
const list = ref<{ openNewTask: () => void } | null>(null);
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
  <div class="schedules-application">
    <header class="application-head">
      <div class="head-text">
        <h1 class="head-title">{{ t("platformSchedules.title") }}</h1>
        <p class="head-description">{{ t("platformSchedules.intro") }}</p>
      </div>
      <el-button type="primary" @click="list?.openNewTask()">
        <Plus :size="16" />
        <span>{{ t("platformSchedules.newTask") }}</span>
      </el-button>
    </header>
    <!-- The list's table scrolls inside its own box, so a narrow window never cuts a column off. -->
    <div class="application-body">
      <PlatformSchedulesList
        ref="list"
        :api="api"
        :agents="agents"
        :functions="functions"
        :functions-refused="functionsRefused"
        :agent-id="agentId"
        :app-id="appId"
        :agent-filter="filterAgentId"
        :task-id="taskId"
        :locale="pageLocale"
        :t="text"
        @open-session="openSession"
        @update-agent-filter="emit('updateFilterAgent', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
/*
 * One page application: its header, then the list filling the rest. The area scrolls as a whole and the table keeps its
 * own horizontal scroll inside its box, never widening the page (DESIGN.md "Layout").
 */
.schedules-application {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}
.application-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-lg);
  padding: 24px 28px 14px;
  flex-shrink: 0;
}
.head-title {
  margin: 0 0 2px;
  font-size: var(--text-xl);
  line-height: var(--leading-xl);
  font-weight: var(--font-semibold);
  color: var(--el-text-color-primary);
}
.head-description {
  margin: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--el-text-color-secondary);
}
.application-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>
