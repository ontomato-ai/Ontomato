import { configuredAssistantSkills } from "./skill-selection";
import { publishGovernanceSkill } from "./governance";
import { GOVERNANCE_SKILL } from "./governance-definition";
import { APP_BUILDER_SKILL } from "../app-builder/definition";
import path from "node:path";
import { runtimeSkillKey, type RuntimeSkillRef, type RuntimeSkillVersion } from "@ontomato/contracts/agent-runtime-skills";
import type { PageSkillContext } from "@ontomato/contracts/page-skills";
import type { SkillInfo } from "@ontomato/contracts/skills";
import { assistantSkillCatalogSchema, type AssistantSkillOption } from "@ontomato/contracts/assistant-chat";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import { HttpError } from "../../utils/errors";
import { skillManager } from "../skills/skill-manager";
import { readSkillView, resolveCurrentPageSkillMember } from "../skills/view";
import {
  publishOntologyAssistantSkill, publishSkill, publishSkillPackage, workbenchBuiltinSkillRoot,
} from "../agent-runtime/skills";
import { tForLocale } from "../../i18n";
import { InvalidSkillPackageError, readSkillMarkdown } from "../../core/skills/manifest";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

export { pageSkillMemberContext, resolveCurrentPageSkillMember, resolvePageSkillSource } from "../skills/view";

const RETRIEVAL_SKILLS = new Set(["ontomato-analyst-assistant"]);
const ANALYST_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };
const PLATFORM_SKILL_NAMES = ["assistant-report", "application-design", "ontomato-agent-builder"];

/** The selectable ontology query skill is the only assistant skill that needs a retrieval caller. */
export function needsRetrievalScope(skills: readonly RuntimeSkillRef[]) {
  return skills.some(skill => skill.namespace.kind === "provider" && skill.namespace.provider === "ontology"
    && RETRIEVAL_SKILLS.has(skill.name));
}

export function hasGovernanceSkill(skills: readonly RuntimeSkillRef[]) {
  return skills.some(skill => runtimeSkillKey(skill) === runtimeSkillKey(GOVERNANCE_SKILL));
}

function platformSkills() {
  return PLATFORM_SKILL_NAMES.map((name) => {
    const skill = { namespace: { kind: "provider" as const, provider: "workbench" }, name };
    const root = workbenchBuiltinSkillRoot(skill);
    const parsed = readSkillMarkdown(path.join(root, "SKILL.md"));
    if (!parsed) throw new Error(`Missing platform skill: ${name}`);
    return { root, skill, title: name, description: parsed.manifest.description };
  });
}

