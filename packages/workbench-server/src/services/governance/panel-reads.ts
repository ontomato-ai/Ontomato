import { z } from "zod";
import {
  panelFormDescriptionSchema,
  panelOptionListSchema,
  panelReadParameterSchemas,
  panelRecordListSchema,
  panelRecordQuerySchema,
  panelRecordSchema,
  type PanelFormDescription,
  type PanelFormValues,
  type PanelOptionList,
  type PanelRecord,
  type PanelRecordQuery,
} from "@ontomato/contracts/panel-projection";
import type { RuntimeJsonObject } from "@ontomato/contracts/agent-runtime-values";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { ownerEnvelopeSchema, ownerWriteFailure } from "../product-panels/data-query-operations";
import type { OwnerReadResult } from "../platform-ontology/owners";
import { listPolicyEntries, policyObjectEntryUsagePayload, readPolicyChangePermission } from "./policy-access";
import type { PolicyWorkbenchCatalog } from "./policy-catalog";

/*
 * Direct-panel read adapters for enterprise governance owners: users, roles, permission policies, and organization
 * structure (units, memberships, positions, and grants). Each read posts to the data-engine governance owner with the
 * viewer's credentials and locale, preserving coded owner refusals and validating every response against the shared
 * panel contract schemas.
 */

export interface GovernanceFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

const pagedSearchParamsSchema = z.object({
  search: panelReadParameterSchemas.keyword.optional(),
  page: panelReadParameterSchemas.page.optional(),
}).strict();

function governanceReadStatus(code: string): number {
  if (code === "FORBIDDEN" || code.endsWith("_FORBIDDEN") || code.endsWith("_ADMIN_ONLY")) return 403;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_INVALID_KEY") || code.endsWith("_INVALID_TARGET") || code.endsWith("_INVALID_FORM")) return 400;
  return 409;
}

function governanceOwner(viewer: AssistantCredentials) {
  const options = { headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers) };
  const base = config.dataQuery.baseUrl.replace(/\/$/, "");
  return async function owner<T>(name: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await backendPost(name, base + path, body, options);
    const envelope = ownerEnvelopeSchema.parse(JSON.parse(response.text));
    if (!envelope.success) {
      const outcome = ownerWriteFailure(envelope, "GOVERNANCE_READ_FAILED", "The governance owner could not complete the read");
      throw new HttpError(
        outcome.kind === "failure" ? 500 : governanceReadStatus(outcome.code),
        outcome.message,
        outcome.code,
      );
    }
    return schema.parse(envelope.data);
  };
}

function pagedSearchBody(params: Record<string, unknown>) {
  const { search, page } = pagedSearchParamsSchema.parse(params);
  return {
    ...(search !== undefined && { search }),
    ...(page && { pageNum: page.number, pageSize: page.size }),
  };
}

function formBody(id: string | undefined, { values, changedField }: GovernanceFormParams, extra?: Record<string, unknown>) {
  return {
    ...(id !== undefined && { id }),
    ...extra,
    ...(values !== undefined && { values }),
    changedField: changedField ?? null,
  };
}

export interface GovernanceReadOptions {
  domainId?: string;
  loadPolicyCatalog?: () => Promise<PolicyWorkbenchCatalog>;
}

