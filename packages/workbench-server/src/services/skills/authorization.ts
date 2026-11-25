import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { SkillEntry } from "../../core/skills/types";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { decideObjects, requireObject, retireObject, type ObjectDefinition, type ObjectVerb } from "../product-governance/authorization";

function domainSkillDefinition(domainId: string, entry: SkillEntry): ObjectDefinition {
  return {
    target: { domainId, kind: "SKILL", id: entry.skill.name },
    // Installed packages are published definitions. The domain library has no author record.
    ownerFacts: { ownerId: null, state: "PUBLISHED" },
  };
}

export async function decideDomainSkills(
  domainId: string, entries: readonly SkillEntry[], verb: ObjectVerb, credentials: AssistantCredentials,
) {
  const domainEntries = entries.filter(entry => entry.source.kind === "domain");
  const decisions = await decideObjects(domainEntries.map(entry => ({ ...domainSkillDefinition(domainId, entry), verb })), credentials);
  return new Map(domainEntries.map((entry, index) => [runtimeSkillKey(entry.skill), decisions[index]]));
}

export async function requireSkillAccess(
  domainId: string, entry: SkillEntry, verb: ObjectVerb, credentials: AssistantCredentials,
) {
  if (entry.source.kind === "domain") {
    await requireObject({ ...domainSkillDefinition(domainId, entry), verb }, credentials);
  }
  return entry;
}

export function requireSkillCreation(credentials: AssistantCredentials) {
  return requireObject({ create: "SKILL" }, credentials);
}

export function retireDomainSkill(domainId: string, entry: SkillEntry, credentials: AssistantCredentials) {
  return retireObject(domainSkillDefinition(domainId, entry), credentials);
}
