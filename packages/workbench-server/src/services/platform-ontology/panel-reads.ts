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

export interface PlatformOntologyReadAdapter {
  schema(): PlatformOntologySchemaResponse;
  counts(): Promise<PlatformOntologyCountsResponse>;
  start(): Promise<PlatformOntologyStartResponse>;
  neighbors(params: PlatformOntologyNeighborsRequest | Record<string, unknown>): Promise<PlatformOntologyNeighborsResponse>;
  objects(params: PlatformOntologyObjectsReadParams | Record<string, unknown>): Promise<PlatformOntologyObjectsResponse>;
}

/**
 * Named panel data reads for `platform:OntologyType` (`schema`, `counts`, `start`, `neighbors`, `objects`),
 * serving the four-layer capability map and platform ontology explorers.
 */
export function createPlatformOntologyReadAdapter(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  callerUserName?: string,
): PlatformOntologyReadAdapter {
  return {
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

    neighbors(
      params: PlatformOntologyNeighborsRequest | Record<string, unknown>,
    ): Promise<PlatformOntologyNeighborsResponse> {
      const input = platformOntologyNeighborsRequestSchema.parse(params);
      return readPlatformOntologyNeighbors(owner, viewer, input, callerUserName);
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
