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
  directPanelSchema, productPanelInUseErrorSchema, productProjectionInUseErrorSchema, productProjectionResponseSchema,
  productProjectionUsedBySchema, registerDirectPanelRequestSchema, registerDirectProjectionRequestSchema,
} from "@ontomato/contracts/product-panels";
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
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  contentRoot = await mkdtemp(join(tmpdir(), "product-panel-references-"));
  installContentLayout({ runtimeRoot: contentRoot, publicSkillsRoot: contentRoot, prompts: [], runtimeResources: [] });
  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  const granted = (token: string | undefined, id: string) =>
    grants.has(id) && (token === "author" || (token === "projection-owner" && id === projectionId));
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
    expect(req.query).toEqual({ domainId: "test-domain", panelId });
    res.json({ success: true, data: [] });
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

  const projection = registerDirectProjectionRequestSchema.parse({
    ...projectionInput, revision: 0,
  });
  const createdProjection = await request("PUT", `product-projections/${projectionId}`, "projection-owner", projection);
  const payload = await createdProjection.json();
  expect(createdProjection.status, JSON.stringify(payload)).toBe(200);
  revision = productProjectionResponseSchema.parse(payload).projection.revision;
  const panel = registerDirectPanelRequestSchema.parse({
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
  expect(directPanelSchema.parse(panelPayload.panel).id).toBe(panelId);
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
  const panel = directPanelSchema.parse((await current.json()).panel);
  const deletion = await request("DELETE", `${resource}?revision=${panel.revision}`, "author");
  const payload = await deletion.json();
  expect(deletion.status, JSON.stringify(payload)).toBe(409);
  expect(productPanelInUseErrorSchema.parse(payload).code).toBe("PRODUCT_IN_USE");
  const retained = await request("GET", resource, "author");
  expect(retained.status).toBe(200);
  expect(directPanelSchema.parse((await retained.json()).panel)).toEqual(panel);
});
