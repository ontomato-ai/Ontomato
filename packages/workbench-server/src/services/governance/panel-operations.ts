import { z } from "zod";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { PanelOperationOutcome } from "@ontomato/contracts/panel-agent";
import { panelFormTargetSchema } from "@ontomato/contracts/panel-manifest";
import { panelFormSaveInputSchema } from "@ontomato/contracts/panel-projection";
import {
  ADD_ORG_UNIT_MEMBER,
  ADD_ROLE_MEMBERS,
  ADD_ROLE_POLICIES,
  ADD_USER_MEMBER,
  DELETE_ORG_GRANT,
  DELETE_ORG_POSITION,
  DELETE_ORG_UNIT,
  DELETE_PERMISSION_POLICY,
  DELETE_ROLE,
  GENERATE_USER_API_KEY,
  GRANT_MEMBER_ACCESS,
  GRANT_POLICY_ENTRIES,
  INSPECT_MEMBER_ACCESS,
  INSPECT_POLICY_ACCESS,
  ISSUE_USER_API_KEY_BATCH,
  LIST_PENDING_POLICY_GRANTS,
  LIST_PENDING_POLICY_GRANTS_SUMMARY,
  ORG_GRANT,
  ORG_MEMBERSHIP,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  PREVIEW_POLICY_ENTRY_GRANT,
  READ_MEMBER_ACCESS_CONTEXT,
  READ_MEMBER_EFFECTIVE_ACCESS,
  REGENERATE_USER_API_KEY,
  REMOVE_ORG_MEMBERSHIP,
  REMOVE_ROLE_MEMBERS,
  REMOVE_ROLE_POLICIES,
  REMOVE_USER,
  RESET_USER_PASSWORD,
  RESOLVE_PENDING_POLICY_GRANT,
  REVOKE_USER_API_KEY,
  ROLE,
  SET_ORG_MEMBERSHIP_LOCKED,
  USER,
} from "@ontomato/contracts/platform-object-types";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import type {
  PanelBatchCalls,
  PanelImpactInspector,
  PanelOperationHost,
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
import { readMemberAccessContext, readMemberEffectiveAccess } from "./panel-reads";
import {
  grantMemberAccessInputSchema,
  grantPolicyEntries,
  grantPolicyEntriesInputSchema,
  grantPolicyEntriesResultSchema,
  inspectMemberAccessInputSchema,
  inspectPolicyAccessInputSchema,
  inspectPolicyAccessPayload,
  listPendingPolicyGrantsPayload,
  memberAccessContextInputSchema,
  previewEntryGrantPayload,
  previewPolicyEntryGrantInputSchema,
  resolvePendingPolicyGrants,
  resolvePendingPolicyGrantsInputSchema,
  resolvePendingPolicyGrantsResultSchema,
} from "./policy-access";

/*
 * Enterprise governance owners as panel server operations: form saves, destructive/impactful actions with confirmation
 * inspection, permission-matrix writes, and organization membership/position/grant mutations. Every write posts through
 * the data-query governance owner, preserving coded refusals, field errors, and unavailability reasons in the caller's
 * locale.
 */


const recordLabelSchema = z.object({ label: z.string().min(1) }).passthrough();
const saveInputSchema = panelFormSaveInputSchema.omit({ revision: true }).strict();
const emptyInputSchema = z.object({}).strict();
const emptyResultSchema = z.object({}).strict();
const jsonReadResultSchema = z.object({ kind: z.literal("json"), value: runtimeJsonObjectSchema });

function policyReadTargetId(target?: { kind: string; primaryKey?: string } | null): string {
  if (!target || target.kind !== "object" || !target.primaryKey) {
    throw new Error("Policy access reads require a selected permission policy");
  }
  return target.primaryKey;
}

function memberReadTargetId(target?: { kind: string; primaryKey?: string } | null): string {
  if (!target || target.kind !== "object" || !target.primaryKey) {
    throw new Error("Member access reads require a selected member");
  }
  return target.primaryKey;
}

async function writePolicyGrants(
  target: PanelOperationTarget,
  write: (policyId: string) => Promise<z.infer<typeof grantPolicyEntriesResultSchema> | z.infer<typeof resolvePendingPolicyGrantsResultSchema>>,
): Promise<SinglePanelOperationOutcome> {
  if (target.kind !== "object") throw new Error("Policy grants require a selected permission policy");
  try {
    const data = await write(target.primaryKey);
    return { kind: "success", data, affected: affected(PERMISSION_POLICY, target.primaryKey, [PERMISSION_POLICY, ROLE, USER]) };
  } catch (error) {
    if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
    return { kind: "refusal", code: error.code ?? "POLICY_GRANT_WRITE_REFUSED", message: error.message };
  }
}

const resetPasswordInputSchema = z.object({
  newPassword: z.string().min(1),
}).strict();

const addUserMemberInputSchema = z.object({
  userId: z.string().min(1).optional(),
  loginCode: z.string().min(1).optional(),
  roleIds: z.array(z.string().min(1)).optional(),
}).strict();

const apiKeyResultSchema = z.object({
  id: z.string().min(1),
  loginCode: z.string(),
  userName: z.string(),
}).strict();
const ownerApiKeyResultSchema = apiKeyResultSchema.extend({ apiKey: z.string().min(1) });

const issueApiKeyBatchInputSchema = z.object({
  scope: z.enum(["all", "selected"]),
  userIds: z.array(z.string().min(1)).optional(),
  regenerate: z.boolean().optional(),
}).strict();

const issueApiKeyBatchResultSchema = z.object({
  issuedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
}).strict();
const ownerApiKeyBatchResultSchema = issueApiKeyBatchResultSchema.extend({
  issuedUserIds: z.array(z.string().min(1)),
  csv: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(1),
    content: z.string(),
  }).strict(),
});

