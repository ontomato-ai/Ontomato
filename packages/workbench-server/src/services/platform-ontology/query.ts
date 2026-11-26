import type {
  PlatformOntologyCountsResponse,
  PlatformOntologyEdge,
  PlatformOntologyEdgeAuthorization,
  PlatformOntologyEdgeBinding,
  PlatformOntologyLayer,
  PlatformOntologyNeighborsRequest,
  PlatformOntologyNeighborsResponse,
  PlatformOntologyNode,
  PlatformOntologyNodeRef,
  PlatformOntologyObjectItem,
  PlatformOntologyObjectsRequest,
  PlatformOntologyObjectsResponse,
  PlatformOntologyRelationStatus,
  PlatformOntologySchemaResponse,
  PlatformOntologyStatus,
  PlatformOntologyType,
  PlatformOntologyTypeCount,
} from "@ontomato/contracts/platform-ontology";
import { matchesObjectType, objectUnionTypes, panelPlacementSchema } from "@ontomato/contracts/panel-manifest";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import {
  platformObjectTypes,
  type PlatformRelationKindDeclaration,
} from "@ontomato/contracts/platform-object-types";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { tForLocale } from "../../i18n";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { AuthorizationGraphFacts } from "../governance/policy-access";
import type { ProductOwner } from "../product-governance/grants";
import { panelSkillRef } from "../product-panels/skill-identity";
import {
  PlatformOntologyOwnerReaders,
  type OwnerReadResult,
  type RawGrantScope,
  type RawProductPanel,
  type RawProductProjection,
} from "./owners";
import {
  ACTION,
  AGENT_DEFINITION,
  ALL_PLATFORM_ONTOLOGY_TYPES,
  APPLICATION,
  ATTRIBUTE,
  BUSINESS_KNOWLEDGE,
  DEFINITION,
  FUNCTION,
  METRIC_VIEW,
  OBJECT_TYPE,
  ONTOLOGY_TYPE,
  ORG_GRANT,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  PLATFORM_ONTOLOGY_LAYERS,
  PLATFORM_ONTOLOGY_RELATION_KINDS,
  PLATFORM_ONTOLOGY_TYPE_MAP,
  PLATFORM_ONTOLOGY_TYPES,
  PLATFORM_OPERATION_OWNER_MAP,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  RELATIONSHIP,
  ROLE,
  SDK_COMPONENT,
  SKILL,
  TRIGGER,
  USER,
  WORKFLOW,
  assemblePlatformOntologySchemaTypes,
  relationTargets,
  resolveNodeLayer,
} from "./schema";

const logger = createLogger("platform-ontology");


interface RawEdgeCandidate {
  from: PlatformOntologyNodeRef;
  to: PlatformOntologyNodeRef;
  /** Optional labels already known from the relation owner's payload. */
  fromLabel?: string;
  fromDetail?: string;
  toLabel?: string;
  toDetail?: string;
  binding?: PlatformOntologyEdgeBinding;
  authorization?: PlatformOntologyEdgeAuthorization;
}

interface RelationEvalResult {
  status: PlatformOntologyStatus;
  reason?: string;
  edges: RawEdgeCandidate[];
}

function nodeKey(ref: PlatformOntologyNodeRef): string {
  return `${ref.className}\u0000${ref.primaryKey}`;
}

function attributeKey(className: string, attrName: string): string {
  return JSON.stringify([className, attrName]);
}

function parseAttributeKey(primaryKey: string): [string, string] | null {
  try {
    const parsed = JSON.parse(primaryKey);
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return [parsed[0], parsed[1]];
    }
  } catch {
    // Non-tuple primary key does not match any attribute.
  }
  return null;
}

function requireTypeSpec(typeId: string): PlatformOntologyType {
  const spec = PLATFORM_ONTOLOGY_TYPE_MAP.get(typeId);
  if (!spec) throw new HttpError(400, `Unknown platform ontology type: ${typeId}`, "INVALID_PLATFORM_TYPE");
  return spec;
}

function requireNodeLayer(ref: PlatformOntologyNodeRef): PlatformOntologyLayer {
  const layer = resolveNodeLayer(ref);
  if (!layer) {
    throw new HttpError(
      400,
      ref.className === ONTOLOGY_TYPE
        ? `Unknown or unlayered platform ontology type: ${ref.primaryKey}`
        : `Unknown platform ontology type: ${ref.className}`,
      "INVALID_PLATFORM_TYPE",
    );
  }
  return layer;
}

interface ExtractedTargetBinding {
  target: PlatformOntologyNodeRef;
  binding?: PlatformOntologyEdgeBinding;
}

/**
 * Extracts merged `projection.binds-target` targets for one projection.
 *
 * - Platform type reads and platform operations (whose owner type comes strictly from `platformObjectTypes`)
 *   merge onto a single edge per `{ className: "platform:OntologyType", primaryKey: <typeId> }`.
 * - Customer classes/relationships point to `platform:ObjectType` / `platform:Relationship`.
 * - Customer Actions and `MetricChart.metricId` point to `platform:Action` / `platform:MetricView`.
 * - Unlayered platform types and operations absent from the type table are skipped without guessing.
 */
function extractProjectionTargetBindings(projection: RawProductProjection): ExtractedTargetBinding[] {
  const entries = new Map<
    string,
    {
      target: PlatformOntologyNodeRef;
      reads: Set<string>;
      operations: Set<string>;
      hasDirect: boolean;
      hasInput: boolean;
    }
  >();

  const record = (
    target: PlatformOntologyNodeRef,
    opts: { read?: string; operation?: string; viaInput?: boolean },
  ) => {
    if (!resolveNodeLayer(target)) return;
    const key = nodeKey(target);
    let entry = entries.get(key);
    if (!entry) {
      entry = { target, reads: new Set(), operations: new Set(), hasDirect: false, hasInput: false };
      entries.set(key, entry);
    }
    if (opts.read) entry.reads.add(opts.read);
    if (opts.operation) entry.operations.add(opts.operation);
    if (opts.viaInput) entry.hasInput = true;
    else entry.hasDirect = true;
  };

  const def = projection.definition;

  for (const { source, read } of Object.values(def.data)) {
    if ("type" in source) {
      if (source.type.kind === "PlatformObjectType") {
        record({ className: ONTOLOGY_TYPE, primaryKey: source.type.id }, { read });
      } else if (source.type.kind === "ObjectType") {
        record({ className: OBJECT_TYPE, primaryKey: source.type.id }, { read });
      } else if (source.type.kind === "Relationship") {
        record({ className: RELATIONSHIP, primaryKey: source.type.id }, { read });
      }
      continue;
    }

    if ("literal" in source.object) {
      const { className, primaryKey } = source.object.literal;
      if (Object.hasOwn(platformObjectTypes, className)) {
        record({ className, primaryKey }, { read });
      } else {
        record({ className: OBJECT_TYPE, primaryKey: className }, { read });
      }
      continue;
    }

    const inputDef = def.inputs[source.object.input];
    if (inputDef?.kind === "object") {
      if (Object.hasOwn(platformObjectTypes, inputDef.objectType)) {
        record({ className: ONTOLOGY_TYPE, primaryKey: inputDef.objectType }, { read, viaInput: true });
      } else {
        record({ className: OBJECT_TYPE, primaryKey: inputDef.objectType }, { read, viaInput: true });
      }
    } else if (inputDef?.kind === "object-union") {
      for (const typeId of objectUnionTypes(inputDef)) {
        record({ className: ONTOLOGY_TYPE, primaryKey: typeId }, { read, viaInput: true });
      }
    }
  }

  for (const { operation, target } of Object.values(def.operations ?? {})) {
    if (operation.kind === "Action") {
      record({ className: ACTION, primaryKey: operation.id }, { operation: operation.id });
    } else if (operation.kind === "PlatformOperation") {
      const ownerType = PLATFORM_OPERATION_OWNER_MAP.get(operation.id);
      if (!ownerType) continue;
      record(
        { className: ONTOLOGY_TYPE, primaryKey: ownerType },
        { operation: operation.id, viaInput: Boolean(target && "input" in target) },
      );
    }
  }

  if (projection.metricId) {
    record({ className: METRIC_VIEW, primaryKey: projection.metricId }, {});
  }

  return [...entries.values()].map(({ target, reads, operations, hasDirect, hasInput }) => {
    const sortedReads = [...reads].sort();
    const sortedOps = [...operations].sort();
    const nonEmptyReads: [string, ...string[]] | undefined =
      sortedReads.length > 0 ? [sortedReads[0]!, ...sortedReads.slice(1)] : undefined;
    const nonEmptyOps: [string, ...string[]] | undefined =
      sortedOps.length > 0 ? [sortedOps[0]!, ...sortedOps.slice(1)] : undefined;
    const viaInput = hasInput && !hasDirect;
    const binding: PlatformOntologyEdgeBinding | undefined =
      nonEmptyReads || nonEmptyOps || viaInput
        ? {
            ...(nonEmptyReads ? { reads: nonEmptyReads } : {}),
            ...(nonEmptyOps ? { operations: nonEmptyOps } : {}),
            ...(viaInput ? { viaInput: true } : {}),
          }
        : undefined;
    return { target, ...(binding ? { binding } : {}) };
  });
}

