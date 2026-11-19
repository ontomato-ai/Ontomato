import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  productPanelInUseErrorSchema, productPanelListResponseSchema, productPanelResponseSchema,
  productProjectionInUseErrorSchema, productProjectionListResponseSchema, productProjectionResponseSchema,
} from "@ontomato/contracts/product-panels";
import { config } from "../../../config/application";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { CurrentProductRow } from "../../../infrastructure/product-current";

const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: db.query, connect: async () => db }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

type Verb = "use" | "edit";
type Grant = { principalKind: "principal" | "role" | "domain"; principalId: string; verb: Verb };
type Table = "product_panels" | "product_projections";
type Location = { applicationId: string; applicationName: string; useId: string; path: string };
const ownerGrant = (principalId: string, verb: Verb): Grant => ({ principalKind: "principal", principalId, verb });
const projectionDefinition = {
  name: "Metrics", description: "Sales overview", visibility: "domain",
  componentId: "ObjectSummary", binding: { kind: "ObjectType", id: "Department" }, inputs: {}, display: {},
};
const chartDefinition = {
  ...projectionDefinition, componentId: "MetricChart", binding: { kind: "MetricView", id: "metric" },
  display: { chartSource: { dashboardId: "board", cardId: "chart" } },
};
function panelDefinition(projectionId?: string) {
  return {
    name: "Overview", description: "", visibility: "private", sdkVersion: "1.1.2",
    content: { html: "<main></main>", module: "export {}" },
    manifest: { state: {}, slots: projectionId ? { kpi: { projectionId, inputs: {} } } : {}, operations: [] },
  };
}
let records: Record<Table, Map<string, CurrentProductRow>>;
let grants: Map<string, Grant[]>;
let locations: Map<string, Location[]>;
let legacyRevisions: Set<string>;
let deregistered: string[];
let server: Server;
let base: string;
let root: string;
const previousQueryUrl = config.dataQuery.baseUrl;

function allowed(id: string, verb: Verb, caller: string) {
  return grants.get(id)?.some(grant => grant.verb === verb &&
    (grant.principalKind === "domain" || grant.principalKind === "principal" && grant.principalId === caller)) ?? false;
}

function editGrant(id: string, grant: Grant, remove: boolean) {
  const existing = grants.get(id)!;
  const others = existing.filter(item => item.principalId !== grant.principalId ||
    item.principalKind !== grant.principalKind || item.verb !== grant.verb);
  grants.set(id, remove ? others : [...others, grant]);
}

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  root = await mkdtemp(join(tmpdir(), "catalog-owners-"));
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  const { productPanelsRouter, productProjectionsRouter } = await import("../product-panels");
  const app = express();
  app.use(express.json());
  app.post("/java/product-governance/check", (req, res) => {
    res.json({ allowed: allowed(req.body.id, req.body.verb, req.get("tk")!) });
  });
  app.post("/java/product-governance/resources", (req, res) => {
    res.json({ ids: [...grants.keys()].filter(id => allowed(id, req.body.verb, req.get("tk")!)) });
  });
  app.post("/java/product-governance/register", (req, res) => {
    expect(req.get("X-Ontomato-Query-Service-Token")).toBe("governance");
    expect(req.body).toMatchObject({ domainId: "domain", shared: false });
    grants.set(req.body.id, [ownerGrant(req.body.ownerId, "use"), ownerGrant(req.body.ownerId, "edit")]);
    res.json({ success: true });
  });
  app.post("/java/product-governance/unregister", (req, res) => {
    expect(req.get("X-Ontomato-Query-Service-Token")).toBe("governance");
    expect(req.body.domainId).toBe("domain");
    deregistered.push(req.body.id);
    grants.delete(req.body.id);
    res.json({ success: true });
  });

  const canEdit: express.RequestHandler = (req, res, next) => {
    if (!allowed(req.body.id, "edit", req.get("tk")!)) {
      res.status(403).json({ message: "Product edit Grant required" });
      return;
    }
    next();
  };
  app.post("/java/product-governance/grants", canEdit, (req, res) => {
    res.json({ grants: grants.get(req.body.id) });
  });
  app.post("/java/product-governance/grant", canEdit, (req, res) => {
    const { id, remove, ...grant } = req.body;
    editGrant(id, grant, remove);
    res.json({ success: true });
  });
  app.post("/java/product-governance/share", canEdit, (req, res) => {
    editGrant(req.body.id, { principalKind: "domain", principalId: "*", verb: "use" }, !req.body.shared);
    res.json({ success: true });
  });
  app.get("/java/platform/applications/panel-uses/by-panel", (req, res) => {
    expect(req.get("X-Ontomato-Query-Service-Token")).toBe("governance");
    expect(req.query.domainId).toBe("domain");
    res.json({ success: true, data: locations.get(String(req.query.panelId)) ?? [] });
  });
  app.use("/api", (req, _res, next) => {
    const caller = req.get("tk");
    Object.assign(req, { userId: caller, token: caller, domainId: "domain", locale: "en" });
    next();
  });
  app.use("/api/product-projections", productProjectionsRouter);
  app.use("/api/product-panels", productPanelsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.dataQuery.baseUrl = base + "/java";
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "governance");
});

