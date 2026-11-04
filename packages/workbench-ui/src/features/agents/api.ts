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
import { queryViewApi } from "../query-view";

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

/** One relation of the ontology graph, between two object types. */
export interface ObjectRelationOption {
  from: string;
  to: string;
}

/**
 * The object types with their relations, for the graph-scope selector: the same metadata the visual modelling reads, so
 * adjacent object types can be shown and added to the scope. A domain without relation rules simply has no edges.
 */
export async function loadOntologyScope(): Promise<{ classes: ObjectClassOption[]; relations: ObjectRelationOption[] }> {
  const json = await queryViewApi.getMetas();
  const classDefs: Array<{ className?: string; showName?: string; classDesc?: string }> = Array.isArray(json?.data?.classDef)
    ? json.data.classDef
    : [];
  const classes = classDefs
    .filter((cls) => !!cls.className)
    .map((cls) => ({ className: cls.className!, showName: cls.showName || "", classDesc: cls.classDesc || "" }));
  const known = new Set(classes.map((cls) => cls.className));
  const rule = json?.data?.relationship_rule;
  const relations: ObjectRelationOption[] = [];
  const seen = new Set<string>();
  for (const relation of Object.values((rule || {}) as Record<string, { fromclass?: string; toclass?: string }>)) {
    const from = String(relation?.fromclass || "").trim();
    const to = String(relation?.toclass || "").trim();
    if (!known.has(from) || !known.has(to) || from === to) continue;
    const key = [from, to].sort().join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    relations.push({ from, to });
  }
  return { classes, relations };
}
