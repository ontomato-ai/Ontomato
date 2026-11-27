import { runtimeSkillKey } from "@ontomato/contracts/agent-runtime-skills";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
import { platformObjectTypes } from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import type { PlatformOntologyNodeRef } from "@ontomato/contracts/platform-ontology";
import {
  builtinProductPanelInputSchema,
  builtinProductProjectionInputSchema,
  productPanelInputSchema,
  productProjectionInputSchema,
  type BuiltinProductPanelInput,
  type BuiltinProductProjectionInput,
  type ProductPanelInput,
  type ProductProjectionInput,
} from "@ontomato/contracts/product-panels";
import { config } from "../../config/application";
import { workbenchManagement } from "@ontomato/contracts/workbench-management";
import { assertManagement } from "../../identity/management";
import { getPostgresPool } from "../../infrastructure/postgres";
import { currentProductRows, findCurrentProduct, type CurrentProductKind, type CurrentProductRow } from "../../infrastructure/product-current";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { AuthFailedError, BackendResponseError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { readAuthorizationGraphFacts, type AuthorizationGraphFacts } from "../governance/policy-access";
import { HttpError } from "../../utils/errors";
import { countVisibleAgentDefinitions } from "../assistant/definitions";
import { listAgentDefinitionNodes, listAgentExecutionUserRelations, listAgentSkillRelations } from "../assistant/definition-relations";
import { assistantSkillCatalog, countAssistantSkills } from "../assistant/skills";
import { countPublishedDefinitions, listPublishedDefinitions, type PublishedDefinitionSelection } from "../business-definitions/definitions";
import type { ProductOwner } from "../product-governance/service-authentication";
import { countCurrentDefinitionsInRange, countUsableCurrentDefinitions, currentProductVisibility, usableCurrentDefinitionIds, type DefinitionVisibilityRange } from "../product-panels/access";
import type { ObjectKind, ObjectVerb } from "../product-governance/authorization";
import { readPanelComponentCatalogue } from "../product-panels/component-catalogue";
import type { JavaPanelRead, JavaPanelReadResult } from "../product-panels/java-panel-reads";
import { listObjectDetailPanelMappings } from "../product-panels/object-detail";
import { triggerClient } from "../scheduling/trigger-client";

import {
  ACTION, AGENT_DEFINITION, APPLICATION, ATTRIBUTE, BUSINESS_KNOWLEDGE, DEFINITION, FUNCTION, METRIC_VIEW,
  OBJECT_TYPE, ONTOLOGY_TYPE, ORG_GRANT, ORG_POSITION, ORG_UNIT, PERMISSION_POLICY, PRODUCT_PANEL, PRODUCT_PROJECTION,
  PLATFORM_OPERATION_OWNER_MAP, RELATIONSHIP, ROLE, SDK_COMPONENT, SKILL, TRIGGER, USER, WORKFLOW, resolveNodeLayer,
} from "./schema";

const logger = createLogger("platform-ontology-owners");
const countSchema = z.number().int().nonnegative();
const totalSchema = z.object({ total: countSchema });
const metaCountsSchema = z.object({ objectTypes: countSchema, attributes: countSchema, relationships: countSchema });
const organizationCountsSchema = z.object({ units: countSchema, positions: countSchema, grants: countSchema });
const grantRoleCountsSchema = totalSchema.extend({ outsideDirectory: countSchema });
const orgGrantTypeSchema = z.enum(["organization", "subtree", "position"]);

function ownerCountField<K extends string>(result: OwnerReadResult<Record<K, number>>, field: K): OwnerReadResult<number> {
  return result.ok ? { ok: true, data: result.data[field] } : result;
}

/** Align OSS's stored Java subject with the Workbench user when the member directory is empty. */
export async function normalizeOntologySubjectId(
  rawId: string, viewerId: string, directoryIsEmpty: () => boolean | Promise<boolean>,
): Promise<string> {
  if (viewerId !== "system" || rawId !== "admin") return rawId;
  return await directoryIsEmpty() ? "system" : rawId;
}

export type OwnerFailureStatus = "refused" | "failed";

export type OwnerReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: OwnerFailureStatus; reason: string };

export type OntologyReadFact = Pick<JavaPanelRead, "call" | "visibleKinds">;

export function readOntologyVisibilityFact(
  result: JavaPanelReadResult | undefined, kind: ObjectKind, verb: ObjectVerb,
): OwnerReadResult<DefinitionVisibilityRange> {
  const range = result?.status === "ready" ? result.visibility?.[kind]?.[verb] : undefined;
  if (range) return { ok: true, data: range };
  if (result?.status === "forbidden") return { ok: false, status: "refused", reason: result.error };
  return {
    ok: false, status: "failed",
    reason: result?.status === "error" ? result.error : `Missing ${kind}/${verb} visibility fact`,
  };
}

export type OntologyCount = OwnerReadResult<number> | { ok: false; status: "unavailable"; reason: string };

interface OntologyCountPlan {
  facts: readonly OntologyReadFact[];
  read(results?: readonly JavaPanelReadResult[]): Promise<OntologyCount>;
}

export function readOntologyOwnerFact<T>(
  result: JavaPanelReadResult | undefined, schema: z.ZodType<T, z.ZodTypeDef, unknown>, name: string,
): OwnerReadResult<T> {
  if (result === undefined || result.status === "empty")
    return { ok: false, status: "failed", reason: `Missing ontology fact: ${name}` };
  if (result.status === "forbidden") return { ok: false, status: "refused", reason: result.error };
  if (result.status === "error") return { ok: false, status: "failed", reason: result.error };
  const parsed = schema.safeParse(result.payload);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, status: "failed", reason: parsed.error.message };
}

function countCall(type: string, name = "count"): OntologyReadFact {
  return { call: { type, name, parameters: {} } };
}

export interface RawClassMeta {
  className: string;
  showName?: string;
  classDesc?: string;
  attrs: Array<{ name: string; showName?: string; type?: string; enable?: boolean }>;
}

export interface RawRelationshipMeta {
  relationship: string;
  showName?: string;
  desc?: string;
  fromclass?: string;
  toclass?: string;
}

export interface RawOntologyMeta {
  classes: RawClassMeta[];
  relationships: RawRelationshipMeta[];
}

export interface RawMetricView {
  id: string;
  name: string;
  status?: string;
  functionId?: string;
  createdBy?: string | null;
  reviewedBy?: string | null;
}

export interface RawFunction {
  id: string;
  name: string;
  operation?: string;
  classNames: string[];
}

