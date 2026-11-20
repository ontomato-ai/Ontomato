import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  productPanelInUseErrorSchema, productPanelResponseSchema, productPanelUsedBySchema,
  productProjectionInUseErrorSchema, productProjectionResponseSchema,
  productProjectionUsedBySchema, registerProductPanelRequestSchema, registerProductProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
import {
  panelPersonalStateReadRequestSchema, panelPersonalStateResponseSchema, panelPersonalStateWriteRequestSchema,
} from "@ontomato/contracts/panel-host";
import { panelDefinitionSnapshotSchema } from "@ontomato/contracts/product-subscriptions";
import { ensureAssistantSchema } from "../../infrastructure/postgres-migrations/20261028-assistant/schema";
import { installContentLayout } from "../../content/layout";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { errorHandler } from "../middleware/error-handler";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: { agentRuntime: () => ({ queryServiceToken: "fixture-service" }) } }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const projectionId = "projection-referenced";
const panelId = "panel-referencing";
const personalPanelId = "panel-personal";
const personalChildId = "panel-personal-child";
const snapshotPanelId = "panel-snapshot-test";
const grants = new Set<string>();
let server: Server | undefined;
let contentRoot: string;
let revision: number;
const portType = { kind: "scalar", type: "string" } as const;
const projectionInput = {
  name: "Referenced projection", description: "", visibility: "domain",
  componentId: "@ontomato/sdk:ObjectSummary",
  inputs: { caption: portType }, outputs: { selected: portType }, data: {}, config: {},
};

