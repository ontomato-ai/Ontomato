<script setup lang="ts">
import { computed, inject } from "vue";
import { useI18n } from "vue-i18n";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelContextKey } from "../panel/context";
import { useMember, useMemberData, useMemberOutput, useMemberParam } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import type { ObjectListRef } from "./object-list-types";
import { rawRecordField } from "./record-field";
import type { ScheduledTaskSummaryItem } from "./scheduled-task-summary-types";

/**
 * Dedicated personal-workspace scheduled task summary & three-tier attention list (spec 2.1.2, W-07).
 *
 * Consumes a bound `rows` (`panelRecordList` / `panelRecordQuery`) of `platform:ScheduledTask` records — or direct
 * `tasks` prop — and renders:
 * 1. A top three-metric attention counter strip (Needs intervention / Recent results / Running) with alert emphasis;
 * 2. Three categorized task sections in attention priority order (`issues`, `running`, `results`);
 * 3. Per-row status dot (danger/warning/primary/success), multi-line summary/pause/error excerpt, next run timestamp,
 *    and an inline conditional "Resolve" action button for tasks requiring user intervention.
 */

const props = withDefaults(
  defineProps<{
    /** Optional direct task array for standalone usage outside a `rows` datum binding. */
    tasks?: readonly ScheduledTaskSummaryItem[];
    /** Maximum number of rows rendered per attention group (default `6`). */
    maxPerGroup?: number;
    /** Label for the conditional inline resolve button on intervention rows. */
    resolveLabel?: string;
    /** Whether to display the conditional inline resolve button on rows requiring intervention (default `true`). */
    showResolveAction?: boolean;
    /** Optional empty state message when no tasks require attention. */
    emptyText?: string;
  }>(),
  {
    tasks: undefined,
    maxPerGroup: 6,
    resolveLabel: undefined,
    showResolveAction: true,
    emptyText: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the reader clicks a task title to open its detail drawer or page. */
  select: [task: ScheduledTaskSummaryItem];
  /** Emitted when the reader clicks the conditional "Resolve" button on a paused/failed task. */
  resolve: [task: ScheduledTaskSummaryItem];
}>();

defineSlots<{
  /** Optional custom trailing action rendered at the end of each task row. */
  "row-actions"?(scope: { task: ScheduledTaskSummaryItem; needsIntervention: boolean }): unknown;
}>();

const panel = inject(panelContextKey, null);
const member = (() => {
  try {
    return useMember();
  } catch {
    return null;
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

const rowsState = (() => {
  if (!member?.projection.data?.rows) return null;
  try {
    return useMemberData("rows");
  } catch {
    return null;
  }
})();

const selectedParam = (() => {
  try {
    return useMemberParam("selected");
  } catch {
    return null;
  }
})();

const selectedKey = computed<string | null>(() => {
  if (!selectedParam) return null;
  const obj = stateObject(selectedParam.value.value as PanelFieldValue);
  return obj ? `${obj.className}:${obj.primaryKey}` : null;
});

function readStr(row: PlatformObjectRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = rawRecordField(row, key);
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function parseTaskRecord(row: PlatformObjectRecord): ScheduledTaskSummaryItem {
  const pauseObj = rawRecordField(row, "pause");
  const pauseMessage = readStr(row, "pauseMessage", "pauseReason")
    ?? (pauseObj && typeof pauseObj === "object" && typeof (pauseObj as Record<string, unknown>).message === "string"
      ? String((pauseObj as Record<string, unknown>).message)
      : null);

  const lastRunObj = rawRecordField(row, "lastRun") as Record<string, unknown> | undefined;
  const lastRunErrObj = lastRunObj?.error as Record<string, unknown> | undefined;

  const activeRunId = readStr(row, "activeRunId");
  const enabledRaw = rawRecordField(row, "enabled");
  const enabled = enabledRaw === undefined ? true : Boolean(enabledRaw);
  const lastRunStatus = readStr(row, "lastRunStatus", "status")
    ?? (typeof lastRunObj?.status === "string" ? lastRunObj.status : null);
  const lastRunFinishedAt = readStr(row, "lastRunFinishedAt", "lastFinishedAt")
    ?? (typeof lastRunObj?.finishedAt === "string" ? lastRunObj.finishedAt : null);
  const lastRunErrorMessage = readStr(row, "lastRunError", "errorMessage")
    ?? (typeof lastRunErrObj?.message === "string" ? lastRunErrObj.message : null);
  const lastRunSummary = readStr(row, "lastRunSummary", "resultSummary", "summary")
    ?? (typeof lastRunObj?.resultSummary === "string" ? lastRunObj.resultSummary : null);
  const nextRunAt = readStr(row, "nextRunAt");

  return {
    id: row.primaryKey,
    title: row.label || readStr(row, "title", "name") || row.primaryKey,
    enabled,
    activeRunId,
    pauseMessage,
    lastRunStatus,
    lastRunFinishedAt,
    lastRunErrorMessage,
    lastRunSummary,
    nextRunAt,
    ref: { className: row.className || "platform:ScheduledTask", primaryKey: row.primaryKey },
    row,
  };
}

const resolvedData = computed<DataStateResult<readonly ScheduledTaskSummaryItem[]>>(() => {
  if (props.tasks) {
    return { status: "ready", value: props.tasks };
  }
  if (!rowsState) return { status: "empty" };
  const state = rowsState.value;
  if (state.status !== "ready") return state as DataStateResult<readonly ScheduledTaskSummaryItem[]>;
  const raw = state.value as unknown as readonly PlatformObjectRecord[] | { rows?: readonly PlatformObjectRecord[] } | null;
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows) ? (raw as { rows: readonly PlatformObjectRecord[] }).rows : []);
  return { status: "ready", value: rows.map(parseTaskRecord) };
});

function needsIntervention(task: ScheduledTaskSummaryItem): boolean {
  if (task.activeRunId) return false;
  if (task.pauseMessage) return true;
  return task.lastRunStatus === "failed";
}

function isRunning(task: ScheduledTaskSummaryItem): boolean {
  return Boolean(task.activeRunId) || task.lastRunStatus === "running";
}

function isRecentResult(task: ScheduledTaskSummaryItem): boolean {
  if (needsIntervention(task) || isRunning(task)) return false;
  return Boolean(task.lastRunFinishedAt || task.lastRunSummary || task.lastRunStatus === "completed");
}

const categorized = computed(() => {
  const list = resolvedData.value.status === "ready" ? resolvedData.value.value : [];
  const issues = list.filter(needsIntervention);
  const running = list.filter((task) => !needsIntervention(task) && isRunning(task));
  const results = list.filter(isRecentResult);
  const groups: Array<{ id: "issues" | "running" | "results"; label: string; items: readonly ScheduledTaskSummaryItem[] }> = [];
  if (issues.length) {
    groups.push({
      id: "issues",
      label: translate("ontology.productHomeNeedIntervention", isZh.value ? "需处理" : "Needs intervention"),
      items: issues.slice(0, props.maxPerGroup),
    });
  }
  if (running.length) {
    groups.push({
      id: "running",
      label: translate("ontology.productTaskRunning", isZh.value ? "运行中" : "Running"),
      items: running.slice(0, props.maxPerGroup),
    });
  }
  if (results.length) {
    groups.push({
      id: "results",
      label: translate("ontology.productHomeRecentResults", isZh.value ? "最近结果" : "Recent results"),
      items: results.slice(0, props.maxPerGroup),
    });
  }
  return { issues, running, results, groups };
});

useMemberOutput("status", () => resolvedData.value.status);
useMemberOutput("issueCount", () => categorized.value.issues.length);
useMemberOutput("runningCount", () => categorized.value.running.length);
useMemberOutput("resultCount", () => categorized.value.results.length);

const labels = useDataStateLabels(() => props.emptyText || (isZh.value ? "暂无需要关注的定时任务" : "No scheduled tasks require attention"));

function statusDotClass(task: ScheduledTaskSummaryItem): string {
  if (isRunning(task)) return "is-running";
  if (task.pauseMessage) return "is-paused";
  if (task.lastRunStatus === "failed") return "is-failed";
  if (task.lastRunStatus === "completed") return "is-completed";
  return "is-idle";
}

function statusText(task: ScheduledTaskSummaryItem): string {
  if (isRunning(task)) return translate("ontology.productTaskRunning", isZh.value ? "运行中" : "Running");
  if (task.pauseMessage) return translate("ontology.productTaskPaused", isZh.value ? "已暂停" : "Paused");
  if (!task.enabled) return translate("ontology.productTaskDisabled", isZh.value ? "已停用" : "Disabled");
  if (task.lastRunStatus === "completed") return translate("ontology.productHomeTaskCompleted", isZh.value ? "已完成" : "Completed");
  if (task.lastRunStatus === "failed") return translate("ontology.productHomeTaskFailed", isZh.value ? "执行失败" : "Failed");
  if (task.lastRunStatus === "skipped") return translate("ontology.productHomeTaskSkipped", isZh.value ? "已跳过" : "Skipped");
  return translate("ontology.productHomeTaskPending", isZh.value ? "待运行" : "Pending");
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatSummaryExcerpt(value: string): string {
  return value
    .replace(/!\[[\s\S]*$/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\n\s*\n/)[0]
    ?.replace(/\s+/g, " ")
    .trim() ?? "";
}

function isTaskSelected(task: ScheduledTaskSummaryItem): boolean {
  if (!task.ref || !selectedKey.value) return false;
  return `${task.ref.className}:${task.ref.primaryKey}` === selectedKey.value;
}

function handleSelect(task: ScheduledTaskSummaryItem) {
  if (task.ref && selectedParam) {
    selectedParam.set({ className: task.ref.className, primaryKey: task.ref.primaryKey });
  }
  if (task.ref && panel && member && panel.manifest.members[member.key]?.outputs?.select) {
    void panel.instance.output(member.key, "select", {
      className: task.ref.className,
      primaryKey: task.ref.primaryKey,
    });
  }
  emit("select", task);
}

function handleResolve(task: ScheduledTaskSummaryItem) {
  if (task.ref && panel && member && panel.manifest.members[member.key]?.outputs?.resolveTarget) {
    void panel.instance.output(member.key, "resolveTarget", {
      className: task.ref.className,
      primaryKey: task.ref.primaryKey,
    });
  } else if (task.ref && panel && member && panel.manifest.members[member.key]?.outputs?.resolve) {
    void panel.instance.output(member.key, "resolve", {
      className: task.ref.className,
      primaryKey: task.ref.primaryKey,
    });
  } else if (task.ref && panel && member && panel.manifest.members[member.key]?.outputs?.navigate) {
    void panel.instance.output(member.key, "navigate", {
      className: task.ref.className,
      primaryKey: task.ref.primaryKey,
    });
  }
  emit("resolve", task);
}
</script>

<template>
  <div class="sdk-scheduled-task-summary">
    <DataState :result="resolvedData" :labels="labels">
      <div class="sdk-sts-body">
        <div class="sdk-sts-counters" aria-live="polite">
          <div class="sdk-sts-counter" :class="{ 'has-issues': categorized.issues.length > 0 }">
            <strong class="sdk-sts-count">{{ categorized.issues.length }}</strong>
            <span class="sdk-sts-count-label">
              <svg v-if="categorized.issues.length > 0" class="sdk-sts-alert-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" x2="12" y1="8" y2="12" />
                <line x1="12" x2="12.01" y1="16" y2="16" />
              </svg>
              {{ translate("ontology.productHomeNeedIntervention", isZh ? "需处理" : "Needs intervention") }}
            </span>
          </div>
          <div class="sdk-sts-counter">
            <strong class="sdk-sts-count">{{ categorized.results.length }}</strong>
            <span class="sdk-sts-count-label">
              {{ translate("ontology.productHomeRecentResults", isZh ? "最近结果" : "Recent results") }}
            </span>
          </div>
          <div v-if="categorized.running.length > 0" class="sdk-sts-counter is-running">
            <strong class="sdk-sts-count">{{ categorized.running.length }}</strong>
            <span class="sdk-sts-count-label">
              {{ translate("ontology.productTaskRunning", isZh ? "运行中" : "Running") }}
            </span>
          </div>
        </div>

        <p v-if="categorized.groups.length === 0" class="sdk-sts-empty">
          {{ emptyText || translate("ontology.productHomeNoInterventionTasks", isZh ? "暂无需要关注的定时任务" : "No scheduled tasks require attention") }}
        </p>

        <div
          v-for="group in categorized.groups"
          :key="group.id"
          class="sdk-sts-group"
          :data-task-group="group.id"
        >
          <h4 class="sdk-sts-group-title">{{ group.label }}</h4>
          <article
            v-for="task in group.items"
            :key="task.id"
            class="sdk-sts-row"
            :class="{
              'needs-intervention': needsIntervention(task),
              'is-selected': isTaskSelected(task),
            }"
          >
            <div class="sdk-sts-row-main">
              <button type="button" class="sdk-sts-row-link" @click="handleSelect(task)">
                {{ task.title }}
              </button>
              <p v-if="group.id === 'results' && task.lastRunFinishedAt" class="sdk-sts-row-meta">
                <span class="sdk-sts-dot" :class="statusDotClass(task)" aria-hidden="true" />
                {{ translate("ontology.productHomeGeneratedAt", isZh ? "生成于" : "Generated") }}
                {{ formatDate(task.lastRunFinishedAt) }}
              </p>
              <p v-else class="sdk-sts-row-meta">
                <span class="sdk-sts-dot" :class="statusDotClass(task)" aria-hidden="true" />
                <span class="sdk-sts-status-text" :class="statusDotClass(task)">{{ statusText(task) }}</span>
                <span v-if="task.nextRunAt">
                  · {{ translate("ontology.productHomeNextRun", isZh ? "下次运行" : "Next run") }} {{ formatDate(task.nextRunAt) }}
                </span>
              </p>
              <p v-if="task.pauseMessage" class="sdk-sts-row-excerpt" :title="task.pauseMessage">
                {{ task.pauseMessage }}
              </p>
              <p v-else-if="task.lastRunErrorMessage" class="sdk-sts-row-excerpt is-error" :title="task.lastRunErrorMessage">
                {{ task.lastRunErrorMessage }}
              </p>
              <p v-else-if="task.lastRunSummary" class="sdk-sts-row-excerpt">
                {{ formatSummaryExcerpt(task.lastRunSummary) }}
              </p>
            </div>
            <div class="sdk-sts-row-actions">
              <slot name="row-actions" :task="task" :needs-intervention="needsIntervention(task)">
                <button
                  v-if="showResolveAction && needsIntervention(task)"
                  type="button"
                  class="sdk-sts-resolve-btn"
                  data-testid="scheduled-task-resolve"
                  @click.stop="handleResolve(task)"
                >
                  {{ resolveLabel || translate("ontology.productHomeResolve", isZh ? "去处理" : "Resolve") }}
                </button>
              </slot>
            </div>
          </article>
        </div>
      </div>
    </DataState>
  </div>
</template>

<style scoped>
.sdk-scheduled-task-summary {
  width: 100%;
  min-width: 0;
}

.sdk-sts-body {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 12px);
  min-width: 0;
}

.sdk-sts-counters {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--spacing-xl, 24px);
  padding-bottom: var(--spacing-sm, 10px);
  border-bottom: 1px solid var(--ui-divider, var(--el-border-color-lighter));
}

.sdk-sts-counter {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  color: var(--el-text-color-secondary);
}

.sdk-sts-count {
  font-size: var(--text-2xl, 24px);
  line-height: 1.2;
  font-weight: var(--font-semibold, 600);
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-primary);
}

.sdk-sts-counter.has-issues .sdk-sts-count,
.sdk-sts-counter.has-issues .sdk-sts-count-label {
  color: var(--el-color-danger);
}

.sdk-sts-counter.is-running .sdk-sts-count {
  color: var(--el-color-primary);
}

.sdk-sts-count-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs, 12px);
}

