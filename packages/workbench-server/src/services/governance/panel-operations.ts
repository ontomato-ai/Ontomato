import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "@ontomato/contracts/agent-runtime-values";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import {
  ADD_ORG_UNIT_MEMBER,
  ADD_USER_MEMBER,
  DELETE_ORG_GRANT,
  DELETE_ORG_POSITION,
  DELETE_ORG_UNIT,
  DELETE_PERMISSION_POLICY,
  DELETE_ROLE,
  ORG_GRANT,
  ORG_MEMBERSHIP,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  REFRESH_POLICY_API_CATALOG,
  REMOVE_ORG_MEMBERSHIP,
  REMOVE_USER,
  REVOKE_USER_API_KEY,
  ROLE,
  SAVE_POLICY_API_PERMISSIONS,
  SAVE_POLICY_DATA_PERMISSIONS,
  SAVE_POLICY_MENU_PERMISSIONS,
  SET_ORG_MEMBERSHIP_LOCKED,
  USER,
} from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelImpactInspector,
  PanelOperationTarget,
  PanelRecordTarget,
  PanelServerOperation,
  SinglePanelOperationOutcome,
} from "../product-panels/server-operations";
import {
  affected,
  ownerDeleteUnavailable,
  ownerEnvelopeSchema,
  ownerPost,
  ownerRecord,
  ownerWriteFailure,
  save,
  savedIdSchema,
  valuesForTarget,
  type DataQueryOperationHost as Host,
} from "../product-panels/data-query-operations";

/*
 * Enterprise governance owners as panel server operations: form saves, destructive/impactful actions with confirmation
 * inspection, permission-matrix writes, and organization membership/position/grant mutations. Every write posts through
 * the data-query governance owner, preserving coded refusals, field errors, and unavailability reasons in the caller's
 * locale.
 */

const formInstructions =
  "Read the form for the intended target. Use its fields, values and save.bodySchema for the values, and save.draftOperation for the draft. Carry the complete form values in call.input.";

const recordLabelSchema = z.object({ label: z.string().min(1) }).passthrough();
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const emptyInputSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();
const permissionCountResultSchema = z.object({ id: z.string().min(1), count: z.number().int().nonnegative() }).strict();
const dataPermissionResultSchema = z.object({ id: z.string().min(1), savedRuleCount: z.number().int().nonnegative() }).strict();
const refreshCatalogResultSchema = z.object({ refreshed: z.boolean() }).strict();

const addUserMemberInputSchema = z.object({
  userId: z.string().min(1).optional(),
  loginCode: z.string().min(1).optional(),
  roleIds: z.array(z.string().min(1)).optional(),
}).strict();

const saveMenuPermissionsInputSchema = z.object({
  menuIds: z.array(z.string().min(1)),
  preserveOutsideTree: z.boolean().optional(),
}).strict();

const saveApiPermissionsInputSchema = z.object({
  apiIds: z.array(z.string().min(1)),
}).strict();

const saveDataPermissionsInputSchema = z.object({
  items: z.array(z.object({
    className: z.string().min(1),
    fieldPermissions: runtimeJsonValueSchema.optional(),
    rowPermission: runtimeJsonValueSchema.optional(),
  }).strict()),
}).strict();

const addOrgUnitMemberInputSchema = z.object({
  userId: z.string().min(1),
}).strict();

const addOrgUnitMemberResultSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  userId: z.string().min(1),
  record: runtimeJsonObjectSchema,
}).strict();

const setOrgMembershipLockedInputSchema = z.object({
  locked: z.boolean(),
}).strict();

const setOrgMembershipLockedResultSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  userId: z.string().min(1),
  locked: z.boolean(),
  record: runtimeJsonObjectSchema,
}).strict();

const orgInspectSchema = z.union([
  z.object({
    available: z.literal(false),
    code: z.string().min(1),
    reason: z.string().min(1),
  }).passthrough(),
  z.object({
    available: z.literal(true),
  }).passthrough(),
]);

const objectTarget = <Type extends string>(objectType: Type) => z.object({
  kind: z.literal("object"),
  objectType: z.literal(objectType),
  primaryKey: z.string().min(1),
}).strict();

const saveTarget = <Type extends string>(objectType: Type) =>
  z.discriminatedUnion("kind", [objectTarget(objectType), panelFormTargetSchema.options[1]]);