function panelUsesObjectDetailRule(panel: RawProductPanel): boolean {
  return Object.values(panel.definition.manifest.members).some(
    ({ target }) =>
      "fromState" in target &&
      "rule" in target.candidates &&
      target.candidates.rule === "objectDetail",
  );
}

function extractPanelContainedIds(
  panel: RawProductPanel,
  objectDetailMappings?: ReadonlyMap<string, string>,
): { projectionIds: Set<string>; panelIds: Set<string> } {
  const projectionIds = new Set<string>();
  const panelIds = new Set<string>();
  const { state, members } = panel.definition.manifest;

  for (const { target } of Object.values(members)) {
    if ("projectionId" in target) {
      projectionIds.add(target.projectionId);
    } else if ("panelId" in target) {
      panelIds.add(target.panelId);
    } else if ("fromState" in target) {
      if ("panelIds" in target.candidates) {
        for (const id of target.candidates.panelIds) panelIds.add(id);
      } else if (objectDetailMappings) {
        const stateField = state[target.fromState];
        if (stateField && (stateField.type.kind === "object" || stateField.type.kind === "object-union")) {
          for (const [className, detailPanelId] of objectDetailMappings) {
            if (matchesObjectType(stateField.type, className)) {
              panelIds.add(detailPanelId);
            }
          }
        }
      }
    }
  }

  for (const field of Object.values(state)) {
    if (field.type.kind !== "placement") continue;
    if ("panelIds" in field.type.candidates) {
      for (const id of field.type.candidates.panelIds) panelIds.add(id);
    }
    if (field.default != null) {
      const parsed = panelPlacementSchema.safeParse(field.default);
      if (parsed.success) {
        if ("projectionId" in parsed.data.target) projectionIds.add(parsed.data.target.projectionId);
        else panelIds.add(parsed.data.target.panelId);
      }
    }
  }

  return { projectionIds, panelIds };
}

async function readDomainSharedProductIds(readers: PlatformOntologyOwnerReaders): Promise<ReadonlySet<string>> {
  const res = await readers.domainProductGrants();
  if (!res.ok) return new Set();
  const ids = new Set<string>();
  for (const grant of res.data) {
    if (grant.principalKind === "domain" && grant.principalId === "*" && grant.verb === "use") {
      ids.add(grant.resourceId);
    }
  }
  return ids;
}

function withDomainSharedDetail(
  baseDetail: string | undefined,
  shared: boolean,
  locale: string | undefined,
): string | undefined {
  if (!shared) return baseDetail;
  const tag = tForLocale(locale, "platformOntology.domainShared");
  return baseDetail ? `${baseDetail} · ${tag}` : tag;
}

/** The object kinds one policy grants, keyed by the verb it grants them with. */
const POLICY_OBJECT_KINDS: Readonly<Record<string, string>> = {
  PANEL: PRODUCT_PANEL,
  PROJECTION: PRODUCT_PROJECTION,
  COMPONENT: SDK_COMPONENT,
  AGENT: AGENT_DEFINITION,
  METRIC: METRIC_VIEW,
  READ_FUNCTION: FUNCTION,
  WRITE_FUNCTION: FUNCTION,
  WORKFLOW: WORKFLOW,
};

function verbLabel(locale: string | undefined, verb: string): string {
  return tForLocale(locale, `platformOntology.relationVerbs.${verb.toLowerCase()}`);
}

function scopeAuthorization(locale: string | undefined, scope: RawGrantScope | null | undefined): PlatformOntologyEdgeAuthorization {
  if (!scope) return {};
  return {
    scope: scope.kind,
    scopeLabel: tForLocale(locale, `platformOntology.scopes.${scope.kind}`),
    ...(scope.className && scope.field ? { scopeField: `${scope.className}.${scope.field}` } : {}),
  };
}

/**
 * Reads the object grants a policy stores and returns them as edges from that policy.
 *
 * Entry grants read as `permission-policy.can-enter-application` with the entry on the edge, action
 * grants as `permission-policy.can-execute-action` with their scope, and every other granted object
 * as `permission-policy.can-use-object` with the verb on the edge. A `CREATE` grant carries an empty
 * target id because it allows creating that class rather than naming one record: it never becomes an
 * edge and is reported on the policy node instead.
 */
function policyGrantEdges(
  facts: AuthorizationGraphFacts,
  center: PlatformOntologyNodeRef,
  locale: string | undefined,
): Record<"application" | "action" | "object", RawEdgeCandidate[]> {
  const result: Record<"application" | "action" | "object", RawEdgeCandidate[]> = {
    application: [], action: [], object: [],
  };
  const from = (policyId: string): PlatformOntologyNodeRef => ({ className: PERMISSION_POLICY, primaryKey: policyId });
  const touches = (ref: PlatformOntologyNodeRef): boolean =>
    ref.className === center.className && ref.primaryKey === center.primaryKey;
  for (const grant of facts.policyGrants) {
    if (!grant.targetKey) continue;
    const authorization: PlatformOntologyEdgeAuthorization = {
      verb: grant.verb,
      verbLabel: verbLabel(locale, grant.verb),
      ...scopeAuthorization(locale, grant.scope),
    };
    if (grant.targetKind === "ENTRY") {
      const [appId, useId] = grant.targetKey.split("/");
      if (!appId) continue;
      const policy = from(grant.policyId);
      const target = { className: APPLICATION, primaryKey: appId };
      if (!touches(policy) && !touches(target)) continue;
      result.application.push({
        from: policy,
        to: target,
        ...(useId ? {
          authorization: {
            ...authorization,
            entry: grant.targetKey,
            entryLabel: useId,
          },
        } : { authorization }),
      });
      continue;
    }
    if (grant.targetKind === "ACTION") {
      const policy = from(grant.policyId);
      const target = { className: ACTION, primaryKey: grant.targetKey };
      if (!touches(policy) && !touches(target)) continue;
      result.action.push({ from: policy, to: target, authorization });
      continue;
    }
    const className = POLICY_OBJECT_KINDS[grant.targetKind];
    if (!className) continue;
    const policy = from(grant.policyId);
    const target = { className, primaryKey: grant.targetKey };
    if (!touches(policy) && !touches(target)) continue;
    result.object.push({ from: policy, to: target, authorization });
  }
  return result;
}

/**
 * The class names one policy may create records of. The grant carries no target id because it allows
 * creating that class, so it is reported on the policy node rather than drawn as an edge.
 */
