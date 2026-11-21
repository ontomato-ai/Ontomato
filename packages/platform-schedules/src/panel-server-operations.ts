import { z } from "zod";
import { panelFormTargetSchema, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { platformTaskEnabledSchema, platformTaskRunSchema, platformTaskSchema, platformTaskUpdateSchema } from "@ontomato/contracts/platform-schedules";
import { RUN_NOW } from "@ontomato/contracts/panel-client-requests";
import { CREATE_SCHEDULED_TASK, DELETE_SCHEDULED_TASK, SCHEDULED_TASK, SET_SCHEDULED_TASK_ENABLED } from "@ontomato/contracts/platform-object-types";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import type { PlatformSchedulesHost } from "./host";
import { createSchedulesApi, ScheduleRequestError } from "./api";
import {
  scheduledTaskDraftOperation, scheduledTaskPanelOperations,
} from "./panel-operations";
import { scheduledTaskPanelSubmission } from "./panel-task-values";

type Host = Pick<PlatformSchedulesHost, "request"> & { locale?: string };
type Target = Extract<PanelOperationCall["target"], { kind: "object" }>;
const revision = platformTaskUpdateSchema.shape.revision;
const saveInput = panelFormSaveInputSchema.extend({ revision }).strict();
const createInput = panelFormSaveInputSchema.omit({ revision: true }).strict();
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

function panelFieldPath(field: string): string {
  if (field.startsWith("/content/")) return field.slice("/content".length);
  return field.replace(/^\/(title|appId|frequency|timeZone|notifyEmail)(?=\/|$)/, "/task/$1");
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
        errors: (fields ?? []).map(error => ({ ...error, field: panelFieldPath(error.field) })),
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
  inputSchema: saveInput,
  resultSchema: platformTaskSchema,
  targetLabel,
  draftOperation: () => scheduledTaskDraftOperation,
  draftInput(input: Record<string, unknown>) {
    const { values, submittedFields } = saveInput.parse(input);
    return scheduledTaskPanelSubmission(values, submittedFields);
  },
  formInstructions: "Use the owner form values and the current task revision. Task settings are under task; application fields remain at the root. Send submittedFields for partial edits.",
  execute(host: Host, target: Target, input: Record<string, unknown>, _intentId: string) {
    const { values, revision, submittedFields } = saveInput.parse(input);
    return outcome(async () => {
      const data = await scheduledTaskPanelOperations(host).save(target.primaryKey, values, revision, submittedFields);
      return { data, taskId: data.id };
    });
  },
} as const;

const scheduledTaskCreate = {
  handlerRef: CREATE_SCHEDULED_TASK,
  labelKey: "platformSchedules.panelManagement.create",
  kind: "form.save",
  binding: { kind: "PlatformObjectType", id: SCHEDULED_TASK },
  effect: "write",
  batch: false,
  targetType: SCHEDULED_TASK,
  targetSchema: panelFormTargetSchema.options[1],
  inputSchema: createInput,
  resultSchema: platformTaskSchema,
  draftOperation: () => CREATE_SCHEDULED_TASK,
  draftInput: (input: Record<string, unknown>) => createInput.parse(input).values,
  formInstructions: "Use the owner create form. Task settings are under task; application fields remain at the root.",
  create: {
    draftValues: (values: unknown) => createInput.shape.values.parse(values),
    createdObject: (data: unknown) => ({ objectType: SCHEDULED_TASK, primaryKey: platformTaskSchema.parse(data).id }),
  },
  execute(host: Host, _target: Extract<PanelOperationCall["target"], { kind: "draft" }>, input: Record<string, unknown>, intentId: string) {
    const { values } = createInput.parse(input);
    return outcome(async () => {
      const data = await scheduledTaskPanelOperations(host).create(values, intentId);
      return { data, taskId: data.id };
    });
  },
} as const;

const scheduledTaskSetEnabled = {
  handlerRef: SET_SCHEDULED_TASK_ENABLED,
  labelKey: "platformSchedules.panelManagement.setEnabled",
  kind: "action",
  binding: { kind: "PlatformOperation", id: SET_SCHEDULED_TASK_ENABLED },
  effect: "write",
  batch: false,
  targetType: SCHEDULED_TASK,
  targetSchema,
  inputSchema: platformTaskEnabledSchema,
  resultSchema: platformTaskSchema,
  targetInput: "task",
  targetLabel,
  execute(host: Host, target: Target, input: Record<string, unknown>) {
    const change = platformTaskEnabledSchema.parse(input);
    return outcome(async () => {
      const data = await scheduledTaskPanelOperations(host).setEnabled(target.primaryKey, change);
      return { data, taskId: data.id };
    });
  },
} as const;

const deleteInput = z.object({ revision }).strict();
export function createScheduledTaskServerOperations(translate: (locale: string | undefined, key: string) => string) {
  const runNow = {
    ...scheduledTaskRunNowOperation,
    execute(host: Host, target: Target, _input: Record<string, unknown>, intentId: string) {
      return outcome(async () => {
        const data = await scheduledTaskPanelOperations(host).runNow(target.primaryKey, intentId);
        const key = data.status === "running" ? "panelRunStarted" : `runStatus.${data.status}`;
        return { data, taskId: data.taskId, message: translate(host.locale, `platformSchedules.${key}`) };
      });
    },
  } as const;
  return [
    scheduledTaskSaveOperation,
    runNow,
    scheduledTaskCreate,
    scheduledTaskSetEnabled,
    {
      handlerRef: DELETE_SCHEDULED_TASK,
      labelKey: "platformSchedules.panelManagement.delete",
      kind: "action",
      binding: { kind: "PlatformOperation", id: DELETE_SCHEDULED_TASK },
      effect: "write",
      batch: false,
      targetType: SCHEDULED_TASK,
      targetSchema,
      inputSchema: deleteInput,
      resultSchema: z.object({ id: targetSchema.shape.primaryKey }).strict(),
      targetInput: "task",
      targetLabel,
      inspectImpact: {
        handlerRef: `${DELETE_SCHEDULED_TASK}.inspect-impact`,
        async inspect(host: Host, calls: readonly PanelOperationCall[]) {
          const targets = calls.map(call => targetSchema.parse(call.target));
          return {
            summary: translate(host.locale, "platformSchedules.panelManagement.deleteImpact"),
            total: targets.length,
            objects: await Promise.all(targets.map(async target => ({
              target: { objectType: target.objectType, primaryKey: target.primaryKey },
              label: await targetLabel(host, target),
            }))),
          };
        },
      },
      execute(host: Host, target: Target, input: Record<string, unknown>) {
        const { revision } = deleteInput.parse(input);
        return outcome(async () => {
          await scheduledTaskPanelOperations(host).remove(target.primaryKey, revision);
          return { data: { id: target.primaryKey }, taskId: target.primaryKey };
        });
      },
    },
  ] as const;
}
