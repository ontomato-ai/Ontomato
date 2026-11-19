import { z } from "zod";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { ACTION, DATA_QUERY_GATEWAY, DELETE_ACTION, FUNCTION, SET_ACTION_STATUS } from "@ontomato/contracts/panel-client-requests";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelBatchCalls, PanelImpactInspector, PanelOperationHost, PanelOperationTarget, PanelRecordTarget, PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";

/*
 * The action owner as panel server operations: the form save the coordinator dispatches for a person's or an agent's
 * call, the delete action with the impact its confirming human reads, and the batch change of an action's publication
 * status. The owner answers through the data-query service with its usual envelope; a `success:false` answer is the
 * owner's refusal, while an HTTP failure is an uncertain transport result. Saving an action may also change the write
 * function its definition embeds.
 */

const ownerEnvelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.unknown().optional(),
}).passthrough();

const savedIdSchema = z.object({ id: z.string().min(1) }).passthrough();
const deletedSchema = z.object({}).strict();
const labelSchema = z.object({ name: z.string() }).passthrough();
const statusInputSchema = z.object({ status: z.enum(["PENDING_REVIEW", "PUBLISHED", "UNUSED"]) }).strict();
/** The owner answers one status change per requested id, with the saved action or its reason. */
const statusItemSchema = z.discriminatedUnion("outcome", [
  z.object({ id: z.string().min(1), outcome: z.literal("success"), data: z.unknown() }).strict(),
  z.object({ id: z.string().min(1), outcome: z.literal("failure"), error: z.object({ message: z.string() }).strict() }).strict(),
]);
const statusAnswerSchema = z.object({ items: z.array(statusItemSchema).nonempty() }).strict();

const actionObjectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(ACTION), primaryKey: z.string().min(1),
}).strict();
const actionSaveTarget = z.discriminatedUnion("kind", [actionObjectTarget, panelFormTargetSchema.options[1]]);
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const deleteInputSchema = z.object({}).strict();

type Host = Pick<PanelOperationHost, "request">;

async function ownerPost(host: Host, path: string, body: unknown) {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new HttpError(response.status, `Owner request failed: ${path}`, "OWNER_UNAVAILABLE");
  return ownerEnvelopeSchema.parse(await response.json());
}

/** The owner's record for one target; an unreadable target is the owner's error, never an id standing in for a name. */
async function ownerRecord(host: Host, target: PanelRecordTarget, path: string, code: string): Promise<unknown> {
  const response = await host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: target.primaryKey }),
  });
  if (!response.ok) {
    const body = await response.json() as { message?: string; error?: { message?: string } } | null;
    throw new HttpError(response.status, body?.message ?? body?.error?.message ?? "The owner could not read the target", code);
  }
  const envelope = ownerEnvelopeSchema.parse(await response.json());
  if (!envelope.success) throw new HttpError(404, envelope.message ?? "The owner could not read the target", code);
  return envelope.data;
}

async function targetLabel(host: Host, target: PanelRecordTarget, path: string, code: string): Promise<string> {
  return labelSchema.parse(await ownerRecord(host, target, path, code)).name;
}

/** A save writes the chosen target: an existing id must match, and a new object carries none. */
function valuesForTarget(target: PanelOperationTarget, values: Record<string, unknown>): Record<string, unknown> {
  if (target.kind === "draft") {
    if (Object.hasOwn(values, "id"))
      throw new HttpError(400, "A new object cannot carry an id", "TARGET_ID_MISMATCH");
    return values;
  }
  if (Object.hasOwn(values, "id") && values.id !== target.primaryKey)
    throw new HttpError(400, "The values name another object", "TARGET_ID_MISMATCH");
  return { ...values, id: target.primaryKey };
}

/** The objects a write changed and the types whose lists and counts follow it. */
const affected = (objectType: string, primaryKey: string, objectTypes: string[]) => ({
  objects: [{ objectType, primaryKey }], objectTypes,
});

