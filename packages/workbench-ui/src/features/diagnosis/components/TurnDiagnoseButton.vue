<script setup lang="ts">
/**
 * Diagnosis entry of a reply: shown once the run has finished, and opens the agent platform pre-selected on the
 * operations diagnosis agent with a prefilled prompt containing the source session/run for human submission.
 * Who may see it is assembled by the app (TurnDiagnosisAccess): the enterprise build gates it by the observer
 * permission, while the open-source build has no permission gate.
 */
import { inject, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Wrench } from "lucide-vue-next";
import { OPS_DIAGNOSIS_KIND } from "@ontomato/contracts/ops-diagnosis";
import { turnDiagnosisAccessKey } from "../access";
import { turnDiagnosisPrefill } from "../prefill";

const props = defineProps<{ sessionId: string; runId: string }>();

const router = useRouter();
const { t, te, locale } = useI18n();
const access = inject(turnDiagnosisAccessKey);
// A missing app assembly is a wiring error: neither allow nor hide by default.
if (!access) throw new Error("Turn diagnosis access is not provided");

onMounted(() => access.prepare());

function openDiagnosis() {
  const prefill = te("chat.diagnoseTurnPrefill")
    ? t("chat.diagnoseTurnPrefill", { sessionId: props.sessionId, runId: props.runId })
    : turnDiagnosisPrefill(props.sessionId, props.runId, String(locale.value));
  void router.push({
    path: "/agents/chat",
    query: {
      agentKind: OPS_DIAGNOSIS_KIND,
      prefill,
    },
  });
}
</script>

<template>
  <button
    v-if="access.visible()"
    type="button"
    class="shell-message-action"
    :title="t('chat.diagnoseTurn')"
    :aria-label="t('chat.diagnoseTurn')"
    @click="openDiagnosis"
  >
    <Wrench :size="15" />
  </button>
</template>