function policyCreatableTypes(facts: AuthorizationGraphFacts, policyId: string, locale: string | undefined): string[] {
  const types = new Set<string>();
  for (const grant of facts.policyGrants) {
    if (grant.policyId !== policyId || grant.verb !== "CREATE") continue;
    const className = POLICY_OBJECT_KINDS[grant.targetKind];
    if (!className) continue;
    types.add(tForLocale(locale, platformObjectTypes[className]!.labelKey!));
  }
  return [...types];
}

type InstanceMetadata = Partial<Record<"description" | "status" | "version" | "enabled", string | number | boolean>>;
type SearchableOntologyObjectItem = PlatformOntologyObjectItem & {
  readonly searchText?: string;
  readonly metadata?: InstanceMetadata;
};

type OwnerObjectsResult = OwnerReadResult<SearchableOntologyObjectItem[]>
  | { ok: false; status: "unavailable"; reason: string };

const ownerReadErrors = {
  refused: [403, "FORBIDDEN"],
  failed: [502, "UPSTREAM_FAILED"],
  unavailable: [503, "SERVICE_UNAVAILABLE"],
} as const;

export function platformOntologyOwnerReadError(status: Exclude<PlatformOntologyStatus, "ok">, reason?: string): HttpError {
  const [httpStatus, code] = ownerReadErrors[status];
  return new HttpError(httpStatus, reason ?? status, code);
}

/** How many names the user node's provenance summary keeps before it stops listing and shows the rest as `+N`. */
const PROVENANCE_NAME_LIMIT = 3;

function nameSummary(names: readonly string[]): string {
  const head = names.slice(0, PROVENANCE_NAME_LIMIT).join("、");
  return names.length > PROVENANCE_NAME_LIMIT ? `${head} +${names.length - PROVENANCE_NAME_LIMIT}` : head;
}

/**
 * The actions, workflows and metric views a user created or reviewed, summarised onto the user node.
 *
 * Being the creator or the reviewer of a definition is provenance rather than authority, so it is not
 * drawn as an edge; the names stay readable on the user node instead.
 */
async function readUserProvenance(
  readers: PlatformOntologyOwnerReaders,
  locale: string | undefined,
): Promise<ReadonlyMap<string, string[]>> {
  const [actionsRes, workflowsRes, metricsRes] = await Promise.all([
    readers.actions(),
    readers.workflows(),
    readers.metricViews(),
  ]);
  const rows = [
    ...(actionsRes.ok ? actionsRes.data : []),
    ...(workflowsRes.ok ? workflowsRes.data : []),
    ...(metricsRes.ok ? metricsRes.data : []),
  ];
  const rawIds = new Set(rows.flatMap((row) => [row.createdBy, row.reviewedBy]).filter((id): id is string => Boolean(id)));
  const userIds = new Map<string, string>();
  for (const rawId of rawIds) userIds.set(rawId, await readers.normalizeSubjectId(rawId));
  const created = new Map<string, string[]>();
  const reviewed = new Map<string, string[]>();
  const add = (bucket: Map<string, string[]>, rawId: string | null | undefined, name: string) => {
    if (!rawId) return;
    const key = userIds.get(rawId)!;
    const names = bucket.get(key) ?? [];
    names.push(name);
    bucket.set(key, names);
  };
  for (const row of rows) {
    add(created, row.createdBy, row.name);
    add(reviewed, row.reviewedBy, row.name);
  }
  const summaries = new Map<string, string[]>();
  for (const userId of new Set([...created.keys(), ...reviewed.keys()])) {
    const createdNames = created.get(userId) ?? [];
    const reviewedNames = reviewed.get(userId) ?? [];
    summaries.set(userId, [
      ...(createdNames.length > 0
        ? [`${tForLocale(locale, "panels.platformOntology.userCreated")}: ${nameSummary(createdNames)}`] : []),
      ...(reviewedNames.length > 0
        ? [`${tForLocale(locale, "panels.platformOntology.userPublished")}: ${nameSummary(reviewedNames)}`] : []),
    ]);
  }
  return summaries;
}

