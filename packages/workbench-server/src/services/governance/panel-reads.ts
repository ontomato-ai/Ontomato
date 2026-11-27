import { z } from "zod";
import { panelOptionListSchema, type PanelFormDescription, type PanelOptionList } from "@ontomato/contracts/panel-projection";
import type { RuntimeJsonObject } from "@ontomato/contracts/agent-runtime-values";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { ownerEnvelopeSchema, ownerWriteFailure } from "../product-panels/data-query-operations";
import type { OwnerReadResult } from "../platform-ontology/owners";
import { listPolicyEntries, policyObjectEntryUsagePayload, readPolicyChangePermission } from "./policy-access";

/*
 * The governance owner access that panel operations still need outside the registered reads: policy-form entry usage
 * and the role directory options of a member access check. Each owner answer keeps the viewer's credentials and locale,
 * preserves coded owner refusals, and is validated against the shared panel contract schema.
 */

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

export async function withPolicyFormEntryUsage(
  form: PanelFormDescription, viewer: AssistantCredentials, domainId: string | undefined, id: string,
): Promise<PanelFormDescription> {
  if (!domainId || form.values.postType !== 3) return form;
  const { items } = await policyObjectEntryUsagePayload(viewer, domainId, id);
  return { ...form, values: { ...form.values, entryUsage: items } };
}

export function createGovernanceReadAdapters(viewer: AssistantCredentials) {
  const owner = governanceOwner(viewer);
  return {
    roles: {
      options(): Promise<PanelOptionList> {
        return owner("governance-roles-options", "/panel/governance/roles/options", {}, panelOptionListSchema);
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
  const [entries, subjects, rolePolicies, policies, roleAccess, roleOptions] = await Promise.all([
    listPolicyEntries(viewer),
    readers.subjects().then(ownerData),
    readers.rolePolicies().then(ownerData),
    readers.permissionPolicies().then(ownerData),
    readers.platformAccess().then(ownerData),
    createGovernanceReadAdapters(viewer).roles.options(),
  ]);
  const ownRoleIds = new Set(subjects.find(subject => subject.id === subjectId)?.roleIds ?? []);
  const ownPolicyIds = new Set(rolePolicies.filter(link => ownRoleIds.has(link.roleId)).map(link => link.policyId));
  const roleNameById = new Map(roleAccess.map(access => [access.roleId ?? "", access.roleCode ?? ""]));
  // What the access check reports names its sources by id alone; the detail page shows the same words as the rows above
  // it, so the answer carries the domain's role and policy names.
  const roleLabels: RuntimeJsonObject = {
    // The reserved domain-member role keeps out of the role directory, so the code the platform-access read carries is
    // the only name such a role has — the same word the rows above the check already show.
    ...Object.fromEntries(roleAccess.flatMap(access => (access.roleId && access.roleCode ? [[access.roleId, access.roleCode]] : []))),
    ...Object.fromEntries(roleOptions.options.map(option => [String(option.value), option.label])),
  };
  const policyLabels: RuntimeJsonObject = Object.fromEntries(policies.map(policy => [policy.id, policy.name]));
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
    roleLabels,
    policyLabels,
    canManage: candidates.length > 0 && await readPolicyChangePermission(viewer, candidates[0]!.id),
    preselectedPolicyId: preselected ? inspectingPolicyId ?? null : null,
  };
}
