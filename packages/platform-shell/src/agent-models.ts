import { inject, type InjectionKey, type Ref } from "vue";
import {
  modelOptionsSchema,
  ontologyAgentModelSchema,
  ontologyAgentModelsSchema,
  type ModelOptions,
} from "@ontomato/contracts/model-settings";
import { platformRoutes } from "./routes";

/**
 * Which application's "Models" page lists each ontology service agent, by the stable kind the data engine names it with.
 * The data engine owns the agents, their catalog and their selections; this is only where the platform shows each one,
 * declared once: the applications' model pages list their kinds from it, and the system settings name it when a renamed
 * model leaves an agent's choice unavailable. A kind no entry names is shown by no page.
 */
export const ontologyAgentModelPages = [
  // The data retrieval chain of the conversation: the retriever, the check of its questions, the description of a
  // program the answer runs and the dashboard generated when an answer is added to a board.
  { app: "agents", path: platformRoutes.agentModels.path, kinds: ["retrieval", "quality", "describe", "dashboard"] },
  { app: "governance", path: platformRoutes.governanceModels.path, kinds: ["knowledge", "knowledgeGovernance"] },
  {
    app: "ontology",
    path: platformRoutes.ontologyModels.path,
    kinds: ["actionCreation", "action", "explain", "metric", "function", "instantiate", "name"],
  },
] as const;

export type AgentModelPage = (typeof ontologyAgentModelPages)[number];

/** The model page that lists an agent of this kind; null for a kind no page lists. */
export function agentModelPage(kind: string): AgentModelPage | null {
  return ontologyAgentModelPages.find((page) => (page.kinds as readonly string[]).includes(kind)) ?? null;
}

/** One agent of a model page, with its saved choice: null follows the domain's default chat model. */
export interface AgentModelEntry {
  id: string;
  /** The ontology service kind, which names the agent in the platform's language; null for an agent named here. */
  kind: string | null;
  name: string;
  description: string | null;
  modelId: string | null;
}

/**
 * Where a model page reads and writes: each application injects its own, so the page itself knows no endpoint. `save`
 * stores one agent's choice and returns it as stored; a rejected one throws with the service's reason.
 */
export interface AgentModelSource {
  load(): Promise<{ agents: AgentModelEntry[]; models: ModelOptions }>;
  save(id: string, modelId: string | null): Promise<string | null>;
}

/** The data engine's endpoints as an application reaches them through its own request layer: the response's `data`. */
export interface DataEngineTransport {
  get(path: string): Promise<unknown>;
  put(path: string, body: unknown): Promise<unknown>;
}

/** The ontology service agents of one application's model page, in the order the page declares their kinds. */
export function ontologyAgentModelSource(transport: DataEngineTransport, page: AgentModelPage): AgentModelSource {
  const kinds: readonly string[] = page.kinds;
  return {
    async load() {
      const [agents, models] = await Promise.all([
        transport.get("/ontology/ai/agent-models"),
        transport.get("/model-options"),
      ]);
      return {
        agents: ontologyAgentModelsSchema
          .parse(agents)
          .agents.filter((agent) => kinds.includes(agent.kind))
          .sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind))
          .map((agent) => ({
            id: agent.id,
            kind: agent.kind,
            name: agent.name,
            description: null,
            modelId: agent.modelSelection.modelId,
          })),
        models: modelOptionsSchema.parse(models),
      };
    },
    async save(id, modelId) {
      const body = { modelSelection: { modelId } };
      const saved = await transport.put(`/ontology/ai/agent-models/${encodeURIComponent(id)}`, body);
      return ontologyAgentModelSchema.parse(saved).modelSelection.modelId;
    },
  };
}

/** The model pages' words, from the host's i18n; the frame around the applications provides them once. */
export interface AgentModelLabels {
  title: string;
  description: string;
  /** The null choice: follow the domain's default chat model (its label, or null when none is set). */
  followDefault(model: string | null): string;
  unavailable(id: string): string;
  missing(id: string): string;
  backToDefault: string;
  /** An ontology service agent's name in the platform's language; `fallback` is the data engine's name. */
  agentName(kind: string, fallback: string): string;
  empty: string;
  loadFailed: string;
  retry: string;
  saved: string;
  saveFailed: string;
  discardTitle: string;
  discardMessage: string;
  cancel: string;
  save: string;
  discard: string;
  unsavedChanges: string;
}

export const agentModelLabelsKey: InjectionKey<Readonly<Ref<AgentModelLabels>>> = Symbol("platform-agent-model-labels");

export function useAgentModelLabels(): Readonly<Ref<AgentModelLabels>> {
  const labels = inject(agentModelLabelsKey);
  if (!labels) throw new Error("A model page must be mounted inside the platform, which provides its words");
  return labels;
}