const apiKeyBatchInspectSchema = z.object({
  targetCount: z.number().int().nonnegative(),
  existingKeyCount: z.number().int().nonnegative(),
  overwriteCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
}).strict();

const addOrgUnitMemberInputSchema = z.object({
  userId: z.string().min(1),
}).strict();

const roleMembersInputSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
}).strict();

const rolePoliciesInputSchema = z.object({
  policyIds: z.array(z.string().min(1)).min(1),
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

const pendingSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  policies: z.array(z.object({
    policyId: z.string().min(1),
    policyName: z.string().min(1),
    typeLabel: z.string().min(1).nullish(),
    count: z.number().int().nonnegative(),
  }).strict()),
}).strict();

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

const batchReasonsSchema = z.record(z.string(), z.object({ reason: z.string().nullish() }).passthrough());

async function ownerBatchUnavailable(
  host: Host,
  path: string,
  body: Record<string, unknown>,
  fallbackCode: string,
  targets: readonly { target: PanelRecordTarget; rowKey: string }[],
) {
  const envelope = await ownerPost(host, path, body, ownerEnvelopeSchema);
  if (!envelope.success) {
    const failure = ownerWriteFailure(envelope, fallbackCode, "The owner could not inspect row availability");
    throw new HttpError(422, failure.message, failure.code);
  }
  const rows = batchReasonsSchema.parse(envelope.data);
  const reasons = new Map<string, { reason: string } | undefined>();
  for (const { target, rowKey } of targets) {
    const reason = rows[target.primaryKey]?.reason;
    if (reason) reasons.set(rowKey, { reason });
  }
  return reasons;
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
    const rawPositions = envelope.success && Array.isArray((envelope.data as { positions?: unknown })?.positions)
      ? ((envelope.data as { positions: unknown[] }).positions)
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim())
      : [];
    const separator = host.locale === "zh-CN" || host.locale === "zh-TW" || host.locale === "ja" ? "、" : ", ";
    const summary = rawPositions.length > 0
      ? tForLocale(host.locale, "panels.confirmation.removeOrgMembershipImpact", { positions: rawPositions.join(separator) })
      : tForLocale(host.locale, "panels.confirmation.removeOrgMembershipImpactNoPositions");
    return {
      summary,
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

const issueApiKeyBatchImpact: PanelImpactInspector = {
  handlerRef: `${ISSUE_USER_API_KEY_BATCH}.inspect-impact`,
  async inspect(host, calls) {
    const { scope, userIds, regenerate } = issueApiKeyBatchInputSchema.parse(calls[0]!.input);
    const envelope = await ownerPost(
      host,
      "/panel/governance/users/api-key/batch/inspect",
      { scope, ...(userIds && { userIds }), regenerate: regenerate === true },
      ownerEnvelopeSchema,
    );
    if (!envelope.success) {
      const failure = ownerWriteFailure(envelope, "USER_API_KEY_BATCH_FAILED", "The owner could not inspect batch API key issuance");
      throw new HttpError(422, failure.message, failure.code);
    }
    const counts = apiKeyBatchInspectSchema.parse(envelope.data);
    return {
      summary: tForLocale(host.locale, "panels.confirmation.issueUserApiKeyBatchImpact", counts),
      objects: [],
      total: counts.targetCount,
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

async function writeRoleRelation(
  host: Host,
  path: string,
  target: PanelOperationTarget,
  input: Record<string, unknown>,
  inputSchema: z.ZodType<Record<string, unknown>>,
  failureCode: string,
  fallbackMessage: string,
): Promise<SinglePanelOperationOutcome> {
  if (target.kind !== "object") throw new Error("Role relation writes act on a selected role");
  const ids = inputSchema.parse(input);
  return postAction(
    host,
    path,
    { id: target.primaryKey, ...ids },
    failureCode,
    fallbackMessage,
    data => {
      const parsed = runtimeJsonObjectSchema.parse(data);
      return {
        kind: "success",
        data: parsed,
        affected: affected(ROLE, target.primaryKey, [ROLE, USER, PERMISSION_POLICY]),
      };
    },
  );
}

function roleRelationOperation(options: {
  handlerRef: string;
  labelKey: string;
  path: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  resultSchema: z.ZodType<Record<string, unknown>>;
}) {
  return {
    handlerRef: options.handlerRef,
    labelKey: options.labelKey,
    kind: "action" as const,
    binding: { kind: "PlatformOperation" as const, id: options.handlerRef },
    effect: "write" as const,
    batch: false as const,
    targetType: ROLE,
    targetSchema: objectTarget(ROLE),
    inputSchema: options.inputSchema,
    resultSchema: options.resultSchema,
    targetInput: "role",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/roles/record", "ROLE_UNAVAILABLE"),
    unavailable: (host: Host, target: PanelRecordTarget) =>
      ownerDeleteUnavailable(host, "/panel/governance/roles/assign/unavailable", { id: target.primaryKey }, "ROLE_UNAVAILABLE"),
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return writeRoleRelation(
        host,
        options.path,
        target,
        input,
        options.inputSchema,
        "ROLE_RELATION_WRITE_FAILED",
        "The owner could not update the role assignments",
      );
    },
  };
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

async function removeUser(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
  if (target.kind !== "object") throw new Error("Removing a member acts on a selected user");
  return removeWithAffected(
    host,
    "/panel/governance/users/remove",
    target,
    "USER_REMOVE_FAILED",
    [USER, ROLE, ORG_UNIT, ORG_MEMBERSHIP, ORG_POSITION, ORG_GRANT],
  );
}

function issueUserApiKeyOperation(regenerate: boolean): PanelServerOperation {
  const handlerRef = regenerate ? REGENERATE_USER_API_KEY : GENERATE_USER_API_KEY;
  const labelKey = regenerate
    ? "panels.governance.user.operations.regenerateApiKey"
    : "panels.governance.user.operations.generateApiKey";
  return {
    handlerRef,
    labelKey,
    kind: "action",
    binding: { kind: "PlatformOperation", id: handlerRef },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: emptyInputSchema,
    resultSchema: apiKeyResultSchema,
    targetInput: "user",
    targetLabel: (host, target) => governanceTargetLabel(host, target, "/panel/governance/users/record", "USER_UNAVAILABLE"),
    ...(regenerate && { inspectImpact: simpleTargetImpact(
      `${handlerRef}.inspect-impact`,
      "panels.confirmation.regenerateUserApiKeyImpact",
      "/panel/governance/users/record",
      "USER_UNAVAILABLE",
    ) }),
    unavailable: (host, target: PanelRecordTarget) => ownerDeleteUnavailable(
      host, "/panel/governance/users/api-key/unavailable",
      { id: target.primaryKey, mode: regenerate ? "regenerate" : "generate" }, "USER_UNAVAILABLE",
    ),
    unavailableBatch: (host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) => ownerBatchUnavailable(
      host,
      "/panel/governance/users/api-key/rows/unavailable",
      { ids: targets.map(({ target }) => target.primaryKey), mode: regenerate ? "regenerate" : "generate" },
      "USER_UNAVAILABLE",
      targets,
    ),
    async execute(host, target) {
      const { primaryKey } = target as PanelRecordTarget;
      return postAction(
        host,
        regenerate ? "/panel/governance/users/regenerate-api-key" : "/panel/governance/users/generate-api-key",
        { id: primaryKey },
        "USER_API_KEY_FAILED",
        "The owner could not issue the API key",
        data => {
          const { apiKey, ...member } = ownerApiKeyResultSchema.parse(data);
          const summaryKey = regenerate ? "panels.governance.user.apiKeyRegenerated" : "panels.governance.user.apiKeyGenerated";
          return {
            kind: "success",
            data: member,
            affected: affected(USER, primaryKey, [USER]),
            secret: {
              title: tForLocale(host.locale, labelKey),
              summary: tForLocale(host.locale, summaryKey, { name: member.loginCode }),
              items: [{
                label: tForLocale(host.locale, "panels.governance.user.apiKeyLabel"),
                value: apiKey,
                hint: tForLocale(host.locale, "panels.governance.user.apiKeyHint"),
              }],
            },
          };
        },
      );
    },
  };
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
    targetSchema: saveTarget(USER),
    inputSchema: saveInputSchema,
    resultSchema: savedIdSchema,
    secretFields: ["/loginPasswd"],
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,
    create: true,
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/panel/governance/users/save", target, saveBody(target, input), "USER_SAVE_FAILED", USER, [USER, ROLE]);
    },
  },
  {
    handlerRef: REMOVE_USER,
    labelKey: "panels.governance.user.operations.remove",
    kind: "action",
    binding: { kind: "PlatformOperation", id: REMOVE_USER },
    effect: "write",
    batch: true,
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/users/remove/batch/unavailable",
        { ids: targets.map(({ target }) => target.primaryKey) },
        "USER_UNAVAILABLE",
        targets,
      ),
    execute: removeUser,
    async executeBatch(host: Host, calls: readonly PanelBatchCalls[number][]): Promise<PanelOperationOutcome> {
      const items = await Promise.all(calls.map(async ({ target }) => ({
        target: { objectType: target.objectType, primaryKey: target.primaryKey },
        outcome: await removeUser(host, target).catch((error: unknown) => ({
          kind: "unknown" as const, message: error instanceof Error ? error.message : String(error),
        })),
      })));
      const [first, ...rest] = items;
      return { kind: "batch", items: [first!, ...rest] };
    },
  },
  {
    handlerRef: RESET_USER_PASSWORD,
    labelKey: "panels.governance.user.operations.resetPassword",
    kind: "action",
    binding: { kind: "PlatformOperation", id: RESET_USER_PASSWORD },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: resetPasswordInputSchema,
    secretFields: ["/newPassword"],
    describeInputSchema: (_host, locale) => ({
      type: "object",
      properties: {
        newPassword: {
          type: "string",
          minLength: 1,
          format: "password",
          "x-secret": true,
          title: tForLocale(locale, "panels.governance.user.newPassword.title"),
          description: tForLocale(locale, "panels.governance.user.newPassword.description"),
        },
      },
      required: ["newPassword"],
      additionalProperties: false,
    }),
    resultSchema: savedIdSchema,
    targetInput: "user",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/users/record", "USER_UNAVAILABLE"),
    done: (host, name) => tForLocale(host.locale, "panels.governance.user.passwordReset", { name }),
    async execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { primaryKey } = target as PanelRecordTarget;
      const { newPassword } = resetPasswordInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/users/reset-password",
        { id: primaryKey, newPassword },
        "USER_RESET_PASSWORD_FAILED",
        "The owner could not reset the user password",
        data => ({ kind: "success", data: { id: savedIdSchema.parse(data).id }, affected: affected(USER, primaryKey, [USER]) }),
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
  issueUserApiKeyOperation(false),
  issueUserApiKeyOperation(true),
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/users/api-key/rows/unavailable",
        { ids: targets.map(({ target }) => target.primaryKey), mode: "revoke" },
        "USER_UNAVAILABLE",
        targets,
      ),
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
  {
    handlerRef: ISSUE_USER_API_KEY_BATCH,
    labelKey: "panels.governance.user.operations.issueApiKeyBatch",
    kind: "action",
    binding: { kind: "PlatformOperation", id: ISSUE_USER_API_KEY_BATCH },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: z.null(),
    inputSchema: issueApiKeyBatchInputSchema,
    resultSchema: issueApiKeyBatchResultSchema,
    inspectImpact: issueApiKeyBatchImpact,
    unavailable: (host: Host) =>
      ownerDeleteUnavailable(host, "/panel/governance/users/api-key/batch/unavailable", {}, "USER_UNAVAILABLE"),
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { scope, userIds, regenerate } = issueApiKeyBatchInputSchema.parse(input);
      return postAction(
        host,
        "/panel/governance/users/issue-api-key-batch",
        { scope, ...(userIds && { userIds }), regenerate: regenerate === true },
        "USER_API_KEY_BATCH_FAILED",
        "The owner could not issue batch API keys",
        data => {
          const { issuedUserIds, csv, ...counts } = ownerApiKeyBatchResultSchema.parse(data);
          return {
            kind: "success",
            data: counts,
            affected: {
              objects: issuedUserIds.map(primaryKey => ({ objectType: USER, primaryKey })),
              objectTypes: [USER],
            },
            secret: {
              title: tForLocale(host.locale, "panels.governance.user.operations.issueApiKeyBatch"),
              summary: tForLocale(host.locale, "panels.governance.user.apiKeysIssued", counts),
              download: { ...csv, encoding: "utf8" },
            },
          };
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // platform:User — checking and filling one member's access
  // -------------------------------------------------------------------------
  {
    handlerRef: READ_MEMBER_ACCESS_CONTEXT,
    labelKey: "panels.governance.user.operations.accessContext",
    kind: "action",
    binding: { kind: "PlatformOperation", id: READ_MEMBER_ACCESS_CONTEXT },
    effect: "read",
    batch: false,
    target: { source: "input", input: "member" },
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: memberAccessContextInputSchema,
    resultSchema: jsonReadResultSchema,
    async execute(host: PanelOperationHost, call) {
      const subjectId = memberReadTargetId(call.target);
      const { inspectingPolicyId } = memberAccessContextInputSchema.parse(call.input);
      return {
        kind: "json" as const,
        value: await readMemberAccessContext(
          host.executor.owner, host.executor.credentials, subjectId, inspectingPolicyId,
        ),
      };
    },
  },
  {
    handlerRef: READ_MEMBER_EFFECTIVE_ACCESS,
    labelKey: "panels.governance.user.operations.effectiveAccess",
    kind: "action",
    binding: { kind: "PlatformOperation", id: READ_MEMBER_EFFECTIVE_ACCESS },
    effect: "read",
    batch: false,
    target: { source: "input", input: "member" },
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: z.object({}).strict(),
    resultSchema: jsonReadResultSchema,
    async execute(host: PanelOperationHost, call) {
      const subjectId = memberReadTargetId(call.target);
      return {
        kind: "json" as const,
        value: await readMemberEffectiveAccess(host.executor.owner, host.executor.credentials, subjectId),
      };
    },
  },
  {
    handlerRef: INSPECT_MEMBER_ACCESS,
    labelKey: "panels.governance.user.operations.inspectAccess",
    kind: "action",
    binding: { kind: "PlatformOperation", id: INSPECT_MEMBER_ACCESS },
    effect: "read",
    batch: false,
    target: { source: "input", input: "member" },
    targetType: USER,
    targetSchema: objectTarget(USER),
    inputSchema: inspectMemberAccessInputSchema,
    resultSchema: jsonReadResultSchema,
    async execute(host: PanelOperationHost, call) {
      const subjectId = memberReadTargetId(call.target);
      const input = inspectMemberAccessInputSchema.parse(call.input);
      return {
        kind: "json" as const,
        value: await inspectPolicyAccessPayload(
          host.executor.credentials, host.executor.owner.domainId, null, { subjectId, ...input },
        ),
      };
    },
  },
  {
    handlerRef: GRANT_MEMBER_ACCESS,
    labelKey: "panels.governance.user.operations.grantAccess",
    kind: "action",
    binding: { kind: "PlatformOperation", id: GRANT_MEMBER_ACCESS },
    effect: "write",
    batch: false,
    targetType: USER,
    targetSchema: z.null(),
    inputSchema: grantMemberAccessInputSchema,
    resultSchema: grantPolicyEntriesResultSchema,
    async execute(host: PanelOperationHost, _target: null, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      const { policyId, entryIds, acceptedObjects } = grantMemberAccessInputSchema.parse(input);
      try {
        const data = await grantPolicyEntries(host.executor.credentials, policyId, { entryIds, acceptedObjects });
        return {
          kind: "success",
          data,
          affected: affected(PERMISSION_POLICY, policyId, [PERMISSION_POLICY, ROLE, USER]),
        };
      } catch (error) {
        if (!(error instanceof HttpError) || error.status < 400 || error.status >= 500) throw error;
        return { kind: "refusal", code: error.code ?? "POLICY_GRANT_WRITE_REFUSED", message: error.message };
      }
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
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/panel/governance/roles/save", target, saveBody(target, input), "ROLE_SAVE_FAILED", ROLE, [ROLE, USER, ORG_GRANT]);
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/roles/delete/batch/unavailable",
        { ids: targets.map(({ target }) => target.primaryKey) },
        "ROLE_UNAVAILABLE",
        targets,
      ),
    async execute(host: Host, target: PanelOperationTarget): Promise<SinglePanelOperationOutcome> {
      if (target.kind !== "object") throw new Error("Delete acts on a selected role");
      return removeWithAffected(host, "/panel/governance/roles/delete", target, "ROLE_DELETE_FAILED", [ROLE, USER, ORG_GRANT]);
    },
  },

  roleRelationOperation({
    handlerRef: ADD_ROLE_MEMBERS,
    labelKey: "panels.governance.role.operations.addMembers",
    path: "/panel/governance/roles/add-members",
    inputSchema: roleMembersInputSchema,
    resultSchema: savedIdSchema,
  }),
  roleRelationOperation({
    handlerRef: REMOVE_ROLE_MEMBERS,
    labelKey: "panels.governance.role.operations.removeMembers",
    path: "/panel/governance/roles/remove-members",
    inputSchema: roleMembersInputSchema,
    resultSchema: savedIdSchema,
  }),
  roleRelationOperation({
    handlerRef: ADD_ROLE_POLICIES,
    labelKey: "panels.governance.role.operations.addPolicies",
    path: "/panel/governance/roles/add-policies",
    inputSchema: rolePoliciesInputSchema,
    resultSchema: savedIdSchema,
  }),
  roleRelationOperation({
    handlerRef: REMOVE_ROLE_POLICIES,
    labelKey: "panels.governance.role.operations.removePolicies",
    path: "/panel/governance/roles/remove-policies",
    inputSchema: rolePoliciesInputSchema,
    resultSchema: savedIdSchema,
  }),

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
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(
        host,
        "/panel/governance/policies/save",
        target,
        saveBody(target, input),
        "PERMISSION_POLICY_SAVE_FAILED",
        PERMISSION_POLICY,
        [PERMISSION_POLICY, ROLE, USER],
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/policies/delete/batch/unavailable",
        { ids: targets.map(({ target }) => target.primaryKey) },
        "PERMISSION_POLICY_UNAVAILABLE",
        targets,
      ),
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
    handlerRef: PREVIEW_POLICY_ENTRY_GRANT,
    labelKey: "panels.governance.policy.operations.previewEntryGrant",
    kind: "action",
    binding: { kind: "PlatformOperation", id: PREVIEW_POLICY_ENTRY_GRANT },
    effect: "read",
    batch: false,
    target: { source: "input", input: "policy" },
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: previewPolicyEntryGrantInputSchema,
    resultSchema: jsonReadResultSchema,
    async execute(host: PanelOperationHost, call) {
      const policyId = policyReadTargetId(call.target);
      const { entryIds } = previewPolicyEntryGrantInputSchema.parse(call.input);
      return {
        kind: "json" as const,
        value: await previewEntryGrantPayload(host.executor.credentials, host.executor.owner.domainId, policyId, entryIds),
      };
    },
  },
  {
    handlerRef: GRANT_POLICY_ENTRIES,
    labelKey: "panels.governance.policy.operations.grantEntries",
    kind: "action",
    binding: { kind: "PlatformOperation", id: GRANT_POLICY_ENTRIES },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: grantPolicyEntriesInputSchema,
    resultSchema: grantPolicyEntriesResultSchema,
    targetInput: "policy",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/policies/record", "PERMISSION_POLICY_UNAVAILABLE"),
    execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return writePolicyGrants(target, policyId => grantPolicyEntries(host.executor.credentials, policyId, input));
    },
  },
  {
    handlerRef: LIST_PENDING_POLICY_GRANTS,
    labelKey: "panels.governance.policy.operations.listPending",
    kind: "action",
    binding: { kind: "PlatformOperation", id: LIST_PENDING_POLICY_GRANTS },
    effect: "read",
    batch: false,
    target: { source: "input", input: "policy" },
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: emptyInputSchema,
    resultSchema: jsonReadResultSchema,
    async execute(host: PanelOperationHost, call) {
      const policyId = policyReadTargetId(call.target);
      return {
        kind: "json" as const,
        value: await listPendingPolicyGrantsPayload(host.executor.credentials, host.executor.owner.domainId, policyId),
      };
    },
  },
  {
    handlerRef: LIST_PENDING_POLICY_GRANTS_SUMMARY,
    labelKey: "panels.governance.policy.operations.listPendingSummary",
    kind: "action",
    binding: { kind: "PlatformOperation", id: LIST_PENDING_POLICY_GRANTS_SUMMARY },
    effect: "read",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: panelFormTargetSchema.optional(),
    target: { source: "none" },
    inputSchema: emptyInputSchema,
    resultSchema: jsonReadResultSchema,
    async execute(host: Host) {
      const envelope = await ownerPost(host, "/panel/governance/policies/pending/summary", {}, ownerEnvelopeSchema);
      if (!envelope.success) {
        throw new HttpError(422, envelope.message ?? "The owner could not list pending grants",
          "PERMISSION_POLICY_PENDING_UNAVAILABLE");
      }
      return { kind: "json" as const, value: pendingSummarySchema.parse(envelope.data) };
    },
  },
  {
    handlerRef: RESOLVE_PENDING_POLICY_GRANT,
    labelKey: "panels.governance.policy.operations.resolvePending",
    kind: "action",
    binding: { kind: "PlatformOperation", id: RESOLVE_PENDING_POLICY_GRANT },
    effect: "write",
    batch: false,
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: resolvePendingPolicyGrantsInputSchema,
    resultSchema: resolvePendingPolicyGrantsResultSchema,
    targetInput: "policy",
    targetLabel: (host: Host, target: PanelRecordTarget) =>
      governanceTargetLabel(host, target, "/panel/governance/policies/record", "PERMISSION_POLICY_UNAVAILABLE"),
    execute(host: PanelOperationHost, target: PanelOperationTarget, input: Record<string, unknown>) {
      return writePolicyGrants(target, policyId => resolvePendingPolicyGrants(host.executor.credentials, policyId, input));
    },
  },
  {
    handlerRef: INSPECT_POLICY_ACCESS,
    labelKey: "panels.governance.policy.operations.inspectAccess",
    kind: "action",
    binding: { kind: "PlatformOperation", id: INSPECT_POLICY_ACCESS },
    effect: "read",
    batch: false,
    target: { source: "input", input: "policy" },
    targetType: PERMISSION_POLICY,
    targetSchema: objectTarget(PERMISSION_POLICY),
    inputSchema: inspectPolicyAccessInputSchema,
    resultSchema: jsonReadResultSchema,
    async execute(host: PanelOperationHost, call) {
      const policyId = policyReadTargetId(call.target);
      const input = inspectPolicyAccessInputSchema.parse(call.input);
      return {
        kind: "json" as const,
        value: await inspectPolicyAccessPayload(host.executor.credentials, host.executor.owner.domainId, policyId, input),
      };
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
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(host, "/panel/governance/org-units/save", target, saveBody(target, input), "ORG_UNIT_SAVE_FAILED", ORG_UNIT, [ORG_UNIT]);
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/org-units/delete/batch/inspect",
        { ids: targets.map(({ target }) => target.primaryKey) },
        "ORG_UNIT_UNAVAILABLE",
        targets,
      ),
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/org-memberships/remove/batch/inspect",
        { ids: targets.map(({ target }) => target.primaryKey) },
        "ORG_MEMBERSHIP_UNAVAILABLE",
        targets,
      ),
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
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

    create: true,
    execute(host: Host, target: PanelOperationTarget, input: Record<string, unknown>): Promise<SinglePanelOperationOutcome> {
      return save(
        host,
        "/panel/governance/org-positions/save",
        target,
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
    unavailableBatch: (host: Host, targets: readonly { target: PanelRecordTarget; rowKey: string }[]) =>
      ownerBatchUnavailable(
        host,
        "/panel/governance/org-positions/delete/batch/inspect",
        { ids: targets.map(({ target }) => target.primaryKey) },
        "ORG_POSITION_UNAVAILABLE",
        targets,
      ),
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
    draftInput: (input: Record<string, unknown>) => saveInputSchema.parse(input).values,

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
