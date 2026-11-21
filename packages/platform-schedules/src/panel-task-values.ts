import { z } from "zod";
import { formFieldPointer, formValuesSchema } from "@ontomato/contracts/form-fields";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { platformTaskFrequencySchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { frequencyDraft, frequencyOf } from "./frequency";

const settingsSchema = z.object({
  title: z.string(),
  appId: z.string(),
  frequency: platformTaskFrequencySchema,
  timeZone: z.string(),
  notifyEmail: z.string().nullable(),
}).strict();

export type ScheduledTaskPanelSettings = z.infer<typeof settingsSchema>;

/** The task settings are grouped separately from the application's own text fields. */
export function scheduledTaskPanelValues(values: Readonly<PanelFormValues>) {
  const { task, ...parameters } = values;
  return {
    settings: settingsSchema.partial().parse(task ?? {}),
    parameters: formValuesSchema.parse(parameters),
  };
}

export function scheduledTaskPanelSettings(task: PlatformTask | undefined, timeZone: string): ScheduledTaskPanelSettings {
  return {
    title: task?.title ?? "",
    appId: task?.appId ?? "",
    frequency: task?.frequency ?? frequencyOf(frequencyDraft()),
    timeZone: task?.timeZone ?? timeZone,
    notifyEmail: task?.notifyEmail ?? "",
  };
}

export function scheduledTaskPanelSubmission(values: Readonly<PanelFormValues>, submittedFields?: readonly string[]): PanelFormValues {
  const { settings, parameters } = scheduledTaskPanelValues(values);
  const selected = submittedFields === undefined ? undefined : new Set(submittedFields);
  const task = Object.fromEntries(Object.entries(settings).filter(([key]) => !selected || selected.has(formFieldPointer("/task/", key))));
  const content = Object.fromEntries(Object.entries(parameters).filter(([key]) => !selected || selected.has(formFieldPointer("/", key))));
  return { ...content, ...(Object.keys(task).length && { task }) };
}
