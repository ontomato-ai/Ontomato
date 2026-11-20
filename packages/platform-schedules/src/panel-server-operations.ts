import { z } from "zod";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { platformTaskRunSchema, platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import { RUN_NOW, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { PlatformSchedulesHost } from "./host";
import { createSchedulesApi, ScheduleRequestError } from "./api";
import { scheduledTaskDraftOperation, scheduledTaskPanelOperations, scheduledTaskPanelSaveSchema } from "./panel-operations";

type Host = Pick<PlatformSchedulesHost, "request"> & { locale?: string };
type Target = Extract<PanelOperationCall["target"], { kind: "object" }>;
const targetSchema = z.object({ kind: z.literal("object"), objectType: z.literal(SCHEDULED_TASK), primaryKey: z.string().uuid() }).strict();

/** Names are read as the initiator; an unreadable or missing task is identified only by its ID. */
async function targetLabel(host: Host, target: Target): Promise<string> {
  try {
    return (await createSchedulesApi({ ...host, applications: () => [], openResult: () => {} }).task(target.primaryKey)).title;
  } catch (error) {
    if (error instanceof ScheduleRequestError && (error.status === 403 || error.status === 404)) return target.primaryKey;
    throw error;
  }
}

/** The owner interprets its own structured refusal; uncertain transport errors remain the coordinator's outcome. */
async function outcome(call: () => Promise<{ data: unknown; taskId: string; message?: string }>): Promise<Exclude<PanelOperationOutcome, { kind: "batch" }>> {
  try {
    const { data, taskId, message } = await call();
    return {
      kind: "success", data: JSON.parse(JSON.stringify(data)),
      ...(message && { message }),
      affected: { objects: [{ objectType: SCHEDULED_TASK, primaryKey: taskId }], objectTypes: [SCHEDULED_TASK] },
    };
  } catch (error) {
    if (!(error instanceof ScheduleRequestError) || !error.refusal) throw error;
    const { code, message, fields } = error.refusal;
    if (code === "FIELD_VALIDATION_FAILED" || fields) {
      return {
        kind: "refusal", code, message,
        errors: (fields ?? []).map(error => ({ ...error, field: error.field.replace(/^\/content\//, "/") })),
      };
    }
    return {
      kind: error.status !== null && error.status >= 500 ? "failure" : "refusal",
      code, message, details: JSON.parse(JSON.stringify(error.refusal)),
    };
  }
}

export const scheduledTaskRunNowOperation = {
  handlerRef: RUN_NOW,
  labelKey: "platformSchedules.action.runNow",
  kind: "action",
  binding: { kind: "PlatformOperation", id: RUN_NOW },
  effect: "write",
  batch: false,
  targetType: SCHEDULED_TASK,
  targetSchema,
  inputSchema: z.object({}).strict(),
  resultSchema: platformTaskRunSchema,
  targetInput: "task",
  targetLabel,
} as const;

const scheduledTaskSaveOperation = {
  handlerRef: `${SCHEDULED_TASK}.save`,
  kind: "form.save",
  binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
  effect: "write",
  batch: false,
  targetType: SCHEDULED_TASK,
  targetSchema,
  inputSchema: scheduledTaskPanelSaveSchema,
  resultSchema: platformTaskSchema,
  targetLabel,
  draftOperation: () => scheduledTaskDraftOperation,
  draftInput: (input: Record<string, unknown>) => scheduledTaskPanelSaveSchema.parse(input).values,
  formInstructions: "Use the application's form response for the field keys. Send the returned string values and the current task revision in call.input.",
  execute(host: Host, target: Target, input: Record<string, unknown>, _intentId: string) {
    const { values, revision } = scheduledTaskPanelSaveSchema.parse(input);
    return outcome(async () => {
      const data = await scheduledTaskPanelOperations(host).save(target.primaryKey, values, revision);
      return { data, taskId: data.id };
    });
  },
} as const;

export function createScheduledTaskServerOperations(translate: (locale: string | undefined, key: string) => string) {
  return [
    scheduledTaskSaveOperation,
    {
      ...scheduledTaskRunNowOperation,
      execute(host: Host, target: Target, _input: Record<string, unknown>, intentId: string) {
        return outcome(async () => {
          const data = await scheduledTaskPanelOperations(host).runNow(target.primaryKey, intentId);
          const key = data.status === "running" ? "panelRunStarted" : `runStatus.${data.status}`;
          return { data, taskId: data.taskId, message: translate(host.locale, `platformSchedules.${key}`) };
        });
      },
    },
  ] as const;
}
