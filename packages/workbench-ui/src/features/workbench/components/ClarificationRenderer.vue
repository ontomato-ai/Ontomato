<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CircleHelp } from "lucide-vue-next";
import type { ArtifactRendererProps } from "@ontomato/agent-shell-ui";
import { assistantClarificationSchema } from "@ontomato/contracts/assistant-clarification";

/**
 * A clarification card an earlier assistant wrote, shown as the record it is: its title, its questions and their
 * options. Agents now ask over the composer and the reader answers there, so the card takes no answer.
 */
const props = defineProps<ArtifactRendererProps>();
const { t } = useI18n();
const card = ref<ReturnType<typeof assistantClarificationSchema.parse> | null>(null);
const loading = ref(true);
const error = ref("");
let generation = 0;
async function loadCard() {
  const current = ++generation;
  loading.value = true; card.value = null; error.value = "";
  try {
    const loaded = assistantClarificationSchema.parse(JSON.parse(await (await props.read()).text()));
    if (current === generation) card.value = loaded;
  }
  catch { if (current === generation) error.value = t("assistant.clarificationLoadFailed"); }
  finally { if (current === generation) loading.value = false; }
}
watch(() => props.artifact.id, loadCard, { immediate: true });
</script>
<template>
  <section class="clarification-card" :aria-busy="loading">
    <template v-if="card">
      <div class="clarification-heading"><CircleHelp :size="16" /><strong>{{ card.title }}</strong></div>
      <div class="clarification-questions">
        <div v-for="question in card.questions" :key="question.id" class="clarification-question">
          <p class="question-label">{{ question.label }}</p>
          <ul v-if="question.options.length" class="question-options">
            <li v-for="option in question.options" :key="option.value">{{ option.label }}</li>
          </ul>
        </div>
      </div>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <el-button v-if="error && !card" :loading="loading" @click="loadCard">{{ t('assistant.clarificationReload') }}</el-button>
  </section>
</template>
<style scoped>
.clarification-card { display: block; box-sizing: border-box; padding: var(--spacing-lg); font-size: var(--text-sm); line-height: var(--leading-sm); }
.clarification-heading { display: flex; align-items: center; gap: var(--spacing-sm); margin-bottom: var(--spacing-lg); color: var(--el-text-color-primary); }
.clarification-questions { display: flex; flex-direction: column; gap: var(--spacing-lg); }
.question-label { margin: 0 0 var(--spacing-xs); color: var(--el-text-color-primary); font-weight: var(--font-medium); }
.question-options { display: flex; flex-wrap: wrap; gap: var(--spacing-xs) var(--spacing-sm); margin: 0; padding: 0; list-style: none; }
.question-options li { padding: 0 var(--spacing-sm); border: 1px solid var(--el-border-color); border-radius: var(--radius-xs); color: var(--el-text-color-regular); }
.error { margin: var(--spacing-sm) 0 0; color: var(--el-color-danger); }
</style>
