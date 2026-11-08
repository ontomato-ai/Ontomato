<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowUpRight } from "lucide-vue-next";
import { continuationMessage, useConversationContinuation, type ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { assistantFollowUpsSchema } from "@ontomato/contracts/assistant-follow-ups";
const props = defineProps<ArtifactRendererProps>();
const inheritedContinuation = useConversationContinuation();
const continueConversation = computed(() => props.continueConversation ?? inheritedContinuation);
const suggestions = ref<ReturnType<typeof assistantFollowUpsSchema.parse>["suggestions"]>([]);
const busy = ref(false);
const error = ref("");
watch(() => props.artifact.id, async () => {
  try { suggestions.value = assistantFollowUpsSchema.parse(JSON.parse(await (await props.read()).text())).suggestions; }
  catch { error.value = "Unable to load follow-up suggestions"; }
}, { immediate: true });
async function proceed(item: typeof suggestions.value[number]) {
  if (!continueConversation.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await continueConversation.value(continuationMessage(item.question, `Continue from this answer using the referenced datasets and their original scope, assumptions and user decisions. Resolve these files in the source run before using them. Do not treat partial data as complete or change filters silently.\n${JSON.stringify({ sourceRunId: props.artifact.runId, datasetPaths: item.datasetPaths })}`));
  } catch (e) { error.value = e instanceof Error ? e.message : "Unable to continue"; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="follow-up-actions" :aria-busy="busy">
    <el-button v-for="item in suggestions" :key="item.label" :disabled="busy || !continueConversation" @click="proceed(item)">{{ item.label }}<ArrowUpRight :size="14" /></el-button>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>
<style scoped>
.follow-up-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); padding: var(--spacing-md) var(--spacing-lg); }
.follow-up-actions .el-button + .el-button { margin: 0; }
.follow-up-actions p { width: 100%; margin: 0; color: var(--el-color-danger); }
</style>
