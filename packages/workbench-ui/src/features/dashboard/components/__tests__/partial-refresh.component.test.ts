import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import ElementPlus from "element-plus";
import ChartCard from "../ChartCard.vue";
import MetricCard from "../MetricCard.vue";
import { createDashboardLoader } from "../utils/dashboardHelper";
import { workbenchI18n } from "../../../../i18n";

/**
 * A dashboard widget refresh keeps the data engine's partial-result marker on the widget it fills.
 * The chart and the number card show the localized header with the hint verbatim, and a partial chart
 * without rows never says "no data". A complete refresh leaves no marker. Doubles: the dashboard
 * API boundary, the platform's chart and the resize library.
 */
const api = vi.hoisted(() => ({ response: {} as Record<string, unknown> }));
const file = {
  name: "sites.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["town", "count"], source: [] }],
    series: [{ id: "count", type: "bar", datasetId: "metric", encode: { x: "town", y: "count" } }],
    ontomato: {},
  },
};
vi.mock("../../api", () => ({
  fetchDashboardLocalDetail: async () => ({
    id: "d1",
    groups: [
      {
        id: "g1",
        title: "Sites",
        charts: [{ id: "c1", name: "Sites by town", query: { kind: "metric", metricId: "m1", parameters: {} }, chartFile: file }],
        metrics: [{ id: "n1", name: "Site count", query: { kind: "metric", metricId: "m2", parameters: {} }, valueField: "count" }],
      },
    ],
  }),
  queryDashboardCard: async (_dashboardId: string, cardId: string) =>
    cardId === "c1"
      ? { card: { id: "c1", name: "Sites by town", query: { kind: "metric", metricId: "m1", parameters: {} } }, file, metric: { id: "m1", name: "Sites", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "town", label: "Town", type: null }, { key: "count", label: "Count", type: null }], ...api.response }
      : { card: { id: "n1", name: "Site count", query: { kind: "metric", metricId: "m2", parameters: {} }, valueField: "count" }, metric: { id: "m2", name: "Sites", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "count", label: "Count", type: null }], ...api.response },
}));
vi.mock("@ontomato/foundation-ui/chart", () => ({
  MetricChart: { name: "MetricChart", props: ["file", "metric", "height", "empty"], template: '<div class="drawn-chart" />' },
  useChartTheme: () => ({ value: {} }),
}));
vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const MARKER = {
  truncated: true,
  rowLimit: 100000,
  truncationHint: "Intermediate rows reached the processing cap.",
};

const i18n = workbenchI18n();
const t = i18n.global.t;

async function load(response: Record<string, unknown>) {
  api.response = response;
  let groups: any[] = [];
  await createDashboardLoader().loadDashboardById("d1", (next: any) => {
    groups = typeof next === "function" ? next(groups) : next;
  });
  return { chart: groups[0].charts[0], metric: groups[0].metrics[0] };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dashboard widget refresh with a partial result", () => {
  it("keeps the marker on the chart and the number card, and shows it instead of 'no data'", async () => {
    const { chart, metric } = await load({ rows: [], truncation: MARKER });
    expect(chart.truncation).toMatchObject(MARKER);
    expect(metric.truncation).toMatchObject(MARKER);

    const header = t("chat.partialResult", { rowLimit: 100000 });
    const chartCard = mount(ChartCard, { props: { chart }, global: { plugins: [i18n, ElementPlus], stubs: { EChart: true } } });
    const mask = chartCard.find(".chart-mask").text();
    // The localized header and the data engine's own hint, in place of "no data".
    expect(mask).toContain(header);
    expect(mask).toContain(MARKER.truncationHint);
    expect(mask).not.toContain(t("common.noData"));

    const metricCard = mount(MetricCard, { props: { metric }, global: { plugins: [i18n, ElementPlus] } });
    const title = metricCard.find(".metric-partial").attributes("title")!;
    expect(title).toContain(header);
    expect(title).toContain(MARKER.truncationHint);
  });

  it("leaves a complete refresh unmarked", async () => {
    const { chart, metric } = await load({ rows: [], truncation: null });
    expect(chart.truncation).toBeUndefined();
    expect(metric.truncation).toBeUndefined();
    const chartCard = mount(ChartCard, { props: { chart }, global: { plugins: [i18n, ElementPlus], stubs: { EChart: true } } });
    expect(chartCard.find(".chart-mask").text()).toBe(t("common.noData"));
  });
});