async function save(
  host: Host, path: string, values: unknown, refusalCode: string, objectType: string, objectTypes: string[],
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, values);
  if (!envelope.success) return { kind: "refusal", code: refusalCode, message: envelope.message ?? "The owner refused the save" };
  const data = runtimeJsonObjectSchema.parse(envelope.data);
  return { kind: "success", data, affected: affected(objectType, savedIdSchema.parse(data).id, objectTypes) };
}

async function remove(
  host: Host, path: string, target: PanelRecordTarget, refusalCode: string,
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, { id: target.primaryKey });
  return envelope.success
    ? { kind: "success", data: {}, affected: affected(target.objectType, target.primaryKey, [target.objectType]) }
    : { kind: "refusal", code: refusalCode, message: envelope.message ?? "The owner refused the delete" };
}

type StatusAnswer = { refused: string } | { items: Map<string, z.infer<typeof statusItemSchema>> };

/** One owner call: either its refusal for every requested id, or the owner's answer per id. */
async function changeStatus(host: Host, ids: string[], status: string): Promise<StatusAnswer> {
  const envelope = await ownerPost(host, "/action/setStatus", { ids, status });
  if (!envelope.success) return { refused: envelope.message ?? "The owner refused the status change" };
  return { items: new Map(statusAnswerSchema.parse(envelope.data).items.map(item => [item.id, item])) };
}

/** The owner's answer for one action: a success carries the saved action; a failure keeps the owner's reason. */
function statusOutcome(answer: StatusAnswer, id: string): SinglePanelOperationOutcome {
  if ("refused" in answer) return { kind: "refusal", code: "ACTION_STATUS_REFUSED", message: answer.refused };
  const item = answer.items.get(id)!;
  if (item.outcome !== "success") return { kind: "refusal", code: "ACTION_STATUS_REFUSED", message: item.error.message };
  const data = runtimeJsonObjectSchema.parse(item.data);
  return { kind: "success", data, affected: affected(ACTION, savedIdSchema.parse(data).id, [ACTION]) };
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

const formInstructions = "Read the form for the intended target. Use its fields, values and save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.";

export const m6ServerOperations = [
  {
    handlerRef: `${ACTION}.save`,
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ACTION },
    effect: "write",
    batch: false,
    targetType: ACTION,
    targetSchema: actionSaveTarget,
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "action.create" : "action.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: ACTION, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/action/save", valuesForTarget(target, saveInputSchema.parse(input).values),
        "ACTION_SAVE_REFUSED", ACTION, [ACTION, FUNCTION]);
    },
  },
  {
    handlerRef: DELETE_ACTION,
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
    inspectImpact: deleteActionImpact,
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected action");
      return remove(host, "/action/delete", target, "ACTION_DELETE_REFUSED");
    },
  },
  {
    handlerRef: SET_ACTION_STATUS,
    kind: "action",
    binding: { kind: "PlatformOperation", id: SET_ACTION_STATUS },
    effect: "write",
    batch: true,
    targetType: ACTION,
    targetSchema: actionObjectTarget,
    inputSchema: statusInputSchema,
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
      // status and every call reads its own answer.
      const statuses = calls.map(call => statusInputSchema.parse(call.input).status);
      const answers = new Map<string, StatusAnswer>();
      for (const status of new Set(statuses))
        answers.set(status, await changeStatus(host, calls.filter((_, index) => statuses[index] === status)
          .map(call => call.target.primaryKey), status));
      // A batch invocation is nonempty, so the items tuple starts with the first call's answer and spreads the rest.
      const [first, ...rest] = calls.map((call, index) => ({
        target: { objectType: call.target.objectType, primaryKey: call.target.primaryKey },
        outcome: statusOutcome(answers.get(statuses[index]!)!, call.target.primaryKey),
      }));
      return { kind: "batch", items: [first!, ...rest] };
    },
  },
] satisfies readonly PanelServerOperation[];
