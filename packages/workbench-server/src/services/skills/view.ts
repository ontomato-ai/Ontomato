import { z } from "zod";
import { runtimeSkillKey, standardSkillFrontmatterSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import {
  pageSkillPlacementKey, pageSkillsProjectionSchema, type PageSkillContext, type PageSkillEntrance, type PageSkillGroup,
  type PageSkillLocator, type PageSkillMember, type PageSkillSource,
} from "@ontomato/contracts/page-skills";
import { config } from "../../config/application";
import { isApplicationPanelUse, type ApplicationEntryResolution } from "@ontomato/contracts/product-panels";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import type { SkillCatalogDiagnostics } from "@ontomato/contracts/skills";
import {
  isProtectedSkillName, protectedSourceSkillRef, registeredSkillProviders, SkillSourceRecordError,
  type ProtectedSkillOffering, type SkillPackageContext, type SkillSourceFailure,
} from "../../core/skills/providers";
import { skillRegistryManager, type ListedProtectedSkill, type ListedSourceFailure } from "../../core/skills/registry/manager";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { personalEntry, requirePanelEntry } from "../product-panels/application-use";
import { PANEL_SKILL_PROVIDER_ID } from "../product-panels/skill-identity";
import { panelSkillProvider } from "../product-panels/skill-provider";
import { grantedProductIds, productGrantsAllowedBatch } from "../product-governance/grants";

const javaPageSkills = z.object({
  success: z.literal(true),
  data: pageSkillsProjectionSchema,
});
const LEGACY_AGGREGATE_NAME = /^panel-(?:menu|page)-(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[a-f0-9]{24}$/u;

export interface SkillSourceIdentity {
  providerId: string;
  sourceKey: string;
}

interface PageSkillViewCaller {
  domainId: string;
  userId?: string;
  initiatorCredentials: AssistantCredentials;
}

type ApplicationUseSkillSource = Extract<PageSkillSource, { kind: "application-use" }>;

export interface PageSkillSourceOwner {
  kinds: readonly PageSkillSource["kind"][];
  listAssociations(caller: PageSkillViewCaller): Promise<readonly { entrance: PageSkillEntrance; identity: SkillSourceIdentity }[]>;
  resolve(input: PageSkillViewCaller & { entrance: PageSkillEntrance; source: PageSkillSource }): Promise<SkillSourceIdentity | null>;
}

const sourceOwners = new Map<PageSkillSource["kind"], PageSkillSourceOwner>();

export function registerPageSkillSourceOwner(owner: PageSkillSourceOwner) {
  for (const kind of owner.kinds) {
    if (kind === "application-use" || sourceOwners.has(kind))
      throw new Error(`Page skill source kind already has an owner: ${kind}`);
    sourceOwners.set(kind, owner);
  }
}

function callerHeaders({ token, locale, apiKey }: AssistantCredentials) {
  return buildBackendHeaders(token, undefined, locale, apiKey);
}

async function javaPageSkillProjection(credentials: AssistantCredentials, entrance?: PageSkillEntrance, panelId?: string) {
  const query = entrance && new URLSearchParams({
    applicationId: entrance.applicationId,
    entryKey: entrance.entryKey,
    pageKey: entrance.pageKey,
    ...(panelId !== undefined && { panelId }),
  });
  const response = await backendGet("page-skills", `${config.dataQuery.baseUrl}/platform/page-skills${query ? `?${query}` : ""}`,
    { headers: callerHeaders(credentials), retries: 1 });
  return javaPageSkills.parse(JSON.parse(response.text)).data;
}

async function currentApplicationPanel(caller: PageSkillViewCaller, entrance: PageSkillEntrance,
  source: ApplicationUseSkillSource,
) {
  if (source.applicationId !== entrance.applicationId || source.useId !== entrance.entryKey) return null;
  let entry;
  try {
    entry = await requirePanelEntry(caller.initiatorCredentials, source);
  } catch (error) {
    if (error instanceof HttpError && [400, 403, 404].includes(error.status)) return null;
    if (error instanceof HttpError && error.code === "PANEL_ENTRY_SOURCE_MISMATCH")
      throw new HttpError(502, error.message, "SKILL_SOURCE_UNAVAILABLE");
    throw error;
  }
  if (!isApplicationPanelUse(entry.use) || entry.use.pageKey !== entrance.pageKey) return null;
  const owner = caller.userId ? { domainId: caller.domainId, userId: caller.userId } : undefined;
  const actual = await personalEntry({ ...entry, use: entry.use }, owner);
  return { use: actual.use, applicationId: actual.applicationId, registeredPanelId: entry.use.panelId };
}

export function isStoredProtectedSkillRef(ref: RuntimeSkillRef) {
  return isProtectedSkillName(ref.name) || (ref.namespace.kind === "domain" && LEGACY_AGGREGATE_NAME.test(ref.name));
}

type ListedPageSkill = ListedProtectedSkill | ListedSourceFailure;

function requiredResources(source: ListedPageSkill) {
  return "resourceIds" in source ? source.resourceIds : source.knownRequiredResourceIds;
}

async function grantedSkillResources(sources: readonly ListedPageSkill[], credentials: AssistantCredentials,
  usableIds?: ReadonlySet<string>,
) {
  const required = new Set(sources.flatMap(requiredResources));
  const platformIds = [...required].filter(isBuiltinProductId);
  const [domainIds, platformGrants] = await Promise.all([
    required.size > platformIds.length ? usableIds ?? grantedProductIds("use", credentials) : [],
    productGrantsAllowedBatch(platformIds, "use", credentials),
  ]);
  return new Set([...domainIds, ...platformIds.filter(id => platformGrants[id])]);
}

function sourceIdentityKey({ providerId, sourceKey }: SkillSourceIdentity) {
  return JSON.stringify([providerId, sourceKey]);
}

function pageAuthorization(java: Awaited<ReturnType<typeof javaPageSkillProjection>>,
  sources: readonly ListedPageSkill[], grants: ReadonlySet<string>,
  associations: readonly { entrance: PageSkillEntrance; identity: SkillSourceIdentity }[],
) {
  const registered = new Set(java.registeredSkills.map(runtimeSkillKey));
  const publicSkills = new Map<string, RuntimeSkillRef>();
  const allowedPageKeys = new Set<string>();
  const groups = new Map<string, PageSkillGroup>();
  for (const { skill, defaults, ...locator } of java.pageSkills) {
    const key = pageSkillPlacementKey(locator);
    if (skill) {
      publicSkills.set(key, skill);
      allowedPageKeys.add(runtimeSkillKey(skill));
    }
    groups.set(key, { locator, skills: skill ? [skill] : [], defaults: defaults ?? [] });
  }
  const admitted = new Map<string, { source: SkillSourceIdentity; entrances: PageSkillEntrance[] }>();
  const admittedEntrances = new Set(java.admittedEntrances?.map(pageSkillPlacementKey));
  const current = new Set<string>();
  const byEntrance = new Map<string, Set<string>>();
  const uncertain = new Set<string>();
  const refsBySource = new Map<string, RuntimeSkillRef>();
  const ownedEntrances = new Map<string, PageSkillEntrance[]>();
  for (const { entrance, identity } of associations) {
    const key = sourceIdentityKey(identity);
    const entrances = ownedEntrances.get(key) ?? [];
    entrances.push(entrance);
    ownedEntrances.set(key, entrances);
  }
  for (const source of sources) {
    const key = runtimeSkillKey(source.skill);
    const identityKey = sourceIdentityKey(source);
    refsBySource.set(identityKey, source.skill);
    current.add(key);
    if (!requiredResources(source).every(id => grants.has(id))) continue;
    const staticEntrances = source.entrances.filter(entrance => admittedEntrances.has(pageSkillPlacementKey(entrance)));
    for (const entrance of [...staticEntrances, ...(ownedEntrances.get(identityKey) ?? [])]) {
      const actualKey = pageSkillPlacementKey(entrance);
      const group = groups.get(actualKey);
      if (!group) continue;
      const members = byEntrance.get(actualKey) ?? new Set<string>();
      members.add(key);
      byEntrance.set(actualKey, members);
      if ("knownRequiredResourceIds" in source) {
        uncertain.add(key);
        continue;
      }
      if (!group.skills.some(skill => runtimeSkillKey(skill) === key)) group.skills.push(source.skill);
      const visible = admitted.get(key);
      if (visible) visible.entrances.push(entrance);
      else admitted.set(key, { source, entrances: [entrance] });
      allowedPageKeys.add(key);
    }
  }
  return { groups, publicSkills, registered, allowedPageKeys, admitted, current, byEntrance, uncertain, refsBySource };
}

function anonymousFailure() {
  return new HttpError(502, "A skill source is unavailable", "SKILL_SOURCE_UNAVAILABLE");
}

function unreadableManifest(item: SkillCatalogDiagnostics["items"][number]) {
  return new HttpError(502, "The selected skill source is unavailable", "SKILL_SOURCE_UNAVAILABLE", item);
}

function candidatePageSkill(skill: RuntimeSkillRef, group: PageSkillGroup) {
  return { skill, pageSkills: [group], defaultAgent: pageSkillDefaultAgent(group) };
}

export function pageSkillDefaultAgent(group: PageSkillGroup) {
  return group.defaults.find(entry => entry.pageKey === group.locator.pageKey)?.defaultAgent;
}

/** Read the skill and default for the requested entry. */
export async function readPageCandidateSkill(caller: PageSkillViewCaller, entrance: PageSkillEntrance,
  usableIds: ReadonlySet<string>, member?: PageSkillMember,
) {
  const { domainId, initiatorCredentials, userId } = caller;
  const placement = pageSkillPlacementKey(entrance);
  if (!member) {
    const java = await javaPageSkillProjection(initiatorCredentials, entrance);
    const { groups, publicSkills } = pageAuthorization(java, [], new Set(), []);
    const group = groups.get(placement);
    const skill = publicSkills.get(placement);
    return group && skill ? candidatePageSkill(skill, group) : null;
  }
  if (member.memberPath.length) return null;

  const { source } = member;
  let identity: SkillSourceIdentity;
  let panelId: string | undefined;
  let fact: ProtectedSkillOffering | SkillSourceFailure | null;
  if (source.kind === "application-use") {
    const actual = await currentApplicationPanel(caller, entrance, source);
    if (!actual) return null;
    panelId = actual.registeredPanelId;
    identity = { providerId: PANEL_SKILL_PROVIDER_ID, sourceKey: actual.use.panelId };
    fact = await panelSkillProvider.findByUse(domainId, { applicationId: actual.applicationId, useId: actual.use.id },
      initiatorCredentials, userId);
  } else {
    const resolved = await sourceOwners.get(source.kind)?.resolve({ ...caller, entrance, source });
    if (!resolved) return null;
    identity = resolved;
    const provider = registeredSkillProviders().find(entry => entry.id === identity.providerId);
    if (!provider?.findProtectedSource) throw anonymousFailure();
    fact = await provider.findProtectedSource(identity.sourceKey, { domainId, userId, reader: initiatorCredentials });
  }
  if (!fact || fact.sourceKey !== identity.sourceKey) return null;
  const skill = protectedSourceSkillRef(identity.providerId, domainId, fact);
  const key = runtimeSkillKey(skill);
  if (key !== runtimeSkillKey(member.ref)) return null;

  const listed = { ...fact, ...identity, skill };
  const [java, grants] = await Promise.all([
    javaPageSkillProjection(initiatorCredentials, entrance, panelId),
    grantedSkillResources([listed], initiatorCredentials, usableIds),
  ]);
  const associations = source.kind === "application-use" ? [] : [{ entrance, identity }];
  const pages = pageAuthorization(java, [listed], grants, associations);
  const group = pages.groups.get(placement);
  if (!group || !pages.byEntrance.get(placement)?.has(key)) return null;
  if ("knownRequiredResourceIds" in fact) throw anonymousFailure();
  try {
    const manifest = standardSkillFrontmatterSchema.safeParse(await fact.readManifest(skill));
    if (!manifest.success || manifest.data.name !== skill.name)
      throw new SkillSourceRecordError({ resourceId: fact.sourceKey,
        field: manifest.success ? "name" : "manifest", reason: "invalid_definition" });
  } catch (error) {
    if (!(error instanceof SkillSourceRecordError)) throw error;
    throw unreadableManifest({ skill, ...error.detail });
  }
  return candidatePageSkill(skill, group);
}

/** Resolve the current page skill from the admission already obtained by this opening request. */
export async function openedPanelPageSkillContext(
  caller: PageSkillViewCaller, admitted: ApplicationEntryResolution,
): Promise<PageSkillContext | undefined> {
  const { applicationId, use } = admitted;
  if (!isApplicationPanelUse(use)) return;
  const source = { kind: "application-use", applicationId, useId: use.id } as const;
  const locator = { applicationId, entryKey: use.id, pageKey: use.pageKey };
  const absent = { mode: "member", locator, entry: source, member: null } as const;
  const { panelSkillSources } = await import("../product-panels/skill-package");
  const [fact] = await panelSkillSources(caller.domainId, [{
    ...source, panelId: use.panelId, path: use.path, entrance: locator,
  }], caller.initiatorCredentials);
  if (!("kind" in fact)) return absent;
  const ref = protectedSourceSkillRef(PANEL_SKILL_PROVIDER_ID, caller.domainId, fact);
  const grants = await grantedSkillResources([{ ...fact, providerId: PANEL_SKILL_PROVIDER_ID, skill: ref }], caller.initiatorCredentials);
  if (!fact.resourceIds.every(id => grants.has(id))) return absent;
  return {
    mode: "member", locator, entry: source,
    member: { source, memberPath: [], ref },
  };
}

/** A run can be opened at a registered entry even when its panel supplies no skill. */
export async function validateApplicationPageSkillEntry(caller: PageSkillViewCaller, context: PageSkillContext | undefined) {
  if (context?.mode !== "member" || !context.entry) return;
  const { applicationId, useId } = context.entry;
  if (applicationId === context.locator.applicationId && useId === context.locator.entryKey) {
    if (context.member) {
      const source = context.member.source;
      if (source.kind === "application-use" && source.applicationId === applicationId && source.useId === useId) return;
    } else if (await currentApplicationPanel(caller, context.locator, context.entry)) return;
  }
  throw new HttpError(403, "The initiating user does not have access to this panel entrance", "PANEL_ENTRY_FORBIDDEN");
}

/** Resolve one current view. All supply closures and existence facts refer to this source enumeration. */
export async function readSkillView(domainId: string, initiatorCredentials: AssistantCredentials, userId?: string) {
  const caller: PageSkillViewCaller = { domainId, ...(userId !== undefined && { userId }), initiatorCredentials };
  const java = await javaPageSkillProjection(initiatorCredentials);
  let pages!: ReturnType<typeof pageAuthorization>;
  const registry = await skillRegistryManager.forDomain(domainId, async (sources, failures) => {
    const listed = [...sources, ...failures];
    const [grants, associations] = await Promise.all([
      grantedSkillResources(listed, initiatorCredentials),
      Promise.all([...new Set(sourceOwners.values())].map(owner => owner.listAssociations(caller))),
    ]);
    pages = pageAuthorization(java, listed, grants, associations.flat());
    return {
      public: skill => !pages.registered.has(runtimeSkillKey(skill)) || pages.allowedPageKeys.has(runtimeSkillKey(skill)),
      protected: skill => pages.admitted.has(runtimeSkillKey(skill)),
      admittedEntrances: skill => pages.admitted.get(runtimeSkillKey(skill))?.entrances,
    };
  }, initiatorCredentials, userId);
  const items = [...registry.failedManifests.values()];
  const sourceUnavailable = pages.uncertain.size > 0;
  const diagnostics: SkillCatalogDiagnostics | undefined = items.length || sourceUnavailable ? { items, sourceUnavailable } : undefined;
  function requireReadableManifest(ref: RuntimeSkillRef) {
    const item = registry.failedManifests.get(runtimeSkillKey(ref));
    if (item) throw unreadableManifest(item);
  }
  function requireCertainStoredSkill(ref: RuntimeSkillRef) {
    if (pages.uncertain.has(runtimeSkillKey(ref))) throw anonymousFailure();
  }
  function checkUnresolvedInput(ref: RuntimeSkillRef) {
    requireReadableManifest(ref);
    if (sourceUnavailable && isProtectedSkillName(ref.name) && (ref.namespace.kind === "provider" || ref.namespace.domainId === domainId))
      throw anonymousFailure();
  }
  const view = {
    registry,
    diagnostics,
    requireReadableManifest,
    requireCertainStoredSkill,
    checkUnresolvedInput,
    requireSkillById(id: string) {
      const entry = registry.getSkillById(id);
      if (entry) return entry;
      const failure = items.find(item => item.skill.name === id);
      if (failure) throw unreadableManifest(failure);
      if (sourceUnavailable && isProtectedSkillName(id)) throw anonymousFailure();
      throw new HttpError(404, "Skill not found", "SKILL_NOT_FOUND");
    },
    pageSkills: [...pages.groups.values()],
    admittedPageSkill(ref: RuntimeSkillRef) {
      const visible = pages.admitted.get(runtimeSkillKey(ref));
      if (!visible) return undefined;
      const { source, entrances } = visible;
      return {
        ...(source.providerId === PANEL_SKILL_PROVIDER_ID && { panelId: source.sourceKey }),
        entrances,
      };
    },
    publicPageSkill(locator: PageSkillLocator) {
      return pages.publicSkills.get(pageSkillPlacementKey(locator)) ?? null;
    },
    pageSkillIsAvailable(ref: RuntimeSkillRef) {
      return pages.allowedPageKeys.has(runtimeSkillKey(ref));
    },
    unavailableStoredPageSkill(ref: RuntimeSkillRef) {
      const key = runtimeSkillKey(ref);
      return (pages.registered.has(key) || isStoredProtectedSkillRef(ref)) && !pages.allowedPageKeys.has(key)
        && !registry.getSkillByRef(ref);
    },
    hiddenStoredSkill(ref: RuntimeSkillRef) {
      const key = runtimeSkillKey(ref);
      return (pages.registered.has(key) || pages.current.has(key)) && !pages.allowedPageKeys.has(key) && !pages.uncertain.has(key);
    },
    async resolvePlacement(entrance: PageSkillEntrance, source: PageSkillSource, memberPath: PageSkillMember["memberPath"],
      loadedPanel?: { id: string }, expectedRef?: RuntimeSkillRef,
    ): Promise<AuthorizedPageSkillMember | null> {
      // Only root placements have a source owner in this release.
      if (memberPath.length) return null;
      let identity: SkillSourceIdentity;
      let path: string | undefined;
      let packageContext: SkillPackageContext | undefined;
      if (source.kind === "application-use") {
        const actual = await currentApplicationPanel(caller, entrance, source);
        if (!actual || (loadedPanel && loadedPanel.id !== actual.use.panelId)) return null;
        identity = { providerId: PANEL_SKILL_PROVIDER_ID, sourceKey: actual.use.panelId };
        source = { kind: source.kind, applicationId: actual.applicationId, useId: actual.use.id };
        path = actual.use.path;
        const entryInputKeys = Object.keys(actual.use.inputs ?? {});
        if (entryInputKeys.length) packageContext = { entryInputKeys };
      } else {
        const resolved = await sourceOwners.get(source.kind)?.resolve({ ...caller, entrance, source });
        if (!resolved) return null;
        identity = resolved;
      }
      const ref = pages.refsBySource.get(sourceIdentityKey(identity));
      if (!ref) return null;
      const key = runtimeSkillKey(ref);
      if (expectedRef && runtimeSkillKey(expectedRef) !== key) return null;
      if (!pages.byEntrance.get(pageSkillPlacementKey(entrance))?.has(key)) return null;
      requireCertainStoredSkill(ref);
      requireReadableManifest(ref);
      return { entrance, member: { source, memberPath: [], ref }, ...(path === undefined ? {} : { path }),
        ...(packageContext && { packageContext }) };
    },
  };
  return view;
}

export type SkillView = Awaited<ReturnType<typeof readSkillView>>;

export interface AuthorizedPageSkillMember {
  entrance: PageSkillEntrance;
  member: PageSkillMember;
  path?: string;
  packageContext?: SkillPackageContext;
}

export async function resolvePageSkillSource(view: SkillView, entrance: PageSkillEntrance, source: PageSkillSource,
  memberPath: PageSkillMember["memberPath"], loadedPanel?: { id: string },
): Promise<RuntimeSkillRef | null> {
  return (await view.resolvePlacement(entrance, source, memberPath, loadedPanel))?.member.ref ?? null;
}

export async function resolveCurrentPageSkillMember(view: SkillView, entrance: PageSkillEntrance,
  member: PageSkillMember | null,
): Promise<AuthorizedPageSkillMember | null> {
  if (!member) return null;
  return view.resolvePlacement(entrance, member.source, member.memberPath, undefined, member.ref);
}

/** Bind the response to the Java use and to the panel returned in this snapshot. */
export async function pageSkillMemberContext(view: SkillView, entrance: PageSkillEntrance,
  ...input: [source: PageSkillSource] | [source: ApplicationUseSkillSource, loadedPanel: { id: string }]
): Promise<PageSkillContext> {
  const [source, loadedPanel] = input;
  const actual = await view.resolvePlacement(entrance, source, [], loadedPanel);
  return { mode: "member", locator: entrance, member: actual?.member ?? null };
}
