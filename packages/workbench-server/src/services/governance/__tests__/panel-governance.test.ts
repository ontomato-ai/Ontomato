import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../assistant/skills", () => ({}));
import {
  ADD_ORG_UNIT_MEMBER,
  ADD_USER_MEMBER,
  DELETE_ORG_GRANT,
  DELETE_ORG_POSITION,
  DELETE_ORG_UNIT,
  DELETE_PERMISSION_POLICY,
  DELETE_ROLE,
  GENERATE_USER_API_KEY,
  ISSUE_USER_API_KEY_BATCH,
  ORG_GRANT,
  ORG_MEMBERSHIP,
  ORG_POSITION,
  ORG_UNIT,
  PERMISSION_POLICY,
  REFRESH_POLICY_API_CATALOG,
  REGENERATE_USER_API_KEY,
  REMOVE_ORG_MEMBERSHIP,
  REMOVE_USER,
  RESET_USER_PASSWORD,
  REVOKE_USER_API_KEY,
  ROLE,
  SET_ORG_MEMBERSHIP_LOCKED,
  USER,
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { withoutPanelSecretDelivery } from "@ontomato/contracts/panel-agent";
import { panelSchemaSecretPaths, splitPanelSecrets } from "@ontomato/contracts/panel-secrets";
import { config } from "../../../config/application";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { platformTypeEntries } from "../../product-panels/type-table";
import { describeServerOperation, registeredPanelOperation, type PanelOperationHost, type PanelServerOperation } from "../../product-panels/server-operations";
import { governanceServerOperations } from "../panel-operations";
import { createGovernanceReadAdapters } from "../panel-reads";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

const GOVERNANCE_TYPES = [
  USER,
  ROLE,
  PERMISSION_POLICY,
  ORG_UNIT,
  ORG_MEMBERSHIP,
  ORG_POSITION,
  ORG_GRANT,
] as const;

const originalDataQueryBaseUrl = config.dataQuery.baseUrl;
const servers: http.Server[] = [];

afterEach(async () => {
  config.dataQuery.baseUrl = originalDataQueryBaseUrl;
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function startBackend(handler: (path: string, body: Record<string, unknown>) => unknown) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const path = req.url ?? "";
    requests.push({ path, body });
    const payload = handler(path, body);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  config.dataQuery.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { requests };
}

const ops: readonly PanelServerOperation[] = governanceServerOperations;
const formSaveOp = (handlerRef: string) =>
  ops.find(
    (item): item is Extract<PanelServerOperation, { effect: "write"; kind: "form.save" }> =>
      item.effect === "write" && item.kind === "form.save" && item.handlerRef === handlerRef,
  )!;
const targetedActionOp = (handlerRef: string) =>
  ops.find(
    (item): item is Extract<PanelServerOperation, { effect: "write"; kind: "action"; batch: false; targetInput: string }> =>
      item.effect === "write" && item.kind === "action" && item.batch === false && typeof item.targetInput === "string" && item.handlerRef === handlerRef,
  )!;
const untargetedActionOp = (handlerRef: string) =>
  ops.find(
    (item): item is Extract<PanelServerOperation, { effect: "write"; kind: "action"; batch: false; targetInput?: undefined }> =>
      item.effect === "write" && item.kind === "action" && item.batch === false && item.targetInput === undefined && item.handlerRef === handlerRef,
  )!;
const anyWriteOp = (handlerRef: string) =>
  ops.find(
    (item): item is Extract<PanelServerOperation, { effect: "write" }> =>
      item.effect === "write" && item.handlerRef === handlerRef,
  )!;

function hostWith(answer: (path: string, body: Record<string, unknown>) => Response) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const actor = { owner: { domainId: "d1", userId: "u-admin" }, credentials: { token: "tok", locale: "en" } };
  const host: PanelOperationHost = {
    initiator: actor,
    executor: actor,
    async request(path, init) {
      const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      sent.push({ path, body });
      return answer(path, body);
    },
    async requestWorkbench() {
      throw new Error("Governance owners call the ontology backend, not workbench");
    },
  };
  return { host, sent };
}

describe("governance platform type declarations and registry", () => {
  it("registers every declared operation for all seven governance types with valid English copy keys", () => {
    const entries = platformTypeEntries();
    for (const typeId of GOVERNANCE_TYPES) {
      const decl = platformObjectTypes[typeId];
      expect(decl).toBeDefined();
      const entry = entries.get(typeId);
      expect(entry).toBeDefined();
      const declaredOps = decl.operations ?? [];
      expect(declaredOps.length).toBeGreaterThan(0);
      expect(entry?.operations?.map(op => op.id)).toEqual(declaredOps);
      for (const opId of declaredOps) {
        const reg = registeredPanelOperation(opId);
        expect(reg, `operation ${opId} should be registered`).toBeDefined();
      }
    }
    for (const op of governanceServerOperations) {
      if (op.effect === "write") {
        expect(en[op.labelKey as keyof typeof en], `missing en locale key ${op.labelKey}`).toBeTruthy();
      }
    }
  });
});

describe("governance panel read adapter", () => {
  it("routes user, role, policy, and organization reads to the Java governance owner endpoints", async () => {
    const { requests } = await startBackend((path) => {
      if (path === "/panel/governance/users/query") {
        return {
          success: true,
          data: {
            rows: [{ primaryKey: "u-1", label: "Alice", fields: { loginCode: "alice" } }],
            total: 1,
          },
        };
      }
      if (path === "/panel/governance/users/form") {
        return {
          success: true,
          data: {
            fields: [], values: {}, errors: [],
            save: { method: "POST", path: "/panel/governance/users/save", bodySchema: { type: "object" } },
          },
        };
      }
      if (path === "/panel/governance/org-units/form") {
        return {
          success: true,
          data: {
            fields: [],
            values: { parentId: "org-root" },
            errors: [],
            save: { method: "POST", path: "/panel/governance/org-units/save", bodySchema: { type: "object" } },
          },
        };
      }
      if (path === "/panel/governance/policies/form") {
        return {
          success: true,
          data: {
            fields: [],
            values: { postName: "Draft", menuIds: ["m1"], apiIds: ["a1"] },
            errors: [],
            save: { method: "POST", path: "/panel/governance/policies/save", bodySchema: { type: "object" } },
          },
        };
      }
      if (path === "/panel/governance/users/record") {
        return {
          success: false,
          code: "USER_NOT_FOUND",
          message: "Member not found",
        };
      }
      return { success: true, data: [] };
    });

    const adapter = createGovernanceReadAdapters({ token: "tok", locale: "en" });

    const page = await adapter.users.query({ search: "ali", page: { number: 2, size: 15 } });
    expect(page.total).toBe(1);
    expect(page.rows[0]?.primaryKey).toBe("u-1");
    expect(requests[0]).toEqual({
      path: "/panel/governance/users/query",
      body: { search: "ali", pageNum: 2, pageSize: 15 },
    });

    const createForm = await adapter.orgUnits.createForm({ parentId: "org-root" });
    expect(createForm.values).toEqual({ parentId: "org-root" });
    expect(requests[1]).toEqual({
      path: "/panel/governance/org-units/form",
      body: { parentId: "org-root", changedField: null },
    });

    const values = { postName: "Draft", menuIds: ["m1"], apiIds: ["a1"] };
    const policyForm = await adapter.policies.form("p-1", { values });
    expect(policyForm.values).toEqual(values);
    expect(requests[2]).toEqual({
      path: "/panel/governance/policies/form",
      body: { id: "p-1", values, changedField: null },
    });

    await expect(adapter.users.record("missing")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
      message: "Member not found",
    });

    await adapter.users.createForm({});
    expect(requests).toContainEqual({
      path: "/panel/governance/users/form",
      body: { changedField: null },
    });
  });
});

