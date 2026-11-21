import { z } from "zod";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import {
  pageSkillsProjectionSchema, type PageSkillContext, type PageSkillEntrance, type PageSkillGroup,
  type PageSkillLocator, type PageSkillMember, type PageSkillSource,
} from "@ontomato/contracts/page-skills";
import { config } from "../../config/application";
import type { PanelUseRef } from "@ontomato/contracts/product-panels";
import type { SkillCatalogDiagnostics } from "@ontomato/contracts/skills";
import { SkillSourceRecordError, type SkillSourceFailure } from "../../core/skills/providers";
import { isProtectedSkillName, protectedSkillRef, type ProtectedSkillOffering } from "../../core/skills";
import { skillRegistryManager, type ListedProtectedSkill, type ListedSourceFailure } from "../../core/skills/registry/manager";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendResponseError, backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { requirePanelEntry } from "../product-panels/application-use";
import { grantedProductIds } from "../product-governance/grants";

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

async function javaPageSkillProjection(credentials: AssistantCredentials) {
  const response = await backendGet("page-skills", `${config.dataQuery.baseUrl}/platform/page-skills`,
    { headers: callerHeaders(credentials), retries: 1 });
  return javaPageSkills.parse(JSON.parse(response.text)).data;
}

async function currentApplicationPanel(caller: PageSkillViewCaller, entrance: PageSkillEntrance,
  source: ApplicationUseSkillSource,
) {
  let entry;
  try {
    entry = await requirePanelEntry(caller.initiatorCredentials, source);
  } catch (error) {
    if (error instanceof BackendResponseError && [400, 403, 404].includes(error.status)) return null;
    if (error instanceof HttpError && error.code === "PANEL_ENTRY_SOURCE_MISMATCH")
      throw new HttpError(502, error.message, "SKILL_SOURCE_UNAVAILABLE");
    throw error;
  }
  const { applicationId, use } = entry;
  if (use.pageKey !== entrance.pageKey) return null;
  const actual = "permissionCode" in use.access ? { permissionCode: use.access.permissionCode, pageKey: use.pageKey }
    : { access: "domain-member" as const, pageKey: use.pageKey };
  return entranceKey(actual) === entranceKey(entrance) ? { use, applicationId, entrance: actual } : null;
}

export function isStoredProtectedSkillRef(ref: RuntimeSkillRef) {
  return ref.namespace.kind === "domain" && (isProtectedSkillName(ref.name) || LEGACY_AGGREGATE_NAME.test(ref.name));
}

function pageAuthorization(domainId: string, java: Awaited<ReturnType<typeof javaPageSkillProjection>>,
  sources: readonly (ListedProtectedSkill | ListedSourceFailure)[], grants: ReadonlySet<string>,
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
  const admitted = new Set<string>();
  const admittedEntrances = new Set(java.admittedEntrances?.map(entranceKey));
  const current = new Set<string>();
  const byEntrance = new Map<string, Set<string>>();
  const uncertain = new Set<string>();
  const ownedEntrances = new Map<string, PageSkillEntrance[]>();
  for (const { entrance, identity: { providerId, sourceKey } } of associations) {
    const key = runtimeSkillKey(protectedSkillRef(providerId, domainId, sourceKey));
    const entrances = ownedEntrances.get(key) ?? [];
    entrances.push(entrance);
    ownedEntrances.set(key, entrances);
  }
  for (const source of sources) {
    const key = runtimeSkillKey(source.skill);
    current.add(key);
    const required = "resourceIds" in source ? source.resourceIds : source.knownRequiredResourceIds;
    if (!required.every(id => grants.has(id))) continue;
    const staticEntrances = source.entrances.filter(entrance => admittedEntrances.has(entranceKey(entrance)));
    for (const entrance of [...staticEntrances, ...(ownedEntrances.get(key) ?? [])]) {
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
      admitted.add(key);
      allowedPageKeys.add(key);
    }
  }
  return { groups, publicSkills, registered, allowedPageKeys, admitted, current, byEntrance, uncertain };
}

function anonymousFailure() {
  return new HttpError(502, "A skill source is unavailable", "SKILL_SOURCE_UNAVAILABLE");
}

