<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { nodeApiRequest } from "@ontomato/workbench-ui";
import { DashboardMetricDetail } from "@ontomato/workbench-ui/features/dashboard";
import { platformSchedulesPath, platformTaskRunSchema } from "@ontomato/contracts/platform-schedules";
export type WorkspaceResource = { kind: "metric"; title: string; dashboardId: string; cardId: string; path: string }
  | { kind: "task"; title: string; taskId: string; runId: string | null; path: string; pauseMessage?: string };
const props = defineProps<{ resource: WorkspaceResource }>();
const { locale } = useI18n();
const result = ref(""), error = ref(""), loading = ref(false);
let revision = 0;
onBeforeUnmount(() => { revision++; });
async function load() {
  const resource = props.resource;
  const current = ++revision; result.value = ""; error.value = ""; loading.value = false;
  if (resource.kind !== "task" || !resource.runId) return;
  loading.value = true;
  try {
    const response = await nodeApiRequest(`${platformSchedulesPath}/${resource.taskId}/runs/${resource.runId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    const run = platformTaskRunSchema.parse(body);
    if (current === revision) result.value = (run.result || run.resultSummary || run.error?.message || (locale.value.startsWith("zh") ? "暂无结果" : "No result yet"))
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  } catch (failure) { if (current === revision) error.value = failure instanceof Error ? failure.message : String(failure); }
  finally { if (current === revision) loading.value = false; }
}
watch(() => props.resource, load, { immediate: true });
</script>
<template>
  <DashboardMetricDetail v-if="resource.kind === 'metric'" :dashboard-id="resource.dashboardId" :card-id="resource.cardId" />
  <div v-else :aria-busy="loading">
    <el-alert v-if="resource.pauseMessage" :title="resource.pauseMessage" type="warning" :closable="false" />
    <p v-if="loading" role="status">{{ locale.startsWith('zh') ? '正在读取执行结果…' : 'Loading execution result…' }}</p>
    <div v-else-if="error"><el-alert :title="error" type="error" :closable="false" /><el-button @click="load">{{ locale.startsWith('zh') ? '重试' : 'Retry' }}</el-button></div>
    <p v-else-if="!resource.runId">{{ locale.startsWith('zh') ? '任务尚未执行，可在完整页面查看配置与进展' : 'This task has not run yet. Open the full page for its configuration.' }}</p>
    <div v-else class="task-result">{{ result }}</div>
  </div>
</template>
<style scoped>.task-result { white-space: pre-wrap; overflow-wrap: anywhere; line-height: var(--leading-base); font-size: var(--text-base); }</style>
