import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { ACTION } from "@ontomato/contracts/platform-object-types";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { valuesForTarget } from "./target-values";
import {
  PlatformObjectRefusal,
  type PlatformObjectAdapterFactory,
  type PlatformObjectRecord,
  type PlatformRequests,
} from "./platform-objects";

/*
 * The actions as a platform object: the owner's list and single reads, its typed form for one target, and the save
 * that writes the whole asset back. The owner answers through the data-query service with its usual envelope
 * `{success, data | message, fields?}`; a refusal names the form fields as JSON Pointers.
 */

interface ActionAsset {
  id: string;
  name: string;
  description?: string | null;
  statusLabel?: string | null;
  originLabel?: string | null;
  createdByName?: string | null;
  reviewedByName?: string | null;
  function?: { name?: string | null } | null;
}

interface OwnerEnvelope {
  success: boolean;
  message?: string | null;
  data?: unknown;
  fields?: readonly { field: string; code: string; message: string }[];
}

function envelopeOf(value: unknown): OwnerEnvelope {
  const envelope = runtimeJsonObjectSchema.parse(value);
  if (typeof envelope.success !== "boolean") throw new Error("The action owner response carries no success flag");
  return envelope as unknown as OwnerEnvelope;
}

function assetOf(value: unknown): ActionAsset {
  const asset = runtimeJsonObjectSchema.parse(value);
  if (typeof asset.id !== "string" || typeof asset.name !== "string")
    throw new Error("The action owner returned no id and name");
  return asset as unknown as ActionAsset;
}

function assetsOf(value: unknown): ActionAsset[] {
  if (!Array.isArray(value)) throw new Error("The action owner returned no list");
  return value.map(assetOf);
}

function refusal(envelope: OwnerEnvelope): never {
  throw new PlatformObjectRefusal(
    envelope.message ?? "The action owner refused the request",
    Object.fromEntries((envelope.fields ?? []).map(field => [field.field, field.message])),
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

/** The action as a list shows it; the labels are the owner's, with its raw value for a single read. */
function record(action: ActionAsset): PlatformObjectRecord {
  return {
    primaryKey: action.id,
    label: action.name,
    ...(action.description ? { subtitle: action.description } : {}),
    fields: {
      status: action.statusLabel ?? "",
      origin: action.originLabel ?? "",
      createdBy: action.createdByName ?? "",
      reviewedBy: action.reviewedByName ?? "",
      function: action.function?.name ?? "",
    },
  };
}

export const actionAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    return assetsOf(await ownerRequest(requests, "/action/queryList", {})).map(record);
  }
  return [{
    objectType: ACTION,
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
      return record(assetOf(await ownerRequest(requests, "/action/queryById", { id: primaryKey })));
    },
    forms: {
      async describe(request) {
        return panelFormDescriptionSchema.parse(await ownerRequest(requests, "/action/definitionForm", request));
      },
      async save(target, { values }) {
        return record(assetOf(await ownerRequest(requests, "/action/save", valuesForTarget(target, values))));
      },
    },
  }];
};
