import { inject, type InjectionKey } from "vue";
import type { OntologyAgentModel } from "@ontomato/contracts/model-settings";

/*
 * The ontology service agents' models, edited beside the domain defaults: the agents as last saved, and the draft
 * selection of each (`null` follows the chat default). A page that saves the settings replaces the whole selection.
 */
export interface AgentModelsDraft {
  /** The agents as last saved; null until they are read. */
  saved: OntologyAgentModel[] | null;
  /** The draft selection of each agent, by agent ID; null follows the domain chat default. */
  selections: Record<string, string | null>;
}

export const agentModelsDraftKey: InjectionKey<AgentModelsDraft> = Symbol("ontology-agent-models-draft");

export function useAgentModelsDraft(): AgentModelsDraft {
  const draft = inject(agentModelsDraftKey);
  if (!draft) throw new Error("Model panels must be mounted inside the model configuration page");
  return draft;
}

/**
 * The purposes the ontology service's agents work for, in display order. An agent's `kind` names the purpose: the
 * data-retrieval agent, the knowledge pages' agents, and the agents that author ontology artifacts (actions, metric
 * views, read functions) or generate programs from them.
 */
export type AgentPurpose = "retrieval" | "knowledge" | "modeling" | "generation";

export const agentPurposes: readonly AgentPurpose[] = ["retrieval", "knowledge", "modeling", "generation"];

/**
 * Which purpose each agent kind serves. The data engine's catalog holds the kinds (`OntologyAgentModelSettings`): the
 * retriever; the conversational action creator and the generation kinds; knowledge governance; and question quality,
 * which checks the retriever's questions. `actionCreation` belongs with the authors of ontology artifacts.
 */
const kindsByPurpose: Readonly<Record<AgentPurpose, readonly string[]>> = {
  retrieval: ["retrieval", "quality"],
  knowledge: ["knowledge", "knowledgeGovernance"],
  modeling: ["actionCreation", "action", "explain", "metric", "function", "instantiate", "name"],
  generation: ["dashboard", "describe"],
};

/** The purpose of an agent by its kind; a kind this edition does not know groups with modeling, where most lie. */
export function agentPurpose(kind: string): AgentPurpose {
  const purpose = agentPurposes.find((candidate) => kindsByPurpose[candidate].includes(kind));
  return purpose ?? "modeling";
}

/** The agents that no longer follow the chat default, grouped by purpose, in the catalog's order within a purpose. */
export function specifiedAgents(agents: readonly OntologyAgentModel[], selections: Readonly<Record<string, string | null>>) {
  const specified = agents.filter((agent) => (selections[agent.id] ?? null) !== null);
  return agentPurposes
    .map((purpose) => ({ purpose, agents: specified.filter((agent) => agentPurpose(agent.kind) === purpose) }))
    .filter((group) => group.agents.length > 0);
}
