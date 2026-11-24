import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldKey, formFieldPointer, type FormField, type FormFieldError, type FormValues } from "@ontomato/contracts/form-fields";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import type {
  PanelFieldTone,
  PanelFormDescription,
  PanelFormField,
  PanelFormValues,
  PanelGroupCounts,
  PanelRecord,
  PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import {
  PLATFORM_SCHEDULE_TITLE_MAX, platformScheduleTimeZoneSchema, platformTaskFrequencySchema,
  type PlatformScheduleApplication, type PlatformScheduleForm, type PlatformTask, type PlatformTaskRun,
} from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "./api";
import { scheduledTaskCreateDescription, scheduledTaskSaveDescription } from "./panel-operations";
import { scheduledTaskRunNowOperation } from "./panel-server-operations";
import { scheduledTaskFieldLabels, scheduledTaskFrequencyText } from "./panel-text";
import { parseScheduledTaskPanelDraft, scheduledTaskPanelSettings, type ScheduledTaskPanelSettings } from "./panel-task-values";

type NamedApplication = PlatformScheduleApplication & { name: string };
type TaskReadApi = Pick<SchedulesApi, "list" | "task" | "form" | "runs" | "run"> & {
  applications(): Promise<NamedApplication[]>;
};
type Translate = (key: string, values?: Record<string, string | number>) => string;
const taskFieldPath = (key: string) => formFieldPointer("/", key);

interface TaskFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

interface TaskCreateFormParams extends TaskFormParams {
  defaultAppId?: string;
}

function runStatusTone(status: PlatformTaskRun["status"]): PanelFieldTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "skipped") return "warning";
  return "info";
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${Math.round(seconds * 10) / 10} s`;
  const whole = Math.round(seconds);
  if (whole < 3600) return `${Math.floor(whole / 60)} min ${whole % 60} s`;
  return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`;
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

function taskRecord(
  task: PlatformTask,
  locale: string,
  translate: Translate,
  appNames?: ReadonlyMap<string, string>,
): PanelRecord {
  const stateLabel = task.enabled
    ? (task.pause === null ? translate("platformSchedules.panelFields.stateOn") : translate("platformSchedules.panelFields.statePaused"))
    : translate("platformSchedules.panelFields.stateOff");
  const stateTone: PanelFieldTone = task.enabled ? (task.pause === null ? "success" : "warning") : "info";
  const lastRunSummaryRaw = task.lastRun?.error?.message ?? task.lastRun?.resultSummary ?? "";
  return {
    primaryKey: task.id,
    label: task.title,
    fieldLabels: {
      ...scheduledTaskFieldLabels(translate),
      applicationName: translate("platformSchedules.form.app"),
      stateLabel: translate("platformSchedules.panelFields.state"),
      pauseReason: translate("platformSchedules.panelFields.pauseReason"),
      frequency: translate("platformSchedules.panelSettings.frequency"),
      timeZone: translate("platformSchedules.panelSettings.timeZone"),
      notifyEmail: translate("platformSchedules.panelSettings.notifyEmail"),
      lastRunAt: translate("platformSchedules.panelFields.lastRunAt"),
      lastRunSummary: translate("platformSchedules.panelFields.lastRunSummary"),
      latestResultPath: translate("platformSchedules.panelFields.latestResultPath"),
    },
    fields: {
      application: task.appId,
      applicationName: appNames?.get(task.appId) ?? task.appId,
      settings: task.summary.map(item => `${item.label}: ${item.value}`).join("; "),
      state: task.enabled ? (task.pause === null ? "on" : `paused: ${task.pause.message}`) : "off",
      stateLabel,
      enabled: task.enabled,
      revision: task.revision,
      pauseCode: task.pause?.code ?? "",
      ...(task.pause ? { pauseReason: task.pause.message } : {}),
      nextRun: task.nextRunAt ?? "",
      lastRun: task.lastRun?.status ?? "",
      frequency: scheduledTaskFrequencyText(task.frequency, locale, translate),
      timeZone: task.timeZone,
      notifyEmail: task.notifyEmail ?? "",
      lastRunAt: task.lastRun?.startedAt ?? "",
      lastRunSummary: lastRunSummaryRaw ? previewMarkdownText(lastRunSummaryRaw) : "",
      latestResultPath: task.latestResult?.link.path ?? "",
    },
    tones: {
      state: stateTone,
      stateLabel: stateTone,
      ...(task.lastRun ? { lastRun: runStatusTone(task.lastRun.status) } : {}),
    },
    outputs: {
      revision: task.revision,
      enabled: task.enabled,
      paused: task.pause !== null,
      pauseCode: task.pause?.code ?? "",
      latestResultPath: task.latestResult?.link.path ?? "",
      isRunning: task.activeRunId !== null || task.lastRun?.status === "running",
    },
  };
}

