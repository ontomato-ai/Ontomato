import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { APPLICATION, PRODUCT_PANEL, PRODUCT_PROJECTION } from "@ontomato/contracts/platform-object-types";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import { HttpError } from "../../utils/errors";
import { installContentLayout } from "../../content/layout";
import { config } from "../../config/application";
import { createProductPanelReadAdapter, createProductProjectionReadAdapter } from "../../services/product-panels/catalog-reads";

const state = vi.hoisted(() => ({
  pool: undefined as pg.Pool | undefined,
  schema: "",
  use: ["one", "two", "catalogue-panel", "catalogue-data"],
  edit: ["one", "catalogue-data"],
}));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../services/product-governance/grants", async original => ({
  ...await original<typeof import("../../services/product-governance/grants")>(),
  grantedProductIds: async (verb: "use" | "edit") => verb === "use" ? state.use : state.edit,
  requireProductGrant: async (id: string, verb: "use" | "edit") => {
    if (!(verb === "use" ? state.use : state.edit).includes(id))
      throw new HttpError(403, "Denied", "PRODUCT_FORBIDDEN");
  },
}));

vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const owner = { domainId: "domain", userId: "viewer" };
const viewer = { token: "viewer-session" };
const previousQueryUrl = config.dataQuery.baseUrl;
let server: Server;
let root: string;
let base: string;
const applicationId = "app-catalogue";
const entry = { path: `/applications/${applicationId}`, renderer: "panels" };
const publicUse = { id: "shown", pageKey: "shown", path: `${entry.path}/shown`,
  panelId: "catalogue-panel", access: { kind: "domain-member" } };
const hiddenUse = { ...publicUse, id: "hidden", pageKey: "hidden", path: `${entry.path}/hidden`, panelId: "hidden" };
const draftId = "app-14d40829-d7d4-4b14-94bf-11c4c8b12e1b";
const declaration = { names: { en: "Application" }, descriptions: {}, icon: "pages", groups: [], permissions: [] };
const draftValues = { declaration, entry: { ...entry, path: `/applications/${draftId}` },
  entryAccess: ["domain-member"], panelUses: [] };