function saveBody(target: PanelOperationTarget, input: Record<string, unknown>) {
  const { values, submittedFields } = saveInputSchema.parse(input);
  return { ...valuesForTarget(target, values), ...(submittedFields && { submittedFields }) };
}

async function governanceTargetLabel(host: Host, target: PanelRecordTarget, recordPath: string, code: string): Promise<string> {
  return recordLabelSchema.parse(await ownerRecord(host, target, recordPath, code)).label;
}

async function inspectOrgAvailability(host: Host, path: string, target: PanelRecordTarget, fallbackCode: string) {
  const envelope = await ownerPost(host, path, { id: target.primaryKey }, ownerEnvelopeSchema);
  if (!envelope.success) {
    const failure = ownerWriteFailure(envelope, fallbackCode, "The owner could not inspect the target");
    throw new HttpError(422, failure.message, failure.code);
  }
  const data = orgInspectSchema.parse(envelope.data);
  return data.available ? undefined : { reason: data.reason };
}

function simpleTargetImpact(
  handlerRef: string,
  summaryKey: string,
  recordPath: string,
  unavailableCode: string,
): PanelImpactInspector {
  return {
    handlerRef,
    async inspect(host, calls) {
      const targets = calls.map(call => call.target as PanelRecordTarget);
      return {
        summary: tForLocale(host.locale, summaryKey),
        objects: await Promise.all(targets.map(async target => ({
          target: { objectType: target.objectType, primaryKey: target.primaryKey },
          label: await governanceTargetLabel(host, target, recordPath, unavailableCode),
        }))),
        total: targets.length,
      };
    },
  };
}

const deleteOrgUnitImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_ORG_UNIT}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const label = await governanceTargetLabel(host, target, "/panel/governance/org-units/record", "ORG_UNIT_UNAVAILABLE");
    const envelope = await ownerPost(host, "/panel/governance/org-units/delete/inspect", { id: target.primaryKey }, ownerEnvelopeSchema);
    const memberCount = envelope.success && typeof (envelope.data as { memberCount?: unknown })?.memberCount === "number"
      ? (envelope.data as { memberCount: number }).memberCount
      : 0;
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteOrgUnitImpact", { memberCount }),
      objects: [{ target: { objectType: target.objectType, primaryKey: target.primaryKey }, label }],
      total: 1,
    };
  },
};

