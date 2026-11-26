import { z } from "zod";
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { formFieldPointer, formValuesSchema } from "@ontomato/contracts/form-fields";
import type { PanelFormValues } from "@ontomato/contracts/panel-projection";
import { platformTaskFrequencySchema, platformTaskListQuerySchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { frequencyDraft, frequencyOf } from "./frequency";

export const memberIdsSchema = z.array(z.string().min(1));
const targetKindSchema = platformTaskListQuerySchema.shape.targetKind.unwrap();
export const targetKinds = targetKindSchema.options;

const settingsSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  targetKind: targetKindSchema,
  appId: z.string(),
  targetId: z.string(),
  executorId: z.string().min(1).nullable(),
  coauthorIds: memberIdsSchema,
  frequency: platformTaskFrequencySchema,
  timeZone: z.string(),
  notifyEmail: z.string().nullable(),
  enabled: z.boolean(),
  capabilityContent: z.object({
    parameters: runtimeJsonObjectSchema,
    runStartParameters: z.array(z.string().min(1)),
    inputs: runtimeJsonObjectSchema,
    requester: z.string().nullable(),
    goalText: z.string().nullable(),
  }).partial().strict(),
}).partial().strict();

export type ScheduledTaskPanelSettings = z.infer<typeof settingsSchema>;
const panelValuesSchema = z.object({ task: settingsSchema, parameters: formValuesSchema });

type PanelSettings = Required<Omit<ScheduledTaskPanelSettings, "enabled" | "capabilityContent">> & {
  enabled?: boolean;
  capabilityContent: NonNullable<ScheduledTaskPanelSettings["capabilityContent"]>;
};

/** The application owns every top-level field except the reserved trigger settings group. */
function groupPanelValues(values: Readonly<PanelFormValues>) {
  const { task, ...parameters } = values;
  return { task: task === undefined ? {} : task, parameters };
}

export function parseScheduledTaskPanelDraft(values: Readonly<PanelFormValues>) {
  return panelValuesSchema.safeParse(groupPanelValues(values));
}

export function scheduledTaskPanelSettings(task: PlatformTask | undefined, timeZone: string): PanelSettings {
  return {
    title: task?.title ?? "",
    description: task?.description ?? "",
    targetKind: task?.targetKind ?? "application",
    appId: task?.appId ?? "",
    targetId: task?.targetId ?? "",
    executorId: task?.executorId ?? null,
    coauthorIds: task?.coauthorIds ?? [],
    frequency: task?.frequency ?? frequencyOf(frequencyDraft()),
    timeZone: task?.timeZone ?? timeZone,
    notifyEmail: task?.notifyEmail ?? "",
    ...(task ? {} : { enabled: true }),
    capabilityContent: capabilityContent(task),
  };
}

function capabilityContent(task: PlatformTask | undefined): PanelSettings["capabilityContent"] {
  switch (task?.targetKind) {
    case "action": return { parameters: task.content.parameters, runStartParameters: task.content.runStartParameters ?? [] };
    case "workflow": return { inputs: task.content.inputs, requester: task.content.requester ?? "", goalText: task.content.goalText ?? "" };
    default: return {};
  }
}

export function mergeTaskSettings(current: PanelSettings, supplied: ScheduledTaskPanelSettings, resetContent = false): PanelSettings {
  const targetKind = supplied.targetKind ?? current.targetKind;
  const sameKind = targetKind === current.targetKind;
  const selected = targetKind === "application"
    ? { appId: supplied.appId ?? (sameKind ? current.appId : ""), targetId: "" }
    : { appId: "", targetId: supplied.targetId ?? (sameKind ? current.targetId : "") };
  const stored = !resetContent && sameKind && selected.targetId === current.targetId ? current.capabilityContent : {};
  const draft = supplied.capabilityContent;
  const content = targetKind === "action"
    ? { parameters: draft?.parameters ?? stored.parameters ?? {}, runStartParameters: draft?.runStartParameters ?? stored.runStartParameters ?? [] }
    : targetKind === "workflow"
      ? { inputs: draft?.inputs ?? stored.inputs ?? {}, requester: draft?.requester ?? stored.requester ?? "", goalText: draft?.goalText ?? stored.goalText ?? "" }
      : {};
  return { ...current, ...supplied, targetKind, ...selected, capabilityContent: content };
}

export function scheduledTaskPanelSubmission(values: Readonly<PanelFormValues>, submittedFields?: readonly string[]): PanelFormValues {
  if (submittedFields === undefined) return values;
  const { task, ...parameters } = values;
  const selected = new Set(submittedFields);
  const includes = (path: string) => selected.has(path);
  const pick = (value: unknown, path: string, nested: string): [string, RuntimeJsonValue][] => Object.entries(runtimeJsonObjectSchema.parse(value))
    .flatMap(([key, child]) => {
      const field = formFieldPointer(`${path}/`, key);
      if (includes(field)) return [[key, child]];
      if (key === nested) {
        const parts = pick(child, field, "");
        if (parts.length) return [[key, Object.fromEntries(parts)]];
      }
      return [];
    });
  const settings = task === undefined || includes("/task") ? task : Object.fromEntries(pick(task, "/task", "capabilityContent"));
  const content = Object.fromEntries(Object.entries(parameters).filter(([key]) => includes(formFieldPointer("/", key))));
  return { ...content, ...(settings !== undefined && { task: settings }) };
}
