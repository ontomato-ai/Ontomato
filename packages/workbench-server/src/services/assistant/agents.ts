import { z } from "zod";
import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { AssistantAgentsQuery } from "@ontomato/contracts/page-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { config } from "../../config/application";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { currentProductGrants, withProductGrants } from "../product-assets/grants";
import { nativeProfileId } from "../product-assets/platform-assets";
import { profileIdForPrincipal } from "../product-assets/agent-profile";
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
      if (native) {
        const grants = currentProductGrants(owner).use;
        if (!grants.has(native) || !grants.has(agent.id)) continue;
        const response = await backendPost("platform-agent-identity", `${config.dataQuery.baseUrl}/agent-principals/check-user-scoped`, { id: agent.id }, {
          headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 0,
        });
        if (!z.object({ allowed: z.boolean() }).parse(JSON.parse(response.text)).allowed) continue;
      }
      const profile = native ? null : await profileIdForPrincipal(owner, agent.id);
      agents.push({
        id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
        icon: agent.icon, enabled: agent.enabled, effectiveSkills: effectiveAssistantSkills(agent, projection, profile !== null),
      });
    }
    if (!("pageKey" in query)) return assistantAgentListSchema.parse({ agents });
    const mapping = projection.pageSkills.find(mapping => "permissionCode" in query
      ? "permissionCode" in mapping && mapping.permissionCode === query.permissionCode
      : "access" in mapping && mapping.access === query.access);
    if (!mapping) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
    const candidates = agents.filter(agent => agent.enabled && agent.effectiveSkills.some(skill => runtimeSkillKey(skill) === runtimeSkillKey(mapping.skill)));
    const defaultKey = mapping.defaults?.find(entry => entry.pageKey === query.pageKey)?.agentKey ?? "regular";
    const selected = definitions.find(agent => agent.kind === defaultKey);
    if (!selected || !candidates.some(agent => agent.id === selected.id))
      throw new HttpError(409, "The page's default agent is unavailable", "PAGE_DEFAULT_AGENT_UNAVAILABLE");
    return assistantAgentListSchema.parse({ agents: candidates, defaultAgentId: selected.id });
  });
}
