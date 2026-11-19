import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h } from "vue";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { dashboardChartFileSchema } from "@ontomato/contracts/dashboard";
import { createPanelInstance } from "../../../../../packages/apps-sdk/src/panel/instance";
import { panelContextKey } from "../../../../../packages/apps-sdk/src/panel/context";
import { platformResourceLoader, type PlatformRequests } from "../../../../../packages/apps-sdk/src/panel/platform-objects";
import { platformResources } from "../../../../../packages/apps-sdk/src/resources";
import Projection from "../../../../../packages/apps-sdk/src/panel/Projection.vue";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { ignoreChanges, inside, installPlatform, leaveFrame, noOperations, nothingAt, panelFrame, panelOf, panelRecord, panelUse, registered, writePanelDocument } from "./panel-frame";

/*
 * A chart projection is the chart on its dashboard (M2 ruling 2026-11-19): it draws its source card's chart file with the
 * card's saved parameters, the panel's own bound values laid over them, and reads the MetricView as the reader. These
 * are the mistakes they catch: a drawing or parameters kept with the projection instead of read from the card, the
 * MetricView's defaults standing in for the card's parameters, a panel value written back or kept, a request outside
 * the chart's declared ones (`queryById`), and a source that is gone drawn as an empty chart instead of saying so.
 */

// The platform's ECharts instance is the chart element's own; here it shows what it was asked to draw.
vi.mock("../../../../../packages/foundation-ui/src/chart/EChart.vue", () => ({
  default: defineComponent({ props: ["option"], setup: (props) => () => h("div", { class: "drawn", "data-rows": JSON.stringify(props.option.dataset?.[0]?.source ?? []) }) }),
}));

const METRIC = "revenue-by-region";
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
/** The card's saved parameters: the year the dashboard chose and a list the panel cannot bind. */
const cardParameters = { year: 2025, regions: ["east", "west"], customer: "c-1" };
const description = {
  id: METRIC, revision: "3", status: "PUBLISHED", name: "Revenue by region",
  // A default the card's own value must win over.
  parameterDefs: [{ name: "year", type: "TYPE_NUMBER", value: 2020 }, { name: "customer", type: "TYPE_ONTOOBJ", value: null }],
  outputColumns: [{ key: "region", label: "Region", type: "string" }, { key: "amount", label: "Amount", type: "number" }],
};
const rows = [{ region: "east", amount: 12 }, { region: "west", amount: 7 }];

const current = {
  domainId: "domain-1", ownerId: "owner-1", revision: 1, createdAt: "2026-11-19T00:00:00.000Z",
  updatedAt: "2026-11-19T00:00:00.000Z", editable: false, visibility: "domain" as const,
};
const chart: ProductProjection = {
  ...current, id: "chart-revenue", name: "Revenue", description: "", componentId: "MetricChart",
  binding: { kind: "MetricView", id: METRIC },
  inputs: { customer: { kind: "object", objectType: "Customer" } },
  display: { chartSource: { dashboardId: "board-1", cardId: "card-1" } },
};
const manifest = definePanel({
  state: { customer: { kind: "object", objectType: "Customer", deepLink: true } },
  slots: { revenue: { projectionId: chart.id, inputs: { customer: { state: "customer" } } } },
  operations: [],
});

interface Sent { path: string; service: string; method: string; body: unknown }

/** The owners as the chart's requests reach them; `template` answers the chart source read. */
function owners(template: () => Response) {
  const sent: Sent[] = [];
  const requests: PlatformRequests = {
    async request(path, init, service) {
      sent.push({ path, service, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null });
      if (path === `/product-projections/${chart.id}/chart-source`) return template();
      if (path === "/ontology/query/metrics/describe") return Response.json(description);
      if (path === "/metricView/execute") return Response.json({ success: true, data: rows });
      throw new Error(`Nothing at ${service}${path}`);
    },
  };
  return { sent, requests };
}

function mounted(requests: PlatformRequests, customer: string | null) {
  const instance = createPanelInstance(manifest, {
    text: (key) => key,
    ...noOperations,
    pageKey: "charts", url: () => "/charts", label: () => "Charts",
    initial: customer ? { customer: { className: "Customer", primaryKey: customer } } : {},
    recordDraftCreated: async () => {},
    readProjection: async () => chart,
  });
  const element = document.createElement("div");
  const app = createApp({ setup: () => () => h(Projection, { slot: "revenue" }) })
    .use(createI18n({ legacy: false, locale: "en", messages: { en: publicEn } })).use(ElementPlus);
  app.provide(panelContextKey, {
    panel: { content: { html: "", module: "" }, manifest, sdkVersion: "1.1.1" },
    manifest, instance,
    projection: (id: string) => instance.projection(id),
    invoke: (handlerRef: string, call) => instance.runHandler(handlerRef, call),
    projectionsChanged: () => () => {},
    draft: instance.draft,
    holdUnsaved: () => () => {},
    t: (key: string) => key,
    resources: platformResourceLoader(requests, platformResources),
    expandPageComposer: async () => {},
  });
  app.mount(element);
  return { app, element, instance };
}

