import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus, { ElMessage } from "element-plus";
import { computed } from "vue";
import { agentModelLabelsKey, type AgentModelLabels } from "@ontomato/platform-shell";
import type { ModelOptions, ModelSelection } from "@ontomato/contracts/model-settings";
import { workbenchI18n } from "../../../../../i18n";
import { diagnosisModelApi } from "../../../api/diagnosis-model";
import OpsModelPage from "../OpsModelPage.vue";

/*
 * The operations agent's model: the built-in agent's one setting, on the operations application's own page at the foot
 * of its column. It is the platform's model page over the diagnosis model's endpoint: one draft saved from the page's
 * header, a missing model kept as it is, and a rejected choice kept with its reason.
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

vi.mock("../../../../agents/api", () => ({ loadModelOptions: async () => options }));

// The platform provides the model page's words; these stand in for them.
const labels = {
  title: "Models",
  description: "",
  followDefault: (model: string | null) => `Domain default (${model})`,
  unavailable: (id: string) => `${id} (unavailable)`,
  missing: (id: string) => `Model ${id} is no longer configured`,
  backToDefault: "Follow the default",
  agentName: (_kind: string, fallback: string) => fallback,
  empty: "",
  loadFailed: "",
  retry: "",
  saved: "Saved",
  saveFailed: "Not saved",
  discardTitle: "",
  discardMessage: "",
  cancel: "",
  save: "Save",
  discard: "Discard",
  unsavedChanges: "Unsaved changes",
} satisfies AgentModelLabels;

const global = { plugins: [i18n, ElementPlus], provide: { [agentModelLabelsKey as symbol]: computed(() => labels) } };

async function choose(control: Pick<VueWrapper, "findComponent">, value: string) {
  control.findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", value);
  await flushPromises();
}

const selected = (control: Pick<VueWrapper, "find">) => control.find(".el-select__selected-item:not(.is-hidden)").text();
const save = (wrapper: VueWrapper) =>
  wrapper.findAll(".platform-page-header button").find((button) => button.text() === "Save")!;

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mountPage() {
  const wrapper = mount(OpsModelPage, { global, attachTo: document.body });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

describe("operations agent model", () => {
  it("shows a missing model ID as it is, and saves a new choice from the header", async () => {
    vi.spyOn(diagnosisModelApi, "get").mockResolvedValue({ modelId: "legacy/removed-model" });
    const stored = vi.spyOn(diagnosisModelApi, "save").mockImplementation(async (selection: ModelSelection) => selection);
    const wrapper = await mountPage();
    const row = () => wrapper.find(".agent-model-row");
    expect(row().find(".agent-model-name").text()).toBe(t("admin.opsAgent"));
    expect(selected(row())).toBe("legacy/removed-model (unavailable)");
    expect(row().find("[role='alert']").text()).toBe("Model legacy/removed-model is no longer configured");
    expect(save(wrapper).attributes("disabled")).toBeDefined();

    await choose(row(), "deepseek/deepseek-chat");
    expect(stored).not.toHaveBeenCalled();
    await save(wrapper).trigger("click");
    await flushPromises();
    expect(stored).toHaveBeenCalledWith({ modelId: "deepseek/deepseek-chat" });
    expect(row().find("[role='alert']").exists()).toBe(false);
    expect(save(wrapper).attributes("disabled")).toBeDefined();
  });

  it("keeps a rejected choice in the draft with the reason beside it", async () => {
    vi.spyOn(diagnosisModelApi, "get").mockResolvedValue({ modelId: null });
    vi.spyOn(diagnosisModelApi, "save").mockRejectedValue(new Error("Model not configured"));
    const error = vi.spyOn(ElMessage, "error");
    const wrapper = await mountPage();
    const row = () => wrapper.find(".agent-model-row");
    expect(selected(row())).toBe("Domain default (Qwen (gateway/qwen-main))");

    await choose(row(), "deepseek/deepseek-chat");
    await save(wrapper).trigger("click");
    await flushPromises();
    expect(error).toHaveBeenCalledWith("Not saved");
    expect(row().find(".agent-model-note.danger").text()).toBe("Model not configured");
    expect(selected(row())).toBe("deepseek/deepseek-chat");
    expect(save(wrapper).attributes("disabled")).toBeUndefined();
  });
});
