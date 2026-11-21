import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { productPanelOperationsReadResponseSchema } from "@ontomato/contracts/panel-host";
import { panelHumanOperationPreparationSchema } from "@ontomato/contracts/panel-agent";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { ensurePanelOperationsSchema } from "../../infrastructure/postgres-migrations/20261118-panel-operations/schema";
import { buildTestAccess } from "../build-test-access";

/*
 * A published business Action run on one customer object from a panel, over the real operation routes and an isolated
 * PostgreSQL schema, with the data engine's Action owner faked at its HTTP surface: the human intent freezes the Action,
 * its code hash and the object; dispatch checks the values through the owner's form and executes the typed parameters;
 * the owner's field errors and coded refusals reach the person in the owner's words; and a changed Action is not run.
 */

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const objectType = "Order";
const actionId = "approve-order";
const use = { applicationId: "app-orders", useId: "orders", operationId: "approve.execute" };
const orderType = { kind: "object", objectType };
const orderRef = { className: objectType, primaryKey: "00123" };
const projection = {
  componentId: "@ontomato/sdk:OperationButton", name: "Approve order", description: "", visibility: "domain", revision: 0,
  inputs: { target: orderType }, outputs: {}, config: {},
  data: {}, operations: { execute: { operation: { kind: "Action", id: actionId }, target: { input: "target" } } },
};
const panel = {
  name: "Orders", description: "", visibility: "domain", revision: 0,
  content: vuePanelContent("approve", "pinned"),
  manifest: {
    state: { order: { type: orderType, default: null } },
    members: {
      approve: { target: { projectionId: "approve" }, inputs: { target: { state: "order" } } },
      pinned: { target: { projectionId: "approve" }, inputs: { target: { literal: orderRef } } },
    },
    commands: {},
  },
};

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const order = { kind: "object", objectType, primaryKey: "00123" };
const stored = () => ({
  id: actionId, name: "Approve order", status: "PUBLISHED", codeHash: owner.codeHash,
  target: { className: objectType, keyParameter: "order_id" },
  function: { name: "approve_order", parameters: [
    { name: "order_id", type: "TYPE_STRING", description: "Order key" },
    { name: "amount", type: "TYPE_NUMBER", description: "Approved amount" },
  ] },
});
const originalHash = "a".repeat(64);
const owner = {
  codeHash: originalHash,
  execute: (): { success: boolean; data?: unknown; code?: string; message?: string } => ({
    success: true, data: { result: "{\"answer\":true}", error: null, spendTime: 3, affects: ["Order", "Payment"], partialQuery: null },
  }),
  forms: [] as unknown[],
  executions: [] as { credential: string | undefined; id: string; param: unknown }[],
};
let server: Server;
let contentRoot: string;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  state.schema = `object_actions_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  await ensurePanelOperationsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "object-actions-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "fixture-service");
  const { panelOperationsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");

  const app = express();
  app.use(express.json());
  const grants = new Set<string>();
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: req.header("tk") === "alice" && grants.has(req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("alice");
    res.json({ ids: [...grants] });
  });
  app.post("/action/queryList", (req, res) => {
    expect(req.header("tk")).toBe("alice");
    expect(req.body).toEqual({ status: "PUBLISHED" });
    res.json({ success: true, data: [stored()] });
  });
  app.get("/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId !== use.applicationId) { next(); return; }
    if (req.header("tk") !== "alice") { res.sendStatus(403); return; }
    res.json({ success: true, data: {
      applicationId: use.applicationId, menu: { groups: [], panelUses: [] },
      use: { id: use.useId, pageKey: "orders", path: `/applications/${use.applicationId}/orders`,
        panelId: "panel-orders", access: { kind: "domain-member" } },
    } });
  });
  app.post("/action/queryById", (req, res) => {
    expect(req.header("tk")).toBe("alice");
    expect(req.body).toEqual({ id: actionId });
    res.json({ success: true, data: stored() });
  });
  app.post("/action/form", (req, res) => {
    expect(req.header("tk")).toBe("alice");
    if (req.body.parameters.order_id === "forbidden-order") {
      res.json({ success: false, code: "ACTION_NOT_GRANTED", message: "Order is outside the reader's scope" });
      return;
    }
    owner.forms.push(req.body);
    const { values } = req.body as { values?: Record<string, string> };
    const fields = ["order_id", "amount"].map(key => ({
      key, label: key, required: false, defaultValue: null, help: null,
      type: "text", multiline: false, placeholder: null, maxLength: 200,
    }));
    const base = { fields, values: { order_id: "00123", amount: values?.amount ?? "" } };
    if (values === undefined) { res.json({ success: true, data: { ...base, errors: [], parameters: null } }); return; }
    if (!values.amount) {
      res.json({ success: true, data: {
        ...base, parameters: null,
        errors: [{ field: "/values/amount", code: "required", message: "amount needs a value" }],
      } });
      return;
    }
    res.json({ success: true, data: { ...base, errors: [], parameters: { order_id: "00123", amount: Number(values.amount) } } });
  });
  app.post("/action/execute", multer().none(), (req, res) => {
    owner.executions.push({ credential: req.header("tk"), id: req.body.id, param: JSON.parse(req.body.param) });
    res.json(owner.execute());
  });
  app.use("/api", (req, _res, next) => {
    const userId = req.header("tk");
    Object.assign(req, { userId, domainId: "domain", token: userId, locale: "en" });
    next();
  }, buildTestAccess, panelOperationsRouter);
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  server = await new Promise<Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const savedProjection = await request("/product-projections/approve", projection, "PUT");
  expect(savedProjection.status, await savedProjection.text()).toBe(200);
  const savedPanel = await request("/product-panels/panel-orders", panel, "PUT");
  expect(savedPanel.status, await savedPanel.text()).toBe(200);
});

beforeEach(() => {
  owner.codeHash = originalHash;
  owner.execute = () => ({
    success: true, data: { result: "{\"answer\":true}", error: null, spendTime: 3, affects: ["Order", "Payment"], partialQuery: null },
  });
  owner.forms = [];
  owner.executions = [];
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
  vi.unstubAllEnvs();
});

function request(path: string, body?: object, method = "POST") {
  return fetch(state.base + "/api" + path, {
    headers: { tk: "alice", "Content-Type": "application/json" },
    ...(body && { method, body: JSON.stringify(body) }),
  });
}

async function intent(values: Record<string, string>) {
  const prepared = await request("/panel-operations/intents", { ...use, call: { target: order, input: { values } } });
  expect(prepared.status, await prepared.clone().text()).toBe(200);
  return panelHumanOperationPreparationSchema.parse(await prepared.json());
}

const dispatch = (intentId: string) => request(`/panel-operations/intents/${intentId}/dispatch`, {});

it("describes and freezes the Action, its code and the object, then runs the owner's typed parameters as the reader", async () => {
  const describe = await request("/product-panels/read", {
    source: { kind: "registered", applicationId: use.applicationId, useId: use.useId },
    memberPath: [{ member: "approve" }], operations: true, inputs: { target: orderRef },
  });
  expect(describe.status).toBe(200);
  const unselected = await request("/product-panels/read", {
    source: { kind: "registered", applicationId: use.applicationId, useId: use.useId },
    memberPath: [{ member: "approve" }], operations: true, inputs: {},
  });
  expect(await unselected.json()).toEqual({ status: "ready", value: {} });
  const described = productPanelOperationsReadResponseSchema.parse(await describe.json());
  expect(described).toMatchObject({ status: "ready", value: { execute: {
    kind: "action", handlerRef: "actions.execute", label: "Approve order", target: { source: "input", input: "target" },
    inputSchema: { properties: { values: { properties: { amount: { type: "string", contentMediaType: "application/json" } } } } },
  } } });

  const prepared = await intent({ amount: "12.5" });
  expect(prepared.confirmation).toEqual({ kind: "none" });
  expect(owner.executions).toEqual([]);
  const stored = await state.pool!.query(`SELECT intent FROM "${state.schema}".panel_operation_intents WHERE id=$1`, [prepared.intentId]);
  expect(stored.rows[0].intent.operation).toMatchObject({
    handlerRef: "actions.execute", action: { actionId, codeHash: originalHash, object: { objectType, primaryKey: "00123" } },
  });

  expect(described.status === "ready" && described.value.execute).toMatchObject({
    inputSchema: stored.rows[0].intent.operation.inputSchema,
  });

  const result = await dispatch(prepared.intentId);
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    kind: "dispatched", intentId: prepared.intentId, outcome: {
      kind: "success", data: { result: "{\"answer\":true}", affects: ["Order", "Payment"] },
      affected: { objects: [{ objectType, primaryKey: "00123" }], objectTypes: ["Order", "Payment"] },
    },
  });
  expect(owner.forms.at(-1)).toEqual({
    id: actionId, parameters: { order_id: "00123" }, readOnlyParameters: ["order_id"], values: { amount: "12.5" },
  });
  expect(owner.executions).toEqual([{ credential: "alice", id: actionId, param: { order_id: "00123", amount: 12.5 } }]);
});

it("answers the owner's field errors as a refusal without executing", async () => {
  const prepared = await intent({});

  const result = await (await dispatch(prepared.intentId)).json();
  expect(result.outcome).toEqual({
    kind: "refusal", code: "ACTION_INPUT_INVALID", message: "amount needs a value",
    errors: [{ field: "/values/amount", code: "required", message: "amount needs a value" }],
  });
  expect(owner.executions).toEqual([]);
});

it("keeps the owner's coded execution refusal in the owner's words", async () => {
  owner.execute = () => ({ success: false, code: "ACTION_PRECONDITION_FAILED", message: "Preconditions are not met: still open" });
  const prepared = await intent({ amount: "12.5" });

  const result = await (await dispatch(prepared.intentId)).json();
  expect(result.outcome).toEqual({
    kind: "refusal", code: "ACTION_PRECONDITION_FAILED", message: "Preconditions are not met: still open",
  });
  expect(owner.executions).toHaveLength(1);
});

it("does not run an Action whose code changed after the person decided", async () => {
  const prepared = await intent({ amount: "12.5" });
  owner.codeHash = "b".repeat(64);

  const result = await dispatch(prepared.intentId);
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ error: { code: "INTENT_CHANGED" } });
  expect(owner.executions).toEqual([]);
});

it("refuses a different target from the member's pinned object before consulting the owner", async () => {
  const response = await request("/panel-operations/intents", {
    ...use, operationId: "pinned.execute",
    call: { target: { ...order, primaryKey: "another-order" }, input: { values: {} } },
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "TARGET_ID_MISMATCH" } });
  expect(owner.forms).toEqual([]);
  expect(owner.executions).toEqual([]);
});

it("rejects a forged member, an undeclared operation and an object refused by its owner", async () => {
  const input = { values: {} };
  const forge = (operationId: string, target = order) => request("/panel-operations/intents", {
    ...use, operationId, call: { target, input },
  });
  const missingMember = await forge("forged.execute");
  expect(missingMember.status).toBe(403);
  expect(await missingMember.json()).toMatchObject({ error: { message: "Panel does not declare member 'forged'" } });
  const missingOperation = await forge("approve.unlisted");
  expect(missingOperation.status).toBe(422);
  expect(await missingOperation.json()).toMatchObject({ error: { code: "OPERATION_UNAVAILABLE",
    message: "The panel member does not declare operation 'approve.unlisted'" } });
  const refusedTarget = await forge(use.operationId, { ...order, primaryKey: "forbidden-order" });
  expect(refusedTarget.status).toBe(403);
  expect(await refusedTarget.json()).toMatchObject({ error: { code: "ACTION_NOT_GRANTED", message: "Order is outside the reader's scope" } });
  expect(owner.executions).toEqual([]);
});
