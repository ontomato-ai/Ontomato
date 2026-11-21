import { modelOptionsSchema, type ModelOptions } from "@ontomato/contracts/model-settings";
import { assistantAgentDefinitionListSchema, type AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { DataEngineTransport } from "@ontomato/platform-shell";
import { apiGet, apiPut, nodeApiGet } from "../../utils/api";

export const agentDefinitionsApi = {
  async list(): Promise<AssistantAgentDefinition[]> {
    return assistantAgentDefinitionListSchema.parse(await nodeApiGet("/assistant/agent-definitions")).agents;
  },
};

export const dataEngineTransport: DataEngineTransport = {
  get: async (path) => (await apiGet(path)).data,
  put: async (path, body) => (await apiPut(path, body)).data,
};


export async function loadModelOptions(): Promise<ModelOptions> {
  return modelOptionsSchema.parse((await apiGet("/model-options")).data);
}
