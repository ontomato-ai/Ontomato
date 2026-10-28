import {
  assistantAgentDefinitionListSchema,
  assistantAgentDefinitionSchema,
  type AssistantAgentDefinition,
  type AssistantAgentInput,
} from "@ontomato/contracts/assistant-chat";
import { nodeApiFetch, nodeApiGet, nodeApiPost, nodeApiPut } from "../../utils/api";
import { listMcpServiceNames } from "../mcp/api";
import { queryViewApi } from "../query-view";

export interface ObjectClassOption {
  className: string;
  showName?: string;
  classDesc?: string;
}

export interface OntologyRelationOption {
  fromclass?: string;
  toclass?: string;
}

const base = "/assistant/agent-definitions";

/** Agent definition management of the workbench (assistant-chat); requires the analysis-agent permission. */
export const agentDefinitionsApi = {
  async list(): Promise<AssistantAgentDefinition[]> {
    return assistantAgentDefinitionListSchema.parse(await nodeApiGet(base)).agents;
  },
  async create(input: AssistantAgentInput): Promise<AssistantAgentDefinition> {
    return assistantAgentDefinitionSchema.parse(
      await nodeApiPost(base, input, { headers: { "Idempotency-Key": crypto.randomUUID() } }),
    );
  },
  async update(id: string, input: AssistantAgentInput): Promise<AssistantAgentDefinition> {
    return assistantAgentDefinitionSchema.parse(await nodeApiPut(`${base}/${encodeURIComponent(id)}`, input));
  },
  async remove(id: string): Promise<void> {
    await nodeApiFetch(`${base}/${encodeURIComponent(id)}`, "DELETE");
  },
  listMcpServiceNames,
};

/** Classes and relations of the ontology, for related classes and the graph scope selector. */
export async function loadOntologyOutline(): Promise<{
  classes: ObjectClassOption[];
  relations: OntologyRelationOption[];
}> {
  const json = await queryViewApi.getMetas();
  const relationRule = json.data?.relationship_rule || {};
  const relations = Object.values(relationRule).map((relation: any) => ({
    fromclass: relation.fromclass,
    toclass: relation.toclass,
  }));
  const classes: ObjectClassOption[] = Array.isArray(json.data?.classDef)
    ? json.data.classDef
        .map((cls: any) => ({
          className: String(cls.className || ""),
          showName: cls.showName || "",
          classDesc: cls.classDesc || "",
        }))
        .filter((cls: ObjectClassOption) => cls.className)
    : [];
  return { classes, relations };
}
