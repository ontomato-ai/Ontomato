import type { DashboardGroup } from "@ontomato/contracts/dashboard";
import { chartProjectionSourcePath, CHART_PROJECTION_SOURCES_PATH } from "@ontomato/contracts/panel-client-requests";
import { chartProjectionTemplateSchema, chartSourceInUseErrorSchema, registerChartProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { config } from "../../../config/application";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { appTextEn } from "../../../i18n/app-text-en";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { CurrentProductRow } from "../../../infrastructure/product-current";
import { dashboardChartSources } from "../../../services/dashboard/chart-sources";
import { installDashboardChartProjectionReferences } from "../../../services/dashboard/projection-references";
import { deleteUserDashboards } from "../../../services/dashboard/store";
import {
  createChartProjectionService, deleteChartProjectionsForDashboards, findChartProjectionsForCards,
} from "../../../services/product-panels/chart-sources";

const db = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: db.query, connect: async () => db }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain",
}));

const source = { dashboardId: "board", cardId: "chart" };
const chartFile = chartProjectionTemplateSchema.shape.chartFile.parse({
  name: "source.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["name", "value"], source: [] }],
    series: [{ id: "main", type: "bar", datasetId: "metric", encode: { x: "name", y: "value" } }],
    ontomato: {},
  },
});
const parameters = { year: 2026, names: ["north", "west"] };
const binding = { kind: "MetricView", id: "metric" };
const parameterDefs = [
  { name: "year", type: "TYPE_NUMBER", value: 2024 },
  { name: "names", type: "TYPE_STRING_ARRAY", value: [] },
  { name: "subject", type: "TYPE_ONTOOBJ", classNames: ["/Department"] },
  { name: "multiple", type: "TYPE_ONTOOBJ", classNames: ["/Department", "/Employee"] },
];
const sampleCard = {
  id: source.cardId, name: "Source card", chartFile,
  query: { kind: "metric" as const, metricId: binding.id, parameters }, layout: { colSpan: 6, rowSpan: 2 },
};
type StoredDashboard = { id: string; owner_id: string; domain_id: string; name: string; groups: DashboardGroup[]; created_at: string; updated_at: string };

let boards: StoredDashboard[];
let projections: CurrentProductRow[];
let registrations: { id: string; shared: boolean }[];
let notifications: unknown[];
let metricCallers: string[];
let aliceUse: boolean;
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
  root = await mkdtemp(join(tmpdir(), "chart-sources-"));
  installContentLayout({ runtimeRoot: root, publicSkillsRoot: root, prompts: [], runtimeResources: [] });
  const { default: dashboardsRouter } = await import("../dashboards");
  const { createChartProjectionsRouter, productProjectionsRouter } = await import("../product-panels");
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
    res.json({ allowed: registrations.some(resource => resource.id === id) &&
      (verb === "use" ? !owner || aliceUse : owner || bobEdit) });
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
  app.use("/api", (req, _res, next) => {
    const caller = req.header("tk");
    Object.assign(req, { userId: caller, token: caller, domainId: "domain" });
    next();
  });
  installDashboardChartProjectionReferences({ find: findChartProjectionsForCards, remove: deleteChartProjectionsForDashboards });
  app.use("/api/dashboards", dashboardsRouter);
  app.use("/api/product-projections", createChartProjectionsRouter(createChartProjectionService(dashboardChartSources)));
  app.use("/api/product-projections", productProjectionsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  config.dataQuery.baseUrl = base + "/java";
  vi.stubEnv("ONTOMATO_QUERY_SERVICE_TOKEN", "governance");
});

