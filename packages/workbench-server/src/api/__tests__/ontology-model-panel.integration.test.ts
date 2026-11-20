import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { panelHumanOperationDispatchResponseSchema, panelHumanOperationPreparationSchema } from "@ontomato/contracts/panel-agent";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import {
  ATTRIBUTE, DELETE_ATTRIBUTE, DELETE_OBJECT_TYPE, OBJECT_TYPE, RELATIONSHIP,
} from "@ontomato/contracts/platform-object-types";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-service" }), publicBasePath: () => "" } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const panelId = "panel-ontology-model";
const use = { kind: "registered", applicationId: "ontology-model", useId: "catalog" } as const;
const resourceIds = new Set<string>();
let server: Server;
let contentRoot: string;

/** The Java owner's model, held the way OntologyModelController answers it. */
type Attribute = { name: string; showName: string; type: string; attrDesc: string; enable: boolean; businessKey: boolean; primaryKey: boolean };
const model = {
  classes: new Map<string, { showName: string; classDesc: string; attrs: Attribute[] }>(),
  relationships: new Map<string, { fromclass: string; toclass: string; desc: string; fromField: string; toField: string }>(),
};
const ownerCalls: string[] = [];
const attribute = (name: string, primaryKey = false): Attribute =>
  ({ name, showName: name.toUpperCase(), type: "varchar", attrDesc: "", enable: true, businessKey: false, primaryKey });

function seed() {
  model.classes.clear();
  model.relationships.clear();
  model.classes.set("warehouse", { showName: "Warehouse", classDesc: "", attrs: [attribute("id", true), attribute("code")] });
  model.classes.set("item", { showName: "", classDesc: "Stock item", attrs: [attribute("id", true), attribute("warehouse_code")] });
  model.relationships.set("contains", { fromclass: "warehouse", toclass: "item", desc: "Contains", fromField: "code", toField: "warehouse_code" });
}

const touching = (className: string) =>
  [...model.relationships].filter(([, rel]) => rel.fromclass === className || rel.toclass === className);
const relationshipView = ([relationship, rel]: [string, typeof model.relationships extends Map<string, infer V> ? V : never]) =>
  ({ relationship, ...rel });
function objectTypeView(className: string) {
  const { showName, classDesc, attrs } = model.classes.get(className)!;
  const keys = attrs.filter(attr => attr.primaryKey);
  return {
    className, showName, classDesc, attributeCount: attrs.length,
    businessKeyCount: attrs.filter(attr => attr.businessKey).length, relationshipCount: touching(className).length,
    primaryKey: keys.length === 1 ? { status: "ok", name: keys[0]!.name } : { status: "missing" },
  };
}
const textField = (pointer: string, label: string, required: boolean) => ({
  path: pointer, label, control: { kind: "text" }, valueSchema: { type: "string" }, required, readOnly: false,
});