.sdk-sts-alert-icon {
  flex: none;
}

.sdk-sts-empty {
  margin: var(--spacing-sm, 8px) 0;
  font-size: var(--text-sm, 13px);
  color: var(--el-text-color-secondary);
}

.sdk-sts-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.sdk-sts-group-title {
  margin: 4px 0;
  font-size: var(--text-xs, 12px);
  font-weight: var(--font-semibold, 600);
  color: var(--el-text-color-secondary);
}

.sdk-sts-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--spacing-sm, 12px);
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-extra-light, var(--el-border-color-lighter));
  min-width: 0;
}

.sdk-sts-row:last-child {
  border-bottom: 0;
}

.sdk-sts-row-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}

.sdk-sts-row-link {
  align-self: flex-start;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-sm, 14px);
  font-weight: var(--font-medium, 500);
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.sdk-sts-row-link:hover {
  color: var(--el-color-primary);
}

.sdk-sts-row-meta {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
}

.sdk-sts-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-color-info);
  flex: none;
}

.sdk-sts-dot.is-failed {
  background: var(--el-color-danger);
}

.sdk-sts-dot.is-paused {
  background: var(--el-color-warning);
}

.sdk-sts-dot.is-running {
  background: var(--el-color-primary);
}

.sdk-sts-dot.is-completed {
  background: var(--el-color-success);
}

.sdk-sts-status-text.is-failed {
  color: var(--el-color-danger);
}

.sdk-sts-status-text.is-paused {
  color: var(--el-color-warning-text, var(--el-color-warning));
}

.sdk-sts-row-excerpt {
  margin: 0;
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
  color: var(--el-text-color-regular);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.sdk-sts-row-excerpt.is-error {
  color: var(--el-color-danger);
}

.sdk-sts-row-actions {
  display: inline-flex;
  align-items: center;
  flex: none;
}

.sdk-sts-resolve-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  padding: 0 10px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: var(--radius-sm, 6px);
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: var(--text-xs, 12px);
  font-weight: var(--font-medium, 500);
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.sdk-sts-resolve-btn:hover {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}
</style>