export function createGovernanceReadAdapters(viewer: AssistantCredentials, options: GovernanceReadOptions = {}) {
  const owner = governanceOwner(viewer);

  async function count(name: string, path: string): Promise<PanelRecordQuery> {
    const { total } = await owner(name, path, { countOnly: true }, z.object({ total: z.number().int().nonnegative() }));
    return { rows: [], total };
  }

  async function effectiveAccessBody(id: string, category?: string) {
    const needsCatalog = !category || category === "productObject" || category === "capabilityObject";
    const workbenchCatalog = needsCatalog && options.loadPolicyCatalog ? await options.loadPolicyCatalog() : undefined;
    return {
      id,
      ...(category ? { category } : {}),
      ...(workbenchCatalog ? { workbenchCatalog } : {}),
    };
  }

  return {
    users: {
      count: () => count("governance-users-count", "/panel/governance/users/query"),
      query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
        return owner("governance-users-query", "/panel/governance/users/query", pagedSearchBody(params), panelRecordQuerySchema);
      },
      record(id: string): Promise<PanelRecord> {
        return owner("governance-user-record", "/panel/governance/users/record", { id }, panelRecordSchema);
      },
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-user-form", "/panel/governance/users/form", formBody(id, params), panelFormDescriptionSchema);
      },
      createForm(params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-user-create-form", "/panel/governance/users/form", formBody(undefined, params), panelFormDescriptionSchema);
      },
      effectivePermissions(id: string): Promise<PanelRecord> {
        return owner("governance-user-effective-permissions", "/panel/governance/users/effective-permissions", { id }, panelRecordSchema);
      },
      async effectiveAccess(id: string, category?: string): Promise<PanelRecord[]> {
        return owner(
          "governance-user-effective-access",
          "/panel/governance/users/effective-access",
          await effectiveAccessBody(id, category),
          panelRecordListSchema,
        );
      },
      effectiveAccessCounts(id: string): Promise<PanelRecord> {
        return owner(
          "governance-user-effective-access-counts",
          "/panel/governance/users/effective-access-counts",
          { id },
          panelRecordSchema,
        );
      },
      effectiveOrgShares(id: string): Promise<PanelRecord[]> {
        return owner("governance-user-effective-org-shares", "/panel/governance/users/effective-org-shares", { id }, panelRecordListSchema);
      },
      effectiveManagementOperations(id: string): Promise<PanelRecord[]> {
        return owner("governance-user-effective-management-operations", "/panel/governance/users/effective-management-operations", { id }, panelRecordListSchema);
      },
      effectiveDataPermissions(id: string, scope: "subject" | "managed" | "effective"): Promise<PanelRecord[]> {
        return owner("governance-user-effective-data-permissions", "/panel/governance/users/effective-data-permissions", { id, scope }, panelRecordListSchema);
      },
      lookupAccount(keyword: string): Promise<PanelOptionList> {
        return owner("governance-user-lookup-account", "/panel/governance/users/lookup-account", { keyword }, panelOptionListSchema);
      },
    },
    roles: {
      count: () => count("governance-roles-count", "/panel/governance/roles/query"),
      options(): Promise<PanelOptionList> {
        return owner("governance-roles-options", "/panel/governance/roles/options", {}, panelOptionListSchema);
      },
      resolve(values: readonly unknown[]): Promise<PanelOptionList> {
        return owner("governance-roles-resolve", "/panel/governance/roles/resolve", { values }, panelOptionListSchema);
      },
      query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
        return owner("governance-roles-query", "/panel/governance/roles/query", pagedSearchBody(params), panelRecordQuerySchema);
      },
      record(id: string): Promise<PanelRecord> {
        return owner("governance-role-record", "/panel/governance/roles/record", { id }, panelRecordSchema);
      },
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-role-form", "/panel/governance/roles/form", formBody(id, params), panelFormDescriptionSchema);
      },
      createForm(params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-role-create-form", "/panel/governance/roles/form", formBody(undefined, params), panelFormDescriptionSchema);
      },
      /** Members currently assigned to this role. */
      members(id: string): Promise<PanelRecord[]> {
        return owner("governance-role-members", "/panel/governance/roles/members", { id }, panelRecordListSchema);
      },
      /** Permission policies currently assigned to this role, including their use by other roles. */
      policies(id: string): Promise<PanelRecord[]> {
        return owner("governance-role-policies", "/panel/governance/roles/policies", { id }, panelRecordListSchema);
      },
      /** Domain members not yet assigned to this role. */
      memberCandidates(id: string): Promise<PanelRecord[]> {
        return owner("governance-role-member-candidates", "/panel/governance/roles/member-candidates", { id }, panelRecordListSchema);
      },
      /** Domain permission policies not yet assigned to this role. */
      policyCandidates(id: string): Promise<PanelRecord[]> {
        return owner("governance-role-policy-candidates", "/panel/governance/roles/policy-candidates", { id }, panelRecordListSchema);
      },
      /** The permission policies this role uses: each policy's name and type. */
      contributionPolicies(id: string): Promise<PanelRecord[]> {
        return owner("governance-role-contribution-policies", "/panel/governance/roles/contribution/permission-policies", { id }, panelRecordListSchema);
      },
      /** The workflow steps published to this role: which workflow, which step, and the scope that step grants. */
      contributionWorkflowSteps(id: string): Promise<PanelRecord[]> {
        return owner("governance-role-contribution-workflow-steps", "/panel/governance/roles/contribution/workflow-steps", { id }, panelRecordListSchema);
      },
      /** Effective permissions brought by this role across the six governance categories, optionally filtered by category. */
      async effectiveAccess(id: string, category?: string): Promise<PanelRecord[]> {
        return owner(
          "governance-role-effective-access",
          "/panel/governance/roles/effective-access",
          await effectiveAccessBody(id, category),
          panelRecordListSchema,
        );
      },
      /** Category row counts for this role's permission summary dropdown. */
      effectiveAccessCounts(id: string): Promise<PanelRecord> {
        return owner(
          "governance-role-effective-access-counts",
          "/panel/governance/roles/effective-access-counts",
          { id },
          panelRecordSchema,
        );
      },
    },
    policies: {
      count: () => count("governance-policies-count", "/panel/governance/policies/query"),
      options(): Promise<PanelOptionList> {
        return owner("governance-policies-options", "/panel/governance/policies/options", {}, panelOptionListSchema);
      },
      resolve(values: readonly unknown[]): Promise<PanelOptionList> {
        return owner("governance-policies-resolve", "/panel/governance/policies/resolve", { values }, panelOptionListSchema);
      },
      query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
        return owner("governance-policies-query", "/panel/governance/policies/query", pagedSearchBody(params), panelRecordQuerySchema);
      },
      record(id: string): Promise<PanelRecord> {
        return owner("governance-policy-record", "/panel/governance/policies/record", { id }, panelRecordSchema);
      },
      async form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        const workbenchCatalog = options.loadPolicyCatalog ? await options.loadPolicyCatalog() : undefined;
        const form = await owner(
          "governance-policy-form",
          "/panel/governance/policies/form",
          formBody(id, params, workbenchCatalog ? { workbenchCatalog } : undefined),
          panelFormDescriptionSchema,
        );
        if (!options.domainId || form.values.postType !== 3) return form;
        const usage = await policyObjectEntryUsagePayload(viewer, options.domainId, id);
        return { ...form, values: { ...form.values, entryUsage: usage.items } };
      },
      createForm(params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-policy-create-form", "/panel/governance/policies/form", formBody(undefined, params), panelFormDescriptionSchema);
      },
      async objectGrantCandidates(id: string, params: Record<string, unknown>): Promise<PanelOptionList> {
        const workbenchCatalog = options.loadPolicyCatalog ? await options.loadPolicyCatalog() : undefined;
        return owner("governance-policy-object-candidates", "/panel/governance/policies/object-candidates", {
          id,
          field: params.field,
          ...(params.values !== undefined && { values: params.values }),
          ...(params.keyword !== undefined && { keyword: params.keyword }),
          ...(workbenchCatalog ? { workbenchCatalog } : {}),
        }, panelOptionListSchema);
      },
      dataClassCandidates(id: string, params: Record<string, unknown>): Promise<PanelOptionList> {
        return owner("governance-policy-data-class-candidates", "/panel/governance/policies/data-class-candidates", {
          id,
          ...(params.values !== undefined && { values: params.values }),
          ...(params.keyword !== undefined && { keyword: params.keyword }),
        }, panelOptionListSchema);
      },
    },
    orgUnits: {
      count: () => count("governance-org-units-count", "/panel/governance/org-units/list"),
      list(): Promise<PanelRecord[]> {
        return owner("governance-org-units-list", "/panel/governance/org-units/list", {}, panelRecordListSchema);
      },
      options(): Promise<PanelOptionList> {
        return owner("governance-org-units-options", "/panel/governance/org-units/options", {}, panelOptionListSchema);
      },
      resolve(values: readonly unknown[]): Promise<PanelOptionList> {
        return owner("governance-org-units-resolve", "/panel/governance/org-units/resolve", { values }, panelOptionListSchema);
      },
      record(id: string): Promise<PanelRecord> {
        return owner("governance-org-unit-record", "/panel/governance/org-units/record", { id }, panelRecordSchema);
      },
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-org-unit-form", "/panel/governance/org-units/form", formBody(id, params), panelFormDescriptionSchema);
      },
      createForm(params: GovernanceFormParams & { parentId?: string }): Promise<PanelFormDescription> {
        const { parentId, ...rest } = params;
        return owner(
          "governance-org-unit-create-form",
          "/panel/governance/org-units/form",
          formBody(undefined, rest, parentId !== undefined ? { parentId } : undefined),
          panelFormDescriptionSchema,
        );
      },
      members(id: string): Promise<PanelRecord[]> {
        return owner("governance-org-unit-members", "/panel/governance/org-units/members", { id }, panelRecordListSchema);
      },
      memberCandidates(id: string, keyword?: string): Promise<PanelOptionList> {
        return owner(
          "governance-org-unit-member-candidates",
          "/panel/governance/org-units/member-candidates",
          { id, ...(keyword !== undefined && { keyword }) },
          panelOptionListSchema,
        );
      },
      positions(id: string): Promise<PanelRecord[]> {
        return owner("governance-org-unit-positions", "/panel/governance/org-units/positions", { id }, panelRecordListSchema);
      },
      grants(id: string): Promise<PanelRecord[]> {
        return owner("governance-org-unit-grants", "/panel/governance/org-units/grants", { id }, panelRecordListSchema);
      },
      inheritedGrants(id: string): Promise<PanelRecord[]> {
        return owner("governance-org-unit-inherited-grants", "/panel/governance/org-units/inherited-grants", { id }, panelRecordListSchema);
      },
    },
    orgMemberships: {
      record(id: string): Promise<PanelRecord> {
        return owner("governance-org-membership-record", "/panel/governance/org-memberships/record", { id }, panelRecordSchema);
      },
    },
    orgPositions: {
      record(id: string): Promise<PanelRecord> {
        return owner("governance-org-position-record", "/panel/governance/org-positions/record", { id }, panelRecordSchema);
      },
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-org-position-form", "/panel/governance/org-positions/form", formBody(id, params), panelFormDescriptionSchema);
      },
      createForm(params: GovernanceFormParams & { orgId: string }): Promise<PanelFormDescription> {
        const { orgId, ...rest } = params;
        return owner(
          "governance-org-position-create-form",
          "/panel/governance/org-positions/form",
          formBody(undefined, rest, { orgId }),
          panelFormDescriptionSchema,
        );
      },
    },
    orgGrants: {
      record(id: string): Promise<PanelRecord> {
        return owner("governance-org-grant-record", "/panel/governance/org-grants/record", { id }, panelRecordSchema);
      },
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-org-grant-form", "/panel/governance/org-grants/form", formBody(id, params), panelFormDescriptionSchema);
      },
    },
  };
}