function runRecord(run: PlatformTaskRun, translate: Translate): PanelRecord {
  const statusLabel = translate(`platformSchedules.runStatus.${run.status}`);
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
    },
    fields: {
      status: statusLabel,
      trigger: triggerLabel,
      startedAt: run.startedAt,
      ...(run.scheduledAt && run.trigger === "schedule" ? { scheduledAt: run.scheduledAt } : {}),
      ...(run.spendTime !== null ? { duration: formatDuration(run.spendTime) } : {}),
      ...(errorText ? { error: errorText } : {}),
      ...(run.resultSummary ? { resultSummary: run.resultSummary } : {}),
      ...(snapshotSummary ? { snapshotSummary } : {}),
      ...(run.result !== null ? { result: run.result } : {}),
      ...(run.executionDetails !== null ? { executionDetails: { kind: "json" as const, value: run.executionDetails } } : {}),
    },
    tones: {
      status: runStatusTone(run.status),
    },
    outputs: {
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

const runNowRead = `${scheduledTaskRunNowOperation.handlerRef}.describe` as const;
const scheduledTaskRunNowDescription = {
  kind: "action",
  handlerRef: scheduledTaskRunNowOperation.handlerRef,
  effect: scheduledTaskRunNowOperation.effect,
  target: { source: "input", input: scheduledTaskRunNowOperation.targetInput },
  inputSchema: zodToJsonSchema(scheduledTaskRunNowOperation.inputSchema, { effectStrategy: "input" }),
  resultSchema: zodToJsonSchema(scheduledTaskRunNowOperation.resultSchema, { effectStrategy: "input" }),
  batch: scheduledTaskRunNowOperation.batch,
};

type FormReader = (values: FormValues, changedField: string | null) => Promise<PlatformScheduleForm>;

async function checkDraft(readForm: FormReader, savedValues: FormValues, draft: FormValues): Promise<PlatformScheduleForm> {
  const baseline = await readForm(savedValues, null);
  const changed = baseline.fields.find(field => field.type === "select" && field.refreshOnChange
    && Object.hasOwn(draft, field.key) && draft[field.key] !== baseline.values[field.key]);
  const effective = changed ? await readForm({ ...baseline.values, ...draft }, changed.key) : baseline;
  const allowed = new Set(effective.fields.map(field => field.key));
  const submitted: FormValues = {};
  const errors: FormFieldError[] = [];
  for (const [key, value] of Object.entries(draft)) {
    if (allowed.has(key)) {
      submitted[key] = value;
    } else {
      errors.push({
        field: formFieldPointer("/values/", key), code: "invalid_object", message: "Not a field of this form",
      });
    }
  }
  // A selector can reset dependent fields while resolving the form. Validate after applying the draft to that form.
  const answer = await readForm({ ...effective.values, ...submitted }, null);
  // The owner marks an incomplete draft un-submittable without listing missing required values.
  for (const { key, required, label } of answer.fields) {
    if (required && !answer.values[key].trim()) {
      errors.push({
        field: formFieldPointer("/values/", key), code: "required", message: `${label} is required`,
      });
    }
  }
  return { ...answer, values: { ...answer.values, ...submitted }, errors: [...answer.errors, ...errors] };
}

const taskFrequencyValueSchema = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskFrequencySchema));

function settingsFields(
  applications: readonly NamedApplication[], frequencyHelp: string, translate: Translate,
): PanelFormField[] {
  const field = (key: keyof ScheduledTaskPanelSettings, required = true) => ({
    path: formFieldPointer("/task/", key), label: translate(key === "appId" ? "platformSchedules.form.app" : `platformSchedules.panelSettings.${key}`), required,
    readOnly: false, valueSchema: { type: "string" },
  });
  return [
    { ...field("title"), control: { kind: "text", maxLength: PLATFORM_SCHEDULE_TITLE_MAX } },
    {
      ...field("appId"), refreshOnChange: true,
      control: {
        kind: "select",
        options: applications.map(app => ({
          value: app.id, label: app.name, description: app.description, disabled: !app.available,
          disabledReason: app.unavailableReason,
        })),
      },
    },
    { ...field("frequency"), control: { kind: "frequency" }, valueSchema: taskFrequencyValueSchema, help: frequencyHelp },
    { ...field("timeZone"), control: { kind: "text" } },
    { ...field("notifyEmail", false), section: "notifications", control: { kind: "text", maxLength: 320 },
      help: translate("platformSchedules.form.notifyPlaceholder") },
  ];
}

