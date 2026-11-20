import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { APPROVE_KNOWLEDGE, BUSINESS_KNOWLEDGE, DELETE_KNOWLEDGE } from "@ontomato/contracts/panel-client-requests";
import { productPanelInputSchema, productProjectionInputSchema } from "@ontomato/contracts/product-panels";
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

let server: Server | undefined;
let contentRoot: string;
const resourceIds = new Set<string>();
const panelId = "panel-knowledge-m7";
const knowledgeType = { kind: "object", objectType: BUSINESS_KNOWLEDGE } as const;

const ownerEntries = {
  "k-1": {
    knowledgeID: "k-1",
    knowledgeTitle: "Order rule",
    knowledgeText: "Orders need a customer",
    knowledgeTags: ["Business"],
    status: 1,
  },
  "k-2": {
    knowledgeID: "k-2",
    knowledgeTitle: "Return rule",
    knowledgeText: "Returns require a receipt",
    knowledgeTags: ["Policy"],
    status: 0,
  },
  "k-3": {
    knowledgeID: "k-3",
    knowledgeTitle: "Night cutoff",
    knowledgeText: "Cutoff moves on Friday evening",
    knowledgeTags: ["Business", "Ops"],
    status: 0,
  },
  "k-4": {
    knowledgeID: "k-4",
    knowledgeTitle: "Rule of orders",
    knowledgeText: "Both rules apply",
    knowledgeTags: ["Tech"],
    status: 1,
  },
};

const ownerFormDescription = (target: { kind: string; primaryKey?: string }, values?: Record<string, unknown>) => ({
  fields: [
    {
      path: "/knowledgeTitle", label: "Title", valueSchema: { type: "string" }, required: true,
      readOnly: false, control: { kind: "text" },
    },
    {
      path: "/knowledgeText", label: "Knowledge content", valueSchema: { type: "string" }, required: true,
      readOnly: false, control: { kind: "text", multiline: true },
    },
    {
      path: "/knowledgeTags", label: "Tags", valueSchema: { type: "array", items: { type: "string" } }, required: false,
      readOnly: false, control: { kind: "select", multiple: true, allowCreate: true, options: [] },
    },
    {
      path: "/status", label: "Status", valueSchema: { type: "integer", enum: [0, 1] }, required: true,
      readOnly: false, control: {
        kind: "select",
        options: [
          { value: 0, label: "Pending review", description: null, disabled: false, disabledReason: null },
          { value: 1, label: "Approved", description: null, disabled: false, disabledReason: null },
        ],
      },
    },
  ],
  values: values ?? (target.primaryKey === "k-2"
    ? { knowledgeTitle: "Return rule", knowledgeText: "Returns require a receipt", knowledgeTags: ["Policy"], status: 0 }
    : { knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 0 }),
  save: {
    method: "POST",
    path: target.kind === "draft" ? "/data-query/admin/addBussinessKnowledge" : "/data-query/admin/editBussinessKnowledge",
    bodySchema: { type: "object" },
    draftOperation: target.kind === "draft" ? "knowledge.create" : "knowledge.update",
  },
});

