import { modelOptionsSchema, type ModelOptions } from "@ontomato/contracts/model-settings";
import { assistantAgentDefinitionListSchema, type AssistantAgentDefinitionList, type AssistantAgentDefinitionPageQuery } from "@ontomato/contracts/assistant-chat";
import { apiGet, nodeApiGet } from "../../utils/api";

export const agentDefinitionsApi = {
  async list({ limit, cursor }: Partial<AssistantAgentDefinitionPageQuery> = {}): Promise<AssistantAgentDefinitionList> {
    const query = new URLSearchParams();
    if (limit !== undefined) query.set("limit", String(limit));
    if (cursor !== undefined) query.set("cursor", cursor);
    const path = `/assistant/agent-definitions${query.size ? `?${query}` : ""}`;
    return assistantAgentDefinitionListSchema.parse(await nodeApiGet(path));
  },
};

export async function loadModelOptions(): Promise<ModelOptions> {
  return modelOptionsSchema.parse((await apiGet("/model-options")).data);
}
