import { z } from "zod";
import { runtimeSkillKey, standardSkillFrontmatterSchema, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import {
  pageSkillsProjectionSchema, type PageSkillContext, type PageSkillEntrance, type PageSkillGroup,
  type PageSkillLocator, type PageSkillMember, type PageSkillSource,
} from "@ontomato/contracts/page-skills";
import { config } from "../../config/application";
import { isApplicationPanelUse, type PanelUseRef } from "@ontomato/contracts/product-panels";
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
import { requirePanelEntry } from "../product-panels/application-use";
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

function locatorFor(entrance: PageSkillLocator): PageSkillLocator {
  return "permissionCode" in entrance ? { permissionCode: entrance.permissionCode } : {
    access: entrance.access, pageKey: entrance.pageKey,
  };
}

function locatorKey(locator: PageSkillLocator) {
  return "permissionCode" in locator ? `permission:${locator.permissionCode}` : `domain-member:${locator.pageKey}`;
}

function entranceKey(entrance: PageSkillEntrance) {
  return JSON.stringify([locatorKey(entrance), entrance.pageKey]);
}

function callerHeaders({ token, locale, apiKey }: AssistantCredentials) {
  return buildBackendHeaders(token, undefined, locale, apiKey);
}

async function javaPageSkillProjection(credentials: AssistantCredentials, entrance?: PageSkillEntrance, panelId?: string) {
  const query = entrance && new URLSearchParams({
    pageKey: entrance.pageKey,
    ...("permissionCode" in entrance && { permissionCode: entrance.permissionCode }),
    ...(panelId !== undefined && { panelId }),
  });
  const response = await backendGet("page-skills", `${config.dataQuery.baseUrl}/platform/page-skills${query ? `?${query}` : ""}`,
    { headers: callerHeaders(credentials), retries: 1 });
  return javaPageSkills.parse(JSON.parse(response.text)).data;
}

async function currentApplicationPanel(caller: PageSkillViewCaller, entrance: PageSkillEntrance,
  source: ApplicationUseSkillSource,
) {
  let entry;
  try {
    const owner = caller.userId ? { domainId: caller.domainId, userId: caller.userId } : undefined;
    entry = await requirePanelEntry(caller.initiatorCredentials, source, owner);
  } catch (error) {
    if (error instanceof HttpError && [400, 403, 404].includes(error.status)) return null;
    if (error instanceof HttpError && error.code === "PANEL_ENTRY_SOURCE_MISMATCH")
      throw new HttpError(502, error.message, "SKILL_SOURCE_UNAVAILABLE");
    throw error;
  }
  const { applicationId, use } = entry;
  if (!isApplicationPanelUse(use) || use.pageKey !== entrance.pageKey) return null;
  const actual = "permissionCode" in use.access ? { permissionCode: use.access.permissionCode, pageKey: use.pageKey }
    : { access: "domain-member" as const, pageKey: use.pageKey };
  return entranceKey(actual) === entranceKey(entrance) ? { use, applicationId, entrance: actual } : null;
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
  for (const mapping of java.pageSkills) {
    const locator = locatorFor(mapping);
    const key = locatorKey(locator);
    if (mapping.skill) {
      publicSkills.set(key, mapping.skill);
      allowedPageKeys.add(runtimeSkillKey(mapping.skill));
    }
    groups.set(key, { locator, skills: mapping.skill ? [mapping.skill] : [], defaults: mapping.defaults ?? [] });
  }
  const admitted = new Map<string, { source: SkillSourceIdentity; entrances: PageSkillEntrance[] }>();
  const admittedEntrances = new Set(java.admittedEntrances?.map(entranceKey));
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
    const staticEntrances = source.entrances.filter(entrance => admittedEntrances.has(entranceKey(entrance)));
    for (const entrance of [...staticEntrances, ...(ownedEntrances.get(identityKey) ?? [])]) {
      const group = groups.get(locatorKey(entrance));
      if (!group) continue;
      const actualKey = entranceKey(entrance);
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

function candidatePageSkill(entrance: PageSkillEntrance, skill: RuntimeSkillRef, groups: ReadonlyMap<string, PageSkillGroup>) {
  return {
    skill,
    pageSkills: [...groups.values()],
    defaultAgent: groups.get(locatorKey(entrance))?.defaults.find(entry => entry.pageKey === entrance.pageKey)?.defaultAgent,
  };
}

/** Read one page's skill and the admitted placements of that same skill. */
export async function readPageCandidateSkill(caller: PageSkillViewCaller, entrance: PageSkillEntrance,
  usableIds: ReadonlySet<string>, member?: PageSkillMember,
) {
  const { domainId, initiatorCredentials, userId } = caller;
  if (!member) {
    const java = await javaPageSkillProjection(initiatorCredentials, entrance);
    const { groups, publicSkills } = pageAuthorization(java, [], new Set(), []);
    const skill = publicSkills.get(locatorKey(entrance));
    return skill ? candidatePageSkill(entrance, skill, groups) : null;
  }
  if (member.memberPath.length) return null;

  const { source } = member;
  let identity: SkillSourceIdentity;
  let panelId: string | undefined;
  let fact: ProtectedSkillOffering | SkillSourceFailure | null;
  if (source.kind === "application-use") {
    const actual = await currentApplicationPanel(caller, entrance, source);
    if (!actual) return null;
    panelId = actual.use.panelId;
    identity = { providerId: PANEL_SKILL_PROVIDER_ID, sourceKey: panelId };
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
  const pages = pageAuthorization(java,
    [panelId === undefined ? listed : { ...listed, entrances: java.admittedEntrances ?? [] }], grants, associations);
  if (!pages.byEntrance.get(entranceKey(entrance))?.has(key)) return null;
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
  return candidatePageSkill(entrance, skill, pages.groups);
}

/** Resolve the skill of this registered entry without loading the domain's skill catalogue. */
export async function readRegisteredPanelPageSkillContext(
  caller: PageSkillViewCaller,
  entrance: PageSkillEntrance,
  source: ApplicationUseSkillSource,
  loadedPanel: { id: string },
  provider: { id: string; findByUse(domainId: string, use: PanelUseRef, reader: AssistantCredentials, userId?: string):
    Promise<ProtectedSkillOffering | SkillSourceFailure | null> },
): Promise<PageSkillContext> {
  const absent = { mode: "member" as const, locator: entrance, member: null };
  const actual = await currentApplicationPanel(caller, entrance, source);
  if (!actual || actual.use.panelId !== loadedPanel.id) return absent;
  const use = { applicationId: actual.applicationId, useId: actual.use.id };
  const sourceFact = await provider.findByUse(caller.domainId, use, caller.initiatorCredentials, caller.userId);
  if (!sourceFact || sourceFact.sourceKey !== loadedPanel.id) return absent;

  const ref = protectedSourceSkillRef(provider.id, caller.domainId, sourceFact);
  const listed = { ...sourceFact, providerId: provider.id, skill: ref };
  const [java, grants] = await Promise.all([
    javaPageSkillProjection(caller.initiatorCredentials, actual.entrance),
    grantedSkillResources([listed], caller.initiatorCredentials),
  ]);
  const pages = pageAuthorization(java, [listed], grants, []);
  if (!pages.byEntrance.get(entranceKey(actual.entrance))?.has(runtimeSkillKey(ref))) return absent;
  // Only admitted offerings and unresolved sources with an eligible entrance reach this point.
  if ("knownRequiredResourceIds" in sourceFact) throw anonymousFailure();
  try {
    await sourceFact.readManifest(ref);
  } catch (error) {
    if (!(error instanceof SkillSourceRecordError)) throw error;
    const { resourceId, field, reason } = error.detail;
    // The direct host checks each member against the current release and can still render the other members.
    if (reason === "component_missing") return absent;
    const resource = resourceId === loadedPanel.id ? "panel" : "projection";
    const location = `${resource} '${resourceId}'${field ? `, field '${field}'` : ""}`;
    throw new HttpError(502, `Panel '${loadedPanel.id}' skill is unavailable: ${location}: ${reason.replaceAll("_", " ")}`,
      "SKILL_SOURCE_UNAVAILABLE");
  }
  return {
    mode: "member", locator: actual.entrance,
    member: { source: { kind: "application-use", ...use }, memberPath: [], ref },
  };
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
      return pages.publicSkills.get(locatorKey(locator)) ?? null;
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
      if (!pages.byEntrance.get(entranceKey(entrance))?.has(key)) return null;
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
