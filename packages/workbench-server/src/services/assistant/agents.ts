import { assistantAgentListSchema } from "@ontomato/contracts/assistant-chat";
import type { AssistantAgentsQuery, PageSkillEntrance } from "@ontomato/contracts/page-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { workbenchIdentity } from "../../identity/installed";
import { assertAppBuilderAccess } from "../app-builder/access";
import { isAppBuilderEntrance } from "./skill-selection";
import { HttpError } from "../../utils/errors";
import { isAppBuilderKind } from "../app-builder/definition";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { grantedProductIds } from "../product-governance/grants";
import { agentsWithProductProfiles } from "../product-assets/agent-profile";
import { assistantStore, type AgentRow, type AssistantOwner } from "./store";
import { isPresetAgentKind } from "./preset-definitions";
import { assistantDescription, assistantName } from "./labels";
import { effectiveAssistantSkills } from "./skills";

export async function listAssistantAgents(owner: AssistantOwner, credentials: AssistantCredentials, query: AssistantAgentsQuery = {}, excludePreset?: string) {
  const usableIds = new Set(await grantedProductIds("use", credentials));
  const entrance: PageSkillEntrance | null = "pageKey" in query
    ? "permissionCode" in query ? { pageKey: query.pageKey, permissionCode: query.permissionCode }
      : { pageKey: query.pageKey, access: query.access }
    : null;
  const page = entrance && await (await import("../skills/view")).readPageCandidateSkill({ ...owner, initiatorCredentials: credentials },
    entrance, usableIds, "member" in query ? query.member : undefined);
  if (entrance && !page) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
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
  const builder = excludePreset === "app-builder" ? undefined : await assistantStore.appBuilder?.(owner.domainId);
  if (builder && usableIds.has(builder.id)) {
    try {
      await assertAppBuilderAccess(credentials);
      definitions.push(builder);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
    }
  }
  const summary = (agent: AgentRow) => ({
    id: agent.id, name: assistantName(agent, credentials.locale), description: assistantDescription(agent, credentials.locale),
    icon: agent.icon, enabled: agent.enabled,
    ...(isPresetAgentKind(agent.kind) || isOpsDiagnosisKind(agent.kind) ? { kind: agent.kind } : {}),
    ...(isAppBuilderKind(agent.kind) && { workspaceBound: true }),
  });
  if (!entrance || !page) return assistantAgentListSchema.parse({
    agents: definitions.map(summary),
    ...(builder && definitions.some(agent => agent.id === builder.id && agent.enabled)
      && { presetAgentIds: { "app-builder": builder.id } }),
  });

  const skillKey = runtimeSkillKey(page.skill);
  const view = {
    hasSkill: (ref: typeof page.skill) => runtimeSkillKey(ref) === skillKey,
    pageSkills: page.pageSkills,
  };
  const matching = definitions.filter(agent => agent.enabled && effectiveAssistantSkills(agent, view).some(view.hasSkill));
  const profiles = await agentsWithProductProfiles(owner.domainId, matching.map(agent => agent.id), usableIds);
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
