import { z } from "zod";
import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import {
  pageSkillsProjectionSchema, type PageSkillContext, type PageSkillEntrance, type PageSkillGroup,
  type PageSkillLocator, type PageSkillMember, type PageSkillSource,
} from "@ontomato/contracts/page-skills";
import { applicationPanelUsesResponseSchema } from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import { isProtectedSkillName, protectedSkillRef } from "../../core/skills";
import { skillRegistryManager, type ListedProtectedSkill } from "../../core/skills/registry/manager";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendResponseError, backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { grantedProductIds } from "../product-governance/grants";

const javaPageSkills = z.object({
  success: z.literal(true),
  data: pageSkillsProjectionSchema,
});
const javaPanelUses = z.object({ success: z.literal(true), data: applicationPanelUsesResponseSchema });
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
  let response;
  try {
    response = await backendGet("panel-use",
      `${config.dataQuery.baseUrl}/platform/applications/${encodeURIComponent(source.applicationId)}/panel-uses`,
      { headers: callerHeaders(caller.initiatorCredentials), retries: 1 });
  } catch (error) {
    // Java refuses non-panel applications, inaccessible apps, and unknown apps at the source boundary.
    if (error instanceof BackendResponseError && [400, 403, 404].includes(error.status)) return null;
    throw error;
  }
  const { applicationId, panelUses } = javaPanelUses.parse(JSON.parse(response.text)).data;
  if (applicationId !== source.applicationId) return null;
  const use = panelUses.find(use => use.id === source.useId && use.pageKey === entrance.pageKey);
  if (!use) return null;
  const actual = "permissionCode" in use.access ? { permissionCode: use.access.permissionCode, pageKey: use.pageKey }
    : { access: "domain-member" as const, pageKey: use.pageKey };
  return entranceKey(actual) === entranceKey(entrance) ? { use, applicationId, entrance: actual } : null;
}

export function isStoredProtectedSkillRef(ref: RuntimeSkillRef) {
  return ref.namespace.kind === "domain" && (isProtectedSkillName(ref.name) || LEGACY_AGGREGATE_NAME.test(ref.name));
}

function pageAuthorization(domainId: string, java: Awaited<ReturnType<typeof javaPageSkillProjection>>,
  sources: readonly ListedProtectedSkill[], grants: ReadonlySet<string>,
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
  const byEntrance = new Map<string, ListedProtectedSkill[]>();
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
    if (!source.resourceIds.every(id => grants.has(id))) continue;
    const staticEntrances = source.entrances.filter(entrance => admittedEntrances.has(entranceKey(entrance)));
    for (const entrance of [...staticEntrances, ...(ownedEntrances.get(key) ?? [])]) {
      const group = groups.get(locatorKey(entrance));
      if (!group) continue;
      if (!group.skills.some(skill => runtimeSkillKey(skill) === key)) group.skills.push(source.skill);
      admitted.add(key);
      allowedPageKeys.add(key);
      const actualKey = entranceKey(entrance);
      const members = byEntrance.get(actualKey) ?? [];
      if (!members.includes(source)) members.push(source);
      byEntrance.set(actualKey, members);
    }
  }
  return { groups, publicSkills, registered, allowedPageKeys, admitted, current, byEntrance };
}

/** Resolve one current view. All supply closures and existence facts refer to this source enumeration. */
export async function readSkillView(domainId: string, initiatorCredentials: AssistantCredentials) {
  const caller = { domainId, initiatorCredentials };
  const java = await javaPageSkillProjection(initiatorCredentials);
  let pages!: ReturnType<typeof pageAuthorization>;
  const registry = await skillRegistryManager.forDomain(domainId, async sources => {
    const [grants, associations] = await Promise.all([
      sources.length ? grantedProductIds("use", initiatorCredentials) : [],
      Promise.all([...new Set(sourceOwners.values())].map(owner => owner.listAssociations(caller))),
    ]);
    pages = pageAuthorization(domainId, java, sources, new Set(grants), associations.flat());
    return {
      public: skill => !pages.registered.has(runtimeSkillKey(skill)) || pages.allowedPageKeys.has(runtimeSkillKey(skill)),
      protected: skill => pages.admitted.has(runtimeSkillKey(skill)),
    };
  });
  const view = {
    registry,
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
      return (pages.registered.has(key) || pages.current.has(key)) && !pages.allowedPageKeys.has(key);
    },
    async resolvePlacement(entrance: PageSkillEntrance, source: PageSkillSource, memberPath: PageSkillMember["memberPath"],
      loadedPanel?: { id: string },
    ): Promise<AuthorizedPageSkillMember | null> {
      // Only root placements have a source owner in this release.
      const members = pages.byEntrance.get(entranceKey(entrance));
      if (memberPath.length || !members) return null;
      if (source.kind === "application-use") {
        const actual = await currentApplicationPanel(caller, entrance, source);
        if (!actual || (loadedPanel && loadedPanel.id !== actual.use.panelId)) return null;
        const offered = members.find(member => member.providerId === "product-panels" && member.sourceKey === actual.use.panelId);
        if (!offered) return null;
        const currentSource = { kind: source.kind, applicationId: actual.applicationId, useId: actual.use.id };
        return { entrance: actual.entrance, member: { source: currentSource, memberPath: [], ref: offered.skill }, path: actual.use.path };
      }
      const identity = await sourceOwners.get(source.kind)?.resolve({ ...caller, entrance, source });
      if (!identity) return null;
      const offered = members.find(member => member.providerId === identity.providerId && member.sourceKey === identity.sourceKey);
      return offered ? { entrance, member: { source, memberPath: [], ref: offered.skill } } : null;
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
  const actual = await view.resolvePlacement(entrance, member.source, member.memberPath);
  return actual && runtimeSkillKey(actual.member.ref) === runtimeSkillKey(member.ref) ? actual : null;
}

/** Bind the response to the Java use and to the panel returned in this snapshot. */
export async function pageSkillMemberContext(view: SkillView, entrance: PageSkillEntrance,
  ...input: [source: PageSkillSource] | [source: ApplicationUseSkillSource, loadedPanel: { id: string }]
): Promise<PageSkillContext> {
  const [source, loadedPanel] = input;
  const actual = await view.resolvePlacement(entrance, source, [], loadedPanel);
  return { mode: "member", locator: entrance, member: actual?.member ?? null };
}
