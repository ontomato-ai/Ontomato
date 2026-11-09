<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CircleHelp, CheckCircle2 } from "lucide-vue-next";
import { type ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { assistantClarificationSchema, clarificationStateSchema } from "@ontomato/contracts/assistant-clarification";
import { nodeApiGet, nodeApiPost, nodeApiPut } from "../../../utils/api";
const props = defineProps<ArtifactRendererProps>();
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/decision`);
const { locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
const card = ref<ReturnType<typeof assistantClarificationSchema.parse> | null>(null);
const values = ref<Record<string, string | string[]>>({});
const notes = ref("");
const busy = ref(false);
const submitted = ref(false);
const error = ref("");
const restoring = ref(true);
const ready = computed(() => card.value?.questions.every((question) => !question.required || Boolean(values.value[question.id]?.length)));
let draftQueue = Promise.resolve();
watch(() => props.artifact.id, async () => {
  restoring.value = true; card.value = null; values.value = {}; notes.value = ""; submitted.value = false; error.value = "";
  try {
    card.value = assistantClarificationSchema.parse(JSON.parse(await (await props.read()).text()));
    const state = clarificationStateSchema.parse(await nodeApiGet(endpoint.value));
    values.value = state.values; notes.value = state.notes; submitted.value = state.status === "submitted";
  }
  catch { error.value = zh.value ? "确认事项加载失败，请重新打开" : "Unable to load clarification"; }
  finally { restoring.value = false; }
}, { immediate: true });
async function submit() {
  if (!card.value || !ready.value || restoring.value || busy.value || submitted.value) return;
  busy.value = true; error.value = "";
  try {
    await nodeApiPost(`${endpoint.value}/submit`, { values: values.value, notes: notes.value });
    submitted.value = true;
    // Reopen through the existing shell so it subscribes to the server-admitted continuation.
    await props.refreshConversation?.();
  } catch (e) { error.value = e instanceof Error ? e.message : (zh.value ? "提交未完成，请重试" : "Unable to continue"); }
  finally { busy.value = false; }
}
async function saveDraft() {
  if (!card.value || restoring.value || busy.value || submitted.value) return;
  const url = endpoint.value;
  const input = JSON.parse(JSON.stringify({ values: values.value, notes: notes.value }));
  draftQueue = draftQueue.catch(() => {}).then(async () => { await nodeApiPut(url, input); });
  try { await draftQueue; }
  catch (e) { error.value = e instanceof Error ? e.message : (zh.value ? "未能保存，请重试" : "Unable to save"); }
}
</script>
<template>
  <section class="clarification-card" :aria-busy="busy">
    <div class="clarification-heading"><CheckCircle2 v-if="submitted" :size="16" /><CircleHelp v-else :size="16" /><strong>{{ submitted ? (zh ? '已提交口径' : 'Decisions submitted') : (zh ? '需要你确认' : 'Your decision needed') }}</strong></div>
    <form v-if="card" @submit.prevent="submit" @change="saveDraft" @focusout="saveDraft">
      <fieldset v-for="question in card.questions" :key="question.id" :disabled="busy || submitted">
        <legend>{{ question.label }}</legend>
        <el-radio-group v-if="question.kind === 'single'" v-model="values[question.id]" :aria-label="question.label"><el-radio v-for="option in question.options" :key="option.value" :value="option.value">{{ option.label }}</el-radio></el-radio-group>
        <el-checkbox-group v-else-if="question.kind === 'multiple'" :model-value="Array.isArray(values[question.id]) ? values[question.id] : []" :aria-label="question.label" @update:model-value="values[question.id] = $event as string[]"><el-checkbox v-for="option in question.options" :key="option.value" :value="option.value">{{ option.label }}</el-checkbox></el-checkbox-group>
        <el-date-picker v-else-if="question.kind === 'date'" v-model="values[question.id]" type="date" value-format="YYYY-MM-DD" :aria-label="question.label" />
        <el-input v-else v-model="values[question.id]" :aria-label="question.label" />
      </fieldset>
      <el-input v-model="notes" type="textarea" :rows="2" :disabled="busy || submitted" :placeholder="zh ? '自行补充（选填）' : 'Additional notes (optional)'" :aria-label="zh ? '自行补充' : 'Additional notes'" />
      <el-button v-if="!submitted" native-type="submit" type="primary" :disabled="!ready || restoring" :loading="busy">{{ zh ? '确认并继续' : 'Confirm and continue' }}</el-button>
      <p v-else class="submitted-note">{{ zh ? '已将你的选择传给 Agent，继续处理原问题。' : 'Your decisions were sent to continue the original question.' }}</p>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.clarification-card { display: block; box-sizing: border-box; padding: var(--spacing-lg); font-size: var(--text-sm); line-height: var(--leading-sm); }
.clarification-heading { display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-lg); color: var(--el-text-color-primary); }
form { display: flex; flex-direction: column; align-items: flex-start; gap: var(--spacing-lg); }
fieldset { width: 100%; box-sizing: border-box; border: 0; margin: 0; padding: 0; min-width: 0; }
legend { margin-bottom: var(--spacing-sm); padding: 0; font-weight: var(--font-medium); }
.el-radio-group, .el-checkbox-group { display: flex; flex-wrap: wrap; gap: var(--spacing-xs) var(--spacing-lg); }
.el-radio, .el-checkbox { margin-right: 0; height: auto; min-height: var(--control-height); white-space: normal; }
.submitted-note { margin: 0; color: var(--el-text-color-secondary); }
.error { margin: var(--spacing-sm) 0 0; color: var(--el-color-danger); }
</style>