function javaOwner(app: express.Express) {
  const reader = (req: express.Request) => {
    expect(req.header("tk")).toBe("model-reader");
    expect(req.header("Accept-Language")).toBe("en");
    ownerCalls.push(`${req.method} ${req.path}${req.query.className ? `?className=${String(req.query.className)}` : ""}`);
  };
  const notFound = (res: express.Response, code: string) => res.status(404).json({ error: { code, message: "Not found" } });
  app.get("/ontology/model/field-labels", (req, res) => {
    reader(req);
    res.json({
      objectType: { className: "API name", primaryKeyName: "Primary key name", showName: "Display name", classDesc: "Description" },
      attribute: { className: "Owner object type", name: "API name", type: "Data type", showName: "Display name", attrDesc: "Description",
        enable: "Enabled", businessKey: "Business key", primaryKey: "Primary key" },
      relationship: { relationship: "Relationship", fromclass: "Source object", fromField: "Source field", toclass: "Target object",
        toField: "Target field", desc: "Description" },
    });
  });
  app.get("/ontology/model/object-types", (req, res) => { reader(req); res.json([...model.classes.keys()].map(objectTypeView)); });
  app.get("/ontology/model/object-type", (req, res) => {
    reader(req);
    const className = String(req.query.className);
    if (!model.classes.has(className)) { notFound(res, "OBJECT_TYPE_NOT_FOUND"); return; }
    res.json(objectTypeView(className));
  });
  app.get("/ontology/model/object-type/deletion-impact", (req, res) => {
    reader(req);
    res.json({ relationships: touching(String(req.query.className)).map(relationshipView) });
  });
  app.get("/ontology/model/attributes", (req, res) => {
    reader(req);
    const className = req.query.className === undefined ? undefined : String(req.query.className);
    res.json([...model.classes].filter(([name]) => className === undefined || name === className)
      .flatMap(([name, { attrs }]) => attrs.map(attr => ({ className: name, ...attr }))));
  });
  app.get("/ontology/model/relationships", (req, res) => {
    reader(req);
    const className = req.query.className === undefined ? undefined : String(req.query.className);
    res.json((className === undefined ? [...model.relationships] : touching(className)).map(relationshipView));
  });
  app.get("/ontology/model/relationship", (req, res) => {
    reader(req);
    const name = String(req.query.relationship);
    const rel = model.relationships.get(name);
    if (!rel) { notFound(res, "RELATIONSHIP_NOT_FOUND"); return; }
    res.json(relationshipView([name, rel]));
  });
  app.post("/ontology/model/object-type/form", (req, res) => {
    reader(req);
    expect(req.body).toEqual({ target: { kind: "draft" }, changedField: null });
    res.json({
      fields: [textField("/className", "API name", true), textField("/primaryKeyName", "Primary key name", true),
        textField("/showName", "Display name", true), textField("/classDesc", "Description", false)],
      values: { className: "", primaryKeyName: "", showName: "", classDesc: "" },
      save: { method: "POST", path: "/ontology/model/object-type/create", bodySchema: { type: "object" }, draftOperation: "objectType.create" },
    });
  });
  app.post("/ontology/model/object-type/create", (req, res) => {
    reader(req);
    const { className, primaryKeyName, showName, classDesc } = req.body;
    if (model.classes.has(className)) {
      res.status(422).json({ error: { code: "FIELD_VALIDATION_FAILED", message: "Class name: already exists",
        fields: [{ field: "/values/className", code: "already_exists", message: "Class name already exists" }] } });
      return;
    }
    model.classes.set(className, { showName, classDesc, attrs: [attribute(primaryKeyName, true)] });
    res.status(201).json(objectTypeView(className));
  });
  app.post("/ontology/model/object-type/delete", (req, res) => {
    reader(req);
    const removed = touching(req.body.className).map(([name]) => name);
    removed.forEach(name => model.relationships.delete(name));
    model.classes.delete(req.body.className);
    res.json({ relationships: removed });
  });
  app.post("/ontology/model/attribute/delete", (req, res) => {
    reader(req);
    const { className, name } = req.body;
    const user = [...model.relationships].find(([, rel]) =>
      (rel.fromclass === className && rel.fromField === name) || (rel.toclass === className && rel.toField === name));
    if (user) {
      res.status(409).json({ error: { code: "ATTRIBUTE_IN_USE", message: `Attribute ${name} joins relationship ${user[0]}`, relationships: [user[0]] } });
      return;
    }
    const owner = model.classes.get(className)!;
    owner.attrs = owner.attrs.filter(attr => attr.name !== name);
    res.json({});
  });
}

