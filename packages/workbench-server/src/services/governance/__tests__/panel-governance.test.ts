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
  platformObjectTypes,
} from "@ontomato/contracts/platform-object-types";
import { config } from "../../../config/application";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { platformTypeEntries } from "../../product-panels/type-table";
import { registeredPanelOperation, type PanelOperationHost, type PanelServerOperation } from "../../product-panels/server-operations";
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
      if (path === "/panel/governance/org-units/form") {
        return {
          success: true,
          data: {
            fields: [],
            values: { parentId: "org-root" },
            errors: [],
            save: { method: "POST", path: "/panel/governance/org-units/save", bodySchema: { type: "object" }, draftOperation: "orgUnit.create" },
          },
        };
      }
      if (path === "/panel/governance/policies/api-permissions") {
        return {
          success: true,
          data: { primaryKey: "p-1", label: "Analyst", fields: { totalCount: 3 } },
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

    const apiPerms = await adapter.policies.apiPermissions("p-1", "query");
    expect(apiPerms.fields.totalCount).toBe(3);
    expect(requests[2]).toEqual({
      path: "/panel/governance/policies/api-permissions",
      body: { id: "p-1", search: "query" },
    });

    await expect(adapter.users.record("missing")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
      message: "Member not found",
    });
  });
});

describe("governance panel server operations", () => {
  it("handles user edit save, structured field refusal, add member, and API key revoke", async () => {
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
      if (path === "/api/data-query/panel/governance/users/add-member") {
        return Response.json({ success: true, data: { id: "u-3" } });
      }
      if (path === "/api/data-query/panel/governance/users/revoke-api-key") {
        return Response.json({ success: true, data: { id: "u-2" } });
      }
      return Response.json({ success: true, data: { id: "u-2" } });
    });

    const userTarget = { kind: "object" as const, objectType: USER, primaryKey: "u-2" };
    const invalid = await save.execute(host, userTarget, { values: { loginCode: "" } }, "intent-1");
    expect(invalid).toEqual({
      kind: "refusal",
      code: "USER_INVALID",
      message: "Login code is required",
      errors: [{ field: "/loginCode", code: "required", message: "Login code is required" }],
    });

    const updated = await save.execute(host, userTarget, { values: { loginCode: "bob" } }, "intent-2");
    expect(updated).toMatchObject({
      kind: "success",
      data: { id: "u-2" },
      affected: { objects: [{ objectType: USER, primaryKey: "u-2" }], objectTypes: [USER, ROLE] },
    });

    const added = await untargetedActionOp(ADD_USER_MEMBER).execute(host, null, { loginCode: "carol", roleIds: ["r-1"] }, "intent-4");
    expect(added).toMatchObject({
      kind: "success",
      data: { id: "u-3" },
      affected: { objects: [{ objectType: USER, primaryKey: "u-3" }], objectTypes: [USER, ROLE] },
    });

    const revoked = await targetedActionOp(REVOKE_USER_API_KEY).execute(
      host,
      userTarget,
      {},
      "intent-6",
    );
    expect(revoked).toMatchObject({ kind: "success", data: { id: "u-2" } });
    expect(sent.map(item => item.path)).toContain("/api/data-query/panel/governance/users/revoke-api-key");
  });

  it("handles policy permission mutations and organization membership/grant mutations", async () => {
    const { host } = hostWith((path) => {
      if (path === "/api/data-query/panel/governance/policies/menu-permissions/save") {
        return Response.json({ success: true, data: { id: "p-1", count: 4 } });
      }
      if (path === "/api/data-query/panel/governance/policies/api-permissions/save") {
        return Response.json({ success: true, data: { id: "p-1", count: 10 } });
      }
      if (path === "/api/data-query/panel/governance/policies/api-catalog/refresh") {
        return Response.json({ success: true, data: { refreshed: true } });
      }
      if (path === "/api/data-query/panel/governance/policies/data-permissions/save") {
        return Response.json({ success: true, data: { id: "p-1", savedRuleCount: 2 } });
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
    expect(await targetedActionOp(SAVE_POLICY_MENU_PERMISSIONS).execute(host, policyTarget, { menuIds: ["m1"] }, "intent-1")).toMatchObject({
      kind: "success",
      data: { id: "p-1", count: 4 },
    });
    expect(await targetedActionOp(SAVE_POLICY_API_PERMISSIONS).execute(host, policyTarget, { apiIds: ["a1"] }, "intent-2")).toMatchObject({
      kind: "success",
      data: { id: "p-1", count: 10 },
    });
    expect(await untargetedActionOp(REFRESH_POLICY_API_CATALOG).execute(host, null, {}, "intent-3")).toMatchObject({
      kind: "success",
      data: { refreshed: true },
    });
    expect(await targetedActionOp(SAVE_POLICY_DATA_PERMISSIONS).execute(host, policyTarget, {
      items: [{ className: "Order", fieldPermissions: { amount: { readable: true } } }],
    }, "intent-4")).toMatchObject({
      kind: "success",
      data: { id: "p-1", savedRuleCount: 2 },
      affected: { objectTypes: [PERMISSION_POLICY, USER] },
    });

    const removedUser = await targetedActionOp(REMOVE_USER).execute(
      host,
      { kind: "object", objectType: USER, primaryKey: "u-2" },
      {},
      "intent-remove-user",
    );
    expect(removedUser).toMatchObject({
      kind: "success",
      affected: {
        objectTypes: [USER, ROLE, ORG_UNIT, ORG_MEMBERSHIP, ORG_POSITION, ORG_GRANT],
        removed: [{ objectType: USER, primaryKey: "u-2" }],
      },
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
      REVOKE_USER_API_KEY,
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
