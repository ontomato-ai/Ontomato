import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import Preview from "../components/DashboardMetricPreview.vue";

const api = vi.hoisted(() => ({ detail: vi.fn(), query: vi.fn() }));
vi.mock("@ontomato/foundation-ui/chart", () => ({ EChart: { props: ["option"], template: '<div class="rendered-chart" />' }, useChartTheme: () => ({ value: {} }) }));
vi.mock("../api", () => ({ fetchDashboardLocalDetail: api.detail, queryDashboardCard: api.query }));
beforeEach(() => {
  api.detail.mockReset().mockResolvedValue({ groups: [{ metrics: [
    { id: "total", name: "Total", query: { kind: "metric", metricId: "total", parameters: {} }, valueField: "value", formats: { value: { kind: "number" } }, unit: "orders" },
    { id: "failed", name: "Other metric", query: { kind: "metric", metricId: "failed", parameters: {} }, valueField: "value" },
  ] }] });
  api.query.mockReset().mockImplementation(async (_board, card) => {
    if (card === "failed") throw new Error("Metric unavailable");
    return { rows: [{ value: 0 }], truncation: null };
  });
});
describe("dashboard metric previews", () => {
  it("queries only explicitly followed cards and reports missing selections", async () => {
    const wrapper = mount(Preview, { props: { dashboardId: "board", revision: 0, cardIds: ["total", "removed"] }, global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en: {} } })] } });
    await flushPromises();
    // Only the followed card is queried, whichever position the card id takes in the call.
    const queried = api.query.mock.calls.flat();
    expect(queried).toContain("total");
    expect(queried).not.toContain("removed");
    // The one followed card that no longer exists is reported with its count.
    expect(wrapper.find('[role="note"]').text()).toContain("1");
    const queriedBefore = api.query.mock.calls.length;
    await wrapper.setProps({ cardIds: [] });
    await flushPromises();
    expect(wrapper.find(".preview-value").exists()).toBe(false);
    expect(api.query.mock.calls.length).toBe(queriedBefore);
    wrapper.unmount();
  });
  it("loads a saved chart and emits its identity for the workspace detail interaction", async () => {
    const card = { id: "status-chart", name: "Staff status", query: { kind: "metric", metricId: "status", parameters: {} }, chartType: "bar", fields: { xAxis: "category", yAxis: "count" } };
    api.detail.mockResolvedValue({ groups: [{ metrics: [], charts: [card] }] });
    api.query.mockResolvedValue({ card, columns: [{ key: "category", label: "Status" }, { key: "count", label: "Count" }], rows: [{ category: "Active", count: 3109 }], truncation: null });
    const wrapper = mount(Preview, { props: { dashboardId: "board", revision: 0 }, global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en: {} } })] } });
    await flushPromises();
    expect(wrapper.find('.rendered-chart').exists()).toBe(true);
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([{ id: "status-chart", name: "Staff status" }]);
    wrapper.unmount();
  });
  it("discards a result from the previous dashboard after switching", async () => {
    let finish!: (value: unknown) => void;
    api.query.mockImplementation((_board, card) => card === "total" ? new Promise(resolve => { finish = resolve; }) : Promise.reject(new Error("Metric unavailable")));
    const wrapper = mount(Preview, { props: { dashboardId: "first", revision: 0 }, global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en: {} } })] } });
    await flushPromises();
    api.detail.mockResolvedValue({ groups: [] });
    await wrapper.setProps({ dashboardId: "second" });
    await flushPromises();
    finish({ rows: [{ value: 999 }], truncation: null });
    await flushPromises();
    expect(wrapper.text()).not.toContain("999");
    wrapper.unmount();
  });
  it("shows zero values while isolating a failed metric", async () => {
    const wrapper = mount(Preview, { props: { dashboardId: "board", revision: 0 }, global: { plugins: [createI18n({ legacy: false, locale: "en", messages: { en: {} } })] } });
    await flushPromises();
    // A zero stays the value shown, with the card's unit.
    const value = wrapper.find(".preview-value strong").text();
    expect(value).toContain("0");
    expect(value).toContain("orders");
    expect(wrapper.text()).toContain("Metric unavailable");
    await wrapper.setProps({ revision: 1 });
    await flushPromises();
    // A new revision reads the board again.
    expect(api.detail.mock.calls.length).toBeGreaterThan(1);
    wrapper.unmount();
  });
});
