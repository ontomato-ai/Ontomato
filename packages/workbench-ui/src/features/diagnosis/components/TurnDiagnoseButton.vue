<script setup lang="ts">
import { randomId } from "@ontomato/contracts/random-id";
/**
 * Diagnosis entry of a reply: shown once the run has finished, and opens that run's diagnosis page in
 * a new tab. Who may see it is assembled by the app (TurnDiagnosisAccess): the enterprise build gates
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
  const target = router.resolve({
    path: "/observe/diagnosis",
    query: {
      sourceSessionId: props.sessionId,
      sourceRunId: props.runId,
      diagnose: "1",
      diagnosisSessionId: randomId(),
      diagnosisRunId: randomId(),
    },
  });
  window.open(target.href, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <button
    v-if="access.visible()"
    type="button"
    :title="t('chat.diagnoseTurn')"
    :aria-label="t('chat.diagnoseTurn')"
    @click="openDiagnosis"
  >
    <Wrench :size="14" />
  </button>
</template>
