import path from "node:path";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { assistantSkillCatalogSchema } from "@ontomato/contracts/assistant-chat";
import { workbenchServerResourceRoot } from "../../content/resources";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import { readSkillMarkdown } from "../../core/skills/manifest";
import { HttpError } from "../../utils/errors";
import { skillManager, skillReference } from "../skills/skill-manager";
import { publishSkill } from "../agent-runtime/skills";

function platformSkills() {
  return ["assistant-retrieval", "assistant-report"].map((name) => {
    const root = path.join(workbenchServerResourceRoot, "resources/runtime-skills", name);
    const parsed = readSkillMarkdown(path.join(root, "SKILL.md"));
    if (!parsed) throw new Error(`Missing platform skill: ${name}`);
    return { root, skill: { namespace: { kind: "provider" as const, provider: "workbench" }, name },
      title: parsed.manifest.title ?? name, description: parsed.manifest.description, enabled: true };
  });
}
export async function registerAssistantSkills() {
  for (const entry of platformSkills()) await publishSkill(entry.root, entry.skill);
  for (const skill of await skillRegistryManager.publicSkills())
    await publishSkill(skill.path, skillReference(skill, ""));
}
export async function assistantSkillCatalog(domainId: string, locale?: string) {
  return assistantSkillCatalogSchema.parse({ skills: [
    ...platformSkills().map(({ root: _root, ...entry }) => entry),
    ...(await skillManager.getAllSkills(domainId, locale)).map((s) => ({
      skill: s.skill, title: s.title ?? s.id, description: s.description ?? "", enabled: s.enabled, tags: s.tags,
    })),
  ] });
}
export async function validateAssistantSkills(domainId: string, refs: readonly RuntimeSkillRef[]) {
  const catalogue = await assistantSkillCatalog(domainId);
  const known = new Map(catalogue.skills.map((s) => [runtimeSkillKey(s.skill), s]));
  const names = new Set<string>();
  for (const ref of refs) {
    if (!known.has(runtimeSkillKey(ref)))
      throw new HttpError(400, `Skill is not in this domain's catalogue: ${ref.name}`, "SKILL_NOT_FOUND");
    if (names.has(ref.name)) throw new HttpError(400, "Selected skill names must be unique", "INVALID_REQUEST");
    names.add(ref.name);
  }
  return refs.filter((ref) => known.get(runtimeSkillKey(ref))!.enabled);
}

/** The caller holds the domain operation boundary until runtime admission finishes. */
export async function prepareAssistantSkills(domainId: string, refs: readonly RuntimeSkillRef[]) {
  const selected = await validateAssistantSkills(domainId, refs);
  const registry = await skillRegistryManager.forDomain(domainId);
  for (const ref of selected) {
    if (ref.namespace.kind !== "domain") continue;
    const source = registry.getSkillById(ref.name);
    if (!source || source.isPublic) throw new HttpError(404, `Domain skill not found: ${ref.name}`, "SKILL_NOT_FOUND");
    await publishSkill(source.path, ref, domainId);
  }
  return selected;
}
