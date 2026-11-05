import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import type { ModelOptions, ModelSelection } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../../../i18n";
import ModelSelectionSelect from "../../../../agents/components/ModelSelectionSelect.vue";
import { diagnosisModelApi } from "../../../api/diagnosis-model";
import DiagnosisModelPanel from "../DiagnosisModelPanel.vue";

/*
 * The operations agent's model: the built-in agent's one setting, shown on the operations application's own page. Its
 * cases live with the page that owns them; the agent editor's model picker is tested beside the editor.
 */
const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const options: ModelOptions = {
  models: [
    { ref: "gateway/qwen-main", name: "Qwen", type: "chat" },
    { ref: "deepseek/deepseek-chat", name: "deepseek/deepseek-chat", type: "chat" },
    { ref: "gateway/embed", name: "Embed", type: "embedding", dimensions: 1024 },
  ],
  defaultModelId: "gateway/qwen-main",
  embeddingModelId: "gateway/embed",
};

const global = { plugins: [i18n, ElementPlus] };

async function choose(control: Pick<VueWrapper, "findComponent">, value: string) {
  control.findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", value);
  await flushPromises();
}

const selected = (control: Pick<VueWrapper, "find">) => control.find(".el-select__selected-item:not(.is-hidden)").text();

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("operations agent model", () => {
  async function mountPanel() {
    const wrapper = mount(DiagnosisModelPanel, {
      props: { modelOptions: options, modelOptionsFailed: false },
      global,
      attachTo: document.body,
    });
    wrappers.push(wrapper);
    await flushPromises();
    return wrapper;
  }

  it("shows a missing model ID as it is and saves a new choice at once", async () => {
    vi.spyOn(diagnosisModelApi, "get").mockResolvedValue({ modelId: "legacy/removed-model" });
    const save = vi.spyOn(diagnosisModelApi, "save").mockImplementation(async (selection: ModelSelection) => selection);
    const wrapper = await mountPanel();
    const control = () => wrapper.findComponent(ModelSelectionSelect);
    expect(selected(control())).toBe(t("agents.modelUnavailable", { id: "legacy/removed-model" }));
    expect(control().find("[role='alert']").exists()).toBe(true);
    expect(save).not.toHaveBeenCalled();

    await choose(control(), "deepseek/deepseek-chat");
    expect(save).toHaveBeenCalledWith({ modelId: "deepseek/deepseek-chat" });
    expect(control().props("modelValue")).toBe("deepseek/deepseek-chat");
    expect(control().find("[role='alert']").exists()).toBe(false);
  });

  it("keeps the saved choice when a save is rejected", async () => {
    vi.spyOn(diagnosisModelApi, "get").mockResolvedValue({ modelId: null });
    vi.spyOn(diagnosisModelApi, "save").mockRejectedValue(new Error("Model not configured"));
    const error = vi.spyOn(ElMessage, "error");
    const wrapper = await mountPanel();
    await choose(wrapper.findComponent(ModelSelectionSelect), "deepseek/deepseek-chat");
    expect(error).toHaveBeenCalledWith("Model not configured");
    expect(wrapper.findComponent(ModelSelectionSelect).props("modelValue")).toBeNull();
  });
});
