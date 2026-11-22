import type { DefaultAgent } from "@ontomato/contracts/default-agent";
import { assistantName } from "./labels";
import { assistantStore, type AgentRow } from "./store";

function defaultAgentAvailability(agent: AgentRow | undefined):
  { agent: AgentRow } | { reason: "missing" | "disabled" } {
  if (!agent) return { reason: "missing" };
  return agent.enabled ? { agent } : { reason: "disabled" };
}

export function resolveDefaultAgent(definitions: readonly AgentRow[], target: DefaultAgent) {
  const match = definitions.find(agent => target.kind === "id" ? agent.id === target.id : agent.kind === target.agentKind);
  return defaultAgentAvailability(match);
}

export async function listDefaultAgentOptions(domainId: string, locale?: string): Promise<{ value: DefaultAgent; label: string }[]> {
  const definitions = await assistantStore.agents(domainId);
  return definitions.flatMap(definition => {
    const choice = defaultAgentAvailability(definition);
    if ("reason" in choice || choice.agent.kind === "regular") return [];
    const { agent } = choice;
    const value: DefaultAgent = agent.kind === agent.id
      ? { kind: "id", id: agent.id }
      : { kind: "preset", agentKind: agent.kind };
    return [{ value, label: assistantName(agent, locale) }];
  });
}
