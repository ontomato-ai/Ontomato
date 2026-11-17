import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import ElementPlus from "element-plus";
import DashboardPanel from "../DashboardPanel.vue";
import DashboardHome from "../DashboardHome.vue";
import { clearDashboardSelection, dashboardSelection } from "../../selection";
import { workbenchI18n } from "../../../../i18n";


/**
 * The card a reader points at is what a message sent from beside the page asks about: choosing a card reports the board
 * and that card — its ids, its kind and the name shown — to the platform's page context, and a freshly drawn board
 * reports itself alone. Choosing a card is not a change: it writes nothing. Doubles: the dashboard API, the platform's
 * chart and the resize library.
 */
const api = vi.hoisted(() => ({ layouts: [] as unknown[], renamed: [] as unknown[] }));
const file = {
  name: "revenue.chart.json",
  content: {
    dataset: [{ id: "metric", dimensions: ["region", "revenue"], source: [] }],
    series: [{ id: "revenue", type: "bar", datasetId: "metric", encode: { x: "region", y: "revenue" } }],
    ontomato: {},
  },
};
const board = {
  id: "d1",
  ownerId: "u1",
  name: "Sales",
  createdAt: 0,
  updatedAt: 0,
  groups: [
    {
      id: "g1",
      title: "Sales",
      charts: [{ id: "c1", name: "Revenue by region", query: { kind: "metric", metricId: "m-1", parameters: {} }, chartFile: file, layout: { colSpan: 12, rowSpan: 1 } }],
      metrics: [{ id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total", unit: "CNY" }],
    },
  ],
};

vi.mock("../../../workbench/assistant-host", () => ({ createAssistantClient: () => ({ readPageDraft: async () => ({}), }) }));
vi.mock("../../api", () => ({
  fetchDashboardList: async () => [{ id: "d1", name: "Sales", createdAt: 0, updatedAt: 0 }],
  fetchDashboardLocalDetail: async () => board,
  queryDashboardCard: async (_dashboardId: string, cardId: string) =>
    cardId === "c1"
      ? { card: { id: "c1", name: "Revenue by region", query: { kind: "metric", metricId: "m-1", parameters: {} } }, file, metric: { id: "m-1", name: "Revenue", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "region", label: "Region", type: null }, { key: "revenue", label: "Revenue", type: null }], rows: [{ region: "East", revenue: 60 }], truncation: null }
      : { card: { id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total" }, metric: { id: "m-2", name: "Total", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "total", label: "Total", type: null }], rows: [{ total: 60 }], truncation: null },
  modifyDashboardLayout: async (...args: unknown[]) => { api.layouts.push(args); return true; },
  modifyResultSetName: async (...args: unknown[]) => { api.renamed.push(args); return true; },
  fetchCardParameterForm: async () => ({ revision: "r1", fields: [], values: {}, readOnly: [] }),
  saveCardParameters: async () => ({ cardId: "c1", query: { kind: "metric", metricId: "m-1", parameters: {} }, revision: "r1" }),
  createDimension: async () => true,
  deleteDimension: async () => true,
  deleteMetric: async () => true,
  modifyDimensionName: async () => true,
  modifyMetricName: async () => true,
  renameDashboard: async () => true,
}));
vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

/** Each test opens the page at its own address: the store keeps the page it is mounted on, and one page's is not another's. */
async function openRouter(query: Record<string, string> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
  await router.push({ path: "/", query });
  await router.isReady();
  return router;
}
let router: Router;
const global = () => ({ plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true } });

async function open() {
  router = await openRouter();
  const wrapper = mount(DashboardPanel, { props: { dashboardId: "d1", draft: null }, global: global() });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  clearDashboardSelection();
  api.layouts = [];
  api.renamed = [];
  document.body.innerHTML = "";
});

describe("what the dashboard reports as selected", () => {
  it("reports the board alone once it is drawn", async () => {
    const wrapper = await open();
    expect(dashboardSelection.value).toEqual([{ kind: "dashboard", id: "d1", label: "Sales" }]);
    wrapper.unmount();
  });

  it("reports the card the reader chose beside the board, and one card at a time", async () => {
    const wrapper = await open();
    await wrapper.find(".chart-container").trigger("click");
    await flushPromises();
    expect(dashboardSelection.value).toEqual([
      { kind: "dashboard", id: "d1", label: "Sales" },
      { kind: "dashboard-card-chart", id: "c1", label: "Revenue by region" },
    ]);
    expect(wrapper.find(".chart-container").classes()).toContain("chart-container--selected");

    await wrapper.find(".metric-container").trigger("click");
    await flushPromises();
    expect(dashboardSelection.value.at(-1)).toEqual({ kind: "dashboard-card-metric", id: "n1", label: "Total revenue" });
    expect(wrapper.find(".chart-container").classes()).not.toContain("chart-container--selected");

    // Choosing a card is not a change: nothing was saved.
    expect(api.layouts).toEqual([]);
    expect(api.renamed).toEqual([]);
    wrapper.unmount();
  });

  it("chooses the card whose zoom opens", async () => {
    const wrapper = await open();
    await wrapper.find(".chart-container .ai-chart-tool-btn[title='" + workbenchI18n().global.t("dashboard.zoomIn") + "']").trigger("click");
    await flushPromises();
    expect(dashboardSelection.value.at(-1)).toMatchObject({ kind: "dashboard-card-chart", id: "c1" });
    wrapper.unmount();
  });

  it("writes the chosen card into the page's own address, which is the address the footer's composer sends", async () => {
    router = await openRouter({ dashboardId: "d1" });
    const wrapper = mount(DashboardHome, { global: { plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true, transition: false } } });
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ dashboardId: "d1" });

    await wrapper.find(".chart-container").trigger("click");
    await flushPromises();
    // The board and the card the question is about: read again beside the conversation, it opens the same card chosen.
    expect(router.currentRoute.value.query).toEqual({ dashboardId: "d1", cardId: "c1" });
    expect(dashboardSelection.value.at(-1)).toMatchObject({ kind: "dashboard-card-chart", id: "c1" });
    wrapper.unmount();
  });

  it("restores the card the page's own address names", async () => {
    router = await openRouter({ dashboardId: "d1", cardId: "c1" });
    const wrapper = mount(DashboardHome, { global: { plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true, transition: false } } });
    await flushPromises();
    expect(wrapper.find(".chart-container").classes()).toContain("chart-container--selected");
    expect(dashboardSelection.value.at(-1)).toMatchObject({ kind: "dashboard-card-chart", id: "c1" });
    wrapper.unmount();
  });

  it("restores the chosen card from the page parameter beside a conversation, and keeps the choice there", async () => {
    const page = (query: Record<string, string>) => `/dashboards?${new URLSearchParams(query)}`;
    router = await openRouter({ page: page({ dashboardId: "d1", cardId: "n1" }) });
    const wrapper = mount(DashboardHome, { global: { plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true, transition: false } } });
    await flushPromises();
    expect(wrapper.find(".metric-container").classes()).toContain("metric-container--selected");
    expect(dashboardSelection.value.at(-1)).toEqual({ kind: "dashboard-card-metric", id: "n1", label: "Total revenue" });

    // Another card moves the conversation's page parameter, not the browser's address.
    await wrapper.find(".chart-container").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/");
    expect(router.currentRoute.value.query.page).toBe(page({ dashboardId: "d1", cardId: "c1" }));
    wrapper.unmount();
  });

  it("shows the card its address names chosen, once the board is drawn", async () => {
    router = await openRouter();
    const wrapper = mount(DashboardPanel, { props: { dashboardId: "d1", draft: null, cardId: "n1" }, global: global() });
    await flushPromises();
    expect(wrapper.find(".metric-container").classes()).toContain("metric-container--selected");
    expect(wrapper.find(".chart-container").classes()).not.toContain("chart-container--selected");
    expect(dashboardSelection.value.at(-1)).toEqual({ kind: "dashboard-card-metric", id: "n1", label: "Total revenue" });
    wrapper.unmount();
  });

  it("reports nothing once the page is gone", async () => {
    const wrapper = await open();
    await wrapper.find(".chart-container").trigger("click");
    await flushPromises();
    wrapper.unmount();
    expect(dashboardSelection.value).toEqual([]);
  });
});