const removeOrgMembershipImpact: PanelImpactInspector = {
  handlerRef: `${REMOVE_ORG_MEMBERSHIP}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const label = await governanceTargetLabel(host, target, "/panel/governance/org-memberships/record", "ORG_MEMBERSHIP_UNAVAILABLE");
    const envelope = await ownerPost(host, "/panel/governance/org-memberships/remove/inspect", { id: target.primaryKey }, ownerEnvelopeSchema);
    const positionCount = envelope.success && typeof (envelope.data as { positionCount?: unknown })?.positionCount === "number"
      ? (envelope.data as { positionCount: number }).positionCount
      : 0;
    return {
      summary: tForLocale(host.locale, "panels.confirmation.removeOrgMembershipImpact", { positionCount }),
      objects: [{ target: { objectType: target.objectType, primaryKey: target.primaryKey }, label }],
      total: 1,
    };
  },
};

const deleteOrgPositionImpact: PanelImpactInspector = {
  handlerRef: `${DELETE_ORG_POSITION}.inspect-impact`,
  async inspect(host, calls) {
    const target = calls[0]!.target as PanelRecordTarget;
    const label = await governanceTargetLabel(host, target, "/panel/governance/org-positions/record", "ORG_POSITION_UNAVAILABLE");
    const envelope = await ownerPost(host, "/panel/governance/org-positions/delete/inspect", { id: target.primaryKey }, ownerEnvelopeSchema);
    const data = envelope.success ? (envelope.data as { roleCount?: unknown; scopeCount?: unknown }) : undefined;
    const roleCount = typeof data?.roleCount === "number" ? data.roleCount : 0;
    const scopeCount = typeof data?.scopeCount === "number" ? data.scopeCount : 0;
    return {
      summary: tForLocale(host.locale, "panels.confirmation.deleteOrgPositionImpact", { roleCount, scopeCount }),
      objects: [{ target: { objectType: target.objectType, primaryKey: target.primaryKey }, label }],
      total: 1,
    };
  },
};

async function postAction(
  host: Host,
  path: string,
  body: unknown,
  failureCode: string,
  fallbackMessage: string,
  onSuccess: (data: Record<string, unknown>) => SinglePanelOperationOutcome,
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, body, ownerEnvelopeSchema);
  if (!envelope.success) return ownerWriteFailure(envelope, failureCode, fallbackMessage);
  return onSuccess(runtimeJsonObjectSchema.parse(envelope.data));
}

async function removeWithAffected(
  host: Host,
  path: string,
  target: PanelRecordTarget,
  failureCode: string,
  objectTypes: string[],
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, path, { id: target.primaryKey }, ownerEnvelopeSchema);
  return envelope.success
    ? {
        kind: "success",
        data: {},
        affected: {
          ...affected(target.objectType, target.primaryKey, objectTypes),
          removed: [{ objectType: target.objectType, primaryKey: target.primaryKey }],
        },
      }
    : ownerWriteFailure(envelope, failureCode, "The owner could not delete the record");
}

export const governanceServerOperations = [
  // -------------------------------------------------------------------------
  // platform:User
  // -------------------------------------------------------------------------
  {
    handlerRef: `${USER}.save`,
    labelKey: "panels.governance.user.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: USER },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: () => "user.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/panel/governance/users/save", saveBody(target, input), "USER_SAVE_FAILED", USER, [USER, ROLE]);
    },
  },
  {
    handlerRef: REMOVE_USER,
    labelKey: "panels.governance.user.operations.remove",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REMOVE_USER },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "user",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/users/record", "USER_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.user.removed", { name }),
    inspectImpact: simpleTargetImpact(
      `${REMOVE_USER}.inspect-impact`,
      "panels.confirmation.removeUserImpact",
      "/panel/governance/users/record",
      "USER_UNAVAILABLE",
    ),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(host, "/panel/governance/users/remove/unavailable", { id: target.primaryKey }, "USER_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Removing a member acts on a selected user");
      return removeWithAffected(
        host,
        "/panel/governance/users/remove",
        target,
        "USER_REMOVE_FAILED",
        [USER, ROLE, ORG_UNIT, ORG_MEMBERSHIP, ORG_POSITION, ORG_GRANT],
      );
    },
  },
  {
    handlerRef: ADD_USER_MEMBER,
    labelKey: "panels.governance.user.operations.addMember",
    kind: "action",
    binding: { kind: "PlatformOperation", id: ADD_USER_MEMBER },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: z.null(),
    inputSchema: addUserMemberInputSchema,
    resultSchema: savedIdSchema,
    async execute(host: Host, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const body = addUserMemberInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/users/add-member",
        body,
        "USER_ADD_MEMBER_FAILED",
        "The owner could not add the account to the domain",
        data => {
          const parsed = runtimeJsonObjectSchema.parse(data);
          const saved = savedIdSchema.parse(parsed);
          return { kind: "success", data: parsed, affected: affected(USER, saved.id, [USER, ROLE]) };
        },
      );
    },
  },
  {
    handlerRef: REVOKE_USER_API_KEY,
    labelKey: "panels.governance.user.operations.revokeApiKey",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REVOKE_USER_API_KEY },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: emptyInputSchema,
    resultSchema: savedIdSchema,
    targetInput: "user",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/users/record", "USER_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.user.apiKeyRevoked", { name }),
    inspectImpact: simpleTargetImpact(
      `${REVOKE_USER_API_KEY}.inspect-impact`,
      "panels.confirmation.revokeUserApiKeyImpact",
      "/panel/governance/users/record",
      "USER_UNAVAILABLE",
    ),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(host, "/panel/governance/users/api-key/unavailable", { id: target.primaryKey, mode: "revoke" }, "USER_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("API key revocation acts on a selected user");
      return postAction(
        host,
        "/panel/governance/users/revoke-api-key",
        { id: target.primaryKey },
        "USER_API_KEY_FAILED",
        "The owner could not revoke the API key",
        data => {
          const parsed = runtimeJsonObjectSchema.parse(data);
          savedIdSchema.parse(parsed);
          return { kind: "success", data: parsed, affected: affected(USER, target.primaryKey, [USER]) };
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // platform:Role
  // -------------------------------------------------------------------------
  {
    handlerRef: `${ROLE}.save`,
    labelKey: "panels.governance.role.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ROLE },
    effect: "write",
    batch: false,
    targetType: ROLE,
    targetSchema: saveTarget(ROLE),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "role.create" : "role.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: ROLE, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/panel/governance/roles/save", saveBody(target, input), "ROLE_SAVE_FAILED", ROLE, [ROLE, USER, ORG_GRANT]);
    },
  },
  {
    handlerRef: DELETE_ROLE,
    labelKey: "panels.governance.role.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_ROLE },
    effect: "write",
    batch: false,
    targetType: ROLE,
    targetSchema: objectTarget(ROLE),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "role",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/roles/record", "ROLE_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.role.deleted", { name }),
    inspectImpact: simpleTargetImpact(
      `${DELETE_ROLE}.inspect-impact`,
      "panels.confirmation.deleteRoleImpact",
      "/panel/governance/roles/record",
      "ROLE_UNAVAILABLE",
    ),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(host, "/panel/governance/roles/delete/unavailable", { id: target.primaryKey }, "ROLE_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected role");
      return removeWithAffected(host, "/panel/governance/roles/delete", target, "ROLE_DELETE_FAILED", [ROLE, USER, ORG_GRANT]);
    },
  },

  // -------------------------------------------------------------------------
  // platform:PermissionPolicy
  // -------------------------------------------------------------------------
  {
    handlerRef: `${PERMISSION_POLICY}.save`,
    labelKey: "panels.governance.policy.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: PERMISSION_POLICY },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: saveTarget(PERMISSION_POLICY),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "permissionPolicy.create" : "permissionPolicy.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: PERMISSION_POLICY, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(
        host,
        "/panel/governance/policies/save",
        saveBody(target, input),
        "PERMISSION_POLICY_SAVE_FAILED",
        PERMISSION_POLICY,
        [PERMISSION_POLICY, ROLE],
      );
    },
  },
  {
    handlerRef: DELETE_PERMISSION_POLICY,
    labelKey: "panels.governance.policy.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_PERMISSION_POLICY },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "policy",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/policies/record", "PERMISSION_POLICY_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.policy.deleted", { name }),
    inspectImpact: simpleTargetImpact(
      `${DELETE_PERMISSION_POLICY}.inspect-impact`,
      "panels.confirmation.deletePermissionPolicyImpact",
      "/panel/governance/policies/record",
      "PERMISSION_POLICY_UNAVAILABLE",
    ),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(host, "/panel/governance/policies/delete/unavailable", { id: target.primaryKey }, "PERMISSION_POLICY_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected permission policy");
      return removeWithAffected(
        host,
        "/panel/governance/policies/delete",
        target,
        "PERMISSION_POLICY_DELETE_FAILED",
        [PERMISSION_POLICY, ROLE],
      );
    },
  },
  {
    handlerRef: SAVE_POLICY_MENU_PERMISSIONS,
    labelKey: "panels.governance.policy.operations.saveMenuPermissions",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SAVE_POLICY_MENU_PERMISSIONS },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: saveMenuPermissionsInputSchema,
    resultSchema: permissionCountResultSchema,
    targetInput: "policy",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/policies/record", "PERMISSION_POLICY_UNAVAILABLE"),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(
        host,
        "/panel/governance/policies/permission-write/unavailable",
        { id: target.primaryKey, kind: "menu" },
        "PERMISSION_POLICY_UNAVAILABLE",
      ),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Menu permissions save acts on a selected permission policy");
      const { menuIds, preserveOutsideTree } = saveMenuPermissionsInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/policies/menu-permissions/save",
        { id: target.primaryKey, menuIds, ...(preserveOutsideTree !== undefined && { preserveOutsideTree }) },
        "POLICY_MENU_PERMISSIONS_SAVE_FAILED",
        "The owner could not save menu permissions",
        data => ({
          kind: "success",
          data: permissionCountResultSchema.parse(data),
          affected: affected(PERMISSION_POLICY, target.primaryKey, [PERMISSION_POLICY, USER]),
        }),
      );
    },
  },
  {
    handlerRef: SAVE_POLICY_API_PERMISSIONS,
    labelKey: "panels.governance.policy.operations.saveApiPermissions",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SAVE_POLICY_API_PERMISSIONS },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: saveApiPermissionsInputSchema,
    resultSchema: permissionCountResultSchema,
    targetInput: "policy",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/policies/record", "PERMISSION_POLICY_UNAVAILABLE"),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(
        host,
        "/panel/governance/policies/permission-write/unavailable",
        { id: target.primaryKey, kind: "api" },
        "PERMISSION_POLICY_UNAVAILABLE",
      ),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("API permissions save acts on a selected permission policy");
      const { apiIds } = saveApiPermissionsInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/policies/api-permissions/save",
        { id: target.primaryKey, apiIds },
        "POLICY_API_PERMISSIONS_SAVE_FAILED",
        "The owner could not save API permissions",
        data => ({
          kind: "success",
          data: permissionCountResultSchema.parse(data),
          affected: affected(PERMISSION_POLICY, target.primaryKey, [PERMISSION_POLICY, USER]),
        }),
      );
    },
  },
  {
    handlerRef: REFRESH_POLICY_API_CATALOG,
    labelKey: "panels.governance.policy.operations.refreshApiCatalog",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REFRESH_POLICY_API_CATALOG },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: z.null(),
    inputSchema: emptyInputSchema,
    resultSchema: refreshCatalogResultSchema,
    execute(host: Host): Promise<SinglePanelOperationOutcome> {
      return postAction(
        host,
        "/panel/governance/policies/api-catalog/refresh",
        {},
        "POLICY_API_CATALOG_REFRESH_FAILED",
        "The owner could not refresh the API permission catalog",
        data => ({
          kind: "success",
          data: refreshCatalogResultSchema.parse(data),
          affected: { objects: [], objectTypes: [PERMISSION_POLICY] },
        }),
      );
    },
  },
  {
    handlerRef: SAVE_POLICY_DATA_PERMISSIONS,
    labelKey: "panels.governance.policy.operations.saveDataPermissions",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SAVE_POLICY_DATA_PERMISSIONS },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: saveDataPermissionsInputSchema,
    resultSchema: dataPermissionResultSchema,
    targetInput: "policy",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/policies/record", "PERMISSION_POLICY_UNAVAILABLE"),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(
        host,
        "/panel/governance/policies/permission-write/unavailable",
        { id: target.primaryKey, kind: "data" },
        "PERMISSION_POLICY_UNAVAILABLE",
      ),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Data permissions save acts on a selected permission policy");
      const { items } = saveDataPermissionsInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/policies/data-permissions/save",
        { id: target.primaryKey, items },
        "POLICY_DATA_PERMISSIONS_SAVE_FAILED",
        "The owner could not save data permissions",
        data => ({
          kind: "success",
          data: dataPermissionResultSchema.parse(data),
          affected: affected(PERMISSION_POLICY, target.primaryKey, [PERMISSION_POLICY, USER]),
        }),
      );
    },
  },

  // -------------------------------------------------------------------------
  // platform:OrgUnit
  // -------------------------------------------------------------------------
  {
    handlerRef: `${ORG_UNIT}.save`,
    labelKey: "panels.governance.orgUnit.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ORG_UNIT },
    effect: "write",
    batch: false,
    targetType: ORG_UNIT,
    targetSchema: saveTarget(ORG_UNIT),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "orgUnit.create" : "orgUnit.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: ORG_UNIT, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/panel/governance/org-units/save", saveBody(target, input), "ORG_UNIT_SAVE_FAILED", ORG_UNIT, [ORG_UNIT]);
    },
  },
  {
    handlerRef: DELETE_ORG_UNIT,
    labelKey: "panels.governance.orgUnit.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_ORG_UNIT },
    effect: "write",
    batch: false,
    targetType: ORG_UNIT,
    targetSchema: objectTarget(ORG_UNIT),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "orgUnit",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/org-units/record", "ORG_UNIT_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.orgUnit.deleted", { name }),
    inspectImpact: deleteOrgUnitImpact,
    unavailable: (host: Host, target: PanelRecordTarget) =>
      inspectOrgAvailability(host, "/panel/governance/org-units/delete/inspect", target, "ORG_UNIT_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected organization unit");
      return removeWithAffected(
        host,
        "/panel/governance/org-units/delete",
        target,
        "ORG_UNIT_DELETE_FAILED",
        [ORG_UNIT, ORG_MEMBERSHIP, ORG_POSITION, ORG_GRANT],
      );
    },
  },
  {
    handlerRef: ADD_ORG_UNIT_MEMBER,
    labelKey: "panels.governance.orgUnit.operations.addMember",
    kind: "action",
    binding: { kind: "PlatformOperation", id: ADD_ORG_UNIT_MEMBER },
    effect: "write",
    batch: false,
    targetType: ORG_UNIT,
    targetSchema: objectTarget(ORG_UNIT),
    inputSchema: addOrgUnitMemberInputSchema,
    resultSchema: addOrgUnitMemberResultSchema,
    targetInput: "orgUnit",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/org-units/record", "ORG_UNIT_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Adding a member acts on a selected organization unit");
      const { userId } = addOrgUnitMemberInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/org-units/add-member",
        { id: target.primaryKey, userId },
        "ORG_UNIT_ADD_MEMBER_FAILED",
        "The owner could not add the member to the organization unit",
        data => {
          const parsed = addOrgUnitMemberResultSchema.parse(data);
          return {
            kind: "success",
            data: parsed,
            affected: {
              objects: [
                { objectType: ORG_UNIT, primaryKey: target.primaryKey },
                { objectType: ORG_MEMBERSHIP, primaryKey: parsed.id },
              ],
              objectTypes: [ORG_UNIT, ORG_MEMBERSHIP],
            },
          };
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // platform:OrgMembership
  // -------------------------------------------------------------------------
  {
    handlerRef: SET_ORG_MEMBERSHIP_LOCKED,
    labelKey: "panels.governance.orgMembership.operations.setLocked",
    kind: "action",
    binding: { kind: "PlatformOperation", id: SET_ORG_MEMBERSHIP_LOCKED },
    effect: "write",
    batch: false,
    targetType: ORG_MEMBERSHIP,
    targetSchema: objectTarget(ORG_MEMBERSHIP),
    inputSchema: setOrgMembershipLockedInputSchema,
    resultSchema: setOrgMembershipLockedResultSchema,
    targetInput: "membership",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/org-memberships/record", "ORG_MEMBERSHIP_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Locking a membership acts on a selected organization membership");
      const { locked } = setOrgMembershipLockedInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/org-memberships/set-locked",
        { id: target.primaryKey, locked },
        "ORG_MEMBERSHIP_LOCK_FAILED",
        "The owner could not update the membership lock state",
        data => {
          const parsed = setOrgMembershipLockedResultSchema.parse(data);
          return {
            kind: "success",
            data: parsed,
            affected: {
              objects: [
                { objectType: ORG_MEMBERSHIP, primaryKey: parsed.id },
                { objectType: ORG_UNIT, primaryKey: parsed.orgId },
              ],
              objectTypes: [ORG_MEMBERSHIP, ORG_UNIT],
            },
          };
        },
      );
    },
  },
  {
    handlerRef: REMOVE_ORG_MEMBERSHIP,
    labelKey: "panels.governance.orgMembership.operations.remove",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REMOVE_ORG_MEMBERSHIP },
    effect: "write",
    batch: false,
    targetType: ORG_MEMBERSHIP,
    targetSchema: objectTarget(ORG_MEMBERSHIP),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "membership",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/org-memberships/record", "ORG_MEMBERSHIP_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.orgMembership.removed", { name }),
    inspectImpact: removeOrgMembershipImpact,
    unavailable: (host: Host, target: PanelRecordTarget) =>
      inspectOrgAvailability(host, "/panel/governance/org-memberships/remove/inspect", target, "ORG_MEMBERSHIP_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Removing a membership acts on a selected organization membership");
      const envelope = await ownerPost(host, "/panel/governance/org-memberships/remove", { id: target.primaryKey }, ownerEnvelopeSchema);
      if (!envelope.success) {
        return ownerWriteFailure(envelope, "ORG_MEMBERSHIP_REMOVE_FAILED", "The owner could not remove the member from the organization unit");
      }
      return {
        kind: "success",
        data: {},
        affected: {
          ...affected(ORG_MEMBERSHIP, target.primaryKey, [ORG_MEMBERSHIP, ORG_UNIT, ORG_POSITION, ORG_GRANT]),
          removed: [{ objectType: ORG_MEMBERSHIP, primaryKey: target.primaryKey }],
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // platform:OrgPosition
  // -------------------------------------------------------------------------
  {
    handlerRef: `${ORG_POSITION}.save`,
    labelKey: "panels.governance.orgPosition.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ORG_POSITION },
    effect: "write",
    batch: false,
    targetType: ORG_POSITION,
    targetSchema: saveTarget(ORG_POSITION),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: (target: PanelOperationTarget) => target.kind === "draft" ? "orgPosition.create" : "orgPosition.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    create: {
      draftValues(values: unknown) {
        return runtimeJsonObjectSchema.parse(values);
      },
      createdObject(data: unknown) {
        return { objectType: ORG_POSITION, primaryKey: savedIdSchema.parse(data).id };
      },
    },
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(
        host,
        "/panel/governance/org-positions/save",
        saveBody(target, input),
        "ORG_POSITION_SAVE_FAILED",
        ORG_POSITION,
        [ORG_POSITION, ORG_UNIT],
      );
    },
  },
  {
    handlerRef: DELETE_ORG_POSITION,
    labelKey: "panels.governance.orgPosition.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_ORG_POSITION },
    effect: "write",
    batch: false,
    targetType: ORG_POSITION,
    targetSchema: objectTarget(ORG_POSITION),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "position",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/org-positions/record", "ORG_POSITION_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.orgPosition.deleted", { name }),
    inspectImpact: deleteOrgPositionImpact,
    unavailable: (host: Host, target: PanelRecordTarget) =>
      inspectOrgAvailability(host, "/panel/governance/org-positions/delete/inspect", target, "ORG_POSITION_UNAVAILABLE"),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected organization position");
      const envelope = await ownerPost(host, "/panel/governance/org-positions/delete", { id: target.primaryKey }, ownerEnvelopeSchema);
      if (!envelope.success) {
        return ownerWriteFailure(envelope, "ORG_POSITION_DELETE_FAILED", "The owner could not delete the organization position");
      }
      return {
        kind: "success",
        data: {},
        affected: {
          ...affected(ORG_POSITION, target.primaryKey, [ORG_POSITION, ORG_UNIT, ORG_GRANT]),
          removed: [{ objectType: ORG_POSITION, primaryKey: target.primaryKey }],
        },
      };
    },
  },

  // -------------------------------------------------------------------------
  // platform:OrgGrant
  // -------------------------------------------------------------------------
  {
    handlerRef: `${ORG_GRANT}.save`,
    labelKey: "panels.governance.orgGrant.operations.save",
    kind: "form.save",
    binding: { kind: "PlatformObjectType", id: ORG_GRANT },
    effect: "write",
    batch: false,
    targetType: ORG_GRANT,
    targetSchema: objectTarget(ORG_GRANT),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    draftOperation: () => "orgGrant.update",
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    formInstructions,
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Grant save acts on a selected organization grant");
      const envelope = await ownerPost(host, "/panel/governance/org-grants/save", saveBody(target, input), ownerEnvelopeSchema);
      if (!envelope.success) {
        return ownerWriteFailure(envelope, "ORG_GRANT_SAVE_FAILED", "The owner could not save the organization grant");
      }
      const data = runtimeJsonObjectSchema.parse(envelope.data);
      const id = savedIdSchema.parse(data).id;
      const base = affected(ORG_GRANT, id, [ORG_GRANT, ORG_UNIT]);
      return {
        kind: "success",
        data,
        affected: data.deleted === true
          ? { ...base, removed: [{ objectType: ORG_GRANT, primaryKey: id }] }
          : base,
      };
    },
  },
  {
    handlerRef: DELETE_ORG_GRANT,
    labelKey: "panels.governance.orgGrant.operations.delete",
    kind: "action",
    binding: { kind: "PlatformOperation", id: DELETE_ORG_GRANT },
    effect: "write",
    batch: false,
    targetType: ORG_GRANT,
    targetSchema: objectTarget(ORG_GRANT),
    inputSchema: emptyInputSchema,
    resultSchema: emptyResultSchema,
    targetInput: "grant",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/org-grants/record", "ORG_GRANT_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.orgGrant.deleted", { name }),
    inspectImpact: simpleTargetImpact(
      `${DELETE_ORG_GRANT}.inspect-impact`,
      "panels.confirmation.deleteOrgGrantImpact",
      "/panel/governance/org-grants/record",
      "ORG_GRANT_UNAVAILABLE",
    ),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected organization grant");
      const envelope = await ownerPost(host, "/panel/governance/org-grants/delete", { id: target.primaryKey }, ownerEnvelopeSchema);
      if (!envelope.success) {
        return ownerWriteFailure(envelope, "ORG_GRANT_DELETE_FAILED", "The owner could not delete the organization grant");
      }
      return {
        kind: "success",
        data: {},
        affected: {
          ...affected(ORG_GRANT, target.primaryKey, [ORG_GRANT, ORG_UNIT]),
          removed: [{ objectType: ORG_GRANT, primaryKey: target.primaryKey }],
        },
      };
    },
  },
] satisfies readonly PanelServerOperation[];
