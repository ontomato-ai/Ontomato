import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElMessage, ElMessageBox } from "element-plus";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ModelSettingsData, ModelSettingsWrite, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { vectorRebuildStatusSchema } from "../models/types";
import DefaultModelsPanel from "../models/components/DefaultModelsPanel.vue";
import ModelEditDialog from "../models/components/ModelEditDialog.vue";
import ModelSelectionSelect from "../models/components/ModelSelectionSelect.vue";
import ProviderDetail from "../models/components/ProviderDetail.vue";
import ModelConfigPage from "../pages/ModelConfigPage.vue";
import type { PlatformApi } from "../api";
import { pageGlobal, testHost, testI18n } from "./host";

/*
 * The conventions of the model configuration page: the settings are saved as a whole, a masked key that is not
 * changed is submitted as read, the agent selectors offer chat models only, and a reference that is no longer
 * configured stays as it is instead of falling back to the domain default. Renaming a saved model and unsetting a
 * domain default are confirmed first, naming what they affect.
 */

const t = testI18n().global.t as (key: string, params?: Record<string, unknown>) => string;

const RETRIEVAL = "00000000-0000-4000-8000-000000000001";
const GOVERNANCE = "00000000-0000-4000-8000-000000000002";

const saved: ModelSettingsData = {
  providers: {
    gateway: {
      name: "Gateway",
      baseUrl: "https://gateway.example.com/v1",
      api: "openai-completions",
      apiKey: "******ab12",
      headers: { "OpenAI-Organization": "org-1" },
      models: [
        { id: "vendor/chat", name: "Chat", type: "chat", contextWindow: 256000, samplingParams: { temperature: 0 } },
        { id: "embed", type: "embedding", dimensions: 1024 },
      ],
    },
  },
  defaultModelId: "gateway/vendor/chat",
  embeddingModelId: "gateway/embed",
  retry: { provider: { timeoutMs: 300000, maxRetries: 3, maxRetryDelayMs: 60000 } },
};

const agents: OntologyAgentModel[] = [
  { id: RETRIEVAL, kind: "retrieval", name: "Data retrieval", modelSelection: { modelId: null } },
  { id: GOVERNANCE, kind: "knowledgeGovernance", name: "Knowledge governance", modelSelection: { modelId: "legacy/old-name" } },
];

const saveModelSettings = vi.fn(async (settings: ModelSettingsWrite) => settings as ModelSettingsData);
const saveOntologyAgentModel = vi.fn(async (id: string, modelSelection: { modelId: string | null }) => ({
  ...agents.find((agent) => agent.id === id)!,
  modelSelection,
}));

const api: Partial<PlatformApi> = {
  getModelSettings: async () => structuredClone(saved),
  saveModelSettings,
  listOntologyAgentModels: async () => structuredClone(agents),
  saveOntologyAgentModel,
  getVectorRebuildStatus: async () => ({ configured: true, state: "READY", total: 0, done: 0, error: null }),
};

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  saveModelSettings.mockClear();
  saveOntologyAgentModel.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/admin/model-config", component: ModelConfigPage }],
  });
  await router.push("/admin/model-config");
  const host = pageGlobal(testHost(api));
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: { ...host, plugins: [...host.plugins, router] },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

const saveButton = (wrapper: VueWrapper) =>
  wrapper.findAll(".page-actions button").find((button) => button.text() === "Save")!;

describe("model configuration page", () => {
  it("loads an unconfigured embedding status without reporting a configuration failure", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.spyOn(api, "getModelSettings").mockResolvedValue({ ...structuredClone(saved), embeddingModelId: null });
    const status = vectorRebuildStatusSchema.parse({ configured: false });
    expect(status).toEqual({ configured: false, state: null, total: null, done: null, error: null });
    vi.spyOn(api, "getVectorRebuildStatus").mockResolvedValue(status);
    const wrapper = await mountPage();
    const panel = wrapper.findComponent(DefaultModelsPanel);
    expect(panel.find(".rebuild-status").text()).toContain(t("admin.noEmbeddingModel"));
    expect(panel.findAll(".rebuild-actions button")).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("saves the whole settings at once and submits an unchanged masked key as read", async () => {
    const wrapper = await mountPage();
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();

    await wrapper.findComponent(ProviderDetail).find("input").setValue("Gateway EU");
    await saveButton(wrapper).trigger("click");
    await flushPromises();

    expect(saveModelSettings).toHaveBeenCalledTimes(1);
    const { gateway } = saved.providers;
    expect(saveModelSettings.mock.calls[0]![0]).toEqual({
      ...saved,
      providers: { gateway: { ...gateway, name: "Gateway EU", apiKey: "******ab12" } },
    });
  });

  it("offers the ontology agents chat models only and keeps a reference that is no longer configured", async () => {
    const wrapper = await mountPage();
    const selects = wrapper.findComponent(DefaultModelsPanel).findAllComponents(ModelSelectionSelect);
    // The domain default, then one select per agent.
    const [, retrieval, governance] = selects;
    const values = (select: VueWrapper) =>
      select.findAllComponents({ name: "ElOption" }).map((option) => option.props("value"));
    expect(values(retrieval!)).toEqual(["", "gateway/vendor/chat"]);
    expect(governance!.props("modelValue")).toBe("legacy/old-name");
    expect(governance!.find("[role='alert']").exists()).toBe(true);

    retrieval!.findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", "gateway/vendor/chat");
    await flushPromises();
    await saveButton(wrapper).trigger("click");
    await flushPromises();

    expect(saveModelSettings).not.toHaveBeenCalled();
    expect(saveOntologyAgentModel.mock.calls).toEqual([[RETRIEVAL, { modelId: "gateway/vendor/chat" }]]);
    expect(governance!.props("modelValue")).toBe("legacy/old-name");
  });

  it("confirms renaming a saved model, warning about other references, and moves the default along", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    const wrapper = await mountPage();
    const detail = wrapper.findComponent(ProviderDetail);
    await detail.findAll(".model-row")[0]!.findAll("button").find((b) => b.text() === "Edit")!.trigger("click");
    const dialog = wrapper.findComponent(ModelEditDialog);
    dialog.findAllComponents({ name: "ElInput" })[0]!.vm.$emit("update:modelValue", "vendor/chat-2");
    await flushPromises();
    await dialog.findAllComponents({ name: "ElButton" }).find((b) => b.text() === "Confirm")!.trigger("click");
    await flushPromises();

    expect(String(confirm.mock.calls[0]![0])).toContain(
      t("admin.modelRenameConfirm", { from: "gateway/vendor/chat", to: "gateway/vendor/chat-2" })
    );
    await saveButton(wrapper).trigger("click");
    await flushPromises();
    expect(saveModelSettings.mock.calls[0]![0].defaultModelId).toBe("gateway/vendor/chat-2");
  });

  it("names the embedding default and vector search before a deletion unsets it, and keeps it when cancelled", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const wrapper = await mountPage();
    const detail = wrapper.findComponent(ProviderDetail);
    const embeddingRow = detail.findAll(".model-row")[1]!;
    await embeddingRow.findAll("button").find((b) => b.text() === "Delete")!.trigger("click");
    await flushPromises();

    expect(String(confirm.mock.calls[0]![0])).toContain(t("admin.embeddingDefaultCleared", { name: "embed (gateway/embed)" }));
    expect(detail.findAll(".model-row")).toHaveLength(2);
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });
});
