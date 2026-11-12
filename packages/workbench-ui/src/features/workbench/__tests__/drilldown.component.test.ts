import { flushPromises, mount } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import ElementPlus from "element-plus";
import { workbenchI18n } from "../../../i18n";
import DatasetDrilldown from "../components/DatasetDrilldown.vue";
import { shellContextKey } from "../../../../../agent-shell-ui/src/context";
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../../utils/api", () => ({ nodeApiGet: api.get }));
const preview = { question: "Payroll by department", groups: [{ label: "Department", value: "Information" }, { label: "Code", value: "001" }], filters: ["Active staff"], assumptions: ["Current staff"], truncated: true };
const artifact = { id: "dataset", sessionId: "session", path: "outputs/retrievals/r/payroll.dataset.json" } as never;
const global = (proceed: (message: string) => Promise<void>) => ({ plugins: [workbenchI18n(), ElementPlus], provide: { [shellContextKey as symbol]: { continueConversation: proceed } } });

it("asks for the details of the selected source row in one ordinary message with exact group values", async () => {
  api.get.mockResolvedValue(preview);
  const proceed = vi.fn().mockRejectedValueOnce(new Error("Working")).mockResolvedValueOnce(undefined);
  const wrapper = mount(DatasetDrilldown, { props: { artifact, title: "Payroll", selectedRowIndices: [2] }, global: global(proceed) });
  try {
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/assistant/sessions/session/artifacts/dataset/drilldown?rowIndex=2");
    await wrapper.get(".dataset-selection-button").trigger("click"); await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toBe("Working");
    await wrapper.get(".dataset-selection-button").trigger("click"); await flushPromises();
    // One message: the third row (index 2), its group values, and the data file they come from.
    const message = proceed.mock.calls.at(-1)![0] as string;
    expect(message).toMatch(/\b3\b/);
    expect(message).toContain("Information");
    expect(message).toContain("001");
    expect(message).toContain("Payroll");
    expect(message).toContain("outputs/retrievals/r/payroll.dataset.json");
    await wrapper.setProps({ selectedRowIndices: [1, 2] }); await flushPromises();
    expect(wrapper.find(".dataset-selection-button").exists()).toBe(false);
  } finally { wrapper.unmount(); }
});

it("ignores a late preview for a previous selection and hides unsupported datasets", async () => {
  let resolveOld!: (value: unknown) => void;
  api.get.mockReset().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockRejectedValueOnce(new Error("Unsupported"));
  const wrapper = mount(DatasetDrilldown, { props: { artifact, title: "Payroll", selectedRowIndices: [0] }, global: global(vi.fn()) });
  try {
    await wrapper.setProps({ selectedRowIndices: [1] }); await flushPromises();
    resolveOld(preview); await flushPromises();
    expect(wrapper.find(".dataset-selection-button").exists()).toBe(false);
  } finally { wrapper.unmount(); }
});
