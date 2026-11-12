import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import ElementPlus from "element-plus";
import Detail from "../components/DashboardMetricDetail.vue";

const api = vi.hoisted(() => ({ query: vi.fn(), form: vi.fn() }));
vi.mock("../api", () => ({ queryDashboardCard: api.query, fetchCardParameterForm: api.form }));
beforeEach(() => {
  api.query.mockReset().mockResolvedValue({ card: { query: { parameters: { employment_status: "active" } } }, metric: { name: "Staff", status: "PUBLISHED" }, rows: [{ count: 3109 }], columns: [{ key: "count", label: "Staff count" }], truncation: null });
  api.form.mockReset().mockResolvedValue({ fields: [{ key: "employment_status", label: "Employment status", type: "select", options: [{ value: "active", label: "Active staff" }], help: "Uses the saved status filter" }] });
});
const page = () => mount(Detail, { props: { dashboardId: "board", cardId: "card" }, global: { plugins: [ElementPlus, createI18n({ legacy: false, locale: "en", messages: { en: {} } })] } });
describe("workspace metric context", () => {
  it("shows business parameter labels and selected option labels", async () => {
    const wrapper = page(); await flushPromises();
    expect(wrapper.text()).toContain("Employment status");
    expect(wrapper.text()).toContain("Active staff");
    expect(wrapper.text()).not.toContain("employment_status");
    wrapper.unmount();
  });
  it("retains query results when parameter metadata is unavailable", async () => {
    api.form.mockRejectedValue(new Error("Unavailable"));
    const wrapper = page(); await flushPromises();
    expect(wrapper.text()).toContain("3109");
    expect(wrapper.text()).toContain("Parameter labels unavailable");
    expect(wrapper.text()).toContain("employment_status");
    wrapper.unmount();
  });
});
