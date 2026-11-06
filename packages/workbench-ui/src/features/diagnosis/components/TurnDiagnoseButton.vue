<script setup lang="ts">
import { randomId } from "@ontomato/contracts/random-id";
/**
 * Diagnosis entry of a reply: shown once the run has finished, and opens that run's diagnosis page in the platform. Who may see it is assembled by the app (TurnDiagnosisAccess): the enterprise build gates
 * it by the observer permission, the open-source build has no permission gate on /observe.
 */
import { inject, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Wrench } from "lucide-vue-next";
import { turnDiagnosisAccessKey } from "../access";

const props = defineProps<{ sessionId: string; runId: string }>();

const router = useRouter();
const { t } = useI18n();
const access = inject(turnDiagnosisAccessKey);
// A missing app assembly is a wiring error: neither allow nor hide by default.
if (!access) throw new Error("Turn diagnosis access is not provided");

onMounted(() => access.prepare());

function openDiagnosis() {
  void router.push({
    path: "/ops/diagnosis",
    query: {
      sourceSessionId: props.sessionId,
      sourceRunId: props.runId,
      diagnose: "1",
      diagnosisSessionId: randomId(),
      diagnosisRunId: randomId(),
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
