<script setup lang="ts">
/**
 * Diagnosis entry of a turn: shown once the reply has finished and its Turn is known;
 * opens that Turn's diagnosis page in a new tab. Who may see it is assembled by the app
 * (TurnDiagnosisAccess): the enterprise build gates it by the observer permission,
 * the open-source build has no permission gate on /observe.
 */
import { computed, inject, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { Wrench } from "lucide-vue-next";
import {
  buildTurnDiagnoseRoute,
  snapshotTurnKey,
  type TurnIdentity,
} from "../utils/workspace-route";
import { turnDiagnosisAccessKey } from "../access";

const props = defineProps<{ turn?: TurnIdentity; sessionId?: string; runId?: string }>();

const router = useRouter();
const { t } = useI18n();
const access = inject(turnDiagnosisAccessKey);
// A missing app assembly is a wiring error: neither allow nor hide by default.
if (!access) throw new Error("Turn diagnosis access is not provided");

const turnKey = computed(() =>
  props.turn?.status === "streaming" ? "" : props.turn ? snapshotTurnKey(props.turn) : ""
);

onMounted(() => access.prepare());

function openDiagnosis() {
  const target = router.resolve(props.sessionId && props.runId
    ? { path: "/observe/diagnosis", query: { sourceSessionId: props.sessionId, sourceRunId: props.runId, diagnose: "1", diagnosisSessionId: crypto.randomUUID(), diagnosisRunId: crypto.randomUUID() } }
    : buildTurnDiagnoseRoute(turnKey.value));
  window.open(target.href, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <button
    v-if="(turnKey || (sessionId && runId)) && access.visible()"
    type="button"
    :title="t('chat.diagnoseTurn')"
    :aria-label="t('chat.diagnoseTurn')"
    @click="openDiagnosis"
  >
    <Wrench :size="14" />
  </button>
</template>