describe("governance panel server operations", () => {
  it.each([ROLE, PERMISSION_POLICY, ORG_UNIT, ORG_POSITION])("reports the identity of a newly created %s", async objectType => {
    const primaryKey = "owner-created";
    const { host } = hostWith(() => Response.json({ success: true, data: { id: primaryKey } }));
    const outcome = await formSaveOp(`${objectType}.save`).execute(host, { kind: "draft" }, { values: { name: "New record" } }, "intent-1");
    expect(outcome).toMatchObject({ kind: "success", created: { objectType, primaryKey } });
  });

  it("declares password inputs as secrets and displays a masked reset input", async () => {
    const { host } = hostWith(() => Response.json({}));
    expect(registeredPanelOperation(`${USER}.save`)?.declaration.secretFields).toEqual(["/loginPasswd"]);
    const reset = await describeServerOperation(targetedActionOp(RESET_USER_PASSWORD), host);
    expect(reset.secretFields).toEqual(["/newPassword"]);
    expect(panelSchemaSecretPaths(reset.inputSchema)).toEqual(["/newPassword"]);
    expect(splitPanelSecrets({ newPassword: "FixturePassword!" }, reset.secretFields!).redacted).toEqual({});
  });

  it("handles user save, structured field refusal, reset password, add member, and API key lifecycle", async () => {
    const save = formSaveOp(`${USER}.save`);
    const { host, sent } = hostWith((path, body) => {
      if (path === "/api/data-query/panel/governance/users/save" && body.loginCode === "") {
        return Response.json({
          success: false,
          code: "USER_INVALID",
          message: "Login code is required",
          errors: [{ field: "/loginCode", code: "required", message: "Login code is required" }],
        });
      }
      if (path === "/api/data-query/panel/governance/users/save") {
        return Response.json({ success: true, data: { id: "u-2" } });
      }
      if (path === "/api/data-query/panel/governance/users/reset-password") {
        return Response.json({ success: true, data: { id: "u-2" } });
      }
      if (path === "/api/data-query/panel/governance/users/add-member") {
        return Response.json({ success: true, data: { id: "u-3" } });
      }
      if (path === "/api/data-query/panel/governance/users/generate-api-key"
        || path === "/api/data-query/panel/governance/users/regenerate-api-key") {
        return Response.json({
          success: true,
          data: { id: "u-2", loginCode: "bob", userName: "Bob", apiKey: "otm_secret" },
        });
      }
      if (path === "/api/data-query/panel/governance/users/revoke-api-key") {
        return Response.json({ success: true, data: { id: "u-2" } });
      }
      if (path === "/api/data-query/panel/governance/users/issue-api-key-batch") {
        return Response.json({
          success: true,
          data: {
            issuedCount: 1,
            skippedCount: 1,
            issuedUserIds: ["u-1"],
            csv: { filename: "api-keys-d1.csv", contentType: "text/csv;charset=utf-8", content: "loginCode,apiKey\nalice,otm_1\nbob," },
          },
        });
      }
      return Response.json({ success: true, data: { id: "u-2" } });
    });

    const invalid = await save.execute(host, { kind: "draft" }, { values: { loginCode: "" } }, "intent-1");
    expect(invalid).toEqual({
      kind: "refusal",
      code: "USER_INVALID",
      message: "Login code is required",
      errors: [{ field: "/loginCode", code: "required", message: "Login code is required" }],
    });

    const created = await save.execute(host, { kind: "draft" }, {
      values: { loginCode: "bob", userName: "Bob", loginPasswd: "FixturePassword!" },
      submittedFields: ["/loginCode", "/userName", "/loginPasswd"],
    }, "intent-2");
    expect(created).toMatchObject({
      kind: "success",
      data: { id: "u-2" },
      created: { objectType: USER, primaryKey: "u-2" },
      affected: { objects: [{ objectType: USER, primaryKey: "u-2" }], objectTypes: [USER, ROLE] },
    });

    expect(sent).toContainEqual({
      path: "/api/data-query/panel/governance/users/save",
      body: {
        loginCode: "bob", userName: "Bob", loginPasswd: "FixturePassword!",
        submittedFields: ["/loginCode", "/userName", "/loginPasswd"],
      },
    });

    const reset = await targetedActionOp(RESET_USER_PASSWORD).execute(
      host,
      { kind: "object", objectType: USER, primaryKey: "u-2" },
      { newPassword: "NewPassword123!" },
      "intent-3",
    );
    expect(reset).toEqual({
      kind: "success",
      data: { id: "u-2" },
      affected: { objects: [{ objectType: USER, primaryKey: "u-2" }], objectTypes: [USER] },
    });
    expect(sent).toContainEqual({
      path: "/api/data-query/panel/governance/users/reset-password",
      body: { id: "u-2", newPassword: "NewPassword123!" },
    });

    const added = await untargetedActionOp(ADD_USER_MEMBER).execute(host, null, { loginCode: "carol", roleIds: ["r-1"] }, "intent-4");
    expect(added).toMatchObject({
      kind: "success",
      data: { id: "u-3" },
      affected: { objects: [{ objectType: USER, primaryKey: "u-3" }], objectTypes: [USER, ROLE] },
    });

    for (const operation of [GENERATE_USER_API_KEY, REGENERATE_USER_API_KEY]) {
      const outcome = await targetedActionOp(operation).execute(
        host, { kind: "object", objectType: USER, primaryKey: "u-2" }, {}, "intent-5",
      );
      expect(outcome).toMatchObject({
        kind: "success",
        data: { id: "u-2", loginCode: "bob", userName: "Bob" },
        secret: { items: [{ label: "API key", value: "otm_secret", hint: expect.any(String) }] },
      });
      const receipt = withoutPanelSecretDelivery(outcome);
      expect(receipt).toMatchObject({ kind: "success", secretGenerated: true, message: expect.any(String) });
      expect(receipt).not.toHaveProperty("secret");
      expect(JSON.stringify(receipt)).not.toContain("otm_secret");
    }

    const revoked = await targetedActionOp(REVOKE_USER_API_KEY).execute(
      host,
      { kind: "object", objectType: USER, primaryKey: "u-2" },
      {},
      "intent-6",
    );
    expect(revoked).toMatchObject({ kind: "success", data: { id: "u-2" } });

    const batch = await untargetedActionOp(ISSUE_USER_API_KEY_BATCH).execute(host, null, {
      scope: "selected",
      userIds: ["u-1", "u-2"],
      regenerate: false,
    }, "intent-7");
    expect(batch).toMatchObject({
      kind: "success",
      data: { issuedCount: 1, skippedCount: 1 },
      secret: { download: {
        filename: "api-keys-d1.csv", contentType: "text/csv;charset=utf-8",
        encoding: "utf8", content: expect.stringContaining("alice,otm_1"),
      } },
      affected: {
        objects: [{ objectType: USER, primaryKey: "u-1" }],
        objectTypes: [USER],
      },
    });
    const batchReceipt = withoutPanelSecretDelivery(batch);
    expect(batchReceipt).toMatchObject({ kind: "success", secretGenerated: true, message: expect.any(String) });
    expect(batchReceipt).not.toHaveProperty("secret");
    expect(JSON.stringify(batchReceipt)).not.toContain("otm_1");

    const { host: nonAdminHost } = hostWith(path => {
      if (path === "/api/data-query/panel/governance/users/api-key/batch/unavailable") {
        return Response.json({ success: true, data: { reason: "Domain administrators only" } });
      }
      return Response.json({ success: true, data: {} });
    });
    const batchHandler = registeredPanelOperation(ISSUE_USER_API_KEY_BATCH)!.handler;
    if (batchHandler.effect !== "write") throw new Error("Expected write handler");
    expect(await batchHandler.unavailable?.(nonAdminHost, null)).toEqual({ reason: "Domain administrators only" });
  });

  it("handles policy permission mutations and organization membership/grant mutations", async () => {
    const { host, sent } = hostWith((path, body) => {
      if (path === "/api/data-query/panel/governance/users/remove" && body.id === "u-admin") {
        return Response.json({
          success: false, code: "USER_BUILTIN_ADMIN_PROTECTED", message: "Built-in administrator cannot be removed",
        });
      }
      if (path === "/api/data-query/panel/governance/policies/save") {
        return Response.json({ success: true, data: { id: "p-1" } });
      }
      if (path === "/api/data-query/panel/governance/policies/api-permissions/refresh") {
        return Response.json({ success: true, data: { refreshed: true } });
      }
      if (path === "/api/data-query/panel/governance/org-units/add-member") {
        return Response.json({
          success: true,
          data: { id: "m-1", orgId: "org-1", userId: "u-1", record: { primaryKey: "m-1", label: "Alice", fields: {} } },
        });
      }
      if (path === "/api/data-query/panel/governance/org-memberships/set-locked") {
        return Response.json({
          success: true,
          data: { id: "m-1", orgId: "org-1", userId: "u-1", locked: true, record: { primaryKey: "m-1", label: "Alice", fields: {} } },
        });
      }
      if (path === "/api/data-query/panel/governance/org-grants/save") {
        return Response.json({ success: true, data: { id: "org:org-1", deleted: true } });
      }
      return Response.json({ success: true, data: { id: "ok" } });
    });

    const policyTarget = { kind: "object" as const, objectType: PERMISSION_POLICY, primaryKey: "p-1" };
    const values = { postName: "New name", dataPermissions: { Order: { fieldPermissions: { amount: 1 } } } };
    const submittedFields = ["/postName", "/dataPermissions/Order/fieldPermissions"];
    const savePolicy = anyWriteOp(`${PERMISSION_POLICY}.save`);
    if (savePolicy.kind !== "form.save") throw new Error("Permission policy must use its owner form");
    expect(await savePolicy.execute(host, policyTarget, {
      values, submittedFields,
    }, "intent-1")).toMatchObject({
      kind: "success",
      data: { id: "p-1" },
      affected: { objectTypes: expect.arrayContaining([PERMISSION_POLICY, ROLE, USER]) },
    });
    expect(await untargetedActionOp(REFRESH_POLICY_API_CATALOG).execute(host, null, {}, "intent-3")).toMatchObject({
      kind: "success",
      data: { refreshed: true },
      affected: { objects: [], objectTypes: [PERMISSION_POLICY] },
    });
    expect(sent).toContainEqual({
      path: "/api/data-query/panel/governance/policies/save",
      body: { ...values, id: "p-1", submittedFields },
    });
    expect(sent).toContainEqual({ path: "/api/data-query/panel/governance/policies/api-permissions/refresh", body: {} });

    const remove = anyWriteOp(REMOVE_USER);
    if (!remove.batch) throw new Error("User removal must support batches");
    const removedUser = { kind: "object", objectType: USER, primaryKey: "u-2" } as const;
    const protectedUser = { kind: "object", objectType: USER, primaryKey: "u-admin" } as const;
    expect(await remove.executeBatch(host, [
      { target: removedUser, input: {} },
      { target: protectedUser, input: {} },
    ], "intent-remove-users")).toMatchObject({
      kind: "batch",
      items: [
        {
          target: { objectType: USER, primaryKey: "u-2" },
          outcome: {
            kind: "success",
            affected: {
              objectTypes: [USER, ROLE, ORG_UNIT, ORG_MEMBERSHIP, ORG_POSITION, ORG_GRANT],
              removed: [{ objectType: USER, primaryKey: "u-2" }],
            },
          },
        },
        {
          target: { objectType: USER, primaryKey: "u-admin" },
          outcome: { kind: "refusal", code: "USER_BUILTIN_ADMIN_PROTECTED" },
        },
      ],
    });

    const deletedRole = await targetedActionOp(DELETE_ROLE).execute(
      host,
      { kind: "object", objectType: ROLE, primaryKey: "r-1" },
      {},
      "intent-delete-role",
    );
    expect(deletedRole).toMatchObject({
      kind: "success",
      affected: {
        objectTypes: [ROLE, USER, ORG_GRANT],
        removed: [{ objectType: ROLE, primaryKey: "r-1" }],
      },
    });

    const deletedPolicy = await targetedActionOp(DELETE_PERMISSION_POLICY).execute(
      host,
      policyTarget,
      {},
      "intent-delete-policy",
    );
    expect(deletedPolicy).toMatchObject({
      kind: "success",
      affected: {
        objectTypes: [PERMISSION_POLICY, ROLE],
        removed: [{ objectType: PERMISSION_POLICY, primaryKey: "p-1" }],
      },
    });

    const deletedOrgUnit = await targetedActionOp(DELETE_ORG_UNIT).execute(
      host,
      { kind: "object", objectType: ORG_UNIT, primaryKey: "org-1" },
      {},
      "intent-delete-org",
    );
    expect(deletedOrgUnit).toMatchObject({
      kind: "success",
      affected: {
        objectTypes: [ORG_UNIT, ORG_MEMBERSHIP, ORG_POSITION, ORG_GRANT],
        removed: [{ objectType: ORG_UNIT, primaryKey: "org-1" }],
      },
    });

    const addOrgMember = await targetedActionOp(ADD_ORG_UNIT_MEMBER).execute(
      host,
      { kind: "object", objectType: ORG_UNIT, primaryKey: "org-1" },
      { userId: "u-1" },
      "intent-5",
    );
    expect(addOrgMember).toMatchObject({
      kind: "success",
      affected: {
        objects: [
          { objectType: ORG_UNIT, primaryKey: "org-1" },
          { objectType: ORG_MEMBERSHIP, primaryKey: "m-1" },
        ],
      },
    });

    const lockMember = await targetedActionOp(SET_ORG_MEMBERSHIP_LOCKED).execute(
      host,
      { kind: "object", objectType: ORG_MEMBERSHIP, primaryKey: "m-1" },
      { locked: true },
      "intent-6",
    );
    expect(lockMember).toMatchObject({ kind: "success", data: { id: "m-1", locked: true } });

    const clearGrant = await formSaveOp(`${ORG_GRANT}.save`).execute(
      host,
      { kind: "object", objectType: ORG_GRANT, primaryKey: "org:org-1" },
      { values: { roleIds: [], scopes: [] } },
      "intent-7",
    );
    expect(clearGrant).toMatchObject({
      kind: "success",
      affected: {
        removed: [{ objectType: ORG_GRANT, primaryKey: "org:org-1" }],
      },
    });

    // Sanity-check destructive operation refs exist
    for (const opRef of [
      REMOVE_USER,
      REGENERATE_USER_API_KEY,
      DELETE_ROLE,
      DELETE_PERMISSION_POLICY,
      DELETE_ORG_UNIT,
      REMOVE_ORG_MEMBERSHIP,
      DELETE_ORG_POSITION,
      DELETE_ORG_GRANT,
    ]) {
      expect(anyWriteOp(opRef)).toBeDefined();
    }
  });
});
