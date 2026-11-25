<script setup lang="ts">
/**
 * Diagnosis entry of a reply: shown once the run has finished. Clicking immediately creates a fresh operations
 * diagnosis session, submits the opening turn-diagnosis prompt, and navigates to `/ops/diagnosis?frame.sessionId=<id>`
 * so the address carries only the resulting session (refreshing or sharing never re-sends).
 * Who may see it is assembled by the app (TurnDiagnosisAccess): the enterprise build gates it by the observer
 * permission, while the open-source build has no permission gate.
 */
import { inject, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { Wrench } from "lucide-vue-next";
import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";
import { createAssistantClient } from "../../workbench/assistant-host";
import { turnDiagnosisAccessKey } from "../access";
import { turnDiagnosisPrefill } from "../prefill";

const props = defineProps<{ sessionId: string; runId: string }>();

const router = useRouter();
const { t, te, locale } = useI18n();
const access = inject(turnDiagnosisAccessKey);
// A missing app assembly is a wiring error: neither allow nor hide by default.
if (!access) throw new Error("Turn diagnosis access is not provided");

const starting = ref(false);

onMounted(() => access.prepare());

async function openDiagnosis() {
  if (starting.value) return;
  starting.value = true;
  try {
    const prefill = te("chat.diagnoseTurnPrefill")
      ? t("chat.diagnoseTurnPrefill", { sessionId: props.sessionId, runId: props.runId })
      : turnDiagnosisPrefill(props.sessionId, props.runId, String(locale.value));
    const client = createAssistantClient();
    const agents = await client.listAgents();
    const diagnosisAgent = agents.find((agent) => agent.enabled && agent.kind === OPS_DIAGNOSIS_KIND);
    if (!diagnosisAgent) {
      ElMessage.error(t("assistant.agentUnavailable"));
      return;
    }
    const created = await client.createSession(diagnosisAgent.id);
    await client.send(created.id, { message: prefill });
    await router.push({
      path: "/ops/diagnosis",
      query: { "frame.sessionId": created.id },
    });
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : t("assistant.loadFailed"));
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <button
    v-if="access.visible()"
    type="button"
    class="shell-message-action"
    :disabled="starting"
    :title="t('chat.diagnoseTurn')"
    :aria-label="t('chat.diagnoseTurn')"
    @click="openDiagnosis"
  >
    <Wrench :size="15" />
  </button>
</template>
