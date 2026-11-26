import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldKey, formFieldPointer, type FormField, type FormFieldError, type FormValues } from "@ontomato/contracts/form-fields";
import { USER } from "@ontomato/contracts/platform-object-types";
import type {
  PanelFieldTone,
  PanelFormDescription,
  PanelFormField,
  PanelFormValues,
  PanelGroupCounts,
  PanelOptionList,
  PanelRecord,
  PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import {
  PLATFORM_SCHEDULE_TITLE_MAX, platformTaskFrequencySchema, platformTaskInputSchema,
  type PlatformScheduleApplication, type PlatformTask, type PlatformTaskList, type PlatformTaskRun, type PlatformTaskRunPage, type PlatformTriggerTargets,
} from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "./api";
import { applicationDraftErrors, applicationFormErrors, scheduledTaskCreateDescription, scheduledTaskSaveDescription, taskInput, taskInputField } from "./panel-operations";
import { taskRunStatusKey } from "./run-status";
import { scheduledTaskFieldLabels, scheduledTaskFrequencyText } from "./panel-text";
import { memberIdsSchema, mergeTaskSettings, parseScheduledTaskPanelDraft, scheduledTaskPanelSettings, targetKinds, type ScheduledTaskPanelSettings } from "./panel-task-values";

type NamedApplication = PlatformScheduleApplication & { name: string; icon?: string };
export interface ScheduledApplicationsStatus {
  applications: NamedApplication[];
  missingIds: string[];
}
type TaskReadApi = Pick<SchedulesApi, "task" | "form" | "runs" | "run"> & {
  list(includeCredentialStatus?: boolean): Promise<PlatformTaskList>;
  applicationsStatus(): Promise<ScheduledApplicationsStatus>;
  targets(): Promise<PlatformTriggerTargets & { applications: NamedApplication[] }>;
  describeTargets(tasks: readonly PlatformTask[], directory: ScheduledApplicationsStatus): Promise<PlatformTask[]>;
  findMembers(keyword: string | undefined, limit: number): Promise<{ id: string; name: string }[]>;
};
type Translate = (key: string, values?: Record<string, string | number>) => string;
const taskFieldPath = (key: string) => formFieldPointer("/", key);

interface TaskFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

interface TaskCreateFormParams extends TaskFormParams {
  defaultAppId?: string;
  defaultAgentId?: string;
}

function runStatusTone(status: PlatformTaskRun["status"]): PanelFieldTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "warning";
  return "info";
}

function formatDuration(ms: number, translate: Translate): string {
  const seconds = ms / 1000;
  if (seconds < 60) {
    return translate("platformSchedules.duration.seconds", { n: Math.round(seconds * 10) / 10 });
  }
  const whole = Math.round(seconds);
  if (whole < 3600) {
    return translate("platformSchedules.duration.minutes", { m: Math.floor(whole / 60), s: whole % 60 });
  }
  return translate("platformSchedules.duration.hours", { h: Math.floor(whole / 3600), m: Math.floor((whole % 3600) / 60) });
}

function formatRunError(error: NonNullable<PlatformTaskRun["error"]>, translate: Translate): string {
  const head = translate(`platformSchedules.runError.${error.code}`);
  const detail = error.message?.trim();
  return detail && detail !== head ? `${head}: ${detail}` : head;
}