afterEach(leaveFrame);

it("draws the source card's chart with the card's parameters, the panel's bound value over them, read as the reader", async () => {
  const { sent, requests } = owners(() => Response.json({ chartFile, parameters: cardParameters }));
  const { app, element, instance } = mounted(requests, "c-9");
  await vi.waitFor(() => expect(JSON.parse(element.querySelector(".drawn")?.getAttribute("data-rows") ?? "[]")).toEqual(rows), { timeout: 5000 });
  // The template by this projection, the MetricView by its bound ID; no definition read stands in for the card.
  expect(sent.map((request) => `${request.method} ${request.service}${request.path}`)).toEqual([
    `GET /product-projections/${chart.id}/chart-source`,
    "POST /data-query/ontology/query/metrics/describe",
    "POST /data-query/metricView/execute",
  ]);
  expect(sent[1]!.body).toEqual({ id: METRIC });
  // The card's parameters underneath, not the MetricView's defaults; the panel's object by its key over its own.
  expect(sent[2]!.body).toEqual({ id: METRIC, param: { year: 2025, regions: ["east", "west"], customer: "c-9" } });

  // A bound value that changes reads the card again and lays the new value over it; nothing merged was kept.
  instance.state.set("customer", null);
  await vi.waitFor(() => expect(sent.filter((request) => request.path === "/metricView/execute")).toHaveLength(2));
  expect(sent.at(-1)!.body).toEqual({ id: METRIC, param: cardParameters });
  expect(sent.filter((request) => request.path.endsWith("/chart-source"))).toHaveLength(2);
  expect(sent.some((request) => request.method === "PUT")).toBe(false);
  app.unmount();
});

it("says the chart's source is gone, in the owner's words, and draws nothing in its place", async () => {
  const { requests } = owners(() => { throw new Error("The chart's source card no longer exists"); });
  const { app, element } = mounted(requests, null);
  await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toBe("The chart's source card no longer exists"), { timeout: 5000 });
  expect(element.querySelector(".drawn")).toBeNull();
  app.unmount();
});

it("shows the data engine's own refusal, such as a parameter the card does not give", async () => {
  const { requests } = owners(() => Response.json({ chartFile, parameters: {} }));
  const refusing: PlatformRequests = {
    request: (path, init, service) => path === "/metricView/execute"
      ? Promise.resolve(Response.json({ success: false, message: "Parameter year is required" }))
      : requests.request(path, init, service),
  };
  const { app, element } = mounted(refusing, null);
  await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toBe("Parameter year is required"), { timeout: 5000 });
  expect(element.querySelector(".drawn")).toBeNull();
  app.unmount();
});

it("saves only the drawing of the source card and takes back the owner's saved file", async () => {
  const { sent, requests } = owners(() => Response.json({ chartFile, parameters: cardParameters }));
  const { createMetricChartClient } = await import("../../../../../packages/apps-sdk/src/panel/metric-chart");
  const saving: PlatformRequests = {
    request: (path, init, service) => init.method === "PUT"
      ? (sent.push({ path, service, method: "PUT", body: JSON.parse(String(init.body)) }), Promise.resolve(Response.json({ chartFile })))
      : requests.request(path, init, service),
  };
  const saved = await createMetricChartClient(saving).saveTemplate(chart.id, chartFile.content);
  expect(saved).toEqual(chartFile);
  expect(sent).toEqual([{ path: `/product-projections/${chart.id}/chart-source`, service: "", method: "PUT", body: { chartFile: { content: chartFile.content } } }]);
});

it("draws a chart through the platform's bridge as the reader", async () => {
  const panel = panelRecord("panel-charts", "Charts", manifest);
  const use = panelUse("use-charts", "charts", panel.id, "/applications/app-charts/charts");
  installPlatform((request) => {
    if (request.path === `/api/product-projections/${chart.id}`) return Response.json({ projection: chart });
    if (request.path === `/api/product-projections/${chart.id}/chart-source`) return Response.json({ chartFile, parameters: cardParameters });
    if (request.path === "/api/data-query/ontology/query/metrics/describe") return Response.json(description);
    if (request.path === "/api/data-query/metricView/execute") return Response.json({ success: true, data: rows });
    return nothingAt(request);
  });
  const { mountPanel } = await import("../../../../../packages/apps-sdk/src/panel/mount");
  const frame = panelFrame();
  platformPanelHost("app-charts", use, ignoreChanges).frame(frame, registered("app-charts", use, panel), true);
  writePanelDocument(registered("app-charts", use, panel), "/applications/app-charts/charts", { customer: { className: "Customer", primaryKey: "c-9" } });
  inside(frame);
  await mountPanel(panelOf("revenue"));
  await vi.waitFor(() => expect(document.querySelector("#app .drawn")).not.toBeNull(), { timeout: 3000 });
});