function builtinSkillOptions(locale?: string): AssistantSkillOption[] {
  return [
    { skill: GOVERNANCE_SKILL, title: tForLocale(locale, "assistant.default.knowledge-governance.name"), description: tForLocale(locale, "assistant.default.knowledge-governance.description") },
    ...platformSkills().map(({ root: _root, ...entry }) => ({ ...entry,
      title: entry.skill.name === "assistant-report" ? tForLocale(locale, "assistant.skills.report.title") : entry.title,
      description: entry.skill.name === "assistant-report" ? tForLocale(locale, "assistant.skills.report.description") : entry.description })),
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
  await publishSkill(workbenchBuiltinSkillRoot(APP_BUILDER_SKILL), APP_BUILDER_SKILL);
  for (const entry of platformSkills()) await publishSkill(entry.root, entry.skill);
  for (const skill of await skillRegistryManager.publicSkills())
    await publishSkill(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
}

export async function readAssistantSkillView(domainId: string, initiatorCredentials: AssistantCredentials) {
  const view = await readSkillView(domainId, initiatorCredentials);
  const builtins = builtinSkillOptions(initiatorCredentials.locale);
  const builtinKeys = new Set(builtins.map(option => runtimeSkillKey(option.skill)));
  const options = new Map(builtins
    .filter(option => !view.unavailableStoredPageSkill(option.skill))
    .map(option => [runtimeSkillKey(option.skill), option]));
  for (const info of skillManager.skillsInRegistry(view.registry, initiatorCredentials.locale)) {
    const key = runtimeSkillKey(info.skill);
    if (builtinKeys.has(key))
      throw new InvalidSkillPackageError(`Skill ${info.id} from ${sourceLabel(info)} conflicts with a built-in skill of the same identity`);
    options.set(key, { skill: info.skill, title: info.title, description: info.description });
  }
  // Legacy public mappings can supply the catalogue label independently of their publisher.
  for (const { locator } of view.pageSkills) {
    const skill = view.publicPageSkill(locator);
    if (skill && !options.has(runtimeSkillKey(skill)))
      options.set(runtimeSkillKey(skill), { skill, title: skill.name, description: "" });
  }
  return {
    ...view,
    options: [...options.values()],
    hasSkill: (ref: RuntimeSkillRef) => options.has(runtimeSkillKey(ref)),
  };
}

export type AssistantSkillView = Awaited<ReturnType<typeof readAssistantSkillView>>;

export function visibleAssistantSkillRefs(refs: readonly RuntimeSkillRef[], view: AssistantSkillView): RuntimeSkillRef[] {
  return [...new Map(refs.filter(view.hasSkill).map(ref => [runtimeSkillKey(ref), ref])).values()];
}

export function hasHiddenAssistantSkillRefs(refs: readonly RuntimeSkillRef[], view: AssistantSkillView): boolean {
  return refs.some(view.hiddenStoredSkill);
}

export function effectiveAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  view: AssistantSkillView,
  productProfile = false,
): RuntimeSkillRef[] {
  if (productProfile) return [];
  return configuredAssistantSkills(
    { kind: agent.kind, skills: agent.skills.filter(view.hasSkill) },
    view.pageSkills.flatMap(group => group.skills),
  );
}

export async function assistantSkillCatalog(domainId: string, credentials: AssistantCredentials, view?: AssistantSkillView) {
  const resolved = view ?? await readAssistantSkillView(domainId, credentials);
  return assistantSkillCatalogSchema.parse({ skills: resolved.options });
}

function skillNotFound() {
  return new HttpError(400, "Skill is not in this domain's catalogue", "SKILL_NOT_FOUND");
}

function checkSkillSelection(refs: readonly RuntimeSkillRef[], view: AssistantSkillView) {
  const names = new Set<string>();
  for (const ref of refs) {
    if (!view.hasSkill(ref)) throw skillNotFound();
    if (names.has(ref.name)) throw new HttpError(400, "Selected skill names must be unique", "INVALID_REQUEST");
    names.add(ref.name);
  }
}

export async function validateAssistantSkills(domainId: string, refs: readonly RuntimeSkillRef[], credentials: AssistantCredentials,
  view?: AssistantSkillView,
) {
  checkSkillSelection(refs, view ?? await readAssistantSkillView(domainId, credentials));
  return [...refs];
}

export function loadedPageSkillVersion(ref: RuntimeSkillRef, loaded: readonly RuntimeSkillVersion[]): RuntimeSkillVersion | null {
  const actual = loaded.find(({ skill }) => runtimeSkillKey(skill) === runtimeSkillKey(ref));
  return actual ? { skill: actual.skill, digest: actual.digest } : null;
}

async function publishSelectedSkill(domainId: string, ref: RuntimeSkillRef, view: AssistantSkillView): Promise<RuntimeSkillVersion> {
  const key = runtimeSkillKey(ref);
  if (key === runtimeSkillKey(GOVERNANCE_SKILL)) return publishGovernanceSkill(domainId);
  if (key === runtimeSkillKey(ANALYST_SKILL)) return publishOntologyAssistantSkill(domainId);

  const entry = view.registry.getSkillByRef(ref);
  if (entry) {
    const { skill, digest } = entry.source.kind === "public"
      ? await publishSkill(entry.source.path, ref)
      : await publishSkillPackage(await entry.provide(), domainId);
    return { skill, digest };
  }
  if (key === runtimeSkillKey(APP_BUILDER_SKILL) ||
    (ref.namespace.kind === "provider" && ref.namespace.provider === "workbench" && PLATFORM_SKILL_NAMES.includes(ref.name))) {
    const { skill, digest } = await publishSkill(workbenchBuiltinSkillRoot(ref), ref);
    return { skill, digest };
  }
  throw unavailableRunSkill();
}

function unavailableRunSkill() {
  return new HttpError(422, "A selected skill is not available", "SKILL_NOT_FOUND");
}

/** One initiator view binds this turn to the versions returned by the selected publishers. */
export async function prepareAssistantSkills(domainId: string, agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  initiatorCredentials: AssistantCredentials, pageSkillContext?: PageSkillContext,
) {
  const view = await readAssistantSkillView(domainId, initiatorCredentials);
  for (const ref of agent.skills) {
    if (!view.hasSkill(ref) && !view.unavailableStoredPageSkill(ref)) throw unavailableRunSkill();
  }
  let currentPage = null;
  if (pageSkillContext?.mode === "member" && pageSkillContext.member) {
    currentPage = await resolveCurrentPageSkillMember(view, pageSkillContext.locator, pageSkillContext.member);
    if (!currentPage) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
  }
  const selected = effectiveAssistantSkills(agent, view);
  checkSkillSelection(selected, view);
  const skills: RuntimeSkillVersion[] = [];
  for (const ref of selected) skills.push(await publishSelectedSkill(domainId, ref, view));
  return { skills, pageDrafts: selected.some(view.pageSkillIsAvailable),
    currentPage: currentPage && loadedPageSkillVersion(currentPage.member.ref, skills) ? currentPage : null };
}
