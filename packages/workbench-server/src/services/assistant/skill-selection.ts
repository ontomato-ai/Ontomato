import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { DefaultAgent } from "@ontomato/contracts/default-agent";
import { isAppBuilderKind } from "../app-builder/definition";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";
import { isPresetAgentKind } from "./preset-definitions";

/** A page as this rule sees it: the skills it grants, and the assistant its entry registers as the page's default. */
export type PageForSkills = { defaultAgent: DefaultAgent | undefined; skills: readonly RuntimeSkillRef[] };

/**
 * The page skills an agent runs with. A page is given to the assistant its entry registers as default, and that
 * registration is the only place a page is handed to one (《智能体应用范式》“只有一个柜台”). Pages that register no
 * default, and pages that register the assistant itself, stay with the assistant — a domain application page whose author
 * chose nobody has always answered there. A user-built agent takes the skills its owner selected.
 */
export function automaticPageSkills(kind: string, pages: readonly PageForSkills[]): RuntimeSkillRef[] {
  if (!isPresetAgentKind(kind) && !isAppBuilderKind(kind) && !isOpsDiagnosisKind(kind)) return [];
  return pages.flatMap(page => page.defaultAgent?.kind === "preset"
    ? page.defaultAgent.agentKind === kind ? page.skills : []
    : kind === "regular" ? page.skills : []);
}

/** Callers supply only the page skills visible to the initiator. */
export function configuredAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  pages: readonly PageForSkills[],
): RuntimeSkillRef[] {
  const selected = [...agent.skills, ...automaticPageSkills(agent.kind, pages)];
  return [...new Map(selected.map(ref => [runtimeSkillKey(ref), ref])).values()];
}