const type = (id: string, read: string, params = {}) => ({ source: { type: { kind: "PlatformObjectType", id } }, read, params });
const bind = (id: string, target?: object) => ({ operation: { kind: "PlatformOperation", id }, ...(target && { target }) });
const projections: Record<string, object> = {
  types: { componentId: "@ontomato/sdk:ObjectList", data: { rows: type(OBJECT_TYPE, "list") } },
  attributes: { componentId: "@ontomato/sdk:ObjectList", data: { rows: type(ATTRIBUTE, "list", { className: { literal: "warehouse" } }) } },
  relationships: { componentId: "@ontomato/sdk:ObjectList", data: { rows: type(RELATIONSHIP, "list", { className: { literal: "item" } }) } },
  summary: {
    componentId: "@ontomato/sdk:ObjectSummary", inputs: { objectType: { kind: "object", objectType: OBJECT_TYPE } },
    data: { record: { source: { object: { input: "objectType" } }, read: "record", params: {} } },
  },
  // With no target the save is a creation draft, which the projection's createForm read admits.
  create: {
    componentId: "@ontomato/sdk:ObjectForm", data: { form: type(OBJECT_TYPE, "createForm") },
    operations: { save: bind(`${OBJECT_TYPE}.save`) },
  },
  removeType: {
    componentId: "@ontomato/sdk:OperationButton", inputs: { objectType: { kind: "object", objectType: OBJECT_TYPE } },
    data: {}, operations: { delete: bind(DELETE_OBJECT_TYPE, { input: "objectType" }) },
  },
  removeAttribute: {
    componentId: "@ontomato/sdk:OperationButton", inputs: { attribute: { kind: "object", objectType: ATTRIBUTE } },
    data: {}, operations: { delete: bind(DELETE_ATTRIBUTE, { input: "attribute" }) },
  },
};
const warehouse = { className: OBJECT_TYPE, primaryKey: "warehouse" };
const joinAttribute = { className: ATTRIBUTE, primaryKey: JSON.stringify(["warehouse", "code"]) };
const members = {
  types: {}, attributes: {}, relationships: {},
  summary: { inputs: { objectType: { literal: warehouse } } },
  create: {},
  removeType: { inputs: { objectType: { literal: warehouse } } },
  removeAttribute: { inputs: { attribute: { literal: joinAttribute } } },
};

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });
  state.schema = `ontology_model_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "ontology-model-panel-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });

  const { panelOperationsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { ensurePanelOperationsSchema } = await import("../../infrastructure/postgres-migrations/20261118-panel-operations/schema");
  await ensurePanelOperationsSchema(state.pool);
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => { resourceIds.add(req.body.id); res.json({ success: true }); });
  app.post("/product-governance/check", (req, res) => res.json({ allowed: resourceIds.has(req.body.id) }));
  app.post("/product-governance/resources", (_req, res) => res.json({ ids: [...resourceIds] }));
  app.get(`/platform/applications/${use.applicationId}/panel-uses`, (req, res) => {
    expect(req.header("tk")).toBe("model-reader");
    res.json({ success: true, data: {
      applicationId: use.applicationId, entry: { path: `/applications/${use.applicationId}`, renderer: "panels" },
      panelUses: [{ id: use.useId, pageKey: use.useId, path: `/applications/${use.applicationId}/${use.useId}`, panelId,
        access: { kind: "domain-member" } }],
    } });
  });
  javaOwner(app);
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: "model", userId: "reader", userName: "Model Reader", token: "model-reader", locale: req.header("Accept-Language") });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [key, projection] of Object.entries(projections)) {
    const saved = await request("PUT", `product-projections/ontology-model-${key}`, {
      name: key, description: "", visibility: "domain", revision: 0, inputs: {}, outputs: {}, config: {}, ...projection,
    });
    expect(saved.status, await saved.text()).toBe(200);
  }
  const html = Object.keys(members).map(key => `<panel-member ref="${key}"></panel-member>`).join("");
  const saved = await request("PUT", `product-panels/${panelId}`, {
    name: "Ontology model", description: "", visibility: "domain", revision: 0, content: { html: `<section>${html}</section>` },
    manifest: { state: {}, events: {}, members: Object.fromEntries(Object.entries(members).map(([key, member]) =>
      [key, { target: { projectionId: `ontology-model-${key}` }, ...member }])) },
  });
  expect(saved.status, await saved.text()).toBe(200);
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, body?: object) {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json", "Accept-Language": "en" }, body: JSON.stringify(body),
  });
}

async function read(member: string, dataName: string) {
  const response = await request("POST", "product-panels/read", { source: use, memberPath: [{ member }], dataName, inputs: {} });
  expect(response.status, member).toBe(200);
  const reply = productPanelReadResponseSchema.parse(await response.json());
  if (reply.status !== "ready") throw new Error(`${member}/${dataName}: ${JSON.stringify(reply)}`);
  return reply.value;
}

/** The member's bound operations, described from its projection's explicit `operations`. */
async function operations(member: string) {
  const response = await request("POST", "product-panels/read", { source: use, memberPath: [{ member }], operations: true, inputs: {} });
  expect(response.status, member).toBe(200);
  return response.json();
}

async function operate(operationId: string, call: object) {
  const prepared = await request("POST", "panel-operations/intents", {
    applicationId: use.applicationId, useId: use.useId, operationId, call,
  });
  const preparation = await prepared.json();
  expect(prepared.status, JSON.stringify(preparation)).toBe(200);
  const { intentId, confirmation } = panelHumanOperationPreparationSchema.parse(preparation);
  const dispatched = await request("POST", `panel-operations/intents/${intentId}/dispatch`, {});
  return { confirmation, receipt: panelHumanOperationDispatchResponseSchema.parse(await dispatched.json()) };
}

it("serves the ontology model's catalog reads to a panel viewer through the owner's typed endpoints", async () => {
  seed();
  ownerCalls.length = 0;
  expect(await read("types", "rows")).toEqual([
    {
      primaryKey: "warehouse", label: "Warehouse",
      fields: { className: "warehouse", showName: "Warehouse", classDesc: "", attributeCount: "2", businessKeyCount: "0",
        relationshipCount: "1", primaryKey: "ok" },
      fieldLabels: { className: "API name", showName: "Display name", classDesc: "Description" },
    },
    expect.objectContaining({ primaryKey: "item", label: "item" }),
  ]);
  expect(await read("attributes", "rows")).toMatchObject([
    { primaryKey: '["warehouse","id"]', label: "ID", fields: { className: "warehouse", primaryKey: "true" },
      fieldLabels: { className: "Owner object type", businessKey: "Business key" } },
    { primaryKey: '["warehouse","code"]', label: "CODE" },
  ]);
  expect(await read("relationships", "rows")).toEqual([{
    primaryKey: "contains", label: "Contains",
    fields: { fromclass: "warehouse", toclass: "item", desc: "Contains", fromField: "code", toField: "warehouse_code" },
    fieldLabels: { fromclass: "Source object", toclass: "Target object", desc: "Description", fromField: "Source field", toField: "Target field" },
  }]);
  expect(await read("summary", "record")).toMatchObject({ primaryKey: "warehouse", fields: { attributeCount: "2" } });
  expect(await read("create", "form")).toMatchObject({
    values: { className: "" }, errors: [], save: { draftOperation: "objectType.create" },
  });
  expect(await operations("removeType")).toEqual({ status: "ready", value: { delete: expect.objectContaining({
    handlerRef: DELETE_OBJECT_TYPE, kind: "action", label: "Delete object type", effect: "write", batch: false,
    target: { source: "input", input: "objectType" }, inspectImpact: { handlerRef: `${DELETE_OBJECT_TYPE}.inspect-impact` },
  }) } });
  expect(await operations("create")).toMatchObject({ status: "ready", value: {
    save: { handlerRef: `${OBJECT_TYPE}.save`, kind: "form.save", target: { source: "draft", slot: "create" } },
  } });
  // Lists and records read under the readers' GET permission; className filters reach the owner.
  expect(ownerCalls).toEqual(expect.arrayContaining([
    "GET /ontology/model/attributes?className=warehouse", "GET /ontology/model/relationships?className=item",
  ]));
  expect(ownerCalls.filter(call => !call.startsWith("GET ")).every(call => call === "POST /ontology/model/object-type/form")).toBe(true);
});

it("creates, refuses and deletes model objects through the panel coordinator against the owner", async () => {
  seed();
  const draft = { className: "bin", primaryKeyName: "id", showName: "Bin", classDesc: "" };
  const created = await operate("create.save", { target: { kind: "draft" }, input: { values: draft } });
  expect(created.confirmation).toEqual({ kind: "none" });
  expect(created.receipt).toMatchObject({ kind: "dispatched", outcome: {
    kind: "success", data: { className: "bin", showName: "Bin" },
    affected: { objects: [{ objectType: OBJECT_TYPE, primaryKey: "bin" }], objectTypes: [OBJECT_TYPE, ATTRIBUTE] },
  } });
  const duplicate = await operate("create.save", { target: { kind: "draft" }, input: { values: draft } });
  expect(duplicate.receipt).toMatchObject({ outcome: {
    kind: "refusal", code: "FIELD_VALIDATION_FAILED",
    errors: [{ field: "/className", code: "already_exists", message: "Class name already exists" }],
  } });

  const target = (literal: { className: string; primaryKey: string }) =>
    ({ kind: "object", objectType: literal.className, primaryKey: literal.primaryKey });
  const inUse = await operate("removeAttribute.delete", { target: target(joinAttribute), input: {} });
  expect(inUse.receipt).toMatchObject({ outcome: {
    kind: "refusal", code: "ATTRIBUTE_IN_USE", message: "Attribute code joins relationship contains",
  } });
  expect(model.classes.get("warehouse")!.attrs.map(attr => attr.name)).toEqual(["id", "code"]);

  const removed = await operate("removeType.delete", { target: target(warehouse), input: {} });
  expect(removed.confirmation).toMatchObject({ kind: "impact", impact: {
    objects: [{ target: { objectType: RELATIONSHIP, primaryKey: "contains" }, label: "Contains" }], total: 1,
  } });
  expect(removed.receipt).toMatchObject({ kind: "dispatched", outcome: {
    kind: "success", data: { relationships: ["contains"] },
    affected: {
      objects: [{ objectType: OBJECT_TYPE, primaryKey: "warehouse" }, { objectType: RELATIONSHIP, primaryKey: "contains" }],
      objectTypes: [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP],
    },
  } });
  expect([...model.classes.keys()]).toEqual(["item", "bin"]);
  expect(model.relationships.size).toBe(0);
  expect((await request("POST", "product-panels/read", { source: use, memberPath: [{ member: "relationships" }], dataName: "rows", inputs: {} })
    .then(response => response.json()))).toEqual({ status: "empty" });
});
