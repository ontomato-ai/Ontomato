import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElMessage, ElMessageBox } from "element-plus";
import { computed, defineComponent, h, type Ref } from "vue";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import {
  platformApplicationNameKey,
  providePageActions,
  provideUnsavedChanges,
  type PlatformPageActions,
} from "@ontomato/platform-shell";
import type { ModelSettingsData, ModelSettingsWrite, OntologyAgentModel } from "@ontomato/contracts/model-settings";
import { vectorRebuildStatusSchema } from "../models/types";
import ModelEditDialog from "../models/components/ModelEditDialog.vue";
import ModelUsagePanel from "../models/components/ModelUsagePanel.vue";
import ProviderDetail from "../models/components/ProviderDetail.vue";
import ModelConfigPage from "../pages/ModelConfigPage.vue";
import { ossPlatformPages, platformPages } from "../pages";
import type { PlatformApi } from "../api";
import { pageGlobal, testHost, testI18n } from "./host";

/*
 * The conventions of the model library's two pages: the settings are saved as a whole from either page, a masked key
 * that is not changed is submitted as read, and moving between the two pages keeps the draft. Renaming a saved model and
 * unsetting a domain default are confirmed first, naming what they affect: a rename names the ontology service agents
 * that chose the old ID and the model page each chooses again on, since the library is saved alone. Each model row
 * checks itself with the smallest call. No agent's model is chosen here.
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
type TestRequest = { providerId: string; model: { id: string } };
type TestResponse = { type: "chat"; content: string } | { type: "embedding"; dimensions: number };
const testModel = vi.fn(async (_request: TestRequest): Promise<TestResponse> => ({ type: "chat", content: "pong" }));

const api: Partial<PlatformApi> = {
  getModelSettings: async () => structuredClone(saved),
  saveModelSettings,
  listOntologyAgentModels: async () => structuredClone(agents),
  getVectorRebuildStatus: async () => ({ configured: true, state: "READY", total: 0, done: 0, error: null }),
  testModel,
};

const wrappers: VueWrapper[] = [];
beforeEach(() => {
  saveModelSettings.mockClear();
  testModel.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

async function mountPage(path: string = platformPages.modelUsage.path) {
  // The draft's one Save is the frame header's: the page hands it to the frame, and the test reads it there.
  let actions!: Readonly<Ref<PlatformPageActions | null>>;
  // The frame's question, answered "stay": a navigation it would ask about does not go.
  const asked = vi.fn(async () => false);
  let allows!: (path: string) => Promise<boolean>;
  const frame = defineComponent({
    setup() {
      actions = providePageActions();
      allows = provideUnsavedChanges(asked).allows;
      return () => h(RouterView);
    },
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/",
        component: frame,
        children: [
          { path: platformPages.modelUsage.path, component: ModelConfigPage },
          { path: platformPages.modelProviders.path, component: ModelConfigPage },
        ],
      },
    ],
  });
  await router.push(path);
  const host = pageGlobal(
    testHost(api, { navigation: computed(() => ({ groups: [], pages: [...ossPlatformPages] })) })
  );
  // The platform names an application the way its rail does; here, by its id.
  const wrapper = mount(defineComponent({ render: () => h(RouterView) }), {
    global: {
      ...host,
      plugins: [...host.plugins, router],
      provide: { ...host.provide, [platformApplicationNameKey as symbol]: (id: string) => `app:${id}` },
    },
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, router, draft: () => actions.value!.draft!, allows, asked };
}

const usagePanel = (wrapper: VueWrapper) => wrapper.findComponent(ModelUsagePanel);

describe("model configuration page", () => {
  it("says an unconfigured embedding model once, in the select, and reports no configuration failure", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.spyOn(api, "getModelSettings").mockResolvedValue({ ...structuredClone(saved), embeddingModelId: null });
    const status = vectorRebuildStatusSchema.parse({ configured: false });
    expect(status).toEqual({ configured: false, state: null, total: null, done: null, error: null });
    vi.spyOn(api, "getVectorRebuildStatus").mockResolvedValue(status);
    const { wrapper } = await mountPage();
    const panel = usagePanel(wrapper);
    // The select shows "not set"; there is no state to speak of, so no box repeats it.
    expect(panel.find(".rebuild-status").exists()).toBe(false);
    expect(panel.text()).toContain(t("admin.noEmbeddingModel"));
    expect(error).not.toHaveBeenCalled();
  });

  it("shows the rebuild state and its action once a model is set", async () => {
    vi.spyOn(api, "getVectorRebuildStatus").mockResolvedValue(
      vectorRebuildStatusSchema.parse({ configured: true, state: "PAUSED", total: 10, done: 4 })
    );
    const { wrapper } = await mountPage();
    expect(usagePanel(wrapper).find(".rebuild-status").text()).toContain(t("admin.vectorRebuildStates.PAUSED"));
  });

  it("saves the whole settings at once and submits an unchanged masked key as read", async () => {
    const { wrapper, draft } = await mountPage(platformPages.modelProviders.path);
    expect(draft().dirty).toBe(false);

    await wrapper.findComponent(ProviderDetail).find("input").setValue("Gateway EU");
    draft().save();
    await flushPromises();
    await flushPromises();

    expect(saveModelSettings).toHaveBeenCalledTimes(1);
    const { gateway } = saved.providers;
    expect(saveModelSettings.mock.calls[0]![0]).toEqual({
      ...saved,
      providers: { gateway: { ...gateway, name: "Gateway EU", apiKey: "******ab12" } },
    });
  });

  it("keeps one draft across its two pages: moving between them asks nothing, leaving elsewhere would", async () => {
    const { wrapper, router, draft, allows, asked } = await mountPage(platformPages.modelProviders.path);
    await wrapper.findComponent(ProviderDetail).find("input").setValue("Gateway EU");
    expect(draft().dirty).toBe(true);
    expect(await allows(platformPages.modelUsage.path)).toBe(true);
    expect(asked).not.toHaveBeenCalled();
    expect(await allows(platformPages.general.path)).toBe(false);
    expect(asked).toHaveBeenCalledOnce();

    await router.push(platformPages.modelUsage.path);
    await flushPromises();
    expect(draft().dirty).toBe(true);
    await router.push(platformPages.modelProviders.path);
    await flushPromises();
    expect((wrapper.findComponent(ProviderDetail).find("input").element as HTMLInputElement).value).toBe("Gateway EU");
  });

  it("confirms renaming a saved model, naming the agents that chose it and where, and moves the default along", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    const { wrapper, draft } = await mountPage(platformPages.modelProviders.path);
    const detail = wrapper.findComponent(ProviderDetail);
    await detail.findAll(".model-row")[0]!.findAll("button").find((b) => b.text() === "Edit")!.trigger("click");
    const dialog = wrapper.findComponent(ModelEditDialog);
    dialog.findAllComponents({ name: "ElInput" })[0]!.vm.$emit("update:modelValue", "vendor/chat-2");
    await flushPromises();
    await dialog.findAllComponents({ name: "ElButton" }).find((b) => b.text() === "Confirm")!.trigger("click");
    await flushPromises();

    const message = String(confirm.mock.calls[0]![0]);
    // The dashboard generator chose it; it chooses again on the agent platform's model page.
    expect(message).toContain(t("admin.ontologyAgentKinds.dashboard"));
    expect(message).toContain("app:agents");
    expect(message).toContain("gateway/vendor/chat-2");
    draft().save();
    await flushPromises();
    await flushPromises();
    expect(saveModelSettings.mock.calls[0]![0].defaultModelId).toBe("gateway/vendor/chat-2");
  });

  it("names the embedding default and vector search before a deletion unsets it, and keeps it when cancelled", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm").mockRejectedValue("cancel");
    const { wrapper, draft } = await mountPage(platformPages.modelProviders.path);
    const detail = wrapper.findComponent(ProviderDetail);
    const embeddingRow = detail.findAll(".model-row")[1]!;
    await embeddingRow.findAll("button").find((b) => b.text() === "Delete")!.trigger("click");
    await flushPromises();

    expect(String(confirm.mock.calls[0]![0])).toContain("gateway/embed");
    expect(draft().dirty).toBe(false);
  });

  it("checks one model with the smallest call of that very model and shows the result on its row", async () => {
    const { wrapper } = await mountPage(platformPages.modelProviders.path);
    const rows = wrapper.findComponent(ProviderDetail).findAll(".model-row");

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
