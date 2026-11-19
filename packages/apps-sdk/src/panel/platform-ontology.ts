import { ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE } from "@ontomato/contracts/platform-object-types";
import type {
  PlatformGraphNeighborsQuery,
  PlatformGraphNeighborsResult,
  PlatformGraphNode,
  PlatformGraphRelationKindSpec,
  PlatformGraphSchema,
  PlatformGraphStatus,
  PlatformGraphTypeCount,
  PlatformGraphTypeSpec,
  PlatformObjectAdapter,
  PlatformObjectAdapterFactory,
  PlatformObjectGraph,
  PlatformObjectQuery,
  PlatformObjectQueryResult,
  PlatformObjectRecord,
  PlatformRequests,
} from "./platform-objects";

const base = "/platform-ontology";

export interface PlatformOntologyObjectsQuery {
  readonly type: string;
  readonly keyword?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface PlatformOntologyObjectItem {
  readonly node: { readonly className: string; readonly primaryKey: string };
  readonly label: string;
  readonly detail?: string;
}

export interface PlatformOntologyObjectsResult {
  readonly type: string;
  readonly layer: string;
  readonly status: PlatformGraphStatus;
  readonly reason?: string;
  readonly items: readonly PlatformOntologyObjectItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** Full client over the five read-only `/platform-ontology/*` endpoints. */
export interface PlatformOntologyClient extends Required<PlatformObjectGraph> {
  objects(query: PlatformOntologyObjectsQuery): Promise<PlatformOntologyObjectsResult>;
}

async function readJson<T>(
  requests: PlatformRequests,
  path: string,
  init: NonNullable<Parameters<typeof fetch>[1]>,
): Promise<T> {
  const response = await requests.request(path, init, "");
  const body = await response.json();
  if (!response.ok) {
    const err = body as { error?: string | { message?: string }; message?: string } | null;
    const message =
      (typeof err?.error === "string" ? err.error : err?.error?.message)
      ?? err?.message
      ?? `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

/**
 * Builds the read-only platform ontology client over the panel frame's request path.
 * Sends only the five `/platform-ontology/*` requests declared in `@ontomato/contracts/panel-client-requests`
 * for `ONTOLOGY_TYPE` and `ONTOLOGY_RELATION_KIND`.
 */
export function createPlatformOntologyClient(requests: PlatformRequests): PlatformOntologyClient {
  let pendingSchema: Promise<PlatformGraphSchema> | undefined;

  const schema = () =>
    (pendingSchema ??= readJson<PlatformGraphSchema>(requests, `${base}/schema`, { method: "GET" }).finally(() => {
      pendingSchema = undefined;
    }));

  const counts = async (): Promise<readonly PlatformGraphTypeCount[]> => {
    const body = await readJson<{ counts: readonly PlatformGraphTypeCount[] }>(requests, `${base}/counts`, {
      method: "GET",
    });
    return body.counts;
  };

  const start = async (): Promise<PlatformGraphNode | null> => {
    const body = await readJson<{
      node?: { className: string; primaryKey: string; label?: string; layer?: string; detail?: string } | null;
      label?: string;
      layer?: string;
      detail?: string;
    } | null>(requests, `${base}/start`, { method: "GET" });
    if (!body?.node) return null;
    const layer = body.node.layer ?? body.layer;
    const detail = body.node.detail ?? body.detail;
    return {
      className: body.node.className,
      primaryKey: body.node.primaryKey,
      label: body.node.label ?? body.label ?? body.node.primaryKey,
      ...(layer ? { layer } : {}),
      ...(detail ? { detail } : {}),
    };
  };

  const neighbors = (query: PlatformGraphNeighborsQuery): Promise<PlatformGraphNeighborsResult> =>
    readJson<PlatformGraphNeighborsResult>(requests, `${base}/neighbors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        node: { className: query.node.className, primaryKey: query.node.primaryKey },
        ...(query.relationKinds ? { relationKinds: [...query.relationKinds] } : {}),
        ...(query.layers ? { layers: [...query.layers] } : {}),
      }),
    });

  const objects = (query: PlatformOntologyObjectsQuery): Promise<PlatformOntologyObjectsResult> =>
    readJson<PlatformOntologyObjectsResult>(requests, `${base}/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: query.type,
        ...(query.keyword ? { keyword: query.keyword } : {}),
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
      }),
    });