/** Lists objects of a declared type for the object picker and label lookup. */
async function readObjectsOfType(
  readers: PlatformOntologyOwnerReaders,
  typeId: string,
  includeDomainShared = true,
): Promise<OwnerObjectsResult> {
  const locale = readers.credentials.locale;

  switch (typeId) {
    case OBJECT_TYPE: {
      const res = await readers.ontologyMeta();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.classes.map((cls) => ({
          node: { className: OBJECT_TYPE, primaryKey: cls.className },
          label: cls.showName || cls.classDesc || cls.className,
          detail: cls.className,
          ...(cls.classDesc ? { searchText: cls.classDesc, metadata: { description: cls.classDesc } } : {}),
        })),
      };
    }
    case ATTRIBUTE: {
      const res = await readers.ontologyMeta();
      if (!res.ok) return res;
      const items: PlatformOntologyObjectItem[] = [];
      for (const cls of res.data.classes) {
        for (const attr of cls.attrs) {
          items.push({
            node: { className: ATTRIBUTE, primaryKey: attributeKey(cls.className, attr.name) },
            label: attr.showName || attr.name,
            detail: cls.className,
          });
        }
      }
      return { ok: true, data: items };
    }
    case RELATIONSHIP: {
      const res = await readers.ontologyMeta();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.relationships.map((rel) => ({
          node: { className: RELATIONSHIP, primaryKey: rel.relationship },
          label: rel.showName || rel.desc || rel.relationship,
          detail: rel.fromclass && rel.toclass ? `${rel.fromclass} → ${rel.toclass}` : undefined,
          ...(rel.desc ? { searchText: rel.desc, metadata: { description: rel.desc } } : {}),
        })),
      };
    }
    case METRIC_VIEW: {
      const res = await readers.metricViews();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((m) => ({
          node: { className: METRIC_VIEW, primaryKey: m.id },
          label: m.name,
          detail: m.status,
          ...(m.status !== undefined && { metadata: { status: m.status } }),
        })),
      };
    }
    case FUNCTION: {
      const res = await readers.functions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((fn) => ({
          node: { className: FUNCTION, primaryKey: fn.id },
          label: fn.name,
          detail: fn.operation,
        })),
      };
    }
    case ACTION: {
      const res = await readers.actions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((action) => ({
          node: { className: ACTION, primaryKey: action.id },
          label: action.name,
          detail: action.status,
          ...(action.status !== undefined && { metadata: { status: action.status } }),
        })),
      };
    }
    case WORKFLOW: {
      const res = await readers.workflows();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((wf) => ({
          node: { className: WORKFLOW, primaryKey: wf.id },
          label: wf.name,
          detail: wf.version !== undefined ? `v${wf.version}` : wf.status,
          metadata: {
            ...(wf.status !== undefined && { status: wf.status }),
            ...(wf.version !== undefined && { version: wf.version }),
          },
        })),
      };
    }
    case TRIGGER: {
      const res = await readers.triggers();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((tr) => ({
          node: { className: TRIGGER, primaryKey: tr.id },
          label: tr.name,
          detail: tr.effectKind ?? undefined,
          ...(tr.enabled !== undefined && { metadata: { enabled: tr.enabled } }),
        })),
      };
    }
    case SKILL: {
      const res = await readers.skills();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((skill) => ({
          node: { className: SKILL, primaryKey: skill.primaryKey },
          label: skill.title,
          ...(skill.description ? { searchText: skill.description, metadata: { description: skill.description } } : {}),
        })),
      };
    }
    case BUSINESS_KNOWLEDGE: {
      const res = await readers.knowledge();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((k) => ({
          node: { className: BUSINESS_KNOWLEDGE, primaryKey: k.id },
          label: k.title,
          ...(k.status !== undefined && { metadata: { status: k.status } }),
        })),
      };
    }
    case DEFINITION: {
      const res = await readers.definitions();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((def) => ({
          node: { className: DEFINITION, primaryKey: def.id },
          label: def.name,
          detail: def.objectType,
        })),
      };
    }
    case USER: {
      const res = await readers.subjects();
      if (!res.ok) return res;
      const provenance = await readUserProvenance(readers, locale);
      return {
        ok: true,
        data: res.data.map((subj) => {
          const parts = [subj.loginCode, ...provenance.get(subj.id) ?? []].filter((part): part is string => Boolean(part));
          return {
            node: { className: USER, primaryKey: subj.id },
            label: subj.displayName || subj.loginCode || subj.id,
            ...(parts.length > 0 && { detail: parts.join(" · ") }),
          };
        }),
      };
    }
    case ROLE: {
      const res = await readers.roles();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.roles.map((role) => ({
          node: { className: ROLE, primaryKey: role.id },
          label: role.code ?? role.id,
        })),
      };
    }
    case ORG_UNIT: {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.units.map((unit) => ({
          node: { className: ORG_UNIT, primaryKey: unit.id },
          label: unit.name,
          ...(unit.code ? { detail: unit.code } : {}),
        })),
      };
    }
    case ORG_POSITION: {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return res;
      const orgNameById = new Map(res.data.units.map((unit) => [unit.id, unit.name]));
      return {
        ok: true,
        data: res.data.positions.map((position) => {
          const detail = orgNameById.get(position.orgId);
          return {
            node: { className: ORG_POSITION, primaryKey: position.id },
            label: position.name,
            ...(detail ? { detail } : {}),
          };
        }),
      };
    }
    case PERMISSION_POLICY: {
      const res = await readers.permissionPolicies();
      if (!res.ok) return res;
      const facts = await readers.authorizationGraphFacts();
      return {
        ok: true,
        data: res.data.map((policy) => {
          const creatable = facts.ok ? policyCreatableTypes(facts.data, policy.id, locale) : [];
          return {
            node: { className: PERMISSION_POLICY, primaryKey: policy.id },
            label: policy.name,
            ...(creatable.length > 0 && {
              detail: `${tForLocale(locale, "panels.platformOntology.policyCreates")}: ${creatable.join("、")}`,
            }),
          };
        }),
      };
    }
    case ORG_GRANT: {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return res;
      const unitNameById = new Map(res.data.units.map((unit) => [unit.id, unit.name]));
      const positionNameById = new Map(res.data.positions.map((position) => [position.id, position.name]));
      return {
        ok: true,
        data: res.data.grants.map((grant) => {
          const scopeLabel = tForLocale(readers.credentials.locale, `platformOntology.orgGrantScope.${grant.grantType}`);
          const targetName =
            grant.grantType === "position"
              ? positionNameById.get(grant.sourceId)
              : unitNameById.get(grant.sourceId);
          return {
            node: { className: ORG_GRANT, primaryKey: grant.id },
            label: `${scopeLabel} · ${targetName ?? grant.sourceId}`,
          };
        }),
      };
    }
    case AGENT_DEFINITION: {
      const res = await readers.agentDefinitions();
      if (!res.ok) return res;
      const sharedIds = includeDomainShared && res.data.length > 0
        ? await readDomainSharedProductIds(readers)
        : new Set<string>();
      return {
        ok: true,
        data: res.data.map((agent) => ({
          node: { className: AGENT_DEFINITION, primaryKey: agent.id },
          label: agent.name,
          metadata: { enabled: agent.enabled },
          detail: withDomainSharedDetail(
            agent.enabled ? "enabled" : "disabled",
            sharedIds.has(agent.id),
            readers.credentials.locale,
          ),
        })),
      };
    }
    case SDK_COMPONENT: {
      const res = await readers.sdkComponents();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((component) => ({
          node: { className: SDK_COMPONENT, primaryKey: component.id },
          label: component.componentId,
          detail: component.module,
        })),
      };
    }
    case PRODUCT_PROJECTION: {
      const res = await readers.productProjections();
      if (!res.ok) return res;
      return {
        ok: true,
        data: res.data.map((projection) => ({
          node: { className: PRODUCT_PROJECTION, primaryKey: projection.id },
          label: projection.name,
          detail: projection.componentId,
          ...(projection.description ? {
            searchText: projection.description, metadata: { description: projection.description },
          } : {}),
        })),
      };
    }
    case PRODUCT_PANEL: {
      const res = await readers.productPanels();
      if (!res.ok) return res;
      const sharedIds = includeDomainShared && res.data.length > 0
        ? await readDomainSharedProductIds(readers)
        : new Set<string>();
      return {
        ok: true,
        data: res.data.map((panel) => {
          const detail = withDomainSharedDetail(
            panel.description || undefined,
            sharedIds.has(panel.id),
            readers.credentials.locale,
          );
          return {
            node: { className: PRODUCT_PANEL, primaryKey: panel.id },
            label: panel.name,
            ...(detail ? { detail } : {}),
            ...(panel.description && { metadata: { description: panel.description } }),
          };
        }),
      };
    }
    case APPLICATION: {
      const res = await readers.applications();
      if (!res.ok) return res;
      const sharedIds = includeDomainShared && res.data.length > 0
        ? await readDomainSharedProductIds(readers)
        : new Set<string>();
      return {
        ok: true,
        data: res.data.map((app) => ({
          node: { className: APPLICATION, primaryKey: app.id },
          label: app.name,
          detail: withDomainSharedDetail(
            app.kind,
            sharedIds.has(app.id),
            readers.credentials.locale,
          ),
        })),
      };
    }
    default:
      return { ok: false, status: "unavailable", reason: `No owner adapter registered for ${typeId}` };
  }
}

export async function readPlatformOntologySchema(): Promise<PlatformOntologySchemaResponse> {
  return {
    layers: PLATFORM_ONTOLOGY_LAYERS,
    objectTypes: await assemblePlatformOntologySchemaTypes(),
    relationKinds: PLATFORM_ONTOLOGY_RELATION_KINDS,
  };
}

export async function readPlatformOntologyCounts(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  types: readonly PlatformOntologyType[] = PLATFORM_ONTOLOGY_TYPES,
): Promise<PlatformOntologyCountsResponse> {
  const started = performance.now();
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);

  const counts = await Promise.all(
    types.map(async (spec): Promise<PlatformOntologyTypeCount> => {
      const res = await readers.count(spec.id);
      if (res.ok) {
        return { type: spec.id, layer: spec.layer, status: "ok", count: res.data };
      }
      return { type: spec.id, layer: spec.layer, status: res.status, reason: res.reason };
    }),
  );

  logger.info("platform ontology counts read", {
    durationMs: Math.round(performance.now() - started),
    ownerCalls: readers.ownerCallCount,
  });

  return { counts };
}

export async function readPlatformOntologyStart(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  callerUserName?: string,
): Promise<PlatformOntologyNode> {
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const subjectsRes = await readers.subjects();
  if (subjectsRes.ok) {
    const matched = subjectsRes.data.find((subj) => subj.id === owner.userId);
    if (matched) {
      return {
        className: USER,
        primaryKey: matched.id,
        label: matched.displayName || matched.loginCode || matched.id,
        layer: "governance",
      };
    }
  }
  // OSS uses hostOwner (`system`), and enterprise callers without subject directory access still keep their real user ID.
  return {
    className: USER,
    primaryKey: owner.userId,
    label: callerUserName?.trim() || owner.userId,
    layer: "governance",
  };
}

export async function readPlatformOntologyObjects(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  input: PlatformOntologyObjectsRequest,
): Promise<PlatformOntologyObjectsResponse> {
  const { failures: _failures, items, ...page } = await readPlatformOntologyInstancePage(owner, credentials, input);
  return {
    ...page,
    items: items.map(({ node, label, detail }) => ({ node, label, ...(detail !== undefined && { detail }) })),
  };
}

type PlatformOntologyInstancePage = Omit<PlatformOntologyObjectsResponse, "items"> & {
  items: SearchableOntologyObjectItem[];
  failures?: { type: string; status: Exclude<PlatformOntologyStatus, "ok">; reason: string }[];
};

