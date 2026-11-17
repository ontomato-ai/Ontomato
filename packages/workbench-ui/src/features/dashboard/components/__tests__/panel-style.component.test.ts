import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ElementPlus from "element-plus";
import DashboardPanel from "../DashboardPanel.vue";
import { workbenchI18n } from "../../../../i18n";

/**
 * The board is drawn by its own layout: groups, the card grids, the empty state and a draft's bar. Those rules live in
 * this component's own scoped stylesheet, so each element the layout names carries the component's scope attribute —
 * a layout whose elements lost it reads as loose text on the page.
 */
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
      charts: [],
      metrics: [{ id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total", unit: "CNY" }],
    },
    // A group with nothing in it yet: the empty hint and the empty grid are that group's own layout.
    { id: "g2", title: "Stock", charts: [], metrics: [] },
  ],
};

vi.mock("../../api", () => ({
  fetchDashboardLocalDetail: async () => board,
  queryDashboardCard: async () => ({ card: { id: "n1", name: "Total revenue", query: { kind: "metric", metricId: "m-2", parameters: {} }, valueField: "total" }, metric: { id: "m-2", name: "Total", revision: "r1", status: "PUBLISHED" }, columns: [{ key: "total", label: "Total", type: null }], rows: [{ total: 60 }], truncation: null }),
  modifyDashboardLayout: async () => true,
  modifyResultSetName: async () => true,
  fetchCardParameterForm: async () => ({ revision: "r1", fields: [], values: {}, readOnly: [] }),
  saveCardParameters: async () => ({ cardId: "n1", query: { kind: "metric", metricId: "m-2", parameters: {} }, revision: "r1" }),
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

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: { template: "<div />" } }] });
const global = () => ({ plugins: [workbenchI18n(), createPinia(), router, ElementPlus], stubs: { EChart: true } });

/** The scope attribute Vue's compiler gives this component's elements, e.g. `data-v-1a2b3c4d`. */
function scopeOf(wrapper: Awaited<ReturnType<typeof open>>) {
  const attributes = wrapper.find(".dash-root").attributes();
  const scope = Object.keys(attributes).find((name) => name.startsWith("data-v-"));
  expect(scope).toBeTruthy();
  return scope!;
}

async function open(draft: unknown = null) {
  await router.push("/");
  const wrapper = mount(DashboardPanel, { props: { dashboardId: "d1", draft }, global: global() });
  await flushPromises();
  return wrapper;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the board's own layout rules", () => {
  it("give the groups, the card grid, the empty hint and the draft's bar their component's scope", async () => {
    const wrapper = await open();
    const scope = scopeOf(wrapper);
    for (const selector of [".dash-root", ".bi-dashboard", ".block", ".group-header", ".group-drag-handle", ".group-title", ".metrics-section", ".charts-wrapper", ".charts-section", ".charts-empty-overlay", ".charts-empty-hint", ".charts-empty-hint__title", ".charts-empty-hint__desc", ".charts-empty-hint__hl"]) {
      const element = wrapper.find(selector);
      expect(element.exists(), selector).toBe(true);
      expect(element.attributes(), selector).toHaveProperty(scope);
    }
    wrapper.unmount();
  });

  it("cover a draft's bar too", async () => {
    const wrapper = await open({
      pageKey: "dashboard",
      operation: "dashboard.chart.rename",
      target: { id: "d1" },
      form: { id: "d1", chartId: "n1", resultSetName: "Revenue" },
    });
    const scope = scopeOf(wrapper);
    for (const selector of [".draft-bar", ".draft-bar__text", ".draft-bar__actions"]) {
      expect(wrapper.find(selector).attributes(), selector).toHaveProperty(scope);
    }
    wrapper.unmount();
  });

  it("keep the layout's rules in this component's own scoped stylesheet, narrow layout included", () => {
    // A board whose stylesheet went missing is drawn as loose text: its groups, grids, empty hint and draft bar are
    // styled here, and only here.
    const file = resolve(process.cwd(), "src/features/dashboard/components/DashboardPanel.vue");
    const source = readFileSync(file, "utf8");
    const styles = [...source.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
    expect(styles).toHaveLength(1);
    expect(styles[0]![1]).toContain("scoped");
    const css = styles[0]![2];
    for (const selector of [".dash-root", ".empty-state", ".bi-dashboard", ".block", ".group-header", ".group-drag-handle", ".group-title", ".metrics-section", ".charts-wrapper", ".charts-section", ".charts-section--empty", ".charts-empty-overlay", ".charts-empty-hint", ".charts-empty-hint__hl", ".drag-ghost", ".draft-bar", ".draft-bar__text", ".draft-bar__board", ".draft-bar__failure", ".draft-bar__actions", ".empty"]) {
      expect(css, selector).toContain(selector + " {");
    }
    // The narrow layout is one column of cards, as it was before the page was drawn again.
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});
