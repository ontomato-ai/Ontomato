import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { formFieldPointer, type FormFieldError, type FormValues } from "@ontomato/contracts/form-fields";
import {
  platformSchedulesPath, platformTaskEnabledSchema, platformTaskInputSchema, platformTaskUpdateSchema,
  type PlatformScheduleForm, type PlatformTask, type PlatformTaskInput,
} from "@ontomato/contracts/platform-schedules";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormValues } from "@ontomato/contracts/panel-projection";
import { createSchedulesApi, ScheduleRequestError } from "./api";
import type { PlatformSchedulesHost } from "./host";
import { mergeTaskSettings, parseScheduledTaskPanelDraft, scheduledTaskPanelSettings, scheduledTaskPanelSubmission } from "./panel-task-values";

export const scheduledTaskPanelSaveSchema = panelFormSaveInputSchema.extend({ revision: platformTaskEnabledSchema.shape.revision }).strict();

const taskCreateBody = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskInputSchema));
const taskUpdateBody = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskUpdateSchema));
export function scheduledTaskSaveDescription(id: string): PanelFormDescription["save"] {
  return {
    method: "PUT",
    path: `${platformSchedulesPath}/${encodeURIComponent(id)}`,
    bodySchema: taskUpdateBody,
  };
}

export function scheduledTaskCreateDescription(enabled: boolean): PanelFormDescription["save"] {
  return { method: "POST", path: `${platformSchedulesPath}?enabled=${enabled}`, bodySchema: taskCreateBody };
}

export function taskInput(
  settings: ReturnType<typeof scheduledTaskPanelSettings>, application?: { values: FormValues; formRevision: string },
) {
  const { title, description, targetKind, appId, targetId, frequency, timeZone, notifyEmail, executorId, coauthorIds, capabilityContent } = settings;
  const common = { title, description, targetKind, frequency, timeZone, notifyEmail: notifyEmail?.trim() || null, executorId, coauthorIds };
  if (targetKind === "application") return { ...common, appId, content: application?.values, formRevision: application?.formRevision };
  return { ...common, targetId, content: capabilityContent };
}

export function taskInputField(path: readonly (string | number)[], kind: PlatformTaskInput["targetKind"]): string {
  const [first, ...rest] = path;
  const nested = rest.reduce<string>((prefix, token) => formFieldPointer(`${prefix}/`, String(token)), "");
  if (first === "content") return kind === "application" ? nested : `/task/capabilityContent${nested}`;
  return first === undefined ? "/task" : `${formFieldPointer("/task/", String(first))}${nested}`;
}

export function applicationFormErrors(form: PlatformScheduleForm): FormFieldError[] {
  return form.errors.map(error => ({ ...error, field: error.field.replace(/^\/values\//, "/") }));
}

export function applicationDraftErrors(form: PlatformScheduleForm, parameters: FormValues): FormFieldError[] {
  const errors: FormFieldError[] = [];
  for (const key of Object.keys(parameters)) if (!Object.hasOwn(form.values, key))
    errors.push({ field: formFieldPointer("/", key), code: "invalid_object", message: "Not a field of this form" });
  for (const { key, required, label } of form.fields) if (required && !form.values[key].trim())
    errors.push({ field: formFieldPointer("/", key), code: "required", message: `${label} is required` });
  return errors;
}

/** The same panel submission is executed for a human or an agent. */
export function scheduledTaskPanelOperations(host: Pick<PlatformSchedulesHost, "request">) {
  const api = createSchedulesApi(host);
  async function submission(values: Readonly<PanelFormValues>, task?: PlatformTask, patch = false) {
    const draft = parseScheduledTaskPanelDraft(values);
    if (!draft.success) {
      const fields = draft.error.issues.map(issue => ({
        code: "invalid_format" as const, message: issue.message,
        field: issue.path.slice(issue.path[0] === "parameters" ? 1 : 0)
          .reduce<string>((prefix, key) => formFieldPointer(`${prefix}/`, String(key)), ""),
      }));
      throw new ScheduleRequestError(422, { code: "FIELD_VALIDATION_FAILED", message: draft.error.message, fields });
    }
    const { task: supplied, parameters } = draft.data;
    const timeZone = supplied.timeZone ?? task?.timeZone ?? (await api.list()).timeZone;
    const settings = mergeTaskSettings(scheduledTaskPanelSettings(task, timeZone), supplied);
    let application;
    if (settings.targetKind === "application" && settings.appId) {
      const sameApp = task?.targetKind === "application" && task.appId === settings.appId;
      const stored = patch && sameApp ? task.content : {};
      const form = await api.form(settings.appId, {
        values: { ...stored, ...parameters }, changedField: null, taskId: sameApp ? task.id : null, timeZone,
      });
      const fields = [...applicationDraftErrors(form, parameters), ...applicationFormErrors(form)];
      if (fields.length) throw new ScheduleRequestError(422, { code: "FIELD_VALIDATION_FAILED", message: fields[0].message, fields });
      // The owner's replacement form has removed fields that no longer belong to the selected target.
      application = form;
    }
    const parsed = platformTaskInputSchema.safeParse(taskInput(settings, application));
    if (!parsed.success) {
      const fields = parsed.error.issues.map(issue => ({
        field: taskInputField(issue.path, settings.targetKind), code: "invalid_format" as const, message: issue.message,
      }));
      throw new ScheduleRequestError(422, { code: "FIELD_VALIDATION_FAILED", message: fields[0]!.message, fields });
    }
    return { input: parsed.data, enabled: settings.enabled ?? true };
  }

  return {
    async create(values: Readonly<PanelFormValues>, intentId: string) {
      const { input, enabled } = await submission(values);
      return api.create(input, intentId, enabled);
    },
    async save(id: string, values: Readonly<PanelFormValues>, revision: number, submittedFields?: readonly string[]) {
      const task = await api.task(id);
      const selection = scheduledTaskPanelSubmission(values, submittedFields);
      const { input } = await submission(selection, task, submittedFields !== undefined);
      // Echo the observed revision, not the one returned by the preparatory read.
      return api.update(id, { ...input, revision });
    },
    renewCredential: api.renewCredential,
    setEnabled: api.setEnabled,
    setStatus: api.setStatus,
    remove: api.remove,
    runNow: api.runNow,
  };
}
