import { z } from "zod";
import { ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW, WORKFLOW } from "@ontomato/contracts/platform-object-types";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import {
  affected, ownerEnvelopeSchema, ownerPost, ownerRecord, ownerWriteFailure, remove, savedIdSchema, valuesForTarget,
} from "../product-panels/data-query-operations";
import type {
  PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelWriteServerOperation, SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import { canActivateWorkflow, canDeactivateWorkflow, requireWorkflow, workflowSaveValues, workflowSchema, workflowText } from "./definition";

const objectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(WORKFLOW), primaryKey: z.string().min(1),
}).strict();
const saveTarget = z.discriminatedUnion("kind", [objectTarget, panelFormTargetSchema.options[1]]);
const saveInput = panelFormSaveInputSchema.omit({ revision: true }).strict();
const empty = z.object({}).strict();
const activationSchema = savedIdSchema.extend({ activationNotes: z.array(z.string()).nullish() });
export const workflowLifecycleStateSchema = workflowSchema.pick({ id: true, status: true, hasDraft: true }).required();

async function readTarget(host: PanelOperationHost, target: PanelRecordTarget) {
  const data = await ownerRecord(host, target, "/workflow/query", "WORKFLOW_READ_FAILED");
  return requireWorkflow(workflowSchema.nullish().parse(data), host.locale);
}

async function readWorkflowRows(host: PanelOperationHost) {
  const envelope = await ownerPost(host, "/workflow/query", {}, ownerEnvelopeSchema);
  if (!envelope.success) throw new Error(envelope.message ?? "The owner could not read workflows");
  return z.array(workflowSchema).parse(envelope.data);
}

const actions = [
  {
    handlerRef: ACTIVATE_WORKFLOW,
    verb: "activate",
    impactKey: "panels.confirmation.activateWorkflowImpact",
    unavailable: (row: Pick<z.infer<typeof workflowSchema>, "status" | "hasDraft">) => !canActivateWorkflow(row),
    reason: "alreadyActive",
    done: "activated",
  },
  {
    handlerRef: DEACTIVATE_WORKFLOW,
    verb: "deactivate",
    impactKey: "panels.confirmation.deactivateWorkflowImpact",
    unavailable: (row: Pick<z.infer<typeof workflowSchema>, "status">) => !canDeactivateWorkflow(row),
    reason: "notActive",
    done: "deactivated",
  },
  {
    handlerRef: DELETE_WORKFLOW,
    verb: "delete",
    impactKey: "panels.confirmation.deleteWorkflowImpact",
    unavailable: canDeactivateWorkflow,
    reason: "activeCannotDelete",
    done: "deleted",
  },
] as const;

export function workflowLifecycleAction(handlerRef: string) {
  return actions.find(action => action.handlerRef === handlerRef);
}

export function workflowLifecycleUnavailable(
  action: (typeof actions)[number], row: Pick<z.infer<typeof workflowSchema>, "status" | "hasDraft">, locale?: string,
) {
  return action.unavailable(row) ? { reason: workflowText(locale)(`unavailable.${action.reason}`) } : undefined;
}

const workflowActions = actions.map((action): PanelWriteServerOperation => ({
  handlerRef: action.handlerRef,
  labelKey: `panels.workflow.operations.${action.verb}`,
  kind: "action",
  binding: { kind: "PlatformOperation", id: action.handlerRef },
  effect: "write",
  batch: false,
  targetType: WORKFLOW,
  targetSchema: objectTarget,
  inputSchema: empty,
  resultSchema: action.verb === "delete" ? empty : savedIdSchema,
  targetInput: "workflow",
  targetLabel: async (host, target) => (await readTarget(host, target)).name,
  async unavailable(host, target: PanelRecordTarget) {
    return workflowLifecycleUnavailable(action, await readTarget(host, target), host.locale);
  },
  async unavailableBatch(host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) {
    const rows = new Map((await readWorkflowRows(host)).map(row => [row.id, row]));
    const reasons = new Map<string, { reason: string } | undefined>();
    for (const { target, rowKey } of targets) {
      const row = requireWorkflow(rows.get(target.primaryKey), host.locale);
      const unavailable = workflowLifecycleUnavailable(action, row, host.locale);
      if (unavailable) reasons.set(rowKey, unavailable);
    }
    return reasons;
  },
  inspectImpact: {
    handlerRef: `${action.handlerRef}.inspect-impact`,
    async inspect(host, calls) {
      const objects = await Promise.all(calls.map(async ({ target }) => {
        const row = await readTarget(host, target as PanelRecordTarget);
        return { target: { objectType: WORKFLOW, primaryKey: row.id }, label: row.name };
      }));
      return {
        summary: tForLocale(host.locale, action.impactKey, { name: objects[0].label }),
        objects,
        total: objects.length,
      };
    },
  },
  done: (host, name) => workflowText(host.locale)(action.done, { name }),
  async execute(host, target): Promise<SinglePanelOperationOutcome> {
    if (target.kind !== "object") throw new Error("Workflow actions require a selected workflow");
    if (action.verb === "delete") return remove(host, "/workflow/delete", target, "WORKFLOW_DELETE_FAILED");

    const envelope = await ownerPost(host, `/workflow/${action.verb}`, { id: target.primaryKey }, ownerEnvelopeSchema);
    if (!envelope.success) {
      return ownerWriteFailure(envelope, `WORKFLOW_${action.verb.toUpperCase()}_FAILED`, workflowText(host.locale)("writeFailed"));
    }
    const { id } = savedIdSchema.parse(envelope.data);
    const notes = action.verb === "activate" ? activationSchema.parse(envelope.data).activationNotes : null;
    return {
      kind: "success",
      data: { id },
      affected: affected(WORKFLOW, id, [WORKFLOW]),
      ...(notes?.length && {
        message: workflowText(host.locale)("activatedWithNotes", { notes: notes.join("\n") }),
      }),
    };
  },
}));

export const workflowServerOperations = [
  {
    handlerRef: `${WORKFLOW}.save`,
    labelKey: "panels.workflow.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: WORKFLOW },
    effect: "write",
    batch: false,
    targetType: WORKFLOW,
    targetSchema: saveTarget,
    inputSchema: saveInput,
    resultSchema: savedIdSchema,
    draftInput: input => saveInput.parse(input).values,
    create: true,
    async execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { values } = saveInput.parse(input);
      const body = workflowSaveValues(valuesForTarget(target, values));
      const envelope = await ownerPost(host, "/workflow/save", body, ownerEnvelopeSchema);
      if (!envelope.success) return ownerWriteFailure(envelope, "WORKFLOW_SAVE_FAILED", workflowText(host.locale)("writeFailed"));
      const { id } = savedIdSchema.parse(envelope.data);
      return {
        kind: "success",
        data: { id },
        ...(target.kind === "draft" && { created: { objectType: WORKFLOW, primaryKey: id } }),
        affected: affected(WORKFLOW, id, [WORKFLOW]),
      };
    },
  },
  ...workflowActions,
] satisfies readonly PanelWriteServerOperation[];
