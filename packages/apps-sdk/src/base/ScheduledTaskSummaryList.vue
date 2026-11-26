<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { ElSwitch } from "element-plus/es/components/switch/index";
import { appIcon, hasAppIcon } from "@ontomato/platform-shell/icons";
import { panelRowOperationKey } from "@ontomato/contracts/panel-projection";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { useI18n } from "vue-i18n";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { panelContextKey } from "../panel/context";
import { admittedOperations } from "../panel/member-operations";
import { panelMemberKey, useMemberData, useMemberOutput, useMemberParam, useMemberRefresh } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import ObjectListRowActions, { type ResolvedRowActionItem } from "./ObjectListRowActions.vue";
import { matchesRowActionWhen, resolveRowOperationParams, resolveRowOperationTarget } from "./object-list-actions";
import { formatOperationOutcome, type OperationOutcome } from "./operation-dispatch";
import { isActionValuesEnvelope, wrapActionOperationInput } from "./operation-input-schema";
import type { ObjectListRef } from "./object-list-types";
import { rawRecordField } from "./record-field";
import type { ScheduledTaskCardActions, ScheduledTaskPresentation, ScheduledTaskSummaryItem } from "./scheduled-task-summary-types";
import UnavailableTooltip from "./UnavailableTooltip.vue";

/** The personal workspace attention summary and the full cards for the same task triggers. */
const scheduledTaskType = "platform:Trigger";
const toggleOperation = "setEnabled";

const props = withDefaults(
  defineProps<{
    /** Optional direct task array for standalone usage outside a `rows` datum binding. */
    tasks?: readonly ScheduledTaskSummaryItem[];
    /** Attention summary by default, or full scheduled task cards. Also configurable on the projection. */
    presentation?: ScheduledTaskPresentation;
    /** Card footer actions. Operations reference names declared by the projection. */
    rowActions?: ScheduledTaskCardActions;
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
  /** Emitted when an available card switch requests a change through the panel. */
  "toggle-enabled": [task: ScheduledTaskSummaryItem, enabled: boolean];
  /** Emitted when a declared local card action is triggered. */
  "row-action": [id: string, task: ScheduledTaskSummaryItem];
  /** Emitted with the platform outcome of a card write. */
  "operation-done": [name: string, outcome: OperationOutcome, task: ObjectListRef];
}>();

defineSlots<{
  /** Optional custom trailing action rendered at the end of each task row. */
  "row-actions"?(scope: { task: ScheduledTaskSummaryItem; needsIntervention: boolean }): unknown;
  /** Card footer override. Defaults to the row-actions slot or the declared actions. */
  "card-actions"?(scope: { task: ScheduledTaskSummaryItem; needsIntervention: boolean }): unknown;
}>();

const panel = inject(panelContextKey, null);
const member = inject(panelMemberKey, null)?.();
const presentation = computed(() => props.presentation ?? member?.projection.config?.presentation ?? "summary");
const cardActions = computed(() =>
  props.rowActions ?? (member?.projection.config?.rowActions as ScheduledTaskCardActions | undefined),
);
const { t, locale, te } = useI18n();
const isZh = computed(() => locale.value.toLowerCase().startsWith("zh"));
function translate(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback;
}

const rowsState = member?.projection.data?.rows ? useMemberData("rows") : null;
const refreshRows = rowsState ? useMemberRefresh("rows") : null;
const selectedParam = member ? useMemberParam("selected") : null;

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
  const lastRunStatus = readStr(row, "lastRunStatus", "lastRun")
    ?? (typeof lastRunObj?.status === "string" ? lastRunObj.status : null);
  const lastRunFinishedAt = readStr(row, "lastRunFinishedAt", "lastFinishedAt")
    ?? (typeof lastRunObj?.finishedAt === "string" ? lastRunObj.finishedAt : null);
  const lastRunErrorMessage = readStr(row, "lastRunError", "errorMessage")
    ?? (typeof lastRunErrObj?.message === "string" ? lastRunErrObj.message : null);
  const lastRunSummary = readStr(row, "lastRunSummary", "resultSummary", "summary")
    ?? (typeof lastRunObj?.resultSummary === "string" ? lastRunObj.resultSummary : null);
  const nextRunAt = readStr(row, "nextRunAt");
  const revision = rawRecordField(row, "revision");
  const version = rawRecordField(row, "version");
  const targetKind = readStr(row, "targetKind");

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
    targetKind,
    ...(presentation.value === "cards" ? {
      applicationId: readStr(row, "application", "appId", "targetId"),
      applicationName: readStr(row, "targetName", "applicationName", "appName"),
      applicationType: readStr(row, "applicationType", "appType"),
      applicationIcon: readStr(row, "targetIcon", "applicationIcon", "appIcon"),
      definitionStatus: readStr(row, "definitionStatus"),
      statusCode: readStr(row, "status"),
      version: typeof version === "number" ? version : null,
      executorId: readStr(row, "executorId"),
      reviewedBy: readStr(row, "reviewedBy"),
      coauthorIds: readStr(row, "coauthorIds"),
      description: readStr(row, "settings", "description") ?? row.subtitle,
      schedule: readStr(row, "frequency", "scheduleExpression", "cron"),
      revision: typeof revision === "number" ? revision : null,
      stateLabel: readStr(row, "stateLabel"),
      lastRunStartedAt: readStr(row, "lastRunStartedAt", "lastRunAt"),
    } : {}),
    ref: { className: row.className || scheduledTaskType, primaryKey: row.primaryKey },
    row,
  };
}

