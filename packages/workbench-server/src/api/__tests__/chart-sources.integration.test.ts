import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { productPanelReadResponseSchema } from "@ontomato/contracts/panel-host";
import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { randomUUID } from "node:crypto";
import { chartProjectionSourcePath, CHART_PROJECTION_SOURCES_PATH } from "@ontomato/contracts/panel-client-requests";
import { chartProjectionTemplateSchema, chartSourceInUseErrorSchema, registerChartProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { writeBundledAppSdkFixture } from "../../__tests__/fixtures/bundled-app-sdk";
import { config } from "../../config/application";
import { installContentLayout } from "../../content/layout";
import { configureI18n } from "../../i18n";
import { appTextEn } from "../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../i18n/locales/en";
import pg from "pg";
import { ensureCoreSchemaBaseline } from "../../infrastructure/postgres-migrations/20260827-core-schema-baseline/schema";
import { ensureProductAssetsSchema } from "../../infrastructure/postgres-migrations/20261112-product-assets/schema";
import { ensureProductPanelsSchema } from "../../infrastructure/postgres-migrations/20261118-product-panels/schema";
import { getOwnedDashboard } from "../../services/dashboard/access";
import { dashboardChartSources } from "../../services/dashboard/chart-sources";
import { installDashboardChartProjectionReferences } from "../../services/dashboard/projection-references";
import { createDashboard, deleteUserDashboards, saveDashboard } from "../../services/dashboard/store";
import {
  createChartProjectionService, deleteChartProjectionsForDashboards, findChartProjectionsForCards,
} from "../../services/product-panels/chart-sources";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "" }));
vi.mock("../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));
vi.mock("../../utils/request-identity", async original => ({
  ...await original<typeof import("../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const table = (name: string) => `"${state.schema}"."${name}"`;
const source = { dashboardId: "board/西 %", cardId: "chart/金额 %" };
const chartFile = chartProjectionTemplateSchema.shape.chartFile.parse({
  name: "source.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["name", "value"], source: [] }],
    series: [{ id: "main", type: "bar", datasetId: "metric", encode: { x: "name", y: "value" } }],
    ontomato: {},
  },
});
const parameters = { year: 2026, names: ["north", "west"] };
const metricId = "metric";
const parameterDefs = [
  { name: "year", type: "TYPE_NUMBER", value: 2024 },
  { name: "names", type: "TYPE_STRING_ARRAY", value: [] },
  { name: "subject", type: "TYPE_ONTOOBJ", classNames: ["/Department"] },
  { name: "multiple", type: "TYPE_ONTOOBJ", classNames: ["/Department", "/Employee"] },
];
const sampleCard = {
  id: source.cardId, name: "Source card", chartFile,
  query: { kind: "metric" as const, metricId, parameters }, layout: { colSpan: 6, rowSpan: 2 },
};
let registrations: { id: string; shared: boolean }[];
let metricCallers: string[];
let metricExecutions: unknown[];
let aliceUse: boolean;
let bobDeniedUse: string | undefined;
let bobEdit: boolean;
let base: string;
let server: Server;
let root: string;
const previousQueryUrl = config.dataQuery.baseUrl;

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", languageSwitchEnabled: false, appTextLocale: "en",
    packs: { en: { messages: { ...en, ...appTextEn }, ...enLocaleMeta } },
  });
  state.schema = `chart_sources_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureCoreSchemaBaseline(state.pool);
  await ensureProductAssetsSchema(state.pool);
  await ensureProductPanelsSchema(state.pool);

  root = await mkdtemp(join(tmpdir(), "chart-sources-"));
  await writeBundledAppSdkFixture(root);
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  const { default: dashboardsRouter } = await import("../routes/dashboards");
  const { createChartProjectionsRouter, productPanelsRouter, productProjectionsRouter } = await import("../routes/product-panels");
  const app = express();
  app.use(express.json());
  app.post("/java/product-governance/register", (req, res) => {
    expect(req.header("X-Ontomato-Query-Service-Token")).toBe("governance");
    expect(req.body).toMatchObject({ domainId: "domain", ownerId: "alice" });
    registrations.push(req.body);
    res.json({ success: true });
  });
  app.post("/java/product-governance/check", (req, res) => {
    const { id, verb } = req.body;
    const owner = req.header("tk") === "alice";
    const canUse = owner ? aliceUse : id !== bobDeniedUse;
    res.json({ allowed: registrations.some(resource => resource.id === id) &&
      (verb === "use" ? canUse : owner || bobEdit) });
  });
  app.post("/java/product-governance/resources", (_req, res) => {
    res.json({ ids: registrations.map(resource => resource.id) });
  });
  app.post("/java/ontology/query/metrics/describe", (req, res) => {
    metricCallers.push(req.header("tk")!);
    res.json({
      id: req.body.id, revision: "metric-revision", status: "PUBLISHED", name: "Metric",
      parameterDefs, outputColumns: [{ key: "name", label: null, type: null }, { key: "value", label: null, type: null }],
    });
  });
  app.post("/java/ontology/query/metrics/execute", (req, res) => {
    expect(req.header("tk")).toBe("bob");
    metricExecutions.push(req.body);
    res.json({ columns: [{ key: "name", label: null, type: null }], rows: [{ name: "north" }], truncation: null });
  });
  app.get("/java/platform/applications/resolve-entry", (req, res, next) => {
    if (req.query.applicationId !== "chart-pilot") { next(); return; }
    expect(req.header("tk")).toBe("bob");
    res.json({ success: true, data: {
      applicationId: "chart-pilot", menu: { groups: [], panelUses: [] },
      use: { id: "chart", pageKey: "chart", path: "/applications/chart-pilot/chart", panelId: "chart-pilot",
        access: { kind: "domain-member" } },
    } });
  });
  app.use("/api", (req, _res, next) => {
    const caller = req.header("tk");
    Object.assign(req, { userId: caller, token: caller, domainId: "domain" });
    next();
  });
  installDashboardChartProjectionReferences({ find: findChartProjectionsForCards, remove: deleteChartProjectionsForDashboards });
  app.use("/api/dashboards", dashboardsRouter);
  app.use("/api/product-projections", createChartProjectionsRouter(createChartProjectionService(dashboardChartSources)));
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
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (root) await rm(root, { recursive: true, force: true });
  await state.pool!.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool!.end();
});

beforeEach(async () => {
  registrations = [];
  metricCallers = [];
  metricExecutions = [];
  aliceUse = true;
  bobDeniedUse = undefined;
  bobEdit = false;
  await state.pool!.query(`TRUNCATE ${table("dashboards")}, ${table("product_panels")}, ${table("product_projections")}, ${table("product_subscriptions")}`);
  await createDashboard({
    id: source.dashboardId, ownerId: "alice", domainId: "domain", name: "Board",
    groups: [
      { id: "group", title: "Source group", charts: [sampleCard], metrics: [] },
      { id: "other-group", title: "Other group", charts: [{ ...sampleCard, id: "other-card", name: "Other card" }], metrics: [] },
    ],
  });
});

function readBoard() {
  return getOwnedDashboard("alice", "domain", source.dashboardId);
}

function request(path: string, method = "GET", body?: unknown, caller = "alice") {
  return fetch(base + "/api" + path, {
    method, headers: { tk: caller, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function register() {
  const response = await request(CHART_PROJECTION_SOURCES_PATH, "POST", source);
  expect(response.status).toBe(200);
  return registerChartProjectionResponseSchema.parse(await response.json()).projection;
}

it("registers the owner's chart once with the source binding, private grant and only bindable inputs", async () => {
  expect((await request(CHART_PROJECTION_SOURCES_PATH, "POST", source, "bob")).status).toBe(404);
  const first = await register();
  expect(first).toMatchObject({
    name: "Source card", description: "", visibility: "private", metricId,
    data: {
      template: { source: { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(source) } } }, read: "chartTemplate", params: {} },
      result: {
        source: { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(source) } } }, read: "result",
        params: { year: { input: "year" }, subject: { input: "subject" } },
      },
    },
  });
  const { rows: [{ definition }] } = await state.pool!.query(
    `SELECT definition FROM ${table("product_projections")} WHERE domain_id='domain' AND id=$1`, [first.id],
  );
  expect(first).not.toHaveProperty("chartSource");
  expect(definition).not.toHaveProperty("chartSource");
  expect(first.inputs).toEqual({ year: { kind: "scalar", type: "number" }, subject: { kind: "object", objectType: "/Department" } });
  expect((await register()).id).toBe(first.id);
  expect(registrations).toMatchObject([{ id: first.id, shared: false }]);
  expect(metricCallers).not.toContain("bob");
});

it("looks up a readable chart, returning null, its authorized ID, or the Grant refusal", async () => {
  const path = CHART_PROJECTION_SOURCES_PATH + "?" + new URLSearchParams(source);
  expect(await (await request(path)).json()).toEqual({ projectionId: null });
  const { id } = await register();
  expect(await (await request(path)).json()).toEqual({ projectionId: id });
  expect((await request(path, "GET", undefined, "bob")).status).toBe(404);
  aliceUse = false;
  const denied = await request(path);
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ error: { code: "PRODUCT_FORBIDDEN" } });
});

it("rejects generic source and metric changes", async () => {
  const projection = await register();
  const { name, description, visibility, componentId, revision } = projection;
  const metadata = { name, description, visibility, componentId, revision };
  const path = "/product-projections/" + projection.id;
  const otherCard = { object: { literal: {
    className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey({ ...source, cardId: "other-card" }),
  } } };
  for (const patch of [
    { chartSource: { ...source, cardId: "other-card" } },
    { metricId: "other-metric" },
    { data: { ...projection.data, template: { ...projection.data.template, source: otherCard } } },
    { componentId: "@ontomato/sdk:ObjectSummary", inputs: {}, outputs: {}, config: {}, data: {} },
  ]) expect((await request(path, "PUT", { ...metadata, ...patch })).status).toBe(400);
  expect((await request("/product-projections/new", "PUT", { ...metadata, revision: 0 })).status).toBe(400);
});

it("preserves the chart registration during a metadata update", async () => {
  const projection = await register();
  const { description, visibility, componentId, revision } = projection;
  const path = "/product-projections/" + projection.id;
  const saved = await request(path, "PUT", { description, visibility, componentId, revision, name: "Renamed" });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({
    projection: { name: "Renamed", componentId, metricId, data: projection.data },
  });
});

it("shares only the selected template and its live parameters, and refuses a changed source metric", async () => {
  const { id } = await register();
  const path = chartProjectionSourcePath(id);
  const read = () => request(path, "GET", undefined, "bob");
  expect(await (await read()).json()).toEqual({ chartFile, parameters });
  const board = await readBoard();
  board.groups[0].charts[0].query.parameters.year = 2027;
  await saveDashboard("alice", "domain", board);
  expect(await (await read()).json()).toEqual({ chartFile, parameters: { ...parameters, year: 2027 } });
  board.groups[0].charts[0].query.metricId = "different-metric";
  await saveDashboard("alice", "domain", board);
  const stale = await read();
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "CHART_SOURCE_MISMATCH" } });
});

it("lets a delegated editor change only the source drawing with their own metric credentials", async () => {
  const { id } = await register();
  const content = structuredClone(chartFile.content);
  content.series[0].type = "line";
  const path = chartProjectionSourcePath(id);
  const put = (body: unknown) => request(path, "PUT", body, "bob");
  expect((await put({ chartFile: { content } })).status).toBe(403);
  bobEdit = true;
  expect((await put({ chartFile: { content }, query: { metricId: "wrong" } })).status).toBe(400);
  const before = (await readBoard()).groups;
  await state.pool!.query(
    `INSERT INTO ${table("product_subscriptions")} (domain_id, principal_id, id, target, expires_at, state)
     VALUES ('domain', 'bob', 'watcher', $1::jsonb, now() + interval '1 hour', '{"events":[]}')`,
    [JSON.stringify({ kind: "product-definition", target: { kind: "projection", id } })],
  );
  const updated = await put({ chartFile: { content } });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toEqual({ chartFile: { ...chartFile, content } });
  before[0].charts[0].chartFile.content = content;
  expect((await readBoard()).groups).toEqual(before);
  expect(metricCallers.at(-1)).toBe("bob");
  const { rows: [subscription] } = await state.pool!.query(`SELECT state FROM ${table("product_subscriptions")} WHERE id='watcher'`);
  expect(subscription.state.events).toEqual([{ kind: "definition-changed", domainId: "domain", target: { kind: "projection", id } }]);
});

it.each([
  ["/delete", {}],
  ["/modifyLayout", { groups: [{ id: "group", title: "Source group", charts: [], metrics: [] }] }],
  ["/modifyLayout", { groups: [] }],
  ["/deleteDimension", { groupId: "group" }],
  ["/deleteResultSet", { chartId: source.cardId }],
])("protects registered charts at %s with %j", async (path, body) => {
  const { id } = await register();
  const before = await readBoard();
  const denied = await request("/dashboards" + path, "POST", { id: source.dashboardId, ...body });
  expect(denied.status).toBe(409);
  expect(chartSourceInUseErrorSchema.parse(await denied.json()).details.projectionIds).toEqual([id]);
  expect(await readBoard()).toEqual(before);
});

it("allows moving a registered chart to a different group with the same card ID", async () => {
  const { id } = await register();
  const moved = await request("/dashboards/modifyLayout", "POST", {
    id: source.dashboardId, groups: [{ id: "moved", title: "Moved", charts: [{ id: source.cardId }], metrics: [] }],
  });
  expect(moved.status).toBe(200);
  expect((await readBoard()).groups[0].charts[0].id).toBe(source.cardId);
  expect((await request(chartProjectionSourcePath(id))).status).toBe(200);
});

it("removes only the projections of the account's deleted dashboards and reports the removed chart", async () => {
  const projection = await register();
  const { rows: [{ definition }] } = await state.pool!.query(
    `SELECT definition FROM ${table("product_projections")} WHERE domain_id='domain' AND id=$1`, [projection.id],
  );
  const otherBoard = { ...source, dashboardId: source.dashboardId + "/other" };
  const otherCard = { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(otherBoard) } } };
  const otherDefinition = {
    ...definition,
    data: Object.fromEntries(Object.entries(projection.data).map(([name, datum]) => [name, { ...datum, source: otherCard }])),
  };
  await state.pool!.query(
    `INSERT INTO ${table("product_projections")} (domain_id, id, owner_id, definition)
     VALUES ('another-domain', 'other-domain-chart', 'alice', $1), ('domain', 'other-board-chart', 'alice', $2)`,
    [definition, otherDefinition],
  );
  await deleteUserDashboards("alice");
  expect((await state.pool!.query(`SELECT id FROM ${table("dashboards")}`)).rows).toEqual([]);
  const remaining = await state.pool!.query(`SELECT id FROM ${table("product_projections")} ORDER BY id`);
  expect(remaining.rows).toEqual([{ id: "other-board-chart" }, { id: "other-domain-chart" }]);
  const missing = await request(chartProjectionSourcePath(projection.id), "GET", undefined, "bob");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "PRODUCT_UNAVAILABLE" } });
});

async function registerChartPanel(year: number) {
  const projection = await register();
  const saved = await request("/product-panels/chart-pilot", "PUT", {
    name: "Shared chart", description: "", visibility: "domain", revision: 0,
    content: {
      html: '<div id="app"><projection slot="chart"></projection></div>',
      module: `import { mountPanel } from "@ontomato/sdk/panel";
await mountPanel({});`,
    },
    manifest: { state: {}, events: {}, members: {
      chart: { target: { projectionId: projection.id }, inputs: { year: { literal: year } } },
    } },
  });
  expect(saved.status, await saved.text()).toBe(200);
  return projection;
}

async function readChartMember(dataName: "template" | "result") {
  const response = await request("/product-panels/read", "POST", {
    source: { kind: "registered", applicationId: "chart-pilot", useId: "chart" },
    memberPath: [{ member: "chart" }], dataName, inputs: {},
  }, "bob");
  expect(response.status).toBe(200);
  return productPanelReadResponseSchema.parse(await response.json());
}

it("reads a registered chart's template and result as a different panel viewer", async () => {
  await registerChartPanel(2028);
  expect(await readChartMember("template")).toEqual({ status: "ready", value: { chartFile, parameters } });
  expect(await readChartMember("result")).toMatchObject({ status: "ready", value: { rows: [{ name: "north" }] } });
  expect(metricCallers).toEqual(["alice", "bob"]);
});

it("returns only forbidden for a viewer without use on the chart projection", async () => {
  const projection = await registerChartPanel(2028);
  bobDeniedUse = projection.id;

  expect(await readChartMember("template")).toEqual({ status: "forbidden" });
  expect(await readChartMember("result")).toEqual({ status: "forbidden" });
  expect(metricCallers).not.toContain("bob");
  expect(metricExecutions).toEqual([]);
});

it("rejects both chart reads after the source metric changes and preserves the registered binding", async () => {
  const projection = await registerChartPanel(2028);
  const board = await readBoard();
  board.groups[0].charts[0].query.metricId = "different-metric";
  await saveDashboard("alice", "domain", board);

  expect((await readChartMember("template")).status).toBe("error");
  expect((await readChartMember("result")).status).toBe("error");
  expect(metricExecutions).toEqual([]);

  const response = await request("/product-projections/" + projection.id);
  expect(response.status).toBe(200);
  expect(registerChartProjectionResponseSchema.parse(await response.json()).projection).toMatchObject({
    metricId: projection.metricId, data: projection.data,
  });
});

it("refuses to read a registered chart whose template and result reference different cards", async () => {
  const projection = await registerChartPanel(2028);
  const otherKey = dashboardCardPrimaryKey({ ...source, cardId: "other-card" });
  await state.pool!.query(
    `UPDATE ${table("product_projections")}
     SET definition=jsonb_set(definition, '{data,result,source,object,literal,primaryKey}', to_jsonb($2::text))
     WHERE domain_id='domain' AND id=$1`, [projection.id, otherKey],
  );

  const template = await request(chartProjectionSourcePath(projection.id), "GET", undefined, "bob");
  expect(template.status).toBe(409);
  expect(await template.json()).toMatchObject({ error: { code: "CHART_SOURCE_MISMATCH" } });
  expect((await readChartMember("result")).status).toBe("error");
  expect(metricExecutions).toEqual([]);
});

it("overlays member inputs on saved chart parameters for execution and preserves the saved parameters", async () => {
  await registerChartPanel(2030);

  expect((await readChartMember("result")).status).toBe("ready");
  expect(metricExecutions).toEqual([{
    id: metricId, revision: "metric-revision", parameters: { ...parameters, year: 2030 },
  }]);
  expect((await readBoard()).groups[0].charts[0].query.parameters).toEqual(parameters);
});
