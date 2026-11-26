import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
import { z } from "zod";
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
import { currentProductRows } from "../../infrastructure/product-current";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { AuthFailedError, BackendResponseError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { readAuthorizationGraphFacts, type AuthorizationGraphFacts } from "../governance/policy-access";
import { HttpError } from "../../utils/errors";
import { countVisibleAgentDefinitions, listAgentDefinitions } from "../assistant/definitions";
import { assistantSkillCatalog, countAssistantSkills } from "../assistant/skills";
import { countPublishedDefinitions, listPublishedDefinitions } from "../business-definitions/definitions";
import type { ProductOwner } from "../product-governance/grants";
import { countUsableCurrentDefinitions, usableCurrentDefinitionIds } from "../product-panels/access";
import { readPanelComponentCatalogue } from "../product-panels/component-catalogue";
import { listObjectDetailPanelMappings } from "../product-panels/object-detail";
import { triggerClient } from "../scheduling/trigger-client";

import {
  ACTION, AGENT_DEFINITION, APPLICATION, ATTRIBUTE, BUSINESS_KNOWLEDGE, DEFINITION, FUNCTION, METRIC_VIEW,
  OBJECT_TYPE, ORG_GRANT, ORG_POSITION, ORG_UNIT, PERMISSION_POLICY, PRODUCT_PANEL, PRODUCT_PROJECTION,
  RELATIONSHIP, ROLE, SDK_COMPONENT, SKILL, TRIGGER, USER, WORKFLOW,
} from "./schema";

const logger = createLogger("platform-ontology-owners");
const countSchema = z.number().int().nonnegative();
const totalSchema = z.object({ total: countSchema });
const metaCountsSchema = z.object({ objectTypes: countSchema, attributes: countSchema, relationships: countSchema });
const organizationCountsSchema = z.object({ units: countSchema, positions: countSchema, grants: countSchema });
const grantRoleCountsSchema = totalSchema.extend({ outsideDirectory: countSchema });

function ownerCountField<K extends string>(result: OwnerReadResult<Record<K, number>>, field: K): OwnerReadResult<number> {
  return result.ok ? { ok: true, data: result.data[field] } : result;
}

export type OwnerFailureStatus = "refused" | "failed";

export type OwnerReadResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: OwnerFailureStatus; reason: string };

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

export interface RawSubject {
  id: string;
  loginCode?: string;
  displayName?: string;
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
  grantType: "organization" | "subtree" | "position";
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

export interface RawAgentDefinition {
  id: string;
  name: string;
  enabled: boolean;
  skills: RuntimeSkillRef[];
  executionUserId: string | null;
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
    this.callCount++;
    const promise: Promise<OwnerReadResult<T>> = loader().then(
      (data) => ({ ok: true as const, data }),
      (error) => {
        const classified = classifyOwnerError(error);
        return { ok: false as const, ...classified };
      },
    );
    this.cache.set(key, promise);
    return promise;
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

  private async postTotal(endpoint: string): Promise<OwnerReadResult<number>> {
    return ownerCountField(await this.postCounts(endpoint, totalSchema), "total");
  }

  private async countRoles(): Promise<OwnerReadResult<number>> {
    const [directory, grants] = await Promise.all([
      this.postTotal("/workflow/platform-access"),
      this.postCounts("/workflow/grants", grantRoleCountsSchema),
    ]);
    if (directory.ok) return { ok: true, data: directory.data + (grants.ok ? grants.data.outsideDirectory : 0) };
    if (grants.ok && grants.data.total > 0) return ownerCountField(grants, "total");
    return directory;
  }

