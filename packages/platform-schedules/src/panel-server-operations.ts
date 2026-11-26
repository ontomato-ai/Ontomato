import { z } from "zod";
import { panelFormTargetSchema, type PanelObjectIdentity, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { platformTaskEnabledSchema, platformTaskRunSchema, platformTaskSchema, platformTaskStatusUpdateSchema } from "@ontomato/contracts/platform-schedules";
import { RUN_NOW } from "@ontomato/contracts/panel-client-requests";
import {
  APPLICATION, CREATE_TRIGGER, DELETE_TRIGGER, RENEW_TRIGGER_CREDENTIAL, TRIGGER, SET_TRIGGER_ENABLED, SET_TRIGGER_STATUS,
} from "@ontomato/contracts/platform-object-types";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import type { PlatformSchedulesHost } from "./host";
import { createSchedulesApi, ScheduleRequestError } from "./api";
import { scheduledTaskPanelOperations, scheduledTaskPanelSaveSchema } from "./panel-operations";
import { taskRunStatusKey } from "./run-status";
import { scheduledTaskPanelSubmission } from "./panel-task-values";

type Host = Pick<PlatformSchedulesHost, "request"> & { locale?: string };
type Target = Extract<PanelOperationCall["target"], { kind: "object" }>;
const revision = platformTaskEnabledSchema.shape.revision;
const saveInput = scheduledTaskPanelSaveSchema;
const createInput = panelFormSaveInputSchema.omit({ revision: true }).strict();
const targetSchema = z.object({ kind: z.literal("object"), objectType: z.literal(TRIGGER), primaryKey: z.string().min(1) }).strict();

async function targetLabel(host: Host, target: Target): Promise<string> {
  return (await createSchedulesApi(host).task(target.primaryKey)).title;
}

function panelFieldPath(field: string): string {
  if (field.startsWith("/content/")) return field.slice("/content".length);
  return field;
}

/** The owner interprets its own structured refusal; uncertain transport errors remain the coordinator's outcome. */
async function outcome(
  call: () => Promise<{ data: unknown; taskId?: string; message?: string; removed?: true; created?: PanelObjectIdentity }>,
): Promise<Exclude<PanelOperationOutcome, { kind: "batch" }>> {
  try {
    const { data, taskId, message, removed, created } = await call();
    const objects = taskId ? [{ objectType: TRIGGER, primaryKey: taskId }] : [];
    return {
      kind: "success", data: JSON.parse(JSON.stringify(data)),
      ...(message && { message }),
      ...(created && { created }),
      affected: { objects, objectTypes: [TRIGGER], ...(removed && { removed: objects }) },
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

const scheduledTaskRunNowOperation = {
  handlerRef: RUN_NOW,
  labelKey: "platformSchedules.action.runNow",
  kind: "action",
  binding: { kind: "PlatformOperation", id: RUN_NOW },
  effect: "write",
  batch: false,
  targetType: TRIGGER,
  targetSchema,
  inputSchema: z.object({}).strict(),
  resultSchema: platformTaskRunSchema,
  targetInput: "task",
  targetLabel,
} as const;

const scheduledTaskSaveOperation = {
  handlerRef: `${TRIGGER}.save`,
  labelKey: "platformSchedules.panelManagement.save",
  kind: "form.save",
  binding: { kind: "PlatformObjectType", id: TRIGGER },
  effect: "write",
  batch: false,
  targetType: TRIGGER,
  targetSchema,
  inputSchema: saveInput,
  resultSchema: platformTaskSchema,
  targetLabel,
  draftInput(input: Record<string, unknown>) {
    const { values, submittedFields } = saveInput.parse(input);
    return scheduledTaskPanelSubmission(values, submittedFields);
  },
  formInstructions: "Use the owner form values and current trigger revision. Trigger settings and native target inputs are under task; application fields remain at the root. Send submittedFields for partial edits.",
  execute(host: Host, target: Target, input: Record<string, unknown>, _intentId: string) {
    const { values, revision, submittedFields } = saveInput.parse(input);
    return outcome(async () => {
      const data = await scheduledTaskPanelOperations(host).save(target.primaryKey, values, revision, submittedFields);
      return { data, taskId: data.id };
    });
  },
} as const;

const scheduledTaskCreate = {
  handlerRef: CREATE_TRIGGER,
  labelKey: "platformSchedules.panelManagement.create",
  kind: "form.save",
  binding: { kind: "PlatformObjectType", id: TRIGGER },
  effect: "write",
  batch: false,
  targetType: TRIGGER,
  targetSchema: panelFormTargetSchema.options[1],
  inputSchema: createInput,
  resultSchema: platformTaskSchema,
  draftInput: (input: Record<string, unknown>) => createInput.parse(input).values,
  formInstructions: "Use the owner create form. Set task.enabled to false to save pending review without publishing. Application fields remain at the root.",
  create: true,
  execute(host: Host, _target: Extract<PanelOperationCall["target"], { kind: "draft" }>, input: Record<string, unknown>, intentId: string) {
    const { values } = createInput.parse(input);
    return outcome(async () => {
      const data = await scheduledTaskPanelOperations(host).create(values, intentId);
      return { data, taskId: data.id, created: { objectType: TRIGGER, primaryKey: data.id } };
    });
  },
} as const;

const scheduledTaskSetEnabled = {
  handlerRef: SET_TRIGGER_ENABLED,
  labelKey: "platformSchedules.panelManagement.setEnabled",
  kind: "action",
  binding: { kind: "PlatformOperation", id: SET_TRIGGER_ENABLED },
  effect: "write",
  batch: false,
  targetType: TRIGGER,
  targetSchema,
  inputSchema: platformTaskEnabledSchema,
  resultSchema: platformTaskSchema,
  targetInput: "task",
  targetLabel,
} as const;

const deleteInput = z.object({ revision }).strict();
export function createScheduledTaskServerOperations(
  translate: (locale: string | undefined, key: string, params?: Record<string, string>) => string,
) {
  const runNow = {
    ...scheduledTaskRunNowOperation,
    execute(host: Host, target: Target, _input: Record<string, unknown>, intentId: string) {
      return outcome(async () => {
        const data = await scheduledTaskPanelOperations(host).runNow(target.primaryKey, intentId);
        const key = data.status === "running" ? "platformSchedules.panelRunStarted" : taskRunStatusKey(data);
        return { data, taskId: data.taskId, message: translate(host.locale, key) };
      });
    },
  } as const;
  const setEnabled = {
    ...scheduledTaskSetEnabled,
    execute(host: Host, target: Target, input: Record<string, unknown>) {
      const change = platformTaskEnabledSchema.parse(input);
      return outcome(async () => {
        const data = await scheduledTaskPanelOperations(host).setEnabled(target.primaryKey, change);
        const key = change.enabled ? "enabled" : "disabled";
        return { data, taskId: data.id, message: translate(host.locale, `platformSchedules.panelManagement.${key}`) };
      });
    },
  } as const;
  return [
    {
      ...scheduledTaskSaveOperation,
      async execute(...[host, target, input, intentId]: Parameters<typeof scheduledTaskSaveOperation.execute>) {
        const result = await scheduledTaskSaveOperation.execute(host, target, input, intentId);
        if (result.kind !== "refusal") return result;
        if (result.code === "REVISION_CONFLICT") {
          return { kind: "refusal", code: result.code, message: translate(host.locale, "platformSchedules.panelErrors.revisionConflict") } as const;
        }
        if (result.code === "FORM_CHANGED") {
          return { kind: "refusal", code: result.code, message: translate(host.locale, "platformSchedules.form.formChanged") } as const;
        }
        return result;
      },
    },
    runNow,
    scheduledTaskCreate,
    setEnabled,
    {
      handlerRef: SET_TRIGGER_STATUS,
      labelKey: "platformSchedules.panelManagement.setStatus",
      kind: "action",
      binding: { kind: "PlatformOperation", id: SET_TRIGGER_STATUS },
      effect: "write",
      batch: false,
      targetType: TRIGGER,
      targetSchema,
      inputSchema: platformTaskStatusUpdateSchema,
      resultSchema: platformTaskSchema,
      targetInput: "task",
      targetLabel,
      execute(host: Host, target: Target, input: Record<string, unknown>) {
        const change = platformTaskStatusUpdateSchema.parse(input);
        return outcome(async () => {
          const data = await scheduledTaskPanelOperations(host).setStatus(target.primaryKey, change);
          return { data, taskId: data.id };
        });
      },
    },
    {
      handlerRef: RENEW_TRIGGER_CREDENTIAL,
      labelKey: "platformSchedules.panelManagement.renewCredential",
      kind: "action",
      binding: { kind: "PlatformOperation", id: RENEW_TRIGGER_CREDENTIAL },
      effect: "write",
      batch: false,
      targetType: APPLICATION,
      targetInput: "application",
      targetSchema: z.object({
        kind: z.literal("object"), objectType: z.literal(APPLICATION), primaryKey: z.literal("schedules"),
      }).strict(),
      inputSchema: z.object({}).strict(),
      resultSchema: z.object({}).strict(),
      targetLabel: (host: Host) => Promise.resolve(translate(host.locale, "platformSchedules.title")),
      execute(host: Host) {
        return outcome(async () => {
          await scheduledTaskPanelOperations(host).renewCredential();
          return { data: {} };
        });
      },
    },
    {
      handlerRef: DELETE_TRIGGER,
      labelKey: "platformSchedules.panelManagement.delete",
      kind: "action",
      binding: { kind: "PlatformOperation", id: DELETE_TRIGGER },
      effect: "write",
      batch: false,
      targetType: TRIGGER,
      targetSchema,
      inputSchema: deleteInput,
      resultSchema: z.object({ id: targetSchema.shape.primaryKey }).strict(),
      targetInput: "task",
      targetLabel,
      done: (host: Host, name: string) => translate(host.locale, "platformSchedules.panelManagement.deleted", { name }),
      inspectImpact: {
        handlerRef: `${DELETE_TRIGGER}.inspect-impact`,
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
          return { data: { id: target.primaryKey }, taskId: target.primaryKey, removed: true };
        });
      },
    },
  ] as const;
}
