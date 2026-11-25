<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { useMember, useMemberData, useMemberRefresh } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { useDataStateLabels } from "./data-state-labels";
import { rawRecordField } from "./record-field";
import type { ScheduledTaskRunView } from "./scheduled-task-summary-types";

/**
 * Dedicated scheduled-task recent-run detail view (spec 2.1.2, W-11).
 *
 * Consumes a bound `record` (`platform:ScheduledTaskRun` or `platform:ScheduledTask` carrying latest run fields) or a
 * direct `run` prop, rendering:
 * 1. Highlighted warning/danger notice banners when the task is paused or the run failed/skipped;
 * 2. Execution overview strip with status dot, trigger kind, and two-column Started/Finished timestamp `<dl>`;
 * 3. Multi-paragraph cleaned execution result body;
 * 4. Refresh button invoking member refresh and emitting `refresh`.
 */

const props = withDefaults(
  defineProps<{
    /** Optional direct run object for standalone usage outside a `record` datum binding. */
    run?: ScheduledTaskRunView | null;
    /** Optional pause notice from the parent scheduled task. */
    pauseMessage?: string | null;
    /** Show the refresh action button below the result (default `true`). */
    showRefresh?: boolean;
  }>(),
  {
    run: undefined,
    pauseMessage: undefined,
    showRefresh: true,
  },
);

const emit = defineEmits<{
  /** Emitted when the user clicks the refresh button. */
  refresh: [];
}>();

const member = (() => {
  try {
    return useMember();
  } catch {
    return null;
  }
})();

const recordState = (() => {
  if (!member?.projection.data?.record) return null;
  try {
    return useMemberData("record");
  } catch {
    return null;
  }
})();

const memberRefresh = (() => {
  try {
    return useMemberRefresh();
  } catch {
    return () => {};
  }
})();

const i18n = (() => {
  try {
    return useI18n();
  } catch {
    return null;
  }
})();
const locale = computed(() => i18n?.locale.value ?? "en");
const isZh = computed(() => locale.value.toLowerCase().startsWith("zh"));
function translate(key: string, fallback: string): string {
  return i18n && i18n.te(key) ? i18n.t(key) : fallback;
}

function readRawField(record: Record<string, unknown>, key: string): unknown {
  if (record.fields && typeof record.fields === "object") {
    return rawRecordField(record as unknown as PlatformObjectRecord, key);
  }
  return record[key];
}

