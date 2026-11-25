import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { DefaultAgent } from "@ontomato/contracts/default-agent";
import type { AssistantAgentsQuery, PageSkillEntrance, PageSkillLocator } from "@ontomato/contracts/page-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { workbenchIdentity } from "../../identity/installed";
import { HttpError } from "../../utils/errors";
import { isAppBuilderKind } from "../app-builder/definition";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { grantedProductIds } from "../product-governance/grants";
import { withProductGrants } from "../product-assets/grants";
import { nativeProfileId } from "../product-assets/platform-assets";
import { profileIdForAgent } from "../product-assets/agent-profile";
import { assistantStore, type AgentRow, type AssistantOwner } from "./store";
import { isPresetAgentKind } from "./preset-definitions";
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

export async function listAssistantAgents(owner: AssistantOwner, credentials: AssistantCredentials, query: AssistantAgentsQuery = {}, excludePreset?: string) {
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
  const usableIds = new Set(await grantedProductIds("use", credentials));
  const stored = await assistantStore.agents(owner.domainId);
  const diagnosisRow = stored.some(agent => isOpsDiagnosisKind(agent.kind))
    ? undefined
    : await assistantStore.opsDiagnosis?.(owner.domainId);
  const rawDefinitions = diagnosisRow ? [...stored, diagnosisRow] : stored;
  let observeAllowed: boolean | null = null;
  async function canObserve() {
    if (observeAllowed !== null) return observeAllowed;
    try {
      await workbenchIdentity().assertObserveAccess({
        domainId: owner.domainId,
        token: credentials.token,
        apiKey: credentials.apiKey,
      });
      observeAllowed = true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) {
        observeAllowed = false;
      } else {
        throw error;
      }
    }
    return observeAllowed;
  }
  const definitions: AgentRow[] = [];
  for (const agent of rawDefinitions) {
    if (isAppBuilderKind(agent.kind)) continue;
    if (agent.kind === excludePreset || !usableIds.has(agent.id)) continue;
    if (isOpsDiagnosisKind(agent.kind) && !await canObserve()) continue;
    definitions.push(agent);
  }
  return withProductGrants(owner, async () => {
    const agents = [];
    for (const agent of definitions) {
      const native = await nativeProfileId(owner.domainId, agent.id);
      const profile = native ? null : await profileIdForAgent(owner, agent.id);
      agents.push({
        id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
        icon: agent.icon, enabled: agent.enabled,
        ...(isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind) ? { kind: agent.kind } : {}),
        // Only what this initiator's view holds: a page skill whose source could not be read is no agent's skill here.
        effectiveSkills: effectiveAssistantSkills(agent, view, profile !== null).filter(view.hasSkill),
      });
    }
    if (!pageFilter) return assistantAgentListSchema.parse({ agents });
    const { skillKey, defaultAgent } = pageFilter;
    const candidates = agents.filter(agent => agent.enabled && agent.effectiveSkills.some(skill => runtimeSkillKey(skill) === skillKey));
    const selected = defaultAgent.kind === "id"
      ? candidates.find(agent => agent.id === defaultAgent.id)
      : candidates.find(agent => definitions.some(row => row.id === agent.id && row.kind === defaultAgent.agentKind));
    if (!selected && defaultAgent.kind === "id")
      throw new HttpError(409, "The page's default agent is unavailable", "PAGE_DEFAULT_AGENT_UNAVAILABLE");

    const candidateIds = new Set(candidates.map(agent => agent.id));
    const presetAgentIds = Object.fromEntries(definitions
      .filter(agent => (isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind)) && candidateIds.has(agent.id))
      .map(agent => [agent.kind, agent.id]));
    return assistantAgentListSchema.parse({
      agents: candidates,
      presetAgentIds,
      ...(selected ? { defaultAgentId: selected.id } : {}),
    });
  });
}
