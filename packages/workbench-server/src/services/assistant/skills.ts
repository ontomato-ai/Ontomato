import { configuredAssistantSkills } from "./skill-selection";
import { publishGovernanceSkill } from "./governance";
import { GOVERNANCE_SKILL } from "./governance-definition";
import { APP_BUILDER_SKILL, isAppBuilderKind } from "../app-builder/definition";
import path from "node:path";
import { runtimeSkillKey, type RuntimeSkillRef, type RuntimeSkillVersion } from "@ontomato/contracts/agent-runtime-skills";
import type { PageSkillContext, PageSkillLocator } from "@ontomato/contracts/page-skills";
import type { SkillCatalogReason } from "@ontomato/contracts/skills";
import { assistantSkillCatalogSchema, type AssistantSkillOption } from "@ontomato/contracts/assistant-chat";
import { SkillSourceRecordError, type SkillPackageContext } from "../../core/skills/providers";
import { skillRegistryManager, skillSourceLabel } from "../../core/skills/registry/manager";
import type { SkillEntry } from "../../core/skills/types";
import { HttpError } from "../../utils/errors";
import { skillManager } from "../skills/skill-manager";
import { isStoredProtectedSkillRef, pageSkillDefaultAgent, readSkillView, resolveCurrentPageSkillMember, validateApplicationPageSkillEntry, type AuthorizedPageSkillMember, type SkillView } from "../skills/view";
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
    return { kind: "platform" as const, root, skill, manifest: parsed.manifest };
  });
}

type AssistantSkillSource = SkillEntry | ReturnType<typeof platformSkills>[number]
  | { kind: "governance" | "analyst" | "legacy"; skill: RuntimeSkillRef };

function assistantSkillOption(entry: AssistantSkillSource, locale?: string): AssistantSkillOption {
  const { skill } = entry;
  if ("source" in entry) {
    const { title, description } = skillManager.describeSkill(entry, locale);
    return { skill, title, description };
  }
  switch (entry.kind) {
    case "governance":
      return { skill, title: tForLocale(locale, "assistant.default.knowledge-governance.name"),
        description: tForLocale(locale, "assistant.default.knowledge-governance.description") };
    case "analyst":
      return { skill, title: tForLocale(locale, "assistant.skills.analyst.title"),
        description: tForLocale(locale, "assistant.skills.analyst.description") };
    case "platform":
      return skill.name === "assistant-report"
        ? { skill, title: tForLocale(locale, "assistant.skills.report.title"), description: tForLocale(locale, "assistant.skills.report.description") }
        : { skill, title: skill.name, description: entry.manifest.description };
    case "legacy":
      return { skill, title: skill.name, description: "" };
  }
}

export async function registerAssistantSkills() {
  await publishSkill(workbenchBuiltinSkillRoot(APP_BUILDER_SKILL), APP_BUILDER_SKILL);
  for (const entry of platformSkills()) await publishSkill(entry.root, entry.skill);
  for (const skill of await skillRegistryManager.publicSkills())
    await publishSkill(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
}

function assistantSkillSources(view: SkillView) {
  const builtins: AssistantSkillSource[] = [
    { kind: "governance", skill: GOVERNANCE_SKILL },
    ...platformSkills(),
    { kind: "analyst", skill: ANALYST_SKILL },
  ];
  const builtinKeys = new Set(builtins.map(({ skill }) => runtimeSkillKey(skill)));
  const sources = new Map<string, AssistantSkillSource>();
  for (const entry of builtins) {
    if (!view.unavailableStoredPageSkill(entry.skill)) sources.set(runtimeSkillKey(entry.skill), entry);
  }
  for (const entry of view.registry.getSkills()) {
    const key = runtimeSkillKey(entry.skill);
    if (builtinKeys.has(key))
      throw new InvalidSkillPackageError(`Skill ${entry.skill.name} from ${skillSourceLabel(entry.source)} conflicts with a built-in skill of the same identity`);
    sources.set(key, entry);
  }
  // Legacy public mappings can supply a catalogue entry independently of their publisher.
  for (const { locator } of view.pageSkills) {
    const skill = view.publicPageSkill(locator);
    if (!skill || isStoredProtectedSkillRef(skill)) continue;
    const key = runtimeSkillKey(skill);
    if (!sources.has(key)) sources.set(key, { kind: "legacy", skill });
  }
  return sources;
}

export async function countAssistantSkills(domainId: string, credentials: AssistantCredentials): Promise<number> {
  return assistantSkillSources(await readSkillView(domainId, credentials)).size;
}

export async function readAssistantSkillView(domainId: string, initiatorCredentials: AssistantCredentials, userId?: string) {
  const view = await readSkillView(domainId, initiatorCredentials, userId);
  const sources = assistantSkillSources(view);
  return {
    ...view,
    options: [...sources.values()].map(entry => assistantSkillOption(entry, initiatorCredentials.locale)),
    hasSkill: (ref: RuntimeSkillRef) => sources.has(runtimeSkillKey(ref)),
  };
}

export type AssistantSkillView = Awaited<ReturnType<typeof readAssistantSkillView>>;

export function visibleAssistantSkillRefs(refs: readonly RuntimeSkillRef[], view: AssistantSkillView): RuntimeSkillRef[] {
  return [...new Map(refs.filter(ref => view.hasSkill(ref) || view.registry.failedManifests.has(runtimeSkillKey(ref)))
    .map(ref => [runtimeSkillKey(ref), ref])).values()];
}

export function hasHiddenAssistantSkillRefs(refs: readonly RuntimeSkillRef[], view: AssistantSkillView): boolean {
  return refs.some(view.hiddenStoredSkill);
}

export function effectiveAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  view: Pick<AssistantSkillView, "pageSkills" | "hasSkill">,
): RuntimeSkillRef[] {
  return configuredAssistantSkills(
    { kind: agent.kind, skills: agent.skills.filter(view.hasSkill) },
    view.pageSkills.map(group => ({ defaultAgent: pageSkillDefaultAgent(group), skills: group.skills })),
  );
}