const previousCards = computed(() => {
  if (presentation.value !== "cards" || props.tasks) return undefined;
  const state = rowsState?.value;
  if (state?.status === "error" || state?.status === "loading") return state.previous;
  return undefined;
});

const resolvedData = computed<DataStateResult<readonly ScheduledTaskSummaryItem[]>>(() => {
  if (props.tasks) {
    return presentation.value === "cards" && !props.tasks.length
      ? { status: "empty" }
      : { status: "ready", value: props.tasks };
  }
  if (!rowsState) return { status: "empty" };
  const state = previousCards.value ?? rowsState.value;
  if (state.status !== "ready") {
    if (state.status === "error" && presentation.value === "cards") {
      return { ...state, retry: state.retry ?? refreshRows ?? undefined };
    }
    return state;
  }
  const raw = state.value as unknown as readonly PlatformObjectRecord[] | { rows?: readonly PlatformObjectRecord[] } | null;
  const rows = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows) ? (raw as { rows: readonly PlatformObjectRecord[] }).rows : []);
  if (presentation.value === "cards" && !rows.length) return { status: "empty" };
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

if (member) {
  useMemberOutput("status", () => previousCards.value ? rowsState!.value.status : resolvedData.value.status);
  useMemberOutput("issueCount", () => categorized.value.issues.length);
  useMemberOutput("runningCount", () => categorized.value.running.length);
  useMemberOutput("resultCount", () => categorized.value.results.length);
}

const labels = useDataStateLabels(() => props.emptyText || (presentation.value === "cards"
  ? t("platformSchedules.empty.none")
  : isZh.value ? "暂无需要关注的定时任务" : "No scheduled tasks require attention"));

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
  if (task.lastRunStatus === "completed") {
    return task.targetKind === "workflow"
      ? t("platformSchedules.runStatus.workflowStarted")
      : translate("ontology.productHomeTaskCompleted", isZh.value ? "已完成" : "Completed");
  }
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
const staleError = computed(() => previousCards.value && rowsState?.value.status === "error" ? rowsState.value : null);
const cardsRefreshing = computed(() => rowsState?.value.status === "loading" && Boolean(previousCards.value)
  || rowsState?.value.status === "ready" && Boolean(rowsState.value.refreshing));
const readyRows = computed(() => previousCards.value ?? (rowsState?.value.status === "ready" ? rowsState.value : null));

function taskKey(task: ScheduledTaskSummaryItem): string {
  return panelRowOperationKey({ primaryKey: task.id, className: task.ref?.className }, scheduledTaskType);
}

function applicationIcon(task: ScheduledTaskSummaryItem) {
  if (task.applicationIcon && hasAppIcon(task.applicationIcon)) return appIcon(task.applicationIcon);
  if (task.targetKind === "workflow") return appIcon("workflow");
  if (task.targetKind === "action") return appIcon("play");
  const kind = task.applicationType === "agent" ? "bot" : task.applicationType;
  if (kind && hasAppIcon(kind)) return appIcon(kind);
  return appIcon(task.applicationId && hasAppIcon(task.applicationId) ? task.applicationId : "app-window");
}

const expandedCards = ref(new Set<string>());
function toggleDetails(task: ScheduledTaskSummaryItem) {
  const key = taskKey(task);
  if (!expandedCards.value.delete(key)) expandedCards.value.add(key);
}

