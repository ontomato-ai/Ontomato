import { afterEach, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { dashboardCardPrimaryKey, dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { productProjectionResponseSchema } from "@ontomato/contracts/product-panels";
import type { PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { dashboardCardAdapters } from "../../../../../packages/apps-sdk/src/panel/metric-chart";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import {
  ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered,
  writePanelDocument, type Sent as PlatformSent,
} from "./panel-frame";

// The platform's ECharts instance is the chart element's own; here it shows what it was asked to draw.
vi.mock("../../../../../packages/foundation-ui/src/chart/EChart.vue", () => ({
  default: defineComponent({ props: { option: { type: Object, required: true } }, setup: (props) => () => h("div", { class: "drawn", "data-rows": JSON.stringify((props.option as { dataset?: { source?: unknown }[] }).dataset?.[0]?.source ?? []) }) }),
}));

/*
 * A registered chart's two reads in a panel's frame, by its source card's module (and, last, a chart a coded panel
 * places, drawn through the platform's real bridge and admission): the drawing is the card's chart file
 * and saved parameters, read by the chart projection the frame read; the output is the projection's MetricView, run as
 * the reader at the revision its description names, with the values the panel binds laid over the card's parameters —
 * what the card's owner answers on the platform's own read.
 *
 * The mistakes these catch: the MetricView's defaults standing in for the card's parameters; a bound object sent as
 * itself rather than by its key; an unbound input wiping the card's own value; the run made at no revision, or the
 * owner's refusal turned into anything but its own words.
 */

const chart = { id: "chart-revenue", metricId: "revenue-by-region" };
const chartFile = dashboardChartFileSchema.parse({
  name: "revenue.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "amount"], source: [] }],
    xAxis: { type: "category" },
    yAxis: { type: "value" },
    series: [{ id: "series-0", type: "bar", datasetId: "metric", encode: { x: "region", y: "amount" } }],
    ontomato: { display: { formats: { amount: { kind: "number" } } } },
  },
});
/** The card's saved parameters: the year the dashboard chose, a list and the customer it was saved for. */
const cardParameters = { year: 2025, regions: ["east", "west"], customer: "c-1" };
const description = {
  id: chart.metricId, revision: "7", status: "PUBLISHED", name: "Revenue by region",
  parameterDefs: [{ name: "year", type: "TYPE_NUMBER", value: 2020 }, { name: "customer", type: "TYPE_ONTOOBJ", value: null }],
  outputColumns: [{ key: "region", label: "Region", type: "string" }, { key: "amount", label: "Amount", type: "number" }],
};
const output = {
  columns: description.outputColumns,
  rows: [{ region: "east", amount: 12 }, { region: "west", amount: 7 }],
  truncation: null,
};

interface Sent { method: string; service: string; path: string; body: unknown }

/** The owners as the module's requests reach them; `execute` answers the run. */
function owners(execute: () => Response = () => Response.json(output)) {
  const sent: Sent[] = [];
  const requests: PlatformRequests = {
    async request(path, init, service) {
      sent.push({ method: init.method ?? "GET", service, path, body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      if (path === `/product-projections/${chart.id}/chart-source`) return Response.json({ chartFile, parameters: cardParameters });
      if (path === "/ontology/query/metrics/describe") return Response.json(description);
      if (path === "/ontology/query/metrics/execute") return execute();
      throw new Error(`Nothing at ${service}${path}`);
    },
  };
  const [card] = dashboardCardAdapters(requests);
  return { sent, metric: card!.metric!, objectType: card!.objectType };
}

it("reads the card's drawing by the chart projection the frame read", async () => {
  const { sent, metric, objectType } = owners();
  expect(objectType).toBe(DASHBOARD_CARD);
  expect(await metric.template(chart)).toEqual({ chartFile, parameters: cardParameters });
  expect(sent).toEqual([{ method: "GET", service: "", path: `/product-projections/${chart.id}/chart-source`, body: null }]);
});

it("runs the MetricView at its described revision with the bound values laid over the card's parameters", async () => {
  const { sent, metric } = owners();
  const answer = await metric.result(chart, {
    customer: { className: "Customer", primaryKey: "c-9" },
    // Unbound in this panel: the card's own list stays.
    regions: null,
  });
  expect(answer).toEqual(output);
  expect(sent.map((request) => `${request.method} ${request.service}${request.path}`).sort()).toEqual([
    `GET /product-projections/${chart.id}/chart-source`,
    "POST /data-query/ontology/query/metrics/describe",
    "POST /data-query/ontology/query/metrics/execute",
  ].sort());
  expect(sent.find((request) => request.path.endsWith("/describe"))!.body).toEqual({ id: chart.metricId });
  // The card's parameters underneath, not the MetricView's defaults; the panel's object by its key over its own.
  expect(sent.find((request) => request.path.endsWith("/execute"))!.body).toEqual({
    id: chart.metricId, revision: "7", parameters: { year: 2025, regions: ["east", "west"], customer: "c-9" },
  });
});

it("hands a checked list of objects to the MetricView by their keys, in order", async () => {
  const { sent, metric } = owners();
  await metric.result(chart, { customer: [{ className: "Customer", primaryKey: "c-2" }, { className: "Customer", primaryKey: "c-3" }] });
  expect((sent.find((request) => request.path.endsWith("/execute"))!.body as { parameters: object }).parameters)
    .toEqual({ ...cardParameters, customer: ["c-2", "c-3"] });
});

it("leaves the owner's refusal as it came", async () => {
  const { metric } = owners(() => { throw new Error("Parameter year is required"); });
  await expect(metric.result(chart, {})).rejects.toThrow("Parameter year is required");
});

afterEach(leaveFrame);

it("draws a chart a coded panel places through the platform's bridge, as the reader", async () => {
  const source = { dashboardId: "board 1", cardId: "card/1" };
  const card = { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(source) };
  // The chart's record as Node answers it, parsed by the contract the bridge reads it with.
  const answered = {
    projection: {
      id: chart.id, domainId: "domain-1", ownerId: "owner-1", revision: 3, createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z", editable: false, visibility: "domain", name: "Revenue", description: "",
      componentId: "@ontomato/sdk:MetricChart", metricId: chart.metricId,
      inputs: { customer: { kind: "object", objectType: "Customer" } }, outputs: {}, config: {},
      data: {
        template: { source: { object: { literal: card } }, read: "chartTemplate", params: {} },
        result: { source: { object: { literal: card } }, read: "result", params: { customer: { input: "customer" } } },
      },
    },
  };
  expect(productProjectionResponseSchema.parse(answered)).toEqual(answered);
  const panel = panelRecord("panel-charts", "Charts", definePanel({
    state: { customer: { type: { kind: "object", objectType: "Customer" }, deepLink: true } },
    members: { revenue: { target: { projectionId: chart.id }, inputs: { customer: { state: "customer" } } } },
    commands: {},
  }));
  const use = panelUse("use-charts", "charts", panel.id, "/applications/app-charts/charts");
  const sent = installPlatform((request: PlatformSent) => {
    if (request.path === `/api/product-projections/${chart.id}`) return Response.json(answered);
    if (request.path === `/api/product-projections/${chart.id}/chart-source`) return Response.json({ chartFile, parameters: cardParameters });
    if (request.path === "/api/data-query/ontology/query/metrics/describe") return Response.json(description);
    if (request.path === "/api/data-query/ontology/query/metrics/execute") return Response.json(output);
    return nothingAt(request);
  });
  const frame = panelFrame();
  platformPanelHost("app-charts", use, ignoreChanges).frame(frame, registered("app-charts", use, panel), true);
  writePanelDocument(registered("app-charts", use, panel), use.path, { customer: { className: "Customer", primaryKey: "c-9" } });
  inside(frame);
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  await mountPanel(panelOf("revenue"));
  await vi.waitFor(() => expect(JSON.parse(document.querySelector("#app .drawn")?.getAttribute("data-rows") ?? "null")).toEqual(output.rows), { timeout: 5000 });
  // Every request the frame made was one its chart admits; the run is the chart's MetricView, with the panel's customer.
  const execute = sent.find((request) => request.path.endsWith("/metrics/execute"))!;
  expect(execute.body).toEqual({ id: chart.metricId, revision: "7", parameters: { ...cardParameters, customer: "c-9" } });
});
