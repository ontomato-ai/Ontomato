<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CircleHelp } from "lucide-vue-next";
import { useConversationContinuation, type ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { assistantClarificationSchema } from "@ontomato/contracts/assistant-clarification";

/**
 * A clarification card the assistant wrote. The answers go back as one ordinary user message that names this card's
 * file, and the assistant resumes from it; the card keeps no answered state of its own.
 */
const props = defineProps<ArtifactRendererProps>();
const inheritedContinuation = useConversationContinuation();
const continueConversation = computed(() => props.continueConversation ?? inheritedContinuation);
const { t, locale } = useI18n();
const card = ref<ReturnType<typeof assistantClarificationSchema.parse> | null>(null);
const values = ref<Record<string, string | string[]>>({});
const notes = ref("");
const busy = ref(false);
const loading = ref(true);
const error = ref("");
let generation = 0;
const ready = computed(() => card.value?.questions.every((question) => {
  const value = values.value[question.id];
  return !question.required || (typeof value === "string" ? Boolean(value.trim()) : Boolean(value?.length));
}));
async function loadCard() {
  const current = ++generation;
  loading.value = true; card.value = null; values.value = {}; notes.value = ""; error.value = "";
  try {
    const loaded = assistantClarificationSchema.parse(JSON.parse(await (await props.read()).text()));
    if (current === generation) card.value = loaded;
  }
  catch { if (current === generation) error.value = t("assistant.clarificationLoadFailed"); }
  finally { if (current === generation) loading.value = false; }
}
watch(() => props.artifact.id, loadCard, { immediate: true });
function message() {
  const list = new Intl.ListFormat(locale.value);
  const lines = [t("assistant.continuation.clarification", { title: card.value!.title, path: props.artifact.path })];
  for (const question of card.value!.questions) {
    const chosen = [values.value[question.id] ?? []].flat().filter((value) => value.trim());
    if (!chosen.length) continue;
    const labels = chosen.map((value) => question.options.find((option) => option.value === value)?.label ?? value);
    lines.push(t("assistant.continuation.answer", { question: question.label, answer: list.format(labels) }));
  }
  if (notes.value.trim()) lines.push(t("assistant.continuation.notes", { notes: notes.value.trim() }));
  lines.push(t("assistant.continuation.proceed"));
  return lines.join("\n");
}
async function submit() {
  if (!card.value || !ready.value || busy.value || !continueConversation.value) return;
  busy.value = true; error.value = "";
  try { await continueConversation.value(message()); }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="clarification-card" :aria-busy="busy">
    <div class="clarification-heading"><CircleHelp :size="16" /><strong>{{ t('assistant.clarificationNeeded') }}</strong></div>
    <form v-if="card" @submit.prevent="submit">
      <fieldset v-for="question in card.questions" :key="question.id" :disabled="busy">
        <legend>{{ question.label }}</legend>
        <el-radio-group v-if="question.kind === 'single'" v-model="values[question.id]" :aria-label="question.label"><el-radio v-for="option in question.options" :key="option.value" :value="option.value">{{ option.label }}</el-radio></el-radio-group>
        <el-checkbox-group v-else-if="question.kind === 'multiple'" :model-value="Array.isArray(values[question.id]) ? values[question.id] : []" :aria-label="question.label" @update:model-value="values[question.id] = $event as string[]"><el-checkbox v-for="option in question.options" :key="option.value" :value="option.value">{{ option.label }}</el-checkbox></el-checkbox-group>
        <el-date-picker v-else-if="question.kind === 'date'" v-model="values[question.id]" type="date" value-format="YYYY-MM-DD" :aria-label="question.label" />
        <el-input v-else v-model="values[question.id]" :aria-label="question.label" />
      </fieldset>
      <el-input v-model="notes" type="textarea" :rows="2" :disabled="busy" :placeholder="t('assistant.clarificationNotes')" :aria-label="t('assistant.clarificationNotes')" />
      <el-button native-type="submit" type="primary" :disabled="!ready || !continueConversation" :loading="busy">{{ t('assistant.clarificationConfirm') }}</el-button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <el-button v-if="error && !card" :loading="loading" @click="loadCard">{{ t('assistant.clarificationReload') }}</el-button>
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
.error { margin: var(--spacing-sm) 0 0; color: var(--el-color-danger); }
</style>
