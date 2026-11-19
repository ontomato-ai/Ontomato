import {
  platformOntologyCountsResponseSchema,
  platformOntologyNeighborsRequestSchema,
  platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsResponseSchema,
  platformOntologySchemaResponseSchema,
  platformOntologyStartResponseSchema,
  type PlatformOntologyObjectItem,
  type PlatformOntologyObjectsRequest,
  type PlatformOntologySchemaResponse,
  type PlatformOntologyType,
} from "@ontomato/contracts/platform-ontology";
import { ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, type PlatformRelationKindDeclaration } from "@ontomato/contracts/platform-object-types";
import type {
  PlatformGraphNeighborsQuery,
  PlatformObjectAdapter,
  PlatformObjectAdapterFactory,
  PlatformObjectGraph,
  PlatformObjectQuery,
  PlatformObjectQueryResult,
  PlatformObjectRecord,
  PlatformRequests,
} from "./platform-objects";

const base = "/platform-ontology";

async function readJson<T>(
  requests: PlatformRequests,
  path: string,
  init: NonNullable<Parameters<typeof fetch>[1]>,
  schema: { parse(body: unknown): T },
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
  return schema.parse(body);
}

/**
 * Builds the read-only platform ontology client over the panel frame's request path.
 * Sends only the five `/platform-ontology/*` requests declared in `@ontomato/contracts/panel-client-requests`
 * for `ONTOLOGY_TYPE` and `ONTOLOGY_RELATION_KIND`.
 */
export function createPlatformOntologyClient(requests: PlatformRequests) {
  let pendingSchema: Promise<PlatformOntologySchemaResponse> | undefined;

  const schema = () =>
    (pendingSchema ??= readJson(requests, `${base}/schema`, { method: "GET" }, platformOntologySchemaResponseSchema)
      .finally(() => {
        pendingSchema = undefined;
      }));

  const counts = async () => {
    const body = await readJson(requests, `${base}/counts`, { method: "GET" }, platformOntologyCountsResponseSchema);
    return body.counts;
  };

  const start = async () => {
    const body = await readJson(requests, `${base}/start`, { method: "GET" }, platformOntologyStartResponseSchema);
    return body.node;
  };

  const neighbors = async (query: PlatformGraphNeighborsQuery) => {
    const body = platformOntologyNeighborsRequestSchema.parse({
      node: { className: query.node.className, primaryKey: query.node.primaryKey },
      relationKinds: query.relationKinds,
      layers: query.layers,
    });
    return readJson(requests, `${base}/neighbors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, platformOntologyNeighborsResponseSchema);
  };

  const objects = ({ type, keyword, page, pageSize }: PlatformOntologyObjectsRequest) =>
    readJson(requests, `${base}/objects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, keyword, page, pageSize }),
    }, platformOntologyObjectsResponseSchema);

  return { schema, counts, start, neighbors, objects };
}

export type PlatformOntologyClient = ReturnType<typeof createPlatformOntologyClient>;

function typeRecord(spec: PlatformOntologyType): PlatformObjectRecord {
  return {
    primaryKey: spec.id,
    label: spec.labelKey,
    fields: {
      id: spec.id,
      layer: spec.layer,
      labelKey: spec.labelKey,
    },
  };
}

function relationKindRecord(spec: PlatformRelationKindDeclaration): PlatformObjectRecord {
  const target = typeof spec.to === "string" ? spec.to : spec.to.join(",");
  return {
    primaryKey: spec.id,
    label: spec.labelKey,
    fields: {
      id: spec.id,
      from: spec.from,
      to: target,
      derived: String(spec.derived),
      labelKey: spec.labelKey,
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
  specs: readonly PlatformOntologyType[],
  query: PlatformObjectQuery,
): PlatformObjectQueryResult {
  const search = query.search?.trim().toLowerCase();
  const layer = query.filters?.layer?.trim();
  const matched = specs.filter((spec) => {
    if (layer && spec.layer !== layer) return false;
    if (!search) return true;
    return spec.id.toLowerCase().includes(search) || spec.labelKey.toLowerCase().includes(search);
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