beforeAll(async () => {
  state.schema = `product_panel_references_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureAssistantSchema(state.pool);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  contentRoot = await mkdtemp(join(tmpdir(), "product-panel-references-"));
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });
  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  const granted = (token: string | undefined, id: string) =>
    grants.has(id) && (token === "author" || (token === "projection-owner" && (id === projectionId || id.startsWith("ports-"))) || (id === personalPanelId || id === personalChildId) || id === snapshotPanelId || id === "visible-projection");
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: granted(req.header("tk"), req.body.id) });
  });
  app.post("/product-governance/resources", (req, res) => {
    res.json({ ids: [...grants].filter(id => granted(req.header("tk"), id)) });
  });
  app.post("/product-governance/unregister", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    grants.delete(req.body.id);
    res.json({ success: true });
  });
  app.get("/platform/applications/panel-uses/by-panel", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    expect(req.query.domainId).toBe("test-domain");
    res.json({ success: true, data: [] });
  });
  app.get("/platform/applications/app-personal/panel-uses", (_req, res) => {
    res.json({ success: true, data: {
      applicationId: "app-personal", entry: { path: "/applications/app-personal", renderer: "panels" },
      panelUses: [{ id: "main", pageKey: "main", path: "/applications/app-personal/main",
        panelId: personalPanelId, access: { kind: "domain-member" } }],
    } });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    expect(req.query.path).toBe("/applications/app-personal/main");
    res.json({ success: true, data: {
      applicationId: "app-personal", menu: { groups: [], panelUses: [] },
      use: { id: "main", pageKey: "main", path: "/applications/app-personal/main",
        panelId: personalPanelId, access: { kind: "domain-member" } },
    } });
  });
  app.use("/api", (req, _res, next) => {
    const userId = req.header("X-Test-User") ?? "author";
    Object.assign(req, { domainId: "test-domain", userId, token: userId, locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  app.use(errorHandler);
  server = await new Promise<Server>(resolve => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const projection = registerProductProjectionRequestSchema.parse({
    ...projectionInput, revision: 0,
  });
  const createdProjection = await request("PUT", `product-projections/${projectionId}`, "projection-owner", projection);
  const payload = await createdProjection.json();
  expect(createdProjection.status, JSON.stringify(payload)).toBe(200);
  revision = productProjectionResponseSchema.parse(payload).projection.revision;
  const panel = registerProductPanelRequestSchema.parse({
    name: "Referencing panel", description: "", visibility: "private", revision: 0,
    content: { html: '<panel-member ref="summary"></panel-member>' },
    manifest: {
      state: { caption: { type: portType }, selected: { type: portType } },
      members: { summary: { target: { projectionId }, inputs: { caption: { state: "caption" } },
        outputs: { selected: { state: "selected" } } } },
      events: {},
    },
  });
  const createdPanel = await request("PUT", `product-panels/${panelId}`, "author", panel);
  const panelPayload = await createdPanel.json();
  expect(createdPanel.status, JSON.stringify(panelPayload)).toBe(200);
  expect(productPanelResponseSchema.parse(panelPayload).panel.id).toBe(panelId);
});

afterAll(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
  await rm(contentRoot, { recursive: true });
});

function request(method: string, resource: string, user: string, body?: object) {
  return fetch(`${state.base}/api/${resource}`, {
    method, headers: { "Content-Type": "application/json", "X-Test-User": user }, body: JSON.stringify(body),
  });
}

it("counts a direct member in projection used-by and keeps the hidden panel's identity private", async () => {
  const resource = `product-projections/${projectionId}/used-by`;
  const visible = await request("GET", resource, "author");
  const hidden = await request("GET", resource, "projection-owner");
  expect(visible.status).toBe(200);
  expect(hidden.status).toBe(200);
  expect(productProjectionUsedBySchema.parse(await visible.json())).toEqual({
    panels: [{ id: panelId, name: "Referencing panel" }], hiddenCount: 0,
  });
  expect(productProjectionUsedBySchema.parse(await hidden.json())).toEqual({ panels: [], hiddenCount: 1 });
});

it("rejects deletion when a direct member references the projection, even for a hidden panel", async () => {
  const resource = `product-projections/${projectionId}`;
  const deletion = await request("DELETE", `${resource}?revision=${revision}`, "projection-owner");
  const payload = await deletion.json();
  expect(deletion.status, JSON.stringify(payload)).toBe(409);
  expect(productProjectionInUseErrorSchema.parse(payload).details).toEqual({ panels: [], hiddenCount: 1 });
  const current = await request("GET", resource, "projection-owner");
  expect(current.status).toBe(200);
  expect(productProjectionResponseSchema.parse(await current.json()).projection.revision).toBe(revision);
});

it("rejects deleting a panel that is the current detail for a class", async () => {
  await state.pool!.query(
    `INSERT INTO "${state.schema}".product_object_details (domain_id, class_name, panel_id, updated_by) VALUES ($1,$2,$3,$4)`,
    ["test-domain", "Teacher", panelId, "author"],
  );
  const resource = `product-panels/${panelId}`;
  const current = await request("GET", resource, "author");
  const panel = productPanelResponseSchema.parse(await current.json()).panel;
  const usedBy = await request("GET", `${resource}/used-by`, "author");
  expect(usedBy.status).toBe(200);
  const usage = productPanelUsedBySchema.parse(await usedBy.json());
  expect(usage.classNames).toEqual(["Teacher"]);
  const deletion = await request("DELETE", `${resource}?revision=${panel.revision}`, "author");
  const payload = await deletion.json();
  expect(deletion.status, JSON.stringify(payload)).toBe(409);
  expect(productPanelInUseErrorSchema.parse(payload).details).toEqual(usage);
  const retained = await request("GET", resource, "author");
  expect(retained.status).toBe(200);
  expect(productPanelResponseSchema.parse(await retained.json()).panel).toEqual(panel);
});

async function savePanel(id: string, manifest: object, revision: number = 0) {
  return request("PUT", `product-panels/${id}`, "author", registerProductPanelRequestSchema.parse({
    name: id, description: "", visibility: "domain", revision, content: { html: "<div></div>" }, manifest,
  }));
}

it("rejects a reverse cycle and protects a nested panel referenced by its parent", async () => {
  const leafId = "panel-cycle-leaf", parentId = "panel-cycle-parent";
  const manifest = { state: {}, members: {}, events: {} };
  const leafResponse = await savePanel(leafId, manifest);
  expect(leafResponse.status).toBe(200);
  const leaf = productPanelResponseSchema.parse(await leafResponse.json()).panel;
  const parentResponse = await savePanel(parentId, { ...manifest, members: { leaf: { target: { panelId: leafId } } } });
  expect(parentResponse.status).toBe(200);
  const update = await savePanel(leafId, { ...manifest, members: { parent: { target: { panelId: parentId } } } }, leaf.revision);
  const error = await update.text();
  expect(update.status, error).toBe(409);
  expect(error).toContain("PANEL_REFERENCE_CYCLE");
  expect(error).toContain("parent");
  expect(error).toContain("leaf");
  const deleted = await request("DELETE", `product-panels/${leafId}?revision=${leaf.revision}`, "author");
  expect(deleted.status).toBe(409);
  expect(productPanelInUseErrorSchema.parse(await deleted.json()).details.panels).toEqual([{ id: parentId, name: parentId }]);
});

it("writes declared personal state under the authenticated viewer and isolates it from another viewer", async () => {
  const child = await savePanel(personalChildId, {
    state: { chosen: { type: portType, personal: true }, transient: { type: portType } }, members: {}, events: {},
  });
  expect(child.status, await child.text()).toBe(200);
  const target = { panelId: personalChildId };
  const root = await savePanel(personalPanelId, { state: {}, members: { left: { target }, right: { target } }, events: {} });
  expect(root.status, await root.text()).toBe(200);
  const source = { kind: "registered", applicationId: "app-personal", useId: "main" };
  const write = (user: string, member: string, values: object) => request("PUT", "product-panels/personal-state", user,
    panelPersonalStateWriteRequestSchema.parse({ source, memberPath: [{ member }], values }));
  const read = (user: string, member: string) => request("POST", "product-panels/personal-state/read", user,
    panelPersonalStateReadRequestSchema.parse({ source, memberPath: [{ member }], fields: ["chosen"] }));
  expect((await write("author", "left", { chosen: "left choice" })).status).toBe(200);
  expect((await write("author", "right", { chosen: "right choice" })).status).toBe(200);
  expect((await write("author", "left", { chosen: "changed", transient: "invalid" })).status).toBe(400);

  for (const [user, member, values] of [
    ["author", "left", { chosen: "left choice" }],
    ["author", "right", { chosen: "right choice" }],
    ["another-viewer", "left", {}],
  ] as const) {
    const response = await read(user, member);
    expect(response.status).toBe(200);
    expect(panelPersonalStateResponseSchema.parse(await response.json())).toEqual({ values });
  }
  expect((await read("author", "undeclared")).status).toBe(403);
});

it.each([
  ["input", { inputs: { caption: { kind: "scalar", type: "number" } } }, "caption"],
  ["output", { outputs: {} }, "selected"],
] as const)("rejects breaking a private parent's connected %s", async (suffix, change, port) => {
  const id = `ports-${suffix}`, resource = `product-projections/${id}`;
  const beforeSave = await request("PUT", resource, "projection-owner",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, revision: 0 }));
  expect(beforeSave.status).toBe(200);
  const before = productProjectionResponseSchema.parse(await beforeSave.json()).projection;
  const parent = `panel-ports-${suffix}`;
  const attached = await savePanel(parent, {
    state: { caption: { type: portType }, selected: { type: portType } },
    members: { summary: { target: { projectionId: id }, inputs: { caption: { state: "caption" } },
      outputs: { selected: { state: "selected" } } } },
    events: {},
  });
  expect(attached.status).toBe(200);
  const update = await request("PUT", resource, "projection-owner",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, ...change, revision: before.revision }));
  const payload = await update.text();
  expect(update.status, payload).toBe(409);
  expect(payload).toContain("PRODUCT_PORT_IN_USE");
  expect(payload).toContain(port);
  expect(payload).not.toContain(parent);
  const after = await request("GET", resource, "projection-owner");
  expect(productProjectionResponseSchema.parse(await after.json()).projection).toEqual(before);
});

it("returns a forbidden member in the snapshot alongside the authorized sibling", async () => {
  const id = "visible-projection";
  const visible = await request("PUT", `product-projections/${id}`, "author",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, revision: 0 }));
  expect(visible.status).toBe(200);
  const saved = await savePanel(snapshotPanelId, { state: {}, events: {}, members: {
    shown: { target: { projectionId: id } }, hidden: { target: { projectionId } },
  } });
  expect(saved.status).toBe(200);
  const response = await request("GET", `product-panels/${snapshotPanelId}/snapshot`, "another-viewer");
  expect(response.status).toBe(200);
  const snapshot = panelDefinitionSnapshotSchema.parse(await response.json());
  expect(snapshot.members).toEqual(expect.arrayContaining([
    { status: "forbidden", memberPath: [{ member: "hidden" }] },
    { status: "ready", memberPath: [{ member: "shown" }], target: { kind: "projection", id }, revision: 1 },
  ]));
  expect(snapshot.projections).toEqual([{ id, revision: 1 }]);
});

it("re-registers a projection then its panel while other stored SDK panels still reference it", async () => {
  const target = "legacy-rollover-projection", replacing = "legacy-rollover-panel", waiting = "legacy-waiting-panel";
  const db = state.pool!;
  await db.query(`INSERT INTO "${state.schema}".product_projections (domain_id,id,owner_id,definition) VALUES ($1,$2,$3,$4)`,
    ["test-domain", target, "author", {
      name: "Original projection", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectSummary",
      binding: { kind: "ObjectType", id: "Teacher" }, inputs: { caption: portType }, display: {},
    }]);
  const old = {
    name: "Old SDK panel", description: "", visibility: "private", sdkVersion: "1.0.0",
    content: { html: '<PanelSlot name="body"></PanelSlot>', module: "export default {};" },
    manifest: {
      state: { caption: { ...portType, deepLink: false } },
      slots: { body: { projectionId: target, inputs: { caption: { state: "caption" } } } },
      operations: [],
    },
  };
  for (const id of [replacing, waiting]) {
    await db.query(`INSERT INTO "${state.schema}".product_panels (domain_id,id,owner_id,definition) VALUES ($1,$2,$3,$4)`,
      ["test-domain", id, "author", old]);
    grants.add(id);
  }
  grants.add(target);
  const projection = await request("PUT", `product-projections/${target}`, "author",
    registerProductProjectionRequestSchema.parse({ ...projectionInput, revision: 1 }));
  const projectionPayload = await projection.json();
  expect(projection.status, JSON.stringify(projectionPayload)).toBe(200);
  expect(productProjectionResponseSchema.parse(projectionPayload).projection.revision).toBe(2);

  const panel = await savePanel(replacing, {
    state: { caption: { type: portType } }, events: {},
    members: { body: { target: { projectionId: target }, inputs: { caption: { state: "caption" } } } },
  }, 1);
  const panelPayload = await panel.json();
  expect(panel.status, JSON.stringify(panelPayload)).toBe(200);
  expect(productPanelResponseSchema.parse(panelPayload).panel.revision).toBe(2);
  const usedBy = await request("GET", `product-projections/${target}/used-by`, "author");
  expect(usedBy.status).toBe(200);
  const usage = productProjectionUsedBySchema.parse(await usedBy.json());
  expect(new Set(usage.panels.map(({ id }) => id))).toEqual(new Set([replacing, waiting]));
});
