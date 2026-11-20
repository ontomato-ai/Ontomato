import { panelReadParameterSchemas, type PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  platformOntologyNeighborsRequestSchema,
  type PlatformOntologyCountsResponse,
  type PlatformOntologyNeighborsRequest,
  type PlatformOntologyNeighborsResponse,
  type PlatformOntologyObjectsResponse,
  type PlatformOntologySchemaResponse,
  type PlatformOntologyStartResponse,
} from "@ontomato/contracts/platform-ontology";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { PlatformOntologyOwnerReaders, type RawOntologyMeta } from "./owners";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyNeighbors,
  readPlatformOntologyObjects,
  readPlatformOntologySchema,
  readPlatformOntologyStart,
} from "./query";

export interface PlatformOntologyObjectsReadParams {
  type: string;
  keyword?: string;
  page?: { number: number; size: number };
}

export interface PlatformOntologyReadAdapter {
  listObjectTypes(): Promise<PanelRecord[]>;
  listRelationships(): Promise<PanelRecord[]>;
  schema(): PlatformOntologySchemaResponse;
  counts(): Promise<PlatformOntologyCountsResponse>;
  start(): Promise<PlatformOntologyStartResponse>;
  neighbors(params: PlatformOntologyNeighborsRequest): Promise<PlatformOntologyNeighborsResponse>;
  objects(params: PlatformOntologyObjectsReadParams): Promise<PlatformOntologyObjectsResponse>;
}

async function readOntologyMetadata(owner: ProductOwner, viewer: AssistantCredentials): Promise<RawOntologyMeta> {
  const readers = new PlatformOntologyOwnerReaders(owner, viewer);
  const result = await readers.ontologyMeta();
  if (!result.ok) {
    if (result.status === "refused") {
      throw new HttpError(403, result.reason, "FORBIDDEN");
    }
    throw new HttpError(502, result.reason, "ONTOLOGY_META_READ_FAILED");
  }
  return result.data;
}

/**
 * Named panel data reads for `platform:ObjectType`, `platform:Relationship`, and `platform:OntologyType`,
 * shared by the four-layer capability map and the agent-settings data-scope graph.
 */
export function createPlatformOntologyReadAdapter(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  callerUserName?: string,
): PlatformOntologyReadAdapter {
  return {
    async listObjectTypes(): Promise<PanelRecord[]> {
      const meta = await readOntologyMetadata(owner, viewer);
      return meta.classes.map((cls) => ({
        primaryKey: cls.className,
        label: cls.showName || cls.classDesc || cls.className,
        fields: {
          className: cls.className,
          showName: cls.showName ?? "",
          classDesc: cls.classDesc ?? "",
        },
      }));
    },

    async listRelationships(): Promise<PanelRecord[]> {
      const meta = await readOntologyMetadata(owner, viewer);
      return meta.relationships.map((rel) => ({
        primaryKey: rel.relationship,
        label: rel.showName || rel.desc || rel.relationship,
        fields: {
          fromclass: rel.fromclass ?? "",
          toclass: rel.toclass ?? "",
        },
      }));
    },

    schema(): PlatformOntologySchemaResponse {
      return readPlatformOntologySchema();
    },

    counts(): Promise<PlatformOntologyCountsResponse> {
      return readPlatformOntologyCounts(owner, viewer);
    },

    async start(): Promise<PlatformOntologyStartResponse> {
      return {
        node: await readPlatformOntologyStart(owner, viewer, callerUserName),
      };
    },

    neighbors(params: PlatformOntologyNeighborsRequest): Promise<PlatformOntologyNeighborsResponse> {
      const input = platformOntologyNeighborsRequestSchema.parse(params);
      return readPlatformOntologyNeighbors(owner, viewer, input, callerUserName);
    },

    objects(params: PlatformOntologyObjectsReadParams): Promise<PlatformOntologyObjectsResponse> {
      const type = panelReadParameterSchemas.ontologyType.parse(params.type);
      const keyword = params.keyword === undefined ? undefined : panelReadParameterSchemas.keyword.parse(params.keyword);
      const page = params.page === undefined ? undefined : panelReadParameterSchemas.page.parse(params.page);
      return readPlatformOntologyObjects(owner, viewer, {
        type,
        ...(keyword !== undefined ? { keyword } : {}),
        ...(page !== undefined ? { page: page.number, pageSize: page.size } : {}),
      });
    },
  };
}