export interface RawAction {
  id: string;
  name: string;
  status?: string;
  functionId?: string;
  targetClassName?: string;
  createdBy?: string | null;
  reviewedBy?: string | null;
}

export interface RawWorkflow {
  id: string;
  name: string;
  status?: string;
  version?: number;
  steps: Array<{ actionId?: string; roleCode?: string }>;
  createdBy?: string | null;
  reviewedBy?: string | null;
}

export interface RawKnowledge {
  id: string;
  title: string;
  status?: number;
}

export interface RawMemberIdentity {
  id: string;
  loginCode?: string;
  displayName?: string;
}

export interface RawSubject extends RawMemberIdentity {
  roleIds: string[];
}

/** The frozen range one grant applies to: every object, or one class field relative to the subject. */
export interface RawGrantScope {
  kind: string;
  className?: string | null;
  field?: string | null;
}

export interface RawGrant {
  roleId?: string | null;
  roleCode?: string | null;
  capabilityKind?: string | null;
  capabilityId?: string | null;
  /** Set only on grants activated by a workflow step, with the step and the revision that put them in force. */
  workflowId?: string | null;
  stepNo?: number | null;
  activatedByWorkflowVersion?: string | null;
  scope?: RawGrantScope | null;
  inForce: boolean;
}

export interface RawPlatformAccess {
  roleId?: string | null;
  roleCode?: string | null;
  apiPermissions: string[];
  managementRole: boolean;
}

export interface RawOrgUnit {
  id: string;
  name: string;
  code?: string;
  parentId?: string;
}

export interface RawOrgPosition {
  id: string;
  name: string;
  orgId: string;
}

export interface RawOrgMembership {
  userId: string;
  orgId: string;
}

export interface RawOrgPositionAssignment {
  userId: string;
  positionId: string;
}

export interface RawOrgGrant {
  id: string;
  grantType: z.infer<typeof orgGrantTypeSchema>;
  sourceId: string;
  roleIds: string[];
}

export interface RawOrganizationSnapshot {
  units: RawOrgUnit[];
  positions: RawOrgPosition[];
  memberships: RawOrgMembership[];
  positionAssignments: RawOrgPositionAssignment[];
  grants: RawOrgGrant[];
}

export interface RawPermissionPolicy {
  id: string;
  name: string;
  type?: number;
  fullData?: boolean;
  parentId?: string;
}

export interface RawRolePolicy {
  roleId: string;
  policyId: string;
}

export interface RawPolicyDataPermission {
  policyId: string;
  className: string;
}

export interface RawDefinition {
  id: string;
  name: string;
  objectType: string;
}

export interface RawSkill {
  primaryKey: string;
  title: string;
  description?: string;
}

export interface RawSdkComponent {
  id: string;
  componentId: string;
  module: string;
  role: string;
}

export interface RawProductProjection {
  id: string;
  name: string;
  description: string;
  componentId: string;
  metricId?: string;
  definition: ProductProjectionInput | BuiltinProductProjectionInput;
}

export type ProjectionBindingSource = {
  row: CurrentProductRow;
  projection: RawProductProjection;
};

function projectionBindingCandidates(target: PlatformOntologyNodeRef, values: unknown[]) {
  const { className, primaryKey } = target;
  const key = `$${values.push(primaryKey)}::text`;
  const type = `$${values.push(className)}::text`;
  const path = (expr: string) =>
    `jsonb_path_exists(definition, '${expr}', jsonb_build_object('key', ${key}, 'type', ${type}))`;
  const literal = path("$.data.*.source.object.literal ? (@.className == $type && @.primaryKey == $key)");
  const typeSource = (kind: string) => path(`$.data.*.source.type ? (@.kind == "${kind}" && @.id == $key)`);
  if (className === ONTOLOGY_TYPE || className === OBJECT_TYPE) {
    const platform = className === ONTOLOGY_TYPE;
    const isPlatformType = Object.hasOwn(platformObjectTypes, primaryKey);
    const candidates = [literal, typeSource(platform ? "PlatformObjectType" : "ObjectType")];
    if (!platform && !isPlatformType) {
      candidates.push(path("$.data.*.source.object.literal ? (@.className == $key)"));
    }
    if (platform || !isPlatformType) {
      const port = "definition->'inputs'->(binding.value#>>'{source,object,input}')";
      const portMatches = [`(${port}->>'kind' = 'object' AND ${port}->>'objectType' = ${key})`];
      if (platform) {
        const layer = `$${values.push(resolveNodeLayer(target))}::text`;
        portMatches.push(`(${port}->>'kind' = 'object-union' AND (
          ${port}->'objectTypes' @> jsonb_build_array(${key}) OR ${port}->'layers' @> jsonb_build_array(${layer})
        ))`);
        const operationIds = [...PLATFORM_OPERATION_OWNER_MAP].flatMap(([id, owner]) => owner === primaryKey ? [id] : []);
        if (operationIds.length) {
          const ops = `$${values.push(operationIds)}::text[]`;
          candidates.push(`EXISTS (
            SELECT 1 FROM jsonb_path_query(definition, '$.operations.*.operation ? (@.kind == "PlatformOperation")') AS op(value)
            WHERE op.value->>'id' = ANY(${ops})
          )`);
        }
      }
      candidates.push(`EXISTS (
        SELECT 1 FROM jsonb_path_query(definition, '$.data.*') AS binding(value)
        WHERE ${portMatches.join(" OR ")}
      )`);
    }
    return `(${candidates.join(" OR ")})`;
  }
  switch (className) {
    case RELATIONSHIP: return `(${literal} OR ${typeSource("Relationship")})`;
    case ACTION: return `(${literal} OR ${path('$.operations.*.operation ? (@.kind == "Action" && @.id == $key)')})`;
    case METRIC_VIEW: return `(${literal} OR definition->>'metricId' = ${key})`;
    default: return literal;
  }
}

export interface RawProductPanel {
  id: string;
  name: string;
  description: string;
  definition: ProductPanelInput | BuiltinProductPanelInput;
}

export interface RawApplication {
  id: string;
  name: string;
  kind: string;
}

export function ontologyApplicationName(app: { id: string; names: Record<string, string>; kind: string }, locale = "en"): RawApplication {
  const baseLocale = locale.includes("-") ? locale.split("-")[0] : undefined;
  return {
    id: app.id,
    name: app.names[locale] ?? (baseLocale ? app.names[baseLocale] : undefined) ??
      app.names.en ?? Object.values(app.names)[0] ?? app.id,
    kind: app.kind,
  };
}