const projections = {
  "projection-knowledge-list": productProjectionInputSchema.parse({
    name: "Knowledge list", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectList",
    inputs: {
      search: { kind: "scalar", type: "string" },
      filter: { kind: "json" },
      cursor: { kind: "scalar", type: "string" },
      size: { kind: "scalar", type: "number" },
    },
    outputs: {},
    config: {},
    data: {
      rows: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "query",
        params: {
          search: { input: "search" },
          filter: { input: "filter" },
          cursor: { input: "cursor" },
          size: { input: "size" },
        },
      },
    },
  }),
  "projection-knowledge-counts": productProjectionInputSchema.parse({
    name: "Knowledge counts", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:SegmentedControl",
    inputs: { search: { kind: "scalar", type: "string" } },
    outputs: {},
    config: {},
    data: {
      counts: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "counts",
        params: { by: { literal: "status" }, search: { input: "search" } },
      },
    },
  }),
  "projection-knowledge-detail": productProjectionInputSchema.parse({
    name: "Knowledge detail", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectSummary",
    inputs: { entry: knowledgeType, search: { kind: "scalar", type: "string" } },
    outputs: {},
    config: {},
    data: {
      record: {
        source: { object: { input: "entry" } },
        read: "record",
        params: { search: { input: "search" } },
      },
    },
  }),
  "projection-knowledge-form": productProjectionInputSchema.parse({
    name: "Knowledge form", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      entry: knowledgeType,
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { object: { input: "entry" } },
        read: "form",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
    },
  }),
  "projection-knowledge-create-form": productProjectionInputSchema.parse({
    name: "Create knowledge form", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:ObjectForm",
    inputs: {
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    outputs: {},
    config: {},
    data: {
      form: {
        source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } },
        read: "createForm",
        params: { values: { input: "values" }, changedField: { input: "changedField" } },
      },
    },
  }),
  "projection-knowledge-approve": productProjectionInputSchema.parse({
    name: "Approve knowledge", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: { entry: knowledgeType },
    outputs: {},
    config: {},
    data: {
      operation: {
        source: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE } },
        read: "describe",
        params: {},
      },
    },
  }),
  "projection-knowledge-delete": productProjectionInputSchema.parse({
    name: "Delete knowledge", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: {},
    outputs: {},
    config: {},
    data: {
      operation: {
        source: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE } },
        read: "describe",
        params: {},
      },
    },
  }),
};

