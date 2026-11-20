import { zodToJsonSchema } from "zod-to-json-schema";
import { formFieldKey, formFieldPointer, type FormField, type FormFieldError, type FormValues } from "@ontomato/contracts/form-fields";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import type { PanelFormDescription, PanelFormField, PanelRecord } from "@ontomato/contracts/panel-projection";
import type { PlatformScheduleForm, PlatformTask } from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "./api";
import { scheduledTaskSaveDescription } from "./panel-operations";
import { scheduledTaskRunNowOperation } from "./panel-server-operations";
import { scheduledTaskFieldLabels } from "./panel-text";

type TaskReadApi = Pick<SchedulesApi, "list" | "task" | "form">;
const taskFieldPath = (key: string) => formFieldPointer("/", key);

interface TaskFormParams {
  values?: FormValues;
  changedField?: string | null;
}

function taskRecord(task: PlatformTask, fieldLabels: Record<string, string>): PanelRecord {
  return {
    primaryKey: task.id,
    label: task.title,
    fieldLabels,
    fields: {
      application: task.appId,
      settings: task.summary.map(item => `${item.label}: ${item.value}`).join("; "),
      state: task.enabled ? (task.pause === null ? "on" : `paused: ${task.pause.message}`) : "off",
      nextRun: task.nextRunAt ?? "",
      lastRun: task.lastRun?.status ?? "",
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

export function createScheduledTaskReads(api: TaskReadApi, translate: (key: string) => string) {
  return {
    async list() {
      const fieldLabels = scheduledTaskFieldLabels(translate);
      return (await api.list()).tasks.map(task => taskRecord(task, fieldLabels));
    },
    async record(primaryKey: string) {
      return taskRecord(await api.task(primaryKey), scheduledTaskFieldLabels(translate));
    },
    async form(
      primaryKey: string, { values, changedField }: TaskFormParams,
    ): Promise<PanelFormDescription> {
      const task = await api.task(primaryKey);
      const field = changedField == null ? null : formFieldKey(changedField, "/");
      const readForm: FormReader = (values, changedField) => api.form(task.appId, {
        values, changedField, taskId: task.id, timeZone: task.timeZone,
      });
      const answer = values !== undefined && field === null
        ? await checkDraft(readForm, task.content, values)
        : await readForm(values ?? task.content, field);
      return {
        fields: answer.fields.map(typedField),
        values: answer.values,
        errors: answer.errors.map(error => ({ ...error, field: error.field.replace(/^\/values\//, "/") })),
        revision: task.revision,
        save: scheduledTaskSaveDescription(task.id),
      };
    },
    [runNowRead]() {
      return panelOwnerOperationDescriptorSchema.parse({
        ...scheduledTaskRunNowDescription, label: translate("platformSchedules.action.runNow"),
      });
    },
  };
}
