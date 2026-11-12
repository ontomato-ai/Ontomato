<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { nodeApiRequest } from "@ontomato/workbench-ui";
import { DashboardMetricDetail } from "@ontomato/workbench-ui/features/dashboard";
import { platformSchedulesPath, platformTaskRunSchema, type PlatformTaskRun } from "@ontomato/contracts/platform-schedules";
import WorkspaceSkeleton from "./WorkspaceSkeleton.vue";
export type WorkspaceResource = { kind: "metric"; title: string; dashboardId: string; cardId: string; path: string }
  | { kind: "task"; title: string; taskId: string; runId: string | null; path: string; pauseMessage?: string };
const props = defineProps<{ resource: WorkspaceResource }>();
const { locale } = useI18n();
const result = ref(""), error = ref(""), loading = ref(false);
const run = ref<PlatformTaskRun | null>(null);
const zh = computed(() => locale.value.startsWith("zh"));
const status = computed(() => run.value ? ({ running: zh.value ? "运行中" : "Running", completed: zh.value ? "执行完成" : "Completed", failed: zh.value ? "执行失败" : "Failed", skipped: zh.value ? "已跳过" : "Skipped" })[run.value.status] : "");
const paragraphs = computed(() => result.value.split(/\n\s*\n/).filter(Boolean));
function moment(value: string) { return new Date(value).toLocaleString(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: run.value?.snapshot.timeZone }); }
let revision = 0;
onBeforeUnmount(() => { revision++; });
async function load() {
  const resource = props.resource;
  const current = ++revision; result.value = ""; run.value = null; error.value = ""; loading.value = false;
  if (resource.kind !== "task" || !resource.runId) return;
  loading.value = true;
  try {
    const response = await nodeApiRequest(`${platformSchedulesPath}/${resource.taskId}/runs/${resource.runId}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? `HTTP ${response.status}`);
    const record = platformTaskRunSchema.parse(body);
    if (current === revision) {
      run.value = record;
      result.value = (record.result || record.resultSummary || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
    }
  } catch (failure) { if (current === revision) error.value = failure instanceof Error ? failure.message : String(failure); }
  finally { if (current === revision) loading.value = false; }
}
watch(() => props.resource, load, { immediate: true });
</script>
<template>
  <DashboardMetricDetail v-if="resource.kind === 'metric'" :dashboard-id="resource.dashboardId" :card-id="resource.cardId" />
  <div v-else class="task-detail" :aria-busy="loading">
    <section v-if="resource.pauseMessage" class="task-notice is-warning"><h3>{{ zh ? '任务已暂停' : 'Task paused' }}</h3><p>{{ resource.pauseMessage }}</p></section>
    <WorkspaceSkeleton v-if="loading" :label="zh ? '正在读取执行结果' : 'Loading execution result'" />
    <div v-else-if="error"><el-alert :title="error" type="error" :closable="false" /><el-button @click="load">{{ locale.startsWith('zh') ? '重试' : 'Retry' }}</el-button></div>
    <div v-else-if="!resource.runId" class="task-empty"><h3>{{ zh ? '暂无执行记录' : 'No execution yet' }}</h3><p>{{ zh ? '在完整页面查看任务配置与处理方式' : 'Open the full page for task configuration and next steps' }}</p></div>
    <template v-else-if="run">
      <section class="execution-overview">
        <div class="execution-status"><span class="status-dot" :class="run.status" aria-hidden="true" /><strong>{{ status }}</strong><span class="execution-trigger">{{ run.trigger === 'manual' ? (zh ? '手动执行' : 'Manual run') : run.trigger === 'schedule' ? (zh ? '定时执行' : 'Scheduled run') : (zh ? '执行记录' : 'Execution') }}</span></div>
        <dl class="execution-times"><div><dt>{{ zh ? '开始时间' : 'Started' }}</dt><dd>{{ moment(run.startedAt) }}</dd></div><div v-if="run.finishedAt"><dt>{{ zh ? '结束时间' : 'Finished' }}</dt><dd>{{ moment(run.finishedAt) }}</dd></div></dl>
      </section>
      <section v-if="run.error" class="task-notice is-danger"><h3>{{ run.status === 'skipped' ? (zh ? '跳过原因' : 'Why it was skipped') : (zh ? '失败原因' : 'Failure reason') }}</h3><p>{{ run.error.message }}</p></section>
      <section v-if="result" class="task-result"><h3>{{ zh ? '执行结果' : 'Result' }}</h3><p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p></section>
      <div v-else class="task-empty"><p>{{ run.status === 'running' ? (zh ? '任务仍在执行，稍后刷新查看结果' : 'The task is running. Refresh later for results.') : (zh ? '本次执行未返回结果正文' : 'This execution returned no result text') }}</p></div>
      <el-button class="result-refresh" :loading="loading" @click="load">{{ zh ? '刷新执行记录' : 'Refresh execution' }}</el-button>
    </template>
  </div>
</template>
<style scoped>
.task-detail { display: flex; flex-direction: column; gap: var(--spacing-lg); min-width: 0; }
.task-detail h3 { font-size: var(--text-sm); font-weight: var(--font-semibold); line-height: 1.5; margin: 0 0 var(--spacing-sm); }
.execution-overview { padding-block: var(--spacing-sm) var(--spacing-lg); border-bottom: 1px solid var(--el-border-color-lighter); }
.execution-status { display: flex; align-items: center; gap: var(--spacing-sm); font-size: var(--text-sm); }
.execution-status strong { font-weight: var(--font-semibold); }
.execution-trigger { margin-left: auto; color: var(--el-text-color-secondary); font-size: var(--text-xs); }
.status-dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--el-color-info); }
.status-dot.completed { background: var(--el-color-success); }.status-dot.failed { background: var(--el-color-danger); }.status-dot.running { background: var(--el-color-primary); }
.execution-times { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--spacing-md); margin: var(--spacing-md) 0 0; font-size: var(--text-xs); }
.execution-times dt { color: var(--el-text-color-secondary); margin-bottom: var(--spacing-xs); }.execution-times dd { margin: 0; font-variant-numeric: tabular-nums; }
.task-notice { padding: var(--spacing-md) var(--spacing-lg); border-left: 3px solid var(--el-color-warning); background: var(--el-color-warning-light-9); border-radius: var(--radius-xs); }
.task-notice.is-danger { border-color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
.task-notice p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-sm); line-height: 1.8; }
.task-result p { margin: 0 0 var(--spacing-md); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.85; font-size: var(--text-base); }.task-result p:last-child { margin-bottom: 0; }
.task-empty { color: var(--el-text-color-secondary); padding-block: var(--spacing-md); }.task-empty p { margin: 0; font-size: var(--text-sm); line-height: 1.7; }
.result-refresh { align-self: flex-start; }
@media(max-width:480px) { .execution-times { grid-template-columns: 1fr; } }
</style>
