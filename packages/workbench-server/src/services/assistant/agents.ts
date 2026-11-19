import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { DefaultAgent } from "@ontomato/contracts/default-agent";
import type { AssistantAgentsQuery } from "@ontomato/contracts/page-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { withProductGrants } from "../product-assets/grants";
import { nativeProfileId } from "../product-assets/platform-assets";
import { profileIdForAgent } from "../product-assets/agent-profile";
import { assistantStore, type AssistantOwner } from "./store";
import { assistantDescription, assistantName } from "./labels";
import { effectiveAssistantSkills, readPageSkills } from "./skills";

export async function listAssistantAgents(owner: AssistantOwner, credentials: AssistantCredentials, query: AssistantAgentsQuery = {}) {
  const projection = await readPageSkills(credentials);
  const definitions = await assistantStore.agents(owner.domainId);
  return withProductGrants(owner, async () => {
    const agents = [];
    for (const agent of definitions) {
      const native = await nativeProfileId(owner.domainId, agent.id);
      const profile = native ? null : await profileIdForAgent(owner, agent.id);
      agents.push({
        id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
        icon: agent.icon, enabled: agent.enabled, effectiveSkills: effectiveAssistantSkills(agent, projection, profile !== null),
      });
    }
    if (!("pageKey" in query)) return assistantAgentListSchema.parse({ agents });
    const mapping = projection.pageSkills.find(mapping => "permissionCode" in query
      ? "permissionCode" in mapping && mapping.permissionCode === query.permissionCode
      : "access" in mapping && mapping.access === query.access && mapping.pageKey === query.pageKey);
    if (!mapping) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
    const candidates = agents.filter(agent => agent.enabled && agent.effectiveSkills.some(skill => runtimeSkillKey(skill) === runtimeSkillKey(mapping.skill)));
    const defaultAgent: DefaultAgent = mapping.defaults?.find(entry => entry.pageKey === query.pageKey)?.defaultAgent
      ?? { kind: "preset", agentKind: "regular" };
    const selected = defaultAgent.kind === "id"
      ? candidates.find(agent => agent.id === defaultAgent.id)
      : candidates.find(agent => definitions.some(row => row.id === agent.id && row.kind === defaultAgent.agentKind));
    if (!selected && defaultAgent.kind === "id")
      throw new HttpError(409, "The page's default agent is unavailable", "PAGE_DEFAULT_AGENT_UNAVAILABLE");
    return assistantAgentListSchema.parse({
      agents: candidates,
      ...(selected ? { defaultAgentId: selected.id } : {}),
    });
  });
}
