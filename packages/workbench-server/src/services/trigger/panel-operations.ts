import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { DELETE_TRIGGER, SET_TRIGGER_STATUS, TRIGGER } from "@ontomato/contracts/panel-client-requests";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import type {
  PanelImpactInspector, PanelOperationTarget, PanelRecordTarget, PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import {
  affected, ownerEnvelopeSchema, ownerPost, ownerWriteFailure, remove, save, savedIdSchema, targetLabel,
  valuesForTarget, type DataQueryOperationHost as Host,
} from "../product-panels/data-query-operations";

/*
 * The trigger owner as panel server operations: the form save for creating or editing a Trigger, the status/arming
 * transition (`triggers.setStatus`), and the delete action with human confirmation impact (`triggers.delete`). Every
 * write posts through the data-query owner and preserves coded owner refusals (including field errors and interactive
 * login requirements for workflow triggers).
 */

const deletedSchema = z.object({}).strict();
const deleteInputSchema = z.object({}).strict();
const statusInputSchema = z.object({
  status: z.enum(["PENDING_REVIEW", "PUBLISHED", "UNUSED"]),
  enabled: z.boolean().optional(),
}).strict();

const triggerObjectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(TRIGGER), primaryKey: z.string().min(1),
}).strict();
const triggerSaveTarget = z.discriminatedUnion("kind", [triggerObjectTarget, panelFormTargetSchema.options[1]]);
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();

function saveBody(target: PanelOperationTarget, input: Record<string, unknown>) {
  const { values, submittedFields } = saveInputSchema.parse(input);
  return { ...valuesForTarget(target, values), ...(submittedFields && { submittedFields }) };
}

const deleteTriggerImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_TRIGGER}.inspect-impact`,
  async inspect(host, calls) {
    const targets = calls.map(call => call.target as PanelRecordTarget);
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteTriggerImpact"),
      objects: await Promise.all(targets.map(async target => ({
        target: { objectType: target.objectType, primaryKey: target.primaryKey },
        label: await targetLabel(host, target, "/trigger/queryById", "TRIGGER_UNAVAILABLE"),
      }))),
      total: targets.length,
    };
  },
};

const formInstructions = "Read the form for the intended target. Use its fields, values and save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.";

export const triggerServerOperations = [
  {
    handlerRef: `${TRIGGER}.save`,
    labelKey: "panels.trigger.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: TRIGGER },
    effect: "write",
    batch: false,
    targetType: TRIGGER,
    targetSchema: triggerSaveTarget,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "trigger.create" : "trigger.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: TRIGGER, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/trigger/save", saveBody(target, input), "TRIGGER_SAVE_FAILED", TRIGGER, [TRIGGER]);
    },
  },
  {
    handlerRef: SET_TRIGGER_STATUS,
    labelKey: "panels.trigger.operations.setStatus",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SET_TRIGGER_STATUS },
    effect: "write",
    batch: false,
    targetType: TRIGGER,
    targetSchema: triggerObjectTarget,
    inputSchema: statusInputSchema,
    resultSchema: savedIdSchema,
    targetInput: "trigger",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/trigger/queryById", "TRIGGER_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("The status change acts on a selected trigger");
      const { status, enabled } = statusInputSchema.parse(input);
      const envelope = await ownerPost(
        host,
        "/trigger/status",
        { id: target.primaryKey, status, ...(enabled !== undefined && { enabled }) },
        ownerEnvelopeSchema,
      );
      if (!envelope.success)
        return ownerWriteFailure(envelope, "TRIGGER_STATUS_FAILED", "The owner could not change the trigger status");
      const data = runtimeJsonObjectSchema.parse(envelope.data);
      return { kind: "success", data, affected: affected(TRIGGER, savedIdSchema.parse(data).id, [TRIGGER]) };
    },
  },
  {
    handlerRef: DELETE_TRIGGER,
    labelKey: "panels.trigger.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_TRIGGER },
    effect: "write",
    batch: false,
    targetType: TRIGGER,
    targetSchema: triggerObjectTarget,
    inputSchema: deleteInputSchema,
    resultSchema: deletedSchema,
    targetInput: "trigger",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/trigger/queryById", "TRIGGER_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.trigger.deleted", { name }),
    inspectImpact: deleteTriggerImpact,
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected trigger");
      return remove(host, "/trigger/delete", target, "TRIGGER_DELETE_FAILED");
    },
  },
] satisfies readonly PanelServerOperation[];