function readStr(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = readRawField(record, key);
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function extractPauseMessage(record: Record<string, unknown>): string | null {
  const pauseObj = readRawField(record, "pause") as Record<string, unknown> | undefined;
  return readStr(record, "pauseMessage", "pauseReason")
    ?? (typeof pauseObj?.message === "string" && pauseObj.message.trim() ? pauseObj.message.trim() : null);
}

function parseRecordRun(record: Record<string, unknown>): ScheduledTaskRunView | null {
  const status = readStr(record, "status", "lastRunStatus");
  const startedAt = readStr(record, "startedAt", "lastRunStartedAt");
  const finishedAt = readStr(record, "finishedAt", "lastRunFinishedAt");
  const trigger = readStr(record, "trigger", "triggerType");
  const pauseMessage = extractPauseMessage(record);
  const errObj = readRawField(record, "error") as Record<string, unknown> | undefined;
  const errorMessage = readStr(record, "errorMessage", "lastRunError")
    ?? (typeof errObj?.message === "string" ? errObj.message : null);
  const snapshotObj = readRawField(record, "snapshot") as Record<string, unknown> | undefined;
  const timeZone = readStr(record, "timeZone")
    ?? (typeof snapshotObj?.timeZone === "string" ? snapshotObj.timeZone : null);
  const result = readStr(record, "result", "outputText");
  const resultSummary = readStr(record, "resultSummary", "summary");

  if (!status && !startedAt && !result && !resultSummary && !errorMessage) {
    return null;
  }
  return {
    status: status || "completed",
    trigger,
    startedAt,
    finishedAt,
    timeZone,
    pauseMessage,
    errorMessage,
    result,
    resultSummary,
  };
}

const resolvedData = computed<DataStateResult<ScheduledTaskRunView>>(() => {
  if (props.run !== undefined) {
    return props.run ? { status: "ready", value: props.run } : { status: "empty" };
  }
  if (!recordState) return { status: "empty" };
  const state = recordState.value;
  if (state.status !== "ready") return state as DataStateResult<ScheduledTaskRunView>;
  if (!state.value || typeof state.value !== "object") return { status: "empty" };
  const parsed = parseRecordRun(state.value as unknown as Record<string, unknown>);
  return parsed ? { status: "ready", value: parsed } : { status: "empty" };
});

const effectivePause = computed(() => {
  if (props.pauseMessage) return props.pauseMessage;
  if (resolvedData.value.status === "ready" && resolvedData.value.value.pauseMessage) {
    return resolvedData.value.value.pauseMessage;
  }
  if (recordState && recordState.value.status === "ready" && recordState.value.value && typeof recordState.value.value === "object") {
    return extractPauseMessage(recordState.value.value as unknown as Record<string, unknown>);
  }
  return null;
});

function cleanResultParagraphs(run: ScheduledTaskRunView): string[] {
  const raw = (run.result || run.resultSummary || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return raw ? raw.split(/\n\s*\n/).filter(Boolean) : [];
}

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return translate("ontology.productTaskRunning", isZh.value ? "运行中" : "Running");
    case "completed":
      return translate("ontology.productHomeTaskCompleted", isZh.value ? "已完成" : "Completed");
    case "failed":
      return translate("ontology.productHomeTaskFailed", isZh.value ? "执行失败" : "Failed");
    case "skipped":
      return translate("ontology.productHomeTaskSkipped", isZh.value ? "已跳过" : "Skipped");
    default:
      return status;
  }
}

function triggerLabel(trigger?: string | null): string {
  if (trigger === "manual") return translate("ontology.productHomeManualRun", isZh.value ? "手动触发" : "Manual run");
  if (trigger === "schedule") return translate("ontology.productHomeScheduledRun", isZh.value ? "定时触发" : "Scheduled run");
  return translate("ontology.productHomeExecution", isZh.value ? "执行记录" : "Execution");
}