/**
 * Stored policy type of `sys_post.post_type` for entries and the objects an entry brings out, i.e. `PolicyTypes.OBJECT`
 * on the Java side. 1 and 2 keep their released meaning (management operations, business data).
 */
const ENTRY_AND_OBJECT_POLICY_TYPE = 3;

function ownerData<T>(result: OwnerReadResult<T>): T {
  if (!result.ok) throw new HttpError(result.status === "refused" ? 403 : 502, result.reason);
  return result.data;
}

/**
 * What the member access tab needs before it asks about one entry: every entry of the domain, the entry-and-object
 * policies this member's own roles carry (filling a policy the member does not carry would not reach him), the roles and
 * people each of those policies reaches, and whether this viewer may change policies at all. A policy the person arrived
 * with is preselected only when it is one of his own.
 */
export async function readMemberAccessContext(
  owner: ProductOwner, viewer: AssistantCredentials, subjectId: string, inspectingPolicyId?: string,
): Promise<RuntimeJsonObject> {
  // The directory readers sit above the skills registry; load them when a member access check runs, not while a panel
  // is placed.
  const { PlatformOntologyOwnerReaders } = await import("../platform-ontology/owners");
  const readers = new PlatformOntologyOwnerReaders(owner, viewer);
  const [entries, subjects, rolePolicies, policies, roleAccess] = await Promise.all([
    listPolicyEntries(viewer),
    readers.subjects().then(ownerData),
    readers.rolePolicies().then(ownerData),
    readers.permissionPolicies().then(ownerData),
    readers.platformAccess().then(ownerData),
  ]);
  const ownRoleIds = new Set(subjects.find(subject => subject.id === subjectId)?.roleIds ?? []);
  const ownPolicyIds = new Set(rolePolicies.filter(link => ownRoleIds.has(link.roleId)).map(link => link.policyId));
  const roleNameById = new Map(roleAccess.map(access => [access.roleId ?? "", access.roleCode ?? ""]));
  const candidates = policies.filter(policy => policy.type === ENTRY_AND_OBJECT_POLICY_TYPE && ownPolicyIds.has(policy.id));
  const fillPolicies: RuntimeJsonObject[] = candidates.map(policy => {
    const roleIds = [...new Set(rolePolicies.filter(link => link.policyId === policy.id).map(link => link.roleId))];
    const policyRoleIds = new Set(roleIds);
    const members = subjects.filter(subject => subject.roleIds.some(roleId => policyRoleIds.has(roleId)));
    return {
      policyId: policy.id,
      label: policy.name,
      roleIds,
      roleNames: roleIds.map(roleId => roleNameById.get(roleId) || roleId),
      memberIds: members.map(member => member.id),
      memberNames: members.map(member => member.displayName || member.loginCode || member.id),
    };
  });
  const preselected = candidates.some(policy => policy.id === inspectingPolicyId);
  return {
    subjectId,
    entries,
    fillPolicies,
    canManage: candidates.length > 0 && await readPolicyChangePermission(viewer, candidates[0]!.id),
    preselectedPolicyId: preselected ? inspectingPolicyId ?? null : null,
  };
}
