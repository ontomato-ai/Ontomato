import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { defineComponent } from "vue";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import DiagnosisModelPanel from "../components/DiagnosisModelPanel.vue";
import ModelSelectionSelect from "../components/ModelSelectionSelect.vue";
import { agentDefinitionsApi, diagnosisModelApi } from "../api";

const i18n = workbenchI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const options: ModelOptions = {
  models: [
    { name: "qwen-main", displayName: "Qwen" },
    { name: "deepseek", displayName: "deepseek" },
  ],
  defaultModelId: "qwen-main",
};

// The skill selector reports ready at once; the prompt editor is a plain stand-in.
const SkillSelector = defineComponent({ emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" });
const global = {
  plugins: [i18n, ElementPlus],
  stubs: { SkillSelector, CodeMirrorEditor: { template: "<div />" } },
};

function agent(modelId: string | null): AssistantAgentDefinition {
  return {
    id: "agent-1",
    name: "Sales analyst",
    description: "",
    icon: null,
    enabled: true,
    systemPrompt: "Be brief.",
    modelSelection: { modelId },
    skills: [],
    classNames: [],
    enabledMcpServiceIds: [],
    sortOrder: 3,
  } as AssistantAgentDefinition;
}

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mountEditor(modelId: string | null) {
  vi.spyOn(agentDefinitionsApi, "listMcpServiceOptions").mockResolvedValue([]);
  const update = vi.spyOn(agentDefinitionsApi, "update").mockImplementation(async (_id, input) => ({
    ...agent(input.modelSelection.modelId),
    ...input,
    id: "agent-1",
  }) as AssistantAgentDefinition);
  const wrapper = mount(AgentEditor, {
    props: { agent: agent(modelId), classes: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
    global,
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, update };
}

async function choose(control: Pick<VueWrapper, "findComponent">, value: string) {
  control.findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", value);
  await flushPromises();
}

const selected = (control: Pick<VueWrapper, "find">) => control.find(".el-select__selected-item:not(.is-hidden)").text();
const saveButton = (wrapper: VueWrapper) =>
  wrapper.findAll(".editor-bar button").find((button) => button.text() === t("common.save"))!;

describe("workbench agent model selection", () => {
  it("keeps a missing model ID as it is, reports it, and saves it unchanged when other fields change", async () => {
    const { wrapper, update } = await mountEditor("removed-model");
    const control = wrapper.findComponent(ModelSelectionSelect);
    expect(selected(control)).toBe(t("agents.modelUnavailable", { id: "removed-model" }));
    expect(control.find("[role='alert']").text()).toBe(t("agents.modelSelectionMissing", { id: "removed-model" }));

    await wrapper.find("input").setValue("Sales analyst 2");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1]).toMatchObject({ name: "Sales analyst 2", modelSelection: { modelId: "removed-model" } });
  });

  it("saves the chosen model, or null for the domain default", async () => {
    const { wrapper, update } = await mountEditor(null);
    const control = () => wrapper.findComponent(ModelSelectionSelect);
    expect(selected(control())).toBe(t("agents.followDomainDefault", { model: "Qwen (qwen-main)" }));

    await choose(control(), "deepseek");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1].modelSelection).toEqual({ modelId: "deepseek" });

    await choose(control(), "");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[1]![1].modelSelection).toEqual({ modelId: null });
  });
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
    vi.spyOn(diagnosisModelApi, "get").mockResolvedValue({ modelId: "removed-model" });
    const save = vi.spyOn(diagnosisModelApi, "save").mockImplementation(async (selection) => selection);
    const wrapper = await mountPanel();
    const control = () => wrapper.findComponent(ModelSelectionSelect);
    expect(selected(control())).toBe(t("agents.modelUnavailable", { id: "removed-model" }));
    expect(control().find("[role='alert']").exists()).toBe(true);
    expect(save).not.toHaveBeenCalled();

    await choose(control(), "deepseek");
    expect(save).toHaveBeenCalledWith({ modelId: "deepseek" });
    expect(control().props("modelValue")).toBe("deepseek");
    expect(control().find("[role='alert']").exists()).toBe(false);
  });

  it("keeps the saved choice when a save is rejected", async () => {
    vi.spyOn(diagnosisModelApi, "get").mockResolvedValue({ modelId: null });
    vi.spyOn(diagnosisModelApi, "save").mockRejectedValue(new Error("Model not configured"));
    const error = vi.spyOn(ElMessage, "error");
    const wrapper = await mountPanel();
    await choose(wrapper.findComponent(ModelSelectionSelect), "deepseek");
    expect(error).toHaveBeenCalledWith("Model not configured");
    expect(wrapper.findComponent(ModelSelectionSelect).props("modelValue")).toBeNull();
  });
});
