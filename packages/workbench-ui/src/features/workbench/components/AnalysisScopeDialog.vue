<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { useConversationContinuation } from "@ontomato/agent-shell-ui";
import { nodeApiGet } from "../../../utils/api";
/** `title` is the dataset's name as the conversation shows it; the new query's message names the file by it and its path. */
const props = defineProps<{ artifact: RuntimeArtifact; title: string }>();
const visible = defineModel<boolean>({ default: false });
const continueConversation = useConversationContinuation();
const { t, locale } = useI18n();
const scopeSchema = z.object({ question: z.string(), assumptions: z.array(z.string()), filters: z.array(z.object({ id: z.string(), label: z.string(), expression: z.string() })) });
const scope = ref<z.infer<typeof scopeSchema> | null>(null);
const adjustment = ref(""); const error = ref(""); const loading = ref(false); const busy = ref(false);
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/analysis-scope`);
watch(visible, async (open) => {
  if (!open) return;
  loading.value = true; scope.value = null; adjustment.value = ""; error.value = "";
  try {
    scope.value = scopeSchema.parse(await nodeApiGet(`${endpoint.value}?locale=${encodeURIComponent(locale.value)}`));
  }
  catch (e) { error.value = e instanceof Error ? e.message : t("assistant.scopeLoadFailed"); }
  finally { loading.value = false; }
});
async function submit() {
  if (!scope.value || loading.value || !adjustment.value.trim() || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await continueConversation!(t("assistant.continuation.adjustScope", {
      file: t("assistant.continuation.file", { title: props.title, path: props.artifact.path }), adjustment: adjustment.value.trim() }));
    visible.value = false;
  } catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>
<template>
  <el-dialog v-model="visible" class="analysis-scope-dialog" :title="t('assistant.adjustScopeTitle')" width="min(640px, 94vw)" append-to-body :close-on-click-modal="!busy">
    <div v-loading="loading" class="scope-editor">
      <div v-if="scope" class="scope-question">
        <span class="section-caption">{{ t('assistant.scopeQuestion') }}</span>
        <p>{{ scope.question }}</p>
      </div>
      <el-form v-if="scope" label-position="top" :disabled="busy" @submit.prevent="submit">
        <div class="scope-conditions">
          <p class="section-caption">{{ t('assistant.scopeConditions') }}</p>
          <ul v-if="scope.filters.length"><li v-for="filter in scope.filters" :key="filter.id"><span class="condition-dot" aria-hidden="true" /><span class="condition-text">{{ filter.label }}</span></li></ul>
          <p v-else class="scope-hint">{{ t('assistant.scopeNoConditions') }}</p>
        </div>
        <el-form-item :label="t('assistant.scopeAdjustLabel')"><el-input v-model="adjustment" type="textarea" :maxlength="2000" :autosize="{ minRows: 3, maxRows: 6 }" :placeholder="t('assistant.scopeAdjustPlaceholder')" /></el-form-item>
        <p class="scope-hint">{{ t('assistant.scopeAdjustHint') }}</p>
      </el-form>
      <el-alert v-if="error" type="error" :closable="false" :title="error" />
    </div>
    <template #footer><div class="scope-footer"><div class="footer-actions"><el-button :disabled="busy" @click="visible = false">{{ t('common.cancel') }}</el-button><el-button type="primary" :loading="busy" :disabled="!scope || loading || !adjustment.trim()" @click="submit">{{ t('assistant.runNewQuery') }}</el-button></div></div></template>
  </el-dialog>
</template>
<style scoped>
.scope-editor { min-height: 100px; display: flex; flex-direction: column; gap: var(--spacing-md); max-height: 65vh; overflow-y: auto; padding: 2px; color: var(--el-text-color-primary); }
.scope-editor p { margin: 0; }
.scope-question { padding: var(--spacing-md); background: var(--el-fill-color-light); border-radius: var(--radius-md); }
.scope-question p { margin-top: var(--spacing-xs); font-size: var(--text-sm); line-height: 1.45; overflow-wrap: anywhere; }
.section-caption { color: var(--el-text-color-secondary); font-size: var(--text-xs); font-weight: 500; line-height: 1.5; }
.scope-hint { color: var(--el-text-color-secondary); font-size: var(--text-xs); line-height: 1.4; }
.scope-editor :deep(.el-form-item) { margin-bottom: var(--spacing-md); }
.scope-editor :deep(.el-form-item__label) { font-weight: 500; color: var(--el-text-color-primary); }
.scope-editor :deep(.el-form-item__content) { line-height: 1.45; }
.scope-editor :deep(.el-textarea__inner) { line-height: 1.45; padding: var(--spacing-sm) var(--spacing-md); }
.scope-conditions { margin-bottom: var(--spacing-md); padding: var(--spacing-sm) var(--spacing-md); border: 1px solid var(--el-border-color-light); border-radius: var(--radius-md); }
.scope-conditions ul { display: grid; gap: var(--spacing-xs); margin: var(--spacing-sm) 0 0; padding: 0; list-style: none; }
.scope-conditions li { display: flex; align-items: baseline; gap: var(--spacing-sm); padding: var(--spacing-xs) var(--spacing-sm); border-radius: var(--radius-sm); font-size: var(--text-sm); line-height: 1.4; }
.condition-dot { width: 5px; height: 5px; flex: 0 0 5px; background: var(--el-text-color-placeholder); border-radius: 50%; align-self: flex-start; margin-top: 7px; }
.condition-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.scope-footer { display: flex; justify-content: flex-end; align-items: center; }
.footer-actions { display: flex; flex-shrink: 0; gap: var(--spacing-sm); }
.footer-actions :deep(.el-button + .el-button) { margin-left: 0; }
@media (max-width: 480px) {
  .scope-footer { flex-wrap: wrap; }
  .footer-actions { margin-inline-start: auto; }
  .scope-conditions { padding: var(--spacing-sm); }
}
</style>
