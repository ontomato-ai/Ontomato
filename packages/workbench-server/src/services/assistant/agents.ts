import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { AssistantAgentsQuery, PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { isAppBuilderEntrance } from "./skill-selection";
import { HttpError } from "../../utils/errors";
import { isAppBuilderKind } from "../app-builder/definition";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { allowedAgents } from "./authorization";
import { agentsWithProductProfiles } from "../product-assets/agent-profile";
import { assistantStore, type AgentRow, type AssistantOwner } from "./store";
import { isPresetAgentKind } from "./preset-definitions";
import { assistantDescription, assistantName } from "./labels";
import { effectiveAssistantSkills } from "./skills";

export async function listAssistantAgents(owner: AssistantOwner, credentials: AssistantCredentials, query: AssistantAgentsQuery = {}, excludePreset?: string) {
  const definitions = await allowedAgents(
    (await assistantStore.channelAgents(owner.domainId)).filter(agent => agent.kind !== excludePreset),
    "USE", credentials,
  );
  const builder = definitions.find(agent => isAppBuilderKind(agent.kind));
  const entrance: PageSkillEntrance | null = "pageKey" in query
    ? "permissionCode" in query ? { pageKey: query.pageKey, permissionCode: query.permissionCode }
      : { pageKey: query.pageKey, access: query.access }
    : null;
  const page = entrance && await (await import("../skills/view")).readPageCandidateSkill(
    { ...owner, initiatorCredentials: credentials }, entrance, "member" in query ? query.member : undefined,
  );
  if (entrance && !page) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
  const summary = (agent: AgentRow) => ({
    id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
    icon: agent.icon, enabled: agent.enabled,
    ...(isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind) || isAppBuilderKind(agent.kind) ? { kind: agent.kind } : {}),
    ...(isAppBuilderKind(agent.kind) && { workspaceBound: true }),
  });
  if (!entrance || !page) return assistantAgentListSchema.parse({
    agents: definitions.map(summary),
    ...(builder?.enabled
      && { presetAgentIds: { "app-builder": builder.id } }),
  });

  const skillKey = runtimeSkillKey(page.skill);
  const view = {
    hasSkill: (ref: typeof page.skill) => runtimeSkillKey(ref) === skillKey,
    pageSkills: page.pageSkills,
  };
  const matching = definitions.filter(agent => agent.enabled && effectiveAssistantSkills(agent, view).some(view.hasSkill));
  const profiles = await agentsWithProductProfiles(owner, matching.map(agent => agent.id));
  const candidates = matching.filter(agent => !profiles.has(agent.id));
  const defaultAgent = page.defaultAgent ?? {
    kind: "preset",
    agentKind: isAppBuilderEntrance(entrance) ? "app-builder" : "regular",
  };
  const selected = defaultAgent.kind === "id"
    ? candidates.find(agent => agent.id === defaultAgent.id)
    : candidates.find(agent => agent.kind === defaultAgent.agentKind);
  if (!selected && defaultAgent.kind === "id")
    throw new HttpError(409, "The page's default agent is unavailable", "PAGE_DEFAULT_AGENT_UNAVAILABLE");

  const presetAgentIds = Object.fromEntries(candidates
    .filter(agent => isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind) || isAppBuilderKind(agent.kind))
    .map(agent => [agent.kind, agent.id]));
  return assistantAgentListSchema.parse({
    agents: candidates.map(summary),
    presetAgentIds,
    ...(selected ? { defaultAgentId: selected.id } : {}),
  });
}
