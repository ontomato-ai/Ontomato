import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import type { PageSkillLocator } from "@ontomato/contracts/page-skills";
import { isAppBuilderKind } from "../app-builder/definition";
import { isOpsDiagnosisKind } from "../ops-diagnosis/definition";

export function isAppBuilderEntrance(locator: PageSkillLocator) {
  return "permissionCode" in locator ? locator.permissionCode === "app-builder"
    : locator.pageKey === "app-builder";
}

/** Callers supply only the page skills visible to the initiator. */
export function configuredAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  pageSkills: readonly RuntimeSkillRef[],
  builderPageSkills: readonly RuntimeSkillRef[] = [],
): RuntimeSkillRef[] {
  const automatic = agent.kind === "regular" || isOpsDiagnosisKind(agent.kind)
    ? pageSkills
    : isAppBuilderKind(agent.kind) ? builderPageSkills : [];
  const selected = [...agent.skills, ...automatic];
  return [...new Map(selected.map(ref => [runtimeSkillKey(ref), ref])).values()];
}
