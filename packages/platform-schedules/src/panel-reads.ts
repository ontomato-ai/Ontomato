import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldKey, formFieldPointer, type FormField, type FormFieldError, type FormValues } from "@ontomato/contracts/form-fields";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import type { PanelFormDescription, PanelFormField, PanelFormValues, PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  PLATFORM_SCHEDULE_TITLE_MAX, platformScheduleTimeZoneSchema, platformTaskFrequencySchema,
  type PlatformScheduleApplication, type PlatformScheduleForm, type PlatformTask,
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

function taskRecord(task: PlatformTask, locale: string, translate: Translate): PanelRecord {
  return {
    primaryKey: task.id,
    label: task.title,
    fieldLabels: {
      ...scheduledTaskFieldLabels(translate),
      frequency: translate("platformSchedules.panelSettings.frequency"),
      timeZone: translate("platformSchedules.panelSettings.timeZone"),
      lastRunAt: translate("platformSchedules.panelFields.lastRunAt"),
      lastRunSummary: translate("platformSchedules.panelFields.lastRunSummary"),
      latestResultPath: translate("platformSchedules.panelFields.latestResultPath"),
    },
    fields: {
      application: task.appId,
      settings: task.summary.map(item => `${item.label}: ${item.value}`).join("; "),
      state: task.enabled ? (task.pause === null ? "on" : `paused: ${task.pause.message}`) : "off",
      nextRun: task.nextRunAt ?? "",
      lastRun: task.lastRun?.status ?? "",
      frequency: scheduledTaskFrequencyText(task.frequency, locale, translate),
      timeZone: task.timeZone,
      lastRunAt: task.lastRun?.startedAt ?? "",
      lastRunSummary: task.lastRun?.error?.message ?? task.lastRun?.resultSummary ?? "",
      latestResultPath: task.latestResult?.link.path ?? "",
    },
  };
}

function typedField(field: FormField): PanelFormField {
  const { key, label, required, defaultValue, help } = field;
  const common = { path: taskFieldPath(key), label, required, defaultValue, help, readOnly: false };
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
  applications: readonly NamedApplication[], translate: Translate,
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
    { ...field("frequency"), control: { kind: "frequency" }, valueSchema: taskFrequencyValueSchema },
    { ...field("timeZone"), control: { kind: "text" } },
    { ...field("notifyEmail", false), control: { kind: "text" } },
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
    const applicationList = api.applications();
    if (!task && provided.appId === undefined && params.defaultAppId) {
      const initial = (await applicationList).find(app => app.id === params.defaultAppId && app.available);
      if (initial) current.appId = initial.id;
    }
    const settings = { ...current, ...provided };
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
      if (!settings.appId) return undefined;
      if (!draft.success) return readForm(stored, null);
      const { parameters } = draft.data;
      if (params.values !== undefined && field == null) return checkDraft(readForm, stored, parameters);
      const changedKey = field == null || field.startsWith("/task/") ? null : formFieldKey(field, "/");
      return readForm(changedApplication ? {} : params.values === undefined ? stored : parameters, changedKey);
    };
    const [applications, form] = await Promise.all([applicationList, readApplicationForm()]);
    return {
      fields: [...settingsFields(applications, translate), ...(form?.fields.map(typedField) ?? [])],
      values: { ...form?.values, task: settings },
      errors: [
        ...errors,
        ...(form?.errors.map(error => ({ ...error, field: error.field.replace(/^\/values\//, "/") })) ?? []),
      ],
      ...(task && { revision: task.revision }),
      save: task ? scheduledTaskSaveDescription(task.id) : scheduledTaskCreateDescription,
    };
  }

  return {
    async list() {
      return (await api.list()).tasks.map(task => taskRecord(task, locale, translate));
    },
    async record(primaryKey: string) {
      return taskRecord(await api.task(primaryKey), locale, translate);
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
    [runNowRead]() {
      return panelOwnerOperationDescriptorSchema.parse({
        ...scheduledTaskRunNowDescription, label: translate("platformSchedules.action.runNow"),
      });
    },
  };
}
