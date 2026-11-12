import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import AnalysisScopeDialog from "../components/AnalysisScopeDialog.vue";
import { shellContextKey } from "../../../../../agent-shell-ui/src/context";
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get }));
beforeEach(() => { vi.resetAllMocks(); });
const artifact = { id: "dataset", sessionId: "session", path: "outputs/retrievals/r/d.dataset.json" } as never;
function mountDialog(proceed: (message: string) => Promise<void>) {
  return mount(AnalysisScopeDialog, { props: { modelValue: false, artifact, title: "Staff" },
    global: { plugins: [workbenchI18n(), ElementPlus], provide: { [shellContextKey as symbol]: { continueConversation: proceed } } } });
}

it("shows the source condition and sends the adjustment as one ordinary message naming the file", async () => {
  api.get.mockResolvedValue({ question: "Staff aged 60+", assumptions: [], filters: [{ id: "age", label: "Age ≥ 60", expression: "age >= 60" }] });
  const proceed = vi.fn().mockRejectedValueOnce(new Error("Working")).mockResolvedValueOnce(undefined);
  const wrapper = mountDialog(proceed);
  try {
    await wrapper.setProps({ modelValue: true }); await flushPromises();
    expect(wrapper.findComponent({ name: "ElSelect" }).exists()).toBe(false);
    expect(wrapper.findComponent({ name: "ElForm" }).text()).toContain("Age ≥ 60");
    await wrapper.findComponent({ name: "ElInput" }).setValue("Age ≥ 55");
    const submit = () => wrapper.findAllComponents({ name: "ElButton" }).at(-1)!;
    await submit().trigger("click"); await flushPromises();
    expect(wrapper.props("modelValue")).toBe(true);
    await submit().trigger("click"); await flushPromises();
    // One message naming the file, its title and the reader's own adjustment.
    const message = proceed.mock.calls.at(-1)![0] as string;
    expect(message).toContain("Staff");
    expect(message).toContain("outputs/retrievals/r/d.dataset.json");
    expect(message).toContain("Age ≥ 55");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  } finally { wrapper.unmount(); }
});

it("displays all conditions and allows multiple changes without choosing a condition", async () => {
  api.get.mockResolvedValue({ question: "Active staff aged 60+", assumptions: [], filters: [
    { id: "age", label: "Age ≥ 60", expression: "age >= 60" },
    { id: "status", label: "Active", expression: "status = active" },
  ] });
  const proceed = vi.fn().mockResolvedValue(undefined);
  const wrapper = mountDialog(proceed);
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
    expect(proceed).toHaveBeenCalledWith(expect.stringContaining("Age ≥ 55 and retired staff"));
  } finally { wrapper.unmount(); }
});
