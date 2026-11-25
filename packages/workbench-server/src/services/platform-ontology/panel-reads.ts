import { z } from "zod";
import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
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
import type { ProductOwner } from "../product-governance/grants";
import { createPlatformOntologyCatalogueReads, createRelationKindDisplayMap } from "./catalogue-reads";
import {
  readPlatformOntologyCounts,
  readPlatformOntologyNeighbors,
  readPlatformOntologyObjects,
  readPlatformOntologySchema,
  readPlatformOntologyStart,
} from "./query";

const platformOntologyObjectsReadParamsSchema = z.object({
  type: panelReadParameterSchemas.ontologyType,
  search: panelReadParameterSchemas.keyword.optional(),
  page: panelReadParameterSchemas.page.optional(),
}).strict();

export interface PlatformOntologyObjectsReadParams {
  type: string;
  search?: string;
  page?: { number: number; size: number };
}

export interface PlatformOntologyReadAdapter extends ReturnType<typeof createPlatformOntologyCatalogueReads> {
  schema(): Promise<PlatformOntologySchemaResponse>;
  counts(): Promise<PlatformOntologyCountsResponse>;
  start(): Promise<PlatformOntologyStartResponse>;
  neighbors(params: PlatformOntologyNeighborsRequest | Record<string, unknown>): Promise<PlatformOntologyNeighborsResponse>;
  objects(params: PlatformOntologyObjectsReadParams | Record<string, unknown>): Promise<PlatformOntologyObjectsResponse>;
}

/**
 * Named reads for the four-layer platform ontology and its type and relation catalogues.
 */
export function createPlatformOntologyReadAdapter(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  callerUserName?: string,
): PlatformOntologyReadAdapter {
  const relationDisplay = createRelationKindDisplayMap(viewer.locale);

  return {
    ...createPlatformOntologyCatalogueReads(owner, viewer),

    async schema(): Promise<PlatformOntologySchemaResponse> {
      const base = await readPlatformOntologySchema();
      return {
        ...base,
        relationKinds: base.relationKinds.map((relation) => {
          const display = relationDisplay.get(relation.id);
          return display ? { ...relation, label: display.label } : relation;
        }),
      };
    },

    counts(): Promise<PlatformOntologyCountsResponse> {
      return readPlatformOntologyCounts(owner, viewer);
    },

    async start(): Promise<PlatformOntologyStartResponse> {
      return {
        node: await readPlatformOntologyStart(owner, viewer, callerUserName),
      };
    },

    async neighbors(
      params: PlatformOntologyNeighborsRequest | Record<string, unknown>,
    ): Promise<PlatformOntologyNeighborsResponse> {
      const input = platformOntologyNeighborsRequestSchema.parse(params);
      const result = await readPlatformOntologyNeighbors(owner, viewer, input, callerUserName);
      return {
        ...result,
        edges: result.edges.map((edge) => {
          const display = relationDisplay.get(edge.relationKind);
          return display ? { ...edge, label: display.label } : edge;
        }),
        relations: result.relations.map((relation) => {
          const display = relationDisplay.get(relation.relationKind);
          return display ? { ...relation, label: display.label } : relation;
        }),
      };
    },

    objects(
      params: PlatformOntologyObjectsReadParams | Record<string, unknown>,
    ): Promise<PlatformOntologyObjectsResponse> {
      const { type, search, page } = platformOntologyObjectsReadParamsSchema.parse(params);
      return readPlatformOntologyObjects(owner, viewer, {
        type,
        ...(search !== undefined ? { keyword: search } : {}),
        ...(page !== undefined ? { page: page.number, pageSize: page.size } : {}),
      });
    },
  };
}
