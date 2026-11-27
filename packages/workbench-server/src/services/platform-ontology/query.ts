import { z } from "zod";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
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
import {
  platformObjectTypes,
  type PlatformRelationKindDeclaration,
} from "@ontomato/contracts/platform-object-types";
import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { platformTaskListSchema, type PlatformTask } from "@ontomato/contracts/platform-schedules";
import { tForLocale } from "../../i18n";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { AuthorizationGraphFacts } from "../governance/policy-access";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { JavaPanelReadResult } from "../product-panels/java-panel-reads";
import type { DefinitionVisibilityRange } from "../product-panels/access";
import { triggerClient } from "../scheduling/trigger-client";
import {
  actionDirectorySchema,
  functionDirectorySchema,
  knowledgeDirectorySchema,
  memberIdentityDirectorySchema,
  metricViewDirectorySchema,
  orgGrantInstanceDirectorySchema,
  orgPositionInstanceDirectorySchema,
  orgUnitInstanceDirectorySchema,
  workflowDirectorySchema,
  ontologyApplicationName,
  parseOntologyMeta,
  permissionPolicyDirectorySchema,
  PlatformOntologyOwnerReaders,
  readOntologyOwnerFact,
  readOntologyVisibilityFact,
  type OntologyReadFact,
  type OntologyCount,
  type OwnerReadResult,
  type RawOntologyMeta,
  type RawDefinition,
  type RawGrant,
  type RawGrantScope,
  type RawWorkflow,
  type RawMemberIdentity,
  type RawOrganizationSnapshot,
  type RawProductPanel,
  type RawProductProjection,
  type RawSdkComponent,
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

export interface RelationEvalResult {
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

export function parseAttributeKey(primaryKey: string): [string, string] | null {
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

type PanelContainmentKind = "panel.contains-projection" | "panel.contains-panel";

export function isPanelContainmentKind(kind: string): kind is PanelContainmentKind {
  return kind === "panel.contains-projection" || kind === "panel.contains-panel";
}

export async function evaluatePanelContainment(
  kind: PanelContainmentKind, node: PlatformOntologyNodeRef, direction: PlatformOntologyNeighborsRequest["direction"],
  sources: {
    panels(): Promise<OwnerReadResult<RawProductPanel[]>>;
    targets(ids: readonly string[]): Promise<OwnerReadResult<ReadonlySet<string>>>;
    objectDetailPanelMappings(): Promise<OwnerReadResult<ReadonlyMap<string, string>>>;
  },
): Promise<RelationEvalResult> {
  const panels = await sources.panels();
  if (!panels.ok) return { status: panels.status, reason: panels.reason, edges: [] };
  const nestedPanel = kind === "panel.contains-panel";
  const targetClass = nestedPanel ? PRODUCT_PANEL : PRODUCT_PROJECTION;
  let mappings: ReadonlyMap<string, string> | undefined;
  if (nestedPanel && panels.data.some(panelUsesObjectDetailRule)) {
    const result = await sources.objectDetailPanelMappings();
    if (!result.ok) return { status: result.status, reason: result.reason, edges: [] };
    mappings = result.data;
  }
  const edges: RawEdgeCandidate[] = [];
  for (const panel of panels.data) {
    const outgoing = node.className === PRODUCT_PANEL && panel.id === node.primaryKey;
    if (!outgoing && direction === "outgoing") continue;
    const { panelIds, projectionIds } = extractPanelContainedIds(panel, mappings);
    for (const id of nestedPanel ? panelIds : projectionIds) {
      if (nestedPanel && id === panel.id) continue;
      const incoming = node.className === targetClass && id === node.primaryKey;
      if (!(outgoing && direction !== "incoming") && !(incoming && direction !== "outgoing")) continue;
      edges.push({
        from: { className: PRODUCT_PANEL, primaryKey: panel.id },
        to: { className: targetClass, primaryKey: id },
        fromLabel: panel.name,
      });
    }
  }
  if (edges.length === 0) return { status: "ok", edges };
  const targets = await sources.targets([...new Set(edges.map(edge => edge.to.primaryKey))]);
  if (!targets.ok) return { status: targets.status, reason: targets.reason, edges: [] };
  return { status: "ok", edges: edges.filter(edge => targets.data.has(edge.to.primaryKey)) };
}

async function readDomainSharedProductIds(
  readers: PlatformOntologyOwnerReaders,
  kind: "AGENT" | "PANEL" | "APPLICATION",
): Promise<ReadonlySet<string>> {
  const facts = await readers.authorizationGraphFacts();
  if (!facts.ok) return new Set();
  const { domainPolicyId, entries, policyGrants } = facts.data;
  const shared = policyGrants.filter(grant => grant.policyId === domainPolicyId);
  if (kind === "APPLICATION") {
    const openEntries = new Set(shared.filter(grant => grant.targetKind === "ENTRY" && grant.verb === "ENTER")
      .map(grant => grant.targetKey));
    return new Set(entries.filter(entry => openEntries.has(entry.id)).map(entry => entry.applicationId));
  }
  return new Set(shared.filter(grant => grant.targetKind === kind && grant.verb === "USE")
    .map(grant => grant.targetKey));
}

export function withDomainSharedDetail(
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
  TRIGGER: TRIGGER,
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

type GraphPolicyGrant = AuthorizationGraphFacts["policyGrants"][number];

function policyGrantAuthorization(grant: GraphPolicyGrant, locale: string | undefined): PlatformOntologyEdgeAuthorization {
  return { verb: grant.verb, verbLabel: verbLabel(locale, grant.verb), ...scopeAuthorization(locale, grant.scope) };
}

export function evaluatePolicyEntryGrants(
  center: PlatformOntologyNodeRef, facts: OwnerReadResult<GraphPolicyGrant[]>, locale?: string,
): RelationEvalResult {
  if (!facts.ok) return { status: facts.status, reason: facts.reason, edges: [] };
  const edges: RawEdgeCandidate[] = [];
  for (const grant of facts.data) {
    if (grant.targetKind !== "ENTRY") continue;
    const [appId, useId] = grant.targetKey.split("/");
    if (!appId) continue;
    if (!(center.className === PERMISSION_POLICY && center.primaryKey === grant.policyId) &&
        !(center.className === APPLICATION && center.primaryKey === appId)) continue;
    edges.push({
      from: { className: PERMISSION_POLICY, primaryKey: grant.policyId },
      to: { className: APPLICATION, primaryKey: appId },
      authorization: {
        ...policyGrantAuthorization(grant, locale),
        ...(useId && { entry: grant.targetKey, entryLabel: useId }),
      },
    });
  }
  return { status: "ok", edges };
}

export function evaluatePolicyActionGrants(
  center: PlatformOntologyNodeRef, facts: OwnerReadResult<GraphPolicyGrant[]>, locale?: string,
): RelationEvalResult {
  if (!facts.ok) return { status: facts.status, reason: facts.reason, edges: [] };
  return { status: "ok", edges: policyGrantEdges({ policyGrants: facts.data }, center, locale).action };
}

export function evaluatePolicyObjectGrants(
  center: PlatformOntologyNodeRef, facts: OwnerReadResult<GraphPolicyGrant[]>, locale?: string,
): RelationEvalResult {
  if (!facts.ok) return { status: facts.status, reason: facts.reason, edges: [] };
  return { status: "ok", edges: policyGrantEdges({ policyGrants: facts.data }, center, locale).object };
}

/** A CREATE grant has no target record and is reported on the policy node instead. */
function policyGrantEdges(
  facts: Pick<AuthorizationGraphFacts, "policyGrants">,
  center: PlatformOntologyNodeRef,
  locale: string | undefined,
): Record<"action" | "object", RawEdgeCandidate[]> {
  const result: Record<"action" | "object", RawEdgeCandidate[]> = {
    action: [], object: [],
  };
  const from = (policyId: string): PlatformOntologyNodeRef => ({ className: PERMISSION_POLICY, primaryKey: policyId });
  const touches = (ref: PlatformOntologyNodeRef): boolean =>
    ref.className === center.className && ref.primaryKey === center.primaryKey;
  for (const grant of facts.policyGrants) {
    if (!grant.targetKey || grant.targetKind === "ENTRY") continue;
    const authorization = policyGrantAuthorization(grant, locale);
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

export const policyCreateKindsSchema = z.array(z.object({ policyId: z.string().min(1), targetKind: z.string().min(1) }));

/**
 * The class names one policy may create records of. The grant carries no target id because it allows
 * creating that class, so it is reported on the policy node rather than drawn as an edge.
 */
function policyCreatableTypes(
  grants: z.infer<typeof policyCreateKindsSchema>, policyId: string, locale: string | undefined,
): string[] {
  const types = new Set<string>();
  for (const grant of grants) {
    if (grant.policyId !== policyId) continue;
    const className = POLICY_OBJECT_KINDS[grant.targetKind];
    if (!className) continue;
    types.add(tForLocale(locale, platformObjectTypes[className]!.labelKey!));
  }
  return [...types];
}

export function policyCreationDetail(
  grants: z.infer<typeof policyCreateKindsSchema>, policyId: string, locale: string | undefined,
): string | undefined {
  const creatable = policyCreatableTypes(grants, policyId, locale);
  if (creatable.length) return `${tForLocale(locale, "panels.platformOntology.policyCreates")}: ${creatable.join("、")}`;
}

type InstanceMetadata = Partial<Record<"description" | "status" | "version" | "enabled", string | number | boolean>>;
type SearchableOntologyObjectItem = PlatformOntologyObjectItem & {
  readonly searchText?: string;
  readonly metadata?: InstanceMetadata;
};

export type OwnerObjectsResult = OwnerReadResult<SearchableOntologyObjectItem[]>
  | { ok: false; status: "unavailable"; reason: string };

export function sdkComponentObjects(res: OwnerReadResult<RawSdkComponent[]>): OwnerObjectsResult {
  return res.ok ? { ok: true, data: res.data.map(component => ({
    node: { className: SDK_COMPONENT, primaryKey: component.id }, label: component.componentId, detail: component.module,
  })) } : res;
}

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
export const PROVENANCE_NAME_LIMIT = 3;

interface ProvenanceNames {
  names: readonly string[];
  total: number;
}

function nameSummary({ names, total }: ProvenanceNames): string {
  const head = names.slice(0, PROVENANCE_NAME_LIMIT).join("、");
  return total > PROVENANCE_NAME_LIMIT ? `${head} +${total - PROVENANCE_NAME_LIMIT}` : head;
}

export function summarizeUserProvenance(created: ProvenanceNames, reviewed: ProvenanceNames, locale?: string): string[] {
  return [
    ...(created.total > 0 ? [`${tForLocale(locale, "panels.platformOntology.userCreated")}: ${nameSummary(created)}`] : []),
    ...(reviewed.total > 0 ? [`${tForLocale(locale, "panels.platformOntology.userPublished")}: ${nameSummary(reviewed)}`] : []),
  ];
}

export function userOntologyObject(member: RawMemberIdentity, provenance: readonly string[]): SearchableOntologyObjectItem {
  const detail = [member.loginCode, ...provenance].filter(Boolean).join(" · ");
  return {
    node: { className: USER, primaryKey: member.id },
    label: member.displayName || member.loginCode || member.id,
    ...(detail && { detail }),
  };
}

const workflowProvenanceSchema = z.array(z.object({
  name: z.string().trim(),
  createdBy: z.string().trim().nullish(),
  reviewedBy: z.string().trim().nullish(),
}));

type UserProvenance = z.infer<typeof workflowProvenanceSchema>[number];

/**
 * The actions, workflows and metric views a user created or reviewed, summarised onto the user node.
 *
 * Being the creator or the reviewer of a definition is provenance rather than authority, so it is not
 * drawn as an edge; the names stay readable on the user node instead.
 */
async function collectUserProvenance(
  readers: PlatformOntologyOwnerReaders, members: readonly RawMemberIdentity[], rows: readonly UserProvenance[],
): Promise<ReadonlyMap<string, string[]>> {
  const locale = readers.credentials.locale;
  const rawIds = new Set(rows.flatMap((row) => [row.createdBy, row.reviewedBy]).filter((id): id is string => Boolean(id)));
  const userIds = new Map<string, string>();
  for (const rawId of rawIds) userIds.set(rawId, await readers.normalizeSubjectId(rawId, members));
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
    summaries.set(userId, summarizeUserProvenance(
      { names: createdNames, total: createdNames.length },
      { names: reviewedNames, total: reviewedNames.length }, locale,
    ));
  }
  return summaries;
}

interface InstanceDirectoryPlan {
  facts: readonly OntologyReadFact[];
  read(facts?: readonly JavaPanelReadResult[]): Promise<OwnerObjectsResult>;
}

function planJavaInstanceDirectory<T>(
  type: string, name: string, schema: z.ZodType<T[], z.ZodTypeDef, unknown>,
  readLegacy: () => Promise<OwnerReadResult<T[]>>,
  present: (row: T) => SearchableOntologyObjectItem,
): InstanceDirectoryPlan {
  return {
    facts: [{ call: { type, name, parameters: {} } }],
    async read(results) {
      const rows = results ? readOntologyOwnerFact(results[0], schema, name) : await readLegacy();
      return rows.ok ? { ok: true, data: rows.data.map(present) } : rows;
    },
  };
}

export function workflowOntologyObject(wf: RawWorkflow): SearchableOntologyObjectItem {
  return {
    node: { className: WORKFLOW, primaryKey: wf.id },
    label: wf.name,
    detail: wf.version !== undefined ? `v${wf.version}` : wf.status,
    metadata: {
      ...(wf.status !== undefined && { status: wf.status }),
      ...(wf.version !== undefined && { version: wf.version }),
    },
  };
}

export function organizationGrantObject(grant: z.output<typeof orgGrantInstanceDirectorySchema>[number], locale?: string) {
  return {
    node: { className: ORG_GRANT, primaryKey: grant.id },
    label: `${tForLocale(locale, `platformOntology.orgGrantScope.${grant.grantType}`)} · ${grant.sourceName ?? grant.sourceId}`,
  };
}

async function readOrganizationInstanceRows<T>(
  readers: PlatformOntologyOwnerReaders, select: (snapshot: RawOrganizationSnapshot) => T[],
): Promise<OwnerReadResult<T[]>> {
  const rows = await readers.organizationSnapshot();
  return rows.ok ? { ok: true, data: select(rows.data) } : rows;
}

function planVisibleInstanceDirectory<T extends { id: string }>(
  readers: PlatformOntologyOwnerReaders, kind: "PANEL" | "PROJECTION" | "AGENT", verb: "USE" | "VIEW",
  includeDomainShared: boolean, readRows: (range?: DefinitionVisibilityRange) => Promise<OwnerReadResult<T[]>>,
  present: (row: T, shared: boolean) => SearchableOntologyObjectItem,
): InstanceDirectoryPlan {
  const markShared = includeDomainShared && kind !== "PROJECTION";
  const facts: OntologyReadFact[] = [{ visibleKinds: [{ kind, verbs: [verb] }] }];
  if (markShared)
    facts.push({ call: { type: ONTOLOGY_TYPE, name: "domainSharedUse", parameters: { kind } } });
  return {
    facts,
    async read(results) {
      const scope = results && readOntologyVisibilityFact(results[0], kind, verb);
      if (scope && !scope.ok) return scope;
      const rows = await readRows(scope?.data);
      if (!rows.ok) return rows;
      let shared: ReadonlySet<string> = new Set();
      if (markShared && rows.data.length > 0) {
        if (results) {
          const marks = readOntologyOwnerFact(results[1], z.array(z.string().min(1)), "domainSharedUse");
          if (!marks.ok) return marks;
          shared = new Set(marks.data);
        } else {
          shared = await readDomainSharedProductIds(readers, kind);
        }
      }
      return { ok: true, data: rows.data.map(row => present(row, shared.has(row.id))) };
    },
  };
}

export type ModelInstanceType = typeof OBJECT_TYPE | typeof ATTRIBUTE | typeof RELATIONSHIP;

export function isModelInstanceType(type: string): type is ModelInstanceType {
  return type === OBJECT_TYPE || type === ATTRIBUTE || type === RELATIONSHIP;
}

export function modelInstanceObjects(type: ModelInstanceType, metadata: RawOntologyMeta): SearchableOntologyObjectItem[] {
  switch (type) {
    case OBJECT_TYPE:
      return metadata.classes.map(cls => ({
        node: { className: OBJECT_TYPE, primaryKey: cls.className },
        label: cls.showName || cls.classDesc || cls.className,
        detail: cls.className,
        ...(cls.classDesc ? { searchText: cls.classDesc, metadata: { description: cls.classDesc } } : {}),
      }));
    case ATTRIBUTE:
      return metadata.classes.flatMap(cls => cls.attrs.map(attr => ({
        node: { className: ATTRIBUTE, primaryKey: attributeKey(cls.className, attr.name) },
        label: attr.showName || attr.name,
        detail: cls.className,
      })));
    case RELATIONSHIP:
      return metadata.relationships.map(rel => ({
        node: { className: RELATIONSHIP, primaryKey: rel.relationship },
        label: rel.showName || rel.desc || rel.relationship,
        detail: rel.fromclass && rel.toclass ? rel.fromclass + " → " + rel.toclass : undefined,
        ...(rel.desc ? { searchText: rel.desc, metadata: { description: rel.desc } } : {}),
      }));
  }
}

function planModelInstanceDirectory(
  readers: PlatformOntologyOwnerReaders, type: ModelInstanceType,
): InstanceDirectoryPlan {
  const name = "modelInstanceDirectory";
  const schema: z.ZodType<Record<string, unknown>> = type === RELATIONSHIP
    ? z.object({ relationDef: z.union([z.array(z.unknown()), z.record(z.unknown())]) })
    : z.object({ classDef: z.array(z.unknown()) });
  return {
    facts: [{ call: { type: ONTOLOGY_TYPE, name, parameters: { type } } }],
    async read(results) {
      let metadata: RawOntologyMeta;
      if (results) {
        const raw = readOntologyOwnerFact(results[0], schema, name);
        if (!raw.ok) return raw;
        metadata = parseOntologyMeta(raw.data);
      } else {
        const data = await readers.ontologyMeta();
        if (!data.ok) return data;
        metadata = data.data;
      }
      return { ok: true, data: modelInstanceObjects(type, metadata) };
    },
  };
}

export function ontologyAgentDefinitionObject(
  agent: { id: string; name: string; enabled: boolean }, shared: boolean, locale: string | undefined,
): SearchableOntologyObjectItem {
  return {
    node: { className: AGENT_DEFINITION, primaryKey: agent.id },
    label: agent.name,
    metadata: { enabled: agent.enabled },
    detail: withDomainSharedDetail(agent.enabled ? "enabled" : "disabled", shared, locale),
  };
}

/** Select the owner's directory facts and map them in the same type definition. */
export function planPlatformOntologyInstanceDirectory(
  readers: PlatformOntologyOwnerReaders, type: string, includeDomainShared: boolean,
): InstanceDirectoryPlan | undefined {
  const locale = readers.credentials.locale;
  switch (type) {
    case OBJECT_TYPE:
    case ATTRIBUTE:
    case RELATIONSHIP:
      return planModelInstanceDirectory(readers, type);
    case APPLICATION: {
      const navigation = { type: APPLICATION, name: "navigation", parameters: {} } as const;
      const sharedEntries = { type: APPLICATION, name: "ontologyDomainShared", parameters: {} } as const;
      return {
        facts: includeDomainShared ? [{ call: navigation }, { call: sharedEntries }] : [{ call: navigation }],
        async read(facts) {
          const navigationFact = facts && readOntologyOwnerFact(facts[0], applicationCatalogSchema, navigation.name);
          const directory = navigationFact
            ? navigationFact.ok
              ? { ok: true as const, data: navigationFact.data.map(app => ontologyApplicationName(app, locale)) }
              : navigationFact
            : await readers.applications();
          if (!directory.ok) return directory;
          let shared: ReadonlySet<string> = new Set();
          if (includeDomainShared && directory.data.length > 0) {
            if (facts) {
              const marks = readOntologyOwnerFact(facts[1], z.array(z.string().min(1)), sharedEntries.name);
              if (!marks.ok) return marks;
              shared = new Set(marks.data);
            } else {
              shared = await readDomainSharedProductIds(readers, "APPLICATION");
            }
          }
          return {
            ok: true,
            data: directory.data.map(app => ({
              node: { className: APPLICATION, primaryKey: app.id },
              label: app.name,
              detail: withDomainSharedDetail(app.kind, shared.has(app.id), locale),
            })),
          };
        },
      };
    }
    case AGENT_DEFINITION:
      return planVisibleInstanceDirectory(readers, "AGENT", "VIEW", includeDomainShared,
        range => readers.agentDefinitions(range),
        (agent, shared) => ontologyAgentDefinitionObject(agent, shared, locale));
    case PRODUCT_PROJECTION:
      return planVisibleInstanceDirectory(readers, "PROJECTION", "USE", false,
        range => readers.productProjections(range),
        projection => ({
          node: { className: PRODUCT_PROJECTION, primaryKey: projection.id },
          label: projection.name,
          detail: projection.componentId,
          ...(projection.description ? {
            searchText: projection.description, metadata: { description: projection.description },
          } : {}),
        }));
    case PRODUCT_PANEL:
      return planVisibleInstanceDirectory(readers, "PANEL", "USE", includeDomainShared,
        range => readers.productPanels(range && { range }),
        (panel, shared) => {
          const detail = withDomainSharedDetail(panel.description || undefined, shared, locale);
          return {
            node: { className: PRODUCT_PANEL, primaryKey: panel.id },
            label: panel.name,
            ...(detail ? { detail } : {}),
            ...(panel.description && { metadata: { description: panel.description } }),
          };
        });
    case METRIC_VIEW:
      return planJavaInstanceDirectory(type, "list", metricViewDirectorySchema,
        () => readers.metricViews(), (m) => ({
          node: { className: METRIC_VIEW, primaryKey: m.id },
          label: m.name,
          detail: m.status,
          ...(m.status !== undefined && { metadata: { status: m.status } }),
        }));
    case FUNCTION:
      return planJavaInstanceDirectory(type, "list", functionDirectorySchema,
        () => readers.functions(), (fn) => ({
          node: { className: FUNCTION, primaryKey: fn.id },
          label: fn.name,
          detail: fn.operation,
        }));
    case ACTION:
      return planJavaInstanceDirectory(type, "list", actionDirectorySchema,
        () => readers.actions(), (action) => ({
          node: { className: ACTION, primaryKey: action.id },
          label: action.name,
          detail: action.status,
          ...(action.status !== undefined && { metadata: { status: action.status } }),
        }));
    case WORKFLOW:
      return planJavaInstanceDirectory(type, "instanceDirectory", workflowDirectorySchema,
        () => readers.workflows(), workflowOntologyObject);
    case TRIGGER:
      return planJavaInstanceDirectory(type, "list", platformTaskListSchema.transform(({ tasks }) => tasks),
        () => readers.triggers(), triggerObject);
    case BUSINESS_KNOWLEDGE:
      return planJavaInstanceDirectory(type, "query", knowledgeDirectorySchema,
        () => readers.knowledge(), (k) => ({
          node: { className: BUSINESS_KNOWLEDGE, primaryKey: k.id },
          label: k.title,
          ...(k.status !== undefined && { metadata: { status: k.status } }),
        }));
    case ROLE: {
      const directory = readers.planRoleDirectory();
      return {
        facts: directory.facts,
        async read(results) {
          const res = await directory.read(results);
          if (!res.ok) return res;
          return {
            ok: true,
            data: res.data.roles.map((role) => ({
              node: { className: ROLE, primaryKey: role.id },
              label: role.code ?? role.id,
            })),
          };
        },
      };
    }
    case PERMISSION_POLICY: {
      const directory = { type, name: "instanceDirectory", parameters: {} };
      const createKinds = { type, name: "instanceCreateKinds", parameters: { targetKinds: Object.keys(POLICY_OBJECT_KINDS) } };
      return {
        facts: [{ call: directory }, { call: createKinds }],
        async read(results) {
          const policies = results
            ? readOntologyOwnerFact(results[0], permissionPolicyDirectorySchema, directory.name)
            : await readers.permissionPolicies();
          if (!policies.ok) return policies;
          const grants = results
            ? readOntologyOwnerFact(results[1], policyCreateKindsSchema, createKinds.name)
            : await readers.policyCreateKinds();
          return {
            ok: true,
            data: policies.data.map((policy) => {
              const detail = grants.ok ? policyCreationDetail(grants.data, policy.id, locale) : undefined;
              return {
                node: { className: PERMISSION_POLICY, primaryKey: policy.id },
                label: policy.name,
                ...(detail && { detail }),
              };
            }),
          };
        },
      };
    }
    case ORG_UNIT:
      return planJavaInstanceDirectory(type, "instanceDirectory", orgUnitInstanceDirectorySchema,
        () => readOrganizationInstanceRows(readers, ({ units }) => units), unit => ({
          node: { className: ORG_UNIT, primaryKey: unit.id },
          label: unit.name,
          ...(unit.code ? { detail: unit.code } : {}),
        }));
    case ORG_POSITION:
      return planJavaInstanceDirectory(type, "instanceDirectory", orgPositionInstanceDirectorySchema,
        () => readOrganizationInstanceRows(readers, ({ units, positions }) => {
          const names = new Map(units.map(unit => [unit.id, unit.name]));
          return positions.map(({ id, name, orgId }) => ({ id, name, orgName: names.get(orgId) }));
        }), position => ({
          node: { className: ORG_POSITION, primaryKey: position.id },
          label: position.name,
          ...(position.orgName ? { detail: position.orgName } : {}),
        }));
    case ORG_GRANT:
      return planJavaInstanceDirectory(type, "instanceDirectory", orgGrantInstanceDirectorySchema,
        () => readOrganizationInstanceRows(readers, ({ units, positions, grants }) => {
          const unitNames = new Map(units.map(unit => [unit.id, unit.name]));
          const positionNames = new Map(positions.map(position => [position.id, position.name]));
          return grants.map(({ id, grantType, sourceId }) => ({
            id, grantType, sourceId, sourceName: (grantType === "position" ? positionNames : unitNames).get(sourceId),
          }));
        }), grant => organizationGrantObject(grant, locale));
    case USER: {
      const directory = { type, name: "instanceDirectory", parameters: {} };
      const actions = { type: ACTION, name: "list", parameters: {} };
      const workflows = { type: WORKFLOW, name: "instanceProvenance", parameters: {} };
      const metrics = { type: METRIC_VIEW, name: "list", parameters: {} };
      return {
        facts: [{ call: directory }, { call: actions }, { call: workflows }, { call: metrics }],
        async read(results) {
          const members = results
            ? readOntologyOwnerFact(results[0], memberIdentityDirectorySchema, directory.name)
            : await readers.subjects();
          if (!members.ok) return members;
          const sources: readonly OwnerReadResult<UserProvenance[]>[] = results
            ? [
              readOntologyOwnerFact(results[1], actionDirectorySchema, actions.name),
              readOntologyOwnerFact(results[2], workflowProvenanceSchema, workflows.name),
              readOntologyOwnerFact(results[3], metricViewDirectorySchema, metrics.name),
            ]
            : await Promise.all([readers.actions(), readers.workflows(), readers.metricViews()]);
          const provenance = await collectUserProvenance(readers, members.data,
            sources.flatMap(source => source.ok ? source.data : []));
          return {
            ok: true,
            data: members.data.map(member => userOntologyObject(member, provenance.get(member.id) ?? [])),
          };
        },
      };
    }
    case DEFINITION: return {
      facts: [],
      read: async () => ontologyDefinitionObjects(await readers.definitions()),
    };
    case SDK_COMPONENT: return {
      facts: [],
      async read() { return sdkComponentObjects(await readers.sdkComponents()); },
    };
  }
}

export function planPlatformOntologyBrowserDirectory(
  readers: PlatformOntologyOwnerReaders, type: string, includeDomainShared = true,
): InstanceDirectoryPlan {
  if (type === SKILL) {
    const directory = readers.planSkillDirectory();
    return {
      facts: directory.facts,
      async read(results) {
        const res = await directory.read(results);
        if (!res.ok) return res;
        return {
          ok: true,
          data: res.data.map(skill => ({
            node: { className: SKILL, primaryKey: skill.primaryKey },
            label: skill.title,
            ...(skill.description ? { searchText: skill.description, metadata: { description: skill.description } } : {}),
          })),
        };
      },
    };
  }
  return planPlatformOntologyInstanceDirectory(readers, type, includeDomainShared) ?? {
    facts: [],
    read: async () => ({ ok: false, status: "unavailable", reason: `No owner adapter registered for ${type}` }),
  };
}

/** Lists objects of a declared type for the object picker and label lookup. */
function readObjectsOfType(
  readers: PlatformOntologyOwnerReaders, type: string, includeDomainShared = true,
): Promise<OwnerObjectsResult> {
  return planPlatformOntologyBrowserDirectory(readers, type, includeDomainShared).read();
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
  const response = await presentPlatformOntologyCounts(types, type => readers.count(type));

  logger.info("platform ontology counts read", {
    durationMs: Math.round(performance.now() - started),
    ownerCalls: readers.ownerCallCount,
  });

  return response;
}

export async function presentPlatformOntologyCounts(
  types: readonly PlatformOntologyType[], readCount: (type: string) => Promise<OntologyCount>,
): Promise<PlatformOntologyCountsResponse> {
  const counts = await Promise.all(
    types.map(async (spec): Promise<PlatformOntologyTypeCount> => {
      const res = await readCount(spec.id);
      if (res.ok) {
        return { type: spec.id, layer: spec.layer, status: "ok", count: res.data };
      }
      return { type: spec.id, layer: spec.layer, status: res.status, reason: res.reason };
    }),
  );

  return { counts };
}

export async function readPlatformOntologyStart(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  callerUserName?: string,
): Promise<PlatformOntologyNode> {
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const subjectsRes = await readers.subjects();
  const matched = subjectsRes.ok ? subjectsRes.data.find((subj) => subj.id === owner.userId) : undefined;
  return platformOntologyStartNode(owner.userId, callerUserName, matched && (matched.displayName || matched.loginCode));
}

export function platformOntologyStartNode(userId: string, viewerName?: string | null, memberName?: string): PlatformOntologyNode {
  // OSS uses hostOwner (`system`), and enterprise callers without subject directory access still keep their real user ID.
  return {
    className: USER,
    primaryKey: userId,
    label: memberName?.trim() || viewerName?.trim() || userId,
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
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  return searchPlatformOntologyInstancePage(input, credentials.locale, (type, includeDomainShared) =>
    readObjectsOfType(readers, type, includeDomainShared));
}

export function platformOntologyInstanceDirectories(input: PlatformOntologyObjectsRequest) {
  const all = input.type === ALL_PLATFORM_ONTOLOGY_TYPES || input.type === "*";
  const types = all ? input.keyword?.trim() ? PLATFORM_ONTOLOGY_TYPES : [] : [requireTypeSpec(input.type)];
  return { all, types };
}

export async function searchPlatformOntologyInstancePage(
  input: PlatformOntologyObjectsRequest, locale: string | undefined,
  readDirectory: (type: string, includeDomainShared: boolean) => Promise<OwnerObjectsResult>,
): Promise<PlatformOntologyInstancePage> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50));
  const keyword = input.keyword?.trim().toLowerCase() ?? "";

  const { all, types } = platformOntologyInstanceDirectories(input);
  if (all) {
    if (!types.length) {
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

    const results = await Promise.all(
      types.map(async (spec) => ({
        spec,
        res: await readDirectory(spec.id, false),
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
      const typeLabel = tForLocale(locale, spec.labelKey);
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

  const [spec] = types;
  const res = await readDirectory(spec.id, true);

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

export function triggerObject(tr: PlatformTask): SearchableOntologyObjectItem {
  return {
    node: { className: TRIGGER, primaryKey: tr.id },
    label: tr.title,
    detail: tr.targetKind,
    metadata: { enabled: tr.enabled, status: tr.status, version: tr.version },
  };
}

export async function readPlatformOntologyInstance(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  node: PlatformOntologyNodeRef,
): Promise<SearchableOntologyObjectItem> {
  if (node.className === TRIGGER) return triggerObject(await triggerClient(credentials).task(node.primaryKey));
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  return findPlatformOntologyInstance(node, await readObjectsOfType(readers, node.className));
}

export function requirePlatformOntologyInstanceType(className: string): void {
  if (!PLATFORM_ONTOLOGY_TYPE_MAP.has(className))
    throw new HttpError(404, `Unknown platform ontology type: ${className}`, "OBJECT_NOT_FOUND");
}

export function findPlatformOntologyInstance(
  node: PlatformOntologyNodeRef, result: OwnerObjectsResult,
): SearchableOntologyObjectItem {
  if (!result.ok) throw platformOntologyOwnerReadError(result.status, result.reason);
  const item = result.data.find(candidate => candidate.node.primaryKey === node.primaryKey);
  if (!item) throw new HttpError(404, `Object not found: ${node.className}~${node.primaryKey}`, "OBJECT_NOT_FOUND");
  return item;
}

export function ontologyDefinitionObjects(definitions: OwnerReadResult<RawDefinition[]>): OwnerObjectsResult {
  return definitions.ok ? { ok: true, data: definitions.data.map(def => ({
    node: { className: DEFINITION, primaryKey: def.id }, label: def.name, detail: def.objectType,
  })) } : definitions;
}

export function evaluateDefinitionObjectType(
  node: PlatformOntologyNodeRef, definitions: OwnerReadResult<RawDefinition[]>,
): RelationEvalResult {
  if (!definitions.ok) return { status: definitions.status, reason: definitions.reason, edges: [] };
  const edges: RawEdgeCandidate[] = [];
  for (const def of definitions.data) {
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

export async function evaluateAgentExecutionUser(
  node: PlatformOntologyNodeRef,
  agents: OwnerReadResult<readonly { id: string; name?: string; executionUserId: string | null }[]>,
  normalizeSubjectId: (id: string) => Promise<string>,
): Promise<RelationEvalResult> {
  if (!agents.ok) return { status: agents.status, reason: agents.reason, edges: [] };
  const edges: RawEdgeCandidate[] = [];
  for (const agent of agents.data) {
    if (!agent.executionUserId) continue;
    const userId = await normalizeSubjectId(agent.executionUserId);
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

export function evaluateProjectionBindings(
  node: PlatformOntologyNodeRef, res: OwnerReadResult<RawProductProjection[]>,
): RelationEvalResult {
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

/** Use the graph's edge filters when planning endpoint facts before the owner batch. */
export function neighborCandidate(
  input: PlatformOntologyNeighborsRequest, candidate: RawEdgeCandidate,
): { direction: "incoming" | "outgoing"; opposite: PlatformOntologyNodeRef } | undefined {
  const direction = nodeKey(candidate.from) === nodeKey(input.node) ? "outgoing" : "incoming";
  if (input.direction && input.direction !== "both" && input.direction !== direction) return;
  const opposite = direction === "outgoing" ? candidate.to : candidate.from;
  if (input.targetClass && opposite.className !== input.targetClass) return;
  const layer = resolveNodeLayer(opposite);
  if (!layer || (input.layers?.length && !input.layers.includes(layer))) return;
  return { direction, opposite };
}

export function evaluateProjectionComponent(
  node: PlatformOntologyNodeRef, projections: OwnerReadResult<RawProductProjection[]>,
): RelationEvalResult {
  if (!projections.ok) return { status: projections.status, reason: projections.reason, edges: [] };
  const edges: RawEdgeCandidate[] = [];
  for (const projection of projections.data) {
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

export function modelRelationEdges(kind: string, node: PlatformOntologyNodeRef, metadata: RawOntologyMeta): RawEdgeCandidate[] {
  switch (kind) {
    case "object-type.has-attribute": {
      const edges: RawEdgeCandidate[] = [];
      if (node.className === OBJECT_TYPE) {
        const cls = metadata.classes.find((c) => c.className === node.primaryKey);
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
          const cls = metadata.classes.find((c) => c.className === className);
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
      return edges;
    }

    case "relationship.from-object-type":
    case "relationship.to-object-type": {
      const field = kind === "relationship.from-object-type" ? "fromclass" : "toclass";
      const edges: RawEdgeCandidate[] = [];
      for (const rel of metadata.relationships) {
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
      return edges;
    }

    default: throw new Error("Unexpected ontology model relation: " + kind);
  }
}

/** Evaluates one declared relation kind for the requested center node (outgoing or incoming). */
async function evaluateRelationKind(
  readers: PlatformOntologyOwnerReaders,
  spec: PlatformRelationKindDeclaration,
  node: PlatformOntologyNodeRef,
): Promise<RelationEvalResult> {
  const locale = readers.credentials.locale;
  switch (spec.id) {
    case "object-type.has-attribute":
    case "relationship.from-object-type":
    case "relationship.to-object-type": {
      const res = await readers.ontologyMeta();
      return res.ok
        ? { status: "ok", edges: modelRelationEdges(spec.id, node, res.data) }
        : { status: res.status, reason: res.reason, edges: [] };
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

    case "definition.based-on-object-type":
      return evaluateDefinitionObjectType(node, await readers.definitions());

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
        if (tr.targetKind !== "workflow") continue;
        if (
          (node.className === TRIGGER && tr.id === node.primaryKey) ||
          (node.className === WORKFLOW && tr.targetId === node.primaryKey)
        ) {
          edges.push({
            from: { className: TRIGGER, primaryKey: tr.id },
            to: { className: WORKFLOW, primaryKey: tr.targetId },
            fromLabel: tr.title,
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
        if (tr.targetKind !== "action") continue;
        if (
          (node.className === TRIGGER && tr.id === node.primaryKey) ||
          (node.className === ACTION && tr.targetId === node.primaryKey)
        ) {
          edges.push({
            from: { className: TRIGGER, primaryKey: tr.id },
            to: { className: ACTION, primaryKey: tr.targetId },
            fromLabel: tr.title,
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

    case "role.owns-workflow-step":
      return evaluateWorkflowStepOwnership(node, await readers.grants(), locale);

    case "agent.uses-skill": {
      const res = await readers.agentSkillRelations(node.className === AGENT_DEFINITION ? node.primaryKey : undefined);
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

    case "agent.executes-as-user":
      return evaluateAgentExecutionUser(node,
        await readers.agentExecutionUserRelations(node.className === AGENT_DEFINITION ? node.primaryKey : undefined),
        rawId => readers.normalizeSubjectId(rawId));

    case "projection.uses-component":
      return evaluateProjectionComponent(node, await readers.productProjections());

    case "projection.binds-target":
      return evaluateProjectionBindings(node, await readers.productProjections());

    case "panel.contains-projection":
    case "panel.contains-panel":
      return evaluatePanelContainment(spec.id, node, undefined, {
        panels: () => readers.productPanels(),
        targets: () => readers.grantedUseIds(),
        objectDetailPanelMappings: () => readers.objectDetailPanelMappings(),
      });

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
      return evaluatePolicyDataPermissions(node, await readers.policyDataPermissions());
    }

    case "permission-policy.can-enter-application": {
      const facts = await readers.authorizationGraphFacts();
      return evaluatePolicyEntryGrants(node, facts.ok ? { ok: true, data: facts.data.policyGrants } : facts, locale);
    }

    case "permission-policy.can-execute-action":
    case "permission-policy.can-use-object": {
      const facts = await readers.authorizationGraphFacts();
      if (!facts.ok) return { status: facts.status, reason: facts.reason, edges: [] };
      const granted = policyGrantEdges(facts.data, node, locale);
      const collected = spec.id === "permission-policy.can-execute-action" ? granted.action : granted.object;
      return { status: "ok", edges: collected };
    }

    default:
      return { status: "unavailable", reason: `Unhandled relation kind: ${spec.id}`, edges: [] };
  }
}

export function evaluateWorkflowStepOwnership(
  node: PlatformOntologyNodeRef, result: OwnerReadResult<RawGrant[]>, locale?: string,
): RelationEvalResult {
  if (!result.ok) return { status: result.status, reason: result.reason, edges: [] };
  const edges: RawEdgeCandidate[] = [];
  for (const grant of result.data) {
    if (!grant.inForce || !grant.roleId || !grant.workflowId || !grant.stepNo) continue;
    if ((node.className === ROLE && grant.roleId === node.primaryKey) ||
        (node.className === WORKFLOW && grant.workflowId === node.primaryKey)) {
      edges.push({
        from: { className: ROLE, primaryKey: grant.roleId },
        to: { className: WORKFLOW, primaryKey: grant.workflowId },
        fromLabel: grant.roleCode ?? undefined,
        authorization: {
          stepNo: grant.stepNo,
          ...(grant.activatedByWorkflowVersion ? { version: Number(grant.activatedByWorkflowVersion) } : {}),
          ...scopeAuthorization(locale, grant.scope),
        },
      });
    }
  }
  return { status: "ok", edges };
}

export function evaluatePolicyDataPermissions(
  node: PlatformOntologyNodeRef,
  facts: OwnerReadResult<readonly { policyId: string; className: string }[]>,
): RelationEvalResult {
  if (!facts.ok) return { status: facts.status, reason: facts.reason, edges: [] };
  const edges: RawEdgeCandidate[] = [];
  for (const perm of facts.data) {
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

export async function readPlatformOntologyNeighbors(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  input: PlatformOntologyNeighborsRequest,
  callerUserName?: string,
): Promise<PlatformOntologyNeighborsResponse> {
  const started = performance.now();
  const readers = new PlatformOntologyOwnerReaders(owner, credentials);
  const applicable = selectPlatformOntologyRelations(input);
  const response = await assemblePlatformOntologyNeighbors(owner, input, callerUserName, applicable, {
    center: () => readObjectsOfType(readers, input.node.className),
    objects: type => readObjectsOfType(readers, type),
    relation: spec => evaluateRelationKind(readers, spec, input.node),
  });
  logger.info("platform ontology neighbors read", {
    durationMs: Math.round(performance.now() - started),
    nodeType: input.node.className,
    relationCount: applicable.length,
    ownerCalls: readers.ownerCallCount,
    neighborCount: response.neighbors.length,
    edgeCount: response.total,
  });
  return response;
}

export function selectPlatformOntologyRelations(input: PlatformOntologyNeighborsRequest) {
  const kindFilter = input.relationKinds?.length ? new Set(input.relationKinds) : null;
  const { className, primaryKey } = input.node;
  const { targetClass, direction } = input;
  const matchesOppositeType = (type: string) => matchesOntologyNeighborType(input, type);

  return PLATFORM_ONTOLOGY_RELATION_KINDS.filter((rel) => {
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
}

function matchesOntologyNeighborType(input: PlatformOntologyNeighborsRequest, type: string) {
  return (!input.targetClass || type === input.targetClass)
    && (!input.layers?.length || input.layers.includes(PLATFORM_ONTOLOGY_TYPE_MAP.get(type)!.layer));
}

export function policyObjectTargetKinds(input: PlatformOntologyNeighborsRequest) {
  const { className } = input.node;
  return Object.entries(POLICY_OBJECT_KINDS).filter(([, type]) =>
    className === PERMISSION_POLICY ? matchesOntologyNeighborType(input, type) : className === type);
}

interface NeighborSources {
  center(): Promise<OwnerObjectsResult & { emptyDirectory?: boolean }>;
  objects(type: string, ids: readonly string[]): Promise<OwnerObjectsResult>;
  relation(spec: PlatformRelationKindDeclaration): Promise<RelationEvalResult>;
}

export async function assemblePlatformOntologyNeighbors(
  owner: ProductOwner, input: PlatformOntologyNeighborsRequest, callerUserName: string | null | undefined,
  applicableRelations: readonly PlatformRelationKindDeclaration[], sources: NeighborSources,
): Promise<PlatformOntologyNeighborsResponse> {
  const { className, primaryKey } = input.node;
  if (className === ONTOLOGY_TYPE && !PLATFORM_ONTOLOGY_TYPE_MAP.has(primaryKey)) {
    throw new HttpError(404, `Unknown platform ontology type: ${primaryKey}`, "OBJECT_NOT_FOUND");
  }
  const centerLayer = requireNodeLayer(input.node);
  if (className !== ONTOLOGY_TYPE) {
    const isSelfUser = className === USER && primaryKey === owner.userId;
    const centerRes = await sources.center();
    if (centerRes.ok) {
      // The OSS subject directory is empty, but the authenticated user is still the default start.
      if (!centerRes.data.some((item) => item.node.primaryKey === primaryKey) &&
          !(isSelfUser && (centerRes.emptyDirectory ?? centerRes.data.length === 0))) {
        throw new HttpError(404, `Object not found: ${className}~${primaryKey}`, "OBJECT_NOT_FOUND");
      }
    } else if (!isSelfUser) throw platformOntologyOwnerReadError(centerRes.status, centerRes.reason);
  }
  const centerKey = nodeKey(input.node);

  const { limit, offset = 0 } = input;

  const evaluations = await Promise.all(
    applicableRelations.map(async (rel) => ({
      spec: rel,
      result: await sources.relation(rel),
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
      const matched = neighborCandidate(input, candidate);
      if (!matched) continue;
      const { direction } = matched;

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
  const idsByType = new Map<string, string[]>();
  for (const ref of [input.node, ...neighborRefs.values()]) {
    if (ref.className === ONTOLOGY_TYPE) continue;
    const ids = idsByType.get(ref.className) ?? [];
    ids.push(ref.primaryKey);
    idsByType.set(ref.className, ids);
  }

  const labelMaps = new Map<string, Map<string, { label: string; detail?: string }>>();
  await Promise.all(
    [...idsByType].map(async ([typeId, ids]) => {
      const res = await sources.objects(typeId, ids);
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
