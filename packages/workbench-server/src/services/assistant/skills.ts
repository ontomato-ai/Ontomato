import { configuredAssistantSkills } from "./skill-selection";
import { publishGovernanceSkill } from "./governance";
import { GOVERNANCE_SKILL } from "./governance-definition";
import { isPageOperatorSkill, runtimeSkillKey, runtimeSkillRefFromSelection, type RuntimeSkillRef, type RuntimeSkillSelection, type RuntimeSkillVersion } from "@ontomato/contracts/agent-runtime-skills";
import type { CurrentPageContext } from "@ontomato/contracts/page-context";
import { assistantSkillCatalogSchema, type AssistantSkillOption } from "@ontomato/contracts/assistant-chat";
import { skillRegistryManager } from "../../core/skills/registry/manager";
import type { SkillEntry } from "../../core/skills/types";
import { HttpError } from "../../utils/errors";
import { skillManager } from "../skills/skill-manager";
import { readSkillView, type SkillView } from "../skills/view";
import { builtinSkillEntries } from "../skills/builtin-catalog";
import { publishOntologyAssistantSkill, publishSkill, publishSkillPackage } from "../agent-runtime/skills";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { requirePanelEntry } from "../product-panels/application-use";
import { isApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type { AssistantOwner } from "./store";

const RETRIEVAL_SKILLS = new Set(["ontomato-analyst-assistant"]);
const ANALYST_SKILL: RuntimeSkillRef = { namespace: { kind: "provider", provider: "ontology" }, name: "ontomato-analyst-assistant" };
const STARTUP_PLATFORM_SKILL_NAMES = ["ontomato-app-builder", "assistant-report", "application-design", "ontomato-agent-builder", "ontomato-page-operator"];

/** The selectable ontology query skill is the only assistant skill that needs a retrieval caller. */
export function needsRetrievalScope(skills: readonly RuntimeSkillRef[]) {
  return skills.some(skill => skill.namespace.kind === "provider" && skill.namespace.provider === "ontology"
    && RETRIEVAL_SKILLS.has(skill.name));
}

export function hasGovernanceSkill(skills: readonly RuntimeSkillRef[]) {
  return skills.some(skill => runtimeSkillKey(skill) === runtimeSkillKey(GOVERNANCE_SKILL));
}

function assistantSkillOption(entry: SkillEntry, locale?: string): AssistantSkillOption {
  const { skill } = entry;
  const { title, description } = skillManager.describeSkill(entry, locale);
  return {
    skill, title, description,
    ...(entry.selectionRestricted ? { unavailable: { reason: tForLocale(locale, "assistant.skills.systemRestricted.reason") } } : {}),
  };
}

export async function registerAssistantSkills() {
  const startup = new Set(STARTUP_PLATFORM_SKILL_NAMES);
  for (const entry of builtinSkillEntries()) {
    if (entry.source.kind === "public" && startup.has(entry.skill.name))
      await publishSkill(entry.source.path, entry.skill);
  }
  for (const skill of await skillRegistryManager.publicSkills())
    await publishSkill(skill.path, { namespace: { kind: "provider", provider: "workbench" }, name: skill.id });
}

export async function countAssistantSkills(domainId: string, credentials: AssistantCredentials): Promise<number> {
  return countAssistantSkillsFromView(await readSkillView(domainId, credentials));
}

export function countAssistantSkillsFromView(view: SkillView): number {
  return view.registry.getSkills().length;
}

export async function readAssistantSkillView(domainId: string, initiatorCredentials: AssistantCredentials, userId?: string) {
  const view = await readSkillView(domainId, initiatorCredentials, userId);
  const entries = view.registry.getSkills();
  const keys = new Map(entries.map(entry => [runtimeSkillKey(entry.skill), entry] as const));
  return {
    ...view,
    options: entries.map(entry => assistantSkillOption(entry, initiatorCredentials.locale)),
    hasSkill: (ref: RuntimeSkillRef) => keys.has(runtimeSkillKey(ref)),
    isSkillSelectable: (ref: RuntimeSkillRef) => {
      const entry = keys.get(runtimeSkillKey(ref));
      return !!entry && !entry.selectionRestricted;
    },
  };
}

export type AssistantSkillView = Awaited<ReturnType<typeof readAssistantSkillView>>;

export function visibleAssistantSkillRefs(refs: readonly RuntimeSkillRef[], view: AssistantSkillView): RuntimeSkillRef[] {
  return [...new Map(refs.filter(ref => view.hasSkill(ref)).map(ref => [runtimeSkillKey(ref), ref])).values()];
}

export function hasHiddenAssistantSkillRefs(refs: readonly RuntimeSkillRef[], view: AssistantSkillView): boolean {
  return visibleAssistantSkillRefs(refs, view).length !== [...new Map(refs.map(ref => [runtimeSkillKey(ref), ref])).values()].length;
}

export function effectiveAssistantSkills(
  agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  view?: Pick<AssistantSkillView, "hasSkill" | "isSkillSelectable">,
): RuntimeSkillRef[] {
  return configuredAssistantSkills({ kind: agent.kind, skills: view ? agent.skills.filter(view.isSkillSelectable) : agent.skills });
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
    if (!view.isSkillSelectable(ref)) throw skillNotFound();
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

export function loadedSkillVersion(ref: RuntimeSkillRef, loaded: readonly RuntimeSkillVersion[]): RuntimeSkillVersion | null {
  const actual = loaded.find(({ skill }) => runtimeSkillKey(skill) === runtimeSkillKey(ref));
  return actual ? { skill: actual.skill, digest: actual.digest } : null;
}

async function publishSelectedSkill(domainId: string, ref: RuntimeSkillSelection, view: AssistantSkillView): Promise<RuntimeSkillVersion> {
  const key = runtimeSkillKey(ref);
  let version: RuntimeSkillVersion;
  if (key === runtimeSkillKey(GOVERNANCE_SKILL)) version = await publishGovernanceSkill(domainId);
  else if (key === runtimeSkillKey(ANALYST_SKILL)) version = await publishOntologyAssistantSkill(domainId);
  else {
    const entry = view.registry.getSkillByRef(ref);
    if (!entry || entry.selectionRestricted || entry.source.kind === "generated")
      throw new HttpError(422, "A selected skill is not available", "SKILL_NOT_FOUND");
    version = entry.source.kind === "public"
      ? await publishSkill(entry.source.path, runtimeSkillRefFromSelection(ref))
      : await publishSkillPackage(await entry.provide(), domainId);
  }
  return { ...version, ...(ref.preload ? { preload: true } : {}) };
}

async function validateCurrentPage(owner: AssistantOwner, credentials: AssistantCredentials, pageSkillContext?: CurrentPageContext) {
  if (!pageSkillContext) return null;
  const entry = await requirePanelEntry(credentials, {
    applicationId: pageSkillContext.applicationId,
    useId: pageSkillContext.useId,
  }, owner);
  if (!isApplicationPanelUse(entry.use) || entry.use.id !== pageSkillContext.useId || entry.use.pageKey !== pageSkillContext.pageKey
      || entry.use.panelId !== pageSkillContext.panelId || entry.use.path !== pageSkillContext.path)
    throw new HttpError(403, "Current page does not match its admitted entry", "FORBIDDEN");
  return pageSkillContext;
}

/** Bind one user-initiated turn to the exact versions of its selected skills. */
export async function prepareAssistantSkills(domainId: string, agent: { kind: string; skills: readonly RuntimeSkillRef[] },
  initiatorCredentials: AssistantCredentials, pageSkillContext?: CurrentPageContext, userId?: string,
) {
  const owner = { domainId, userId: userId ?? "" };
  const currentPage = await validateCurrentPage(owner, initiatorCredentials, pageSkillContext);
  const view = await readAssistantSkillView(domainId, initiatorCredentials, userId);
  const selected = effectiveAssistantSkills(agent, view);
  checkSkillSelection(selected, view);
  const skills: RuntimeSkillVersion[] = [];
  for (const ref of selected) skills.push(await publishSelectedSkill(domainId, ref, view));
  return {
    skills,
    pageControl: skills.some(({ skill }) => isPageOperatorSkill(skill)),
    currentPage,
  };
}

/** System agents validate a page-initiated placement; their intrinsic skill list already publishes the operator. */
export async function validateCurrentPageContext(domainId: string, credentials: AssistantCredentials,
  pageSkillContext: CurrentPageContext, userId?: string,
) {
  return validateCurrentPage({ domainId, userId: userId ?? "" }, credentials, pageSkillContext);
}
