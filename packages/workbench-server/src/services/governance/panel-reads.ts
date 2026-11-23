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
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { ownerEnvelopeSchema, ownerWriteFailure } from "../product-panels/data-query-operations";

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

export function createGovernanceReadAdapters(viewer: AssistantCredentials) {
  const owner = governanceOwner(viewer);

  return {
    users: {
      query(params: Record<string, unknown>): Promise<PanelRecordQuery> {
        return owner("governance-users-query", "/panel/governance/users/query", pagedSearchBody(params), panelRecordQuerySchema);
      },
      record(id: string): Promise<PanelRecord> {
        return owner("governance-user-record", "/panel/governance/users/record", { id }, panelRecordSchema);
      },
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-user-form", "/panel/governance/users/form", formBody(id, params), panelFormDescriptionSchema);
      },
      effectivePermissions(id: string): Promise<PanelRecord> {
        return owner("governance-user-effective-permissions", "/panel/governance/users/effective-permissions", { id }, panelRecordSchema);
      },
      lookupAccount(keyword: string): Promise<PanelOptionList> {
        return owner("governance-user-lookup-account", "/panel/governance/users/lookup-account", { keyword }, panelOptionListSchema);
      },
    },
    roles: {
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
    },
    policies: {
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
      form(id: string, params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-policy-form", "/panel/governance/policies/form", formBody(id, params), panelFormDescriptionSchema);
      },
      createForm(params: GovernanceFormParams): Promise<PanelFormDescription> {
        return owner("governance-policy-create-form", "/panel/governance/policies/form", formBody(undefined, params), panelFormDescriptionSchema);
      },
      menuPermissions(id: string): Promise<PanelRecord> {
        return owner("governance-policy-menu-permissions", "/panel/governance/policies/menu-permissions", { id }, panelRecordSchema);
      },
      apiPermissions(id: string, search?: string): Promise<PanelRecord> {
        return owner(
          "governance-policy-api-permissions",
          "/panel/governance/policies/api-permissions",
          { id, ...(search !== undefined && { search }) },
          panelRecordSchema,
        );
      },
      dataPermissions(id: string): Promise<PanelRecord> {
        return owner("governance-policy-data-permissions", "/panel/governance/policies/data-permissions", { id }, panelRecordSchema);
      },
    },
    orgUnits: {
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
