<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { z } from "zod";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import { nodeApiFetch, nodeApiGet } from "../../../utils/api";
const props = defineProps<{ artifact: RuntimeArtifact; refresh?: () => Promise<void> }>();
const visible = defineModel<boolean>({ default: false });
const { locale } = useI18n();
const zh = computed(() => locale.value.startsWith("zh"));
const scopeSchema = z.object({ question: z.string(), assumptions: z.array(z.string()), filters: z.array(z.object({ id: z.string(), label: z.string(), expression: z.string() })) });
const scope = ref<z.infer<typeof scopeSchema> | null>(null);
const filterId = ref(""); const replacement = ref(""); const error = ref(""); const loading = ref(false); const busy = ref(false);
const requestId = ref(crypto.randomUUID());
const endpoint = computed(() => `/assistant/sessions/${props.artifact.sessionId}/artifacts/${props.artifact.id}/analysis-scope`);
const selected = computed(() => scope.value?.filters.find((filter) => filter.id === filterId.value));
watch(visible, async (open) => {
  if (!open) return;
  loading.value = true; scope.value = null; filterId.value = ""; replacement.value = ""; error.value = ""; requestId.value = crypto.randomUUID();
  try { scope.value = scopeSchema.parse(await nodeApiGet(endpoint.value)); }
  catch (e) { error.value = e instanceof Error ? e.message : (zh.value ? "无法读取原查询范围" : "Unable to read scope"); }
  finally { loading.value = false; }
});
watch([filterId, replacement], () => { requestId.value = crypto.randomUUID(); });
async function submit() {
  if (!selected.value || !replacement.value.trim() || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await nodeApiFetch(endpoint.value, "POST", { filterId: filterId.value, replacement: replacement.value.trim() }, { headers: { "Idempotency-Key": requestId.value } });
    visible.value = false; await props.refresh?.();
  } catch (e) { error.value = e instanceof Error ? e.message : (zh.value ? "查询未能启动，请重试" : "Unable to start query"); }
  finally { busy.value = false; }
}
</script>
<template>
  <el-dialog v-model="visible" :title="zh ? '调整分析范围' : 'Adjust analysis scope'" width="min(560px, 94vw)" append-to-body :close-on-click-modal="!busy">
    <div v-loading="loading" class="scope-editor">
      <p v-if="scope">{{ scope.question }}</p>
      <p class="scope-hint">{{ zh ? '修改一项原查询条件后重新取数，其他条件保持不变。原结果将保留。' : 'Change one source condition and run a new query. Other conditions and the old result are preserved.' }}</p>
      <el-form v-if="scope?.filters.length" label-position="top" :disabled="busy" @submit.prevent="submit">
        <el-form-item :label="zh ? '原查询条件' : 'Source condition'"><el-select v-model="filterId" :aria-label="zh ? '原查询条件' : 'Source condition'"><el-option v-for="filter in scope.filters" :key="filter.id" :value="filter.id" :label="filter.label" /></el-select></el-form-item>
        <el-form-item :label="zh ? '调整为' : 'Replace with'"><el-input v-model="replacement" :placeholder="zh ? '例如：年龄改为55岁及以上' : 'Describe the new condition'" /></el-form-item>
        <div v-if="selected && replacement.trim()" class="scope-preview"><span>{{ selected.label }}</span><span aria-hidden="true">→</span><strong>{{ replacement }}</strong></div>
      </el-form>
      <el-empty v-else-if="scope && !loading" :description="zh ? '这份结果没有可确认来源的筛选条件，请在对话中补充范围。' : 'No source filters are available. Describe the new scope in chat.'" :image-size="48" />
      <el-alert v-if="error" type="error" :closable="false" :title="error" />
    </div>
    <template #footer><el-button :disabled="busy" @click="visible = false">{{ zh ? '取消' : 'Cancel' }}</el-button><el-button type="primary" :loading="busy" :disabled="!selected || !replacement.trim()" @click="submit">{{ zh ? '重新查询' : 'Run new query' }}</el-button></template>
  </el-dialog>
</template>
<style scoped>
.scope-editor { min-height: 100px; display: flex; flex-direction: column; gap: var(--spacing-md); }
.scope-editor p { margin: 0; }
.scope-hint { color: var(--el-text-color-secondary); font-size: var(--text-sm); }
.scope-preview { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); padding: var(--spacing-md); background: var(--el-fill-color-light); border-radius: var(--radius-sm); }
.el-select { width: 100%; }
</style>