export async function readPlatformOntologyInstancePage(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  input: PlatformOntologyObjectsRequest,
): Promise<PlatformOntologyInstancePage> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50));
  const keyword = input.keyword?.trim().toLowerCase() ?? "";

  if (input.type === ALL_PLATFORM_ONTOLOGY_TYPES || input.type === "*") {
    if (!keyword) {
      return {
        type: input.type,
        layer: "capability",
        status: "ok",
        items: [],
        total: 0,
        page,
        pageSize,
      };
    }

    const readers = new PlatformOntologyOwnerReaders(owner, credentials);
    const results = await Promise.all(
      PLATFORM_ONTOLOGY_TYPES.map(async (spec) => ({
        spec,
        res: await readObjectsOfType(readers, spec.id, false),
      })),
    );

    let okCount = 0;
    const failures: NonNullable<PlatformOntologyInstancePage["failures"]> = [];
    const matched: Array<{ rank: number; item: SearchableOntologyObjectItem }> = [];

    for (const { spec, res } of results) {
      if (!res.ok) {
        failures.push({ type: spec.id, status: res.status, reason: res.reason });
        continue;
      }
      okCount++;
      const typeLabel = tForLocale(credentials.locale, spec.labelKey);
      const typeLabelLower = typeLabel.toLowerCase();
      for (const item of res.data) {
        const labelLower = item.label.toLowerCase();
        const detailLower = item.detail?.toLowerCase() ?? "";
        const searchTextLower = item.searchText?.toLowerCase() ?? "";
        const keyLower = item.node.primaryKey.toLowerCase();
        let rank: number;
        if (labelLower === keyword) rank = 0;
        else if (labelLower.startsWith(keyword)) rank = 1;
        else if (labelLower.includes(keyword)) rank = 2;
        else if (searchTextLower.includes(keyword) || detailLower.includes(keyword)) rank = 3;
        else if (keyLower.includes(keyword) || typeLabelLower.includes(keyword)) rank = 4;
        else continue;

        const detailText = item.searchText && item.searchText !== item.label
          ? item.searchText
          : item.detail;
        const detail = detailText ? `${typeLabel} · ${detailText}` : typeLabel;
        matched.push({
          rank,
          item: { ...item, detail },
        });
      }
    }

    if (okCount === 0) {
      const firstError = failures[0]!;
      return {
        type: input.type,
        layer: "capability",
        status: firstError.status,
        ...(firstError.reason ? { reason: firstError.reason } : {}),
        items: [],
        total: 0,
        page,
        pageSize,
      };
    }

    matched.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.item.label.localeCompare(b.item.label) ||
        a.item.node.primaryKey.localeCompare(b.item.node.primaryKey),
    );
    const offset = (page - 1) * pageSize;

    return {
      type: input.type,
      layer: "capability",
      status: "ok",
      items: matched.slice(offset, offset + pageSize).map(({ item }) => item),
      total: matched.length,
      page,
      pageSize,
      failures,
    };
  }

  const spec = requireTypeSpec(input.type);
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const res = await readObjectsOfType(readers, spec.id);

  if (!res.ok) {
    return {
      type: spec.id,
      layer: spec.layer,
      status: res.status,
      reason: res.reason,
      items: [],
      total: 0,
      page,
      pageSize,
    };
  }

  const filtered = keyword
    ? res.data.filter(
        (item) =>
          item.label.toLowerCase().includes(keyword) ||
          item.node.primaryKey.toLowerCase().includes(keyword) ||
          (item.detail?.toLowerCase().includes(keyword) ?? false) ||
          (item.searchText?.toLowerCase().includes(keyword) ?? false),
      )
    : res.data;

  const sorted = [...filtered].sort((a, b) => a.label.localeCompare(b.label) || a.node.primaryKey.localeCompare(b.node.primaryKey));
  const offset = (page - 1) * pageSize;

  return {
    type: spec.id,
    layer: spec.layer,
    status: "ok",
    items: sorted.slice(offset, offset + pageSize),
    total: sorted.length,
    page,
    pageSize,
  };
}

export async function readPlatformOntologyInstance(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  node: PlatformOntologyNodeRef,
): Promise<SearchableOntologyObjectItem> {
  const spec = PLATFORM_ONTOLOGY_TYPE_MAP.get(node.className);
  if (!spec) throw new HttpError(404, `Unknown platform ontology type: ${node.className}`, "OBJECT_NOT_FOUND");
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const result = await readObjectsOfType(readers, spec.id);
  if (!result.ok) throw platformOntologyOwnerReadError(result.status, result.reason);
  const item = result.data.find(candidate => candidate.node.primaryKey === node.primaryKey);
  if (!item) throw new HttpError(404, `Object not found: ${node.className}~${node.primaryKey}`, "OBJECT_NOT_FOUND");
  return item;
}