function runStatus(task: ScheduledTaskSummaryItem): string {
  const status = task.activeRunId ? "running" : task.lastRunStatus;
  if (status === "completed" && task.targetKind === "workflow") {
    return t("platformSchedules.runStatus.workflowStarted");
  }
  switch (status) {
    case "running":
    case "completed":
    case "failed":
    case "skipped":
      return t(`platformSchedules.runStatus.${status}`);
    default:
      return status || t("platformSchedules.card.neverRun");
  }
}

const busyRows = ref(new Set<string>());
const operationErrors = ref<Record<string, string>>({});

function cardOperation(task: ScheduledTaskSummaryItem, name: string) {
  const state = member?.operations.value;
  const descriptor = state && admittedOperations(state)[name];
  const binding = member?.projection.operations?.[name];
  const row = task.row;
  const target = row && member && binding
    ? resolveRowOperationTarget(binding, row, scheduledTaskType, member.inputs.value)
    : undefined;
  const rowOperation = row ? readyRows.value?.rowOperations?.[taskKey(task)]?.[name] : undefined;

  let reason: string | undefined;
  if (rowOperation?.available === false) reason = rowOperation.unavailable?.reason || t("platform.dataForbidden");
  else if (descriptor?.unavailable) reason = descriptor.unavailable.reason || t("platform.memberUnavailable");
  else if (state?.status === "forbidden") reason = state.reason || t("platform.dataForbidden");
  else if (state?.status === "error") reason = state.message;
  else if (state?.status === "loading") reason = t("platformSchedules.notice.loading");
  else if (!descriptor || !binding || target === undefined) reason = t("platform.memberUnavailable");
  else if (name === toggleOperation && (descriptor.effect !== "write" || target?.kind !== "object" || task.revision == null)) {
    reason = t("platform.memberUnavailable");
  }

  const busy = busyRows.value.has(taskKey(task))
    || Boolean(panel && descriptor?.effect === "write" && target?.kind === "object"
      && panel.instance.isObjectWriteInFlight(target, descriptor.handlerRef ?? panel.instance.operationIdOf(member!.key, name)));
  return { descriptor, binding, target, reason, busy };
}

const switches = computed(() => new Map(
  resolvedData.value.status === "ready" && presentation.value === "cards"
    ? resolvedData.value.value.map(task => [taskKey(task), cardOperation(task, toggleOperation)])
    : [],
));

function actionsFor(task: ScheduledTaskSummaryItem): ResolvedRowActionItem[] {
  const items: ResolvedRowActionItem[] = [];
  const row = task.row ?? { primaryKey: task.id, label: task.title, fields: {} };
  for (const action of cardActions.value?.items ?? []) {
    if (!matchesRowActionWhen(row, action.when)) continue;
    const disabled = matchesRowActionWhen(row, action.disabledWhen, false);
    const label = action.labelKey ? (panel?.t(action.labelKey) ?? t(action.labelKey)) : action.label;
    if (action.kind === "local") {
      items.push({ ...action, key: `local:${action.id}`, label: label ?? action.id, tone: action.tone ?? "default", disabled });
      continue;
    }
    if (action.operation === toggleOperation) continue;
    const operation = cardOperation(task, action.operation);
    if (action.hideWhenUnavailable && operation.reason) continue;
    items.push({
      ...action,
      key: `operation:${action.operation}`,
      label: label ?? operation.descriptor?.label ?? action.operation,
      tone: action.tone ?? (operation.descriptor?.inspectImpact ? "danger" : "default"),
      disabled: disabled || Boolean(operation.reason),
      busy: operation.busy,
      reason: operation.reason,
    });
  }
  return items;
}

function triggerCardAction(task: ScheduledTaskSummaryItem, item: ResolvedRowActionItem) {
  if (item.disabled || item.busy || busyRows.value.has(taskKey(task))) return;
  if (item.kind === "local" && item.id) emit("row-action", item.id, task);
  else if (item.kind === "operation" && item.operation) void dispatchCardOperation(task, item.operation);
}

