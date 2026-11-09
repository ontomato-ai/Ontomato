<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
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
const locked = ref(false);
const stale = computed(() => continuation.value === "stale");
const continuation = ref("not_started");
const draftStatus = ref<"idle" | "saving" | "saved" | "error">("idle");
let poll: ReturnType<typeof setTimeout> | undefined;
let draftTimer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let savedDraft = "";
const continuationText = computed(() => {
  const messages: Record<string, [string, string]> = {
    conversation: ["选择已提交，助手将继续处理原问题。此卡片未关联取数任务。", "Decisions submitted for the assistant to continue. This card is not linked to a retrieval."],
    pending: ["选择已提交，正在等待原任务接受口径。", "Decisions submitted; waiting for the original task to accept them."],
    accepted: ["原取数任务已接受口径。最终结果仍需核对。", "The original retrieval accepted your decisions. Verify the resulting data."],
    needs_attention: ["本轮处理已结束，尚未确认原取数任务接受了口径。请查看对话继续处理。", "This turn ended without verified retrieval acceptance. Open the conversation to continue."],
    unavailable: ["选择已保留，暂时无法核实续接状态，请重试。", "Your choices are preserved; continuation status is unavailable. Retry to check."],
    stale: ["这项确认已过期，请返回对话查看最新确认事项。已填写的选择仍保留。", "This clarification is outdated. Return to the conversation for the latest questions. Your choices are preserved."],
  };
  return messages[continuation.value]?.[zh.value ? 0 : 1] ?? "";
});
async function refreshState() {
  const current = generation;
  clearTimeout(poll);
  const state = clarificationStateSchema.parse(await nodeApiGet(endpoint.value));
  if (current !== generation) return;
  locked.value = state.locked || state.status === "submitted";
  submitted.value = state.status === "submitted";
  continuation.value = state.continuation;
  if (state.continuation === "pending" && submitted.value)
    poll = setTimeout(() => { void refreshState().catch(() => { continuation.value = "unavailable"; }); }, 3000);
}
const ready = computed(() => card.value?.questions.every((question) => {
  const value = values.value[question.id];
  return !question.required || (typeof value === "string" ? Boolean(value.trim()) : Boolean(value?.length));
}));
let draftQueue = Promise.resolve();
async function loadCard() {
  generation++; clearTimeout(poll); clearTimeout(draftTimer);
  const current = generation;
  locked.value = false; continuation.value = "not_started"; draftStatus.value = "idle";
  restoring.value = true; card.value = null; values.value = {}; notes.value = ""; submitted.value = false; error.value = "";
  try {
    const loadedCard = assistantClarificationSchema.parse(JSON.parse(await (await props.read()).text()));
    if (current !== generation) return;
    card.value = loadedCard;
    const state = clarificationStateSchema.parse(await nodeApiGet(endpoint.value));
    if (current !== generation) return;
    values.value = state.values; notes.value = state.notes; submitted.value = state.status === "submitted";
    savedDraft = JSON.stringify({ values: state.values, notes: state.notes });
    locked.value = state.locked || submitted.value; continuation.value = state.continuation;
    if (submitted.value) void refreshState().catch(() => { continuation.value = "unavailable"; });
  }
  catch { error.value = zh.value ? "确认事项加载失败，请重新打开" : "Unable to load clarification"; }
  finally { if (current === generation) restoring.value = false; }
}
watch(() => props.artifact.id, loadCard, { immediate: true });
async function submit() {
  if (!card.value || !ready.value || restoring.value || busy.value || submitted.value || stale.value) return;
  busy.value = true; error.value = "";
  try {
    clearTimeout(draftTimer);
    await draftQueue.catch(() => {});
    await nodeApiPost(`${endpoint.value}/submit`, { values: values.value, notes: notes.value });
    submitted.value = true; locked.value = true; continuation.value = "pending";
    void refreshState().catch(() => { continuation.value = "unavailable"; });
    // Reopen through the existing shell so it subscribes to the server-admitted continuation.
    await props.refreshConversation?.();
  } catch (e) {
    error.value = e instanceof Error ? e.message : (zh.value ? "提交未完成，请重试" : "Unable to continue");
    try {
      const state = clarificationStateSchema.parse(await nodeApiGet(endpoint.value));
      locked.value = state.locked; values.value = state.values; notes.value = state.notes;
      submitted.value = state.status === "submitted";
      continuation.value = state.continuation;
      if (state.continuation === "stale") error.value = "";
      if (submitted.value) await props.refreshConversation?.();
    } catch { /* Keep the local input when recovery is unavailable. */ }
  }
  finally { busy.value = false; }
}
async function saveDraft() {
  if (!card.value || restoring.value || busy.value || locked.value || submitted.value) return;
  const url = endpoint.value;
  const current = generation;
  const input = JSON.parse(JSON.stringify({ values: values.value, notes: notes.value }));
  const snapshot = JSON.stringify(input);
  draftQueue = draftQueue.catch(() => {}).then(async () => {
    if (current !== generation || snapshot === savedDraft) return;
    draftStatus.value = "saving";
    await nodeApiPut(url, input);
    if (current === generation) savedDraft = snapshot;
  });
  try { await draftQueue; }
  catch (e) { if (current !== generation) return; draftStatus.value = "error"; error.value = e instanceof Error ? e.message : (zh.value ? "未能保存，请重试" : "Unable to save"); return; }
  if (current === generation) { draftStatus.value = "saved"; error.value = ""; }
}
watch([values, notes], () => {
  if (restoring.value || locked.value || submitted.value) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { void saveDraft(); }, 400);
}, { deep: true });
onBeforeUnmount(() => { generation++; clearTimeout(poll); clearTimeout(draftTimer); });
</script>
<template>
  <section class="clarification-card" :aria-busy="busy">
    <div class="clarification-heading"><CheckCircle2 v-if="submitted" :size="16" /><CircleHelp v-else :size="16" /><strong>{{ submitted ? (zh ? '已提交口径' : 'Decisions submitted') : (zh ? '需要你确认' : 'Your decision needed') }}</strong></div>
    <form v-if="card" @submit.prevent="submit" @focusout="saveDraft">
      <fieldset v-for="question in card.questions" :key="question.id" :disabled="restoring || busy || locked || submitted">
        <legend>{{ question.label }}</legend>
        <el-radio-group v-if="question.kind === 'single'" v-model="values[question.id]" :aria-label="question.label"><el-radio v-for="option in question.options" :key="option.value" :value="option.value">{{ option.label }}</el-radio></el-radio-group>
        <el-checkbox-group v-else-if="question.kind === 'multiple'" :model-value="Array.isArray(values[question.id]) ? values[question.id] : []" :aria-label="question.label" @update:model-value="values[question.id] = $event as string[]"><el-checkbox v-for="option in question.options" :key="option.value" :value="option.value">{{ option.label }}</el-checkbox></el-checkbox-group>
        <el-date-picker v-else-if="question.kind === 'date'" v-model="values[question.id]" type="date" value-format="YYYY-MM-DD" :aria-label="question.label" />
        <el-input v-else v-model="values[question.id]" :aria-label="question.label" />
      </fieldset>
      <el-input v-model="notes" type="textarea" :rows="2" :disabled="restoring || busy || locked || submitted" :placeholder="zh ? '自行补充（选填）' : 'Additional notes (optional)'" :aria-label="zh ? '自行补充' : 'Additional notes'" />
      <el-button v-if="!submitted && !stale" native-type="submit" type="primary" :disabled="!ready || restoring" :loading="busy">{{ locked ? (zh ? '重试提交原选择' : 'Retry original submission') : (zh ? '确认并继续' : 'Confirm and continue') }}</el-button>
      <p v-if="submitted || stale" class="submitted-note" role="status">{{ continuationText || (zh ? '选择已提交，尚未核实原任务是否接受。' : 'Decisions submitted; acceptance has not been verified.') }}</p>
      <el-button v-if="stale || continuation === 'needs_attention'" @click="props.refreshConversation?.()">{{ zh ? '查看最新对话' : 'View latest conversation' }}</el-button>
      <el-button v-if="submitted && ['unavailable', 'needs_attention'].includes(continuation)" @click="refreshState().catch(() => { continuation = 'unavailable'; })">{{ zh ? '重新核实状态' : 'Check status again' }}</el-button>
      <el-button v-if="draftStatus === 'error' && !locked" @click="saveDraft">{{ zh ? '重试保存' : 'Retry saving' }}</el-button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <el-button v-if="error && !card" :loading="restoring" @click="loadCard">{{ zh ? '重新加载' : 'Reload' }}</el-button>
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
