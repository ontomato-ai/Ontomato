import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { METRIC_VIEW } from "@ontomato/contracts/panel-client-requests";
import { panelFormDescriptionSchema } from "@ontomato/contracts/panel-projection";
import { valuesForTarget } from "./target-values";
import {
  PlatformObjectRefusal,
  type PlatformObjectAdapterFactory,
  type PlatformObjectRecord,
  type PlatformRequests,
} from "./platform-objects";

/*
 * The metrics as a platform object: the owner's list and single reads, its typed form for one target, and the save that
 * writes the whole asset back. The owner answers through the data-query service with its usual envelope
 * `{success, data | message, fields?}`; a refusal names the form fields as JSON Pointers.
 */

interface MetricViewAsset {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  origin?: string | null;
  originLabel?: string | null;
  function?: { name?: string | null } | null;
  createdBy?: string | null;
  createdByName?: string | null;
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  modifyTimestamp?: number | null;
}

interface OwnerEnvelope {
  success: boolean;
  message?: string | null;
  data?: unknown;
  fields?: readonly { field: string; code: string; message: string }[];
}

function envelopeOf(value: unknown): OwnerEnvelope {
  const envelope = runtimeJsonObjectSchema.parse(value);
  if (typeof envelope.success !== "boolean") throw new Error("The metric owner response carries no success flag");
  return envelope as unknown as OwnerEnvelope;
}

function assetOf(value: unknown): MetricViewAsset {
  const asset = runtimeJsonObjectSchema.parse(value);
  if (typeof asset.id !== "string" || typeof asset.name !== "string")
    throw new Error("The metric owner returned no id and name");
  return asset as unknown as MetricViewAsset;
}

function assetsOf(value: unknown): MetricViewAsset[] {
  if (!Array.isArray(value)) throw new Error("The metric owner returned no list");
  return value.map(assetOf);
}

function refusal(envelope: OwnerEnvelope): never {
  throw new PlatformObjectRefusal(
    envelope.message ?? "The metric owner refused the request",
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

/** The metric as a list or summary shows it; the labels are the owner's, with its raw value for a single read. */
function record(metric: MetricViewAsset): PlatformObjectRecord {
  const status = metric.status ?? "";
  return {
    primaryKey: metric.id,
    label: metric.name,
    ...(metric.description ? { subtitle: metric.description } : {}),
    fields: {
      function: metric.function?.name ?? "",
      origin: metric.originLabel ?? "",
      status: metric.statusLabel ?? "",
      createdBy: metric.createdByName ?? "",
      reviewedBy: metric.reviewedByName ?? "",
      modified: typeof metric.modifyTimestamp === "number" ? new Date(metric.modifyTimestamp).toLocaleString() : "",
    },
    tones: {
      status: status === "PUBLISHED" ? "success" : status === "PENDING_REVIEW" ? "warning" : "default",
    },
  };
}

export const metricViewAdapters: PlatformObjectAdapterFactory = requests => {
  async function list() {
    return assetsOf(await ownerRequest(requests, "/metricView/queryList", {})).map(record);
  }
  return [{
    objectType: METRIC_VIEW,
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
      return record(assetOf(await ownerRequest(requests, "/metricView/queryById", { id: primaryKey })));
    },
    forms: {
      async describe(request) {
        return panelFormDescriptionSchema.parse(await ownerRequest(requests, "/metricView/form", request));
      },
      async save(target, { values }) {
        return record(assetOf(await ownerRequest(requests, "/metricView/save", valuesForTarget(target, values))));
      },
    },
  }];
};
