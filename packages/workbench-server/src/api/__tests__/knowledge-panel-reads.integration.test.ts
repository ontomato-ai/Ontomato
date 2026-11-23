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
import { productPanelOperationsReadResponseSchema } from "@ontomato/contracts/panel-host";
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
const ownerWrites: { path: string; body: unknown }[] = [];
const panelId = "panel-knowledge-m7";
const knowledgeType = { kind: "object", objectType: BUSINESS_KNOWLEDGE } as const;
const targetList = { kind: "list", items: knowledgeType } as const;

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
      status: { kind: "scalar", type: "string" },
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
          status: { input: "status" },
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
    outputs: { value: { kind: "scalar", type: "string" } },
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
    operations: {
      save: { operation: { kind: "PlatformOperation", id: `${BUSINESS_KNOWLEDGE}.save` }, target: { input: "entry" } },
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
    inputs: { knowledge: knowledgeType },
    outputs: {},
    config: {},
    data: {},
    operations: {
      approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "knowledge" } },
    },
  }),
  "projection-knowledge-delete": productProjectionInputSchema.parse({
    name: "Delete knowledge", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: { knowledge: knowledgeType },
    outputs: {},
    config: {},
    data: {},
    operations: {
      delete: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE }, target: { input: "knowledge" } },
    },
  }),
  "projection-knowledge-delete-checked": productProjectionInputSchema.parse({
    name: "Delete checked knowledge", description: "", visibility: "domain",
    componentId: "@ontomato/sdk:OperationButton",
    inputs: { selection: targetList },
    outputs: {},
    config: {},
    data: {},
    operations: {
      remove: { operation: { kind: "PlatformOperation", id: DELETE_KNOWLEDGE }, target: { input: "selection" } },
    },
  }),
};

