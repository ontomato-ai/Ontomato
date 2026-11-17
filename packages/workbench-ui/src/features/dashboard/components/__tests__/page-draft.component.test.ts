import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import DashboardHome from "../DashboardHome.vue";
import { workbenchI18n } from "../../../../i18n";

/**
 * A dashboard draft is an agent's proposed change: the page reads the run's draft file, checks it against the board
 * the reader owns, shows the change, and posts nothing until the reader saves. What it posts is the page's own save
 * request for that operation; a draft for another page or another board is not filled. Doubles: the draft file, the
 * dashboard API and the platform's chart.
 */
const api = vi.hoisted(() => ({
  pageDraft: null as unknown,
  renamed: [] as unknown[],
  layouts: [] as unknown[],
  parameters: [] as unknown[],
}));
vi.mock("../../../workbench/assistant-host", () => ({
  createAssistantClient: () => ({
    readPageDraft: async () => api.pageDraft,
  }),
}));

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

vi.mock("../../api", () => ({
  fetchDashboardList: async () => [{ id: "d1", name: "Sales", createdAt: 0, updatedAt: 0 }],
  fetchDashboardLocalDetail: async () => board,
  queryDashboardCard: async (_dashboardId: string, cardId: string) =>
    cardId === "c1"
      ? { card: { id: "c1", name: "Revenue by region", query: { kind: "metric", metricId: "m-1", parameters: {} } }, file, metric: { id: "m-1", name: "Revenue", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "region", label: "Region", type: null }, { key: "revenue", label: "Revenue", type: null }], rows: [{ region: "East", revenue: 60 }], truncation: null }
      : { card: { id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total" }, metric: { id: "m-2", name: "Total", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "total", label: "Total", type: null }], rows: [{ total: 60 }], truncation: null },
  modifyResultSetName: async (...args: unknown[]) => { api.renamed.push(args); return true; },
  modifyDashboardLayout: async (...args: unknown[]) => { api.layouts.push(args); return true; },
  saveCardParameters: async (...args: unknown[]) => { api.parameters.push(args); return { cardId: "c1", query: board.groups[0]!.charts[0]!.query, revision: "r1" }; },
  fetchCardParameterForm: async () => ({
    revision: "r1",
    fields: [{ type: "text", key: "year", label: "Year", required: false, defaultValue: null, help: null, multiline: false, placeholder: null, maxLength: 20 }],
    values: { year: "2026" },
    readOnly: [],
  }),
  createDimension: async () => true,
  deleteDashboard: async () => true,
  deleteDimension: async () => true,
  deleteMetric: async () => true,
  deleteResultSet: async () => true,
  modifyDimensionName: async () => true,
  modifyMetricName: async () => true,
  renameDashboard: async () => true,
}));
vi.mock("@ontomato/foundation-ui/chart", async () => {
  const actual = await import("@ontomato/foundation-ui/chart");
  return { ...actual, EChart: { name: "EChart", template: "<div />" } };
});
vi.mock("interactjs", () => ({
  default: Object.assign(() => ({ resizable: () => ({ unset: () => {} }) }), {
    modifiers: { restrictSize: () => ({}) },
  }),
}));

const t = workbenchI18n().global.t;

async function openDraft(draft: unknown) {
  api.pageDraft = draft;
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: DashboardHome }],
  });
  await router.push({
    path: "/",
    query: {
      dashboardId: "d1",
      draftSessionId: "11111111-1111-4111-8111-111111111111",
      draftRunId: "22222222-2222-4222-8222-222222222222",
      draftPath: "outputs/drafts/revenue.page-draft.json",
    },
  });
  await router.isReady();
  const wrapper = mount(DashboardHome, {
    global: { plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true, transition: false } },
  });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = "";
  api.pageDraft = null;
  api.renamed = [];
  api.layouts = [];
  api.parameters = [];
});

describe("a dashboard draft", () => {
  it("shows the renamed card with the name it had, and saves through the page's own rename", async () => {
    const wrapper = await openDraft({
      pageKey: "dashboard",
      operation: "dashboard.chart.rename",
      target: { id: "d1" },
      form: { id: "d1", chartId: "c1", resultSetName: "Revenue by province" },
    });
    expect(wrapper.text()).toContain(t("dashboard.draft.title"));
    expect(wrapper.find(".chart-original-name").text()).toBe("Revenue by region");
    // Nothing was saved by reading or showing the draft.
    expect(api.renamed).toEqual([]);
    expect(api.layouts).toEqual([]);

    await wrapper.find(".draft-bar__actions .el-button--primary").trigger("click");
    await flushPromises();
    expect(api.renamed).toEqual([["d1", "c1", "Revenue by province"]]);
    wrapper.unmount();
  });

  it("draws a draft's chart file over the card's current data and saves it with the layout request", async () => {
    const draftFile = { name: "province.chart.json", content: { ...file.content, title: { text: "By province" } } };
    const wrapper = await openDraft({
      pageKey: "dashboard",
      operation: "dashboard.layout",
      target: { id: "d1" },
      form: {
        id: "d1",
        groups: [{ id: "g1", title: "Sales", charts: [{ id: "c1", name: "Revenue by region", chartFile: draftFile }], metrics: [{ id: "n1" }] }],
      },
    });
    expect(wrapper.find(".chart-draft-badge").text()).toBe(t("dashboard.draft.chartChanged"));
    expect(wrapper.findComponent({ name: "MetricChart" }).props("file")).toEqual(draftFile.content);
    expect(api.layouts).toEqual([]);

    await wrapper.find(".draft-bar__actions .el-button--primary").trigger("click");
    await flushPromises();
    expect(api.layouts).toHaveLength(1);
    expect((api.layouts[0] as unknown[])[1]).toEqual([{ id: "g1", title: "Sales", charts: [{ id: "c1", name: "Revenue by region", chartFile: draftFile }], metrics: [{ id: "n1" }] }]);
    wrapper.unmount();
  });

  it("fills a card's parameters with the draft's values and revision", async () => {
    const wrapper = await openDraft({
      pageKey: "dashboard",
      operation: "dashboard.card.parameters",
      target: { id: "d1" },
      form: { dashboardId: "d1", cardId: "c1", revision: "r1", values: { year: "2024" } },
    });
    await flushPromises();
    document.querySelector<HTMLButtonElement>(".el-dialog__footer .el-button--primary")!.click();
    await flushPromises();
    expect(api.parameters).toEqual([[{ dashboardId: "d1", cardId: "c1", revision: "r1", values: { year: "2024" } }]]);
    wrapper.unmount();
  });

  it("is not filled when it is for another page, another board, or an object this board does not have", async () => {
    for (const draft of [
      { pageKey: "agent-settings", operation: "dashboard.chart.rename", target: { id: "d1" }, form: { id: "d1", chartId: "c1", resultSetName: "x" } },
      { pageKey: "dashboard", operation: "assistant.delete", target: { id: "d1" }, form: { id: "d1" } },
      { pageKey: "dashboard", operation: "dashboard.chart.rename", target: { id: "d2" }, form: { id: "d2", chartId: "c1", resultSetName: "x" } },
      { pageKey: "dashboard", operation: "dashboard.chart.rename", target: { id: "d1" }, form: { id: "d1", chartId: "gone", resultSetName: "x" } },
    ]) {
      const wrapper = await openDraft(draft);
      expect(wrapper.find(".draft-failure").exists()).toBe(true);
      expect(wrapper.find(".draft-bar").exists()).toBe(false);
      wrapper.unmount();
    }
  });
});
