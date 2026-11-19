import { afterEach, describe, expect, it } from "vitest";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { chartProjectionSourcePath } from "@ontomato/contracts/panel-client-requests";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { contextTransport } from "../../../../../packages/apps-sdk/src/context";
import { mountPanel } from "../../../../../packages/apps-sdk/src/panel/mount";
import {
  inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelOf, panelRecord, panelUse, projections, READER, registered,
  writePanelDocument, type Sent,
} from "./panel-frame";

/*
 * What a panel's frame may ask for once it shows a MetricChart (M2 segment 1): the chart source of the chart projections
 * it read, and the bound metric's describe and execute — for that metric alone, checked against the request's own body.
 * Looking a projection up by its source card is no frame's: drawing a chart does not need it, and only a panel whose
 * declaration's bindings register it may ask for it. Both ends are real: the platform's app host and bridge, the frame the
 * panel host registers, and the SDK's request path in the frame.
 *
 * What this rules out: a chart that cannot read its template or run its metric because admission ignored the body or
 * the chart source; a frame that runs another metric through its binding's path; a frame that reads or redraws the chart
 * source of a projection it does not show; and a frame that looks a source card up.
 */

const METRIC = "department-metric";
const chart: ProductProjection = {
  id: "chart-departments", domainId: "domain-1", ownerId: "owner-1", revision: 1, editable: false,
  createdAt: "2026-11-19T00:00:00.000Z", updatedAt: "2026-11-19T00:00:00.000Z",
  name: "Departments", description: "", visibility: "private",
  componentId: "MetricChart", binding: { kind: "MetricView", id: METRIC },
  inputs: { department: { kind: "scalar", type: "string" } },
  display: { chartSource: { dashboardId: "board-a", cardId: "chart-1" } },
};
const summary = projections["projection-schedules-summary"]!;
const panel = panelRecord("panel-departments", "Departments", definePanel({
  state: {},
  slots: { chart: { projectionId: chart.id, inputs: {} }, summary: { projectionId: summary.id, inputs: {} } },
  operations: [],
}));
const use = panelUse("use-departments", "departments", panel.id, "/applications/app-charts/departments");
const lookup = "/product-projections/chart-sources?dashboardId=board-a&cardId=chart-1";

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${chart.id}`) return Response.json({ projection: chart });
  if (request.path === `/api/product-projections/${summary.id}`) return Response.json({ projection: summary });
  if (request.path === `/api${chartProjectionSourcePath(chart.id)}`) return Response.json({ chartFile: { option: {} }, parameters: {} });
  if (request.path === "/api/data-query/ontology/query/metrics/describe") return Response.json({ success: true, data: { parameterDefs: [] } });
  if (request.path === "/api/data-query/metricView/execute") return Response.json({ success: true, data: [] });
  return nothingAt(request);
}

async function open() {
  const sent = installPlatform(answer);
  const frame = panelFrame();
  platformPanelHost("app-charts", use).frame(frame, registered("app-charts", use, panel), true);
  writePanelDocument(panel, use, use.path, {});
  inside(frame);
  const { appContext } = await mountPanel(panelOf());
  return { sent, transport: contextTransport(appContext) };
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

afterEach(leaveFrame);

describe("what a frame showing a chart may ask for", () => {
  it("reads and redraws its chart's source and runs its bound metric as the reader", async () => {
    const { sent, transport } = await open();
    // Before the frame has read a chart projection, nothing of a chart is its to ask for.
    await expect(transport.request(chartProjectionSourcePath(chart.id), {}, "")).rejects.toThrow("Outside what this panel's projections declare");
    expect(sent).toEqual([]);

    await transport.request(`/product-projections/${chart.id}`, {}, "");
    await transport.request(`/product-projections/${summary.id}`, {}, "");
    for (const [path, init, service] of [
      [chartProjectionSourcePath(chart.id), {}, ""],
      [chartProjectionSourcePath(chart.id), { method: "PUT", body: JSON.stringify({ chartFile: { option: {} } }) }, ""],
      ["/ontology/query/metrics/describe", json({ id: METRIC }), "/data-query"],
      ["/metricView/execute", json({ id: METRIC, param: { department: "sales" } }), "/data-query"],
    ] as const)
      expect((await transport.request(path, init, service)).ok, `${init.method ?? "GET"} ${service}${path}`).toBe(true);
    expect(sent.map(({ method, path, search }) => `${method} ${path}${search}`)).toEqual([
      `GET /api/product-projections/${chart.id}`,
      `GET /api/product-projections/${summary.id}`,
      `GET /api${chartProjectionSourcePath(chart.id)}`,
      `PUT /api${chartProjectionSourcePath(chart.id)}`,
      "POST /api/data-query/ontology/query/metrics/describe",
      "POST /api/data-query/metricView/execute",
    ]);
    expect(sent.every(request => request.credential === READER)).toBe(true);
  });

  it("refuses another metric through its binding's path, the chart source of a projection it does not show as a chart, and a source-card lookup", async () => {
    const { sent, transport } = await open();
    await transport.request(`/product-projections/${chart.id}`, {}, "");
    await transport.request(`/product-projections/${summary.id}`, {}, "");
    const before = sent.length;
    for (const [path, init, service] of [
      ["/metricView/execute", json({ id: "salary-metric", param: {} }), "/data-query"],
      ["/ontology/query/metrics/describe", json({ id: "salary-metric" }), "/data-query"],
      ["/metricView/execute", { method: "POST" }, "/data-query"],
      ["/metricView/queryById", json({ id: METRIC }), "/data-query"],
      [chartProjectionSourcePath(summary.id), {}, ""],
      [chartProjectionSourcePath("chart-of-another-panel"), {}, ""],
      [chartProjectionSourcePath(chart.id), { method: "DELETE" }, ""],
      ["/product-projections/chart-sources", json({ dashboardId: "board-a", cardId: "chart-2" }), ""],
      [lookup, {}, ""],
    ] as const)
      await expect(transport.request(path, init, service), `${init.method ?? "GET"} ${service}${path}`)
        .rejects.toThrow("Outside what this panel's projections declare");
    expect(sent.length).toBe(before);
  });
});