afterAll(async () => {
  config.dataQuery.baseUrl = previousQueryUrl;
  vi.unstubAllEnvs();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

beforeEach(() => {
  const board: StoredDashboard = {
    id: source.dashboardId, owner_id: "alice", domain_id: "domain", name: "Board", created_at: "1", updated_at: "2",
    groups: [
      { id: "group", title: "Source group", charts: [sampleCard], metrics: [] },
      { id: "other-group", title: "Other group", charts: [{ ...structuredClone(sampleCard), id: "other-card", name: "Other card" }], metrics: [] },
    ],
  };
  boards = [structuredClone(board)];
  projections = [];
  registrations = [];
  notifications = [];
  metricCallers = [];
  aliceUse = true;
  bobEdit = false;
  db.query.mockReset().mockImplementation((sql: string, args: unknown[] = []) => {
    const boardWhere = (owner: unknown, id: unknown, domain: unknown) =>
      (row: StoredDashboard) => row.owner_id === owner && row.id === id && row.domain_id === domain;
    const projectionWhere = (domain: unknown, id: unknown) =>
      (row: CurrentProductRow) => row.domainId === domain && row.id === id;
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) || sql.includes("pg_advisory_xact_lock"))
      return { rows: [] };
    if (sql.startsWith("SELECT * FROM dashboards"))
      return { rows: structuredClone(boards.filter(boardWhere(...args as [string, string, string]))) };
    if (sql.startsWith("UPDATE dashboards")) {
      const row = boards.find(boardWhere(args[4], args[5], args[6]))!;
      row.groups = JSON.parse(args[1] as string);
      return { rowCount: 1, rows: [] };
    }
    if (sql.startsWith("DELETE FROM dashboards")) {
      const removed = boards.filter(sql.includes("RETURNING")
        ? row => row.owner_id === args[0] && row.domain_id !== ""
        : boardWhere(...args as [string, string, string]));
      boards = boards.filter(row => !removed.includes(row));
      return { rows: removed.map(row => ({ dashboardId: row.id, domainId: row.domain_id })) };
    }
    if (sql.startsWith("SELECT id,domain_id"))
      return { rows: structuredClone(projections.filter(projectionWhere(args[0], args[1]))) };
    if (sql.startsWith("SELECT id FROM product_panels")) return { rows: [] };
    if (sql.startsWith("INSERT INTO product_projections")) {
      const row = { domainId: args[0] as string, id: args[1] as string, ownerId: args[2] as string,
        definition: JSON.parse(args[3] as string), revision: 1, createdAt: new Date(), updatedAt: new Date() };
      projections.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith("UPDATE product_projections")) {
      const row = projections.find(projectionWhere(args[0], args[1]))!;
      expect(row.revision).toBe(args[3]);
      row.definition = JSON.parse(args[2] as string);
      row.revision++;
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT id FROM product_projections")) {
      const rows = projections.filter(row => row.domainId === args[0] && row.definition.componentId === args[1] &&
        projectionSource(row)?.dashboardId === args[2] && (args[3] as string[]).includes(projectionSource(row)!.cardId));
      return { rows: rows.map(({ id }) => ({ id })) };
    }
    if (sql.startsWith("DELETE FROM product_projections")) {
      projections = projections.filter(row => row.definition.componentId !== args[2] ||
        !(args[0] as string[]).some((domain, index) => row.domainId === domain &&
          projectionSource(row)?.dashboardId === (args[1] as string[])[index]));
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE product_subscriptions")) {
      notifications.push(...JSON.parse(args[1] as string));
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});

function projectionSource(row: CurrentProductRow) {
  return (row.definition.display as { chartSource?: typeof source }).chartSource;
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
    name: "Source card", description: "", visibility: "private", binding, display: { chartSource: source },
  });
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

it("rejects all generic source and binding changes while preserving registration during metadata updates", async () => {
  const projection = await register();
  const { name, description, visibility, inputs, componentId, revision } = projection;
  const metadata = { name, description, visibility, inputs, componentId, binding, revision, display: {} };
  const path = "/product-projections/" + projection.id;
  for (const patch of [
    { display: { chartSource: { ...source, cardId: "other-card" } } },
    { binding: { ...binding, id: "other-metric" } },
    { componentId: "ObjectSummary" },
  ]) expect((await request(path, "PUT", { ...metadata, ...patch })).status).toBe(400);
  expect((await request("/product-projections/new", "PUT", { ...metadata, revision: 0 })).status).toBe(400);
  expect((await request("/product-projections/new", "PUT", {
    ...metadata, revision: 0, componentId: "ObjectSummary", display: projection.display,
  })).status).toBe(400);
  const saved = await request(path, "PUT", { ...metadata, name: "Renamed" });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ projection: { name: "Renamed", componentId, binding, display: projection.display } });
});

it("shares only the selected template and its live parameters, and refuses a changed source metric", async () => {
  const { id } = await register();
  const path = chartProjectionSourcePath(id);
  const read = () => request(path, "GET", undefined, "bob");
  expect(await (await read()).json()).toEqual({ chartFile, parameters });
  boards[0].groups[0].charts[0].query.parameters.year = 2027;
  expect(await (await read()).json()).toEqual({ chartFile, parameters: { ...parameters, year: 2027 } });
  boards[0].groups[0].charts[0].query.metricId = "different-metric";
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
  const before = structuredClone(boards[0].groups);
  const updated = await put({ chartFile: { content } });
  expect(updated.status).toBe(200);
  expect(await updated.json()).toEqual({ chartFile: { ...chartFile, content } });
  before[0].charts[0].chartFile.content = content;
  expect(boards[0].groups).toEqual(before);
  expect(metricCallers.at(-1)).toBe("bob");
  expect(notifications.at(-1)).toEqual({ kind: "definition-changed", domainId: "domain", target: { kind: "projection", id } });
});

it.each([
  ["/delete", {}],
  ["/modifyLayout", { groups: [{ id: "group", title: "Source group", charts: [], metrics: [] }] }],
  ["/modifyLayout", { groups: [] }],
  ["/deleteDimension", { groupId: "group" }],
  ["/deleteResultSet", { chartId: source.cardId }],
])("protects registered charts at %s with %j", async (path, body) => {
  const { id } = await register();
  const before = structuredClone(boards);
  const denied = await request("/dashboards" + path, "POST", { id: source.dashboardId, ...body });
  expect(denied.status).toBe(409);
  expect(chartSourceInUseErrorSchema.parse(await denied.json()).details.projectionIds).toEqual([id]);
  expect(boards).toEqual(before);
});

it("allows moving a registered chart to a different group with the same card ID", async () => {
  const { id } = await register();
  const moved = await request("/dashboards/modifyLayout", "POST", {
    id: source.dashboardId, groups: [{ id: "moved", title: "Moved", charts: [{ id: source.cardId }], metrics: [] }],
  });
  expect(moved.status).toBe(200);
  expect(boards[0].groups[0].charts[0].id).toBe(source.cardId);
  expect((await request(chartProjectionSourcePath(id))).status).toBe(200);
});

it("removes only the projections of the account's deleted dashboards and reports the removed chart", async () => {
  const projection = await register();
  const [first] = projections;
  projections.push({ ...first, id: "other-domain-chart", domainId: "another-domain" });
  projections.push({ ...first, id: "other-board-chart", definition: {
    ...first.definition, display: { chartSource: { ...source, dashboardId: "other-board" } },
  } });
  await deleteUserDashboards("alice");
  expect(boards).toEqual([]);
  expect(projections.map(({ id }) => id)).toEqual(["other-domain-chart", "other-board-chart"]);
  const missing = await request(chartProjectionSourcePath(projection.id), "GET", undefined, "bob");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "PRODUCT_UNAVAILABLE" } });
});
