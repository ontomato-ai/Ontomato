import { randomId } from "@ontomato/contracts/random-id";
import {
  assistantAgentDefinitionListSchema,
  assistantSkillCatalogSchema,
  assistantAgentDefinitionSchema,
  type AssistantAgentDefinition,
  type AssistantAgentInput,
} from "@ontomato/contracts/assistant-chat";
import { apiGet, nodeApiFetch, nodeApiGet, nodeApiPost, nodeApiPut } from "../../utils/api";
import { listMcpServiceOptions } from "../mcp/api";

export interface ObjectClassOption {
  className: string;
  showName?: string;
  classDesc?: string;
}

const base = "/assistant/agent-definitions";

/** Agent definition management of the workbench (assistant-chat); requires the analysis-agent permission. */
export const agentDefinitionsApi = {
  async skills() {
    return assistantSkillCatalogSchema.parse(await nodeApiGet("/assistant/agent-skills")).skills;
  },
  async list(): Promise<AssistantAgentDefinition[]> {
    return assistantAgentDefinitionListSchema.parse(await nodeApiGet(base)).agents;
  },
  async create(input: AssistantAgentInput): Promise<AssistantAgentDefinition> {
    return assistantAgentDefinitionSchema.parse(
      await nodeApiPost(base, input, { headers: { "Idempotency-Key": randomId() } }),
    );
  },
  async update(id: string, input: AssistantAgentInput): Promise<AssistantAgentDefinition> {
    return assistantAgentDefinitionSchema.parse(await nodeApiPut(`${base}/${encodeURIComponent(id)}`, input));
  },
  async remove(id: string): Promise<void> {
    await nodeApiFetch(`${base}/${encodeURIComponent(id)}`, "DELETE");
  },
  listMcpServiceOptions,
};

/** Authorized ontology classes used by the single analysis scope selector. */
export async function loadOntologyOutline(): Promise<{ classes: ObjectClassOption[] }> {
  const result = await apiGet("/ontology/query/overview");
  return { classes: result.classes.map((cls: { name: string; description: string | null }) => ({
    className: cls.name, classDesc: cls.description ?? "",
  })) };
}