async function dispatchCardOperation(task: ScheduledTaskSummaryItem, name: string, enabled?: boolean) {
  if (!panel || !member || !task.row || !task.ref) return;
  const { descriptor, binding, target, reason, busy } = cardOperation(task, name);
  if (!descriptor || !binding || target === undefined || reason || busy) return;
  const key = taskKey(task);
  busyRows.value.add(key);
  delete operationErrors.value[key];
  try {
    const bound = resolveRowOperationParams(binding, task.row, member.inputs.value);
    const changed: Record<string, RuntimeJsonValue> = enabled === undefined
      ? {}
      : { enabled, revision: task.revision! };
    const input = isActionValuesEnvelope(descriptor.inputSchema)
      ? wrapActionOperationInput(descriptor.inputSchema, bound, changed)
      : { ...bound, ...changed };
    const operationId = panel.instance.operationIdOf(member.key, name);
    if (enabled !== undefined) emit("toggle-enabled", task, enabled);
    if (descriptor.effect === "read") {
      await panel.instance.readOperation(operationId, { target, input });
      return;
    }
    // The instance owns preparation, confirmation, object-write locking, and invalidation.
    const answer = await panel.instance.writeOperation(operationId, { call: { target, input } }, {
      handlerRef: descriptor.handlerRef,
    });
    if (answer.decision !== "confirm" || !answer.response) return;
    const response = answer.response;
    if (response.kind !== "dispatched") {
      operationErrors.value[key] = response.message;
      return;
    }
    const outcome = response.outcome;
    if (outcome) emit("operation-done", name, outcome, task.ref);
    if (!outcome || outcome.kind === "batch") {
      operationErrors.value[key] = t("platform.operationUnknown", { message: "" });
    } else if (outcome.kind === "success") {
      panel.notify({ kind: "success", text: formatOperationOutcome(outcome, t) });
    } else {
      operationErrors.value[key] = formatOperationOutcome(outcome, t);
    }
  } catch (error) {
    operationErrors.value[key] = error instanceof Error ? error.message : String(error);
  } finally {
    busyRows.value.delete(key);
  }
}
</script>

