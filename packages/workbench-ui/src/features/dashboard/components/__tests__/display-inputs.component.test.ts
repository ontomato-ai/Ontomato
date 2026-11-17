import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import { MetricChart } from "@ontomato/foundation-ui/chart";
import ChartZoomModal from "../ChartZoomModal.vue";
import ChartCard from "../ChartCard.vue";
import MetricCard from "../MetricCard.vue";
import { workbenchI18n } from "../../../../i18n";
import { installWorkbenchContent, workbenchContent, type DashboardVisuals } from "../../../../content";

vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const ossContent = workbenchContent();
/** Overrides the dashboard display inputs another layout may supply (the non-default values). */
function useDashboardVisuals(patch: Partial<DashboardVisuals>) {
  installWorkbenchContent({ ...ossContent, dashboard: { ...ossContent.dashboard, ...patch } });
}
afterEach(() => {
  installWorkbenchContent(ossContent);
  document.body.innerHTML = "";
});

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
/** The platform's chart draws through ECharts, which has no canvas here; the card's file and output are what is read. */
const global = () => ({ plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true } });

const file = {
  name: "revenue.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "bar", datasetId: "metric", encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};
const output = { columns: [{ key: "region", label: "Region", type: null }, { key: "revenue", label: "Revenue", type: null }], rows: [{ region: "East", revenue: 60 }], truncation: null };

describe("dashboard display inputs under both layouts", () => {
  it("the zoom dialog draws the card's own file and output, truncated results included", async () => {
    const wrapper = mount(ChartZoomModal, { props: { file: file.content, metric: output, table: { columns: ["Region"], rows: [["East"]] } }, global: global() });
    // The component is a JS <script setup>, so test-utils cannot infer its props type.
    await wrapper.setProps({ open: true } as never);
    await flushPromises();
    const chart = wrapper.findComponent(MetricChart);
    expect(chart.props("file")).toEqual(file.content);
    expect(chart.props("metric")).toEqual(output);
    wrapper.unmount();
  });

  it("loading mask: the Element Plus default under another layout, transparent in the open source", async () => {
    const card = (chart: object) => mount(ChartCard, { props: { chart }, global: global() });
    const drawing = { id: "c1", name: "Revenue", query: { kind: "metric", metricId: "m", parameters: {} }, chartFile: file, state: "ready", ...output };
    useDashboardVisuals({ loadingMask: "default" });
    expect(card(drawing).find(".chart-wrapper").classes()).not.toContain("chart-wrapper--transparent-loading");

    installWorkbenchContent(ossContent);
    expect(card(drawing).find(".chart-wrapper").classes()).toContain("chart-wrapper--transparent-loading");

    const metric = { id: "n1", name: "Total", query: { kind: "metric", metricId: "m", parameters: {} }, valueField: "total", state: "ready", rows: [{ total: 3 }], columns: [{ key: "total", label: "Total", type: null }] };
    expect(mount(MetricCard, { props: { metric }, global: global() }).find(".value-container").classes()).toContain("value-container--transparent-loading");
  });
});
