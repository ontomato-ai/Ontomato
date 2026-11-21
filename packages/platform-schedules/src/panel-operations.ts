import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { platformSchedulesPath, platformTaskInputSchema, platformTaskUpdateSchema } from "@ontomato/contracts/platform-schedules";
import { panelFormSaveInputSchema, type PanelFormDescription, type PanelFormValues } from "@ontomato/contracts/panel-projection";
import { formFieldPointer, formValuesSchema } from "@ontomato/contracts/form-fields";
import {
  CREATE_SCHEDULED_TASK, SCHEDULED_TASK,
} from "@ontomato/contracts/platform-object-types";
import { createSchedulesApi, ScheduleRequestError, type SchedulesApi } from "./api";
import type { PlatformSchedulesHost } from "./host";
import { scheduledTaskPanelSettings, scheduledTaskPanelSubmission, scheduledTaskPanelValues, type ScheduledTaskPanelSettings } from "./panel-task-values";

export const scheduledTaskPanelSaveSchema = panelFormSaveInputSchema
  .extend({ values: formValuesSchema, revision: z.number().int().positive() }).strict();
export const scheduledTaskDraftOperation = `${SCHEDULED_TASK}.save`;

const taskCreateBody = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskInputSchema, { $refStrategy: "none" }));
const taskUpdateBody = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskUpdateSchema, { $refStrategy: "none" }));
export function scheduledTaskSaveDescription(id: string): PanelFormDescription["save"] {
  return {
    method: "PUT",
    path: `${platformSchedulesPath}/${encodeURIComponent(id)}`,
    bodySchema: taskUpdateBody,
    draftOperation: scheduledTaskDraftOperation,
  };
}

export const scheduledTaskCreateDescription: PanelFormDescription["save"] = {
  method: "POST",
  path: platformSchedulesPath,
  bodySchema: taskCreateBody,
  draftOperation: CREATE_SCHEDULED_TASK,
};

const taskSettingsSubmission = platformTaskInputSchema.omit({ content: true, formRevision: true });

function checkedTaskSettings(settings: ScheduledTaskPanelSettings) {
  const parsed = taskSettingsSubmission.safeParse({ ...settings, notifyEmail: settings.notifyEmail?.trim() || null });
  if (!parsed.success) {
    const fields = parsed.error.issues.map(issue => {
      const key = String(issue.path[0]);
      return {
        field: formFieldPointer("/", key),
        code: key === "timeZone" || key === "frequency" ? "invalid_time" as const : "invalid_object" as const,
        message: issue.message,
      };
    });
    throw new ScheduleRequestError(422, { code: "FIELD_VALIDATION_FAILED", message: fields[0]!.message, fields });
  }
  return { ...parsed.data, timeZone: settings.timeZone };
}

/** Pure owner request orchestration, shared by the browser panel and the server coordinator. */
export function scheduledTaskPanelOperations(host: Pick<PlatformSchedulesHost, "request">) {
  const api: SchedulesApi = createSchedulesApi({ ...host, applications: () => [], openResult: () => {} });
  return {
    async create(values: Readonly<PanelFormValues>, intentId: string) {
      const { settings: supplied, parameters } = scheduledTaskPanelValues(values);
      const timeZone = supplied.timeZone ?? (await api.list()).timeZone;
      const settings = checkedTaskSettings({ ...scheduledTaskPanelSettings(undefined, timeZone), ...supplied });
      const form = await api.form(settings.appId, { values: parameters, changedField: null, taskId: null, timeZone: settings.timeZone });
      return api.create({
        ...settings,
        content: { ...form.values, ...parameters }, formRevision: form.formRevision,
      }, intentId);
    },
    async save(id: string, values: Readonly<PanelFormValues>, revision: number, submittedFields?: readonly string[]) {
      const task = await api.task(id);
      const selection = scheduledTaskPanelSubmission(values, submittedFields);
      if (submittedFields !== undefined && Object.keys(selection).length === 0) return task;
      const { settings: supplied, parameters } = scheduledTaskPanelValues(selection);
      const settings = checkedTaskSettings({ ...scheduledTaskPanelSettings(task, task.timeZone), ...supplied });
      const sameApp = settings.appId === task.appId;
      const stored = sameApp ? task.content : {};
      let content = submittedFields === undefined ? parameters : { ...stored, ...parameters };
      const form = await api.form(settings.appId, {
        values: content, changedField: null, taskId: sameApp ? task.id : null, timeZone: settings.timeZone,
      });
      const changesForm = !sameApp || (submittedFields !== undefined && form.fields.some(field => field.type === "select"
        && field.refreshOnChange && Object.hasOwn(parameters, field.key) && parameters[field.key] !== stored[field.key]));
      if (changesForm) {
        // Keep stored values for fields in the new form, and let the owner default newly available fields.
        const retained = Object.entries(stored).filter(([key]) => Object.hasOwn(form.values, key));
        content = { ...form.values, ...Object.fromEntries(retained), ...parameters };
      }
      return api.update(task.id, {
        ...settings, content, formRevision: form.formRevision,
        // The caller's observed revision survives the preparatory reads; a concurrent edit remains a conflict.
        revision,
      });
    },
    renewCredential: api.renewCredential,
    setEnabled: api.setEnabled,
    remove: api.remove,
    runNow: (id: string, intentId: string) => api.runNow(id, intentId),
  };
}
