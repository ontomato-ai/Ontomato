import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import AnalysisScopeDialog from "../components/AnalysisScopeDialog.vue";
const api = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get, nodeApiFetch: api.fetch }));
beforeEach(() => { vi.resetAllMocks(); });
it("shows the source condition and submits adjustments with a stable retry identity", async () => {
  api.get.mockResolvedValue({ question: "Staff aged 60+", assumptions: [], filters: [{ id: "age", label: "Age ≥ 60", expression: "age >= 60" }] });
  api.fetch.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({});
  const refresh = vi.fn();
  const wrapper = mount(AnalysisScopeDialog, { props: { modelValue: false, artifact: { id: "dataset", sessionId: "session" } as never, refresh }, global: { plugins: [workbenchI18n(), ElementPlus] } });
  try {
    await wrapper.setProps({ modelValue: true }); await flushPromises();
    expect(wrapper.findComponent({ name: "ElSelect" }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "ElForm" }).text()).toContain("Age ≥ 60");
    await wrapper.findComponent({ name: "ElInput" }).setValue("Age ≥ 55");
    const submit = () => wrapper.findAllComponents({ name: "ElButton" }).at(-1)!;
    await submit().trigger("click"); await flushPromises();
    await submit().trigger("click"); await flushPromises();
    expect(api.fetch.mock.calls[0]![3].headers["Idempotency-Key"]).toBe(api.fetch.mock.calls[1]![3].headers["Idempotency-Key"]);
    expect(api.fetch.mock.calls[1]![2]).toEqual({ adjustment: "Age ≥ 55" });
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});

it("displays all conditions and allows multiple changes without choosing a condition", async () => {
  api.get.mockResolvedValue({ question: "Active staff aged 60+", assumptions: [], filters: [
    { id: "age", label: "Age ≥ 60", expression: "age >= 60" },
    { id: "status", label: "Active", expression: "status = active" },
  ] });
  api.fetch.mockResolvedValue({});
  const wrapper = mount(AnalysisScopeDialog, { props: { modelValue: false, artifact: { id: "dataset", sessionId: "session" } as never }, global: { plugins: [workbenchI18n(), ElementPlus] } });
  try {
    await wrapper.setProps({ modelValue: true }); await flushPromises();
    const select = wrapper.findComponent({ name: "ElSelect" });
    expect(select.exists()).toBe(false);
    const form = wrapper.findComponent({ name: "ElForm" });
    expect(form.text()).toContain("Age ≥ 60");
    expect(form.text()).toContain("Active");
    const submit = wrapper.findAllComponents({ name: "ElButton" }).at(-1)!;
    expect(submit.props("disabled")).toBe(true);
    await wrapper.findComponent({ name: "ElInput" }).setValue("Age ≥ 55 and retired staff");
    expect(submit.props("disabled")).toBe(false);
    await submit.trigger("click"); await flushPromises();
    expect(api.fetch.mock.calls[0]![2]).toEqual({ adjustment: "Age ≥ 55 and retired staff" });
  } finally { wrapper.unmount(); }
});
