import { modelOptionsSchema, type ModelOptions } from "@ontomato/contracts/model-settings";
import { assistantAgentDefinitionListSchema, type AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import { apiGet, nodeApiGet } from "../../utils/api";

export const agentDefinitionsApi = {
  async list(): Promise<AssistantAgentDefinition[]> {
    return assistantAgentDefinitionListSchema.parse(await nodeApiGet("/assistant/agent-definitions")).agents;
  },
};

export async function loadModelOptions(): Promise<ModelOptions> {
  return modelOptionsSchema.parse((await apiGet("/model-options")).data);
}