<template>
  <div class="sdk-scheduled-task-summary">
    <DataState
      v-if="staleError"
      :result="{ ...staleError, retry: staleError.retry ?? refreshRows ?? undefined }"
      :labels="labels"
    />
    <DataState :result="resolvedData" :labels="labels" v-slot="{ value }">
      <div v-if="presentation === 'cards'" class="sdk-sts-cards" :aria-busy="cardsRefreshing">
        <article
          v-for="task in value"
          :key="taskKey(task)"
          class="sdk-sts-card"
          :class="{ 'is-selected': isTaskSelected(task) }"
          @click="handleSelect(task)"
        >
          <header class="sdk-sts-card-header">
            <span class="sdk-sts-card-app">
              <component :is="applicationIcon(task)" :size="16" aria-hidden="true" />
              {{ task.applicationName || task.applicationId }}
            </span>
            <span v-if="task.definitionStatus" class="sdk-sts-card-status">
              {{ task.definitionStatus }}<template v-if="task.version != null"> · v{{ task.version }}</template>
            </span>
            <span class="sdk-sts-card-badge">
              <span class="sdk-sts-dot" :class="statusDotClass(task)" aria-hidden="true" />
              {{ task.stateLabel || statusText(task) }}
            </span>
            <span v-if="!task.statusCode || task.statusCode === 'PUBLISHED'" class="sdk-sts-card-switch" @click.stop>
              <UnavailableTooltip
                :reason="switches.get(taskKey(task))?.reason"
                :label="t('platformSchedules.card.switch', { title: task.title })"
              >
                <ElSwitch
                  :model-value="task.enabled"
                  :loading="switches.get(taskKey(task))?.busy"
                  :disabled="Boolean(switches.get(taskKey(task))?.reason || switches.get(taskKey(task))?.busy)"
                  :aria-label="t('platformSchedules.card.switch', { title: task.title })"
                  @update:model-value="dispatchCardOperation(task, toggleOperation, Boolean($event))"
                />
              </UnavailableTooltip>
            </span>
          </header>
          <h3 class="sdk-sts-card-title">
            <button type="button" class="sdk-sts-row-link" @click.stop="handleSelect(task)">{{ task.title }}</button>
          </h3>
          <p v-if="task.description" class="sdk-sts-card-description">{{ task.description }}</p>
          <div v-if="task.pauseMessage || task.lastRunErrorMessage" class="sdk-sts-card-pause" @click.stop>
            <button
              type="button"
              class="sdk-sts-row-link"
              :aria-expanded="expandedCards.has(taskKey(task))"
              @click="toggleDetails(task)"
            >
              <component :is="appIcon(expandedCards.has(taskKey(task)) ? 'chevron-down' : 'chevron-right')" :size="14" aria-hidden="true" />
              {{ task.pauseMessage ? t('platformSchedules.panelFields.pauseReason') : runStatus(task) }}
            </button>
            <template v-if="expandedCards.has(taskKey(task))">
              <p v-if="task.pauseMessage">{{ task.pauseMessage }}</p>
              <p v-if="task.lastRunErrorMessage && task.lastRunErrorMessage !== task.pauseMessage">{{ task.lastRunErrorMessage }}</p>
            </template>
          </div>
          <div class="sdk-sts-card-meta">
            <p>
              <span v-if="task.schedule">{{ task.schedule }}</span>
              <span v-if="task.nextRunAt">{{ t('platformSchedules.card.next', { time: formatDate(task.nextRunAt) }) }}</span>
            </p>
            <p>
              <span>{{ runStatus(task) }}</span>
              <span v-if="task.lastRunFinishedAt || task.lastRunStartedAt">{{ formatDate((task.lastRunFinishedAt || task.lastRunStartedAt)!) }}</span>
              <span v-if="task.revision != null" :title="task.row?.fieldLabels?.revision">{{ '#' + task.revision }}</span>
            </p>
            <p v-if="task.executorId || task.reviewedBy || task.coauthorIds" class="sdk-sts-card-governance">
              <span v-if="task.executorId">{{ task.row?.fieldLabels?.executorId ?? t('platformSchedules.panelFields.executorId') }}: {{ task.executorId }}</span>
              <span v-if="task.reviewedBy">{{ task.row?.fieldLabels?.reviewedBy ?? t('platformSchedules.panelFields.reviewedBy') }}: {{ task.reviewedBy }}</span>
              <span v-if="task.coauthorIds">{{ task.row?.fieldLabels?.coauthorIds ?? t('platformSchedules.panelFields.coauthorIds') }}: {{ task.coauthorIds }}</span>
            </p>
            <p v-if="task.lastRunSummary && !task.lastRunErrorMessage">{{ formatSummaryExcerpt(task.lastRunSummary) }}</p>
          </div>
          <p v-if="operationErrors[taskKey(task)]" class="sdk-sts-card-error" role="alert">{{ operationErrors[taskKey(task)] }}</p>
          <div v-if="cardActions?.items.length || $slots['card-actions'] || $slots['row-actions']" class="sdk-sts-card-actions" @click.stop>
            <slot name="card-actions" :task="task" :needs-intervention="needsIntervention(task)">
              <slot name="row-actions" :task="task" :needs-intervention="needsIntervention(task)">
                <ObjectListRowActions
                  :items="actionsFor(task)"
                  :max-visible="cardActions?.maxVisible"
                  :row-label="task.title"
                  :busy="busyRows.has(taskKey(task))"
                  @trigger="triggerCardAction(task, $event)"
                />
              </slot>
            </slot>
          </div>
        </article>
      </div>
      <div v-else class="sdk-sts-body">
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
.sdk-sts-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr));
  gap: var(--spacing-md, 12px);
}

.sdk-sts-card {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 8px);
  min-width: 0;
  padding: var(--spacing-md, 12px);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-base);
  background: var(--el-bg-color);
  cursor: pointer;
}

.sdk-sts-card.is-selected {
  border-color: var(--el-color-primary);
}

.sdk-sts-card-header,
.sdk-sts-card-app,
.sdk-sts-card-badge,
.sdk-sts-card-pause button,
.sdk-sts-card-meta p {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-xs, 6px);
}

.sdk-sts-card-app {
  flex: 1;
  overflow-wrap: anywhere;
}

.sdk-sts-card-badge,
.sdk-sts-card-status {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  font-size: var(--text-xs, 12px);
}

.sdk-sts-card-governance {
  font-size: var(--text-xs, 12px);
  color: var(--el-text-color-secondary);
}

.sdk-sts-card-title,
.sdk-sts-card p {
  margin: 0;
  overflow-wrap: anywhere;
}

.sdk-sts-card-description,
.sdk-sts-card-meta {
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}

.sdk-sts-card-pause {
  padding: var(--spacing-sm, 8px);
  border-radius: var(--el-border-radius-base);
  background: var(--el-color-warning-light-9);
}

.sdk-sts-card-pause button,
.sdk-sts-card-pause p {
  color: var(--el-color-warning-dark-2);
}

.sdk-sts-card-actions {
  margin-top: auto;
  align-self: flex-end;
}

.sdk-sts-card-error {
  color: var(--el-color-danger);
}


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
