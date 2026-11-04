import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ModelSettingsData, ModelSettingsWrite, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import DefaultModelsPanel from "../models/components/DefaultModelsPanel.vue";
import ModelSelectionSelect from "../models/components/ModelSelectionSelect.vue";
import ProviderDetail from "../models/components/ProviderDetail.vue";
import ModelConfigPage from "../pages/ModelConfigPage.vue";
import type { PlatformApi } from "../api";
import { pageGlobal, testHost } from "./host";

/*
 * The conventions of the model configuration page: the settings are saved as a whole, a masked key that is not
 * changed is submitted as read, the agent selectors offer chat models only, and a reference that is no longer
 * configured stays as it is instead of falling back to the domain default.
 */

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
  getVectorRebuildStatus: async () => ({ state: "READY", total: 0, done: 0, error: null }),
};

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  saveModelSettings.mockClear();
  saveOntologyAgentModel.mockClear();
});
afterEach(() => {
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
});