const panel = productPanelInputSchema.parse({
  name: "Business knowledge", description: "", visibility: "domain",
  content: {
    html: '<section flow="column"><panel-member ref="counts"></panel-member><panel-member ref="list"></panel-member><panel-member ref="detail"></panel-member><panel-member ref="form"></panel-member><panel-member ref="createForm"></panel-member><panel-member ref="approve"></panel-member><panel-member ref="remove"></panel-member></section>',
  },
  manifest: {
    state: {
      selectedEntry: { type: knowledgeType, deepLink: true, external: true, personal: false, default: null },
    },
    members: {
      counts: { target: { projectionId: "projection-knowledge-counts" } },
      list: { target: { projectionId: "projection-knowledge-list" } },
      detail: { target: { projectionId: "projection-knowledge-detail" }, inputs: { entry: { state: "selectedEntry" } } },
      form: { target: { projectionId: "projection-knowledge-form" }, inputs: { entry: { state: "selectedEntry" } } },
      createForm: { target: { projectionId: "projection-knowledge-create-form" } },
      approve: { target: { projectionId: "projection-knowledge-approve" }, inputs: { entry: { state: "selectedEntry" } } },
      remove: { target: { projectionId: "projection-knowledge-delete" } },
    },
    events: {},
  },
});

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: { ...en, "panels.knowledge.approve": "Approve", "panels.knowledge.delete": "Delete" } as typeof en },
      "zh-CN": { ...enLocaleMeta, messages: { ...en, "panels.knowledge.approve": "通过", "panels.knowledge.delete": "删除" } as typeof en },
    },
  });
  state.schema = `panel_knowledge_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  contentRoot = await mkdtemp(path.join(os.tmpdir(), "panel-knowledge-"));
  await writeBundledAppSdkFixture(contentRoot);
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });

  const { panelOperationsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { ensurePanelOperationsSchema } = await import("../../infrastructure/postgres-migrations/20261118-panel-operations/schema");
  await ensurePanelOperationsSchema(state.pool);
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    resourceIds.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({ allowed: resourceIds.has(req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({ ids: [...resourceIds] });
  });
  app.get("/platform/applications/app-knowledge/panel-uses", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({
      success: true,
      data: {
        applicationId: "app-knowledge",
        entry: { path: "/ontology/knowledge", renderer: "panels" },
        panelUses: [{
          id: "knowledge", pageKey: "knowledge", path: "/ontology/knowledge", panelId,
          access: { kind: "domain-member" },
        }],
      },
    });
  });
  app.post("/admin/getBussinessKnowledge", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({ success: true, data: ownerEntries });
  });
  app.post("/admin/bussinessKnowledge/form", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({ success: true, data: ownerFormDescription(req.body.target, req.body.values) });
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId: "knowledge-domain", userId: "reader", token: "knowledge-reader", locale: req.header("Accept-Language") });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api", panelOperationsRouter);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server!.close(() => resolve()));
  }
  if (state.pool) {
    await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);
    await state.pool.end();
  }
  if (contentRoot) await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, body?: object, locale = "en") {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json", "Accept-Language": locale }, body: JSON.stringify(body),
  });
}

it("serves business knowledge panel reads over real HTTP routes backed by Postgres", async () => {
  for (const [id, definition] of Object.entries(projections)) {
    const res = await request("PUT", `product-projections/${id}`, { ...definition, revision: 0 });
    expect(res.status, await res.text()).toBe(200);
  }
  const panelRes = await request("PUT", `product-panels/${panelId}`, { ...panel, revision: 0 });
  expect(panelRes.status, await panelRes.text()).toBe(200);

  const source = { kind: "registered", applicationId: "app-knowledge", useId: "knowledge" };
  const read = (member: string, dataName: string, inputs: object, locale = "en") =>
    request("POST", "product-panels/read", { source, memberPath: [{ member }], dataName, inputs }, locale);

  // query: search (with highlights & title-hit ranking), status filter, and cursor pagination.
  const searched = await (await read("list", "rows", { search: "ORDERS rule" })).json();
  expect(searched).toEqual({
    status: "ready",
    value: {
      rows: [
        {
          primaryKey: "k-4",
          label: "Rule of orders",
          fieldLabels: { knowledgeText: "Knowledge content", knowledgeTags: "Tags", status: "Status" },
          fields: { knowledgeText: "Both rules apply", knowledgeTags: "Tech", status: "Approved" },
          highlights: { label: [{ start: 0, end: 4 }, { start: 8, end: 14 }], knowledgeText: [{ start: 5, end: 9 }] },
        },
        {
          primaryKey: "k-1",
          label: "Order rule",
          fieldLabels: { knowledgeText: "Knowledge content", knowledgeTags: "Tags", status: "Status" },
          fields: { knowledgeText: "Orders need a customer", knowledgeTags: "Business", status: "Approved" },
          highlights: { label: [{ start: 6, end: 10 }], knowledgeText: [{ start: 0, end: 6 }] },
        },
      ],
      total: 2,
    },
  });

  const pendingFiltered = await (await read("list", "rows", { search: "rule", filter: { status: "pending" } })).json();
  expect(pendingFiltered).toMatchObject({
    status: "ready",
    value: {
      rows: [{ primaryKey: "k-2", highlights: { label: [{ start: 7, end: 11 }] } }],
      total: 1,
    },
  });

  const page1 = await (await read("list", "rows", { filter: { status: "approved" }, size: 1 })).json();
  expect(page1).toMatchObject({
    status: "ready",
    value: { rows: [{ primaryKey: "k-1" }], nextCursor: "1", total: 2 },
  });
  expect(page1.value.rows[0].highlights).toBeUndefined();

  const page2 = await (await read("list", "rows", { filter: { status: "approved" }, cursor: "1", size: 1 })).json();
  expect(page2).toMatchObject({
    status: "ready",
    value: { rows: [{ primaryKey: "k-4" }], total: 2 },
  });
  expect(page2.value.nextCursor).toBeUndefined();

  // Clearing the panel's search state behaves the same as omitting the parameter.
  expect(await (await read("list", "rows", { search: null })).json()).toEqual(
    await (await read("list", "rows", {})).json(),
  );
  expect(await (await read("counts", "counts", { search: null })).json()).toEqual({
    status: "ready",
    value: { all: 4, pending: 2, approved: 2 },
  });
  expect(await (await read("counts", "counts", { search: "rule" })).json()).toEqual({
    status: "ready",
    value: { all: 3, pending: 1, approved: 2 },
  });

  // record: without search omits highlights; with matching search includes highlights; with non-matching search omits highlights.
  const k3Ref = { className: BUSINESS_KNOWLEDGE, primaryKey: "k-3" };
  const recordPlain = await (await read("detail", "record", { entry: k3Ref })).json();
  expect(recordPlain).toEqual({
    status: "ready",
    value: {
      primaryKey: "k-3",
      label: "Night cutoff",
      fieldLabels: { knowledgeText: "Knowledge content", knowledgeTags: "Tags", status: "Status" },
      fields: { knowledgeText: "Cutoff moves on Friday evening", knowledgeTags: "Business, Ops", status: "Pending review" },
    },
  });

  const recordMatched = await (await read("detail", "record", { entry: k3Ref, search: "evening" })).json();
  expect(recordMatched).toEqual({
    status: "ready",
    value: {
      ...recordPlain.value,
      highlights: { knowledgeText: [{ start: 23, end: 30 }] },
    },
  });

  const recordUnmatched = await (await read("detail", "record", { entry: k3Ref, search: "evening missing" })).json();
  expect(recordUnmatched).toEqual(recordPlain);

  // form & createForm: JSON form values (panelFormValues).
  const createFormRes = await (await read("createForm", "form", {})).json();
  expect(createFormRes).toMatchObject({
    status: "ready",
    value: { values: { knowledgeTitle: "", knowledgeText: "", knowledgeTags: [], status: 0 }, errors: [] },
  });

  const k2Ref = { className: BUSINESS_KNOWLEDGE, primaryKey: "k-2" };
  const editFormRes = await (await read("form", "form", {
    entry: k2Ref,
    values: { knowledgeTitle: "Return rule", knowledgeTags: ["Policy", "Updated"], status: 1 },
    changedField: "/status",
  })).json();
  expect(editFormRes).toMatchObject({
    status: "ready",
    value: { values: { knowledgeTitle: "Return rule", knowledgeTags: ["Policy", "Updated"], status: 1 }, errors: [] },
  });

  // approve.describe & delete.describe: both batch: true, delete includes inspectImpact.
  const approveDesc = await (await read("approve", "operation", {}, "zh-CN")).json();
  expect(approveDesc).toMatchObject({
    status: "ready",
    value: { handlerRef: APPROVE_KNOWLEDGE, effect: "write", batch: true, label: "通过" },
  });
  const deleteDesc = await (await read("remove", "operation", {}, "zh-CN")).json();
  expect(deleteDesc).toMatchObject({
    status: "ready",
    value: {
      handlerRef: DELETE_KNOWLEDGE,
      effect: "write",
      batch: true,
      label: "删除",
      inspectImpact: { handlerRef: `${DELETE_KNOWLEDGE}.inspect-impact` },
    },
  });
});

it("names the target input when a knowledge button connects the wrong port", async () => {
  const intent = {
    applicationId: "app-knowledge", useId: "knowledge", operationId: "approve.approve",
    call: { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, input: {} },
  };
  const wrongTarget = await request("POST", "panel-operations/intents", intent);
  expect(wrongTarget.status).toBe(422);

  const projectionId = "projection-knowledge-approve-linked";
  const savedProjection = await request("PUT", "product-projections/" + projectionId, {
    ...projections["projection-knowledge-approve"], inputs: { knowledge: knowledgeType }, revision: 0,
  });
  expect(savedProjection.status, await savedProjection.text()).toBe(200);
  const savedPanel = await request("PUT", "product-panels/" + panelId, {
    ...panel, revision: 1, manifest: { ...panel.manifest, members: {
      ...panel.manifest.members, approve: { target: { projectionId }, inputs: { knowledge: { state: "selectedEntry" } } },
    } },
  });
  expect(savedPanel.status, await savedPanel.text()).toBe(200);
  const accepted = await request("POST", "panel-operations/intents", intent);
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ operationId: "approve.approve", confirmation: { kind: "none" } });

  expect(await wrongTarget.json()).toMatchObject({ error: {
    code: "PANEL_OPERATION_TARGET_UNBOUND",
    message: "Operation 'knowledge.approve' expects target input 'knowledge', but member 'approve' does not connect it.",
  } });
});