  count(type: string): Promise<OwnerReadResult<number> | { ok: false; status: "unavailable"; reason: string }> {
    switch (type) {
      case OBJECT_TYPE:
      case ATTRIBUTE:
      case RELATIONSHIP:
        return this.postCounts("/admin/getMetas", metaCountsSchema).then(result => ownerCountField(result, ({
          [OBJECT_TYPE]: "objectTypes", [ATTRIBUTE]: "attributes", [RELATIONSHIP]: "relationships",
        } as const)[type]));
      case ORG_UNIT:
      case ORG_POSITION:
      case ORG_GRANT:
        return this.postCounts("/platform/governance/organization", organizationCountsSchema).then(result => ownerCountField(result, ({
          [ORG_UNIT]: "units", [ORG_POSITION]: "positions", [ORG_GRANT]: "grants",
        } as const)[type]));
      case ACTION: return this.postTotal("/action/queryList");
      case METRIC_VIEW: return this.postTotal("/metricView/queryList");
      case FUNCTION: return this.postTotal("/function/queryList");
      case TRIGGER: return this.memo("java:triggers:count", () => triggerClient(this.credentials).count());
      case WORKFLOW: return this.postTotal("/workflow/query");
      case USER: return this.postTotal("/workflow/subjects");
      case PERMISSION_POLICY: return this.postTotal("/platform/governance/policies");
      case BUSINESS_KNOWLEDGE: return this.postTotal("/admin/getBussinessKnowledge");
      case ROLE: return this.countRoles();
      case APPLICATION:
        return this.memo("java:/platform/applications:count", async () => totalSchema.parse(
          await this.getDataEngine("/platform/applications?purpose=navigation&countOnly=true"),
        ).total);
      case DEFINITION:
        return this.memo("node:business-definitions:count", () => countPublishedDefinitions(this.owner));
      case AGENT_DEFINITION:
        return this.memo("node:agent-definitions:count", () => countVisibleAgentDefinitions(this.owner, this.credentials));
      case SKILL:
        return this.memo("node:assistant-skills:count", async () => {
          await assertManagement(workbenchManagement.skillLibraryRead, this.owner, this.credentials);
          return countAssistantSkills(this.owner.domainId, this.credentials);
        });
      case SDK_COMPONENT:
        return this.memo("node:sdk-components:count", async () => (await readPanelComponentCatalogue()).components.size);
      case PRODUCT_PANEL:
      case PRODUCT_PROJECTION: {
        const kind = type === PRODUCT_PANEL ? "panel" : "projection";
        return this.memo(`node:product-${kind}:count`, () => countUsableCurrentDefinitions(kind, this.owner.domainId, this.credentials));
      }
      default:
        return Promise.resolve({ ok: false, status: "unavailable", reason: `No owner adapter registered for ${type}` });
    }
  }

  ontologyMeta(): Promise<OwnerReadResult<RawOntologyMeta>> {
    return this.memo("java:/admin/getMetas", async () => {
      const data = asRecord(await this.postDataEngine("/admin/getMetas", {})) ?? {};
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
    });
  }

  metricViews(): Promise<OwnerReadResult<RawMetricView[]>> {
    return this.memo("java:/metricView/queryList", async () => {
      const rows = asArray(await this.postDataEngine("/metricView/queryList", {}));
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
    });
  }

  functions(): Promise<OwnerReadResult<RawFunction[]>> {
    return this.memo("java:/function/queryList", async () => {
      const rows = asArray(await this.postDataEngine("/function/queryList", {}));
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
    });
  }

  actions(): Promise<OwnerReadResult<RawAction[]>> {
    return this.memo("java:/action/queryList", async () => {
      const rows = asArray(await this.postDataEngine("/action/queryList", {}));
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
    });
  }

