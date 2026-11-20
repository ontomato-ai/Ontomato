import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { protectedSkillRef } from "../../core/skills/providers";
import { installContentLayout } from "../../content/layout";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { vuePanelContent } from "../../__tests__/fixtures/vue-panel";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { configureI18n } from "../../i18n";
import { en, enLocaleMeta } from "../../i18n/locales/en";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "", base: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../config/application", () => ({ config: { dataQuery: { get baseUrl() { return state.base; } } } }));
vi.mock("../../config/environment", () => ({ environment: {
  agentRuntime: () => ({ queryServiceToken: "fixture-service" }), publicBasePath: () => "",
  queryBase: () => state.base, queryTimeout: () => 30000,
} }));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: (req: { domainId: string }) => req.domainId,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");
const domainId = "isolation-domain";
const applicationId = "app-panel-isolation";
function page(name: string) {
  return { applicationId, useId: `use-${name}`, panelId: `panel-${name}`, path: `/panels/${name}`,
    entrance: { permissionCode: "panel-menu", pageKey: name } };
}
const good = page("good"), broken = page("broken");
const brokenProjection = "projection-broken";
const privateOperation = "private-stored-operation-body";
const registered = new Set<string>();
let entries = [good, broken];
let denied: string | undefined;
let root: string;
let server: Server;

async function register(collection: string, id: string, definition: object) {
  const response = await fetch(`${state.base}/api/${collection}/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...definition, revision: 0 }),
  });
  expect(response.status, await response.text()).toBe(200);
}

beforeAll(async () => {
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { messages: en, ...enLocaleMeta } } });
  root = await mkdtemp(path.join(tmpdir(), "panel-skill-isolation-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: path.resolve("skills"), prompts: [], runtimeResources: [] });
  state.schema = `panel_skill_isolation_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  const { productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const { registerPanelSkillProvider } = await import("../../services/product-panels/skill-provider");
  registerPanelSkillProvider();
  const app = express();
  app.use(express.json());
  app.post("/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    registered.add(req.body.id);
    res.json({ success: true });
  });
  app.post("/product-governance/check", (req, res) => {
    res.json({ allowed: req.header("tk") === "reader" && registered.has(req.body.id) && denied !== req.body.id });
  });
  app.post("/product-governance/resources", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    res.json({ ids: [...registered].filter(id => id !== denied) });
  });
  app.get("/platform/applications/resolve-entry", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    const entry = entries.find(({ useId, applicationId }) => req.query.useId === useId && req.query.applicationId === applicationId)!;
    res.json({ success: true, data: { applicationId, menu: { groups: [], panelUses: [] },
      use: { id: entry.useId, panelId: entry.panelId, path: entry.path, pageKey: entry.entrance.pageKey,
        access: { permissionCode: entry.entrance.permissionCode } } } });
  });
  app.get("/platform/applications/panel-skill-sources", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("fixture-service");
    expect(req.query.domainId).toBe(domainId);
    res.json({ success: true, data: entries });
  });
  app.get("/platform/page-skills", (req, res) => {
    expect(req.header("tk")).toBe("reader");
    res.json({ success: true, data: { pageSkills: [{ permissionCode: good.entrance.permissionCode }], registeredSkills: [],
      admittedEntrances: entries.map(entry => entry.entrance) } });
  });
  app.use("/api", (req, _res, next) => {
    Object.assign(req, { domainId, userId: "reader", token: "reader", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  app.use("/api/product-projections", productProjectionsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  state.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const entry of entries) {
    const projectionId = `projection-${entry.entrance.pageKey}`;
    await register("product-projections", projectionId, {
      name: "Task list", description: "", visibility: "domain", componentId: "@ontomato/sdk:ObjectList",
      inputs: {}, outputs: {}, config: {}, data: {
        rows: { source: { type: { kind: "PlatformObjectType", id: "platform:ScheduledTask" } }, read: "list", params: {} },
      },
    });
    await register("product-panels", entry.panelId, {
      name: entry.entrance.pageKey, description: "", visibility: "domain", content: vuePanelContent("list"),
      manifest: { state: {}, members: { list: { target: { projectionId } } }, events: {} },
    });
  }
  // Only the stored projection predates the current source contract. Its registered panel, grants and uses stay valid.
  const changed = await state.pool.query(
    `UPDATE "${state.schema}".product_projections SET definition=jsonb_set(definition, '{data}', $3::jsonb)
     WHERE domain_id=$1 AND id=$2`,
    [domainId, brokenProjection, JSON.stringify({ operation: { source: { operation: privateOperation }, read: "describe", params: {} } })],
  );
  expect(changed.rowCount).toBe(1);
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (state.pool) {
    await state.pool.query(`DROP SCHEMA "${state.schema}" CASCADE`);
    await state.pool.end();
  }
  if (root) await rm(root, { recursive: true });
});
beforeEach(() => {
  entries = [good, broken];
  denied = undefined;
});

function read(entry: typeof good, route: string) {
  const { applicationId, useId, entrance, panelId } = entry;
  const query = new URLSearchParams({ applicationId, useId, ...entrance });
  return fetch(`${state.base}/api/product-panels/${panelId}${route}?${query}`);
}

it.each(["", "/snapshot"])("serves the authorized member on GET %s despite a broken sibling", async route => {
  const response = await read(good, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: good.entrance,
    member: { source: { kind: "application-use", applicationId, useId: good.useId }, memberPath: [],
      ref: protectedSkillRef("product-panels", domainId, good.panelId) } });
});

it.each(["", "/snapshot"])("reports the authorized broken projection and field on GET %s", async route => {
  const response = await read(broken, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(502);
  expect(body.error.code).toBe("SKILL_SOURCE_UNAVAILABLE");
  expect(body.error.message).toContain(`Panel '${broken.panelId}'`);
  expect(body.error.message).toContain(`projection '${brokenProjection}'`);
  expect(body.error.message).toMatch(/field 'data\.operation\.source': .+/);
  expect(JSON.stringify(body)).not.toContain(privateOperation);
});

it.each(["", "/snapshot"])("withholds the member on GET %s when its invalid dependency is not granted", async route => {
  denied = brokenProjection;
  const response = await read(broken, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: broken.entrance, member: null });
  expect(JSON.stringify(body)).not.toContain(privateOperation);
});

it.each(["", "/snapshot"])("denies GET %s before exposing the invalid dependency of an inaccessible panel", async route => {
  denied = broken.panelId;
  const response = await read(broken, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(403);
  expect(body.error.code).toBe("PRODUCT_FORBIDDEN");
  expect(JSON.stringify(body)).not.toContain(privateOperation);
});

it.each(["", "/snapshot"])("keeps the displayed panel distinct from its repointed use on GET %s", async route => {
  entries = [{ ...good, panelId: broken.panelId }, broken];
  const response = await read(good, route);
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.panel.id).toBe(good.panelId);
  expect(body.pageSkillContext).toEqual({ mode: "member", locator: good.entrance, member: null });
});
