import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { AssistantAgentsQuery } from "@ontomato/contracts/page-context";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { isAppBuilderKind } from "../app-builder/definition";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { allowedAgents } from "./authorization";
import { assistantStore, type AgentRow, type AssistantOwner } from "./store";
import { isPresetAgentKind } from "./preset-definitions";
import { assistantDescription, assistantName } from "./labels";
import { effectiveAssistantSkills } from "./skills";
import { isPageOperatorSkill } from "./page-operator";
import { requirePanelEntry } from "../product-panels/application-use";

export async function listAssistantAgents(owner: AssistantOwner, credentials: AssistantCredentials, query: AssistantAgentsQuery = {}, excludePreset?: string) {
  const definitions = await allowedAgents(
    (await assistantStore.channelAgents(owner.domainId)).filter(agent => agent.kind !== excludePreset),
    "USE", credentials,
  );
  const builder = definitions.find(agent => isAppBuilderKind(agent.kind));
  const summary = (agent: AgentRow) => ({
    id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
    icon: agent.icon, enabled: agent.enabled,
    ...(isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind) || isAppBuilderKind(agent.kind) ? { kind: agent.kind } : {}),
    ...(isAppBuilderKind(agent.kind) && { workspaceBound: true }),
  });
  if (!("pageKey" in query)) return assistantAgentListSchema.parse({
    agents: definitions.map(summary),
    ...(builder?.enabled && { presetAgentIds: { "app-builder": builder.id } }),
  });

  // The entry lookup itself is the admission check. Its defaultAgent registration selects the default candidate;
  // an entry without a registration naturally falls back to regular.
  const entry = await requirePanelEntry(credentials, { applicationId: query.applicationId, useId: query.entryKey }, owner);
  const candidates = definitions.filter(agent => agent.enabled && effectiveAssistantSkills(agent).some(isPageOperatorSkill));
  const registration = "defaultAgent" in entry.use ? entry.use.defaultAgent : undefined;
  const defaultAgent = registration ?? { kind: "preset" as const, agentKind: "regular" };
  const selected = defaultAgent.kind === "id"
    ? candidates.find(agent => agent.id === defaultAgent.id)
    : candidates.find(agent => agent.kind === defaultAgent.agentKind);

  const presetAgentIds = Object.fromEntries(candidates
    .filter(agent => isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind) || isAppBuilderKind(agent.kind))
    .map(agent => [agent.kind, agent.id]));
  return assistantAgentListSchema.parse({
    agents: candidates.map(summary),
    presetAgentIds,
    ...(selected ? { defaultAgentId: selected.id } : {}),
  });
}
