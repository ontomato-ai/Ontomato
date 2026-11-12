import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { defineComponent } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { lightAvatarColorOptions } from "@ontomato/agent-shell-ui";
import type { AssistantAgentDefinition } from "@ontomato/contracts/assistant-chat";
import type { ModelOptions } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../i18n";
import AgentEditor from "../components/AgentEditor.vue";
import ModelSelectionSelect from "../components/ModelSelectionSelect.vue";
import { agentDefinitionsApi } from "../api";

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

// The skill selector reports ready at once; the prompt editor is a plain stand-in.
const SkillSelector = defineComponent({ emits: ["ready"], mounted() { this.$emit("ready", true); }, template: "<div />" });
// The editor sits at its agent's address: leaving it is what its unsaved changes are checked against.
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/agents/settings/:agentId", component: { template: "<div />" } }] });
await router.push("/agents/settings/agent-1");
const global = {
  plugins: [i18n, ElementPlus, router],
  stubs: { SkillSelector, CodeEditor: { template: "<div />" } },
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
    props: { agent: agent(modelId), classes: [], relations: [], outlineLoading: false, modelOptions: options, modelOptionsFailed: false },
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
  wrapper.findAll(".platform-page-header button").find((button) => button.text() === t("common.save"))!;

describe("workbench agent model selection", () => {
  it("saves edits across configuration sections, with the avatar chosen in the agent's icon", async () => {
    const { wrapper, update } = await mountEditor(null);
    await wrapper.findAll('.avatar-icon-option').find((option) => option.attributes('aria-label') === 'Database')!.trigger('click');
    await wrapper.findAll('.avatar-color-option')[2]!.trigger('click');
    await wrapper.find('input').setValue('Updated analyst');
    await choose(wrapper.findComponent(ModelSelectionSelect), 'deepseek/deepseek-chat');
    await saveButton(wrapper).trigger('click');
    await flushPromises();
    expect(update.mock.calls[0]![1]).toMatchObject({
      name: 'Updated analyst',
      modelSelection: { modelId: 'deepseek/deepseek-chat' },
    });
    // The avatar saved is the icon and swatch the reader chose.
    expect(JSON.parse(update.mock.calls[0]![1].icon!)).toMatchObject({ key: 'Database', color: lightAvatarColorOptions[2] });
  });

  it("keeps a missing model ID as it is, reports it, and saves it unchanged when other fields change", async () => {
    const { wrapper, update } = await mountEditor("legacy/removed-model");
    const control = wrapper.findComponent(ModelSelectionSelect);
    expect(selected(control)).toBe(t("agents.modelUnavailable", { id: "legacy/removed-model" }));
    expect(control.find("[role='alert']").text()).toBe(t("agents.modelSelectionMissing", { id: "legacy/removed-model" }));

    await wrapper.find("input").setValue("Sales analyst 2");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1]).toMatchObject({ name: "Sales analyst 2", modelSelection: { modelId: "legacy/removed-model" } });
  });

  it("offers only chat models, by provider/model reference", async () => {
    const { wrapper } = await mountEditor(null);
    const values = wrapper.findComponent(ModelSelectionSelect).findAllComponents({ name: "ElOption" })
      .map((option) => option.props("value"));
    // Only chat choices, by provider/model reference: the embedding model stays out.
    expect(values).toEqual(expect.arrayContaining(["gateway/qwen-main", "deepseek/deepseek-chat"]));
    expect(values).not.toContain("gateway/embed");
  });

  it("saves the chosen model, or null for the domain default", async () => {
    const { wrapper, update } = await mountEditor(null);
    const control = () => wrapper.findComponent(ModelSelectionSelect);
    expect(selected(control())).toBe(t("agents.followDomainDefault", { model: "Qwen (gateway/qwen-main)" }));

    await choose(control(), "deepseek/deepseek-chat");
    expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[0]![1].modelSelection).toEqual({ modelId: "deepseek/deepseek-chat" });

    await choose(control(), "");
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(update.mock.calls[1]![1].modelSelection).toEqual({ modelId: null });
  });
});