  return { schema, counts, start, neighbors, objects };
}

function typeRecord(spec: PlatformGraphTypeSpec): PlatformObjectRecord {
  return {
    primaryKey: spec.id,
    label: spec.label ?? spec.labelKey ?? spec.id,
    fields: {
      id: spec.id,
      ...(spec.layer ? { layer: spec.layer } : {}),
      ...(spec.labelKey ? { labelKey: spec.labelKey } : {}),
    },
  };
}

function relationKindRecord(spec: PlatformGraphRelationKindSpec): PlatformObjectRecord {
  const target = Array.isArray(spec.to) ? spec.to.join(",") : spec.to;
  return {
    primaryKey: spec.id,
    label: spec.label ?? spec.labelKey ?? spec.id,
    fields: {
      id: spec.id,
      from: spec.from,
      to: target,
      derived: String(Boolean(spec.derived)),
      ...(spec.labelKey ? { labelKey: spec.labelKey } : {}),
    },
  };
}

function objectItemRecord(item: PlatformOntologyObjectItem): PlatformObjectRecord {
  return {
    primaryKey: item.node.primaryKey,
    className: item.node.className,
    label: item.label,
    ...(item.detail ? { subtitle: item.detail } : {}),
    fields: {
      className: item.node.className,
      primaryKey: item.node.primaryKey,
      ...(item.detail ? { detail: item.detail } : {}),
    },
  };
}

function queryTypeSpecs(
  specs: readonly PlatformGraphTypeSpec[],
  query: PlatformObjectQuery,
): PlatformObjectQueryResult {
  const search = query.search?.trim().toLowerCase();
  const layer = query.filters?.layer?.trim();
  const matched = specs.filter((spec) => {
    if (layer && spec.layer !== layer) return false;
    if (!search) return true;
    return (
      spec.id.toLowerCase().includes(search)
      || (spec.label ?? "").toLowerCase().includes(search)
      || (spec.labelKey ?? "").toLowerCase().includes(search)
    );
  });
  const offset = query.page?.offset ?? 0;
  const limit = query.page?.limit ?? matched.length;
  const slice = matched.slice(offset, offset + limit);
  return {
    items: slice.map(typeRecord),
    total: matched.length,
    status: "ok",
  };
}

/**
 * Resource adapters for `platform:OntologyType` and `platform:OntologyRelationKind`, sharing one read-only
 * `/platform-ontology/*` client.
 */
export const platformOntologyAdapters: PlatformObjectAdapterFactory = (
  requests: PlatformRequests,
): readonly PlatformObjectAdapter[] => {
  const client = createPlatformOntologyClient(requests);
  const graph: PlatformObjectGraph = {
    schema: client.schema,
    counts: client.counts,
    start: client.start,
    neighbors: client.neighbors,
  };

  return [
    {
      objectType: ONTOLOGY_TYPE,
      async list() {
        return (await client.schema()).objectTypes.map(typeRecord);
      },
      async query(query: PlatformObjectQuery): Promise<PlatformObjectQueryResult> {
        const targetType = query.objectType?.trim() || query.filters?.type?.trim();
        if (!targetType) {
          return queryTypeSpecs((await client.schema()).objectTypes, query);
        }
        const pageSize = query.page?.limit && query.page.limit > 0 ? query.page.limit : 20;
        const page = query.page?.offset !== undefined ? Math.floor(query.page.offset / pageSize) + 1 : 1;
        const result = await client.objects({
          type: targetType,
          ...(query.search?.trim() ? { keyword: query.search.trim() } : {}),
          page,
          pageSize,
        });
        if (result.status !== "ok") {
          return {
            items: [],
            total: 0,
            status: result.status,
            ...(result.reason ? { reason: result.reason } : {}),
          };
        }
        return {
          items: result.items.map(objectItemRecord),
          total: result.total,
          status: "ok",
        };
      },
      graph,
    },
    {
      objectType: ONTOLOGY_RELATION_KIND,
      async list() {
        return (await client.schema()).relationKinds.map(relationKindRecord);
      },
      graph,
    },
  ];
};
