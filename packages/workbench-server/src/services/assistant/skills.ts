import { publishGovernanceSkill } from "./governance";
import { GOVERNANCE_SKILL } from "./governance-definition";
import { APP_BUILDER_SKILL } from "../app-builder/definition";
import path from "node:path";
import type { RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { assistantSkillCatalogSchema, type AssistantSkillOption } from "@ontomato/contracts/assistant-chat";
import { workbenchServerResourceRoot } from "../../content/resources";
import { skillRegistryManager, type SkillRegistryManager } from "../../core/skills/registry/manager";
import { HttpError } from "../../utils/errors";
import { skillManager } from "../skills/skill-manager";
import { publishSkill, publishSkillPackage } from "../agent-runtime/skills";
import { tForLocale } from "../../i18n";
import { InvalidSkillPackageError, readSkillMarkdown } from '../../core/skills/manifest';
import { z } from "zod";
import { pageSkillsProjectionSchema, type PageSkillsProjection } from "@ontomato/contracts/page-skills";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { config } from "../../config/application";

/** Read authorization anew for each directory or admission request. */
export async function readPageSkills(initiatorCredentials: AssistantCredentials): Promise<PageSkillsProjection> {
  const response = await backendGet("page-skills", `${config.dataQuery.baseUrl}/platform/page-skills`, {
    headers: buildBackendHeaders(initiatorCredentials.token, undefined, initiatorCredentials.locale, initiatorCredentials.apiKey), retries: 1,
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

const RETRIEVAL_SKILLS = new Set(["ontomato-analyst-assistant"]);
const ANALYST_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };

/** The selectable ontology query skill is the only assistant skill that needs a retrieval caller. */
export function needsRetrievalScope(skills: readonly RuntimeSkillRef[]) {
  return skills.some(skill => skill.namespace.kind === "provider" && skill.namespace.provider === "ontology"
    && RETRIEVAL_SKILLS.has(skill.name));
}
export function hasGovernanceSkill(skills: readonly RuntimeSkillRef[]) {
  return skills.some(skill => runtimeSkillKey(skill) === runtimeSkillKey(GOVERNANCE_SKILL));
}

function platformSkills() {
  return ["assistant-report","application-design","ontomato-agent-builder"].map((name) => {
    const root = path.join(workbenchServerResourceRoot, "resources/runtime-skills", name);
    const parsed = readSkillMarkdown(path.join(root, "SKILL.md"));
    if (!parsed) throw new Error(`Missing platform skill: ${name}`);
    return { root, skill: { namespace: { kind: "provider" as const, provider: "workbench" }, name },
      title: name, description: parsed.manifest.description };
  });
}
/** The one built-in catalogue construction, shared by the catalogue and by missing-source admission. */
function builtinSkillOptions(locale?: string): AssistantSkillOption[] {
  return [
    { skill: GOVERNANCE_SKILL, title: tForLocale(locale, "assistant.default.knowledge-governance.name"), description: tForLocale(locale, "assistant.default.knowledge-governance.description") },
    ...platformSkills().map(({ root: _root, ...entry }) => ({ ...entry,
      title: entry.skill.name==='assistant-report'?tForLocale(locale, "assistant.skills.report.title"):entry.title,
      description: entry.skill.name==='assistant-report'?tForLocale(locale, "assistant.skills.report.description"):entry.description })),
    { skill: ANALYST_SKILL, title: tForLocale(locale, "assistant.skills.analyst.title"),
      description: tForLocale(locale, "assistant.skills.analyst.description") },
  ];
}
function sourceLabel(skill: SkillInfo) {
  const restriction = skill.writeRestriction;
  return restriction?.kind === "provider"
    ? `provider "${restriction.providerName}" (${restriction.providerId})`
    : skill.isPublic ? "the public skill packages" : "the domain skill packages";
}
export async function registerAssistantSkills() {
  await publishSkill(path.resolve(workbenchServerResourceRoot, "../../agent-skills/ontomato-app-builder"), APP_BUILDER_SKILL);
  for (const entry of platformSkills()) await publishSkill(entry.root, entry.skill);
  for (const skill of await skillRegistryManager.publicSkills())
    await publishSkill(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
}
export async function assistantSkillCatalog(domainId: string, credentials: AssistantCredentials,
  projection?: PageSkillsProjection, registry?: SkillRegistryManager,
  builtins: readonly AssistantSkillOption[] = builtinSkillOptions(credentials.locale)) {
  const pages = projection ?? await readPageSkills(credentials);
  const locale = credentials.locale;
  const builtinKeys = new Set(builtins.map(option => runtimeSkillKey(option.skill)));
  const options: AssistantSkillOption[] = [...builtins];
  for (const skill of await skillManager.getAllSkills(domainId, locale, registry)) {
    if (builtinKeys.has(runtimeSkillKey(skill.skill)))
      throw new InvalidSkillPackageError(`Skill ${skill.id} from ${sourceLabel(skill)} conflicts with a built-in skill of the same identity`);
    options.push({ skill: skill.skill, title: skill.title, description: skill.description });
  }
  const page = new Set(pages.registeredSkills.map(runtimeSkillKey));
  const permitted = new Set(pages.pageSkills.map(mapping => runtimeSkillKey(mapping.skill)));
  const available = options.filter(option => !page.has(runtimeSkillKey(option.skill)) || permitted.has(runtimeSkillKey(option.skill)));
  for (const mapping of pages.pageSkills)
    if (!available.some(option => runtimeSkillKey(option.skill) === runtimeSkillKey(mapping.skill)))
      available.push({ skill: mapping.skill, title: mapping.skill.name, description: "" });
  return assistantSkillCatalogSchema.parse({ skills: available });
}
export async function validateAssistantSkills(domainId: string, refs: readonly RuntimeSkillRef[], credentials: AssistantCredentials,
  projection?: PageSkillsProjection, registry?: SkillRegistryManager,
  builtins?: readonly AssistantSkillOption[]) {
  const catalogue = await assistantSkillCatalog(domainId, credentials, projection, registry, builtins);
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
export async function prepareAssistantSkills(domainId: string, agent: { kind: string; skills: readonly RuntimeSkillRef[] }, initiatorCredentials: AssistantCredentials) {
  const projection = await readPageSkills(initiatorCredentials);
  const effective = effectiveAssistantSkills(agent, projection);
  const builtins = builtinSkillOptions(initiatorCredentials.locale);
  const registry = await skillRegistryManager.forDomain(domainId);
  const selected = await validateAssistantSkills(domainId, effective, initiatorCredentials, projection, registry, builtins);
  const builtinKeys = new Set(builtins.map(option => runtimeSkillKey(option.skill)));
  for (const ref of selected) {
    if (ref.name === GOVERNANCE_SKILL.name && ref.namespace.kind === "provider" && ref.namespace.provider === GOVERNANCE_SKILL.namespace.provider)
      await publishGovernanceSkill(domainId);
    const entry = registry.getSkillByRef(ref);
    if (entry) {
      if (entry.source.kind === "domain" || entry.source.kind === "provider")
        await publishSkillPackage(await entry.provide(), domainId);
      continue;
    }
    if (!builtinKeys.has(runtimeSkillKey(ref)))
      throw new HttpError(422, `Skill is not available: ${ref.name}`, "SKILL_NOT_FOUND");
  }
  // A change this run may make is covered by a page skill only when the run itself loaded one.
  const pageSkills = new Set(projection.registeredSkills.map(runtimeSkillKey));
  return { skills: selected, pageDrafts: effective.some((ref) => pageSkills.has(runtimeSkillKey(ref))) };
}