const panel = productPanelInputSchema.parse({
  name: "Business knowledge", description: "", visibility: "domain",
  content: {
    html: [
      '<div id="app" class="knowledge-panel" v-cloak>',
      '  <div class="knowledge-list">',
      '    <projection slot="counts"></projection>',
      '    <projection slot="list"></projection>',
      '    <projection v-if="hasChecked" slot="removeAll"></projection>',
      "  </div>",
      '  <section class="knowledge-detail">',
      '    <template v-if="chosen">',
      '      <projection slot="detail"></projection>',
      '      <projection slot="form"></projection>',
      '      <projection slot="approve"></projection>',
      '      <projection slot="remove"></projection>',
      "    </template>",
      '    <projection v-else slot="createForm"></projection>',
      "  </section>",
      "</div>",
    ].join("\n"),
    module: [
      'import { computed } from "vue";',
      'import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";',
      "",
      "const BusinessKnowledgePanel = {",
      "  setup() {",
      "    const { instance } = usePanelContext();",
      "    const chosen = computed(() => instance.state.values.value.selectedEntry != null);",
      "    const hasChecked = computed(() => (instance.state.values.value.checked?.length ?? 0) > 0);",
      "    return { chosen, hasChecked };",
      "  },",
      "};",
      "",
      "await mountPanel(BusinessKnowledgePanel);",
    ].join("\n"),
  },
  manifest: {
    state: {
      status: { type: { kind: "scalar", type: "string" }, deepLink: true, external: true, personal: false, default: "all" },
      selectedEntry: { type: knowledgeType, deepLink: true, external: true, personal: false, default: null },
      checked: { type: targetList, default: [] },
    },
    members: {
      counts: { target: { projectionId: "projection-knowledge-counts" }, outputs: { value: { state: "status" } } },
      list: { target: { projectionId: "projection-knowledge-list" }, inputs: { status: { state: "status" } } },
      detail: { target: { projectionId: "projection-knowledge-detail" }, inputs: { entry: { state: "selectedEntry" } } },
      form: { target: { projectionId: "projection-knowledge-form" }, inputs: { entry: { state: "selectedEntry" } } },
      createForm: { target: { projectionId: "projection-knowledge-create-form" } },
      approve: { target: { projectionId: "projection-knowledge-approve" }, inputs: { knowledge: { state: "selectedEntry" } } },
      remove: { target: { projectionId: "projection-knowledge-delete" }, inputs: { knowledge: { state: "selectedEntry" } } },
      removeAll: { target: { projectionId: "projection-knowledge-delete-checked" }, inputs: { selection: { state: "checked" } } },
    },
  },
});

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: true,
    packs: {
      en: { ...enLocaleMeta, messages: { ...en, "panels.knowledge.approve": "Approve", "panels.knowledge.delete": "Delete", "panels.knowledge.statusAll": "All" } as typeof en },
      "zh-CN": { ...enLocaleMeta, messages: { ...en, "panels.knowledge.approve": "通过", "panels.knowledge.delete": "删除", "panels.knowledge.statusAll": "全部" } as typeof en },
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
    res.json({ allowed: req.header("tk") === "knowledge-reader" && resourceIds.has(req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({ ids: [...resourceIds] });
  });
  app.get("/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId !== "app-knowledge") { next(); return; }
    // Java admits the entry to the outsider too: what refuses them is the product's use Grant.
    expect(["knowledge-reader", "outsider"]).toContain(req.header("tk"));
    res.json({
      success: true,
      data: {
        applicationId: "app-knowledge",
        menu: { groups: [], panelUses: [] },
      use: {
          id: "knowledge", pageKey: "knowledge", path: "/ontology/knowledge", panelId,
          access: { kind: "domain-member" },
        },
      },
    });
  });
  app.post("/admin/getBussinessKnowledge", (req, res) => {
    if (req.header("tk") !== "knowledge-reader") { res.sendStatus(403); return; }
    res.json({ success: true, data: ownerEntries });
  });
  app.post("/admin/bussinessKnowledge/form", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    res.json({ success: true, data: ownerFormDescription(req.body.target, req.body.values) });
  });
  app.post("/admin/editBussinessKnowledge", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    ownerWrites.push({ path: "/admin/editBussinessKnowledge", body: req.body });
    res.json({ success: true });
  });
  app.post("/admin/delBussinessKnowledge", (req, res) => {
    expect(req.header("tk")).toBe("knowledge-reader");
    ownerWrites.push({ path: "/admin/delBussinessKnowledge", body: req.body });
    res.json({ success: true });
  });
  app.use("/api", (req, _res, next) => {
    const token = req.header("tk") ?? "knowledge-reader";
    Object.assign(req, { domainId: "knowledge-domain", userId: token, token, locale: req.header("Accept-Language") });
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

function request(method: string, resource: string, body?: object, locale = "en", headers?: Record<string, string>) {
  return fetch(`${state.base}/api/${resource}`, {
    method,
    headers: { "Content-Type": "application/json", "Accept-Language": locale, ...headers },
    body: JSON.stringify(body),
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
          subtitle: "Both rules apply",
          fields: { knowledgeText: "Both rules apply", knowledgeTags: "Tech", status: "Approved" },
          tones: { status: "success" },
          tags: { knowledgeTags: ["Tech"] },
          highlights: { label: [{ start: 0, end: 4 }, { start: 8, end: 14 }], knowledgeText: [{ start: 5, end: 9 }], subtitle: [{ start: 5, end: 9 }] },
        },
        {
          primaryKey: "k-1",
          label: "Order rule",
          fieldLabels: { knowledgeText: "Knowledge content", knowledgeTags: "Tags", status: "Status" },
          subtitle: "Orders need a customer",
          fields: { knowledgeText: "Orders need a customer", knowledgeTags: "Business", status: "Approved" },
          tones: { status: "success" },
          tags: { knowledgeTags: ["Business"] },
          highlights: { label: [{ start: 6, end: 10 }], knowledgeText: [{ start: 0, end: 6 }], subtitle: [{ start: 0, end: 6 }] },
        },
      ],
      total: 2,
    },
  });

  const pendingFiltered = await (await read("list", "rows", { search: "rule", status: "pending" })).json();
  expect(pendingFiltered).toMatchObject({
    status: "ready",
    value: {
      rows: [{ primaryKey: "k-2", highlights: { label: [{ start: 7, end: 11 }] } }],
      total: 1,
    },
  });

  const page1 = await (await read("list", "rows", { status: "approved", size: 1 })).json();
  expect(page1).toMatchObject({
    status: "ready",
    value: { rows: [{ primaryKey: "k-1" }], nextCursor: "1", total: 2 },
  });
  expect(page1.value.rows[0].highlights).toBeUndefined();

  const page2 = await (await read("list", "rows", { status: "approved", cursor: "1", size: 1 })).json();
  expect(page2).toMatchObject({
    status: "ready",
    value: { rows: [{ primaryKey: "k-4" }], total: 2 },
  });
  expect(page2.value.nextCursor).toBeUndefined();

  // Clearing the panel's search state behaves the same as omitting the parameter.
  expect(await (await read("list", "rows", { search: null })).json()).toEqual(
    await (await read("list", "rows", {})).json(),
  );
  expect(await (await read("counts", "counts", { search: null })).json()).toEqual(
    await (await read("counts", "counts", {})).json(),
  );
  // counts: ordered status tabs with and without search, using localized "All" label and form status labels.
  expect(await (await read("counts", "counts", {})).json()).toEqual({
    status: "ready",
    value: [
      { key: "all", label: "All", count: 4 },
      { key: "pending", label: "Pending review", count: 2 },
      { key: "approved", label: "Approved", count: 2 },
    ],
  });
  expect(await (await read("counts", "counts", { search: "rule" })).json()).toEqual({
    status: "ready",
    value: [
      { key: "all", label: "All", count: 3 },
      { key: "pending", label: "Pending review", count: 1 },
      { key: "approved", label: "Approved", count: 2 },
    ],
  });
  expect(await (await read("counts", "counts", {}, "zh-CN")).json()).toMatchObject({
    status: "ready",
    value: [
      { key: "all", label: "全部", count: 4 },
      { key: "pending", label: "Pending review", count: 2 },
      { key: "approved", label: "Approved", count: 2 },
    ],
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
      subtitle: "Cutoff moves on Friday evening",
      fields: { knowledgeText: "Cutoff moves on Friday evening", knowledgeTags: "Business, Ops", status: "Pending review" },
      tones: { status: "warning" },
      tags: { knowledgeTags: ["Business", "Ops"] },
    },
  });

  const recordMatched = await (await read("detail", "record", { entry: k3Ref, search: "evening" })).json();
  expect(recordMatched).toEqual({
    status: "ready",
    value: {
      ...recordPlain.value,
      highlights: { knowledgeText: [{ start: 23, end: 30 }], subtitle: [{ start: 23, end: 30 }] },
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

  // Explicit operation declarations: read via /product-panels/read with operations: true, then prepare and dispatch single and batch writes.
  const readOperations = async (member: string, inputs: object, locale = "zh-CN") => {
    const res = await request("POST", "product-panels/read", {
      source: { kind: "registered", applicationId: "app-knowledge", useId: "knowledge" },
      memberPath: [{ member }],
      operations: true,
      inputs,
    }, locale);
    expect(res.status).toBe(200);
    return productPanelOperationsReadResponseSchema.parse(await res.json());
  };

  expect(await readOperations("approve", { knowledge: k2Ref })).toMatchObject({
    status: "ready",
    value: {
      approve: {
        kind: "action",
        handlerRef: APPROVE_KNOWLEDGE,
        effect: "write",
        batch: true,
        label: "通过",
        target: { source: "input", input: "knowledge" },
      },
    },
  });
  expect(await readOperations("remove", { knowledge: k2Ref })).toMatchObject({
    status: "ready",
    value: {
      delete: {
        kind: "action",
        handlerRef: DELETE_KNOWLEDGE,
        effect: "write",
        batch: true,
        label: "删除",
        target: { source: "input", input: "knowledge" },
        inspectImpact: { handlerRef: `${DELETE_KNOWLEDGE}.inspect-impact` },
      },
    },
  });
  expect(await readOperations("removeAll", { selection: [k2Ref, k3Ref] })).toMatchObject({
    status: "ready",
    value: {
      remove: {
        kind: "action",
        handlerRef: DELETE_KNOWLEDGE,
        effect: "write",
        batch: true,
        label: "删除",
        target: { source: "input", input: "selection" },
        inspectImpact: { handlerRef: `${DELETE_KNOWLEDGE}.inspect-impact` },
      },
    },
  });

  const preparedBatchDelete = await request("POST", "panel-operations/intents", {
    applicationId: "app-knowledge",
    useId: "knowledge",
    operationId: "removeAll.remove",
    calls: [
      { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, input: {} },
      { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" }, input: {} },
    ],
  });
  expect(preparedBatchDelete.status, await preparedBatchDelete.clone().text()).toBe(200);
  const batchPreparation = await preparedBatchDelete.json();
  expect(batchPreparation).toMatchObject({
    operationId: "removeAll.remove",
    confirmation: {
      kind: "batch",
      targets: {
        total: 2,
        objects: [
          { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, label: "Return rule" },
          { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" }, label: "Night cutoff" },
        ],
      },
      impact: {
        summary: "This deletes the selected business knowledge (2 in total).",
        total: 2,
      },
    },
  });
  const batchDispatch = await request("POST", `panel-operations/intents/${batchPreparation.intentId}/dispatch`, {});
  expect(batchDispatch.status).toBe(200);
  expect(await batchDispatch.json()).toMatchObject({
    kind: "dispatched",
    intentId: batchPreparation.intentId,
    outcome: {
      kind: "batch",
      items: [
        { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, outcome: { kind: "success", data: {} } },
        { target: { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" }, outcome: { kind: "success", data: {} } },
      ],
      // What the batch deleted, once for the whole batch, for the panel to let go of.
      affected: {
        removed: [{ objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, { objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-3" }],
      },
    },
  });
  expect(ownerWrites).toEqual([
    { path: "/admin/delBussinessKnowledge", body: { knowledgeID: "k-2" } },
    { path: "/admin/delBussinessKnowledge", body: { knowledgeID: "k-3" } },
  ]);
  ownerWrites.length = 0;
});

it("rejects a forged member path, an undeclared operation and an unauthorized target", async () => {
  const k2Target = { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" };
  const intent = (operationId: string, target = k2Target, headers?: Record<string, string>) =>
    request("POST", "panel-operations/intents", {
      applicationId: "app-knowledge", useId: "knowledge", operationId, call: { target, input: {} },
    }, "en", headers);

  const forgedIntent = await intent("forged.approve");
  expect(forgedIntent.status).toBe(403);
  expect(await forgedIntent.json()).toMatchObject({
    error: { code: "FORBIDDEN", message: "Panel does not declare member 'forged'" },
  });
  const forgedRead = await request("POST", "product-panels/read", {
    source: { kind: "registered", applicationId: "app-knowledge", useId: "knowledge" },
    memberPath: [{ member: "forged" }],
    operations: true,
    inputs: {},
  });
  expect(forgedRead.status).toBe(200);
  expect(await forgedRead.json()).toEqual({ status: "forbidden" });

  const unlistedOperation = await intent("approve.unlisted");
  expect(unlistedOperation.status).toBe(422);
  expect(await unlistedOperation.json()).toMatchObject({
    error: { code: "OPERATION_UNAVAILABLE", message: "The panel member does not declare operation 'approve.unlisted'" },
  });

  const forbiddenTarget = { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-forbidden" };
  const refusedDelete = await intent("remove.delete", forbiddenTarget);
  expect(refusedDelete.status).toBe(404);
  expect(await refusedDelete.json()).toMatchObject({
    error: { code: "KNOWLEDGE_UNAVAILABLE", message: "Business knowledge k-forbidden is not in this domain" },
  });
  const refusedBatchDelete = await request("POST", "panel-operations/intents", {
    applicationId: "app-knowledge", useId: "knowledge", operationId: "removeAll.remove",
    calls: [{ target: forbiddenTarget, input: {} }],
  });
  expect(refusedBatchDelete.status).toBe(404);
  expect(await refusedBatchDelete.json()).toMatchObject({
    error: { code: "KNOWLEDGE_UNAVAILABLE", message: "Business knowledge k-forbidden is not in this domain" },
  });
  const refusedReader = await intent("approve.approve", k2Target, { tk: "outsider" });
  expect(refusedReader.status).toBe(403);
  expect(await refusedReader.json()).toMatchObject({
    error: { code: "PRODUCT_FORBIDDEN", message: "Product use Grant required" },
  });
  const preparedForbiddenApprove = await intent("approve.approve", forbiddenTarget);
  expect(preparedForbiddenApprove.status).toBe(200);
  const { intentId } = await preparedForbiddenApprove.json();
  // The entry's title, for the owner's sentence, is read before anything is claimed: an entry outside the domain is
  // answered there, as a delete is when it is prepared, and nothing is written.
  const dispatchedForbiddenApprove = await request("POST", `panel-operations/intents/${intentId}/dispatch`, {});
  expect(dispatchedForbiddenApprove.status).toBe(404);
  expect(await dispatchedForbiddenApprove.json()).toMatchObject({
    error: { code: "KNOWLEDGE_UNAVAILABLE", message: "Business knowledge k-forbidden is not in this domain" },
  });
  expect(ownerWrites).toEqual([]);
});

it("saves only the fields the form submitted, so the owner keeps the ones left alone", async () => {
  const prepared = await request("POST", "panel-operations/intents", {
    applicationId: "app-knowledge", useId: "knowledge", operationId: "form.save",
    call: {
      target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" },
      input: {
        values: {
          knowledgeID: "k-2", knowledgeTitle: "Stale title", knowledgeText: "Returns require a receipt within 30 days",
          knowledgeTags: [], status: 1,
        },
        submittedFields: ["/knowledgeText"],
      },
    },
  });
  expect(prepared.status, await prepared.clone().text()).toBe(200);
  const { intentId } = await prepared.json();
  const dispatched = await request("POST", `panel-operations/intents/${intentId}/dispatch`, {});
  expect(dispatched.status).toBe(200);
  expect(await dispatched.json()).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
  expect(ownerWrites).toEqual([
    { path: "/admin/editBussinessKnowledge", body: { knowledgeID: "k-2", knowledgeText: "Returns require a receipt within 30 days" } },
  ]);
  ownerWrites.length = 0;
});

it("checks the operation target at registration and when preparing a button", async () => {
  const intent = {
    applicationId: "app-knowledge", useId: "knowledge", operationId: "approve.approve",
    call: { target: { kind: "object", objectType: BUSINESS_KNOWLEDGE, primaryKey: "k-2" }, input: {} },
  };
  const approve = projections["projection-knowledge-approve"];
  const badProjectionTarget = await request("PUT", "product-projections/projection-knowledge-approve-bad-target", {
    ...approve,
    operations: { approve: { operation: { kind: "PlatformOperation", id: APPROVE_KNOWLEDGE }, target: { input: "entry" } } },
    revision: 0,
  });
  expect(badProjectionTarget.status).toBe(400);
  expect(await badProjectionTarget.json()).toMatchObject({ error: {
    code: "INVALID_REQUEST",
    message: expect.stringContaining("The operation needs a declared object, object-union or list input"),
  } });

  const wrongProjectionId = "projection-knowledge-approve-task";
  const wrongProjection = await request("PUT", "product-projections/" + wrongProjectionId, {
    ...approve, revision: 0, inputs: { knowledge: { kind: "object", objectType: "platform:ScheduledTask" } },
  });
  expect(wrongProjection.status).toBe(400);
  expect(await wrongProjection.json()).toMatchObject({ error: {
    code: "PANEL_OPERATION_TARGET_MISMATCH",
    message: expect.stringContaining("operation 'approve' takes a target of type 'platform:BusinessKnowledge'"),
  } });

  const unboundPanel = { ...panel, manifest: { ...panel.manifest, members: {
    ...panel.manifest.members,
    approve: { target: { projectionId: "projection-knowledge-approve" }, inputs: {} },
  } } };
  const badMember = await request("PUT", "product-panels/" + panelId, { ...unboundPanel, revision: 1 });
  expect(badMember.status).toBe(400);
  expect(await badMember.json()).toMatchObject({ error: {
    code: "PANEL_PORT_MISMATCH",
    message: expect.stringContaining("operation 'approve' expects input 'knowledge', but it is not connected"),
  } });

  const accepted = await request("POST", "panel-operations/intents", intent);
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ operationId: "approve.approve", confirmation: { kind: "none" } });

  const batchProjectionId = "projection-knowledge-approve-batch";
  const savedBatch = await request("PUT", "product-projections/" + batchProjectionId, {
    ...approve, inputs: { knowledge: targetList }, revision: 0,
  });
  expect(savedBatch.status, await savedBatch.text()).toBe(200);
  const batchPanel = await request("PUT", "product-panels/" + panelId, {
    ...panel, revision: 1, manifest: {
      ...panel.manifest,
      members: { ...panel.manifest.members,
        approve: { target: { projectionId: batchProjectionId }, inputs: { knowledge: { state: "checked" } } },
      },
    },
  });
  expect(batchPanel.status, await batchPanel.text()).toBe(200);
  const wrongInvocation = await request("POST", "panel-operations/intents", intent);
  expect(wrongInvocation.status).toBe(422);
  expect(await wrongInvocation.json()).toMatchObject({ error: { code: "OPERATION_BATCH_REQUIRED" } });
  const { call, ...operation } = intent;
  const batch = await request("POST", "panel-operations/intents", { ...operation, calls: [call] });
  expect(batch.status, await batch.text()).toBe(200);

  // A published definition may predate the registration check.
  await state.pool!.query(`UPDATE "${state.schema}".product_panels SET definition=$1 WHERE id=$2`, [
    JSON.stringify(unboundPanel), panelId,
  ]);
  const wrongTarget = await request("POST", "panel-operations/intents", intent);
  expect(wrongTarget.status).toBe(422);
  expect(await wrongTarget.json()).toMatchObject({ error: {
    code: "PANEL_OPERATION_TARGET_UNBOUND",
    message: "Operation 'knowledge.approve' expects target input 'knowledge', but member 'approve' does not connect it.",
  } });
});