afterAll(async () => {
  config.dataQuery.baseUrl = previousQueryUrl;
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

function seed(table: Table, id: string, ownerId: string, definition: Record<string, unknown>, extraGrants: Grant[] = []) {
  const timestamp = new Date("2026-11-20T00:00:00Z");
  records[table].set(id, {
    id, domainId: "domain", ownerId, definition, revision: 2, createdAt: timestamp, updatedAt: timestamp,
  });
  grants.set(id, [ownerGrant(ownerId, "use"), ownerGrant(ownerId, "edit"), ...extraGrants]);
}

beforeEach(() => {
  records = { product_panels: new Map(), product_projections: new Map() };
  grants = new Map();
  locations = new Map();
  legacyRevisions = new Set();
  deregistered = [];
  db.query.mockReset().mockImplementation((sql: string, values: unknown[] = []) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock") || sql.startsWith("UPDATE product_subscriptions"))
      return { rows: [] };
    const table = (sql.match(/(?:FROM|INTO) (product_panels|product_projections)/)?.[1]) as Table;
    const collection = records[table];
    const id = String(values[1]);
    if (sql.startsWith("SELECT id,domain_id")) {
      const row = collection.get(id);
      return { rows: row?.domainId === values[0] ? [row] : [] };
    }
    if (sql.includes("jsonb_each")) {
      const rows = [...collection.values()].filter(row => {
        const manifest = row.definition.manifest as ReturnType<typeof panelDefinition>["manifest"];
        return row.domainId === values[0] && Object.values(manifest.slots).some(slot => slot.projectionId === id);
      }).map(row => ({ id: row.id, name: row.definition.name }));
      return { rows };
    }
    if (sql.includes('AS "sortKey"')) {
      const [domain, usable, scope, caller, query, key, position, limit] =
        values as [string, string[], string, string, string, string | null, string | null, number];
      const sortByName = sql.includes("ORDER BY lower");
      const order = sortByName ? 1 : -1;
      const rows = [...collection.values()].filter(row => row.domainId === domain && usable.includes(row.id))
        .filter(row => scope === "all" || (scope === "mine") === (row.ownerId === caller))
        .map(row => ({
          id: row.id, ownerId: row.ownerId, revision: row.revision, updatedAt: row.updatedAt,
          name: String(row.definition.name), description: String(row.definition.description), visibility: row.definition.visibility,
          ...(table === "product_projections" ? { componentId: row.definition.componentId, binding: row.definition.binding } : {}),
          sortKey: sortByName ? String(row.definition.name).toLowerCase() : row.updatedAt.toISOString(),
        }))
        .filter(row => [row.name, row.description].some(text => text.toLowerCase().includes(query.toLowerCase())));
      return { rows: rows
        .filter(row => key === null || order * (row.sortKey.localeCompare(key) || row.id.localeCompare(position!)) > 0)
        .sort((a, b) => order * (a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id))).slice(0, limit) };
    }
    if (sql.startsWith("SELECT id FROM") && sql.includes("UNION ALL"))
      return { rows: collection.has(id) || sql.includes("product_asset_revisions") && legacyRevisions.has(id) ? [{ id }] : [] };
    if (sql.startsWith("INSERT INTO")) {
      seed(table, id, String(values[2]), JSON.parse(values[3] as string));
      const row = collection.get(id)!;
      row.revision = 1;
      return { rows: [row] };
    }
    if (sql.startsWith("DELETE FROM")) {
      collection.delete(id);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});

function request(path: string, method = "GET", body?: unknown, caller = "alice") {
  return fetch(base + "/api/" + path, {
    method, headers: { tk: caller, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

it("lists only use grants across mine/shared/all and follows a stable cursor through tied names", async () => {
  seed("product_projections", "a", "alice", projectionDefinition);
  seed("product_projections", "b", "bob", { ...projectionDefinition, name: "METRICS" }, [ownerGrant("alice", "use")]);
  seed("product_projections", "c", "bob", projectionDefinition);
  seed("product_projections", "d", "alice", { ...projectionDefinition, name: "Unrelated", description: "Other" });
  grants.set("c", [ownerGrant("alice", "edit")]);
  const list = async (query: string) => productProjectionListResponseSchema.parse(
    await (await request("product-projections?" + query)).json(),
  );
  expect((await list("scope=mine&q=sales")).items.map(item => item.id)).toEqual(["a"]);
  expect((await list("scope=shared")).items.map(item => [item.id, item.editable])).toEqual([["b", false]]);
  const first = await list("scope=all&sort=name&limit=1&q=sales");
  expect(first.items.map(item => item.id)).toEqual(["a"]);
  const second = await list("scope=all&sort=name&limit=1&q=sales&cursor=" + first.nextCursor);
  expect(second.items.map(item => item.id)).toEqual(["b"]);
  expect(second.nextCursor).toBeNull();

  seed("product_panels", "panel", "alice", panelDefinition());
  const panels = await request("product-panels?scope=mine");
  expect(productPanelListResponseSchema.parse(await panels.json()).items.map(item => item.id)).toEqual(["panel"]);
});

it("rejects delete and lists only the projection's readable using panels, counting the others", async () => {
  seed("product_projections", "metric", "alice", projectionDefinition);
  seed("product_panels", "visible", "alice", panelDefinition("metric"));
  seed("product_panels", "hidden", "bob", { ...panelDefinition("metric"), name: "Private panel" });
  const path = "product-projections/metric";
  const used = await (await request(path + "/used-by")).json();
  expect(used).toEqual({ panels: [{ id: "visible", name: "Overview" }], hiddenCount: 1 });
  const denied = await request(path + "?revision=2", "DELETE");
  expect(denied.status).toBe(409);
  expect(productProjectionInUseErrorSchema.parse(await denied.json()).details).toEqual(used);
  expect(deregistered).toEqual([]);
});

it("lists all application's entries using a panel and refuses deletion while one remains", async () => {
  seed("product_panels", "panel", "alice", panelDefinition());
  const entry = { applicationId: "app-a", applicationName: "App A", path: "/applications/app-a/home" };
  locations.set("panel", [{ ...entry, useId: "entry" }]);
  const path = "product-panels/panel";
  const used = await (await request(path + "/used-by")).json();
  expect(used).toEqual({ applicationEntries: [{ ...entry, entryId: "entry" }] });
  const denied = await request(path + "?revision=2", "DELETE");
  expect(denied.status).toBe(409);
  expect(productPanelInUseErrorSchema.parse(await denied.json()).details).toEqual(used);
  expect(deregistered).toEqual([]);
});

it("requires edit and the current revision, and unregisters a chart projection and closes its author stream", async () => {
  seed("product_projections", "remove", "alice", chartDefinition, [ownerGrant("bob", "use")]);
  const path = "product-projections/remove";
  const forbidden = await request(path + "?revision=2", "DELETE", undefined, "bob");
  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).toMatchObject({ code: "PRODUCT_FORBIDDEN" });
  const conflict = await request(path + "?revision=1", "DELETE");
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: "PRODUCT_CONFLICT" });
  expect(deregistered).toEqual([]);

  const watch = () => request("product-panels/definition-stream", "POST", { targets: [{ kind: "projection", id: "remove" }] });
  const stream = await watch();
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"kind":"snapshot"');
  const deleted = await request(path + "?revision=2", "DELETE");
  expect(await deleted.json()).toEqual({ success: true });
  expect(records.product_projections.has("remove")).toBe(false);
  expect(deregistered).toEqual(["remove"]);
  expect(grants.has("remove")).toBe(false);
  expect((await reader.read()).done).toBe(true);
  expect((await watch()).status).toBe(403);
});

it("copies from use alone as a new private record owned by the copier and refuses an existing ID or a source chart", async () => {
  seed("product_projections", "metric", "bob", projectionDefinition, [ownerGrant("alice", "use")]);
  seed("product_projections", "chart", "alice", chartDefinition);
  seed("product_panels", "panel", "bob", panelDefinition("metric"), [ownerGrant("alice", "use")]);
  const proposed = { id: "copy", name: "My copy" };
  const result = await request("product-projections/metric/copy", "POST", proposed);
  const { projection } = productProjectionResponseSchema.parse(await result.json());
  expect(projection).toMatchObject({ ...projectionDefinition, ...proposed, ownerId: "alice", visibility: "private", revision: 1 });
  expect(grants.get("copy")).toEqual([ownerGrant("alice", "use"), ownerGrant("alice", "edit")]);
  const collision = await request("product-projections/metric/copy", "POST", proposed);
  expect(collision.status).toBe(409);
  expect(await collision.json()).toMatchObject({ error: { code: "PRODUCT_ID_CONFLICT" } });
  legacyRevisions.add("retired");
  const legacy = await request("product-projections/metric/copy", "POST", { id: "retired", name: "Legacy identity" });
  expect(legacy.status).toBe(409);
  expect(await legacy.json()).toMatchObject({ error: { code: "PRODUCT_ID_CONFLICT" } });
  const chart = await request("product-projections/chart/copy", "POST", { id: "chart-copy", name: "Chart copy" });
  expect(chart.status).toBe(400);
  expect(await chart.json()).toMatchObject({ error: { code: "CHART_SOURCE_REGISTRATION_REQUIRED" } });

  const panelCopy = await request("product-panels/panel/copy", "POST", { id: "panel-copy", name: "Panel copy" });
  expect(productPanelResponseSchema.parse(await panelCopy.json()).panel).toMatchObject({
    manifest: panelDefinition("metric").manifest, ownerId: "alice", visibility: "private", revision: 1,
  });
});

it("uses Java edit authority for grant reads and changes, with domain sharing reflected in the grant list", async () => {
  seed("product_panels", "panel", "alice", panelDefinition(), [ownerGrant("bob", "use")]);
  const path = "product-panels/panel";
  const grant = { ...ownerGrant("carol", "edit"), remove: false };
  expect((await request(path + "/grants", "GET", undefined, "bob")).status).toBe(403);
  expect((await request(path + "/grants", "POST", grant, "bob")).status).toBe(403);
  await request(path + "/grants", "POST", grant);
  await request(path + "/domain-grant", "POST", { shared: true });
  expect((await (await request(path + "/grants")).json()).grants).toEqual(expect.arrayContaining([
    ownerGrant("carol", "edit"), { principalKind: "domain", principalId: "*", verb: "use" },
  ]));
  await request(path + "/grants", "POST", { ...grant, remove: true });
  await request(path + "/domain-grant", "POST", { shared: false });
  expect((await (await request(path + "/grants")).json()).grants).toEqual([
    ownerGrant("alice", "use"), ownerGrant("alice", "edit"), ownerGrant("bob", "use"),
  ]);
});
