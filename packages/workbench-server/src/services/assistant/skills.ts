import { APP_BUILDER_SKILL } from "../app-builder/definition";
import path from "node:path";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { assistantSkillCatalogSchema, type AssistantSkillOption } from "@ontomato/contracts/assistant-chat";
import { workbenchServerResourceRoot } from "../../content/resources";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import { HttpError } from "../../utils/errors";
import { skillManager, skillReference } from "../skills/skill-manager";
import { publishSkill } from "../agent-runtime/skills";
import { tForLocale } from "../../i18n";
import { readSkillMarkdown } from '../../core/skills/manifest';
import { z } from "zod";
import { pageSkillsProjectionSchema, type PageSkillsProjection } from "@ontomato/contracts/page-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { config } from "../../config/application";

/** Read authorization anew for each directory or admission request. */
export async function readPageSkills(credentials: AssistantCredentials): Promise<PageSkillsProjection> {
  const response = await backendGet("page-skills", `${config.dataQuery.baseUrl}/platform/page-skills`, {
    headers: buildBackendHeaders(credentials.token, undefined, credentials.locale, credentials.apiKey), retries: 1,
  });
  return z.object({ success: z.literal(true), data: pageSkillsProjectionSchema }).parse(JSON.parse(response.text)).data;
}

export function effectiveAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  projection: PageSkillsProjection,
  productProfile = false,
): RuntimeSkillRef[] {
  if (productProfile) return [];
  const page = new Set(projection.registeredSkills.map(runtimeSkillKey));
  const permitted = new Set(projection.pageSkills.map(mapping => runtimeSkillKey(mapping.skill)));
  const selected = agent.skills.filter(skill => !page.has(runtimeSkillKey(skill)) || permitted.has(runtimeSkillKey(skill)));
  const effective = agent.kind === "regular" ? [...selected, ...projection.pageSkills.map(mapping => mapping.skill)] : selected;
  return [...new Map(effective.map(skill => [runtimeSkillKey(skill), skill])).values()];
}

function platformSkills() {
  return ["assistant-report","application-design"].map((name) => {
    const root = path.join(workbenchServerResourceRoot, "resources/runtime-skills", name);
    const parsed = readSkillMarkdown(path.join(root, "SKILL.md"));
    if (!parsed) throw new Error(`Missing platform skill: ${name}`);
    return { root, skill: { namespace: { kind: "provider" as const, provider: "workbench" }, name },
      title: name, description: parsed.manifest.description };
  });
}
export async function registerAssistantSkills() {
  await publishSkill(path.resolve(workbenchServerResourceRoot, "../../agent-skills/ontomato-app-builder"), APP_BUILDER_SKILL);
  for (const entry of platformSkills()) await publishSkill(entry.root, entry.skill);
  for (const skill of await skillRegistryManager.publicSkills())
    await publishSkill(skill.path, skillReference(skill, ""));
}
export async function assistantSkillCatalog(domainId: string, credentials: AssistantCredentials, projection?: PageSkillsProjection) {
  const pages = projection ?? await readPageSkills(credentials);
  const locale = credentials.locale;
  const options: AssistantSkillOption[] = [
    ...platformSkills().map(({ root: _root, ...entry }) => ({ ...entry,
      title: entry.skill.name==='assistant-report'?tForLocale(locale, "assistant.skills.report.title"):entry.title,
      description: entry.skill.name==='assistant-report'?tForLocale(locale, "assistant.skills.report.description"):entry.description })),
    { skill: { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" },
      title: tForLocale(locale, "assistant.skills.analyst.title"),
      description: tForLocale(locale, "assistant.skills.analyst.description") },
    ...(await skillManager.getAllSkills(domainId, locale)).map((s) => ({
      skill: s.skill, title: s.title, description: s.description,
    })),
  ];
  const page = new Set(pages.registeredSkills.map(runtimeSkillKey));
  const permitted = new Set(pages.pageSkills.map(mapping => runtimeSkillKey(mapping.skill)));
  const available = options.filter(option => !page.has(runtimeSkillKey(option.skill)) || permitted.has(runtimeSkillKey(option.skill)));
  for (const mapping of pages.pageSkills)
    if (!available.some(option => runtimeSkillKey(option.skill) === runtimeSkillKey(mapping.skill)))
      available.push({ skill: mapping.skill, title: mapping.skill.name, description: "" });
  return assistantSkillCatalogSchema.parse({ skills: available });
}
export async function validateAssistantSkills(domainId: string, refs: readonly RuntimeSkillRef[], credentials: AssistantCredentials, projection?: PageSkillsProjection) {
  const catalogue = await assistantSkillCatalog(domainId, credentials, projection);
  const known = new Set(catalogue.skills.map((s) => runtimeSkillKey(s.skill)));
  const names = new Set<string>();
  for (const ref of refs) {
    if (!known.has(runtimeSkillKey(ref)))
      throw new HttpError(400, `Skill is not in this domain's catalogue: ${ref.name}`, "SKILL_NOT_FOUND");
    if (names.has(ref.name)) throw new HttpError(400, "Selected skill names must be unique", "INVALID_REQUEST");
    names.add(ref.name);
  }
  return [...refs];
}

/** The caller holds the domain operation boundary until runtime admission finishes. */
export async function prepareAssistantSkills(domainId: string, agent: { kind: string; skills: readonly RuntimeSkillRef[] }, credentials: AssistantCredentials) {
  const projection = await readPageSkills(credentials);
  const effective = effectiveAssistantSkills(agent, projection);
  const selected = await validateAssistantSkills(domainId, effective, credentials, projection);
  const registry = await skillRegistryManager.forDomain(domainId);
  for (const ref of selected) {
    if (ref.namespace.kind !== "domain") continue;
    const source = registry.getSkillById(ref.name);
    if (!source || source.isPublic) throw new HttpError(404, `Domain skill not found: ${ref.name}`, "SKILL_NOT_FOUND");
    await publishSkill(source.path, ref, domainId);
  }
  // A change this run may make is covered by a page skill only when the run itself loaded one.
  const pageSkills = new Set(projection.registeredSkills.map(runtimeSkillKey));
  return { skills: selected, pageDrafts: effective.some((ref) => pageSkills.has(runtimeSkillKey(ref))) };
}
