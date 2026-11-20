import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import express from "express";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { config } from "../../../config/application";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { ensureCoreSchemaBaseline } from "../../../infrastructure/postgres-migrations/20260827-core-schema-baseline/schema";
import { createDashboardCardReadAdapter } from "../chart-sources";

const state = vi.hoisted(() => ({ pool: undefined as pg.Pool | undefined, schema: "" }));
vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => state.pool,
  qualifiedTable: (name: string) => `"${state.schema}"."${name}"`,
}));

const database = process.env.RUNTIME_TEST_DATABASE_URL;
if (!database) throw new Error("Set RUNTIME_TEST_DATABASE_URL to a disposable PostgreSQL database");

const owner = { domainId: "domain", userId: "owner" };
const viewer = { token: "viewer-session" };
const source = { dashboardId: "board/north", cardId: "chart/%" };
const key = dashboardCardPrimaryKey(source);
const parameters = { year: 2025, team: "north" };
const chartFile = {
  name: "source.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["name", "value"], source: [] }],
    series: [{ id: "main", type: "bar", datasetId: "metric", encode: { x: "name", y: "value" } }],
    ontomato: {},
  },
};
const metricOutput = {
  columns: [{ key: "value", label: null, type: null }],
  rows: [{ value: 7 }],
  truncation: null,
};
const previousQueryUrl = config.dataQuery.baseUrl;
let server: Server;
let metricRequests: { path: string; token: string | undefined; domain: string | undefined; body: unknown }[];

beforeAll(async () => {
  configureI18n({
    defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
    packs: { en: { ...enLocaleMeta, messages: en } },
  });
  state.schema = `dashboard_card_${randomUUID().replaceAll("-", "")}`;
  state.pool = new pg.Pool({ connectionString: database });
  await state.pool.query(`CREATE SCHEMA "${state.schema}"`);
  await ensureCoreSchemaBaseline(state.pool);

  const java = express();
  java.use(express.json());
  java.use((req, _res, next) => {
    metricRequests.push({ path: req.path, token: req.header("tk"), domain: req.header("X-Domain-Id"), body: req.body });
    next();
  });
  java.post("/ontology/query/metrics/describe", (req, res) => {
    res.json({ id: req.body.id, revision: "current-revision", status: "PUBLISHED", name: "Metric",
      parameterDefs: [], outputColumns: metricOutput.columns });
  });
  java.post("/ontology/query/metrics/execute", (_req, res) => res.json(metricOutput));
  server = java.listen(0, "127.0.0.1");
  await once(server, "listening");
  config.dataQuery.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  config.dataQuery.baseUrl = previousQueryUrl;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool?.query(`DROP SCHEMA "${state.schema}" CASCADE`);
  await state.pool?.end();
});

async function saveSource(metricId: string) {
  const card = { id: source.cardId, name: "Source", chartFile, query: { kind: "metric", metricId, parameters } };
  const groups = [{ id: "group", title: "Group", charts: [card], metrics: [] }];
  await state.pool!.query(`INSERT INTO "${state.schema}".dashboards
    (id, owner_id, domain_id, name, groups, created_at, updated_at)
    VALUES ($1,$2,$3,'Board',$4,1,1) ON CONFLICT (id) DO UPDATE SET groups=EXCLUDED.groups`,
  [source.dashboardId, owner.userId, owner.domainId, JSON.stringify(groups)]);
}

beforeEach(async () => {
  metricRequests = [];
  await saveSource("metric");
});

it("denies both reads when the viewer has no access to the source card", async () => {
  const reader = createDashboardCardReadAdapter({ ...owner, userId: "outsider" }, { token: "outsider-session" });
  await expect(reader.chartTemplate(key, "metric")).rejects.toMatchObject({ status: 404 });
  await expect(reader.result(key, "metric", {})).rejects.toMatchObject({ status: 404 });
  expect(metricRequests).toEqual([]);
});

it("reads the saved template and executes the current metric as the reader with merged parameters", async () => {
  const reader = createDashboardCardReadAdapter(owner, viewer);
  expect(panelReadResultSchemas.chartTemplate.parse(await reader.chartTemplate(key, "metric"))).toEqual({ chartFile, parameters });
  const output = await reader.result(key, "metric", { year: 2026, quarter: 1 });
  expect(panelReadResultSchemas.metricOutput.parse(output)).toEqual(metricOutput);
  expect(metricRequests).toContainEqual({
    path: "/ontology/query/metrics/execute", token: viewer.token, domain: owner.domainId,
    body: { id: "metric", revision: "current-revision", parameters: { year: 2026, team: "north", quarter: 1 } },
  });
  expect((await reader.chartTemplate(key, "metric")).parameters).toEqual(parameters);
});

it("rejects an earlier registration when the source card switches to a different metric", async () => {
  const reader = createDashboardCardReadAdapter(owner, viewer);
  await saveSource("different-metric");
  await expect(reader.chartTemplate(key, "metric")).rejects.toMatchObject({ status: 409, code: "CHART_SOURCE_MISMATCH" });
  await expect(reader.result(key, "metric", {})).rejects.toMatchObject({ status: 409, code: "CHART_SOURCE_MISMATCH" });
  expect(metricRequests).toEqual([]);
});
