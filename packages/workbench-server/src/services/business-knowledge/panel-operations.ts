import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import {
  APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DATA_QUERY_GATEWAY, DELETE_KNOWLEDGE,
} from "@ontomato/contracts/panel-client-requests";
import { type PanelOperationCall, panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelBatchCalls, PanelImpactInspector, PanelOperationHost, PanelOperationTarget,
  PanelRecordTarget, PanelServerOperation, SinglePanelOperationOutcome,
} from "../product-panels/server-operations";

/*
 * The business knowledge owner as panel server operations: the form save the coordinator dispatches for a person's or an
 * agent's call, and the approve and delete actions, singly and as a batch. The owner answers through the data-query
 * service with its usual envelope; a `success:false` answer is the owner's refusal, while an HTTP failure is an
 * uncertain transport result. The owner keeps entries whole by domain and has no single read, so an action that needs
 * the entry reads the list it is kept in; approval rewrites the whole entry with status 1, as the owner has no patch
 * semantics. An entry's title names it in a confirmation. The owner has no batch endpoint either, so a batch runs each
 * call under its single rule and answers per call, and the delete's impact names the entries by title and count.
 */

const ownerEnvelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.unknown().optional(),
}).passthrough();

const savedIdSchema = z.object({ id: z.string().min(1) }).passthrough();
/** A create answers the stored entry's id; an update answers no data beyond the target it wrote. */
const savedResultSchema = z.object({ id: z.string().min(1).optional() }).passthrough();
const actionResultSchema = z.object({}).strict();
/** An entry as the owner keeps it; entries written before tags existed may have none. */
export const knowledgeEntrySchema = z.object({
  knowledgeID: z.string(),
  knowledgeTitle: z.string(),
  knowledgeText: z.string(),
  knowledgeTags: z.array(z.string()).nullish(),
  status: z.number(),
}).passthrough();
type KnowledgeEntry = z.infer<typeof knowledgeEntrySchema>;

const knowledgeObjectTarget = z.object({
  kind: z.literal("object"), objectType: z.literal(BUSINESS_KNOWLEDGE), primaryKey: z.string().min(1),
}).strict();
const saveTarget = z.discriminatedUnion("kind", [knowledgeObjectTarget, panelFormTargetSchema.options[1]]);
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const actionInputSchema = z.object({}).strict();

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

