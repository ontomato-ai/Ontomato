import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import AnalysisScopeDialog from "../components/AnalysisScopeDialog.vue";
const api = vi.hoisted(() => ({ get: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get, nodeApiFetch: api.fetch }));
it("shows only source filters and starts a new query with a stable retry identity", async () => {
  api.get.mockResolvedValue({ question: "Staff aged 60+", assumptions: [], filters: [{ id: "age", label: "Age ≥ 60", expression: "age >= 60" }] });
  api.fetch.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({});
  const refresh = vi.fn();
  const wrapper = mount(AnalysisScopeDialog, { props: { modelValue: false, artifact: { id: "dataset", sessionId: "session" } as never, refresh }, global: { plugins: [workbenchI18n(), ElementPlus] } });
  try {
    await wrapper.setProps({ modelValue: true }); await flushPromises();
    const select = wrapper.findComponent({ name: "ElSelect" });
    select.vm.$emit("update:modelValue", "age"); await flushPromises();
    await wrapper.findComponent({ name: "ElInput" }).setValue("Age ≥ 55");
    const submit = () => wrapper.findAllComponents({ name: "ElButton" }).at(-1)!;
    await submit().trigger("click"); await flushPromises();
    await submit().trigger("click"); await flushPromises();
    expect(api.fetch.mock.calls[0]![3].headers["Idempotency-Key"]).toBe(api.fetch.mock.calls[1]![3].headers["Idempotency-Key"]);
    expect(api.fetch.mock.calls[1]![2]).toEqual({ filterId: "age", replacement: "Age ≥ 55" });
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally { wrapper.unmount(); }
});
