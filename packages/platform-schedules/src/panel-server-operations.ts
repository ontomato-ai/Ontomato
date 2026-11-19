import { z } from "zod";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { RUN_NOW, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import type { PlatformSchedulesHost } from "./host";
import { createSchedulesApi, ScheduleRequestError } from "./api";
import { scheduledTaskDraftOperation, scheduledTaskPanelOperations, scheduledTaskPanelSaveSchema } from "./panel-operations";

type Host = Pick<PlatformSchedulesHost, "request">;
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
async function outcome(call: () => Promise<unknown>): Promise<PanelOperationOutcome> {
  try {
    return { kind: "success", data: JSON.parse(JSON.stringify(await call())) };
  } catch (error) {
    if (error instanceof ScheduleRequestError && error.refusal)
      return { kind: "failure", code: error.refusal.code, message: error.refusal.message, details: JSON.parse(JSON.stringify(error.refusal)) };
    throw error;
  }
}

/** Only the two server operations this owner currently implements, beside their shared pure client. */
export const scheduledTaskServerOperations = [
  {
    handlerRef: `${SCHEDULED_TASK}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
    targetType: SCHEDULED_TASK,
    targetSchema,
    inputSchema: scheduledTaskPanelSaveSchema,
    targetLabel,
    draftOperation: () => scheduledTaskDraftOperation,
    draftInput: (input: Record<string, unknown>) => scheduledTaskPanelSaveSchema.parse(input).values,
    formInstructions: "Use the application's form response for the field keys. Send the returned string values and the current task revision in call.input.",
    execute(host: Host, target: Target, input: Record<string, unknown>, _intentId: string) {
      const { values, revision } = scheduledTaskPanelSaveSchema.parse(input);
      return outcome(() => scheduledTaskPanelOperations(host).save(target.primaryKey, values, revision));
    },
  },
  {
    handlerRef: RUN_NOW,
    kind: "action",
    binding: { kind: "PlatformOperation", id: RUN_NOW },
    targetType: SCHEDULED_TASK,
    targetSchema,
    inputSchema: z.object({}).strict(),
    targetLabel,
    execute(host: Host, target: Target, _input: Record<string, unknown>, intentId: string) {
      return outcome(() => scheduledTaskPanelOperations(host).runNow(target.primaryKey, intentId));
    },
  },
] as const;