export async function assistantSkillCatalog(domainId: string, credentials: AssistantCredentials, view?: AssistantSkillView) {
  const resolved = view ?? await readAssistantSkillView(domainId, credentials);
  return assistantSkillCatalogSchema.parse({ skills: resolved.options, ...(resolved.diagnostics && { diagnostics: resolved.diagnostics }) });
}

function skillNotFound() {
  return new HttpError(400, "Skill is not in this domain's catalogue", "SKILL_NOT_FOUND");
}

function checkSkillSelection(refs: readonly RuntimeSkillRef[], view: AssistantSkillView) {
  const names = new Set<string>();
  for (const ref of refs) {
    if (!view.hasSkill(ref)) {
      view.checkUnresolvedInput(ref);
      throw skillNotFound();
    }
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

async function publishSelectedSkill(domainId: string, ref: RuntimeSkillRef, view: AssistantSkillView,
  packageContext?: SkillPackageContext,
): Promise<RuntimeSkillVersion> {
  const key = runtimeSkillKey(ref);
  if (key === runtimeSkillKey(GOVERNANCE_SKILL)) return publishGovernanceSkill(domainId);
  if (key === runtimeSkillKey(ANALYST_SKILL)) return publishOntologyAssistantSkill(domainId);

  const entry = view.registry.getSkillByRef(ref);
  if (entry) {
    const { skill, digest } = entry.source.kind === "public"
      ? await publishSkill(entry.source.path, ref)
      : await publishSkillPackage(await entry.provide(packageContext), domainId);
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

type PageSkillFailure = {
  reason: SkillCatalogReason | "source_unavailable" | "invalid_package" | "publication_failed";
  resourceId?: string;
  field?: string;
};

type SkippedPageSkill = PageSkillFailure & {
  skill: RuntimeSkillRef;
  panelId?: string;
  entrances: PageSkillLocator[];
};

function publicationFailure(error: unknown): PageSkillFailure {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof SkillSourceRecordError) return cause.detail;
  if (error instanceof InvalidSkillPackageError) return { reason: "invalid_package" };
  if (error instanceof Error && "code" in error && (error.code === "SKILL_SOURCE_UNAVAILABLE" || error.code === "SKILL_NOT_FOUND"))
    return { reason: "source_unavailable" };
  return { reason: "publication_failed" };
}

/** One initiator view binds this turn to the versions returned by the selected publishers. */
export async function prepareAssistantSkills(domainId: string, agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  initiatorCredentials: AssistantCredentials, pageSkillContext?: PageSkillContext, userId?: string,
) {
  await validateApplicationPageSkillEntry({ domainId, initiatorCredentials, userId }, pageSkillContext);
  const view = await readAssistantSkillView(domainId, initiatorCredentials, userId);
  for (const ref of agent.skills) {
    view.requireCertainStoredSkill(ref);
    view.requireReadableManifest(ref);
    if (!view.hasSkill(ref) && !view.unavailableStoredPageSkill(ref)) throw unavailableRunSkill();
  }
  let currentPage: Omit<AuthorizedPageSkillMember, "packageContext"> | null = null;
  let packageContext: SkillPackageContext | undefined;
  if (pageSkillContext?.mode === "member" && pageSkillContext.member) {
    const resolved = await resolveCurrentPageSkillMember(view, pageSkillContext.locator, pageSkillContext.member);
    if (!resolved) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
    ({ packageContext, ...currentPage } = resolved);
  }
  const selected = effectiveAssistantSkills(agent, view);
  const required = new Set(agent.skills.map(runtimeSkillKey));
  const currentRef = currentPage?.member.ref ??
    (pageSkillContext?.mode === "public" ? view.publicPageSkill(pageSkillContext.locator) : null);
  const currentKey = currentRef ? runtimeSkillKey(currentRef) : undefined;
  if (currentKey) required.add(currentKey);
  const regular = agent.kind === "regular";
  const optional = (ref: RuntimeSkillRef) => (regular || isAppBuilderKind(agent.kind)) && !required.has(runtimeSkillKey(ref));
  const skipped: SkippedPageSkill[] = [];
  function skip(ref: RuntimeSkillRef, failure: PageSkillFailure) {
    const page = view.admittedPageSkill(ref) ?? {
      entrances: view.pageSkills.filter(group => group.skills.some(skill => runtimeSkillKey(skill) === runtimeSkillKey(ref)))
        .map(group => group.locator),
    };
    skipped.push({ skill: ref, ...page, ...failure });
  }
  const available = selected.filter(ref => {
    if (view.hasSkill(ref) || !optional(ref)) return true;
    const failure = view.registry.failedManifests.get(runtimeSkillKey(ref));
    skip(ref, failure
      ? { reason: failure.reason, resourceId: failure.resourceId, field: failure.field }
      : { reason: "source_unavailable" });
    return false;
  });
  checkSkillSelection(available, view);
  const skills: RuntimeSkillVersion[] = [];
  for (const ref of available) {
    try {
      const context = currentKey === runtimeSkillKey(ref) ? packageContext : undefined;
      skills.push(await publishSelectedSkill(domainId, ref, view, context));
    } catch (error) {
      if (!optional(ref)) throw error;
      skip(ref, publicationFailure(error));
    }
  }
  // Unknown dependencies do not authorize details about a source.
  const sourceUnavailable = regular && (view.diagnostics?.sourceUnavailable ?? false);
  return { skills, pageControl: skills.some(({ skill }) => view.pageSkillIsAvailable(skill)),
    currentPage: currentPage && loadedPageSkillVersion(currentPage.member.ref, skills) ? currentPage : null,
    ...((skipped.length > 0 || sourceUnavailable) && { skippedPageSkills: { items: skipped, sourceUnavailable } }) };
}

/** Resolves and publishes the active page skill for a system agent turn that receives a pageSkillContext. */
export async function prepareCurrentPageSkill(
  domainId: string,
  initiatorCredentials: AssistantCredentials,
  pageSkillContext: PageSkillContext,
  userId?: string,
): Promise<{ skill: RuntimeSkillVersion; currentPage: Omit<AuthorizedPageSkillMember, "packageContext"> | null } | null> {
  await validateApplicationPageSkillEntry({ domainId, initiatorCredentials, userId }, pageSkillContext);
  const view = await readAssistantSkillView(domainId, initiatorCredentials, userId);
  let currentPage: Omit<AuthorizedPageSkillMember, "packageContext"> | null = null;
  let packageContext: SkillPackageContext | undefined;
  if (pageSkillContext.mode === "member" && pageSkillContext.member) {
    const resolved = await resolveCurrentPageSkillMember(view, pageSkillContext.locator, pageSkillContext.member);
    if (!resolved) throw new HttpError(403, "Page skill is unavailable", "PAGE_SKILL_FORBIDDEN");
    ({ packageContext, ...currentPage } = resolved);
  }
  const ref = currentPage?.member.ref ??
    (pageSkillContext.mode === "public" ? view.publicPageSkill(pageSkillContext.locator) : null);
  if (!ref) return null;
  if (!view.hasSkill(ref)) throw unavailableRunSkill();
  const skill = await publishSelectedSkill(domainId, ref, view, packageContext);
  return { skill, currentPage };
}
