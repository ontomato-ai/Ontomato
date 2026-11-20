import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { actionFormSchema, type ActionForm } from "@ontomato/contracts/action-forms";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import type { PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import {
  panelOwnerOperationDescriptorSchema, type panelOwnerOperationTargetSchema,
} from "@ontomato/contracts/panel-operations";
import { HttpError } from "../../utils/errors";
import {
  affected, ownerEnvelopeSchema, ownerPost, ownerWriteFailure, type DataQueryOperationHost as Host,
} from "../product-panels/data-query-operations";
import type { PanelWriteServerOperation, SinglePanelOperationOutcome } from "../product-panels/server-operations";

/*
 * A published business Action executed on one customer object. Every Action shares the `actions.execute` handler; the
 * Action and the object it acts on are resolved from the data engine and bound into the operation built for them. The
 * data engine's `/action/form` is the authority on whether this Action may run for this caller (it exists in the
 * caller's domain, is published and executable, and is granted); `/action/queryById` only supplies its name, target
 * and code hash. The Action's parameters are its own: which are required and whether a value is valid is answered by
 * the owner when the values are submitted, never checked here.
 */

export const ACTIONS_EXECUTE = "actions.execute";

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
  /** The Action's form as it opens for this object, with the key parameter bound and read-only. */
  form: ActionForm;
}

type OwnerOperationTarget = z.infer<typeof panelOwnerOperationTargetSchema>;
type OwnerEnvelope = z.infer<typeof ownerEnvelopeSchema>;

const storedActionSchema = z.object({
  name: z.string().min(1),
  codeHash: z.string().min(1),
  target: z.object({ className: z.string().min(1), keyParameter: z.string().min(1) }).passthrough().nullable(),
}).passthrough();
const executedSchema = z.object({
  result: z.string().nullable(),
  affects: z.array(z.string()),
}).passthrough();

export const objectActionResultSchema = z.object({
  result: z.string().nullable(),
  affects: z.array(z.string()),
}).strict();
const objectActionInputSchema = z.object({ values: z.record(z.string(), z.string()) }).strict();

/** An owner code that denies the caller is a forbidden read; one that finds nothing is a missing one; the rest conflict. */
function readStatus(code: string): number {
  if (code === "ACTION_NOT_GRANTED") return 403;
  if (code === "ACTION_NOT_FOUND") return 404;
  return 409;
}

/** A negative owner answer to a read, in the owner's words and with the owner's code when it gave one. */
function readRefusal(envelope: OwnerEnvelope, failureCode: string, fallbackMessage: string): HttpError {
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
  const action = storedActionSchema.parse(stored.data);
  if (action.target === null)
    throw new HttpError(409, "This action does not act on an object", "ACTION_NOT_OBJECT_ACTION");
  if (action.target.className !== selection.object.objectType)
    throw new HttpError(409, "This action acts on another object type", "ACTION_TARGET_MISMATCH");
  const located = { actionId: selection.actionId, keyParameter: action.target.keyParameter, object: selection.object };
  const opened = await actionForm(host, located);
  if (!opened.success) throw readRefusal(opened, "ACTION_FORM_FAILED", "The owner could not open the action form");
  return { ...located, codeHash: action.codeHash, name: action.name, form: actionFormSchema.parse(opened.data) };
}

/** The values the Action's current definition asks for, as its reader and an agent see them; the owner still judges. */
function describedInputSchema(resolved: ResolvedObjectAction) {
  const fields = resolved.form.fields.filter(field => field.key !== resolved.keyParameter);
  return {
    type: "object",
    properties: {
      values: {
        type: "object",
        properties: Object.fromEntries(fields.map(field => [field.key, { type: "string", title: field.label }])),
        required: fields.filter(field => field.required).map(field => field.key),
        additionalProperties: false,
      },
    },
    required: ["values"],
    additionalProperties: false,
  };
}

export function describeObjectAction(resolved: ResolvedObjectAction, target: OwnerOperationTarget) {
  return panelOwnerOperationDescriptorSchema.parse({
    handlerRef: ACTIONS_EXECUTE,
    label: resolved.name,
    effect: "write",
    target,
    inputSchema: describedInputSchema(resolved),
    resultSchema: zodToJsonSchema(objectActionResultSchema, { effectStrategy: "input" }),
    batch: false,
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

export function objectActionOperation(resolved: ResolvedObjectAction, targetInput: string) {
  const { objectType, primaryKey } = resolved.object;
  return {
    handlerRef: ACTIONS_EXECUTE,
    binding: { kind: "Action", id: resolved.actionId },
    kind: "action",
    effect: "write",
    batch: false,
    targetType: objectType,
    targetInput,
    targetSchema: z.object({
      kind: z.literal("object"), objectType: z.literal(objectType), primaryKey: z.literal(primaryKey),
    }).strict(),
    inputSchema: objectActionInputSchema,
    resultSchema: objectActionResultSchema,
    // Provisional until M4's customer-object record read gives the object's label; not the confirmation name to ship.
    targetLabel: async () => primaryKey,
    execute: (host, _target, input) => execute(host, resolved, objectActionInputSchema.parse(input).values),
  } satisfies PanelWriteServerOperation;
}
