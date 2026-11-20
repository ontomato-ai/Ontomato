import { afterEach, describe, expect, it } from "vitest";
import { chartProjectionSourcePath, SCHEDULED_TASK } from "@ontomato/contracts/panel-client-requests";
import { dashboardCardPrimaryKey } from "@ontomato/contracts/dashboard";
import { DASHBOARD_CARD } from "@ontomato/contracts/platform-object-types";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelUse, READER, registered, type Sent } from "./panel-frame";
import { codePanelRecord, connectBridge, projectionRecord } from "./host-bridge-records";

/*
 * What a panel's frame may ask for once it shows a MetricChart (M2 segment 1): the chart source of the chart projections
 * it read, and the bound metric's describe and execute — for that metric alone, checked against the request's own body.
 * Execute is the ontology metric read (`{id, revision, parameters}`, the revision from describe); the old
 * `/metricView/execute` is no frame's any more. Looking a projection up by its source card is no frame's either. Both
 * platform ends are real: the app host and bridge, the frame the panel host registers. The frame speaks the bridge's wire
 * format.
 *
 * What this rules out: a chart that cannot read its template or run its metric because admission ignored the body or
 * the chart source; a frame that runs another metric through its binding's path, or through the retired execute path;
 * a frame that reads or redraws the chart source of a projection it does not show; and a frame that looks a source card
 * up.
 */

const METRIC = "department-metric";
const chartSource = { dashboardId: "board-a", cardId: "chart-1" };
const card = { object: { literal: { className: DASHBOARD_CARD, primaryKey: dashboardCardPrimaryKey(chartSource) } } };
const chart = projectionRecord({
  id: "chart-departments", componentId: "@ontomato/sdk:MetricChart", chartSource, metricId: METRIC,
  inputs: { department: { kind: "scalar", type: "string" } },
  data: {
    template: { source: card, read: "chartTemplate", params: {} },
    result: { source: card, read: "result", params: { department: { input: "department" } } },
  },
});
const summary = projectionRecord({
  id: "projection-schedules-summary", componentId: "@ontomato/sdk:ObjectSummary",
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: SCHEDULED_TASK } }, read: "list", params: {} } },
});
const panel = codePanelRecord("panel-departments", { chart: chart.id, summary: summary.id });
const use = panelUse("use-departments", "departments", panel.id, "/applications/app-charts/departments");
const lookup = "/product-projections/chart-sources?dashboardId=board-a&cardId=chart-1";

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${chart.id}`) return Response.json({ projection: chart });
  if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
  if (request.path === `/api${chartProjectionSourcePath(chart.id)}`) return Response.json({ chartFile: { option: {} }, parameters: {} });
  if (request.path === "/api/data-query/ontology/query/metrics/describe") return Response.json({ success: true, data: { parameterDefs: [] } });
  if (request.path === "/api/data-query/ontology/query/metrics/execute") return Response.json({ success: true, data: [] });
  return nothingAt(request);
}

function open() {
  const sent = installPlatform(answer);
  const frame = panelFrame();
  platformPanelHost("app-charts", use, ignoreChanges).frame(frame, registered("app-charts", use, panel), true);
  inside(frame);
  const invoke = connectBridge();
  const request = (path: string, service: string, method = "GET", body: unknown = null) =>
    invoke("request", { path, service, method, headers: [], body: body === null ? null : JSON.stringify(body) });
  return { sent, request };
}

afterEach(leaveFrame);

describe("what a frame showing a chart may ask for", () => {
  it("reads and redraws its chart's source and runs its bound metric as the reader", async () => {
    const { sent, request } = open();
    // Before the frame has read a chart projection, nothing of a chart is its to ask for.
    await expect(request(chartProjectionSourcePath(chart.id), "")).rejects.toThrow("Outside what this panel's projections declare");
    expect(sent).toEqual([]);

    await request(`/product-projections/${chart.id}`, "");
    await request(`/product-projections/${summary.id}`, "");
    for (const [path, service, method, body] of [
      [chartProjectionSourcePath(chart.id), "", "GET", null],
      [chartProjectionSourcePath(chart.id), "", "PUT", { chartFile: { option: {} } }],
      ["/ontology/query/metrics/describe", "/data-query", "POST", { id: METRIC }],
      ["/ontology/query/metrics/execute", "/data-query", "POST", { id: METRIC, revision: "3", parameters: { department: "sales" } }],
    ] as const)
      await expect(request(path, service, method, body), `${method} ${service}${path}`).resolves.toMatchObject({ status: 200 });
    expect(sent.map(({ method, path, search }) => `${method} ${path}${search}`)).toEqual([
      `GET /api/product-projections/${chart.id}`,
      `GET /api/product-projections/${summary.id}`,
      `GET /api${chartProjectionSourcePath(chart.id)}`,
      `PUT /api${chartProjectionSourcePath(chart.id)}`,
      "POST /api/data-query/ontology/query/metrics/describe",
      "POST /api/data-query/ontology/query/metrics/execute",
    ]);
    expect(sent.every(request => request.credential === READER)).toBe(true);
  });

  it("refuses another metric, the retired execute path, the chart source of a projection it does not show as a chart, and a source-card lookup", async () => {
    const { sent, request } = open();
    await request(`/product-projections/${chart.id}`, "");
    await request(`/product-projections/${summary.id}`, "");
    const before = sent.length;
    for (const [path, service, method, body] of [
      ["/ontology/query/metrics/execute", "/data-query", "POST", { id: "salary-metric", revision: "3", parameters: {} }],
      ["/ontology/query/metrics/execute", "/data-query", "POST", { id: METRIC, parameters: {} }],
      ["/ontology/query/metrics/describe", "/data-query", "POST", { id: "salary-metric" }],
      ["/metricView/execute", "/data-query", "POST", { id: METRIC, param: { department: "sales" } }],
      ["/metricView/queryById", "/data-query", "POST", { id: METRIC }],
      [chartProjectionSourcePath(summary.id), "", "GET", null],
      [chartProjectionSourcePath("chart-of-another-panel"), "", "GET", null],
      [chartProjectionSourcePath(chart.id), "", "DELETE", null],
      ["/product-projections/chart-sources", "", "POST", { dashboardId: "board-a", cardId: "chart-2" }],
      [lookup, "", "GET", null],
    ] as const)
      await expect(request(path, service, method, body), `${method} ${service}${path}`)
        .rejects.toThrow("Outside what this panel's projections declare");
    expect(sent.length).toBe(before);
  });
});
