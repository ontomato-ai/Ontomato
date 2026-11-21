import { runtimeSkillKey, type RuntimeSkillRef } from "@ontomato/contracts/agent-runtime-skills";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
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
import { assertPermission } from "../../identity/installed";
import { getPostgresPool } from "../../infrastructure/postgres";
import { currentProductRows } from "../../infrastructure/product-current";
import { isBuiltinProductId } from "@ontomato/contracts/product-record-id";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { AuthFailedError, BackendResponseError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { listAgentDefinitions } from "../assistant/definitions";
import { assistantSkillCatalog } from "../assistant/skills";
import { listPublishedDefinitions } from "../business-definitions/definitions";
import { grantedProductIds, type ProductOwner } from "../product-governance/grants";
import { readPanelComponentCatalogue } from "../product-panels/component-catalogue";
import { listObjectDetailPanelMappings } from "../product-panels/object-detail";

const logger = createLogger("platform-ontology-owners");

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

export interface RawTrigger {
  id: string;
  name: string;
  effectKind?: string | null;
  workflowId?: string;
  actionId?: string;
  enabled?: boolean;
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

export interface RawGrant {
  roleId?: string | null;
  roleCode?: string | null;
  capabilityKind?: string | null;
  capabilityId?: string | null;
  inForce: boolean;
}

export interface RawPlatformAccess {
  roleId?: string | null;
  roleCode?: string | null;
  apiPermissions: string[];
  managementRole: boolean;
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
  panelIds: string[];
}

export interface ResolvedRole {
  code: string;
  id?: string;
}

export interface ResolvedRoles {
  roles: ResolvedRole[];
  byCode: Map<string, ResolvedRole>;
  codeById: Map<string, string>;
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

  private analysisAgentPermission(): Promise<OwnerReadResult<true>> {
    return this.memo("perm:analysis-agent", async () => {
      await assertPermission(
        { token: this.credentials.token, apiKey: this.credentials.apiKey },
        ["analysis-agent"],
      );
      return true as const;
    });
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

  triggers(): Promise<OwnerReadResult<RawTrigger[]>> {
    return this.memo("java:/trigger/queryList", async () => {
      const rows = asArray(await this.postDataEngine("/trigger/queryList", {}));
      return rows.flatMap((row) => {
        const id = asString(row.id);
        if (!id) return [];
        const effect = asRecord(row.effect);
        return [{
          id,
          name: asString(row.name) ?? id,
          effectKind: asString(row.effectKind) ?? null,
          workflowId: asString(effect?.workflowId),
          actionId: asString(effect?.actionId),
          enabled: row.enabled === true,
        }];
      });
    });
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
      return rows.map((row) => ({
        roleId: asString(row.roleId) ?? null,
        roleCode: asString(row.roleCode) ?? null,
        capabilityKind: asString(row.capabilityKind) ?? null,
        capabilityId: asString(row.capabilityId) ?? null,
        inForce: row.inForce === true,
      }));
    });
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
    const perm = await this.analysisAgentPermission();
    if (!perm.ok) return perm;
    return this.memo("node:assistant-skills", async () => {
      const catalog = await assistantSkillCatalog(this.owner.domainId, this.credentials);
      return catalog.skills.map((item) => ({
        primaryKey: runtimeSkillKey(item.skill),
        title: item.title || item.skill.name,
        description: item.description,
      }));
    });
  }

  async agentDefinitions(): Promise<OwnerReadResult<RawAgentDefinition[]>> {
    const perm = await this.analysisAgentPermission();
    if (!perm.ok) return perm;
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
   * Resolves roles across platform-access (authoritative directory), grants, and workflow steps.
   * If platform-access is refused and no readable source provides roles, reports refusal.
   */
  async roles(): Promise<OwnerReadResult<ResolvedRoles>> {
    const [accessRes, grantsRes, workflowsRes] = await Promise.all([
      this.platformAccess(),
      this.grants(),
      this.workflows(),
    ]);

    const byCode = new Map<string, ResolvedRole>();
    const codeById = new Map<string, string>();
    const add = (id?: string | null, code?: string | null) => {
      if (!code) return;
      const existing = byCode.get(code);
      const resolvedId = id ?? existing?.id;
      byCode.set(code, { code, id: resolvedId });
      if (resolvedId) codeById.set(resolvedId, code);
    };

    if (accessRes.ok) {
      for (const access of accessRes.data) add(access.roleId, access.roleCode);
    }
    if (grantsRes.ok) {
      for (const grant of grantsRes.data) add(grant.roleId, grant.roleCode);
    }
    if (workflowsRes.ok) {
      for (const workflow of workflowsRes.data) {
        for (const step of workflow.steps) add(null, step.roleCode);
      }
    }

    if (!accessRes.ok && byCode.size === 0) {
      // If platform-access was refused or failed and nothing else yielded roles, surface its status.
      return accessRes;
    }

    const roles = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
    return { ok: true, data: { roles, byCode, codeById } };
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
    return this.memo("java:/product-governance/resources:use", async () => {
      const ids = await grantedProductIds("use", this.credentials);
      return new Set(ids);
    });
  }

  async productProjections(): Promise<OwnerReadResult<RawProductProjection[]>> {
    const grantRes = await this.grantedUseIds();
    if (!grantRes.ok) return grantRes;
    return this.memo("node:product-projections", async () => {
      const ids = [...grantRes.data];
      const { rows } = await getPostgresPool().query<{ id: string; definition: unknown }>(
        `SELECT id, definition FROM ${currentProductRows("projection")} AS definitions
         WHERE domain_id IS NULL OR (domain_id = $1 AND id = ANY($2::text[])) ORDER BY id`,
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
         WHERE domain_id IS NULL OR (domain_id = $1 AND id = ANY($2::text[])) ORDER BY id`,
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
        panelIds: [...new Set((app.panelUses ?? []).map((use) => use.panelId))],
      }));
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
