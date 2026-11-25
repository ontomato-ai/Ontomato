import { z } from "zod";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { ACTION, CHECK_ACTION_SANDBOX_PERMISSION, DELETE_ACTION, FUNCTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import { DATA_ADAPTER_CONFIG } from "@ontomato/contracts/platform-object-types";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormDescriptionSchema, panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { checkSandboxPermission, sandboxPermissionResultSchema } from "../product-panels/sandbox-permission";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import type {
  PanelBatchCalls, PanelImpactInspector, PanelOperationTarget, PanelRecordTarget, PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import {
  affected, ownerDeleteUnavailable, ownerEnvelopeSchema, ownerPost, ownerWriteFailure, remove, save, savedIdSchema, targetLabel,
  valuesForTarget, type DataQueryOperationHost as Host,
} from "../product-panels/data-query-operations";
import { readRefusal } from "./object-actions";

/*
 * The action owner as panel server operations: the form save the coordinator dispatches for a person's or an agent's
 * call, the delete action with the impact its confirming human reads, and the batch change of an action's publication
 * status. The owner answers through the data-query service with its usual envelope; an explicit owner code makes a
 * negative answer a refusal, while a negative answer without one is a failure. Saving an action may also change the
 * write function its definition embeds.
 */

const deletedSchema = z.object({}).strict();
const statusInputSchema = z.object({
  status: z.enum(["PENDING_REVIEW", "PUBLISHED", "UNUSED"]).describe(
    "Target publication status (PENDING_REVIEW, PUBLISHED, or UNUSED)",
  ),
}).strict();

async function describeStatusInputSchema(host: Host) {
  const result = await ownerPost(host, "/action/definitionForm", { target: { kind: "draft" }, changedField: null }, ownerEnvelopeSchema);
  if (!result.success) throw readRefusal(result, "ACTION_READ_FAILED", "The owner could not read the action definition form");
  const status = panelFormDescriptionSchema.parse(result.data).fields.find(field => field.path === "/status");
  if (status?.control.kind !== "select") throw new Error("The Action definition form must describe /status as a select");

  const inputSchema = cachedZodToRuntimeJsonSchema(statusInputSchema, { effectStrategy: "input" });
  const properties = inputSchema.properties as { status: Record<string, RuntimeJsonValue> };
  const { description: _rawDescription, ...statusProperty } = properties.status;
  return {
    ...inputSchema,
    properties: {
      ...properties,
      status: {
        ...statusProperty,
        title: status.label,
        ...(status.help ? { description: status.help } : {}),
        oneOf: status.control.options.map(option => ({ const: option.value, title: option.label })),
      },
    },
  };
}

/**
 * The owner answers one status change per requested id: a saved action, its refusal, or its failure. The saved action
 * is read with the rest of the receipt, so a receipt this operation cannot read leaves only its own group unknown.
 */
const statusItemSchema = z.discriminatedUnion("outcome", [
  z.object({ id: z.string().min(1), outcome: z.literal("success"), data: runtimeJsonObjectSchema.and(savedIdSchema) }).strict(),
  z.object({
    id: z.string().min(1), outcome: z.literal("refusal"), code: z.string().min(1),
    error: z.object({ message: z.string() }).strict(),
  }).strict(),
  z.object({
    id: z.string().min(1), outcome: z.literal("failure"),
    error: z.object({ message: z.string() }).strict(),
  }).strict(),
]);
const statusAnswerSchema = z.object({ items: z.array(statusItemSchema).nonempty() }).strict();

const actionObjectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(ACTION), primaryKey: z.string().min(1),
}).strict();
const actionSaveTarget = z.discriminatedUnion("kind", [actionObjectTarget, panelFormTargetSchema.options[1]]);
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();

