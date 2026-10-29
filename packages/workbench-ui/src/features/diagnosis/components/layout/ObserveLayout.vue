<script setup lang="ts">
import { randomId } from "@ontomato/contracts/random-id";
import { computed, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { AgentShell, type ShellWorkbenchDeclaration } from "@ontomato/agent-shell-ui";
import "@ontomato/agent-shell-ui/style.css";
import { DIAGNOSIS_AGENT_ID, type DiagnosisTarget } from "@ontomato/contracts/ops-diagnosis";
import { agentHostCreateSessionResponseSchema, agentHostAdmissionSchema } from "@ontomato/contracts/agent-host";
import { nodeApiFetch } from "../../../../utils/api";
import { useShellLabels } from "../../../../composables/useShellLabels";
import { workbenchContent } from "../../../../content";
import { createDiagnosisClient, diagnosisActionKey } from "../../ops-host";
import type { ObserveAccount } from "./types";
import OperationsFeatures from "./OperationsFeatures.vue";

 defineProps<{ account: ObserveAccount | null }>();
const route = useRoute(), router = useRouter(), { t } = useI18n();
const client = createDiagnosisClient(), labels = useShellLabels();
const agentId = ref<string | null>(DIAGNOSIS_AGENT_ID);
const entries = [
  ["turn", "/observe/turn", "ops.turns"], ["live-logs", "/observe/live-logs", "ops.logs"],
  ["test", "/observe/test", "ops.tests"], ["results", "/observe/results", "ops.results"],
  ["cases", "/observe/cases", "ops.cases"], ["dsl", "/observe/dsl", "ops.dsl"], ["knowledge", "/observe/knowledge", "ops.knowledge"],
] as const;
const workbench = computed<ShellWorkbenchDeclaration>(() => ({ id: "operations", label: t("ops.title"), features: entries.map(([id, , key]) => ({ id, label: t(key), icon: "search", availability: "page" })) }));
const featureId = computed({
  get: () => route.path === "/observe/diagnosis" ? null : route.params.caseId ? "results" : entries.find(([, path]) => route.path === path || route.path.startsWith(path + "/"))?.[0] ?? null,
  set: (id: string | null) => { void router.push(id ? entries.find(([key]) => key === id)?.[1] ?? "/observe/diagnosis" : { path: "/observe/diagnosis", query: route.query.sessionId ? { sessionId: route.query.sessionId } : {} }); },
});
const sessionId = computed({
  get: () => typeof route.query.sessionId === "string" ? route.query.sessionId : null,
  set: (id: string | null) => { void router.replace({ path: "/observe/diagnosis", query: { ...(id ? { sessionId: id } : {}), ...(route.query.returnTo ? { returnTo: route.query.returnTo } : {}) } }); },
});
const starting = ref(false);
async function startDiagnosis(target: DiagnosisTarget, fromRoute = false) {
  if (starting.value) return false;
  starting.value = true;
  const session = fromRoute && typeof route.query.diagnosisSessionId === "string" ? route.query.diagnosisSessionId : randomId();
  const run = fromRoute && typeof route.query.diagnosisRunId === "string" ? route.query.diagnosisRunId : randomId();
  const returnTo = route.path === "/observe/diagnosis" ? undefined : route.fullPath.split("?")[0];
  try {
    if (fromRoute) await router.replace({ path: route.path, query: { ...route.query, diagnosisSessionId: session, diagnosisRunId: run } });
    const created = await nodeApiFetch("/observe/diagnoses", "POST", { target }, { headers: { "Idempotency-Key": session } });
    agentHostCreateSessionResponseSchema.parse(await created.json());
    const admitted = await nodeApiFetch(`/observe/agent/sessions/${session}/runs`, "POST", { message: workbenchContent().text.observe.autoTurnDiagnosisMessage }, { headers: { "Idempotency-Key": run } });
    agentHostAdmissionSchema.parse(await admitted.json());
    await router.replace({ path: "/observe/diagnosis", query: { sessionId: session, ...(returnTo ? { returnTo } : {}) } });
    return true;
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : t("diagnosis.requestFailed")); return false; }
  finally { starting.value = false; }
}
provide(diagnosisActionKey, startDiagnosis);
watch(() => [route.query.diagnose, route.query.sourceSessionId, route.query.sourceRunId], () => {
  if (route.query.diagnose === "1" && typeof route.query.sourceSessionId === "string" && typeof route.query.sourceRunId === "string")
    void startDiagnosis({ kind: "assistant-run", sessionId: route.query.sourceSessionId, runId: route.query.sourceRunId }, true);
}, { immediate: true });
</script>

<template>
  <AgentShell v-model:agent-id="agentId" v-model:feature-id="featureId" v-model:session-id="sessionId" :workbench="workbench" :client="client" :labels="labels" @error="ElMessage.error($event)">
    <template #feature>
      <OperationsFeatures :account="account"><template #dsl-result-tabs="scope"><slot name="dsl-result-tabs" v-bind="scope" /></template></OperationsFeatures>
    </template>
    <template #footer>
      <el-button v-if="route.query.returnTo" text @click="router.push(String(route.query.returnTo))">{{ t('common.back') }}</el-button>
      <span v-if="account">{{ account.userName }}</span>
      <el-button text @click="router.push('/admin')">{{ t('ops.back') }}</el-button>
    </template>
  </AgentShell>
</template>