function previewMarkdownText(value: string): string {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
    .replace(/(\*\*|__|`+)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ").trim();
}

function cleanMarkdownParagraphs(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|\n?```$/g, ""))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`+)(.*?)\1/g, "$2")
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split(/\n/)
        .map((line) => line.replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/, "").trim())
        .filter(Boolean)
        .join("\n"),
    )
    .filter(Boolean)
    .join("\n\n");
}

function taskRecord(
  task: PlatformTask,
  locale: string,
  translate: Translate,
  applicationIcon?: string,
): PanelRecord {
  const stateLabel = task.enabled
    ? (task.pause === null ? translate("platformSchedules.panelFields.stateOn") : translate("platformSchedules.panelFields.statePaused"))
    : translate("platformSchedules.panelFields.stateOff");
  const stateTone: PanelFieldTone = task.enabled ? (task.pause === null ? "success" : "warning") : "info";
  const scheduled = task.status === "PUBLISHED" && task.enabled && task.pause === null;
  const hasLatestResult = task.latestResult !== null;
  const hasEarlierResult = task.latestResult !== null && task.latestResult.runId !== task.lastRun?.id;
  const resultActionState = !hasLatestResult ? "none" : hasEarlierResult ? "earlier" : "latest";
  const resultStateLabel = translate(
    !hasLatestResult
      ? "platformSchedules.card.noResult"
      : hasEarlierResult
        ? "platformSchedules.card.viewEarlierResult"
        : "platformSchedules.card.viewResult",
  );
  const lastRunSummary = (() => {
    const run = task.lastRun;
    if (!run) return "";
    if (run.status === "failed" || run.status === "skipped") {
      return run.error ? formatRunError(run.error, translate) : "";
    }
    const preview = run.resultSummary ? previewMarkdownText(run.resultSummary) : "";
    if (preview) return preview;
    if (run.status === "completed" && run.spendTime !== null) {
      return translate("platformSchedules.duration.took", { time: formatDuration(run.spendTime, translate) });
    }
    return "";
  })();
  const isRunning = task.activeRunId !== null || task.lastRun?.status === "running";
  const needsIntervention = task.pause !== null || (!isRunning && task.lastRun?.status === "failed");
  const attentionGroup = needsIntervention
    ? "issues"
    : isRunning
      ? "running"
      : task.lastRun?.status === "completed"
        ? "results"
        : "idle";
  const latestRunId = task.activeRunId ?? task.lastRun?.id ?? "";
  const openPath = latestRunId
    ? `/schedules?taskId=${encodeURIComponent(task.id)}&runId=${encodeURIComponent(latestRunId)}`
    : `/schedules?taskId=${encodeURIComponent(task.id)}`;
  return {
    primaryKey: task.id,
    label: task.title,
    fieldLabels: {
      ...scheduledTaskFieldLabels(translate),
      targetName: translate("platformSchedules.panelFields.targetName"),
      definitionStatus: translate("platformSchedules.panelFields.definitionStatus"),
      version: translate("platformSchedules.panelFields.version"),
      executorId: translate("platformSchedules.panelFields.executorId"),
      coauthorIds: translate("platformSchedules.panelFields.coauthorIds"),
      reviewedBy: translate("platformSchedules.panelFields.reviewedBy"),
      stateLabel: translate("platformSchedules.panelFields.state"),
      pauseReason: translate("platformSchedules.panelFields.pauseReason"),
      frequency: translate("platformSchedules.panelSettings.frequency"),
      timeZone: translate("platformSchedules.panelSettings.timeZone"),
      notifyEmail: translate("platformSchedules.panelSettings.notifyEmail"),
      lastRunAt: translate("platformSchedules.panelFields.lastRunAt"),
      lastRunSummary: translate("platformSchedules.panelFields.lastRunSummary"),
      latestResultPath: translate("platformSchedules.panelFields.latestResultPath"),
      resultStateLabel: translate("platformSchedules.panelFields.resultStateLabel"),
    },
    fields: {
      application: task.appId ?? "",
      targetKind: task.targetKind,
      targetId: (task.targetKind === "application" ? task.appId : task.targetId),
      targetName: task.targetName ?? (task.targetKind === "application" ? task.appId : task.targetId),
      ...(applicationIcon && { targetIcon: applicationIcon }),
      status: task.status,
      definitionStatus: translate(`platformSchedules.definitionStatus.${task.status}`),
      version: task.version,
      creatorId: task.creatorId,
      executorId: task.executorId,
      description: task.description ?? "",
      coauthorIds: task.coauthorIds.join(", "),
      reviewedBy: task.reviewedBy ?? "",
      settings: task.summary.map(item => `${item.label}: ${item.value}`).join("; "),
      state: task.enabled ? (task.pause === null ? "on" : `paused: ${task.pause.message}`) : "off",
      stateLabel,
      enabled: task.enabled,
      scheduled,
      revision: task.revision,
      ...(task.activeRunId ? { activeRunId: task.activeRunId } : {}),
      pauseCode: task.pause?.code ?? "",
      ...(task.pause ? { pauseReason: task.pause.message, pauseMessage: task.pause.message } : {}),
      nextRun: task.nextRunAt ?? "",
      ...(task.nextRunAt ? { nextRunAt: task.nextRunAt } : {}),
      lastRun: task.lastRun?.status ?? "",
      ...(task.lastRun?.status ? { lastRunStatus: task.lastRun.status } : {}),
      ...(task.lastRun?.trigger ? { trigger: task.lastRun.trigger } : {}),
      lastRunFinishedAt: task.lastRun?.finishedAt ?? "",
      frequency: scheduledTaskFrequencyText(task.frequency, locale, translate),
      timeZone: task.timeZone,
      notifyEmail: task.notifyEmail ?? "",
      lastRunAt: task.lastRun?.startedAt ?? "",
      ...(task.lastRun?.startedAt ? { lastRunStartedAt: task.lastRun.startedAt } : {}),
      ...(task.lastRun?.error?.message ? { lastRunError: task.lastRun.error.message } : {}),
      lastRunSummary,
      latestResultPath: task.latestResult?.link.path ?? "",
      hasLatestResult,
      hasEarlierResult,
      resultActionState,
      resultStateLabel,
      latestRunId,
      attentionGroup,
      needsIntervention,
    },
    tones: {
      state: stateTone,
      stateLabel: stateTone,
      ...(task.lastRun ? { lastRun: runStatusTone(task.lastRun.status) } : {}),
    },
    outputs: {
      revision: task.revision,
      definitionStatus: task.status,
      targetKind: task.targetKind,
      enabled: task.enabled,
      paused: task.pause !== null,
      pauseCode: task.pause?.code ?? "",
      latestResultPath: task.latestResult?.link.path ?? "",
      hasEarlierResult,
      lastRunStatus: task.lastRun?.status ?? "",
      isRunning,
      needsIntervention,
      attentionGroup,
      latestRunId,
      openPath,
    },
  };
}

function runRecord(run: PlatformTaskRun, translate: Translate): PanelRecord {
  const statusLabel = translate(taskRunStatusKey(run));
  const workflowRunId = run.executionDetails?.workflowRunId;
  const triggerLabel = translate(`platformSchedules.trigger.${run.trigger}`);
  const errorText = run.error ? formatRunError(run.error, translate) : undefined;
  const summaryPreview = run.resultSummary ? previewMarkdownText(run.resultSummary) : undefined;
  const snapshotSummary = run.snapshot.summary.length > 0
    ? run.snapshot.summary.map(item => `${item.label}: ${item.value}`).join("; ")
    : undefined;
  return {
    primaryKey: run.id,
    label: `${triggerLabel} · ${statusLabel}`,
    ...(errorText || summaryPreview ? { subtitle: errorText ?? summaryPreview } : {}),
    fieldLabels: {
      status: translate("platformSchedules.runFields.status"),
      trigger: translate("platformSchedules.runFields.trigger"),
      startedAt: translate("platformSchedules.runFields.startedAt"),
      scheduledAt: translate("platformSchedules.runFields.scheduledAt"),
      duration: translate("platformSchedules.runFields.duration"),
      error: translate("platformSchedules.runFields.error"),
      resultSummary: translate("platformSchedules.runFields.resultSummary"),
      snapshotSummary: translate("platformSchedules.runFields.snapshotSummary"),
      result: translate("platformSchedules.runFields.result"),
      executionDetails: translate("platformSchedules.runFields.executionDetails"),
      resultPath: translate("platformSchedules.runFields.resultPath"),
      executorId: translate("platformSchedules.runFields.executorId"),
      version: translate("platformSchedules.runFields.version"),
      workflowRunId: translate("platformSchedules.runFields.workflowRunId"),
      timeZone: translate("platformSchedules.runFields.timeZone"),
    },
    fields: {
      status: statusLabel,
      executorId: run.snapshot.executorId ?? translate("platformSchedules.runFields.unknownExecutor"),
      version: run.snapshot.version,
      ...(typeof workflowRunId === "string" && { workflowRunId }),
      timeZone: run.snapshot.timeZone,
      ...(run.finishedAt && { finishedAt: run.finishedAt }),
      trigger: triggerLabel,
      startedAt: run.startedAt,
      ...(run.scheduledAt && run.trigger === "schedule" ? { scheduledAt: run.scheduledAt } : {}),
      ...(run.spendTime !== null ? { duration: formatDuration(run.spendTime, translate) } : {}),
      ...(errorText ? { error: errorText } : {}),
      ...(run.resultSummary ? { resultSummary: run.resultSummary } : {}),
      ...(snapshotSummary ? { snapshotSummary } : {}),
      ...(run.result !== null ? { result: run.result } : {}),
      ...(run.executionDetails !== null ? { executionDetails: { kind: "json" as const, value: run.executionDetails } } : {}),
      ...(run.resultLink?.path ? { resultPath: run.resultLink.path } : {}),
      hasResultLink: run.resultLink !== null,
    },
    tones: {
      status: runStatusTone(run.status),
      ...(errorText && { error: run.status === "skipped" ? "warning" : "danger" }),
    },
    outputs: {
      status: run.status,
      resultPath: run.resultLink?.path ?? "",
      isRunning: run.status === "running",
    },
  };
}

function typedField(field: FormField): PanelFormField {
  const { key, label, required, defaultValue, help } = field;
  const common = { path: taskFieldPath(key), label, required, defaultValue, help, readOnly: false, section: "application" };
  return field.type === "select"
    ? { ...common, control: { kind: "select", options: field.options }, valueSchema: { type: "string" },
      refreshOnChange: field.refreshOnChange }
    : { ...common, control: { kind: "text", multiline: field.multiline, placeholder: field.placeholder, maxLength: field.maxLength },
      valueSchema: { type: "string", maxLength: field.maxLength } };
}

const taskFrequencyValueSchema = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskFrequencySchema));
const stringArraySchema = { type: "array", items: { type: "string", minLength: 1 } };
const option = (value: string, label: string, description: string | null = null, reason: string | null = null) => ({
  value, label, description, disabled: reason !== null, disabledReason: reason,
});

const memberOption = ({ id, name }: { id: string; name: string }) => ({ primaryKey: id, value: id, label: name, description: id });

function settingsFields(
  targetKind: PlatformTask["targetKind"], options: ReturnType<typeof option>[], creating: boolean,
  frequencyHelp: string, translate: Translate,
): PanelFormField[] {
  const field = (key: keyof ScheduledTaskPanelSettings, required = false) => ({
    path: formFieldPointer("/task/", key), label: translate(`platformSchedules.panelSettings.${key}`), required,
    readOnly: false, valueSchema: { type: "string" },
  });
  const capability = (key: string) => ({
    path: formFieldPointer("/task/capabilityContent/", key), label: translate(`platformSchedules.panelSettings.${key}`),
    required: false, readOnly: false, valueSchema: { type: "string" },
  });
  const jsonObject = (key: string): PanelFormField => ({
    ...capability(key), valueSchema: { type: "object" }, control: { kind: "code", language: "json" },
  });
  return [
    { ...field("title", true), control: { kind: "text", maxLength: targetKind === "application" ? PLATFORM_SCHEDULE_TITLE_MAX : 255 } },
    { ...field("description"), control: { kind: "text", multiline: true } },
    { ...field("targetKind", true), refreshOnChange: true, control: {
      kind: "select", options: targetKinds.map(kind => option(kind, translate(`platformSchedules.targetKind.${kind}`))),
    } },
    { ...field(targetKind === "application" ? "appId" : "targetId", true), refreshOnChange: true,
      control: { kind: "select", options },
    },
    ...(targetKind === "action" ? [
      jsonObject("parameters"),
      { ...capability("runStartParameters"), control: { kind: "string-array" as const }, valueSchema: stringArraySchema,
        help: translate("platformSchedules.panelSettings.runStartParametersHelp") },
    ] : targetKind === "workflow" ? [
      jsonObject("inputs"),
      { ...capability("requester"), control: { kind: "text" as const }, help: translate("platformSchedules.panelSettings.requesterHelp") },
      { ...capability("goalText"), control: { kind: "text" as const, multiline: true } },
    ] : []),
    { ...field("executorId"), control: { kind: "reference", objectType: USER, multiple: false },
      valueSchema: { type: ["string", "null"] }, help: translate("platformSchedules.panelSettings.executorHelp") },
    { ...field("coauthorIds"), control: { kind: "reference", objectType: USER, multiple: true }, valueSchema: stringArraySchema },
    { ...field("frequency", true), control: { kind: "frequency" }, valueSchema: taskFrequencyValueSchema, help: frequencyHelp },
    { ...field("timeZone"), readOnly: true, control: { kind: "text" }, help: frequencyHelp },
    ...(creating ? [{ ...field("enabled"), control: { kind: "switch" as const }, valueSchema: { type: "boolean" },
      help: translate("platformSchedules.panelSettings.createEnabledHelp") }] : []),
    { ...field("notifyEmail"), section: "notifications", control: { kind: "text", maxLength: 320 },
      help: translate("platformSchedules.form.notifyPlaceholder") },
  ];
}

export type TriggerListParams = {
  scope?: string; search?: string; status?: PlatformTask["status"]; agentId?: string; taskId?: string;
};
export type TriggerMemberPage = { number: number; size: number };
type DescribeRows = (tasks: PlatformTask[]) => Promise<PanelRecord[]>;

export const TRIGGER_MEMBER_SEARCH_MAX = 100;

export function triggerMemberSearchLimit(page?: TriggerMemberPage) {
  return Math.min((page?.number ?? 1) * (page?.size ?? 50), TRIGGER_MEMBER_SEARCH_MAX);
}

export function triggerMemberIds(values: readonly unknown[]) {
  return memberIdsSchema.parse(values);
}

export function findTriggerMember(id: string, candidates: readonly { id: string; name: string }[]) {
  return candidates.find(candidate => candidate.id === id);
}

export function createTriggerReadPresenter(locale: string, translate: Translate) {
  return {
    rows(tasks: readonly PlatformTask[], directory?: ScheduledApplicationsStatus) {
      const icons = new Map(directory?.applications.map(app => [app.id, app.icon]));
      return tasks.map(task => taskRecord(task, locale, translate, task.targetKind === "application" ? icons.get(task.appId) : undefined));
    },
    memberOptions(members: readonly { id: string; name: string }[], page?: TriggerMemberPage): PanelOptionList {
      const size = page?.size ?? 50;
      const end = (page?.number ?? 1) * size;
      return { options: members.slice(end - size, end).map(memberOption) };
    },
    memberResolve(ids: readonly string[], members: ReadonlyMap<string, string>): PanelOptionList {
      return { options: ids.map(id => {
        const name = members.get(id);
        return name === undefined
          ? { primaryKey: id, value: id, label: id, unavailable: { reason: translate("platformSchedules.form.memberUnavailable") } }
          : memberOption({ id, name });
      }) };
    },
    async list(tasks: PlatformTask[], params: TriggerListParams | undefined, describeRows: DescribeRows) {
      const scope = params?.scope?.trim();
      const status = params?.status;
      const query = params?.search?.trim().toLowerCase();
      const rows = await describeRows(tasks.filter(task => (!status || task.status === status)
        && (!scope || task.targetKind === scope || task.appId === scope)
        && (!params?.taskId || task.id === params.taskId)
        && (!params?.agentId || (task.targetKind === "application" && task.appId === "agents" && task.content.agentId === params.agentId))));
      return query ? rows.filter(row => [row.label, row.fields.targetName, row.fields.settings, row.fields.frequency]
        .some(value => String(value).toLowerCase().includes(query))) : rows;
    },
    status({ tasks, credentialStatus }: PlatformTaskList): PanelRecord {
      return {
        primaryKey: "schedules-status",
        label: translate("platformSchedules.title"),
        fields: {},
        outputs: {
          hasCredentialPaused: tasks.some(task => task.pause?.code === "credential_invalid"),
          ...(credentialStatus && { credentialStatus }),
        },
      };
    },
    counts(tasks: PlatformTask[], by?: string): PanelGroupCounts {
      if (by === "attention") {
        let issues = 0;
        let running = 0;
        let results = 0;
        for (const task of tasks) {
          const isRunning = task.activeRunId !== null || task.lastRun?.status === "running";
          if (task.pause !== null || (!isRunning && task.lastRun?.status === "failed")) issues += 1;
          else if (isRunning) running += 1;
          else if (task.lastRun?.status === "completed") results += 1;
        }
        return [
          { key: "issues", label: translate("platformSchedules.attention.issues"), count: issues },
          { key: "results", label: translate("platformSchedules.attention.results"), count: results },
          { key: "running", label: translate("platformSchedules.attention.running"), count: running },
        ];
      }
      return [
        { key: "", label: translate("platformSchedules.panelFields.allApplications"), count: tasks.length },
        ...targetKinds.map(kind => ({ key: kind, label: translate(`platformSchedules.targetKind.${kind}`),
          count: tasks.filter(task => task.targetKind === kind).length })),
      ];
    },
    runRecords(page: PlatformTaskRunPage): PanelRecordQuery {
      return {
        rows: page.runs.map(run => runRecord(run, translate)),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
    runRecord(primaryKey: string, latest?: PlatformTaskRun, task?: PlatformTask): PanelRecord {
      const focused = (run: PlatformTaskRun): PanelRecord => {
        const { label: _label, subtitle: _subtitle, ...record } = runRecord(run, translate);
        const output = run.result ?? run.resultSummary;
        // The small panel draws status and trigger in its header.
        return { ...record, label: "", fields: { ...record.fields, ...(output !== null && { result: cleanMarkdownParagraphs(output) }) } };
      };
      const pause: Record<string, string> = task?.pause ? { pauseMessage: task.pause.message } : {};
      if (latest) {
        const record = focused(latest);
        return { ...record, fields: { ...record.fields, ...pause } };
      }
      return {
        primaryKey,
        label: "",
        fields: { ...pause, timeZone: task!.timeZone },
        outputs: { status: "", resultPath: "", isRunning: false },
      };
    },
  };
}

export async function presentTriggerForm(
  task: PlatformTask | undefined, serviceZone: string, params: TaskCreateFormParams,
  { applications, actions, workflows }: PlatformTriggerTargets & { applications: NamedApplication[] },
  readApplicationForm: TaskReadApi["form"], translate: Translate,
): Promise<PanelFormDescription> {
  const current = scheduledTaskPanelSettings(task, serviceZone);
  const draft = parseScheduledTaskPanelDraft(params.values ?? {});
  const supplied = draft.success ? draft.data.task : {};
  const errors: FormFieldError[] = draft.success ? [] : draft.error.issues.map(issue => {
    const isParameter = issue.path[0] === "parameters";
    const path = isParameter ? issue.path.slice(1) : issue.path;
    const field = path.map(key => taskFieldPath(String(key))).join("");
    const messageKey = isParameter ? "invalidDraftParameter" : "invalidDraftField";
    return { field, code: "invalid_format", message: translate(`platformSchedules.panelErrors.${messageKey}`, { field }) };
  });
  const changed = params.changedField;
  const validate = draft.success && params.values !== undefined && changed == null;
  if (!task && supplied.appId === undefined && params.defaultAppId && applications.some(app => app.id === params.defaultAppId && app.available))
    current.appId = params.defaultAppId;
  const resetTarget = changed === "/task/targetKind";
  const resetContent = resetTarget || changed === "/task/appId" || changed === "/task/targetId";
  const settings = mergeTaskSettings(current, {
    ...supplied,
    ...(resetTarget && { appId: "", targetId: "" }),
    ...(resetContent && { capabilityContent: {} }),
    timeZone: current.timeZone,
  }, resetContent);
  const isApp = settings.targetKind === "application";
  const selectedId = isApp ? settings.appId : settings.targetId;
  const targetPath = isApp ? "/task/appId" : "/task/targetId";
  const options = isApp ? applications.map(app => ({
    ...option(app.id, app.name, app.description, app.unavailableReason), ...(app.icon && { icon: app.icon }),
  })) : (settings.targetKind === "action" ? actions : workflows).map(target => option(target.id, target.name, target.description));
  const selected = options.find(entry => entry.value === selectedId);
  const unavailable = translate(isApp ? "platformSchedules.form.appUnknown" : "platformSchedules.form.targetUnavailable");
  if (selectedId && !selected) options.push(option(selectedId, selectedId, null, unavailable));
  if ((selectedId && (!selected || selected.disabled)) || (validate && !selectedId)) {
    errors.push({ field: targetPath, code: selectedId ? "invalid_option" : "required",
      message: selected?.disabledReason ?? (selectedId ? unavailable : translate("platformSchedules.notice.noApplication")) });
  }

  const sameApp = task?.targetKind === "application" && task.appId === settings.appId;
  const stored = sameApp ? task.content : {};
  const parameters: FormValues = draft.success ? draft.data.parameters : {};
  const form = isApp && selected && !selected.disabled ? await readApplicationForm(settings.appId, {
    values: resetContent ? {} : {
      ...(!task && settings.appId === "agents" && params.defaultAgentId ? { agentId: params.defaultAgentId } : {}),
      ...stored, ...parameters,
    },
    changedField: changed != null && !changed.startsWith("/task/") ? formFieldKey(changed, "/") : null,
    taskId: sameApp ? task.id : null,
    timeZone: settings.timeZone,
  }) : undefined;
  if (validate) {
    if (!isApp || form) {
      const parsed = platformTaskInputSchema.safeParse(taskInput(settings, form));
      if (!parsed.success) errors.push(...parsed.error.issues.map(issue => ({
        field: taskInputField(issue.path, settings.targetKind), code: "invalid_format" as const, message: issue.message,
      })));
    }
    if (form) errors.push(...applicationDraftErrors(form, parameters));
  }
  const frequencyHelp = translate(task ? "platformSchedules.form.taskZone" : "platformSchedules.form.serviceZone", { zone: settings.timeZone });
  return {
    fields: [...settingsFields(settings.targetKind, options, task === undefined, frequencyHelp, translate), ...(form?.fields.map(typedField) ?? [])],
    sections: [
      ...(form ? [{ key: "application", title: translate("platformSchedules.form.content", { app: selected!.label }),
        ...(form.fields.length === 0 && { hint: translate("platformSchedules.form.noFields") }) }] : []),
      { key: "notifications", title: translate("platformSchedules.form.after") },
    ],
    values: { ...form?.values, task: settings },
    errors: form ? [...errors, ...applicationFormErrors(form)] : errors,
    ...(task && { revision: task.revision }),
    save: task ? scheduledTaskSaveDescription(task.id) : scheduledTaskCreateDescription(settings.enabled!),
  };
}

export function createScheduledTaskReads(api: TaskReadApi, locale: string, translate: Translate) {
  async function describe(task: PlatformTask | undefined, serviceZone: string, params: TaskCreateFormParams) {
    return presentTriggerForm(task, serviceZone, params, await api.targets(), (appId, input) => api.form(appId, input), translate);
  }

  const presenter = createTriggerReadPresenter(locale, translate);
  async function describeRows(tasks: PlatformTask[]) {
    if (!tasks.some(task => task.targetKind === "application")) return presenter.rows(tasks);
    const directory = await api.applicationsStatus();
    return presenter.rows(await api.describeTargets(tasks, directory), directory);
  }

  return {
    async list(params?: TriggerListParams) {
      return presenter.list((await api.list()).tasks, params, describeRows);
    },
    async status() {
      return presenter.status(await api.list(true));
    },
    async counts(by?: string) {
      return presenter.counts((await api.list()).tasks, by);
    },
    async record(primaryKey: string) {
      const [row] = await describeRows([await api.task(primaryKey)]);
      return row!;
    },
    async form(primaryKey: string, params: TaskFormParams) {
      const task = await api.task(primaryKey);
      return describe(task, task.timeZone, params);
    },
    async createForm(params: TaskCreateFormParams) {
      return describe(undefined, (await api.list()).timeZone, params);
    },
    async memberOptions({ keyword, page }: { keyword?: string; page?: TriggerMemberPage }): Promise<PanelOptionList> {
      return presenter.memberOptions(await api.findMembers(keyword, triggerMemberSearchLimit(page)), page);
    },
    async memberResolve(values: readonly unknown[]): Promise<PanelOptionList> {
      const ids = triggerMemberIds(values);
      const members = await Promise.all(ids.map(async id =>
        findTriggerMember(id, await api.findMembers(id, TRIGGER_MEMBER_SEARCH_MAX))));
      return presenter.memberResolve(ids, new Map(members.flatMap(member => member ? [[member.id, member.name]] : [])));
    },
    runs: api.runs,
    run: api.run,
    async runRecords(primaryKey: string, cursor?: string) {
      return presenter.runRecords(await api.runs(primaryKey, cursor));
    },
    async runRecord(primaryKey: string, requestedRunId?: string) {
      if (requestedRunId) return presenter.runRecord(primaryKey, await api.run(primaryKey, requestedRunId));
      const [task, { runs: [latest] }] = await Promise.all([api.task(primaryKey), api.runs(primaryKey)]);
      return presenter.runRecord(primaryKey, latest, task);
    },
  };
}