const entryValues = { entry, panelUses: [publicUse, hiddenUse], framePanelId: "catalogue-panel" };
const identityValues = { names: { en: "Application", fr: "Application française" }, descriptions: { en: "Kept description" }, icon: "pages" };
const writes: { path: string; actor?: string; body: unknown }[] = [];
const content = {
  html: '<div id="app"><p>Test panel</p></div>',
  module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
};
const manifest = { state: {}, members: {}, events: {} };

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  state.schema = `m2_catalogue_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);
  for (const [id, name, ownerId] of [["one", "Alpha directory", "viewer"], ["two", "Beta directory", "author"], ["hidden", "Hidden directory", "author"]]) {
    await state.pool.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
      VALUES ($1,$2,$3,$4)`, [owner.domainId, id, ownerId, { name, content, manifest, description: "", visibility: "private" }]);
  }

  await state.pool.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
    VALUES ($1,'catalogue-panel',$2,$3)`, [owner.domainId, owner.userId, {
    name: "Catalogue host", description: "", visibility: "domain",
    content: { ...content, html: '<div id="app"><projection slot="list"></projection></div>' },
    manifest: { ...manifest, members: { list: { target: { projectionId: "catalogue-data" } } } },
  }]);
  await state.pool.query(`INSERT INTO "${state.schema}".product_projections (domain_id,id,owner_id,definition)
    VALUES ($1,'catalogue-data',$2,$3)`, [owner.domainId, owner.userId, {
    name: "Catalogue data", description: "", visibility: "domain", componentId: "@ontomato/sdk:PanelData",
    inputs: {}, outputs: {}, config: { drawing: { color: "blue", width: 400 } },
    data: {
      listing: { source: { type: { kind: "PlatformObjectType", id: PRODUCT_PANEL } }, read: "query",
        params: { search: { literal: "directory" }, sort: { literal: "name" }, size: { literal: 1 } } },
      apps: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query",
        params: { search: { literal: "App" }, scope: { literal: "visible" }, size: { literal: 4 } } },
      appRecord: { source: { object: { literal: { className: APPLICATION, primaryKey: applicationId } } }, read: "record", params: {} },
      appEntries: { source: { object: { literal: { className: APPLICATION, primaryKey: applicationId } } }, read: "entries", params: {} },
      appDraft: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "form",
        params: { section: { literal: "create" }, target: { literal: { kind: "draft" } } } },
    },
  }]);

  root = await mkdtemp(join(tmpdir(), "m2-catalogue-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  const { productPanelsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  app.get("/java/platform/applications/resolve-entry", (req, res) => {
    expect(req.header("tk")).toBe(viewer.token);
    expect(req.query).toMatchObject({ applicationId, useId: publicUse.id });
    res.json({ success: true, data: { applicationId, use: publicUse, menu: { groups: [], panelUses: [] } } });
  });
  const summary = { id: applicationId, names: declaration.names, descriptions: {}, icon: "pages",
    source: "domain", canMaintain: false, canGrant: false, canEditEntries: false, entryCount: 1 };
  app.get("/java/platform/applications/catalogue", (req, res) => {
    expect(req.header("tk")).toBe(viewer.token);
    expect(req.query).toEqual({ search: "App", scope: "visible", size: "4" });
    res.json({ success: true, data: { rows: [summary] } });
  });
  app.get(`/java/platform/applications/catalogue/${applicationId}`, (req, res) => {
    expect(req.header("tk")).toBe(viewer.token);
    res.json({ success: true, data: { ...summary, entry, panelUses: [publicUse], groups: [] } });
  });
  app.post("/java/platform/applications/catalogue/form", (req, res) => {
    const draft = req.body.section === "create";
    const identity = req.body.section === "identity";
    expect(req.header("tk")).toBe(draft ? viewer.token : "executor");
    expect(req.body.target.kind).toBe(draft ? "draft" : "object");
    res.json({ success: true, data: {
      fields: [], values: draft ? draftValues : identity ? identityValues : entryValues, errors: [],
      save: { method: "PUT",
        path: `/platform/applications/${draft ? draftId : applicationId}/${identity ? "identity" : "panel-uses"}${draft ? "?create=true" : ""}`,
        bodySchema: {}, draftOperation: draft ? "create" : identity ? "saveIdentity" : "saveEntries" },
    } });
  });
  app.put(["/java/platform/applications/:id/panel-uses", "/java/platform/applications/:id/identity"], (req, res) => {
    writes.push({ path: req.originalUrl, actor: req.header("tk"), body: req.body });
    res.json({ success: true });
  });
  app.use("/api/product-panels", (req, _res, next) => {
    Object.assign(req, owner, viewer);
    next();
  }, productPanelsRouter);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.dataQuery.baseUrl = base + "/java";
});

afterAll(async () => {
  config.dataQuery.baseUrl = previousQueryUrl;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) await rm(root, { recursive: true, force: true });
  await state.pool?.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool?.end();
});

it("maps catalogue filters and cursors into the current product listing", async () => {
  const adapter = createProductPanelReadAdapter(owner, viewer);
  const query = { search: "directory", sort: "name", size: 1 };
  const first = panelReadResultSchemas.productPanelList.parse(await adapter.query(query));
  expect(first.items.map(item => item.id)).toEqual(["one"]);
  expect(first.nextCursor).toBeTruthy();
  const next = panelReadResultSchemas.productPanelList.parse(await adapter.query({ ...query, cursor: first.nextCursor! }));
  expect(next.items.map(item => item.id)).toEqual(["two"]);
  const own = panelReadResultSchemas.productPanelList.parse(await adapter.query({ ...query, scope: "mine" }));
  expect(own.items.map(item => item.id)).toEqual(["one"]);
});

it("keeps members and editable form values with their current authorized panel", async () => {
  const adapter = createProductPanelReadAdapter(owner, viewer);
  const record = panelReadResultSchemas.productPanelRecord.parse(await adapter.record("one"));
  expect(record.content).toEqual(content);
  expect(panelReadResultSchemas.productPanelMembers.parse(await adapter.members("one"))).toEqual(record.manifest.members);
  const form = panelReadResultSchemas.panelFormDescription.parse(await adapter.form("one", {}));
  expect(form.values).toMatchObject({ name: "Alpha directory", content, manifest });
  expect(form.fields.find(field => field.path === "/content/module")?.readOnly).toBe(false);
  await expect(adapter.record("hidden")).rejects.toMatchObject({ code: "PRODUCT_FORBIDDEN" });
});

it("uses the registered save operation to write the current panel and refuses a stale revision", async () => {
  const adapter = createProductPanelReadAdapter(owner, viewer);
  const form = await adapter.form("one", {});
  const actor = { owner, credentials: viewer };
  const unusedRequest = async () => { throw new Error("The Node owner should write through its own store"); };
  const host = { initiator: actor, executor: actor, request: unusedRequest, requestWorkbench: unusedRequest };
  const { panelServerOperation } = await import("../../services/product-panels/server-operations");
  const save = panelServerOperation(`${PRODUCT_PANEL}.save`);
  if (save.effect !== "write") throw new Error("Expected a write operation");
  const target = { kind: "object" as const, objectType: PRODUCT_PANEL, primaryKey: "one" };
  const input = {
    values: { ...form.values, name: "Alpha revised directory", description: "An unsubmitted stale description" },
    submittedFields: ["/name"], revision: form.revision,
  };

  expect(await save.execute(host, target, input, "first-save")).toMatchObject({
    kind: "success", data: { id: "one" }, affected: { objects: [{ objectType: PRODUCT_PANEL, primaryKey: "one" }] },
  });
  expect(await save.execute(host, target, { ...input, values: { ...input.values, name: "Stale edit" } }, "stale-save"))
    .toMatchObject({ kind: "refusal", code: "PRODUCT_CONFLICT" });
  expect(await adapter.record("one")).toMatchObject({
    name: "Alpha revised directory", description: "", content, manifest, revision: 2,
  });
  expect(await save.execute(host, target, { values: { name: "Unused" }, submittedFields: [], revision: 2 }, "no-edit"))
    .toMatchObject({ kind: "success" });
  expect(await adapter.record("one")).toMatchObject({ name: "Alpha revised directory", revision: 2 });
});

async function readCatalogue(dataName: string) {
  const response = await fetch(base + "/api/product-panels/read", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: { kind: "registered", applicationId, useId: publicUse.id },
      memberPath: [{ member: "list" }], inputs: {}, dataName,
    }),
  });
  expect(response.status).toBe(200);
  const result = productPanelReadResponseSchema.parse(await response.json());
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.value;
}

it("dispatches catalogue query through the real panel HTTP path to PostgreSQL", async () => {
  expect(await readCatalogue("listing")).toMatchObject({ items: [{ id: "one" }], nextCursor: expect.any(String) });
});

it("dispatches application reads from current PostgreSQL records and preserves the complete table when an executor changes it", async () => {
  expect(await readCatalogue("apps")).toMatchObject({ rows: [{ id: applicationId }] });
  expect(await readCatalogue("appRecord")).toMatchObject({ id: applicationId, canMaintain: false, panelUses: [publicUse] });
  expect(await readCatalogue("appEntries")).toEqual({ applicationId, entry, panelUses: [publicUse] });

  const actor = { owner, credentials: viewer };
  const executor = { owner, credentials: { token: "executor" } };
  const unusedRequest = async () => { throw new Error("The application owner has its own HTTP client"); };
  const host = { initiator: actor, executor, request: unusedRequest, requestWorkbench: unusedRequest };
  const { panelServerOperation } = await import("../../services/product-panels/server-operations");
  const add = panelServerOperation("applications.addEntry");
  const save = panelServerOperation(`${APPLICATION}.save`);
  if (add.effect !== "write" || save.effect !== "write") throw new Error("Expected write operations");
  const added = { ...publicUse, id: "added", pageKey: "added", path: `${entry.path}/added` };
  await expect(add.execute(host, { kind: "object", objectType: APPLICATION, primaryKey: applicationId }, { entry: added }, "add"))
    .resolves.toMatchObject({ kind: "success" });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${applicationId}/panel-uses`, actor: "executor",
    body: { ...entryValues, panelUses: [publicUse, hiddenUse, added] },
  });

  const draft = panelReadResultSchemas.panelFormDescription.parse(await readCatalogue("appDraft"));
  await expect(save.execute(host, { kind: "draft" }, { values: draft.values, submittedFields: ["/declaration/names"] }, "create"))
    .resolves.toMatchObject({ kind: "success", data: { id: draftId } });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${draftId}/panel-uses?create=true`, actor: "executor", body: draftValues,
  });
});

it("updates only the submitted projection configuration field in PostgreSQL", async () => {
  const adapter = createProductProjectionReadAdapter(owner, viewer);
  const before = await adapter.record("catalogue-data");
  const actor = { owner, credentials: viewer };
  const unusedRequest = async () => { throw new Error("The Node owner should write through its own store"); };
  const host = { initiator: actor, executor: actor, request: unusedRequest, requestWorkbench: unusedRequest };
  const { panelServerOperation } = await import("../../services/product-panels/server-operations");
  const save = panelServerOperation(`${PRODUCT_PROJECTION}.save`);
  if (save.effect !== "write") throw new Error("Expected a write operation");
  const target = { kind: "object" as const, objectType: PRODUCT_PROJECTION, primaryKey: before.id };

  await expect(save.execute(host, target, {
    values: { config: { drawing: { color: "orange", width: 1 } } },
    submittedFields: ["/config/drawing/color"], revision: before.revision,
  }, "projection-save")).resolves.toMatchObject({ kind: "success" });
  expect(await adapter.record(before.id)).toMatchObject({
    name: before.name, data: before.data, componentId: before.componentId,
    config: { drawing: { color: "orange", width: 400 } },
  });
});

it.each(["identity", "entries"] as const)("submits only the changed application %s field without losing owner values", async section => {
  const actor = { owner, credentials: viewer };
  const executor = { owner, credentials: { token: "executor" } };
  const unusedRequest = async () => { throw new Error("The application owner has its own HTTP client"); };
  const host = { initiator: actor, executor, request: unusedRequest, requestWorkbench: unusedRequest };
  const { panelServerOperation } = await import("../../services/product-panels/server-operations");
  const save = panelServerOperation(`${APPLICATION}.save`);
  if (save.effect !== "write") throw new Error("Expected a write operation");
  const target = { kind: "object" as const, objectType: APPLICATION, primaryKey: applicationId };
  const path = `${entry.path}/renamed`;
  const input = section === "identity"
    ? { values: { names: { en: "Renamed", fr: "Stale name" } }, submittedFields: ["/names/en"] }
    : { values: { panelUses: [{ path }] }, submittedFields: ["/panelUses/0/path"] };

  await expect(save.execute(host, target, input, `partial-${section}`)).resolves.toMatchObject({ kind: "success" });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${applicationId}/${section === "identity" ? "identity" : "panel-uses"}`, actor: "executor",
    body: section === "identity"
      ? { ...identityValues, names: { ...identityValues.names, en: "Renamed" } }
      : { ...entryValues, panelUses: [{ ...publicUse, path }, hiddenUse] },
  });
});
