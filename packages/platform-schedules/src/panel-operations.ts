import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { platformSchedulesPath, platformTaskUpdateSchema } from "@ontomato/contracts/platform-schedules";
import { panelFormSaveInputSchema, type PanelFormDescription } from "@ontomato/contracts/panel-projection";
import { formFieldPointer, formValuesSchema } from "@ontomato/contracts/form-fields";
import { SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { createSchedulesApi, type SchedulesApi } from "./api";
import type { PlatformSchedulesHost } from "./host";

export const scheduledTaskPanelSaveSchema = panelFormSaveInputSchema
  .extend({ values: formValuesSchema, revision: z.number().int().positive() }).strict();
export const scheduledTaskDraftOperation = `${SCHEDULED_TASK}.save`;

const taskUpdateBody = runtimeJsonObjectSchema.parse(zodToJsonSchema(platformTaskUpdateSchema, { $refStrategy: "none" }));
export function scheduledTaskSaveDescription(id: string): PanelFormDescription["save"] {
  return {
    method: "PUT",
    path: `${platformSchedulesPath}/${encodeURIComponent(id)}`,
    bodySchema: taskUpdateBody,
    draftOperation: scheduledTaskDraftOperation,
  };
}

export function scheduledTaskSubmittedValues(
  values: Readonly<Record<string, string>>, submittedFields?: readonly string[],
) {
  if (submittedFields === undefined) return values;
  const submitted = new Set(submittedFields);
  return Object.fromEntries(Object.entries(values).filter(([key]) => submitted.has(formFieldPointer("/", key))));
}

/** Pure owner request orchestration, shared by the browser panel and the server coordinator. */
export function scheduledTaskPanelOperations(host: Pick<PlatformSchedulesHost, "request">) {
  const api: SchedulesApi = createSchedulesApi({ ...host, applications: () => [], openResult: () => {} });
  return {
    async save(id: string, values: Readonly<Record<string, string>>, revision: number, submittedFields?: readonly string[]) {
      const task = await api.task(id);
      const submitted = scheduledTaskSubmittedValues(values, submittedFields);
      if (submittedFields !== undefined && Object.keys(submitted).length === 0) return task;
      let content = submittedFields === undefined ? submitted : { ...task.content, ...submitted };
      const form = await api.form(task.appId, { values: content, changedField: null, taskId: task.id, timeZone: task.timeZone });
      const changesForm = submittedFields !== undefined && form.fields.some(field => field.type === "select"
        && field.refreshOnChange && Object.hasOwn(submitted, field.key) && submitted[field.key] !== task.content[field.key]);
      if (changesForm) {
        // Keep stored values for fields in the new form, and let the owner default newly available fields.
        const retained = Object.entries(task.content).filter(([key]) => Object.hasOwn(form.values, key));
        content = { ...form.values, ...Object.fromEntries(retained), ...submitted };
      }
      return api.update(task.id, {
        title: task.title, appId: task.appId, content, formRevision: form.formRevision,
        frequency: task.frequency, timeZone: task.timeZone, notifyEmail: task.notifyEmail,
        // The caller's observed revision survives the preparatory reads; a concurrent edit remains a conflict.
        revision,
      });
    },
    runNow: (id: string, intentId: string) => api.runNow(id, intentId),
  };
}
