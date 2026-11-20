import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { DefaultAgent } from "@ontomato/contracts/default-agent";
import type { AssistantAgentsQuery, PageSkillEntrance, PageSkillLocator } from "@ontomato/contracts/page-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { withProductGrants } from "../product-assets/grants";
import { nativeProfileId } from "../product-assets/platform-assets";
import { profileIdForAgent } from "../product-assets/agent-profile";
import { assistantStore, type AssistantOwner } from "./store";
import { assistantDescription, assistantName } from "./labels";
import { effectiveAssistantSkills, readAssistantSkillView, resolveCurrentPageSkillMember } from "./skills";

function locatorOf(entrance: PageSkillEntrance): PageSkillLocator {
  return "permissionCode" in entrance
    ? { permissionCode: entrance.permissionCode }
    : { access: entrance.access, pageKey: entrance.pageKey };
}

function sameLocator(a: PageSkillLocator, b: PageSkillLocator): boolean {
  return "permissionCode" in a
    ? "permissionCode" in b && a.permissionCode === b.permissionCode
    : "access" in b && a.access === b.access && a.pageKey === b.pageKey;
}

export async function listAssistantAgents(owner: AssistantOwner, credentials: AssistantCredentials, query: AssistantAgentsQuery = {}) {
  const view = await readAssistantSkillView(owner.domainId, credentials);
  let pageFilter: { skillKey: string; defaultAgent: DefaultAgent } | null = null;
  if ("pageKey" in query) {
    const entrance: PageSkillEntrance = "permissionCode" in query
      ? { permissionCode: query.permissionCode, pageKey: query.pageKey }
      : { access: query.access, pageKey: query.pageKey };
    const locator = locatorOf(entrance);
    // A member query names the page's actual member; the skill system checks its source, path and ref again for this
    // initiator, so another entrance's admission never stands in for this one.
    const skill = "member" in query
      ? (await resolveCurrentPageSkillMember(view, entrance, query.member))?.member.ref ?? null
      : view.publicPageSkill(locator);
    if (!skill) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
    const group = view.pageSkills.find(entry => sameLocator(entry.locator, locator));
    pageFilter = {
      skillKey: runtimeSkillKey(skill),
      defaultAgent: group?.defaults.find(entry => entry.pageKey === query.pageKey)?.defaultAgent ?? { kind: "preset", agentKind: "regular" },
    };
  }
  const definitions = await assistantStore.agents(owner.domainId);
  return withProductGrants(owner, async () => {
    const agents = [];
    for (const agent of definitions) {
      const native = await nativeProfileId(owner.domainId, agent.id);
      const profile = native ? null : await profileIdForAgent(owner, agent.id);
      agents.push({
        id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
        icon: agent.icon, enabled: agent.enabled, effectiveSkills: effectiveAssistantSkills(agent, view, profile !== null),
      });
    }
    if (!pageFilter) return assistantAgentListSchema.parse({ agents });
    const { skillKey, defaultAgent } = pageFilter;
    const candidates = agents.filter(agent => agent.enabled && agent.effectiveSkills.some(skill => runtimeSkillKey(skill) === skillKey));
    const candidateIds = new Set(candidates.map(agent => agent.id));
    const presetAgentIds = new Map(definitions.filter(agent => candidateIds.has(agent.id)).map(agent => [agent.kind, agent.id]));
    if (defaultAgent.kind === "id" && !candidateIds.has(defaultAgent.id))
      throw new HttpError(409, "The page's default agent is unavailable", "PAGE_DEFAULT_AGENT_UNAVAILABLE");
    const defaultAgentId = defaultAgent.kind === "id" ? defaultAgent.id : presetAgentIds.get(defaultAgent.agentKind);
    return assistantAgentListSchema.parse({
      agents: candidates,
      presetAgentIds: Object.fromEntries(presetAgentIds),
      ...(defaultAgentId ? { defaultAgentId } : {}),
    });
  });
}
