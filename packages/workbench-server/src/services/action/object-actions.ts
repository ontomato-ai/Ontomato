import { z } from "zod";
import { actionFormSchema } from "@ontomato/contracts/action-forms";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import {
  describePanelOperationFromDeclaration, type PanelOperationDeclaration,
} from "@ontomato/contracts/panel-operations";
import { HttpError } from "../../utils/errors";
import { cachedZodToRuntimeJsonSchema } from "../../utils/zod-json-schema";
import { createCustomerOntologyReadAdapter } from "../ontology-model/customer-reads";
import {
  affected, ownerEnvelopeSchema, ownerPost, ownerWriteFailure, type DataQueryOperationHost as Host,
} from "../product-panels/data-query-operations";
import type { PanelWriteServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";

/*
 * A published business Action executed on one customer object. Every Action shares the `actions.execute` handler; the
 * Action and the object it acts on are resolved from the data engine and bound into the operation built for them. The
 * data engine's `/action/form` is the authority on whether this Action may run for this caller (it exists in the
 * caller's domain, is published and executable, and is granted); `/action/queryById` only supplies its name, target,
 * code hash and parameters. The Action's parameters are its own: an author's catalogue and a reader's description both
 * declare them from the stored definition through `objectActionDeclaration`, and whether a value is valid is answered by
 * the owner when the values are submitted, never checked here.
 */

export const ACTIONS_EXECUTE = "actions.execute";
/** The logical input that carries the object an Action runs on, in its declaration and in a projection's params. */
export const OBJECT_ACTION_TARGET = "target";

export interface ObjectActionSelection {
  actionId: string;
  object: PanelObjectIdentity;
}

export interface ResolvedObjectAction {
  actionId: string;
  codeHash: string;
  name: string;
  /** The Action parameter that carries the target object's primary key. */
  keyParameter: string;
  object: PanelObjectIdentity;
  declaration: PanelOperationDeclaration;
}

type OwnerEnvelope = z.infer<typeof ownerEnvelopeSchema>;

/** The stored fields an object Action is declared and resolved from; the rest of the stored Action is not read. */
export const storedObjectActionSchema = z.object({
  id: z.string().min(1),
  // The name is what a person and an agent call the operation by: a blank one names nothing.
  name: z.string().regex(/\S/, "The action has no name"),
  codeHash: z.string().min(1),
  target: z.object({ className: z.string().min(1), keyParameter: z.string().min(1) }).passthrough().nullable(),
  function: z.object({
    parameters: z.array(z.object({
      name: z.string().min(1), type: z.string().min(1), description: z.string().nullish(),
    }).passthrough()),
  }).passthrough(),
}).passthrough();
type StoredObjectAction = z.infer<typeof storedObjectActionSchema>;
type ObjectTarget = NonNullable<StoredObjectAction["target"]>;

/** Parameter types the owner's form takes as typed text rather than as JSON. */
const TEXT_PARAMETER_TYPES = new Set(["TYPE_STRING", "TYPE_TIME"]);
const executedSchema = z.object({
  result: z.string().nullable(),
  affects: z.array(z.string()),
}).passthrough();

export const objectActionResultSchema = z.object({
  result: z.string().nullable(),
  affects: z.array(z.string()),
}).strict();
const objectActionResultJsonSchema = cachedZodToRuntimeJsonSchema(
  objectActionResultSchema,
  { effectStrategy: "input" },
);
const objectActionInputSchema = z.object({ values: z.record(z.string(), z.string()) }).strict();

/** An owner code that denies the caller is a forbidden read; one that finds nothing is a missing one; the rest conflict. */
function readStatus(code: string): number {
  if (code === "ACTION_NOT_GRANTED") return 403;
  if (code === "ACTION_NOT_FOUND") return 404;
  return 409;
}

/** A negative owner answer to a read, in the owner's words and with the owner's code when it gave one. */
export function readRefusal(envelope: OwnerEnvelope, failureCode: string, fallbackMessage: string): HttpError {
  const outcome = ownerWriteFailure(envelope, failureCode, fallbackMessage);
  return new HttpError(outcome.kind === "failure" ? 500 : readStatus(outcome.code), outcome.message, outcome.code);
}

/** The opening form, or with values the owner's field errors or typed parameters, for the bound object. */
async function actionForm(host: Host, resolved: Pick<ResolvedObjectAction, "actionId" | "keyParameter" | "object">,
  values?: Record<string, string>) {
  return ownerPost(host, "/action/form", {
    id: resolved.actionId,
    parameters: { [resolved.keyParameter]: resolved.object.primaryKey },
    readOnlyParameters: [resolved.keyParameter],
    ...(values && { values }),
  }, ownerEnvelopeSchema);
}

export async function resolveObjectAction(host: Host, selection: ObjectActionSelection): Promise<ResolvedObjectAction> {
  const stored = await ownerPost(host, "/action/queryById", { id: selection.actionId }, ownerEnvelopeSchema);
  if (!stored.success) throw readRefusal(stored, "ACTION_READ_FAILED", "The owner could not read the action");
  if (stored.data == null) throw new HttpError(404, "The action does not exist", "ACTION_NOT_FOUND");
  const action = storedObjectActionSchema.parse(stored.data);
  const { target } = action;
  if (target === null)
    throw new HttpError(409, "This action does not act on an object", "ACTION_NOT_OBJECT_ACTION");
  if (target.className !== selection.object.objectType)
    throw new HttpError(409, "This action acts on another object type", "ACTION_TARGET_MISMATCH");
  const located = { actionId: selection.actionId, keyParameter: target.keyParameter, object: selection.object };
  // The owner's form admits this caller to run this Action now; its fields are the declaration's, so only the answer counts.
  const opened = await actionForm(host, located);
  if (!opened.success) throw readRefusal(opened, "ACTION_FORM_FAILED", "The owner could not open the action form");
  return {
    ...located, codeHash: action.codeHash, name: action.name, declaration: objectActionDeclaration({ ...action, target }),
  };
}

/**
 * The static operation an object Action declares, from its stored definition alone: one text value per parameter other
 * than the key the target binds, JSON text for a non-text type, none required (the owner's form marks none). Nothing in
 * it depends on an object, a caller's grants or the code; the owner judges the values when they are submitted.
 */
export function objectActionDeclaration(
  action: Pick<StoredObjectAction, "id" | "function"> & { target: ObjectTarget },
): PanelOperationDeclaration {
  const parameters = action.function.parameters.filter(parameter => parameter.name !== action.target.keyParameter);
  return {
    id: action.id,
    kind: "action",
    effect: "write",
    target: { source: "input", input: OBJECT_ACTION_TARGET },
    batch: false,
    inputSchema: {
      type: "object",
      properties: {
        values: {
          type: "object",
          properties: Object.fromEntries(parameters.map(parameter => [parameter.name, {
            type: "string",
            title: parameter.name,
            ...(parameter.description ? { description: parameter.description } : {}),
            ...(TEXT_PARAMETER_TYPES.has(parameter.type) ? {} : { contentMediaType: "application/json" }),
          }])),
          additionalProperties: false,
        },
      },
      required: ["values"],
      additionalProperties: false,
    },
  };
}

export function describeObjectAction(resolved: ResolvedObjectAction) {
  return describePanelOperationFromDeclaration(resolved.declaration, {
    handlerRef: ACTIONS_EXECUTE,
    label: resolved.name,
    resultSchema: objectActionResultJsonSchema,
  });
}

async function execute(host: Host, resolved: ResolvedObjectAction, values: Record<string, string>): Promise<SinglePanelOperationOutcome> {
  const checked = await actionForm(host, resolved, values);
  if (!checked.success) return ownerWriteFailure(checked, "ACTION_EXECUTE_FAILED", "The owner could not check the values");
  const form = actionFormSchema.parse(checked.data);
  if (form.errors.length)
    return { kind: "refusal", code: "ACTION_INPUT_INVALID", message: form.errors[0].message, errors: form.errors };
  if (form.parameters === null)
    return { kind: "failure", code: "ACTION_EXECUTE_FAILED", message: "The owner returned no parameters for valid values" };
  const body = new FormData();
  body.set("id", resolved.actionId);
  body.set("param", JSON.stringify(form.parameters));
  const response = await host.request(`${DATA_QUERY_GATEWAY}/action/execute`, { method: "POST", body });
  if (!response.ok) throw new HttpError(response.status, "Owner request failed: /action/execute", "OWNER_UNAVAILABLE");
  const envelope = ownerEnvelopeSchema.parse(await response.json());
  if (!envelope.success) return ownerWriteFailure(envelope, "ACTION_EXECUTE_FAILED", "The owner could not execute the action");
  const executed = executedSchema.parse(envelope.data);
  const { objectType, primaryKey } = resolved.object;
  return {
    kind: "success",
    data: { result: executed.result, affects: executed.affects },
    affected: affected(objectType, primaryKey, [...new Set([objectType, ...executed.affects])]),
  };
}

export function objectActionOperation(resolved: ResolvedObjectAction) {
  const { objectType, primaryKey } = resolved.object;
  return {
    handlerRef: ACTIONS_EXECUTE,
    binding: { kind: "Action", id: resolved.actionId },
    kind: "action",
    effect: "write",
    batch: false,
    targetType: objectType,
    targetInput: OBJECT_ACTION_TARGET,
    targetSchema: z.object({
      kind: z.literal("object"), objectType: z.literal(objectType), primaryKey: z.literal(primaryKey),
    }).strict(),
    inputSchema: objectActionInputSchema,
    resultSchema: objectActionResultSchema,
    // The object's name as the confirming person reads it; the customer ontology owner answers a refusal or a missing one.
    targetLabel: async host =>
      (await createCustomerOntologyReadAdapter(host.initiator.owner, host.initiator.credentials).record(objectType, primaryKey)).label,
    execute: (host, _target, input) => execute(host, resolved, objectActionInputSchema.parse(input).values),
  } satisfies PanelWriteServerOperation;
}
