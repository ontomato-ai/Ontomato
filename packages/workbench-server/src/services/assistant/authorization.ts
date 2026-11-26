import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { decideObject, decideObjects, requireObject, type ObjectDefinition, type ObjectVerb, type ObjectVisibilityRange } from "../product-governance/authorization";
import { definitionVisibleInRange } from "../product-panels/access";
import type { AgentRow } from "./store";

export type AgentAccessFacts = Pick<AgentRow, "domain_id" | "id" | "owner_id">;

export function agentObject(agent: AgentAccessFacts): ObjectDefinition {
  return {
    target: { domainId: agent.domain_id, kind: "AGENT", id: agent.id },
    ownerFacts: { ownerId: agent.owner_id, state: "PUBLISHED" },
  };
}

export async function requireAgent(agent: AgentRow, verb: ObjectVerb, credentials: AssistantCredentials) {
  await requireObject({ ...agentObject(agent), verb }, credentials);
}

export async function agentAllowed(agent: AgentRow, verb: ObjectVerb, credentials: AssistantCredentials) {
  return (await decideObject({ ...agentObject(agent), verb }, credentials)).allowed;
}

export async function allowedAgents<T extends AgentAccessFacts>(agents: readonly T[], verb: ObjectVerb, credentials: AssistantCredentials) {
  const decisions = await decideObjects(agents.map(agent => ({ ...agentObject(agent), verb })), credentials);
  return agents.filter((_, index) => decisions[index].allowed);
}

export function agentInVisibilityRange(agent: AgentAccessFacts, range: ObjectVisibilityRange, domainId: string) {
  return definitionVisibleInRange({ id: agent.id, domainId: agent.domain_id, ownerId: agent.owner_id }, range, domainId);
}

export function requireAgentCreation(credentials: AssistantCredentials) {
  return requireObject({ create: "AGENT" }, credentials);
}
