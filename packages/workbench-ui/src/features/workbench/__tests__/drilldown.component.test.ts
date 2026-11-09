import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import DatasetDrilldown from "../components/DatasetDrilldown.vue";
const api = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get, nodeApiFetch: api.fetch }));
const preview = { question: "Payroll by department", groups: [{ label: "Department", value: "Information" }], filters: ["Active staff"], assumptions: ["Current staff"], truncated: true };

it("starts details with one click and retries only the row identity with the same admission key", async () => {
  api.get.mockResolvedValue(preview);
  api.fetch.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce({});
  const refresh = vi.fn();
  const wrapper = mount(DatasetDrilldown, { props: { artifact: { id: "dataset", sessionId: "session" } as never, selectedRowIndices: [2], refreshConversation: refresh }, global: { plugins: [workbenchI18n(), ElementPlus] } });
  try {
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/assistant/sessions/session/artifacts/dataset/drilldown?rowIndex=2");
    await wrapper.get(".dataset-selection-button").trigger("click"); await flushPromises();
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toBe("Response lost");
    expect(refresh).not.toHaveBeenCalled();
    await wrapper.get(".dataset-selection-button").trigger("click"); await flushPromises();
    expect(api.fetch.mock.calls[0]![2]).toEqual({ rowIndex: 2 });
    expect(api.fetch.mock.calls[0]![3]).toEqual(api.fetch.mock.calls[1]![3]);
    expect(refresh).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ selectedRowIndices: [1, 2] }); await flushPromises();
    expect(wrapper.find(".dataset-selection-button").exists()).toBe(false);
  } finally { wrapper.unmount(); }
});

it("ignores a late preview for a previous selection and hides unsupported datasets", async () => {
  let resolveOld!: (value: unknown) => void;
  api.get.mockReset().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockRejectedValueOnce(new Error("Unsupported"));
  const wrapper = mount(DatasetDrilldown, { props: { artifact: { id: "dataset", sessionId: "session" } as never, selectedRowIndices: [0] }, global: { plugins: [workbenchI18n(), ElementPlus] } });
  try {
    await wrapper.setProps({ selectedRowIndices: [1] }); await flushPromises();
    resolveOld(preview); await flushPromises();
    expect(wrapper.find(".dataset-selection-button").exists()).toBe(false);
  } finally { wrapper.unmount(); }
});
