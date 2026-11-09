<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { randomId } from "@ontomato/contracts/random-id";
import { drilldownPreviewSchema } from "@ontomato/contracts/assistant-drilldown";
import { DatasetSelectionButton } from "@ontomato/agent-shell-ui";
import { nodeApiFetch, nodeApiGet } from "../../../utils/api";

const props = defineProps<{ artifact: RuntimeArtifact; selectedRowIndices: number[]; refreshConversation?: () => Promise<void> }>();
const { locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
const preview = ref<ReturnType<typeof drilldownPreviewSchema.parse> | null>(null);
const busy = ref(false);
const error = ref("");
const requestId = ref(randomId());
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/drilldown`);
let revision = 0;
watch(() => [endpoint.value, ...props.selectedRowIndices], async () => {
  const current = ++revision;
  preview.value = null; error.value = ""; requestId.value = randomId();
  if (props.selectedRowIndices.length !== 1) return;
  try {
    const result = drilldownPreviewSchema.parse(await nodeApiGet(`${endpoint.value}?rowIndex=${props.selectedRowIndices[0]}`));
    if (current === revision) preview.value = result;
  } catch { /* Unsupported and non-accepted datasets have no drilldown affordance. */ }
}, { immediate: true });
async function submit() {
  if (!preview.value || busy.value) return;
  const current = revision;
  busy.value = true; error.value = "";
  try {
    await nodeApiFetch(endpoint.value, "POST", { rowIndex: props.selectedRowIndices[0] }, { headers: { "Idempotency-Key": requestId.value } });
    await props.refreshConversation?.();
  } catch (e) { if (current === revision) error.value = e instanceof Error ? e.message : (zh.value ? "明细查询未能启动，请重试" : "Unable to start detail query"); }
  finally { busy.value = false; }
}
</script>
<template>
  <template v-if="preview">
    <DatasetSelectionButton :disabled="busy" :aria-busy="busy" @click="submit">{{ busy ? (zh ? '正在查询明细…' : 'Querying details…') : (zh ? '查看明细' : 'View details') }}</DatasetSelectionButton>
    <span v-if="error" class="detail-error" role="alert">{{ error }}</span>
  </template>
</template>
<style scoped>
.detail-error { color: var(--el-color-danger); overflow-wrap: anywhere; }
</style>
