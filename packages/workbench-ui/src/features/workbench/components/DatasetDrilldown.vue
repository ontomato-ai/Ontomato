<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { drilldownPreviewSchema } from "@ontomato/contracts/assistant-drilldown";
import { DatasetSelectionButton, useConversationContinuation } from "@ontomato/agent-shell-ui";
import { nodeApiGet } from "../../../utils/api";

/** `selectedRowIndices` are positions in the immutable source file, so the message's row number names that record. */
const props = defineProps<{ artifact: RuntimeArtifact; title: string; selectedRowIndices: number[] }>();
const continueConversation = useConversationContinuation();
const { t, locale } = useI18n();
const preview = ref<ReturnType<typeof drilldownPreviewSchema.parse> | null>(null);
const busy = ref(false);
const error = ref("");
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/drilldown`);
let revision = 0;
watch(() => [endpoint.value, ...props.selectedRowIndices], async () => {
  const current = ++revision;
  preview.value = null; error.value = "";
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
  const file = t("assistant.continuation.file", { title: props.title, path: props.artifact.path });
  const row = props.selectedRowIndices[0]! + 1;
  // Typed group values stay exact: "001", 1, false and null read differently.
  const groups = new Intl.ListFormat(locale.value).format(preview.value.groups.map(({ label, value }) => t("assistant.continuation.group", { label, value: JSON.stringify(value) })));
  try {
    await continueConversation!(groups
      ? t("assistant.continuation.detailsOfGroups", { row, groups, file })
      : t("assistant.continuation.details", { row, file }));
  } catch (e) { if (current === revision) error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
<template>
  <template v-if="preview">
    <DatasetSelectionButton :disabled="busy" :aria-busy="busy" @click="submit">{{ busy ? t('assistant.queryingDetails') : t('assistant.viewDetails') }}</DatasetSelectionButton>
    <span v-if="error" class="detail-error" role="alert">{{ error }}</span>
  </template>
</template>
<style scoped>
.detail-error { color: var(--el-color-danger); overflow-wrap: anywhere; }
</style>
