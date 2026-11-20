import { expect, it } from "vitest";
import { dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import type { PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { dashboardCardAdapters } from "../../../../../packages/apps-sdk/src/panel/metric-chart";

/*
 * A registered chart's two reads in a panel's frame, by its source card's module: the drawing is the card's chart file
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
