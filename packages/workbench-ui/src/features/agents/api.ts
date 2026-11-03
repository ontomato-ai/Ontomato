import { z } from "zod";
import { randomId } from "@ontomato/contracts/random-id";
import {
  modelOptionsSchema,
  modelSelectionSchema,
  type ModelOptions,
  type ModelSelection,
} from "@ontomato/contracts/model-settings";
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

const diagnosisModelSchema = z.object({ modelSelection: modelSelectionSchema }).strict();

/** The domain's models to choose from (names only, no connection settings); any account of the domain may read them. */
export async function loadModelOptions(): Promise<ModelOptions> {
  return modelOptionsSchema.parse((await apiGet("/model-options")).data);
}

/** The operations agent's model; read and saved with the analysis-agent permission, like the agent definitions. */
export const diagnosisModelApi = {
  async get(): Promise<ModelSelection> {
    return diagnosisModelSchema.parse(await nodeApiGet("/assistant/diagnosis-model")).modelSelection;
  },
  async save(modelSelection: ModelSelection): Promise<ModelSelection> {
    return diagnosisModelSchema.parse(await nodeApiPut("/assistant/diagnosis-model", { modelSelection })).modelSelection;
  },
};

/** Authorized ontology classes used by the single analysis scope selector. */
export async function loadOntologyOutline(): Promise<{ classes: ObjectClassOption[] }> {
  const result = await apiGet("/ontology/query/overview");
  return { classes: result.classes.map((cls: { name: string; description: string | null }) => ({
    className: cls.name, classDesc: cls.description ?? "",
  })) };
}
