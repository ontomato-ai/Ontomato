import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { FUNCTION } from "@ontomato/contracts/panel-client-requests";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { valuesForTarget } from "./target-values";
import {
  PlatformObjectRefusal,
  type PlatformObjectAdapterFactory,
  type PlatformObjectRecord,
  type PlatformRequests,
} from "./platform-objects";

/*
 * The functions as a platform object: the owner's list and single reads, its typed form for one target, and the save
 * that writes the whole asset back. The owner answers through the data-query service with its usual envelope
 * `{success, data | code, message, errors?}`. A form read carries the owner's field errors in its description; a save
 * the owner refuses at a field names it by the same JSON Pointer.
 */

interface FunctionAsset {
  id: string;
  name: string;
  description?: string | null;
  operation?: string | null;
  operationLabel?: string | null;
}

interface OwnerEnvelope {
  success: boolean;
  message?: string | null;
  data?: unknown;
  errors?: readonly { field: string; code: string; message: string }[];
}

function envelopeOf(value: unknown): OwnerEnvelope {
  const envelope = runtimeJsonObjectSchema.parse(value);
  if (typeof envelope.success !== "boolean") throw new Error("The function owner response carries no success flag");
  return envelope as unknown as OwnerEnvelope;
}

function assetOf(value: unknown): FunctionAsset {
  const asset = runtimeJsonObjectSchema.parse(value);
  if (typeof asset.id !== "string" || typeof asset.name !== "string")
    throw new Error("The function owner returned no id and name");
  return asset as unknown as FunctionAsset;
}

function assetsOf(value: unknown): FunctionAsset[] {
  if (!Array.isArray(value)) throw new Error("The function owner returned no list");
  return value.map(assetOf);
}

function refusal(envelope: OwnerEnvelope): never {
  throw new PlatformObjectRefusal(
    envelope.message ?? "The function owner refused the request",
    Object.fromEntries((envelope.errors ?? []).map(error => [error.field, error.message])),
  );
}

async function ownerRequest(requests: PlatformRequests, path: string, body: unknown): Promise<unknown> {
  const response = await requests.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, "/data-query");
  const envelope = envelopeOf(await response.json());
  if (!envelope.success) refusal(envelope);
  return envelope.data;
}

/** The function as a list shows it; the operation label is the owner's, with its raw value for a single read. */
function record(fn: FunctionAsset): PlatformObjectRecord {
  return {
    primaryKey: fn.id,
    label: fn.name,
    ...(fn.description ? { subtitle: fn.description } : {}),
    fields: { operation: fn.operationLabel ?? "" },
  };
}

export const functionAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    return assetsOf(await ownerRequest(requests, "/function/queryList", {})).map(record);
  }
  return [{
    objectType: FUNCTION,
    list,
    async query({ search }) {
      const all = await list();
      const term = search?.trim().toLowerCase();
      const items = term
        ? all.filter(item => `${item.label} ${item.subtitle ?? ""}`.toLowerCase().includes(term))
        : all;
      return { items, total: items.length };
    },
    async read(primaryKey) {
      return record(assetOf(await ownerRequest(requests, "/function/queryById", { id: primaryKey })));
    },
    forms: {
      async describe(request) {
        return panelFormDescriptionSchema.parse(await ownerRequest(requests, "/function/form", request));
      },
      async save(target, { values, submittedFields }) {
        // Submitted fields go with the values, so the owner changes only those and keeps every other saved value.
        const body = { ...valuesForTarget(target, values), ...(submittedFields && { submittedFields }) };
        return record(assetOf(await ownerRequest(requests, "/function/save", body)));
      },
    },
  }];
};
