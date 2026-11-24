<script setup lang="ts">
import { randomId } from "@ontomato/contracts/random-id";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type LocationQueryRaw } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import {
  AgentShell,
  useAgentNav,
  useConversationDisplay,
  useSessionRunFeed,
  type ShellWorkbenchDeclaration,
} from "@ontomato/agent-shell-ui";
import { useLeaveConfirmation } from "@ontomato/platform-shell";
import "@ontomato/agent-shell-ui/style.css";
import { DIAGNOSIS_AGENT_ID, type DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { useShellLabels } from "../../../../composables/useShellLabels";
import { workbenchContent } from "../../../../content";
import { diagnosisApi } from "../../api";
import { createDiagnosisClient } from "../../ops-host";

/**
 * Operations diagnosis conversation page (`/ops/diagnosis`): hosts only the diagnosis conversation history and chat
 * surface inside the platform application frame. Application navigation belongs solely to the shared outer frame.
 */
const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const client = createDiagnosisClient();
const shellLabels = useShellLabels();
const labels = computed(() => ({
  ...shellLabels.value,
  greeting: t("ops.greeting"),
  placeholder: t("ops.placeholder"),
}));
const agentId = ref<string | null>(DIAGNOSIS_AGENT_ID);

const workbench = computed<ShellWorkbenchDeclaration>(() => ({
  id: "operations",
  label: t("ops.diagnosis"),
  features: [],
}));

const conversation = ref<string | null>(typeof route.query.sessionId === "string" ? route.query.sessionId : null);
watch(
  () => route.query.sessionId,
  (id) => {
    conversation.value = typeof id === "string" ? id : null;
  },
);

const sessionId = computed({
  get: () => conversation.value,
  set: (value: string | null) => {
    conversation.value = value;
    const rest = { ...route.query };
    delete rest.sessionId;
    const query: LocationQueryRaw = value ? { ...rest, sessionId: value } : rest;
    void router.push({ path: route.path, query }).catch(() => {});
  },
});

const leave = useLeaveConfirmation();
const display = useConversationDisplay({
  features: () => [],
  context: (page, reported) => ({
    pageKey: "ops.diagnosis",
    url: page.address || route.fullPath,
    label: t("ops.diagnosis"),
    selection: reported?.selection ?? [],
  }),
  leave: { leaves: () => false, confirm: () => leave.confirm() },
});

const starting = ref(false);
async function startDiagnosis(target: DiagnosisTarget, fromRoute = false) {
  if (starting.value) return false;
  starting.value = true;
  const session = fromRoute && typeof route.query.diagnosisSessionId === "string" ? route.query.diagnosisSessionId : randomId();
  const run = fromRoute && typeof route.query.diagnosisRunId === "string" ? route.query.diagnosisRunId : randomId();
  try {
    if (fromRoute) {
      await router.replace({
        path: route.path,
        query: { ...route.query, diagnosisSessionId: session, diagnosisRunId: run },
      });
    }
    await diagnosisApi.startDiagnosis(target, session, run, workbenchContent().text.observe.autoTurnDiagnosisMessage);
    conversation.value = session;
    await router.replace({ path: route.path, query: { sessionId: session } });
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("diagnosis.requestFailed"));
    return false;
  } finally {
    starting.value = false;
  }
}

watch(
  () => [route.query.diagnose, route.query.sourceSessionId, route.query.sourceRunId],
  () => {
    if (
      route.query.diagnose === "1"
      && typeof route.query.sourceSessionId === "string"
      && typeof route.query.sourceRunId === "string"
    ) {
      void startDiagnosis(
        { kind: "assistant-run", sessionId: route.query.sourceSessionId, runId: route.query.sourceRunId },
        true,
      );
    }
  },
  { immediate: true },
);

const nav = useAgentNav({
  client: () => client,
  agentId: () => agentId.value,
  setAgentId: (id) => (agentId.value = id),
  sessionId: () => sessionId.value,
  setSessionId: (id) => (sessionId.value = id),
  onLeaveConversation: () => void display.close(),
});

useSessionRunFeed({
  port: client.sessionRuns,
  sessions: () => nav.sessions.value,
  presentation: true,
  onError: (error) => ElMessage.error(error instanceof Error ? error.message : String(error)),
});

onMounted(async () => {
  await nav.loadAgents().catch(() => {});
  await nav.loadSessions();
});
</script>

<template>
  <AgentShell
    v-model:agent-id="agentId"
    v-model:session-id="sessionId"
    :display="display"
    :workbench="workbench"
    :title="t('ops.diagnosis')"
    :client="client"
    :labels="labels"
    :nav="nav"
    @error="ElMessage.error($event)"
  />
</template>
