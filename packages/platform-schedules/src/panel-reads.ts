import { zodToJsonSchema } from "zod-to-json-schema";
import { formFieldKey, formFieldPointer, type FormField, type FormValues } from "@ontomato/contracts/form-fields";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import type { PanelFormDescription, PanelFormField, PanelRecord } from "@ontomato/contracts/panel-projection";
import type { PlatformScheduleForm, PlatformTask } from "@ontomato/contracts/platform-schedules";
import type { SchedulesApi } from "./api";
import { scheduledTaskSaveDescription } from "./panel-operations";
import { scheduledTaskRunNowOperation } from "./panel-server-operations";

type TaskReadApi = Pick<SchedulesApi, "list" | "task" | "form">;
const taskFieldPath = (key: string) => formFieldPointer("/", key);

interface TaskFormParams {
  values?: FormValues;
  changedField?: string | null;
}

function taskRecord(task: PlatformTask): PanelRecord {
  return {
    primaryKey: task.id,
    label: task.title,
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
const scheduledTaskRunNowDescription = panelOwnerOperationDescriptorSchema.parse({
  handlerRef: scheduledTaskRunNowOperation.handlerRef,
  effect: scheduledTaskRunNowOperation.effect,
  target: { source: "input", input: scheduledTaskRunNowOperation.targetInput },
  inputSchema: zodToJsonSchema(scheduledTaskRunNowOperation.inputSchema, { effectStrategy: "input" }),
  resultSchema: zodToJsonSchema(scheduledTaskRunNowOperation.resultSchema, { effectStrategy: "input" }),
  batch: scheduledTaskRunNowOperation.batch,
});

type FormReader = (values: FormValues, changedField: string | null) => Promise<PlatformScheduleForm>;

export class ScheduledTaskDraftRefusal extends Error {
  constructor(message: string, readonly fieldErrors: Record<string, string>) {
    super(message);
  }
}

async function checkDraft(readForm: FormReader, savedValues: FormValues, draft: FormValues) {
  const baseline = await readForm(savedValues, null);
  const changed = baseline.fields.find(field => field.type === "select" && field.refreshOnChange
    && Object.hasOwn(draft, field.key) && draft[field.key] !== baseline.values[field.key]);
  const effective = changed ? await readForm({ ...baseline.values, ...draft }, changed.key) : baseline;
  const allowed = new Set(effective.fields.map(field => field.key));
  const extra = Object.keys(draft).filter(key => !allowed.has(key));
  if (extra.length) {
    throw new ScheduledTaskDraftRefusal(
      `Draft fields not in the current form: ${extra.join(", ")}`,
      Object.fromEntries(extra.map(key => [taskFieldPath(key), "Not a field of this form"])),
    );
  }
  const answer = changed ? effective : await readForm(draft, null);
  if (!answer.submittable) {
    throw new ScheduledTaskDraftRefusal(
      answer.errors[0]?.message ?? "The scheduled task form is incomplete",
      Object.fromEntries(answer.errors.map(({ field, message }) => [field.replace(/^\/values\//, "/"), message])),
    );
  }
  return { ...answer, values: { ...answer.values, ...draft } };
}

export function createScheduledTaskReads(api: TaskReadApi) {
  return {
    async list() {
      return (await api.list()).tasks.map(taskRecord);
    },
    async record(primaryKey: string) {
      return taskRecord(await api.task(primaryKey));
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
        revision: task.revision,
        save: scheduledTaskSaveDescription(task.id),
      };
    },
    [runNowRead]() {
      return scheduledTaskRunNowDescription;
    },
  };
}
