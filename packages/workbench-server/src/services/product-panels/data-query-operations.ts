import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { DATA_QUERY_GATEWAY } from "@ontomato/contracts/panel-client-requests";
import { HttpError } from "../../utils/errors";
import type { PanelOperationHost, PanelOperationTarget, PanelRecordTarget, SinglePanelOperationOutcome } from "./server-operations";

export const ownerEnvelopeSchema = z.object({
  success: z.boolean(),
  message: z.string().nullish(),
  data: z.unknown().optional(),
}).passthrough();

export const savedIdSchema = z.object({ id: z.string().min(1) }).passthrough();
const labelSchema = z.object({ name: z.string() }).passthrough();
const ownerRefusalCodeSchema = z.string().min(1).max(200).optional();

export type DataQueryOperationHost = Pick<PanelOperationHost, "request">;

function requestOwnerPost(host: DataQueryOperationHost, path: string, body: unknown) {
  return host.request(`${DATA_QUERY_GATEWAY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function ownerPost<Envelope>(
  host: DataQueryOperationHost, path: string, body: unknown, schema: z.ZodType<Envelope>,
): Promise<Envelope> {
  const response = await requestOwnerPost(host, path, body);
  if (!response.ok) throw new HttpError(response.status, `Owner request failed: ${path}`, "OWNER_UNAVAILABLE");
  return schema.parse(await response.json());
}

/** The owner's record for one target; an unreadable target is the owner's error, never an id standing in for a name. */
export async function ownerRecord(host: DataQueryOperationHost, target: PanelRecordTarget, path: string, code: string): Promise<unknown> {
  const response = await requestOwnerPost(host, path, { id: target.primaryKey });
  if (!response.ok) {
    const body = await response.json() as { message?: string; error?: { message?: string } } | null;
    throw new HttpError(response.status, body?.message ?? body?.error?.message ?? "The owner could not read the target", code);
  }
  const envelope = ownerEnvelopeSchema.parse(await response.json());
  if (!envelope.success) throw new HttpError(404, envelope.message ?? "The owner could not read the target", code);
  return envelope.data;
}

export async function targetLabel(host: DataQueryOperationHost, target: PanelRecordTarget, path: string, code: string): Promise<string> {
  return labelSchema.parse(await ownerRecord(host, target, path, code)).name;
}

/** A save writes the chosen target: an existing id must match, and a new object carries none. */
export function valuesForTarget(target: PanelOperationTarget, values: Record<string, unknown>): Record<string, unknown> {
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
export const affected = (objectType: string, primaryKey: string, objectTypes: string[]) => ({
  objects: [{ objectType, primaryKey }], objectTypes,
});

/** Only an explicit owner code classifies a negative write receipt as a refusal. */
export function ownerWriteFailure(
  envelope: z.infer<typeof ownerEnvelopeSchema>, failureCode: string, fallbackMessage: string,
): Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }> {
  const code = ownerRefusalCodeSchema.parse(envelope.code);
  const message = envelope.message ?? fallbackMessage;
  return code === undefined ? { kind: "failure", code: failureCode, message } : { kind: "refusal", code, message };
}

export async function save(
  host: DataQueryOperationHost, path: string, values: unknown, failureCode: string, objectType: string, objectTypes: string[],
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, values, ownerEnvelopeSchema);
  if (!envelope.success) return ownerWriteFailure(envelope, failureCode, "The owner could not save the record");
  const data = runtimeJsonObjectSchema.parse(envelope.data);
  return { kind: "success", data, affected: affected(objectType, savedIdSchema.parse(data).id, objectTypes) };
}

export async function remove(
  host: DataQueryOperationHost, path: string, target: PanelRecordTarget, failureCode: string,
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, { id: target.primaryKey }, ownerEnvelopeSchema);
  return envelope.success
    ? { kind: "success", data: {}, affected: affected(target.objectType, target.primaryKey, [target.objectType]) }
    : ownerWriteFailure(envelope, failureCode, "The owner could not delete the record");
}