/** Resolve the skill of this registered entry without loading the domain's skill catalogue. */
export async function readRegisteredPanelPageSkillContext(
  caller: PageSkillViewCaller,
  entrance: PageSkillEntrance,
  source: ApplicationUseSkillSource,
  loadedPanel: { id: string },
  provider: { id: string; findByUse(domainId: string, use: PanelUseRef): Promise<ProtectedSkillOffering | SkillSourceFailure | null> },
): Promise<PageSkillContext> {
  const absent = { mode: "member" as const, locator: entrance, member: null };
  const actual = await currentApplicationPanel(caller, entrance, source);
  if (!actual || actual.use.panelId !== loadedPanel.id) return absent;
  const use = { applicationId: actual.applicationId, useId: actual.use.id };
  const sourceFact = await provider.findByUse(caller.domainId, use);
  if (!sourceFact || sourceFact.sourceKey !== loadedPanel.id) return absent;

  const ref = protectedSkillRef(provider.id, caller.domainId, sourceFact.sourceKey);
  const listed = { ...sourceFact, providerId: provider.id, skill: ref };
  const [java, grants] = await Promise.all([
    javaPageSkillProjection(caller.initiatorCredentials),
    grantedProductIds("use", caller.initiatorCredentials),
  ]);
  const pages = pageAuthorization(caller.domainId, java, [listed], new Set(grants), []);
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
export async function readSkillView(domainId: string, initiatorCredentials: AssistantCredentials) {
  const caller = { domainId, initiatorCredentials };
  const java = await javaPageSkillProjection(initiatorCredentials);
  let pages!: ReturnType<typeof pageAuthorization>;
  const registry = await skillRegistryManager.forDomain(domainId, async (sources, failures) => {
    const listed = [...sources, ...failures];
    const [grants, associations] = await Promise.all([
      listed.length ? grantedProductIds("use", initiatorCredentials) : [],
      Promise.all([...new Set(sourceOwners.values())].map(owner => owner.listAssociations(caller))),
    ]);
    pages = pageAuthorization(domainId, java, listed, new Set(grants), associations.flat());
    return {
      public: skill => !pages.registered.has(runtimeSkillKey(skill)) || pages.allowedPageKeys.has(runtimeSkillKey(skill)),
      protected: skill => pages.admitted.has(runtimeSkillKey(skill)),
    };
  });
  const items = [...registry.failedManifests.values()];
  const sourceUnavailable = pages.uncertain.size > 0;
  const diagnostics: SkillCatalogDiagnostics | undefined = items.length || sourceUnavailable ? { items, sourceUnavailable } : undefined;
  function requireReadableManifest(ref: RuntimeSkillRef) {
    const item = registry.failedManifests.get(runtimeSkillKey(ref));
    if (item) throw new HttpError(502, "The selected skill source is unavailable", "SKILL_SOURCE_UNAVAILABLE", item);
  }
  function requireCertainStoredSkill(ref: RuntimeSkillRef) {
    if (pages.uncertain.has(runtimeSkillKey(ref))) throw anonymousFailure();
  }
  function checkUnresolvedInput(ref: RuntimeSkillRef) {
    requireReadableManifest(ref);
    if (sourceUnavailable && ref.namespace.kind === "domain" && ref.namespace.domainId === domainId && isProtectedSkillName(ref.name))
      throw anonymousFailure();
  }
  const view = {
    registry,
    diagnostics,
    requireReadableManifest,
    requireCertainStoredSkill,
    checkUnresolvedInput,
    requireCompletePageSelection() { if (sourceUnavailable) throw anonymousFailure(); },
    requireSkillById(id: string) {
      const entry = registry.getSkillById(id);
      if (entry) return entry;
      checkUnresolvedInput({ namespace: { kind: "domain", domainId }, name: id });
      throw new HttpError(404, "Skill not found", "SKILL_NOT_FOUND");
    },
    pageSkills: [...pages.groups.values()],
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
      let ref: RuntimeSkillRef;
      let path: string | undefined;
      if (source.kind === "application-use") {
        const actual = await currentApplicationPanel(caller, entrance, source);
        if (!actual || (loadedPanel && loadedPanel.id !== actual.use.panelId)) return null;
        ref = protectedSkillRef("product-panels", domainId, actual.use.panelId);
        source = { kind: source.kind, applicationId: actual.applicationId, useId: actual.use.id };
        path = actual.use.path;
      } else {
        const identity = await sourceOwners.get(source.kind)?.resolve({ ...caller, entrance, source });
        if (!identity) return null;
        ref = protectedSkillRef(identity.providerId, domainId, identity.sourceKey);
      }
      const key = runtimeSkillKey(ref);
      if (expectedRef && runtimeSkillKey(expectedRef) !== key) return null;
      if (!pages.byEntrance.get(entranceKey(entrance))?.has(key)) return null;
      requireCertainStoredSkill(ref);
      requireReadableManifest(ref);
      return { entrance, member: { source, memberPath: [], ref }, ...(path === undefined ? {} : { path }) };
    },
  };
  return view;
}

export type SkillView = Awaited<ReturnType<typeof readSkillView>>;

export interface AuthorizedPageSkillMember {
  entrance: PageSkillEntrance;
  member: PageSkillMember;
  path?: string;
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
