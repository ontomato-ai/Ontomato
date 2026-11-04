import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, defineComponent, h } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import type { ModelSettingsData, ModelSettingsWrite, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { vectorRebuildStatusSchema } from "../models/types";
import { specifiedAgents } from "../models/agents";
import ModelEditDialog from "../models/components/ModelEditDialog.vue";
import ModelSelectionSelect from "../models/components/ModelSelectionSelect.vue";
import ModelUsagePanel from "../models/components/ModelUsagePanel.vue";
import ProviderDetail from "../models/components/ProviderDetail.vue";
import ModelConfigPage from "../pages/ModelConfigPage.vue";
import { modelConfigTabs, ossPlatformPages } from "../pages";
import type { PlatformApi } from "../api";
import { pageGlobal, testHost, testI18n } from "./host";

/*
 * The conventions of the model configuration page: the settings are saved as a whole, a masked key that is not
 * changed is submitted as read, the agent selectors offer chat models only, and a reference that is no longer
 * configured stays as it is instead of falling back to the domain default. Renaming a saved model and unsetting a
 * domain default are confirmed first, naming what they affect. The usage screen lists only the agents given a model of
 * their own; each model row checks itself with the smallest call.
 */

const t = testI18n().global.t as (key: string, params?: Record<string, unknown>) => string;

const RETRIEVAL = "00000000-0000-4000-8000-000000000001";
const GOVERNANCE = "00000000-0000-4000-8000-000000000002";
const DASHBOARD = "00000000-0000-4000-8000-000000000003";

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
  { id: DASHBOARD, kind: "dashboard", name: "Program dashboard", modelSelection: { modelId: "gateway/vendor/chat" } },
];

const saveModelSettings = vi.fn(async (settings: ModelSettingsWrite) => settings as ModelSettingsData);
const saveOntologyAgentModel = vi.fn(async (id: string, modelSelection: { modelId: string | null }) => ({
  ...agents.find((agent) => agent.id === id)!,
  modelSelection,
}));
type TestRequest = { providerId: string; model: { id: string } };
type TestResponse = { type: "chat"; content: string } | { type: "embedding"; dimensions: number };
const testModel = vi.fn(async (_request: TestRequest): Promise<TestResponse> => ({ type: "chat", content: "pong" }));

const api: Partial<PlatformApi> = {
  getModelSettings: async () => structuredClone(saved),
  saveModelSettings,
  listOntologyAgentModels: async () => structuredClone(agents),
  saveOntologyAgentModel,
  getVectorRebuildStatus: async () => ({ configured: true, state: "READY", total: 0, done: 0, error: null }),
  testModel,
};

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  saveModelSettings.mockClear();
  saveOntologyAgentModel.mockClear();
  testModel.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function mountPage(path: string = modelConfigTabs.usage.path) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: modelConfigTabs.usage.path, component: ModelConfigPage },
      { path: modelConfigTabs.providers.path, component: ModelConfigPage },
    ],
  });
  await router.push(path);
  const host = pageGlobal(
    testHost(api, { navigation: computed(() => ({ groups: [], pages: [...ossPlatformPages] })) })
  );
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

const usagePanel = (wrapper: VueWrapper) => wrapper.findComponent(ModelUsagePanel);