export function createScheduledTaskReads(api: TaskReadApi, locale: string, translate: Translate) {
  async function describe(
    task: PlatformTask | undefined, serviceZone: string, params: TaskCreateFormParams,
  ): Promise<PanelFormDescription> {
    const current = scheduledTaskPanelSettings(task, serviceZone);
    const draft = parseScheduledTaskPanelDraft(params.values ?? {});
    const provided = draft.success ? draft.data.task : {};
    const errors: FormFieldError[] = draft.success ? [] : draft.error.issues.map(issue => {
      const isParameter = issue.path[0] === "parameters";
      const path = isParameter ? issue.path.slice(1) : issue.path;
      const field = path.map(key => taskFieldPath(String(key))).join("");
      const messageKey = isParameter ? "invalidDraftParameter" : "invalidDraftField";
      return { field, code: "invalid_format", message: translate(`platformSchedules.panelErrors.${messageKey}`, { field }) };
    });
    const applications = await api.applications();
    if (!task && provided.appId === undefined && params.defaultAppId) {
      const initial = applications.find(app => app.id === params.defaultAppId && app.available);
      if (initial) current.appId = initial.id;
    }
    const settings = { ...current, ...provided };
    const selectedApplication = applications.find(app => app.id === settings.appId);
    const missingApplication = translate("platformSchedules.form.appUnknown");
    const appOptions = task && !applications.some(app => app.id === task.appId) ? [
      ...applications, { id: task.appId, name: task.appId, description: null, available: false,
        unavailableReason: missingApplication, taskCount: 0 },
    ] : applications;
    if (settings.appId && !selectedApplication)
      errors.push({ field: "/task/appId", code: "invalid_option", message: missingApplication });
    const field = draft.success ? params.changedField : null;
    const changedApplication = field === "/task/appId";
    const sameApp = settings.appId === current.appId;
    const stored = sameApp ? task?.content ?? {} : {};
    const zone = platformScheduleTimeZoneSchema.safeParse(settings.timeZone);
    if (!zone.success) errors.push({ field: "/task/timeZone", code: "invalid_time", message: zone.error.issues[0]!.message });
    const readForm: FormReader = (values, changedField) => api.form(settings.appId, {
      values, changedField, taskId: sameApp ? task?.id ?? null : null, timeZone: zone.success ? zone.data : current.timeZone,
    });
    const readApplicationForm = () => {
      if (!selectedApplication) return undefined;
      if (!draft.success) return readForm(stored, null);
      const { parameters } = draft.data;
      if (params.values !== undefined && field == null) return checkDraft(readForm, stored, parameters);
      const changedKey = field == null || field.startsWith("/task/") ? null : formFieldKey(field, "/");
      return readForm(changedApplication ? {} : params.values === undefined ? stored : parameters, changedKey);
    };
    const form = await readApplicationForm();
    const frequencyHelp = translate(task ? "platformSchedules.form.taskZone" : "platformSchedules.form.serviceZone", {
      zone: settings.timeZone,
    });
    return {
      fields: [...settingsFields(appOptions, frequencyHelp, translate), ...(form?.fields.map(typedField) ?? [])],
      sections: [
        ...(settings.appId ? [{
          key: "application",
          title: translate("platformSchedules.form.content", { app: selectedApplication?.name ?? settings.appId }),
          ...(!selectedApplication ? { hint: missingApplication }
            : form?.fields.length === 0 ? { hint: translate("platformSchedules.form.noFields") } : {}),
        }] : []),
        { key: "notifications", title: translate("platformSchedules.form.after") },
      ],
      values: { ...form?.values, task: settings },
      errors: [
        ...errors,
        ...(form?.errors.map(error => ({ ...error, field: error.field.replace(/^\/values\//, "/") })) ?? []),
      ],
      ...(task && { revision: task.revision }),
      save: task ? scheduledTaskSaveDescription(task.id) : scheduledTaskCreateDescription,
    };
  }

  async function resolveAppNames(): Promise<ReadonlyMap<string, string>> {
    try {
      const apps = await api.applications();
      return new Map(apps.map(app => [app.id, app.name]));
    } catch {
      return new Map();
    }
  }

  return {
    async list() {
      const [{ tasks }, appNames] = await Promise.all([api.list(), resolveAppNames()]);
      return tasks.map(task => taskRecord(task, locale, translate, appNames));
    },
    async counts(): Promise<PanelGroupCounts> {
      const [{ tasks }, appNames] = await Promise.all([api.list(), resolveAppNames()]);
      const byApp = new Map<string, number>();
      for (const task of tasks) byApp.set(task.appId, (byApp.get(task.appId) ?? 0) + 1);
      const orderedIds = [...new Set([...appNames.keys(), ...byApp.keys()])].filter(id => byApp.has(id));
      return [
        { key: "", label: translate("platformSchedules.panelFields.allApplications"), count: tasks.length },
        ...orderedIds.map(id => ({ key: id, label: appNames.get(id) ?? id, count: byApp.get(id) ?? 0 })),
      ];
    },
    async record(primaryKey: string) {
      const [task, appNames] = await Promise.all([api.task(primaryKey), resolveAppNames()]);
      return taskRecord(task, locale, translate, appNames);
    },
    async form(primaryKey: string, params: TaskFormParams) {
      const task = await api.task(primaryKey);
      return describe(task, task.timeZone, params);
    },
    async createForm(params: TaskCreateFormParams) {
      return describe(undefined, (await api.list()).timeZone, params);
    },
    runs: api.runs,
    run: api.run,
    async runRecords(primaryKey: string, cursor?: string): Promise<PanelRecordQuery> {
      const page = await api.runs(primaryKey, cursor);
      return {
        rows: page.runs.map(run => runRecord(run, translate)),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    },
    async runRecord(primaryKey: string, runId: string): Promise<PanelRecord> {
      return runRecord(await api.run(primaryKey, runId), translate);
    },
    [runNowRead]() {
      return panelOwnerOperationDescriptorSchema.parse({
        ...scheduledTaskRunNowDescription, label: translate("platformSchedules.action.runNow"),
      });
    },
  };
}