export interface ResolvedRole {
  id: string;
  code?: string;
}

export interface ResolvedRoles {
  roles: ResolvedRole[];
  byId: Map<string, ResolvedRole>;
  byCode: Map<string, ResolvedRole>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asOrgGrantType(value: unknown) {
  const type = orgGrantTypeSchema.safeParse(asString(value));
  return type.success ? type.data : undefined;
}

const orgText = z.string().nullish().transform(asString);
export const orgUnitInstanceDirectorySchema = z.array(z.object({ id: orgText, name: orgText, code: orgText }))
  .transform(rows => rows.flatMap(({ id, name, code }) => id ? [{ id, name: name ?? id, ...(code && { code }) }] : []));
export const orgPositionInstanceDirectorySchema = z.array(z.object({ id: orgText, name: orgText, orgName: orgText }))
  .transform(rows => rows.flatMap(({ id, name, orgName }) => id ? [{ id, name: name ?? id, orgName }] : []));
export const orgGrantInstanceDirectorySchema = z.array(z.object({
  id: orgText, grantType: z.string().nullish().transform(asOrgGrantType), sourceId: orgText, sourceName: orgText,
})).transform(rows => rows.flatMap(({ id, grantType, sourceId, sourceName }) =>
  id && grantType && sourceId ? [{ id, grantType, sourceId, sourceName }] : []));

const roleDirectorySchema = z.array(z.object({
  roleId: z.string().nullish(),
  roleCode: z.string().nullish(),
}).transform(({ roleId, roleCode }) => ({ roleId: asString(roleId), roleCode: asString(roleCode) })));

type RoleDirectoryEntry = { roleId?: string | null; roleCode?: string | null };

/** Directory names take precedence; workflow step labels do not identify roles. */
function resolveOntologyRoles(
  accessRes: OwnerReadResult<RoleDirectoryEntry[]>, grantsRes: OwnerReadResult<RoleDirectoryEntry[]>,
): OwnerReadResult<ResolvedRoles> {
  const byId = new Map<string, ResolvedRole>();
  const byCode = new Map<string, ResolvedRole>();
  const add = (id?: string | null, code?: string | null) => {
    if (!id) return;
    const existing = byId.get(id);
    const resolvedCode = existing?.code ?? code ?? undefined;
    const entry: ResolvedRole = resolvedCode ? { id, code: resolvedCode } : { id };
    byId.set(id, entry);
    if (resolvedCode && !byCode.has(resolvedCode)) {
      byCode.set(resolvedCode, entry);
    }
  };

  if (accessRes.ok) {
    for (const role of accessRes.data) add(role.roleId, role.roleCode);
  }
  if (grantsRes.ok) {
    for (const grant of grantsRes.data) add(grant.roleId, grant.roleCode);
  }

  if (!accessRes.ok && byId.size === 0) {
    // If platform-access was refused or failed and nothing else yielded roles, surface its status.
    return accessRes;
  }

  const roles = [...byId.values()].sort(
    (a, b) => (a.code ?? a.id).localeCompare(b.code ?? b.id) || a.id.localeCompare(b.id),
  );
  return { ok: true, data: { roles, byId, byCode } };
}

export function readOntologyRoleNameFacts(
  directory: JavaPanelReadResult | undefined, grants: JavaPanelReadResult | undefined,
  directoryName: string, grantsName: string,
): OwnerReadResult<ResolvedRoles> {
  return resolveOntologyRoles(
    readOntologyOwnerFact(directory, roleDirectorySchema, directoryName),
    readOntologyOwnerFact(grants, roleDirectorySchema, grantsName),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
}

function parseMetricViews(rows: Record<string, unknown>[]): RawMetricView[] {
  return rows.flatMap((row) => {
    const id = asString(row.id);
    if (!id) return [];
    const fn = asRecord(row.function);
    return [{
      id,
      name: asString(row.name) ?? id,
      status: asString(row.status),
      functionId: asString(fn?.id),
      createdBy: asString(row.createdBy) ?? null,
      reviewedBy: asString(row.reviewedBy) ?? null,
    }];
  });
}

function parseFunctions(rows: Record<string, unknown>[]): RawFunction[] {
  return rows.flatMap((row) => {
    const id = asString(row.id);
    if (!id) return [];
    const referenced = new Set<string>();
    const returnDef = asRecord(row.returnDef);
    if (Array.isArray(returnDef?.classNames)) {
      for (const cls of returnDef.classNames) {
        const name = asString(cls);
        if (name) referenced.add(name);
      }
    }
    for (const param of asArray(row.parameters)) {
      if (Array.isArray(param.classNames)) {
        for (const cls of param.classNames) {
          const name = asString(cls);
          if (name) referenced.add(name);
        }
      }
    }
    return [{
      id,
      name: asString(row.name) ?? id,
      operation: asString(row.operation),
      classNames: [...referenced],
    }];
  });
}

function parseActions(rows: Record<string, unknown>[]): RawAction[] {
  return rows.flatMap((row) => {
    const id = asString(row.id);
    if (!id) return [];
    const fn = asRecord(row.function);
    const target = asRecord(row.target);
    return [{
      id,
      name: asString(row.name) ?? id,
      status: asString(row.status),
      functionId: asString(fn?.id),
      targetClassName: asString(target?.className),
      createdBy: asString(row.createdBy) ?? null,
      reviewedBy: asString(row.reviewedBy) ?? null,
    }];
  });
}

function parseKnowledgeEntries(entries: Record<string, unknown>[]): RawKnowledge[] {
  return entries.flatMap((item) => {
    const id = asString(item.knowledgeID) ?? asString(item.id);
    if (!id) return [];
    return [{
      id,
      title: asString(item.knowledgeTitle) ?? id,
      status: typeof item.status === "number" ? item.status : undefined,
    }];
  });
}

function parseWorkflows(rows: Record<string, unknown>[]): RawWorkflow[] {
  return rows.flatMap((row) => {
    const id = asString(row.id);
    if (!id) return [];
    const steps = asArray(row.steps).map((step) => ({
      actionId: asString(step.actionId),
      roleCode: asString(step.roleCode),
    }));
    return [{
      id,
      name: asString(row.name) ?? id,
      status: asString(row.status),
      version: typeof row.version === "number" ? row.version : undefined,
      steps,
      createdBy: asString(row.createdBy) ?? null,
      reviewedBy: asString(row.reviewedBy) ?? null,
    }];
  });
}

function parsePermissionPolicies(rows: Record<string, unknown>[]): RawPermissionPolicy[] {
  return rows.flatMap((row) => {
    const id = asString(row.id);
    if (!id) return [];
    return [{
      id,
      name: asString(row.name) ?? id,
      type: typeof row.type === "number" ? row.type : undefined,
      fullData: typeof row.fullData === "boolean" ? row.fullData : undefined,
      parentId: asString(row.parentId),
    }];
  });
}

function parseMemberIdentity(row: Record<string, unknown>): RawMemberIdentity | undefined {
  const id = asString(row.id);
  return id ? { id, loginCode: asString(row.loginCode), displayName: asString(row.displayName) } : undefined;
}

function parseGrant(row: Record<string, unknown>, inForce = row.inForce === true): RawGrant {
  const scope = asRecord(row.scope);
  const kind = asString(scope?.kind);
  return {
    roleId: asString(row.roleId) ?? null,
    roleCode: asString(row.roleCode) ?? null,
    capabilityKind: asString(row.capabilityKind) ?? null,
    capabilityId: asString(row.capabilityId) ?? null,
    workflowId: asString(row.workflowId) ?? null,
    stepNo: typeof row.stepNo === "number" ? row.stepNo : null,
    activatedByWorkflowVersion: asString(row.activatedByWorkflowVersion) ?? null,
    scope: kind ? { kind, className: asString(scope?.className), field: asString(scope?.field) } : null,
    inForce,
  };
}

const directoryRowsSchema = z.array(z.record(z.unknown()));
export const memberIdentityDirectorySchema = directoryRowsSchema.transform(rows => rows.flatMap(row => {
  const member = parseMemberIdentity(row);
  return member ? [member] : [];
}));
export const workflowDirectorySchema = directoryRowsSchema.transform(parseWorkflows);
export const workflowStepFactsSchema = z.object({
  links: directoryRowsSchema.transform(rows => rows.map(row => parseGrant(row, true))),
  workflows: workflowDirectorySchema,
});
export const permissionPolicyDirectorySchema = directoryRowsSchema.transform(parsePermissionPolicies);
export const metricViewDirectorySchema = directoryRowsSchema.transform(parseMetricViews);
export const functionDirectorySchema = directoryRowsSchema.transform(parseFunctions);
export const actionDirectorySchema = directoryRowsSchema.transform(parseActions);
export const knowledgeDirectorySchema = z.object({ entries: z.record(z.record(z.unknown())) })
  .transform(({ entries }) => parseKnowledgeEntries(Object.values(entries)));

export function parseOntologyMeta(data: Record<string, unknown>): RawOntologyMeta {
  const classes: RawClassMeta[] = asArray(data.classDef).flatMap((item) => {
    const className = asString(item.className);
    if (!className) return [];
    const attrs = asArray(item.attrs).flatMap((attr) => {
      const name = asString(attr.name);
      if (!name) return [];
      const enabled = attr.enable !== false && String(attr.enable ?? "").toLowerCase() !== "false";
      return [{ name, showName: asString(attr.showName), type: asString(attr.type), enable: enabled }];
    });
    return [{
      className,
      showName: asString(item.showName),
      classDesc: asString(item.classDesc),
      attrs,
    }];
  });

  const rawRelations = data.relationDef ?? data.relations ?? data.relationship_rule ?? [];
  const relationEntries: Record<string, unknown>[] = Array.isArray(rawRelations)
    ? asArray(rawRelations)
    : Object.entries(asRecord(rawRelations) ?? {}).flatMap(([key, value]) => {
        const rec = asRecord(value);
        return rec ? [{ ...rec, relationship: asString(rec.relationship) ?? key }] : [];
      });

  const relationships: RawRelationshipMeta[] = relationEntries.flatMap((item) => {
    const relationship = asString(item.relationship);
    if (!relationship) return [];
    return [{
      relationship,
      showName: asString(item.showName) ?? asString(item.relationShowName) ?? asString(item.relationshipShowName),
      desc: asString(item.desc),
      fromclass: asString(item.fromclass),
      toclass: asString(item.toclass),
    }];
  });

  return { classes, relationships };
}


/**
 * Classifies an owner read error into per-relation refusal or failure.
 * 401 always rethrows because the caller's credential itself is invalid for the whole request.
 */
export function classifyOwnerError(error: unknown): { status: OwnerFailureStatus; reason: string } {
  if (error instanceof AuthFailedError || (error instanceof HttpError && error.status === 401)) {
    throw error;
  }
  if (error instanceof BackendResponseError && error.status === 403) {
    return { status: "refused", reason: error.message };
  }
  if (error instanceof HttpError && error.status === 403) {
    return { status: "refused", reason: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: "failed", reason: message || "Owner read failed" };
}

/**
 * Per-request owner reader cache.
 *
 * Never retained across requests and never stores copies of owner data: it only coalesces
 * duplicate owner calls triggered by multiple relation kinds inside one composite query.
 */
export class PlatformOntologyOwnerReaders {
  private readonly cache = new Map<string, Promise<OwnerReadResult<unknown>>>();
  private readonly headers: Record<string, string>;
  private callCount = 0;

  constructor(
    readonly owner: ProductOwner,
    readonly credentials: AssistantCredentials,
  ) {
    this.headers = buildBackendHeaders(
      credentials.token,
      undefined,
      credentials.locale,
      credentials.apiKey,
      credentials.headers,
    );
  }

  get ownerCallCount(): number {
    return this.callCount;
  }

  private memo<T>(key: string, loader: () => Promise<T>): Promise<OwnerReadResult<T>> {
    const existing = this.cache.get(key);
    if (existing) return existing as Promise<OwnerReadResult<T>>;
    const promise = this.readOwner(loader);
    this.cache.set(key, promise);
    return promise;
  }

  private readOwner<T>(loader: () => Promise<T>): Promise<OwnerReadResult<T>> {
    this.callCount++;
    return loader().then(
      (data) => ({ ok: true as const, data }),
      (error) => {
        const classified = classifyOwnerError(error);
        return { ok: false as const, ...classified };
      },
    );
  }

  private parseDataEngineResponse(endpoint: string, text: string): unknown {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HttpError(502, `Owner returned invalid JSON for ${endpoint}`, "OWNER_INVALID_JSON");
    }
    const envelope = asRecord(parsed);
    if (envelope && envelope.success === false) {
      const code = envelope.code;
      const message = asString(envelope.message) || asString(envelope.error) || `Owner rejected ${endpoint}`;
      if (code === 401) throw new HttpError(401, message, "UNAUTHORIZED");
      if (code === 403) throw new HttpError(403, message, "PERMISSION_DENIED");
      throw new HttpError(502, message, "OWNER_READ_FAILED");
    }
    return envelope && "data" in envelope ? envelope.data : parsed;
  }

  private async postDataEngine(endpoint: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const response = await backendPost(
      `platform-ontology:${endpoint}`,
      `${config.dataQuery.baseUrl}${endpoint}`,
      body,
      { headers: this.headers, retries: 1, timeoutMs: 30_000 },
    );
    return this.parseDataEngineResponse(endpoint, response.text);
  }

  private async getDataEngine(endpoint: string): Promise<unknown> {
    const response = await backendGet(
      `platform-ontology:${endpoint}`,
      `${config.dataQuery.baseUrl}${endpoint}`,
      { headers: this.headers, retries: 1, timeoutMs: 30_000 },
    );
    return this.parseDataEngineResponse(endpoint, response.text);
  }

  private postCounts<T>(endpoint: string, schema: z.ZodType<T>): Promise<OwnerReadResult<T>> {
    return this.memo(`java:${endpoint}:count`, async () => schema.parse(
      await this.postDataEngine(endpoint, { countOnly: true }),
    ));
  }

  private countFromJava<T>(fact: OntologyReadFact, schema: z.ZodType<T>, legacy: () => Promise<OwnerReadResult<T>>) {
    return {
      fact,
      read: (results?: readonly JavaPanelReadResult[], index = 0) =>
        results ? Promise.resolve(readOntologyOwnerFact(results[index], schema, fact.call!.name)) : legacy(),
    };
  }

  private countFromPost<K extends string>(
    endpoint: string, schema: z.ZodType<Record<K, number>>, field: K, fact: OntologyReadFact,
  ): OntologyCountPlan {
    const read = this.countFromJava(fact, schema, () => this.postCounts(endpoint, schema));
    return { facts: [fact], read: async results => ownerCountField(await read.read(results), field) };
  }

  private countFromRange(
    kind: ObjectKind, verb: ObjectVerb, key: string,
    legacy: () => Promise<number>, count: (range: DefinitionVisibilityRange) => Promise<number>,
  ): OntologyCountPlan {
    return {
      facts: [{ visibleKinds: [{ kind, verbs: [verb] }] }],
      read: results => {
        if (!results) return this.memo(key, legacy);
        const range = readOntologyVisibilityFact(results[0], kind, verb);
        return range.ok ? this.memo(key, () => count(range.data)) : Promise.resolve(range);
      },
    };
  }

  private planRoleCount(): OntologyCountPlan {
    const directory = this.countFromJava(countCall(ONTOLOGY_TYPE, "roleDirectoryCount"), totalSchema,
      () => this.postCounts("/workflow/platform-access", totalSchema));
    const grants = this.countFromJava(countCall(ONTOLOGY_TYPE, "grantRoleCounts"), grantRoleCountsSchema,
      () => this.postCounts("/workflow/grants", grantRoleCountsSchema));
    return {
      facts: [directory.fact, grants.fact],
      async read(results) {
        const [listed, granted] = await Promise.all([directory.read(results), grants.read(results, 1)]);
        if (listed.ok) return { ok: true, data: listed.data.total + (granted.ok ? granted.data.outsideDirectory : 0) };
        if (granted.ok && granted.data.total > 0) return ownerCountField(granted, "total");
        return listed;
      },
    };
  }

  planCount(type: string): OntologyCountPlan {
    const total = (endpoint: string, fact = countCall(type)) => this.countFromPost(endpoint, totalSchema, "total", fact);
    switch (type) {
      case OBJECT_TYPE:
      case ATTRIBUTE:
      case RELATIONSHIP:
        return this.countFromPost("/admin/getMetas", metaCountsSchema, ({
          [OBJECT_TYPE]: "objectTypes", [ATTRIBUTE]: "attributes", [RELATIONSHIP]: "relationships",
        } as const)[type], countCall(ONTOLOGY_TYPE, "metadataCounts"));
      case ORG_UNIT:
      case ORG_POSITION:
      case ORG_GRANT:
        return this.countFromPost("/platform/governance/organization", organizationCountsSchema, ({
          [ORG_UNIT]: "units", [ORG_POSITION]: "positions", [ORG_GRANT]: "grants",
        } as const)[type], countCall(ONTOLOGY_TYPE, "organizationCounts"));
      case ACTION: return total("/action/queryList");
      case METRIC_VIEW: return total("/metricView/queryList");
      case FUNCTION: return total("/function/queryList");
      case TRIGGER: {
        const fact = countCall(TRIGGER);
        const source = this.countFromJava(fact, totalSchema, () => this.memo("java:triggers:count", async () =>
          ({ total: await triggerClient(this.credentials).count() })));
        return { facts: [fact], read: async results => ownerCountField(await source.read(results), "total") };
      }
      case WORKFLOW: return total("/workflow/query");
      case USER: return total("/workflow/subjects", countCall(ONTOLOGY_TYPE, "subjectsCount"));
      case PERMISSION_POLICY: return total("/platform/governance/policies", countCall(ONTOLOGY_TYPE, "policyCount"));
      case BUSINESS_KNOWLEDGE: return total("/admin/getBussinessKnowledge");
      case ROLE: return this.planRoleCount();
      case APPLICATION: {
        const fact = countCall(APPLICATION, "navigationCount");
        const source = this.countFromJava(fact, totalSchema, () => this.memo("java:/platform/applications:count", async () => totalSchema.parse(
          await this.getDataEngine("/platform/applications?purpose=navigation&countOnly=true"),
        )));
        return { facts: [fact], read: async results => ownerCountField(await source.read(results), "total") };
      }
      case DEFINITION:
        return { facts: [], read: () => this.memo("node:business-definitions:count", () => countPublishedDefinitions(this.owner)) };
      case AGENT_DEFINITION:
        return this.countFromRange("AGENT", "VIEW", "node:agent-definitions:count",
          () => countVisibleAgentDefinitions(this.owner, this.credentials),
          range => countVisibleAgentDefinitions(this.owner, this.credentials, range));
      case SKILL: {
        const read = this.planSkillLibraryAccess();
        return {
          facts: [read.fact],
          read: async results => {
            const access = await read.read(results);
            return access.ok ? this.memo("node:assistant-skills:count", () => countAssistantSkills(this.owner.domainId, this.credentials)) : access;
          },
        };
      }
      case SDK_COMPONENT:
        return { facts: [], read: () => this.memo("node:sdk-components:count", async () => (await readPanelComponentCatalogue()).components.size) };
      case PRODUCT_PANEL:
      case PRODUCT_PROJECTION: {
        const kind = type === PRODUCT_PANEL ? "panel" : "projection";
        const target = type === PRODUCT_PANEL ? "PANEL" : "PROJECTION";
        return this.countFromRange(target, "USE", `node:product-${kind}:count`,
          () => countUsableCurrentDefinitions(kind, this.owner.domainId, this.credentials),
          range => countCurrentDefinitionsInRange(kind, this.owner.domainId, range));
      }
      default:
        return { facts: [], read: async () => ({ ok: false, status: "unavailable", reason: `No owner adapter registered for ${type}` }) };
    }
  }

  count(type: string): Promise<OntologyCount> {
    return this.planCount(type).read();
  }

  ontologyMeta(): Promise<OwnerReadResult<RawOntologyMeta>> {
    return this.memo("java:/admin/getMetas", async () =>
      parseOntologyMeta(asRecord(await this.postDataEngine("/admin/getMetas", {})) ?? {}));
  }

  metricViews(): Promise<OwnerReadResult<RawMetricView[]>> {
    return this.memo("java:/metricView/queryList", async () =>
      parseMetricViews(asArray(await this.postDataEngine("/metricView/queryList", {}))));
  }

  functions(): Promise<OwnerReadResult<RawFunction[]>> {
    return this.memo("java:/function/queryList", async () =>
      parseFunctions(asArray(await this.postDataEngine("/function/queryList", {}))));
  }

  actions(): Promise<OwnerReadResult<RawAction[]>> {
    return this.memo("java:/action/queryList", async () =>
      parseActions(asArray(await this.postDataEngine("/action/queryList", {}))));
  }

  workflows(): Promise<OwnerReadResult<RawWorkflow[]>> {
    return this.memo("java:/workflow/query", async () =>
      parseWorkflows(asArray(await this.postDataEngine("/workflow/query", {}))));
  }

  triggers() {
    return this.memo("java:triggers", async () => (await triggerClient(this.credentials).list()).tasks);
  }

  knowledge(): Promise<OwnerReadResult<RawKnowledge[]>> {
    return this.memo("java:/admin/getBussinessKnowledge", async () => {
      const raw = await this.postDataEngine("/admin/getBussinessKnowledge", {});
      const entries = Array.isArray(raw)
        ? asArray(raw)
        : Object.values(asRecord(raw) ?? {}).filter((item): item is Record<string, unknown> => asRecord(item) !== null);
      return parseKnowledgeEntries(entries);
    });
  }

  subjects(): Promise<OwnerReadResult<RawSubject[]>> {
    return this.memo("java:/workflow/subjects", async () => {
      const rows = asArray(await this.postDataEngine("/workflow/subjects", {}));
      return rows.flatMap((row) => {
        const member = parseMemberIdentity(row);
        if (!member) return [];
        const roleIds = Array.isArray(row.roleIds)
          ? row.roleIds.flatMap((roleId) => {
              const parsed = asString(roleId);
              return parsed ? [parsed] : [];
            })
          : [];
        return [{ ...member, roleIds }];
      });
    });
  }

  grants(): Promise<OwnerReadResult<RawGrant[]>> {
    return this.memo("java:/workflow/grants", async () => {
      const rows = asArray(await this.postDataEngine("/workflow/grants", {}));
      return rows.map(row => parseGrant(row));
    });
  }

  authorizationGraphFacts(): Promise<OwnerReadResult<AuthorizationGraphFacts>> {
    return this.memo("java:/authorization/policies/graph-facts", () => readAuthorizationGraphFacts(this.credentials));
  }

  async policyCreateKinds() {
    const facts = await this.authorizationGraphFacts();
    return facts.ok ? { ok: true as const, data: facts.data.policyGrants.filter(grant => grant.verb === "CREATE") } : facts;
  }

  platformAccess(): Promise<OwnerReadResult<RawPlatformAccess[]>> {
    return this.memo("java:/workflow/platform-access", async () => {
      const rows = asArray(await this.postDataEngine("/workflow/platform-access", {}));
      return rows.map((row) => ({
        roleId: asString(row.roleId) ?? null,
        roleCode: asString(row.roleCode) ?? null,
        apiPermissions: Array.isArray(row.apiPermissions)
          ? row.apiPermissions.flatMap((p) => {
              const s = asString(p);
              return s ? [s] : [];
            })
          : [],
        managementRole: row.managementRole === true,
      }));
    });
  }

  organizationSnapshot(): Promise<OwnerReadResult<RawOrganizationSnapshot>> {
    return this.memo("java:/platform/governance/organization", async () => {
      const data = asRecord(await this.postDataEngine("/platform/governance/organization", {})) ?? {};
      const units: RawOrgUnit[] = asArray(data.units).flatMap((row) => {
        const id = asString(row.id);
        if (!id) return [];
        return [{
          id,
          name: asString(row.name) ?? id,
          code: asString(row.code),
          parentId: asString(row.parentId),
        }];
      });
      const positions: RawOrgPosition[] = asArray(data.positions).flatMap((row) => {
        const id = asString(row.id);
        const orgId = asString(row.orgId);
        if (!id || !orgId) return [];
        return [{
          id,
          name: asString(row.name) ?? id,
          orgId,
        }];
      });
      const memberships: RawOrgMembership[] = asArray(data.memberships).flatMap((row) => {
        const userId = asString(row.userId);
        const orgId = asString(row.orgId);
        return userId && orgId ? [{ userId, orgId }] : [];
      });
      const positionAssignments: RawOrgPositionAssignment[] = asArray(data.positionAssignments).flatMap((row) => {
        const userId = asString(row.userId);
        const positionId = asString(row.positionId);
        return userId && positionId ? [{ userId, positionId }] : [];
      });
      const grants: RawOrgGrant[] = asArray(data.grants).flatMap((row) => {
        const id = asString(row.id);
        const grantType = asOrgGrantType(row.grantType);
        const sourceId = asString(row.sourceId);
        if (!id || !sourceId || !grantType) {
          return [];
        }
        const roleIds = Array.isArray(row.roleIds)
          ? row.roleIds.flatMap((roleId) => {
              const parsed = asString(roleId);
              return parsed ? [parsed] : [];
            })
          : [];
        return [{ id, grantType, sourceId, roleIds }];
      });
      return { units, positions, memberships, positionAssignments, grants };
    });
  }

  permissionPolicies(): Promise<OwnerReadResult<RawPermissionPolicy[]>> {
    return this.memo("java:/platform/governance/policies", async () => {
      const data = asRecord(await this.postDataEngine("/platform/governance/policies", {})) ?? {};
      return parsePermissionPolicies(asArray(data.policies));
    });
  }

  rolePolicies(): Promise<OwnerReadResult<RawRolePolicy[]>> {
    return this.memo("java:/platform/governance/role-policies", async () => {
      const data = asRecord(await this.postDataEngine("/platform/governance/role-policies", {})) ?? {};
      return asArray(data.rolePolicies).flatMap((row) => {
        const roleId = asString(row.roleId);
        const policyId = asString(row.policyId);
        return roleId && policyId ? [{ roleId, policyId }] : [];
      });
    });
  }

  policyDataPermissions(): Promise<OwnerReadResult<RawPolicyDataPermission[]>> {
    return this.memo("java:/platform/governance/policy-data-permissions", async () => {
      const data = asRecord(await this.postDataEngine("/platform/governance/policy-data-permissions", {})) ?? {};
      return asArray(data.policyDataPermissions).flatMap((row) => {
        const policyId = asString(row.policyId);
        const className = asString(row.className);
        return policyId && className ? [{ policyId, className }] : [];
      });
    });
  }

  definitions(...selection: [scope?: PublishedDefinitionSelection]): Promise<OwnerReadResult<RawDefinition[]>> {
    return this.memo(`node:business-definitions:${JSON.stringify(selection)}`, async () => {
      const defs = await listPublishedDefinitions(this.owner, ...selection);
      return defs.map((def) => ({
        id: def.id,
        name: def.name || def.id,
        objectType: def.objectType,
      }));
    });
  }

  private planSkillLibraryAccess() {
    return this.countFromJava(countCall(SKILL), z.literal(true), () => this.memo("java:skill-library:read", async () => {
      await assertManagement(workbenchManagement.skillLibraryRead, this.owner, this.credentials);
      return true as const;
    }));
  }

  planSkillDirectory() {
    const access = this.planSkillLibraryAccess();
    return {
      facts: [access.fact],
      read: async (results?: readonly JavaPanelReadResult[]): Promise<OwnerReadResult<RawSkill[]>> => {
        const admitted = await access.read(results);
        if (!admitted.ok) return admitted;
        return this.memo("node:assistant-skills", async () => {
          const catalog = await assistantSkillCatalog(this.owner.domainId, this.credentials);
          return catalog.skills.map(item => ({
            primaryKey: runtimeSkillKey(item.skill),
            title: item.title || item.skill.name,
            description: item.description,
          }));
        });
      },
    };
  }

  agentDefinitions(range?: DefinitionVisibilityRange, ids?: readonly string[]) {
    return this.memo(`node:agent-definitions:${JSON.stringify([range, ids])}`, () =>
      listAgentDefinitionNodes(this.owner, this.credentials, range, ids));
  }

  agentSkillRelations(agentId?: string) {
    return this.memo(`node:agent-skill-relations:${agentId ?? ""}`, () => listAgentSkillRelations(this.owner, this.credentials, agentId));
  }

  agentExecutionUserRelations(agentId?: string, scope?: Parameters<typeof listAgentExecutionUserRelations>[3]) {
    return this.memo(`node:agent-execution-user-relations:${JSON.stringify([agentId, scope])}`, () =>
      listAgentExecutionUserRelations(this.owner, this.credentials, agentId, scope));
  }

  /**
   * Resolves roles across platform-access (authoritative directory) and grants with a valid roleId.
   * Workflow step roleCode text is not a platform:Role reference and never synthesizes role nodes.
   * If platform-access fails or is refused and no readable source provides roles, reports its status.
   */
  async roles(): Promise<OwnerReadResult<ResolvedRoles>> {
    const [accessRes, grantsRes] = await Promise.all([
      this.platformAccess(),
      this.grants(),
    ]);

    return resolveOntologyRoles(accessRes, grantsRes);
  }

  planRoleDirectory() {
    const directory = { type: ROLE, name: "instanceDirectory", parameters: {} };
    const grantRoles = { type: ROLE, name: "instanceGrantRoles", parameters: {} };
    const facts = [{ call: directory }, { call: grantRoles }];
    return {
      facts,
      read: async (results?: readonly JavaPanelReadResult[]): Promise<OwnerReadResult<ResolvedRoles>> => {
        if (!results) return this.roles();
        const missing = facts.find((_, index) => !results[index] || results[index].status === "empty");
        if (missing) return { ok: false, status: "failed", reason: `Missing ontology fact: ${missing.call.name}` };
        return readOntologyRoleNameFacts(results[0], results[1], directory.name, grantRoles.name);
      },
    };
  }

  sdkComponents(ids?: readonly string[]): Promise<OwnerReadResult<RawSdkComponent[]>> {
    return this.memo(`node:sdk-components:${JSON.stringify(ids)}`, async () => {
      const { components } = await readPanelComponentCatalogue();
      const entries = ids ? ids.flatMap(id => {
        const component = components.get(id);
        return component ? [[id, component] as const] : [];
      }) : [...components.entries()];
      return entries.map(([id, component]) => ({
        id,
        componentId: component.componentId,
        module: component.module,
        role: component.role,
      }));
    });
  }

  grantedUseIds(): Promise<OwnerReadResult<ReadonlySet<string>>> {
    return this.memo("node:product-definition-use", async () => {
      const usable = await Promise.all((["panel", "projection"] as const)
        .map(kind => usableCurrentDefinitionIds(kind, this.owner.domainId, this.credentials)));
      return new Set(usable.flat());
    });
  }

  projectionBindingSource(id: string): Promise<OwnerReadResult<ProjectionBindingSource | undefined>> {
    return this.readOwner(async () => {
      const row = await findCurrentProduct(this.owner.domainId, "projection", id);
      if (!row) return undefined;
      const projection = this.parseProductProjection(row);
      return projection && { row, projection };
    });
  }

  async productProjections(
    range?: DefinitionVisibilityRange,
    selection?: { ids?: readonly string[]; componentId?: string; bindingTarget?: PlatformOntologyNodeRef },
  ): Promise<OwnerReadResult<RawProductProjection[]>> {
    const domainId = this.owner.domainId;
    if (range) {
      const { source, values } = currentProductVisibility("projection", domainId, range);
      const componentId = selection?.componentId;
      const where = selection?.bindingTarget ? projectionBindingCandidates(selection.bindingTarget, values)
        : componentId === undefined ? "TRUE" : `definition->>'componentId'=$${values.push(componentId)}`;
      return this.projectionDefinitions(source, where, values, selection?.ids);
    }
    const grantRes = await this.grantedUseIds();
    if (!grantRes.ok) return grantRes;
    return this.projectionDefinitions(currentProductRows("projection"), "(domain_id IS NULL OR domain_id=$1)", [domainId], [...grantRes.data]);
  }

  private projectionDefinitions(source: string, where: string, values: readonly unknown[], ids?: readonly string[]) {
    return this.memo(`node:product-projections:${JSON.stringify([source, where, values, ids])}`, async () => {
      const { rows } = await this.productDefinitionRows<{ id: string; definition: unknown }>("id, definition", source, where, values, ids);
      return rows.flatMap(row => this.parseProductProjection(row) ?? []);
    });
  }

  private parseProductProjection(row: { id: string; definition: unknown }): RawProductProjection | undefined {
    const parsed = (isBuiltinProductId(row.id) ? builtinProductProjectionInputSchema : productProjectionInputSchema).safeParse(row.definition);
    if (!parsed.success) {
      logger.warn("skipping invalid product projection definition in platform ontology query", {
        domainId: this.owner.domainId,
        projectionId: row.id,
      });
      return;
    }
    const def = parsed.data;
    return {
      id: row.id,
      name: def.name || row.id,
      description: def.description,
      componentId: def.componentId,
      metricId: "metricId" in def ? def.metricId : undefined,
      definition: def,
    };
  }

  async productPanels(scope?: { ids?: readonly string[]; range: DefinitionVisibilityRange }): Promise<OwnerReadResult<RawProductPanel[]>> {
    const domainId = this.owner.domainId;
    if (scope) {
      const { source, values } = currentProductVisibility("panel", domainId, scope.range);
      return this.panelDefinitions(source, "TRUE", values, scope.ids);
    }
    const grantRes = await this.grantedUseIds();
    if (!grantRes.ok) return grantRes;
    return this.panelDefinitions(currentProductRows("panel"), "(domain_id IS NULL OR domain_id=$1)", [domainId], [...grantRes.data]);
  }

  productDefinitionIdsInRange(kind: CurrentProductKind, range: DefinitionVisibilityRange, ids: readonly string[]) {
    const { source, values } = currentProductVisibility(kind, this.owner.domainId, range);
    return this.readOwner(async () => {
      const { rows } = await this.productDefinitionRows<{ id: string }>("id", source, "TRUE", values, ids);
      return new Set(rows.map(row => row.id));
    });
  }

  private productDefinitionRows<T extends { id: string }>(
    columns: "id" | "id, definition", source: string, where: string, values: readonly unknown[], ids?: readonly string[],
  ) {
    const selectedIds = ids === undefined ? "" : ` AND id=ANY($${values.length + 1}::text[])`;
    return getPostgresPool().query<T>(
      `SELECT ${columns} FROM ${source} AS definitions WHERE ${where}${selectedIds} ORDER BY id`,
      ids === undefined ? [...values] : [...values, ids],
    );
  }

  private panelDefinitions(source: string, where: string, values: readonly unknown[], ids?: readonly string[]) {
    return this.memo(`node:product-panels:${JSON.stringify([source, where, values, ids])}`, async () => {
      const { rows } = await this.productDefinitionRows<{ id: string; definition: unknown }>("id, definition", source, where, values, ids);
      const panels: RawProductPanel[] = [];
      for (const row of rows) {
        const parsed = (isBuiltinProductId(row.id) ? builtinProductPanelInputSchema : productPanelInputSchema).safeParse(row.definition);
        if (!parsed.success) {
          logger.warn("skipping invalid product panel definition in platform ontology query", {
            domainId: this.owner.domainId,
            panelId: row.id,
          });
          continue;
        }
        panels.push({
          id: row.id,
          name: parsed.data.name || row.id,
          description: parsed.data.description,
          definition: parsed.data,
        });
      }
      return panels;
    });
  }

  objectDetailPanelMappings(): Promise<OwnerReadResult<ReadonlyMap<string, string>>> {
    return this.memo("node:object-detail-panels", async () => {
      const mappings = await listObjectDetailPanelMappings(this.owner.domainId, getPostgresPool());
      return new Map(mappings.map(({ className, panelId }) => [className, panelId]));
    });
  }

  applications(): Promise<OwnerReadResult<RawApplication[]>> {
    return this.memo("java:/platform/applications", async () => {
      const raw = await this.getDataEngine("/platform/applications?purpose=navigation");
      const apps = applicationCatalogSchema.parse(raw);
      return apps.map(app => ontologyApplicationName(app, this.credentials.locale));
    });
  }

  /**
   * The panels each visible application's entries open, read one application at a time.
   *
   * The navigation list strips `panelUses` before it is returned, so an entry read is the only place
   * the assembly between an application and its panels can be seen.
   */
  applicationPanelUses(): Promise<OwnerReadResult<ReadonlyMap<string, string[]>>> {
    return this.memo("node:application-entries", async () => {
      const apps = await this.applications();
      if (!apps.ok) throw new HttpError(apps.status === "refused" ? 403 : 502, apps.reason, "OWNER_READ_FAILED");
      const uses = new Map<string, string[]>();
      await Promise.all(apps.data.map(async (app) => {
        const raw = asRecord(await this.getDataEngine(`/platform/applications/${encodeURIComponent(app.id)}`));
        const panelIds = asArray(raw?.panelUses).flatMap((use) => {
          const panelId = asString(use.panelId);
          return panelId ? [panelId] : [];
        });
        uses.set(app.id, [...new Set(panelIds)]);
      }));
      return uses;
    });
  }

  /**
   * Aligns OSS provenance user IDs (`admin` in Java AnonymousIdentityService -> `system` via hostOwner)
   * while leaving Enterprise subject IDs untouched.
   */
  async normalizeSubjectId(rawId: string, knownDirectory?: readonly RawMemberIdentity[]): Promise<string> {
    return normalizeOntologySubjectId(rawId, this.owner.userId, async () => {
      const directory = knownDirectory ?? await this.subjects().then(result => result.ok ? result.data : undefined);
      return directory?.length === 0;
    });
  }
}