describe("model configuration page", () => {
  it("loads an unconfigured embedding status without reporting a configuration failure", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.spyOn(api, "getModelSettings").mockResolvedValue({ ...structuredClone(saved), embeddingModelId: null });
    const status = vectorRebuildStatusSchema.parse({ configured: false });
    expect(status).toEqual({ configured: false, state: null, total: null, done: null, error: null });
    vi.spyOn(api, "getVectorRebuildStatus").mockResolvedValue(status);
    const wrapper = await mountPage();
    const panel = usagePanel(wrapper);
    expect(panel.find(".rebuild-status").text()).toContain(t("admin.noEmbeddingModel"));
    expect(panel.findAll(".rebuild-actions button")).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("saves the whole settings at once and submits an unchanged masked key as read", async () => {
    const wrapper = await mountPage(modelConfigTabs.providers.path);
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

  it("lists only the agents given a model of their own, grouped by purpose, and follow-the-default removes a row", async () => {
    const wrapper = await mountPage();
    const panel = usagePanel(wrapper);
    // The retriever follows the default, so it is not listed; the governance agent and the dashboard generator are.
    expect(panel.findAll(".group-label").map((label) => label.text())).toEqual([
      t("admin.agentPurposes.knowledge"),
      t("admin.agentPurposes.generation"),
    ]);
    expect(panel.findAllComponents(ModelSelectionSelect).map((select) => select.props("ariaLabel"))).toEqual([
      t("admin.domainDefaultModel"),
      "Knowledge governance",
      t("admin.ontologyAgentKinds.dashboard"),
    ]);
    // The stored reference that is no longer configured stays selected and is reported, never replaced by the default.
    const governance = panel.findAllComponents(ModelSelectionSelect)[1]!;
    expect(governance.props("modelValue")).toBe("legacy/old-name");
    expect(governance.find("[role='alert']").exists()).toBe(true);

    const values = (select: VueWrapper) =>
      select.findAllComponents({ name: "ElOption" }).map((option) => option.props("value"));
    expect(values(governance)).toEqual(["", "gateway/vendor/chat", "legacy/old-name"]);

    await panel.findAll("button").find((button) => button.text() === t("admin.followDefaultAction"))!.trigger("click");
    await flushPromises();
    await saveButton(wrapper).trigger("click");
    await flushPromises();

    expect(saveModelSettings).not.toHaveBeenCalled();
    expect(saveOntologyAgentModel.mock.calls).toEqual([[GOVERNANCE, { modelId: null }]]);
    expect(specifiedAgents(agents, { [RETRIEVAL]: null, [GOVERNANCE]: null, [DASHBOARD]: saved.defaultModelId })).toEqual([
      { purpose: "generation", agents: [agents[2]] },
    ]);
  });

  it("confirms renaming a saved model, warning about other references, and moves the default along", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    const wrapper = await mountPage(modelConfigTabs.providers.path);
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
    const wrapper = await mountPage(modelConfigTabs.providers.path);
    const detail = wrapper.findComponent(ProviderDetail);
    const embeddingRow = detail.findAll(".model-row")[1]!;
    await embeddingRow.findAll("button").find((b) => b.text() === "Delete")!.trigger("click");
    await flushPromises();

    expect(String(confirm.mock.calls[0]![0])).toContain(t("admin.embeddingDefaultCleared", { name: "embed (gateway/embed)" }));
    expect(detail.findAll(".model-row")).toHaveLength(2);
    expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
  });

  it("checks one model with the smallest call of that very model and shows the result on its row", async () => {
    const wrapper = await mountPage(modelConfigTabs.providers.path);
    const rows = wrapper.findComponent(ProviderDetail).findAll(".model-row");
    expect(rows).toHaveLength(2);

    await rows[1]!.findAll("button").find((button) => button.text() === t("admin.check"))!.trigger("click");
    await flushPromises();

    expect(testModel).toHaveBeenCalledTimes(1);
    const request = testModel.mock.calls[0]![0];
    expect(request.providerId).toBe("gateway");
    expect(request.model.id).toBe("embed");
    expect(rows[1]!.find(".check-result").text()).toContain("pong");

    testModel.mockResolvedValueOnce({ type: "embedding", dimensions: 1024 });
    await rows[0]!.findAll("button").find((button) => button.text() === t("admin.check"))!.trigger("click");
    await flushPromises();
    const chatRow = wrapper.findComponent(ProviderDetail).findAll(".model-row")[0]!;
    expect(testModel.mock.calls[1]![0].model.id).toBe("vendor/chat");
    expect(chatRow.find(".check-result").text()).toContain(t("admin.checkEmbeddingPassed", { n: 1024 }));
  });
});
