import type { AnalysisGraphScope } from "@ontomato/contracts/analysis-agent";
import { nodeApiFetch, nodeApiGet, nodeApiPost, nodeApiPut } from "../../utils/api";
import { listMcpServiceNames } from "../mcp/api";
import { queryViewApi } from "../query-view";

/**
 * An agent definition as the settings page edits it: prompt + skills + data scope, owned by the
 * workbench and run on the agent runtime. The model role comes from the runtime configuration.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** JSON of {key, color}, the stored avatar. */
  icon: string | null;
  enabled: boolean;
  prompt: string;
  skillIds: string[];
  classNames: string[];
  graphScope: AnalysisGraphScope;
  mcpServiceNames: string[];
}

export type AgentDefinitionInput = Omit<AgentDefinition, "id">;

export interface ObjectClassOption {
  className: string;
  showName?: string;
  classDesc?: string;
}

export interface OntologyRelationOption {
  fromclass?: string;
  toclass?: string;
}

const base = "/assistant/agents";
const WORKBENCH_ID = "business";

export const agentDefinitionsApi = {
  async list(): Promise<AgentDefinition[]> {
    const body: { agents: AgentDefinition[] } = await nodeApiGet(
      `${base}?${new URLSearchParams({ workbenchId: WORKBENCH_ID })}`,
    );
    return body.agents;
  },
  async create(input: AgentDefinitionInput): Promise<AgentDefinition> {
    const body: { agent: AgentDefinition } = await nodeApiPost(base, { workbenchId: WORKBENCH_ID, ...input });
    return body.agent;
  },
  async update(id: string, input: AgentDefinitionInput): Promise<AgentDefinition> {
    const body: { agent: AgentDefinition } = await nodeApiPut(`${base}/${encodeURIComponent(id)}`, input);
    return body.agent;
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