/** Evaluates one declared relation kind for the requested center node (outgoing or incoming). */
async function evaluateRelationKind(
  readers: PlatformOntologyOwnerReaders,
  spec: PlatformRelationKindDeclaration,
  node: PlatformOntologyNodeRef,
): Promise<RelationEvalResult> {
  const locale = readers.credentials.locale;
  switch (spec.id) {
    case "object-type.has-attribute": {
      const res = await readers.ontologyMeta();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      if (node.className === OBJECT_TYPE) {
        const cls = res.data.classes.find((c) => c.className === node.primaryKey);
        if (cls) {
          for (const attr of cls.attrs) {
            edges.push({
              from: node,
              to: { className: ATTRIBUTE, primaryKey: attributeKey(cls.className, attr.name) },
              fromLabel: cls.showName || cls.classDesc || cls.className,
              toLabel: attr.showName || attr.name,
              toDetail: cls.className,
            });
          }
        }
      } else if (node.className === ATTRIBUTE) {
        const parsed = parseAttributeKey(node.primaryKey);
        if (parsed) {
          const [className, attrName] = parsed;
          const cls = res.data.classes.find((c) => c.className === className);
          const attr = cls?.attrs.find((a) => a.name === attrName);
          if (cls && attr) {
            edges.push({
              from: { className: OBJECT_TYPE, primaryKey: cls.className },
              to: node,
              fromLabel: cls.showName || cls.classDesc || cls.className,
              toLabel: attr.showName || attr.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "relationship.from-object-type":
    case "relationship.to-object-type": {
      const res = await readers.ontologyMeta();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const field = spec.id === "relationship.from-object-type" ? "fromclass" : "toclass";
      const edges: RawEdgeCandidate[] = [];
      for (const rel of res.data.relationships) {
        const targetClass = rel[field];
        if (!targetClass) continue;
        if (
          (node.className === RELATIONSHIP && rel.relationship === node.primaryKey) ||
          (node.className === OBJECT_TYPE && targetClass === node.primaryKey)
        ) {
          edges.push({
            from: { className: RELATIONSHIP, primaryKey: rel.relationship },
            to: { className: OBJECT_TYPE, primaryKey: targetClass },
            fromLabel: rel.showName || rel.desc || rel.relationship,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "metric-view.uses-function": {
      const res = await readers.metricViews();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const m of res.data) {
        if (!m.functionId) continue;
        if (
          (node.className === METRIC_VIEW && m.id === node.primaryKey) ||
          (node.className === FUNCTION && m.functionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: METRIC_VIEW, primaryKey: m.id },
            to: { className: FUNCTION, primaryKey: m.functionId },
            fromLabel: m.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "action.uses-function": {
      const res = await readers.actions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const action of res.data) {
        if (!action.functionId) continue;
        if (
          (node.className === ACTION && action.id === node.primaryKey) ||
          (node.className === FUNCTION && action.functionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ACTION, primaryKey: action.id },
            to: { className: FUNCTION, primaryKey: action.functionId },
            fromLabel: action.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "function.reads-object-type": {
      const res = await readers.functions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const fn of res.data) {
        for (const className of fn.classNames) {
          if (
            (node.className === FUNCTION && fn.id === node.primaryKey) ||
            (node.className === OBJECT_TYPE && className === node.primaryKey)
          ) {
            edges.push({
              from: { className: FUNCTION, primaryKey: fn.id },
              to: { className: OBJECT_TYPE, primaryKey: className },
              fromLabel: fn.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "action.targets-object-type": {
      const res = await readers.actions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const action of res.data) {
        if (!action.targetClassName) continue;
        if (
          (node.className === ACTION && action.id === node.primaryKey) ||
          (node.className === OBJECT_TYPE && action.targetClassName === node.primaryKey)
        ) {
          edges.push({
            from: { className: ACTION, primaryKey: action.id },
            to: { className: OBJECT_TYPE, primaryKey: action.targetClassName },
            fromLabel: action.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "definition.based-on-object-type": {
      const res = await readers.definitions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const def of res.data) {
        if (!def.objectType || def.objectType.startsWith("platform:")) continue;
        if (
          (node.className === DEFINITION && def.id === node.primaryKey) ||
          (node.className === OBJECT_TYPE && def.objectType === node.primaryKey)
        ) {
          edges.push({
            from: { className: DEFINITION, primaryKey: def.id },
            to: { className: OBJECT_TYPE, primaryKey: def.objectType },
            fromLabel: def.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "workflow.step-references-action": {
      const res = await readers.workflows();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const wf of res.data) {
        for (const step of wf.steps) {
          if (!step.actionId) continue;
          if (
            (node.className === WORKFLOW && wf.id === node.primaryKey) ||
            (node.className === ACTION && step.actionId === node.primaryKey)
          ) {
            edges.push({
              from: { className: WORKFLOW, primaryKey: wf.id },
              to: { className: ACTION, primaryKey: step.actionId },
              fromLabel: wf.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "trigger.targets-workflow": {
      const res = await readers.triggers();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const tr of res.data) {
        if (!tr.workflowId) continue;
        if (
          (node.className === TRIGGER && tr.id === node.primaryKey) ||
          (node.className === WORKFLOW && tr.workflowId === node.primaryKey)
        ) {
          edges.push({
            from: { className: TRIGGER, primaryKey: tr.id },
            to: { className: WORKFLOW, primaryKey: tr.workflowId },
            fromLabel: tr.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "trigger.targets-action": {
      const res = await readers.triggers();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const tr of res.data) {
        if (!tr.actionId) continue;
        if (
          (node.className === TRIGGER && tr.id === node.primaryKey) ||
          (node.className === ACTION && tr.actionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: TRIGGER, primaryKey: tr.id },
            to: { className: ACTION, primaryKey: tr.actionId },
            fromLabel: tr.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "user.holds-role": {
      const subjectsRes = await readers.subjects();
      if (!subjectsRes.ok) return { status: subjectsRes.status, reason: subjectsRes.reason, edges: [] };
      if (node.className === USER) {
        const subject = subjectsRes.data.find((s) => s.id === node.primaryKey);
        if (!subject || subject.roleIds.length === 0) return { status: "ok", edges: [] };
        return {
          status: "ok",
          edges: subject.roleIds.map((roleId) => ({
            from: { className: USER, primaryKey: subject.id },
            to: { className: ROLE, primaryKey: roleId },
            fromLabel: subject.displayName || subject.loginCode || subject.id,
          })),
        };
      }
      if (node.className === ROLE) {
        const edges: RawEdgeCandidate[] = [];
        for (const subject of subjectsRes.data) {
          if (subject.roleIds.includes(node.primaryKey)) {
            edges.push({
              from: { className: USER, primaryKey: subject.id },
              to: { className: ROLE, primaryKey: node.primaryKey },
              fromLabel: subject.displayName || subject.loginCode || subject.id,
            });
          }
        }
        return { status: "ok", edges };
      }
      return { status: "ok", edges: [] };
    }

    case "role.owns-workflow-step": {
      const res = await readers.grants();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const grant of res.data) {
        if (!grant.inForce || !grant.roleId || !grant.workflowId || !grant.stepNo) continue;
        if (
          (node.className === ROLE && grant.roleId === node.primaryKey) ||
          (node.className === WORKFLOW && grant.workflowId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ROLE, primaryKey: grant.roleId },
            to: { className: WORKFLOW, primaryKey: grant.workflowId },
            fromLabel: grant.roleCode ?? undefined,
            authorization: {
              stepNo: grant.stepNo,
              ...(grant.activatedByWorkflowVersion
                ? { version: Number(grant.activatedByWorkflowVersion) }
                : {}),
              ...scopeAuthorization(locale, grant.scope),
            },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "agent.uses-skill": {
      const res = await readers.agentDefinitions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const agent of res.data) {
        for (const skillRef of agent.skills) {
          const skillKey = runtimeSkillKey(skillRef);
          if (
            (node.className === AGENT_DEFINITION && agent.id === node.primaryKey) ||
            (node.className === SKILL && skillKey === node.primaryKey)
          ) {
            edges.push({
              from: { className: AGENT_DEFINITION, primaryKey: agent.id },
              to: { className: SKILL, primaryKey: skillKey },
              fromLabel: agent.name,
              toLabel: skillRef.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "agent.executes-as-user": {
      const res = await readers.agentDefinitions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const agent of res.data) {
        if (!agent.executionUserId) continue;
        const userId = await readers.normalizeSubjectId(agent.executionUserId);
        if (
          (node.className === AGENT_DEFINITION && agent.id === node.primaryKey) ||
          (node.className === USER && userId === node.primaryKey)
        ) {
          edges.push({
            from: { className: AGENT_DEFINITION, primaryKey: agent.id },
            to: { className: USER, primaryKey: userId },
            fromLabel: agent.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "projection.uses-component": {
      const res = await readers.productProjections();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const projection of res.data) {
        if (
          (node.className === PRODUCT_PROJECTION && projection.id === node.primaryKey) ||
          (node.className === SDK_COMPONENT && projection.componentId === node.primaryKey)
        ) {
          edges.push({
            from: { className: PRODUCT_PROJECTION, primaryKey: projection.id },
            to: { className: SDK_COMPONENT, primaryKey: projection.componentId },
            fromLabel: projection.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "projection.binds-target": {
      const res = await readers.productProjections();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const projection of res.data) {
        if (node.className === PRODUCT_PROJECTION && projection.id !== node.primaryKey) continue;
        const bindings = extractProjectionTargetBindings(projection);
        for (const { target, binding } of bindings) {
          if (
            node.className === PRODUCT_PROJECTION ||
            (target.className === node.className && target.primaryKey === node.primaryKey)
          ) {
            edges.push({
              from: { className: PRODUCT_PROJECTION, primaryKey: projection.id },
              to: target,
              fromLabel: projection.name,
              ...(binding ? { binding } : {}),
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "panel.contains-projection": {
      const panelsRes = await readers.productPanels();
      if (!panelsRes.ok) return { status: panelsRes.status, reason: panelsRes.reason, edges: [] };
      const grantsRes = await readers.grantedUseIds();
      if (!grantsRes.ok) return { status: grantsRes.status, reason: grantsRes.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const panel of panelsRes.data) {
        const { projectionIds } = extractPanelContainedIds(panel);
        for (const projectionId of projectionIds) {
          if (!grantsRes.data.has(projectionId)) continue;
          if (
            (node.className === PRODUCT_PANEL && panel.id === node.primaryKey) ||
            (node.className === PRODUCT_PROJECTION && projectionId === node.primaryKey)
          ) {
            edges.push({
              from: { className: PRODUCT_PANEL, primaryKey: panel.id },
              to: { className: PRODUCT_PROJECTION, primaryKey: projectionId },
              fromLabel: panel.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "panel.contains-panel": {
      const panelsRes = await readers.productPanels();
      if (!panelsRes.ok) return { status: panelsRes.status, reason: panelsRes.reason, edges: [] };
      const grantsRes = await readers.grantedUseIds();
      if (!grantsRes.ok) return { status: grantsRes.status, reason: grantsRes.reason, edges: [] };
      let objectDetailMappings: ReadonlyMap<string, string> | undefined;
      if (panelsRes.data.some(panelUsesObjectDetailRule)) {
        const detailRes = await readers.objectDetailPanelMappings();
        if (!detailRes.ok) return { status: detailRes.status, reason: detailRes.reason, edges: [] };
        objectDetailMappings = detailRes.data;
      }
      const edges: RawEdgeCandidate[] = [];
      for (const panel of panelsRes.data) {
        const { panelIds } = extractPanelContainedIds(panel, objectDetailMappings);
        for (const childPanelId of panelIds) {
          if (childPanelId === panel.id || !grantsRes.data.has(childPanelId)) {
            continue;
          }
          if (panel.id === node.primaryKey || childPanelId === node.primaryKey) {
            edges.push({
              from: { className: PRODUCT_PANEL, primaryKey: panel.id },
              to: { className: PRODUCT_PANEL, primaryKey: childPanelId },
              fromLabel: panel.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "panel.provides-skill": {
      const [panelsRes, skillsRes] = await Promise.all([
        readers.productPanels(),
        readers.skills(),
      ]);
      if (!panelsRes.ok) return { status: panelsRes.status, reason: panelsRes.reason, edges: [] };
      if (!skillsRes.ok) return { status: skillsRes.status, reason: skillsRes.reason, edges: [] };
      const skillByKey = new Map(skillsRes.data.map((skill) => [skill.primaryKey, skill]));
      const edges: RawEdgeCandidate[] = [];
      for (const panel of panelsRes.data) {
        const skillKey = runtimeSkillKey(panelSkillRef(readers.owner.domainId, panel.id));
        const skill = skillByKey.get(skillKey);
        if (!skill) continue;
        if (
          (node.className === PRODUCT_PANEL && panel.id === node.primaryKey) ||
          (node.className === SKILL && skillKey === node.primaryKey)
        ) {
          edges.push({
            from: { className: PRODUCT_PANEL, primaryKey: panel.id },
            to: { className: SKILL, primaryKey: skillKey },
            fromLabel: panel.name,
            toLabel: skill.title,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "application.uses-panel": {
      const appsRes = await readers.applications();
      if (!appsRes.ok) return { status: appsRes.status, reason: appsRes.reason, edges: [] };
      const entriesRes = await readers.applicationPanelUses();
      if (!entriesRes.ok) return { status: entriesRes.status, reason: entriesRes.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const app of appsRes.data) {
        for (const panelId of entriesRes.data.get(app.id) ?? []) {
          if (
            (node.className === APPLICATION && app.id === node.primaryKey) ||
            (node.className === PRODUCT_PANEL && panelId === node.primaryKey)
          ) {
            edges.push({
              from: { className: APPLICATION, primaryKey: app.id },
              to: { className: PRODUCT_PANEL, primaryKey: panelId },
              fromLabel: app.name,
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "org-unit.has-child": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const unitById = new Map(res.data.units.map((unit) => [unit.id, unit]));
      const edges: RawEdgeCandidate[] = [];
      for (const unit of res.data.units) {
        const parentId = unit.parentId;
        if (!parentId || parentId === "0" || parentId === unit.id) continue;
        const parent = unitById.get(parentId);
        if (!parent) continue;
        if (parentId === node.primaryKey || unit.id === node.primaryKey) {
          edges.push({
            from: { className: ORG_UNIT, primaryKey: parentId },
            to: { className: ORG_UNIT, primaryKey: unit.id },
            fromLabel: parent.name,
            toLabel: unit.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "org-unit.has-position": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const position of res.data.positions) {
        if (
          (node.className === ORG_UNIT && position.orgId === node.primaryKey) ||
          (node.className === ORG_POSITION && position.id === node.primaryKey)
        ) {
          edges.push({
            from: { className: ORG_UNIT, primaryKey: position.orgId },
            to: { className: ORG_POSITION, primaryKey: position.id },
            toLabel: position.name,
          });
        }
      }
      return { status: "ok", edges };
    }

    case "user.member-of-org-unit": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const membership of res.data.memberships) {
        if (
          (node.className === USER && membership.userId === node.primaryKey) ||
          (node.className === ORG_UNIT && membership.orgId === node.primaryKey)
        ) {
          edges.push({
            from: { className: USER, primaryKey: membership.userId },
            to: { className: ORG_UNIT, primaryKey: membership.orgId },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "user.holds-org-position": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const assignment of res.data.positionAssignments) {
        if (
          (node.className === USER && assignment.userId === node.primaryKey) ||
          (node.className === ORG_POSITION && assignment.positionId === node.primaryKey)
        ) {
          edges.push({
            from: { className: USER, primaryKey: assignment.userId },
            to: { className: ORG_POSITION, primaryKey: assignment.positionId },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "org-grant.applies-to-org-unit": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const grant of res.data.grants) {
        if (grant.grantType !== "organization" && grant.grantType !== "subtree") continue;
        if (
          (node.className === ORG_GRANT && grant.id === node.primaryKey) ||
          (node.className === ORG_UNIT && grant.sourceId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ORG_GRANT, primaryKey: grant.id },
            to: { className: ORG_UNIT, primaryKey: grant.sourceId },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "org-grant.applies-to-org-position": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const grant of res.data.grants) {
        if (grant.grantType !== "position") continue;
        if (
          (node.className === ORG_GRANT && grant.id === node.primaryKey) ||
          (node.className === ORG_POSITION && grant.sourceId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ORG_GRANT, primaryKey: grant.id },
            to: { className: ORG_POSITION, primaryKey: grant.sourceId },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "org-grant.grants-role": {
      const res = await readers.organizationSnapshot();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const grant of res.data.grants) {
        for (const roleId of grant.roleIds) {
          if (
            (node.className === ORG_GRANT && grant.id === node.primaryKey) ||
            (node.className === ROLE && roleId === node.primaryKey)
          ) {
            edges.push({
              from: { className: ORG_GRANT, primaryKey: grant.id },
              to: { className: ROLE, primaryKey: roleId },
            });
          }
        }
      }
      return { status: "ok", edges };
    }

    case "role.uses-permission-policy": {
      const res = await readers.rolePolicies();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const link of res.data) {
        if (
          (node.className === ROLE && link.roleId === node.primaryKey) ||
          (node.className === PERMISSION_POLICY && link.policyId === node.primaryKey)
        ) {
          edges.push({
            from: { className: ROLE, primaryKey: link.roleId },
            to: { className: PERMISSION_POLICY, primaryKey: link.policyId },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "permission-policy.governs-object-type": {
      const res = await readers.policyDataPermissions();
      if (!res.ok) return { status: res.status, reason: res.reason, edges: [] };
      const edges: RawEdgeCandidate[] = [];
      for (const perm of res.data) {
        if (
          (node.className === PERMISSION_POLICY && perm.policyId === node.primaryKey) ||
          (node.className === OBJECT_TYPE && perm.className === node.primaryKey)
        ) {
          edges.push({
            from: { className: PERMISSION_POLICY, primaryKey: perm.policyId },
            to: { className: OBJECT_TYPE, primaryKey: perm.className },
          });
        }
      }
      return { status: "ok", edges };
    }

    case "permission-policy.can-enter-application":
    case "permission-policy.can-execute-action":
    case "permission-policy.can-use-object": {
      const facts = await readers.authorizationGraphFacts();
      if (!facts.ok) return { status: facts.status, reason: facts.reason, edges: [] };
      const granted = policyGrantEdges(facts.data, node, locale);
      const collected = spec.id === "permission-policy.can-enter-application"
        ? granted.application
        : spec.id === "permission-policy.can-execute-action" ? granted.action : granted.object;
      return { status: "ok", edges: collected };
    }

    default:
      return { status: "unavailable", reason: `Unhandled relation kind: ${spec.id}`, edges: [] };
  }
}

export async function readPlatformOntologyNeighbors(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  input: PlatformOntologyNeighborsRequest,
  callerUserName?: string,
): Promise<PlatformOntologyNeighborsResponse> {
  const started = performance.now();
  const { className, primaryKey } = input.node;
  if (className === ONTOLOGY_TYPE && !PLATFORM_ONTOLOGY_TYPE_MAP.has(primaryKey)) {
    throw new HttpError(404, `Unknown platform ontology type: ${primaryKey}`, "OBJECT_NOT_FOUND");
  }
  const centerLayer = requireNodeLayer(input.node);
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  if (className !== ONTOLOGY_TYPE) {
    const isSelfUser = className === USER && primaryKey === owner.userId;
    const centerRes = await readObjectsOfType(readers, className);
    if (centerRes.ok) {
      // The OSS subject directory is empty, but the authenticated user is still the default start.
      if (!centerRes.data.some((item) => item.node.primaryKey === primaryKey) &&
          !(isSelfUser && centerRes.data.length === 0)) {
        throw new HttpError(404, `Object not found: ${className}~${primaryKey}`, "OBJECT_NOT_FOUND");
      }
    } else if (!isSelfUser) throw platformOntologyOwnerReadError(centerRes.status, centerRes.reason);
  }
  const centerKey = nodeKey(input.node);

  const kindFilter = input.relationKinds?.length ? new Set(input.relationKinds) : null;
  const layerFilter = input.layers?.length ? new Set(input.layers) : null;
  const { targetClass, direction, limit, offset = 0 } = input;
  const matchesOppositeType = (type: string) =>
    (!targetClass || type === targetClass)
    && (!layerFilter || layerFilter.has(PLATFORM_ONTOLOGY_TYPE_MAP.get(type)!.layer));

  const applicableRelations = PLATFORM_ONTOLOGY_RELATION_KINDS.filter((rel) => {
    if (kindFilter && !kindFilter.has(rel.id)) return false;
    const targets = relationTargets(rel);
    // Projection bindings can point to type references as well as instances of the declared target types.
    const bindsType = rel.id === "projection.binds-target";
    const isOutgoing = rel.from === className
      && ((bindsType && targetClass === ONTOLOGY_TYPE) || targets.some(matchesOppositeType));
    const isIncoming = targets.includes(bindsType && className === ONTOLOGY_TYPE ? primaryKey : className)
      && matchesOppositeType(rel.from);
    return (direction !== "incoming" && isOutgoing) || (direction !== "outgoing" && isIncoming);
  });

  const evaluations = await Promise.all(
    applicableRelations.map(async (rel) => ({
      spec: rel,
      result: await evaluateRelationKind(readers, rel, input.node),
    })),
  );

  const seenEdges = new Set<string>();
  const edges: PlatformOntologyEdge[] = [];
  const relations: PlatformOntologyRelationStatus[] = [];
  const hintLabels = new Map<string, { label: string; detail?: string }>();

  for (const { spec, result } of evaluations) {
    for (const candidate of result.edges) {
      const fromKey = nodeKey(candidate.from);
      const toKey = nodeKey(candidate.to);
      const direction: "outgoing" | "incoming" = fromKey === centerKey ? "outgoing" : "incoming";
      const opposite = direction === "outgoing" ? candidate.to : candidate.from;
      if (input.direction && input.direction !== "both" && input.direction !== direction) continue;
      if (targetClass && opposite.className !== targetClass) continue;
      const oppositeLayer = resolveNodeLayer(opposite);
      if (!oppositeLayer) continue;
      if (layerFilter && !layerFilter.has(oppositeLayer)) continue;

      const dedupKey = `${spec.id}|${fromKey}|${toKey}`;
      if (seenEdges.has(dedupKey)) continue;
      seenEdges.add(dedupKey);

      edges.push({
        id: `${spec.id}:${candidate.from.className}:${candidate.from.primaryKey}->${candidate.to.className}:${candidate.to.primaryKey}`,
        relationKind: spec.id,
        from: candidate.from,
        to: candidate.to,
        direction,
        derived: spec.derived,
        ...(candidate.binding ? { binding: candidate.binding } : {}),
        ...(candidate.authorization ? { authorization: candidate.authorization } : {}),
      });

      if (candidate.fromLabel) hintLabels.set(fromKey, { label: candidate.fromLabel, detail: candidate.fromDetail });
      if (candidate.toLabel) hintLabels.set(toKey, { label: candidate.toLabel, detail: candidate.toDetail });
    }

    relations.push({
      relationKind: spec.id,
      status: result.status,
      edgeCount: 0,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }

  const pageEdges = edges.slice(offset, limit === undefined ? undefined : offset + limit);
  const nextOffset = offset + pageEdges.length < edges.length ? offset + pageEdges.length : null;
  const pageCounts = new Map<string, number>();
  const neighborRefs = new Map<string, PlatformOntologyNodeRef>();
  for (const edge of pageEdges) {
    pageCounts.set(edge.relationKind, (pageCounts.get(edge.relationKind) ?? 0) + 1);
    const opposite = edge.direction === "outgoing" ? edge.to : edge.from;
    const key = nodeKey(opposite);
    if (key !== centerKey) neighborRefs.set(key, opposite);
  }

  // Resolve canonical labels from each referenced node's owner (reusing per-request cache).
  const typesToResolve = new Set<string>();
  if (input.node.className !== ONTOLOGY_TYPE) typesToResolve.add(input.node.className);
  for (const ref of neighborRefs.values()) {
    if (ref.className !== ONTOLOGY_TYPE) typesToResolve.add(ref.className);
  }

  const labelMaps = new Map<string, Map<string, { label: string; detail?: string }>>();
  await Promise.all(
    [...typesToResolve].map(async (typeId) => {
      const res = await readObjectsOfType(readers, typeId);
      if (!res.ok) return;
      const map = new Map<string, { label: string; detail?: string }>();
      for (const item of res.data) {
        map.set(item.node.primaryKey, { label: item.label, detail: item.detail });
      }
      labelMaps.set(typeId, map);
    }),
  );

  const toNode = (ref: PlatformOntologyNodeRef): PlatformOntologyNode => {
    const layer = resolveNodeLayer(ref)!;
    if (ref.className === ONTOLOGY_TYPE) {
      return {
        className: ONTOLOGY_TYPE,
        primaryKey: ref.primaryKey,
        label: ref.primaryKey,
        layer,
      };
    }
    const ownerEntry = labelMaps.get(ref.className)?.get(ref.primaryKey);
    const hintEntry = hintLabels.get(nodeKey(ref));
    const fallbackLabel =
      ref.className === USER && ref.primaryKey === owner.userId && callerUserName?.trim()
        ? callerUserName.trim()
        : ref.primaryKey;
    return {
      className: ref.className,
      primaryKey: ref.primaryKey,
      label: ownerEntry?.label ?? hintEntry?.label ?? fallbackLabel,
      layer,
      ...(ownerEntry?.detail ?? hintEntry?.detail ? { detail: ownerEntry?.detail ?? hintEntry?.detail } : {}),
    };
  };

  const centerNode: PlatformOntologyNode = {
    ...toNode(input.node),
    layer: centerLayer,
  };
  const neighbors = [...neighborRefs.values()].map(toNode);

  logger.info("platform ontology neighbors read", {
    durationMs: Math.round(performance.now() - started),
    nodeType: input.node.className,
    relationCount: applicableRelations.length,
    ownerCalls: readers.ownerCallCount,
    neighborCount: neighbors.length,
    edgeCount: edges.length,
  });

  return {
    node: centerNode,
    neighbors,
    edges: pageEdges,
    relations: relations.map(relation => ({
      ...relation,
      edgeCount: pageCounts.get(relation.relationKind) ?? 0,
      ...(relation.status === "ok" && nextOffset !== null && { truncated: true }),
    })),
    nextOffset,
    total: edges.length,
  };
}
