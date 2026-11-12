<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ArrowUpRight } from "lucide-vue-next";
import { useConversationContinuation, type ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { assistantFollowUpsSchema } from "@ontomato/contracts/assistant-follow-ups";
const props = defineProps<ArtifactRendererProps>();
const { t, locale } = useI18n();
const inheritedContinuation = useConversationContinuation();
const continueConversation = computed(() => props.continueConversation ?? inheritedContinuation);
const suggestions = ref<ReturnType<typeof assistantFollowUpsSchema.parse>["suggestions"]>([]);
const busy = ref(false);
const error = ref("");
watch(() => props.artifact.id, async () => {
  try { suggestions.value = assistantFollowUpsSchema.parse(JSON.parse(await (await props.read()).text())).suggestions; }
  catch { error.value = t("assistant.followUpsLoadFailed"); }
}, { immediate: true });
async function proceed(item: typeof suggestions.value[number]) {
  if (!continueConversation.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    // The question names the scope; the dataset paths say which existing files it continues from.
    await continueConversation.value(item.datasetPaths.length
      ? `${item.question}\n${t("assistant.continuation.basedOn", { files: new Intl.ListFormat(locale.value).format(item.datasetPaths) })}`
      : item.question);
  } catch (e) { error.value = (e as Error).message; }
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