/** The entries the owner keeps for this domain, keyed as the owner keys them. */
async function readEntries(host: Host): Promise<Record<string, KnowledgeEntry>> {
  const response = await host.request(`${DATA_QUERY_GATEWAY}/admin/getBussinessKnowledge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const body = await response.json() as { message?: string; error?: { message?: string } } | null;
    throw new HttpError(response.status, body?.message ?? body?.error?.message ?? "The owner could not read the entries", "KNOWLEDGE_UNAVAILABLE");
  }
  const envelope = ownerEnvelopeSchema.parse(await response.json());
  if (!envelope.success) throw new HttpError(404, envelope.message ?? "The owner could not read the entries", "KNOWLEDGE_UNAVAILABLE");
  return z.record(z.string(), knowledgeEntrySchema).parse(envelope.data);
}

/** The entry as the owner keeps it, read from the whole-domain list; undefined when this domain does not have it. */
async function readEntry(host: Host, primaryKey: string) {
  return (await readEntries(host))[primaryKey];
}

/** The entry's title, as a confirmation names the target by. */
async function knowledgeTitle(host: Host, target: PanelRecordTarget): Promise<string> {
  const found = await readEntry(host, target.primaryKey);
  if (!found) throw new HttpError(404, `Business knowledge ${target.primaryKey} is not in this domain`, "KNOWLEDGE_UNAVAILABLE");
  return found.knowledgeTitle;
}

/**
 * The fields a save sends: when the caller names what it submitted, only those, so a field it left alone is not
 * changed, whatever value the form still shows for it. The owner keeps the rest as they are, or a new entry's defaults.
 */
function submittedValues({ values, submittedFields }: z.infer<typeof saveInputSchema>): Record<string, unknown> {
  if (submittedFields === undefined) return values;
  const fields = new Set(submittedFields.map(path => path.split("/")[1]!.replace(/~1/g, "/").replace(/~0/g, "~")));
  return Object.fromEntries(Object.entries(values).filter(([field]) => fields.has(field)));
}

/** A save writes the chosen target: a draft names no existing entry, and an update carries the target's id. */
function valuesForTarget(target: PanelOperationTarget, values: Record<string, unknown>): Record<string, unknown> {
  const id = values.knowledgeID;
  if (target.kind === "draft") {
    // The owner's own form fills an empty id for a draft; an id that names an entry belongs to an update.
    if (id !== undefined && id !== "") throw new HttpError(400, "A new entry cannot carry a knowledge id", "TARGET_ID_MISMATCH");
    return values;
  }
  if (id !== undefined && id !== target.primaryKey) throw new HttpError(400, "The values name another entry", "TARGET_ID_MISMATCH");
  return { ...values, knowledgeID: target.primaryKey };
}

/** The entry a write changed, and the one type whose list and count follow it. */
const affected = (primaryKey: string) => ({
  objects: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey }],
  objectTypes: [BUSINESS_KNOWLEDGE],
});

/** One approval under its single rule: the entry read from the domain's list, rewritten whole with status 1. */
async function approveOne(
  host: Host, entries: Record<string, KnowledgeEntry>, target: PanelRecordTarget,
): Promise<SinglePanelOperationOutcome> {
  const found = entries[target.primaryKey];
  if (!found) return {
    kind: "refusal", code: "KNOWLEDGE_APPROVE_REFUSED",
    message: `Business knowledge ${target.primaryKey} is not in this domain`,
  };
  const envelope = await ownerPost(host, "/admin/editBussinessKnowledge", { ...found, knowledgeTags: found.knowledgeTags ?? [], status: 1 });
  return envelope.success
    ? { kind: "success", data: {}, affected: affected(target.primaryKey) }
    : { kind: "refusal", code: "KNOWLEDGE_APPROVE_REFUSED", message: envelope.message ?? "The owner refused the approval" };
}

/** One delete under its single rule. */
async function deleteOne(host: Host, target: PanelRecordTarget): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, "/admin/delBussinessKnowledge", { knowledgeID: target.primaryKey });
  return envelope.success
    ? { kind: "success", data: {}, affected: affected(target.primaryKey) }
    : { kind: "refusal", code: "KNOWLEDGE_DELETE_REFUSED", message: envelope.message ?? "The owner refused the delete" };
}

/** A batch's per-call answers, each call under the single rule; a call with no authoritative answer marks its own call
 * unknown while the other calls' answers stand. */
async function batchAnswers(
  host: Host, calls: readonly PanelBatchCalls[number][], one: (call: PanelBatchCalls[number]) => Promise<SinglePanelOperationOutcome>,
): Promise<PanelOperationOutcome> {
  const answers = await Promise.all(calls.map(async call => ({
    target: { objectType: call.target.objectType, primaryKey: call.target.primaryKey },
    outcome: await one(call).catch((error: unknown) => ({
      kind: "unknown" as const, message: error instanceof Error ? error.message : String(error),
    })),
  })));
  // A batch invocation is nonempty, so the items tuple starts with the first call's answer and spreads the rest.
  const [first, ...rest] = answers;
  return { kind: "batch", items: [first!, ...rest] };
}

async function save(host: Host, target: PanelOperationTarget, values: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
  const create = target.kind === "draft";
  const envelope = await ownerPost(host, create ? "/admin/addBussinessKnowledge" : "/admin/editBussinessKnowledge", values);
  if (!envelope.success) return { kind: "refusal", code: "KNOWLEDGE_SAVE_REFUSED", message: envelope.message ?? "The owner refused the save" };
  if (create) {
    const data = runtimeJsonObjectSchema.parse(envelope.data);
    return { kind: "success", data, affected: affected(savedIdSchema.parse(data).id) };
  }
  return { kind: "success", data: {}, affected: affected(target.primaryKey) };
}

const formInstructions = "Read the knowledge form for the intended target. Use its fields, values and save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.";

/*
 * The delete's impact for a confirming human: which entries it takes, each under the title the owner lists it by, and
 * how many. An entry this domain no longer has is the owner's error, named as the label read names it.
 */
const deleteKnowledgeImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_KNOWLEDGE}.inspect-impact`,
  async inspect(host: PanelOperationHost, calls: readonly PanelOperationCall[]) {
    const entries = await readEntries(host);
    const objects = calls.map(call => {
      const { objectType, primaryKey } = call.target as PanelRecordTarget;
      const found = entries[primaryKey];
      if (!found) throw new HttpError(404, `Business knowledge ${primaryKey} is not in this domain`, "KNOWLEDGE_UNAVAILABLE");
      return { target: { objectType, primaryKey }, label: found.knowledgeTitle };
    });
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteKnowledgeImpact", { count: calls.length }),
      objects,
      total: calls.length,
    };
  },
};

export const m7ServerOperations = [
  {
    handlerRef: `${BUSINESS_KNOWLEDGE}.save`,
    labelKey: "panels.knowledge.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE },
    effect: "write",
    batch: false,
    targetType: BUSINESS_KNOWLEDGE,
    targetSchema: saveTarget,
    inputSchema: saveInputSchema,
    resultSchema: savedResultSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "knowledge.create" : "knowledge.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: BUSINESS_KNOWLEDGE, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, target, valuesForTarget(target, submittedValues(saveInputSchema.parse(input))));
    },
  },
  {
    handlerRef: APPROVE_KNOWLEDGE,
    labelKey: "panels.knowledge.approve",
    kind: "action",
    binding: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE },
    effect: "write",
    batch: true,
    targetType: BUSINESS_KNOWLEDGE,
    targetSchema: knowledgeObjectTarget,
    inputSchema: actionInputSchema,
    resultSchema: actionResultSchema,
    targetInput: "knowledge",
    targetLabel: knowledgeTitle,
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Approve acts on a selected entry");
      return approveOne(host, await readEntries(host), target);
    },
    async executeBatch(host: Host, calls: readonly PanelBatchCalls[number][]): Promise<PanelOperationOutcome> {
      // One read of the whole domain serves every call's rule, exactly as one read serves a single approval.
      const entries = await readEntries(host);
      return batchAnswers(host, calls, call => approveOne(host, entries, call.target));
    },
  },
  {
    handlerRef: DELETE_KNOWLEDGE,
    labelKey: "panels.knowledge.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE },
    effect: "write",
    batch: true,
    targetType: BUSINESS_KNOWLEDGE,
    targetSchema: knowledgeObjectTarget,
    inputSchema: actionInputSchema,
    resultSchema: actionResultSchema,
    targetInput: "knowledge",
    targetLabel: knowledgeTitle,
    inspectImpact: deleteKnowledgeImpact,
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected entry");
      return deleteOne(host, target);
    },
    async executeBatch(host: Host, calls: readonly PanelBatchCalls[number][]): Promise<PanelOperationOutcome> {
      return batchAnswers(host, calls, call => deleteOne(host, call.target));
    },
  },
] satisfies readonly PanelServerOperation[];