function formatMoment(value: string, timeZone?: string | null): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return parsed.toLocaleString(locale.value, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {}),
    });
  } catch {
    return parsed.toLocaleString(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
}

const labels = useDataStateLabels(() =>
  translate("ontology.productHomeNoRun", isZh.value ? "尚无运行记录" : "No run history yet"),
);

function handleRefresh() {
  memberRefresh();
  emit("refresh");
}
</script>

<template>
  <div class="sdk-scheduled-task-run-detail">
    <section v-if="effectivePause" class="sdk-strd-notice is-warning" role="note">
      <h4 class="sdk-strd-heading">{{ translate("ontology.productHomeTaskPausedTitle", isZh ? "任务已暂停" : "Task paused") }}</h4>
      <p>{{ effectivePause }}</p>
    </section>

    <DataState :result="resolvedData" :labels="labels" @retry="handleRefresh">
      <template #default="{ value: run }">
        <section class="sdk-strd-overview">
          <div class="sdk-strd-status-row">
            <span class="sdk-strd-dot" :class="run.status" aria-hidden="true" />
            <strong class="sdk-strd-status">{{ statusLabel(run.status) }}</strong>
            <span class="sdk-strd-trigger">{{ triggerLabel(run.trigger) }}</span>
          </div>
          <dl v-if="run.startedAt || run.finishedAt" class="sdk-strd-times">
            <div v-if="run.startedAt">
              <dt>{{ translate("ontology.productHomeStartedAt", isZh ? "开始时间" : "Started") }}</dt>
              <dd>{{ formatMoment(run.startedAt, run.timeZone) }}</dd>
            </div>
            <div v-if="run.finishedAt">
              <dt>{{ translate("ontology.productHomeFinishedAt", isZh ? "完成时间" : "Finished") }}</dt>
              <dd>{{ formatMoment(run.finishedAt, run.timeZone) }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="run.errorMessage" class="sdk-strd-notice is-danger" role="alert">
          <h4 class="sdk-strd-heading">
            {{
              run.status === "skipped"
                ? translate("ontology.productHomeSkipReason", isZh ? "跳过原因" : "Skip reason")
                : translate("ontology.productHomeFailureReason", isZh ? "失败原因" : "Failure reason")
            }}
          </h4>
          <p>{{ run.errorMessage }}</p>
        </section>

        <section v-if="cleanResultParagraphs(run).length > 0" class="sdk-strd-result">
          <h4 class="sdk-strd-heading">{{ translate("ontology.productHomeRunResult", isZh ? "执行结果" : "Execution result") }}</h4>
          <p v-for="(paragraph, index) in cleanResultParagraphs(run)" :key="index">{{ paragraph }}</p>
        </section>

        <div v-else class="sdk-strd-empty">
          <p>
            {{
              run.status === "running"
                ? translate("ontology.productHomeRunInProgress", isZh ? "任务正在运行中…" : "Run is in progress…")
                : translate("ontology.productHomeRunNoText", isZh ? "本次运行未产出文本结果" : "No text result was produced.")
            }}
          </p>
        </div>

        <button
          v-if="showRefresh"
          type="button"
          class="sdk-strd-refresh-btn"
          data-testid="scheduled-task-run-refresh"
          @click="handleRefresh"
        >
          {{ translate("ontology.productHomeRefreshRun", isZh ? "刷新状态" : "Refresh run") }}
        </button>
      </template>
    </DataState>
  </div>
</template>

<style scoped>
.sdk-scheduled-task-run-detail {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg, 16px);
  min-width: 0;
  width: 100%;
}

.sdk-strd-heading {
  margin: 0 0 var(--spacing-sm, 8px);
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  line-height: 1.5;
  color: var(--el-text-color-primary);
}

.sdk-strd-overview {
  padding-block: var(--spacing-xs, 4px) var(--spacing-lg, 16px);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.sdk-strd-status-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm, 8px);
  font-size: var(--text-sm, 14px);
}

.sdk-strd-status {
  font-weight: var(--font-semibold, 600);
  color: var(--el-text-color-primary);
}

.sdk-strd-trigger {
  margin-left: auto;
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs, 12px);
}

.sdk-strd-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-info);
  flex: none;
}

.sdk-strd-dot.completed {
  background: var(--el-color-success);
}

.sdk-strd-dot.failed {
  background: var(--el-color-danger);
}

.sdk-strd-dot.running {
  background: var(--el-color-primary);
}

.sdk-strd-times {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-md, 12px);
  margin: var(--spacing-md, 12px) 0 0;
  font-size: var(--text-xs, 12px);
}

.sdk-strd-times dt {
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.sdk-strd-times dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

.sdk-strd-notice {
  padding: var(--spacing-md, 12px) var(--spacing-lg, 16px);
  border-left: 3px solid var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  border-radius: var(--radius-xs, 4px);
}

.sdk-strd-notice.is-danger {
  border-color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.sdk-strd-notice p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--text-sm, 13px);
  line-height: 1.75;
  color: var(--el-text-color-primary);
}

.sdk-strd-result p {
  margin: 0 0 var(--spacing-md, 12px);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.85;
  font-size: var(--text-base, 14px);
  color: var(--el-text-color-primary);
}

.sdk-strd-result p:last-child {
  margin-bottom: 0;
}

.sdk-strd-empty {
  color: var(--el-text-color-secondary);
  padding-block: var(--spacing-sm, 8px);
}

.sdk-strd-empty p {
  margin: 0;
  font-size: var(--text-sm, 13px);
  line-height: 1.7;
}

.sdk-strd-refresh-btn {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-sm, 6px);
  background: var(--el-bg-color);
  color: var(--el-text-color-regular);
  font-size: var(--text-xs, 12px);
  font-weight: var(--font-medium, 500);
  cursor: pointer;
}

.sdk-strd-refresh-btn:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}
</style>