  workflows(): Promise<OwnerReadResult<RawWorkflow[]>> {
    return this.memo("java:/workflow/query", async () => {
      const rows = asArray(await this.postDataEngine("/workflow/query", {}));
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
    });
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
      return entries.flatMap((item) => {
        const id = asString(item.knowledgeID) ?? asString(item.id);
        if (!id) return [];
        return [{
          id,
          title: asString(item.knowledgeTitle) ?? id,
          status: typeof item.status === "number" ? item.status : undefined,
        }];
      });
    });
  }

  subjects(): Promise<OwnerReadResult<RawSubject[]>> {
    return this.memo("java:/workflow/subjects", async () => {
      const rows = asArray(await this.postDataEngine("/workflow/subjects", {}));
      return rows.flatMap((row) => {
        const id = asString(row.id);
        if (!id) return [];
        const roleIds = Array.isArray(row.roleIds)
          ? row.roleIds.flatMap((roleId) => {
              const parsed = asString(roleId);
              return parsed ? [parsed] : [];
            })
          : [];
        return [{
          id,
          loginCode: asString(row.loginCode),
          displayName: asString(row.displayName),
          roleIds,
        }];
      });
    });
  }

  grants(): Promise<OwnerReadResult<RawGrant[]>> {
    return this.memo("java:/workflow/grants", async () => {
      const rows = asArray(await this.postDataEngine("/workflow/grants", {}));
      return rows.map((row) => {
        const scope = asRecord(row.scope);
        return {
          roleId: asString(row.roleId) ?? null,
          roleCode: asString(row.roleCode) ?? null,
          capabilityKind: asString(row.capabilityKind) ?? null,
          capabilityId: asString(row.capabilityId) ?? null,
          workflowId: asString(row.workflowId) ?? null,
          stepNo: typeof row.stepNo === "number" ? row.stepNo : null,
          activatedByWorkflowVersion: asString(row.activatedByWorkflowVersion) ?? null,
          scope: scope && asString(scope.kind)
            ? { kind: asString(scope.kind)!, className: asString(scope.className), field: asString(scope.field) }
            : null,
          inForce: row.inForce === true,
        };
      });
    });
  }

  authorizationGraphFacts(): Promise<OwnerReadResult<AuthorizationGraphFacts>> {
    return this.memo("java:/authorization/policies/graph-facts", () => readAuthorizationGraphFacts(this.credentials));
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
        const grantType = asString(row.grantType);
        const sourceId = asString(row.sourceId);
        if (!id || !sourceId || (grantType !== "organization" && grantType !== "subtree" && grantType !== "position")) {
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
      return asArray(data.policies).flatMap((row) => {
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

  definitions(): Promise<OwnerReadResult<RawDefinition[]>> {
    return this.memo("node:business-definitions", async () => {
      const defs = await listPublishedDefinitions(this.owner);
      return defs.map((def) => ({
        id: def.id,
        name: def.name || def.id,
        objectType: def.objectType,
      }));
    });
  }

  async skills(): Promise<OwnerReadResult<RawSkill[]>> {
    return this.memo("node:assistant-skills", async () => {
      await assertManagement(workbenchManagement.skillLibraryRead, this.owner, this.credentials);
      const catalog = await assistantSkillCatalog(this.owner.domainId, this.credentials);
      return catalog.skills.map((item) => ({
        primaryKey: runtimeSkillKey(item.skill),
        title: item.title || item.skill.name,
        description: item.description,
      }));
    });
  }

  async agentDefinitions(): Promise<OwnerReadResult<RawAgentDefinition[]>> {
    return this.memo("node:agent-definitions", async () => {
      const { agents } = await listAgentDefinitions(this.owner, this.credentials);
      return agents.map((agent) => ({
        id: agent.id,
        name: agent.name || agent.id,
        enabled: agent.enabled,
        skills: agent.skills,
        executionUserId: agent.executionUserId,
      }));
    });
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
      for (const access of accessRes.data) add(access.roleId, access.roleCode);
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

  sdkComponents(): Promise<OwnerReadResult<RawSdkComponent[]>> {
    return this.memo("node:sdk-components", async () => {
      const { components } = await readPanelComponentCatalogue();
      return [...components.entries()].map(([id, component]) => ({
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

  async productProjections(): Promise<OwnerReadResult<RawProductProjection[]>> {
    const grantRes = await this.grantedUseIds();
    if (!grantRes.ok) return grantRes;
    return this.memo("node:product-projections", async () => {
      const ids = [...grantRes.data];
      const { rows } = await getPostgresPool().query<{ id: string; definition: unknown }>(
        `SELECT id, definition FROM ${currentProductRows("projection")} AS definitions
         WHERE (domain_id IS NULL OR domain_id=$1) AND id=ANY($2::text[]) ORDER BY id`,
        [this.owner.domainId, ids],
      );
      const projections: RawProductProjection[] = [];
      for (const row of rows) {
        const parsed = (isBuiltinProductId(row.id) ? builtinProductProjectionInputSchema : productProjectionInputSchema).safeParse(row.definition);
        if (!parsed.success) {
          logger.warn("skipping invalid product projection definition in platform ontology query", {
            domainId: this.owner.domainId,
            projectionId: row.id,
          });
          continue;
        }
        const def = parsed.data;
        projections.push({
          id: row.id,
          name: def.name || row.id,
          description: def.description,
          componentId: def.componentId,
          metricId: "metricId" in def ? def.metricId : undefined,
          definition: def,
        });
      }
      return projections;
    });
  }

  async productPanels(): Promise<OwnerReadResult<RawProductPanel[]>> {
    const grantRes = await this.grantedUseIds();
    if (!grantRes.ok) return grantRes;
    return this.memo("node:product-panels", async () => {
      const ids = [...grantRes.data];
      const { rows } = await getPostgresPool().query<{ id: string; definition: unknown }>(
        `SELECT id, definition FROM ${currentProductRows("panel")} AS definitions
         WHERE (domain_id IS NULL OR domain_id=$1) AND id=ANY($2::text[]) ORDER BY id`,
        [this.owner.domainId, ids],
      );
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
      const locale = this.credentials.locale ?? "en";
      const baseLocale = locale.includes("-") ? locale.split("-")[0] : undefined;
      return apps.map((app) => ({
        id: app.id,
        name:
          app.names[locale] ??
          (baseLocale ? app.names[baseLocale] : undefined) ??
          app.names.en ??
          Object.values(app.names)[0] ??
          app.id,
        kind: app.kind,
      }));
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
  async normalizeSubjectId(rawId: string): Promise<string> {
    if (this.owner.userId !== "system" || rawId !== "admin") return rawId;
    const subjectsRes = await this.subjects();
    if (subjectsRes.ok && subjectsRes.data.length === 0) return "system";
    return rawId;
  }
}
