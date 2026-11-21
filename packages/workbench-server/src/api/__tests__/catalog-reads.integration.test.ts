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
import { ensurePanelOperationsSchema } from "../../infrastructure/postgres-migrations/20261118-panel-operations/schema";
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
const formReads: unknown[] = [];
const createdApplications = new Set([applicationId]);
const content = {
  html: '<div id="app"><p>Test panel</p></div>',
  module: 'import { mountPanel } from "@ontomato/sdk/panel";\nawait mountPanel({});',
};
const manifest = { state: {}, members: {}, commands: {} };

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
  await ensurePanelOperationsSchema(state.pool);
  for (const [id, name, ownerId] of [["one", "Alpha directory", "viewer"], ["two", "Beta directory", "author"], ["hidden", "Hidden directory", "author"]]) {
    await state.pool.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
      VALUES ($1,$2,$3,$4)`, [owner.domainId, id, ownerId, {
        name, content, manifest, description: "", visibility: "private", ...(id !== "hidden" && { template: true }),
      }]);
  }

  await state.pool.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
    VALUES ($1,'catalogue-panel',$2,$3)`, [owner.domainId, owner.userId, {
    name: "Aardvark catalogue host", description: "", visibility: "domain",
    content: { ...content, html: '<div id="app"><projection slot="list"></projection></div>' },
    manifest: {
      ...manifest,
      state: { application: { type: { kind: "object", objectType: APPLICATION },
        deepLink: false, external: false, personal: false, default: null } },
      members: { list: { target: { projectionId: "catalogue-data" }, inputs: { application: { state: "application" } } } },
    },
  }]);
  await state.pool.query(`INSERT INTO "${state.schema}".product_projections (domain_id,id,owner_id,definition)
    VALUES ($1,'catalogue-data',$2,$3)`, [owner.domainId, owner.userId, {
    name: "Catalogue data", description: "", visibility: "domain", componentId: "@ontomato/sdk:PanelData",
    inputs: {
      application: { kind: "object", objectType: APPLICATION },
      panel: { kind: "object", objectType: PRODUCT_PANEL },
      projection: { kind: "object", objectType: PRODUCT_PROJECTION },
      cursor: { kind: "scalar", type: "string" },
      section: { kind: "scalar", type: "string" },
      values: { kind: "json" },
      changedField: { kind: "scalar", type: "string" },
    },
    operations: { save: { operation: { kind: "PlatformOperation", id: `${APPLICATION}.save` }, target: { input: "application" } } },
    outputs: {}, config: { drawing: { color: "blue", width: 400 } },
    data: {
      listing: { source: { type: { kind: "PlatformObjectType", id: PRODUCT_PANEL } }, read: "query",
        params: { search: { literal: "directory" }, sort: { literal: "name" }, size: { literal: 1 } } },
      templates: { source: { type: { kind: "PlatformObjectType", id: PRODUCT_PANEL } }, read: "query",
        params: { sort: { literal: "name" }, size: { literal: 1 }, cursor: { input: "cursor" } } },
      panelGrants: { source: { object: { input: "panel" } }, read: "grants", params: {} },
      projectionGrants: { source: { object: { input: "projection" } }, read: "grants", params: {} },
      apps: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "query",
        params: { search: { literal: "App" }, scope: { literal: "visible" }, size: { literal: 4 } } },
      appRecord: { source: { object: { literal: { className: APPLICATION, primaryKey: applicationId } } }, read: "record", params: {} },
      appEntries: { source: { object: { literal: { className: APPLICATION, primaryKey: applicationId } } }, read: "entries", params: {} },
      appDraft: { source: { type: { kind: "PlatformObjectType", id: APPLICATION } }, read: "createForm",
        params: { values: { input: "values" }, changedField: { input: "changedField" } } },
      appForm: { source: { object: { input: "application" } }, read: "form",
        params: { section: { input: "section" }, values: { input: "values" }, changedField: { input: "changedField" } } },
    },
  }]);

  root = await mkdtemp(join(tmpdir(), "m2-catalogue-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  const { productPanelsRouter, panelOperationsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  app.get("/java/platform/applications/resolve-entry", (req, res) => {
    expect([viewer.token, "executor"]).toContain(req.header("tk"));
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
  app.post("/java/product-governance/grants", (req, res) => {
    expect(req.header("tk")).toBe(viewer.token);
    if (!state.edit.includes(req.body.id)) {
      res.status(403).json({ success: false, message: "Edit Grant required" });
      return;
    }
    const grants = [{ principalKind: "principal", principalId: owner.userId, verb: "edit" }];
    if (req.body.id === "one") grants.push({ principalKind: "domain", principalId: "*", verb: "use" });
    res.json({ grants });
  });
  app.post("/java/platform/applications/catalogue/form", (req, res) => {
    const draft = req.body.section === "create";
    const identity = req.body.section === "identity";
    expect(req.header("tk")).toBe(draft ? viewer.token : "executor");
    expect(req.body.target.kind).toBe(draft ? "draft" : "object");
    formReads.push(req.body);
    res.json({ success: true, data: {
      fields: [], values: req.body.values ?? (draft ? draftValues : identity ? identityValues : entryValues), errors: [],
      save: { method: "PUT",
        path: `/platform/applications/${draft ? draftId : applicationId}/${identity ? "identity" : "panel-uses"}${draft ? "?create=true" : ""}`,
        bodySchema: {}, draftOperation: draft ? "create" : identity ? "saveIdentity" : "saveEntries" },
    } });
  });
  app.put(["/java/platform/applications/:id/panel-uses", "/java/platform/applications/:id/identity"], (req, res) => {
    if (req.query.create === "true") {
      if (createdApplications.has(req.params.id)) {
        res.status(409).json({ success: false, message: "Application already exists" });
        return;
      }
      createdApplications.add(req.params.id);
    }
    writes.push({ path: req.originalUrl, actor: req.header("tk"), body: req.body });
    res.json({ success: true });
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, owner, { token: req.header("tk") ?? viewer.token });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api", panelOperationsRouter);
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

function post(path: string, body: unknown, token = viewer.token) {
  return fetch(base + "/api/" + path, { method: "POST",
    headers: { "Content-Type": "application/json", tk: token }, body: JSON.stringify(body) });
}

async function readCatalogueResult(dataName: string, inputs: Record<string, unknown>, token?: string, runtimeParams?: Record<string, unknown>) {
  const response = await post("product-panels/read", {
    source: { kind: "registered", applicationId, useId: publicUse.id },
    memberPath: [{ member: "list" }], inputs, dataName, runtimeParams,
  }, token);
  expect(response.status).toBe(200);
  return productPanelReadResponseSchema.parse(await response.json());
}

async function readCatalogue(dataName: string, inputs: Record<string, unknown> = {}, token?: string, runtimeParams?: Record<string, unknown>) {
  const result = await readCatalogueResult(dataName, inputs, token, runtimeParams);
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.value;
}

it("dispatches catalogue query through the real panel HTTP path to PostgreSQL", async () => {
  expect(await readCatalogue("listing")).toMatchObject({ items: [{ id: "one" }], nextCursor: expect.any(String) });
});

it("reports an unreadable panel beside healthy results without losing its stored references", async () => {
  const id = "legacy-directory";
  await state.pool!.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition)
    VALUES ($1,$2,$3,$4)`, [owner.domainId, id, owner.userId, {
    name: "A legacy directory", description: "", visibility: "private", content,
    manifest: { state: {}, events: {}, members: { child: { target: { panelId: "one" } } } },
  }]);
  state.use.push(id);
  try {
    const { registerBuiltinProducts } = await import("../../services/product-panels/builtin-products");
    await registerBuiltinProducts();
    const response = await fetch(`${base}/api/product-panels?q=directory&sort=name&limit=1`);
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(first).toMatchObject({ items: [], unavailableItems: [{ id, reason: expect.stringContaining("manifest.commands") }] });
    expect(first.nextCursor).toBeTruthy();
    const next = await fetch(`${base}/api/product-panels?q=directory&sort=name&limit=1&cursor=${first.nextCursor}`);
    expect(await next.json()).toMatchObject({ items: [{ id: "one" }] });
    expect(await readCatalogue("listing")).toMatchObject({
      items: [], unavailableItems: [{ id, reason: expect.stringContaining("manifest.commands") }],
    });
    const { findPanelUsers } = await import("../../services/product-panels/references");
    expect(await findPanelUsers(owner.domainId, "panel", "one")).toEqual([{ id, name: "A legacy directory" }]);
  } finally {
    state.use.splice(state.use.indexOf(id), 1);
    await state.pool!.query(`DELETE FROM "${state.schema}".product_panels WHERE id=$1`, [id]);
  }
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
  if (add.effect !== "write") throw new Error("Expected a write operation");
  const added = { ...publicUse, id: "added", pageKey: "added", path: `${entry.path}/added` };
  await expect(add.execute(host, { kind: "object", objectType: APPLICATION, primaryKey: applicationId }, { entry: added }, "add"))
    .resolves.toMatchObject({ kind: "success" });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${applicationId}/panel-uses`, actor: "executor",
    body: { ...entryValues, panelUses: [publicUse, hiddenUse, added] },
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

async function submitApplicationForm(target: { kind: "draft" } | { kind: "object"; objectType: string; primaryKey: string },
  input: { values: unknown; submittedFields: string[] }, token?: string,
) {
  const prepared = await post("panel-operations/intents", {
    applicationId, useId: publicUse.id, operationId: "list.save", call: { target, input },
  }, token);
  expect(prepared.status, await prepared.clone().text()).toBe(200);
  const { intentId } = await prepared.json();
  const dispatched = await post(`panel-operations/intents/${intentId}/dispatch`, {}, token);
  expect(dispatched.status, await dispatched.clone().text()).toBe(200);
  return dispatched.json();
}

it("reuses the allocated draft ID and dispatches a create-only application save through the panel", async () => {
  const initial = panelReadResultSchemas.panelFormDescription.parse(await readCatalogue("appDraft"));
  expect(formReads.at(-1)).toMatchObject({ section: "create", target: { kind: "draft" } });
  expect(formReads.at(-1)).not.toHaveProperty("target.id");
  expect(initial.values.id).toBe(draftId);

  const values = { ...initial.values, entry: { ...draftValues.entry, path: `${entry.path}/edited` } };
  const refreshed = panelReadResultSchemas.panelFormDescription.parse(
    await readCatalogue("appDraft", { values, changedField: "/entry/path" }),
  );
  expect(formReads.at(-1)).toMatchObject({ section: "create", target: { kind: "draft", id: draftId }, changedField: "/entry/path" });
  expect(formReads.at(-1)).not.toHaveProperty("values.id");
  expect(refreshed).toMatchObject({ values, save: { path: initial.save.path } });

  const args = { values: initial.values, submittedFields: ["/declaration/names"] };
  expect(await submitApplicationForm({ kind: "draft" }, args))
    .toMatchObject({ kind: "dispatched", outcome: { kind: "success", data: { id: draftId } } });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${draftId}/panel-uses?create=true`, actor: viewer.token, body: draftValues,
  });
  const writesAfterCreation = writes.length;
  expect(await submitApplicationForm({ kind: "draft" }, args)).toMatchObject({ outcome: { kind: "refusal" } });
  expect(writes).toHaveLength(writesAfterCreation);
});

it("reads both edit forms for the selected application and accepts only the submitted field", async () => {
  const application = { className: APPLICATION, primaryKey: applicationId };
  const target = { kind: "object" as const, objectType: APPLICATION, primaryKey: applicationId };
  const identity = panelReadResultSchemas.panelFormDescription.parse(
    await readCatalogue("appForm", { application, section: "identity" }, "executor"),
  );
  expect(formReads.at(-1)).toMatchObject({ section: "identity", target });
  expect(identity.values).toEqual(identityValues);
  expect(await submitApplicationForm(target, {
    values: { names: { en: "Renamed", fr: "Stale form name" } }, submittedFields: ["/names/en"],
  }, "executor")).toMatchObject({ outcome: { kind: "success" } });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${applicationId}/identity`, actor: "executor",
    body: { ...identityValues, names: { ...identityValues.names, en: "Renamed" } },
  });

  const entries = panelReadResultSchemas.panelFormDescription.parse(
    await readCatalogue("appForm", { application, section: "entries" }, "executor"),
  );
  expect(formReads.at(-1)).toMatchObject({ section: "entries", target });
  expect(entries.values).toEqual(entryValues);
  const path = `${entry.path}/new-entry-path`;
  expect(await submitApplicationForm(target, {
    values: { panelUses: [{ path }] }, submittedFields: ["/panelUses/0/path"],
  }, "executor")).toMatchObject({ outcome: { kind: "success" } });
  expect(writes.at(-1)).toEqual({
    path: `/java/platform/applications/${applicationId}/panel-uses`, actor: "executor",
    body: { ...entryValues, panelUses: [{ ...publicUse, path }, hiddenUse] },
  });

  const reads = formReads.length;
  expect(await readCatalogueResult("appForm", { application, section: "create" }, "executor"))
    .toMatchObject({ status: "error" });
  expect(formReads).toHaveLength(reads);
});

it("checks partial application drafts against Java's current identity and entry table without writing", async () => {
  const application = { className: APPLICATION, primaryKey: applicationId };
  const writesBefore = writes.length;
  const cases = [
    { section: "identity", values: { icon: "folder" }, expected: { ...identityValues, icon: "folder" } },
    { section: "entries", values: { panelUses: [hiddenUse] }, expected: { ...entryValues, panelUses: [hiddenUse] } },
  ];
  for (const { section, values, expected } of cases) {
    const checked = await readCatalogue("appForm", { application, section, values }, "executor");
    expect(formReads.at(-1)).toMatchObject({ section, values: expected });
    expect(checked).toMatchObject({ values: expected, errors: [] });
  }
  expect(writes).toHaveLength(writesBefore);
});

it("requires edit for grant reads and derives domain sharing from the owner Grants", async () => {
  expect(await readCatalogueResult("panelGrants", { panel: { className: PRODUCT_PANEL, primaryKey: "two" } }))
    .toEqual({ status: "forbidden" });
  expect(await readCatalogue("panelGrants", { panel: { className: PRODUCT_PANEL, primaryKey: "one" } })).toEqual({
    grants: [{ principalKind: "principal", principalId: owner.userId, verb: "edit" },
      { principalKind: "domain", principalId: "*", verb: "use" }],
    shared: true,
  });
  expect(await readCatalogue("projectionGrants", {
    projection: { className: PRODUCT_PROJECTION, primaryKey: "catalogue-data" },
  })).toEqual({ grants: [{ principalKind: "principal", principalId: owner.userId, verb: "edit" }], shared: false });
});

it("filters panel templates in PostgreSQL before scanning cursor pages", async () => {
  const first = panelReadResultSchemas.productPanelList.parse(await readCatalogue("templates", {}, undefined, { template: true }));
  expect(first.items.map(item => ({ id: item.id, template: item.template }))).toEqual([{ id: "one", template: true }]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = panelReadResultSchemas.productPanelList.parse(await readCatalogue("templates", { cursor: first.nextCursor }, undefined, { template: true }));
  expect(second.items.map(item => ({ id: item.id, template: item.template }))).toEqual([{ id: "two", template: true }]);
  expect(second.nextCursor).toBeNull();
});