/** The save the owner applies: the whole action, or with submittedFields only those fields of it. */
function saveBody(target: PanelOperationTarget, input: Record<string, unknown>) {
  const { values, submittedFields } = saveInputSchema.parse(input);
  return { ...valuesForTarget(target, values), ...(submittedFields && { submittedFields }) };
}
const deleteInputSchema = z.object({}).strict();

type StatusGroupOutcome = Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }>;
type StatusAnswer =
  | { group: StatusGroupOutcome }
  | { items: Map<string, z.infer<typeof statusItemSchema>> }
  | { unknown: string };

/** One owner call: its group-wide refusal/failure, its answer per id, or an unknown result for this group. */
async function changeStatus(host: Host, ids: string[], status: string): Promise<StatusAnswer> {
  const envelope = await ownerPost(host, "/action/setStatus", { ids, status }, ownerEnvelopeSchema);
  if (!envelope.success)
    return { group: ownerWriteFailure(envelope, "ACTION_STATUS_FAILED", "The owner could not change the status") };
  return { items: new Map(statusAnswerSchema.parse(envelope.data).items.map(item => [item.id, item])) };
}

/** The owner's answer for one action: a success carries the saved action; the other kinds keep their own code. */
function statusOutcome(answer: StatusAnswer, id: string): SinglePanelOperationOutcome {
  if ("group" in answer) return answer.group;
  if ("unknown" in answer) return { kind: "unknown", message: answer.unknown };
  const item = answer.items.get(id)!;
  if (item.outcome === "success")
    return { kind: "success", data: item.data, affected: affected(ACTION, item.data.id, [ACTION]) };
  if (item.outcome === "refusal") return { kind: "refusal", code: item.code, message: item.error.message };
  return { kind: "failure", code: "ACTION_STATUS_FAILED", message: item.error.message };
}

/*
 * The impact a delete shows its confirming human: each selected action under its owner-read name. A system action and
 * an action referenced by a scheduled task are refused by the owner; the description says so and does not rejudge the
 * rule.
 */
const deleteActionImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_ACTION}.inspect-impact`,
  async inspect(host, calls) {
    const targets = calls.map(call => call.target as PanelRecordTarget);
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteActionImpact"),
      objects: await Promise.all(targets.map(async target => ({
        target: { objectType: target.objectType, primaryKey: target.primaryKey },
        label: await targetLabel(host, target, "/action/queryById", "ACTION_UNAVAILABLE"),
      }))),
      total: targets.length,
    };
  },
};

const publishReviewSchema = z.object({
  name: z.string(),
  sandboxTrialLabel: z.string(),
  explanationMissingLabel: z.string().optional(),
});

const publishActionImpact: PanelImpactInspector = {
  handlerRef: `${SET_ACTION_STATUS}.inspect-impact`,
  async inspect(host, calls) {
    const publishing = calls.filter(call => call.input.status === "PUBLISHED");
    if (publishing.length === 0) return null;
    const objects = await Promise.all(publishing.map(async call => {
      const target = call.target as PanelRecordTarget;
      const result = await ownerPost(host, "/action/queryById", {
        id: target.primaryKey, purpose: "publication-review",
      }, ownerEnvelopeSchema);
      if (!result.success) throw readRefusal(result, "ACTION_READ_FAILED", "The owner could not read the action");
      const action = publishReviewSchema.parse(result.data);
      return {
        target: { objectType: target.objectType, primaryKey: target.primaryKey },
        label: [action.name, action.sandboxTrialLabel, action.explanationMissingLabel].filter(Boolean).join(" · "),
      };
    }));
    return {
      summary: tForLocale(host.locale, "panels.action.operations.setStatus"),
      objects,
      total: objects.length,
    };
  },
};


export const m6ServerOperations = [
  {
    handlerRef: CHECK_ACTION_SANDBOX_PERMISSION,
    labelKey: "panels.action.operations.checkSandboxPermission",
    kind: "action",
    effect: "write",
    batch: false,
    binding: { kind: "PlatformOperation", id: CHECK_ACTION_SANDBOX_PERMISSION },
    targetType: ACTION,
    targetSchema: z.null(),
    inputSchema: z.object({}).strict(),
    resultSchema: sandboxPermissionResultSchema,
    async execute(host: Host & { locale?: string }): Promise<SinglePanelOperationOutcome> {
      try {
        return await checkSandboxPermission(host, [ACTION, DATA_ADAPTER_CONFIG]);
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 403)) throw error;
        return {
          kind: "refusal",
          code: "SANDBOX_CHECK_FORBIDDEN",
          message: tForLocale(host.locale, "panels.action.sandbox.checkForbidden"),
        };
      }
    },
  },
  {
    handlerRef: `${ACTION}.save`,
    labelKey: "panels.action.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ACTION },
    effect: "write",
    batch: false,
    targetType: ACTION,
    targetSchema: actionSaveTarget,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/action/save", target, saveBody(target, input),
        "ACTION_SAVE_FAILED", ACTION, [ACTION, FUNCTION]);
    },
  },
  {
    handlerRef: DELETE_ACTION,
    labelKey: "panels.action.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_ACTION },
    effect: "write",
    batch: false,
    targetType: ACTION,
    targetSchema: actionObjectTarget,
    inputSchema: deleteInputSchema,
    resultSchema: deletedSchema,
    targetInput: "action",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/action/queryById", "ACTION_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.action.deleted", { name }),
    inspectImpact: deleteActionImpact,
    unavailable: (host: Host, target: PanelRecordTarget) => ownerDeleteUnavailable(host, "/action/queryById",
      { id: target.primaryKey, purpose: "delete-availability" }, "ACTION_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected action");
      return remove(host, "/action/delete", target, "ACTION_DELETE_FAILED");
    },
  },
  {
    handlerRef: SET_ACTION_STATUS,
    labelKey: "panels.action.operations.setStatus",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SET_ACTION_STATUS },
    effect: "write",
    batch: true,
    targetType: ACTION,
    targetSchema: actionObjectTarget,
    inputSchema: statusInputSchema,
    describeInputSchema: describeStatusInputSchema,
    inspectImpact: publishActionImpact,
    resultSchema: savedIdSchema,
    targetInput: "action",
    targetLabel: (host: Host, target: PanelRecordTarget) => targetLabel(host, target, "/action/queryById", "ACTION_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("The status change acts on a selected action");
      const { status } = statusInputSchema.parse(input);
      return statusOutcome(await changeStatus(host, [target.primaryKey], status), target.primaryKey);
    },
    async executeBatch(host: Host, calls: readonly PanelBatchCalls[number][]): Promise<PanelOperationOutcome> {
      // Each call may set its own status; the owner takes one status per request, so the calls go in one request per
      // status and every call reads its own answer. A group without a receipt leaves only its own calls unknown; when no
      // group got one, the batch answers unknown as a whole.
      const statuses = calls.map(call => statusInputSchema.parse(call.input).status);
      const answers = new Map<string, StatusAnswer>();
      let unanswered = "";
      for (const status of new Set(statuses)) {
        try {
          answers.set(status, await changeStatus(host, calls.filter((_, index) => statuses[index] === status)
            .map(call => call.target.primaryKey), status));
        } catch (error) {
          unanswered = error instanceof Error ? error.message : String(error);
          answers.set(status, { unknown: unanswered });
        }
      }
      if ([...answers.values()].every(answer => "unknown" in answer)) return { kind: "unknown", message: unanswered };
      // A batch invocation is nonempty, so the items tuple starts with the first call's answer and spreads the rest.
      const [first, ...rest] = calls.map((call, index) => ({
        target: { objectType: call.target.objectType, primaryKey: call.target.primaryKey },
        outcome: statusOutcome(answers.get(statuses[index]!)!, call.target.primaryKey),
      }));
      return { kind: "batch", items: [first!, ...rest] };
    },
  },
] satisfies readonly PanelServerOperation[];
