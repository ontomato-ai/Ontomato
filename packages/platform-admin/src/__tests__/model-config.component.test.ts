import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ElementPlus, { ElMessage, ElMessageBox } from "element-plus";
import ModelListCard from "../models/components/ModelListCard.vue";
import EmbeddingModelConfigCard from "../models/components/EmbeddingModelConfigCard.vue";
import ModelSelectionSelect from "../models/components/ModelSelectionSelect.vue";
import OntologyAgentModelsCard from "../models/components/OntologyAgentModelsCard.vue";
import ModelConfigPage from "../pages/ModelConfigPage.vue";
import { vectorRebuildStatusSchema } from "../models/types";
import type {
  EmbeddingModelConfig,
  ModelEntry,
  ModelSettings,
  OntologyAgentSelection,
  VectorRebuildStatus,
} from "../models/types";
import type { PlatformApi } from "../api";
import { providePlatformHost } from "../context";
import { testHost, testI18n } from "./host";

const OPAQUE_CUSTOMS =
  '{"__v_isRef":true,"__v_isReactive":1,"__v_isReadonly":0,"__v_raw":{"nested":"user-value"},"value":"keep-me","temperature":null,"constructor":{"x":1},"__proto__":{"polluted":false},"arr":[1,null,{"k":"v"}]}';

const sent = vi.hoisted(() => ({
  settings: null as unknown,
  test: null as unknown,
  embedding: null as unknown,
  embeddingTest: null as unknown,
  agentSaves: [] as Array<{ id: string; modelId: string | null }>,
}));

// Simulates the Java model library: reads return a copy; saves are stored atomically and filled with the maxTokens / contextWindow defaults as read normalization does.
const server = vi.hoisted(() => ({
  models: [] as Array<Record<string, unknown>>,
  defaultModelId: null as string | null,
  reads: 0,
  agents: [] as OntologyAgentSelection[],
}));

const fixtures = vi.hoisted(() => ({
  models: [
    {
      name: "qwen-main",
      displayName: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeys: ["", "sk-fake-ab12", "sk-fake-cd34"],
      modelName: "qwen3",
      maxTokens: 50000,
      contextWindow: 256000,
      timeout: "PT5M",
      maxRetries: 99,
      organizationId: "org-existing",
      projectId: "project-existing",
      stop: ["</end>"],
      customHeaders: { "X-Provider-Test": "keep" },
      logResponses: false,
      temperature: 0.7,
      topP: null,
      customRequestParameters: JSON.parse(
        '{"__v_isRef":true,"__v_isReactive":1,"__v_isReadonly":0,"__v_raw":{"nested":"user-value"},"value":"keep-me","temperature":null,"constructor":{"x":1},"__proto__":{"polluted":false},"arr":[1,null,{"k":"v"}]}'
      ),
    },
    {
      name: "qwen-lite",
      displayName: "Qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKeys: ["sk-fake-ef56"],
      modelName: "qwen3-lite",
      maxTokens: 8000,
      contextWindow: 32000,
      customRequestParameters: {},
    },
  ],
  defaultModelId: "qwen-lite",
  embedding: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-embed",
    modelName: "text-embedding-v3",
    timeout: "PT300S",
    dimensions: 2048,
    customHeaders: { "X-Embed-Key": "keep" },
  },
  rebuildIdle: { state: "READY", total: 0, done: 0, error: null } as VectorRebuildStatus,
  agents: [
    { id: "a-retrieval", kind: "retrieval", name: "Data retrieval", modelSelection: { modelId: null } },
    { id: "a-gone", kind: "knowledgeGovernance", name: "Knowledge governance", modelSelection: { modelId: "gone-model" } },
    { id: "a-future", kind: "futureKind", name: "Service-named agent", modelSelection: { modelId: "qwen-main" } },
  ] as OntologyAgentSelection[],
}));

function settingsData() {
  return JSON.parse(
    JSON.stringify({
      models: server.models,
      defaultModelId: server.defaultModelId,
    })
  );
}

// The page's endpoints as the platform api resolves them: the model library and agent catalog as their data.
const api = {
    getModelSettings: vi.fn(async (): Promise<ModelSettings> => {
      server.reads += 1;
      return settingsData();
    }),
    saveModelSettings: vi.fn(
      async (payload: { models: Array<Record<string, unknown>>; defaultModelId: string | null }) => {
        sent.settings = JSON.parse(JSON.stringify(payload));
        server.models = (sent.settings as typeof payload).models.map((model) => ({
          ...model,
          maxTokens: model.maxTokens ?? 50000,
          contextWindow: model.contextWindow ?? 256000,
        }));
        server.defaultModelId = (sent.settings as typeof payload).defaultModelId;
        return settingsData() as ModelSettings;
      }
    ),
    testModel: vi.fn(async (model: unknown, prompt: string) => {
      sent.test = JSON.parse(JSON.stringify({ model, prompt }));
      return { content: "ok" };
    }),
    getBusinessConfig: vi.fn(async () => ({
      success: true,
      data: JSON.parse(
        JSON.stringify({
          defaultModelId: settingsData().defaultModelId,
          embeddingModelProperties: fixtures.embedding,
          knowledgeMaxResult: 10,
          dslCookerTimeout: 300000,
          lang: "zh-CN",
          dataAdapter: "postgresql",
          dataAdapterConnections: {},
        })
      ),
    })),
    saveEmbeddingModel: vi.fn(async (payload: unknown) => {
      sent.embedding = JSON.parse(JSON.stringify(payload));
      return { success: true };
    }),
    testEmbeddingModel: vi.fn(async (payload: unknown) => {
      sent.embeddingTest = JSON.parse(JSON.stringify(payload));
      return { success: true };
    }),
    getVectorRebuildStatus: vi.fn(async () => ({ ...fixtures.rebuildIdle })),
    listOntologyAgentModels: vi.fn(async () => JSON.parse(JSON.stringify(server.agents)) as OntologyAgentSelection[]),
    saveOntologyAgentModel: vi.fn(async (id: string, modelSelection: { modelId: string | null }) => {
      sent.agentSaves.push({ id, modelId: modelSelection.modelId });
      server.agents = server.agents.map((agent) => (agent.id === id ? { ...agent, modelSelection } : agent));
      return JSON.parse(JSON.stringify(server.agents.find((agent) => agent.id === id)));
    }),
    rebuildVectors: vi.fn(async () => ({ success: true })),
    pauseVectorRebuild: vi.fn(async () => ({ success: true })),
};

const i18n = testI18n();
const t = i18n.global.t as (key: string, params?: Record<string, unknown>) => string;

const host = testHost(api as unknown as Partial<PlatformApi>);
const global = {
  plugins: [i18n, ElementPlus],
  provide: providePlatformHost(host),
  stubs: {
    teleport: true,
    "el-tooltip": { template: "<span><slot /></span>" },
    "el-icon": { template: "<i><slot /></i>" },
    ElDialog: {
      name: "ElDialog",
      props: ["modelValue", "title"],
      template: '<section v-if="modelValue"><slot /><slot name="footer" /></section>',
    },
  },
};

const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(sent, {
    settings: null,
    test: null,
    embedding: null,
    embeddingTest: null,
    agentSaves: [],
  });
  server.agents = JSON.parse(JSON.stringify(fixtures.agents));
  server.models = JSON.parse(JSON.stringify(fixtures.models));
  server.defaultModelId = fixtures.defaultModelId;
  server.reads = 0;
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
});

function track<T extends ReturnType<typeof mount>>(wrapper: T): T {
  wrappers.push(wrapper);
  return wrapper;
}

function button(wrapper: Pick<ReturnType<typeof mount>, "findAll">, text: string) {
  return wrapper.findAll("button").find((candidate) => candidate.text().includes(text));
}

function entry(name: string, extra: Partial<ModelEntry> = {}): ModelEntry {
  return {
    name,
    displayName: name,
    baseUrl: "https://example/v1",
    apiKeys: ["sk-1"],
    modelName: "qwen3",
    maxTokens: 50000,
    contextWindow: 256000,
    customRequestParameters: {},
    ...extra,
  };
}

/** Add dialog: inputs are config ID, display name and URL, followed by the key rows and the API model id. */
async function fillNewModel(dialog: Pick<ReturnType<typeof mount>, "findAll">, id: string) {
  await dialog.findAll("input")[0]!.setValue(id);
  await dialog.findAll("input")[1]!.setValue(`Model ${id}`);
  await dialog.findAll("input")[2]!.setValue("https://new.example/v1");
  await button(dialog, t("admin.addApiKey"))!.trigger("click");
  const inputs = dialog.findAll("input");
  await inputs[3]!.setValue("sk-new");
  await inputs[4]!.setValue("new-model");
}

/** The list card hands a whole new list to save: the save double writes it back to props, simulating the page's saved list. */
function mountList(models: ModelEntry[], extra: Record<string, unknown> = {}) {
  const save = vi.fn(async (next: ModelEntry[]) => {
    await wrapper.setProps({ models: next });
    return true;
  });
  const wrapper: ReturnType<typeof mount> = track(
    mount(ModelListCard, { props: { models, defaultModelId: null, saving: false, save, ...extra }, global })
  );
  return { wrapper, save };
}

const listModels = (wrapper: ReturnType<typeof mount>) =>
  (wrapper.props() as { models: ModelEntry[] }).models;

/** Clicks the dialog's Save inside the given card or dialog and waits for the save to settle. */
async function saveDialog(scope: Pick<ReturnType<typeof mount>, "findAll">) {
  await button(scope, t("common.save"))!.trigger("click");
  await flushPromises();
}

async function mountModelPage(options: { realSelects?: boolean } = {}) {
  // The teleport and tooltip stubs also drop the select dropdown, whose options name the selected value.
  const stubs = options.realSelects ? { ...global.stubs, teleport: false, "el-tooltip": false } : global.stubs;
  const wrapper = track(mount(ModelConfigPage, { global: { ...global, stubs } }));
  await flushPromises();
  return wrapper;
}

describe("model list card", () => {
  it("shows an add entry when the library is legitimately empty", async () => {
    const { wrapper } = mountList([]);
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    const add = button(wrapper, t("admin.addModel"))!;
    expect(add.attributes("disabled")).toBeUndefined();
    await add.trigger("click");
    expect(wrapper.find("section").exists()).toBe(true);
  });

  it("cancelling an edit leaves the original entry untouched", async () => {
    const { wrapper, save } = mountList([entry("qwen-main", { displayName: "Qwen" })]);
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.findAll("section input")[1]!.setValue("changed");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    expect(save).not.toHaveBeenCalled();
    expect(listModels(wrapper)[0]!.displayName).toBe("Qwen");
  });

  it("starts a new draft empty instead of reusing the previous entry", async () => {
    const { wrapper } = mountList([entry("qwen-main")]);
    await button(wrapper, t("common.edit"))!.trigger("click");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const inputs = wrapper.findAll("section input");
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("");
    // maxTokens and the context window stay empty; Java fills the defaults and the frontend holds none.
    const numbers = wrapper.findAll("section .el-input-number input");
    expect(numbers.map((input) => (input.element as HTMLInputElement).value)).toEqual(
      Array(7).fill("")
    );
  });

  it("fixes the config ID once created while the display name stays editable", async () => {
    const { wrapper } = mountList([entry("qwen-main", { displayName: "Qwen" })]);
    expect(wrapper.find(".model-name").text()).toBe("Qwen");
    expect(wrapper.find(".model-id").text()).toBe("qwen-main");

    await button(wrapper, t("common.edit"))!.trigger("click");
    const [idInput, displayInput] = wrapper.findAll("section input");
    expect(idInput!.attributes("disabled")).toBeDefined();
    await displayInput!.setValue("Qwen Max");
    await saveDialog(wrapper);
    expect(listModels(wrapper)[0]).toMatchObject({ name: "qwen-main", displayName: "Qwen Max" });

    // The ID is editable when creating; the entry can be saved only after the ID, display name and the three connection fields are filled in.
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    const dialog = wrapper.find("section");
    expect(dialog.findAll("input")[0]!.attributes("disabled")).toBeUndefined();
    await dialog.findAll("input")[0]!.setValue("deepseek-main");
    expect(button(dialog, t("common.save"))!.attributes("disabled")).toBeDefined();
    await fillNewModel(dialog, "deepseek-main");
    await saveDialog(dialog);
    expect(listModels(wrapper).map((model) => model.name)).toEqual(["qwen-main", "deepseek-main"]);
    expect(listModels(wrapper)[1]).toMatchObject({
      maxTokens: null,
      contextWindow: null,
      timeout: null,
    });
  });



  it("disables every row and add entry while the page is saving", () => {
    const { wrapper } = mountList([entry("qwen-main")], { saving: true });
    expect(wrapper.findAll("button").every((b) => b.attributes("disabled") !== undefined)).toBe(
      true
    );
  });
});

describe("embedding model card", () => {
  function mountEmbedding(extra: Record<string, unknown> = {}) {
    const save = vi.fn(async (_model: EmbeddingModelConfig) => true);
    const wrapper = track(
      mount(EmbeddingModelConfigCard, {
        props: {
          model: { ...fixtures.embedding },
          loading: false,
          saving: false,
          loadError: "",
          save,
          rebuildStatus: { ...fixtures.rebuildIdle },
          ...extra,
        },
        global,
      })
    );
    return { wrapper, save };
  }

  it("shows one compact row with the key masked and keeps unshown fields when editing", async () => {
    const { wrapper, save } = mountEmbedding({ model: { ...fixtures.embedding, timeout: "PT5M" } });
    expect(wrapper.findAll(".model-item")).toHaveLength(1);
    expect(wrapper.text()).toContain("text-embedding-v3");
    expect(wrapper.text()).not.toContain("sk-embed");
    expect(wrapper.text()).toContain("300");
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.find("section input").setValue("https://proxy.example/v1");
    await saveDialog(wrapper);
    const updated = save.mock.calls[0]![0];
    expect(updated.baseUrl).toBe("https://proxy.example/v1");
    expect(updated.timeout).toBe("PT300S");
    // The dialog overwrites only the 4 displayed fields; fields not shown, such as customHeaders, must be kept as-is.
    expect(updated.customHeaders).toEqual({ "X-Embed-Key": "keep" });
    expect(wrapper.find("section").exists()).toBe(false);
  });

  it("does not fake a model row while loading or after a load failure", async () => {
    expect(mountEmbedding({ loading: true }).wrapper.findAll(".model-item")).toHaveLength(0);
    const failed = mountEmbedding({ loadError: "down" }).wrapper;
    expect(failed.findAll(".model-item")).toHaveLength(0);
    expect(failed.text()).toContain("down");
    await button(failed, t("common.retry"))!.trigger("click");
    expect(failed.emitted("retry")).toHaveLength(1);
  });

  it("shows an add entry when no embedding model is configured", async () => {
    const { wrapper, save } = mountEmbedding({ model: null });
    expect(wrapper.text()).toContain(t("admin.modelListEmpty"));
    await button(wrapper, t("admin.addModel"))!.trigger("click");
    await wrapper.find("section").findAll("input")[0]!.setValue("https://new.example/v1");
    // Dimensions have no page default (the backend owns the new-domain default): save and test wait until they are filled.
    expect(button(wrapper.find("section"), t("common.save"))!.attributes("disabled")).toBeDefined();
    expect(button(wrapper.find("section"), t("common.testModel"))!.attributes("disabled")).toBeDefined();
    await wrapper.find("section").findAll(".el-input-number input")[1]!.setValue("1024");
    await saveDialog(wrapper);
    const updated = save.mock.calls[0]![0];
    expect(updated.baseUrl).toBe("https://new.example/v1");
    expect(updated.timeout).toBe("PT300S");
    expect(updated.dimensions).toBe(1024);
  });

  // Design item 1: dimensions belong to this domain's embedding config and are shown, edited and saved with it.
  it("shows the dimensions and saves the edited dimensions with the config", async () => {
    const { wrapper, save } = mountEmbedding();
    expect(wrapper.find(".model-item").text()).toContain(`${t("admin.embeddingDimensions")}`);
    expect(wrapper.find(".model-item").text()).toContain("2048");
    await button(wrapper, t("common.edit"))!.trigger("click");
    const dimensions = wrapper.find("section").findAll(".el-input-number input")[1]!;
    expect((dimensions.element as HTMLInputElement).value).toBe("2048");
    await dimensions.setValue("1024");
    await saveDialog(wrapper);
    expect(save.mock.calls[0]![0]).toEqual({ ...fixtures.embedding, dimensions: 1024 });
  });

  // Design item 6: the test runs on the dimensions filled in the dialog, before anything is saved.
  it("tests the dialog draft with its dimensions without saving", async () => {
    const { wrapper, save } = mountEmbedding();
    await button(wrapper, t("common.edit"))!.trigger("click");
    await wrapper.find("section").findAll(".el-input-number input")[1]!.setValue("4096");
    await button(wrapper.find("section"), t("common.testModel"))!.trigger("click");
    expect(wrapper.emitted("test")![0]).toEqual([{ ...fixtures.embedding, dimensions: 4096 }]);
    expect(save).not.toHaveBeenCalled();
    expect(wrapper.find("section").exists()).toBe(true);
  });

  // The action follows only the state the backend reports, never a page-side comparison of configs.
  it.each([
    ["not read yet", null, "admin.rebuildVectors", false, null],
    ["ready", "READY", "admin.rebuildVectors", false, null],
    ["pending", "PENDING", "admin.rebuildVectors", true, "rebuild"],
    ["running", "RUNNING", "admin.pauseVectorRebuild", true, "pause"],
    ["pausing", "PAUSING", "admin.pauseVectorRebuild", false, null],
    ["paused", "PAUSED", "admin.resumeVectorRebuild", true, "rebuild"],
    ["interrupted", "INTERRUPTED", "admin.resumeVectorRebuild", true, "rebuild"],
  ] as const)("offers the action of the reported state: %s", async (_name, state, label, enabled, event) => {
    const rebuildStatus = state && { ...fixtures.rebuildIdle, state };
    const { wrapper } = mountEmbedding({ rebuildStatus });
    const action = button(wrapper, t(label))!;
    expect(action.attributes("disabled") === undefined).toBe(enabled);
    if (event) {
      await action.trigger("click");
      expect(wrapper.emitted(event)).toHaveLength(1);
    }
  });

  // Each state that keeps vector search paused says so with its progress and the way to recover.
  it("shows the progress, a pause or interruption, and where and why a round failed", () => {
    const text = (rebuildStatus: VectorRebuildStatus) => mountEmbedding({ rebuildStatus }).wrapper.text();
    const progress = { total: 120, done: 45 };
    expect(text({ ...progress, state: "PENDING", error: null })).toContain(t("admin.vectorRebuildNeeded"));
    expect(text({ ...progress, state: "RUNNING", error: null })).toContain(t("admin.vectorRebuildRunning", progress));
    expect(text({ ...progress, state: "PAUSING", error: null })).toContain(t("admin.vectorRebuildPausing", progress));
    expect(text({ ...progress, state: "PAUSED", error: null })).toContain(t("admin.vectorRebuildPaused", progress));
    expect(text({ ...progress, state: "INTERRUPTED", error: null })).toContain(
      t("admin.vectorRebuildInterrupted", progress)
    );
    expect(text({ ...fixtures.rebuildIdle })).not.toContain(t("admin.vectorRebuildNeeded"));

    const failed = mountEmbedding({
      rebuildStatus: {
        ...progress,
        state: "FAILED",
        error: { phase: "EMBED", itemType: "ACTION", itemId: "a-17", reason: "Read timed out" },
      },
    }).wrapper;
    expect(failed.text()).toContain(
      t("admin.vectorRebuildFailed", {
        ...progress,
        step: t("admin.vectorRebuildStep.EMBED", { type: t("admin.vectorRebuildType.ACTION"), id: "a-17" }),
        reason: "Read timed out",
      })
    );
    expect(failed.text()).toContain("a-17");
    expect(button(failed, t("admin.resumeVectorRebuild"))!.attributes("disabled")).toBeUndefined();

    const clearFailed = text({
      ...progress,
      state: "FAILED",
      error: { phase: "CLEAR", itemType: null, itemId: null, reason: "connection refused" },
    });
    expect(clearFailed).toContain(t("admin.vectorRebuildStep.CLEAR"));
    expect(clearFailed).toContain("connection refused");

    const readFailed = text({
      ...progress,
      state: "FAILED",
      error: { phase: "READ", itemType: "METRIC_VIEW", itemId: null, reason: "relation is locked" },
    });
    expect(readFailed).toContain(t("admin.vectorRebuildStep.READ", { type: t("admin.vectorRebuildType.METRIC_VIEW") }));
  });
});

describe("password visibility with the real dialog", () => {
  // ElDialog/teleport are not replaced: after a real close/destroy and rebuilt key rows, password inputs return to hidden by default.
  const realDialog = { plugins: [i18n, ElementPlus], provide: providePlatformHost(host), stubs: { transition: false } };
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  };
  const keyTypes = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(".api-key-row input").map((input) => input.attributes("type"));
  const keyValues = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll(".api-key-row input").map((input) => (input.element as HTMLInputElement).value);

  it("saves the remaining keys after deletions and hides keys when reopening another entry", async () => {
    const save = vi.fn(async (_models: ModelEntry[]) => true);
    const wrapper = track(
      mount(ModelListCard, {
        props: {
          models: [
            entry("a", { apiKeys: ["sk-fake-1", "sk-fake-2", "sk-fake-3"] }),
            entry("b", { apiKeys: ["sk-fake-9"] }),
          ],
          defaultModelId: "a",
          saving: false,
          save,
        },
        global: realDialog,
        attachTo: document.body,
      })
    );
    expect(wrapper.text()).not.toContain("sk-fake");
    const edits = () => wrapper.findAll("button").filter((b) => b.text() === t("common.edit"));
    await edits()[0]!.trigger("click");
    await settle();
    expect(keyTypes(wrapper)).toEqual(["password", "password", "password"]);

    await wrapper.findAll(".api-key-row .el-input__password")[0]!.trigger("click");
    await wrapper.findAll(".api-key-row .el-input__password")[1]!.trigger("click");
    expect(keyTypes(wrapper)).toEqual(["text", "text", "password"]);
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await wrapper.findAll(trash)[0]!.trigger("click");
    expect(keyTypes(wrapper)).toEqual(["password", "password"]);
    expect(keyValues(wrapper)).toEqual(["sk-fake-2", "sk-fake-3"]);

    await wrapper.findAll(trash)[1]!.trigger("click");
    expect(keyValues(wrapper)).toEqual(["sk-fake-2"]);
    await button(wrapper, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(save.mock.calls[0]![0].map(model => model.apiKeys)).toEqual([["sk-fake-2"], ["sk-fake-9"]]);
    await settle();
    await edits()[1]!.trigger("click");
    await settle();
    expect(keyTypes(wrapper)).toEqual(["password"]);
    expect(keyValues(wrapper)).toEqual(["sk-fake-9"]);
  });

  it("re-hides the embedding key when its editor is reopened", async () => {
    const wrapper = track(
      mount(EmbeddingModelConfigCard, {
        props: {
          model: { ...fixtures.embedding },
          loading: false,
          saving: false,
          loadError: "",
          save: async () => true,
          rebuildStatus: { ...fixtures.rebuildIdle },
        },
        global: realDialog,
        attachTo: document.body,
      })
    );
    const keyInput = () =>
      wrapper.find(
        ".el-dialog input[type='password'], .el-dialog input[type='text'][placeholder='sk-...']"
      );
    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    await wrapper.find(".el-dialog .el-input__password").trigger("click");
    expect(keyInput().attributes("type")).toBe("text");
    await button(wrapper, t("common.cancel"))!.trigger("click");
    await settle();
    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    expect(keyInput().attributes("type")).toBe("password");
    expect((keyInput().element as HTMLInputElement).value).toBe("sk-embed");
  });
});

describe("saved keys are write-only", () => {
  const realDialog = { plugins: [i18n, ElementPlus], provide: providePlatformHost(host), stubs: { transition: false } };
  const settle = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  };

  it("shows a saved model key as its read-only mask and sends the mask back, which keeps the key", async () => {
    const save = vi.fn(async (_models: ModelEntry[]) => true);
    const wrapper = track(
      mount(ModelListCard, {
        props: { models: [entry("a", { apiKeys: ["******ab12"] })], defaultModelId: "a", saving: false, save },
        global: realDialog,
        attachTo: document.body,
      })
    );
    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    const saved = wrapper.find(".api-key-row input");
    expect(saved.attributes("disabled")).toBeDefined();
    expect(saved.attributes("type")).not.toBe("password");
    expect((saved.element as HTMLInputElement).value).toBe("******ab12");
    expect(wrapper.find(".saved-key-hint").text()).toBe(t("admin.savedKeyHint"));

    await button(wrapper, t("admin.addApiKey"))!.trigger("click");
    await wrapper.findAll(".api-key-row input")[1]!.setValue("sk-new-key");
    await button(wrapper, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(save.mock.calls[0]![0][0]!.apiKeys).toEqual(["******ab12", "sk-new-key"]);
  });

  it("leaves a saved embedding key out of the input and sends its mask back unless a new key is entered", async () => {
    const save = vi.fn(async (_model: EmbeddingModelConfig) => true);
    const wrapper = track(
      mount(EmbeddingModelConfigCard, {
        props: {
          model: { ...fixtures.embedding, apiKey: "******mbed" },
          loading: false,
          saving: false,
          loadError: "",
          save,
          rebuildStatus: { ...fixtures.rebuildIdle },
        },
        global: realDialog,
        attachTo: document.body,
      })
    );
    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    const keyInput = wrapper.find(".el-dialog input[type='password']");
    expect((keyInput.element as HTMLInputElement).value).toBe("");
    expect(keyInput.attributes("placeholder")).toBe("******mbed");
    await button(wrapper, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(save.mock.calls[0]![0].apiKey).toBe("******mbed");

    await button(wrapper, t("common.edit"))!.trigger("click");
    await settle();
    await wrapper.find(".el-dialog input[type='password']").setValue("sk-replaced");
    await button(wrapper, t("common.save"))!.trigger("click");
    await flushPromises();
    expect(save.mock.calls[1]![0].apiKey).toBe("sk-replaced");
  });
});

describe("model config page", () => {

  it("shows a persistent error with retry and offers no write entry when loading fails", async () => {
    vi.mocked(api.getModelSettings).mockRejectedValueOnce(new Error("legacy role params"));
    const page = await mountModelPage();
    const alert = page.find(".load-error[role='alert']");
    expect(alert.text()).toContain("legacy role params");
    expect(page.findComponent(ModelListCard).exists()).toBe(false);
    expect(page.findComponent(ModelListCard).exists()).toBe(false);
    expect(button(page, t("admin.addModel"))).toBeUndefined();

    await button(alert, t("common.retry"))!.trigger("click");
    await flushPromises();
    expect(page.find(".load-error[role='alert']").exists()).toBe(false);
    expect(page.findComponent(ModelListCard).props("models")).toHaveLength(2);
  });

  it("keeps the model and embedding dialogs open when their save fails", async () => {
    const error = vi.spyOn(ElMessage, "error");
    vi.mocked(api.saveModelSettings).mockRejectedValueOnce(new Error("models rejected"));
    vi.mocked(api.saveEmbeddingModel).mockRejectedValueOnce(new Error("embedding rejected"));
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.findAll("section input")[1]!.setValue("Qwen Max");
    await saveDialog(list);
    expect(error).toHaveBeenCalledWith("models rejected");
    expect(list.find("section").exists()).toBe(true);
    expect(list.props("models")[0].displayName).toBe("Qwen");

    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await saveDialog(embedding);
    expect(error).toHaveBeenCalledWith("embedding rejected");
    expect(embedding.find("section").exists()).toBe(true);
    expect(embedding.props("model")).toEqual(fixtures.embedding);
  });

  it("shows an ISO timeout in seconds and writes it back as PT{n}S", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    const numbers = list.findAll("section .el-input-number input");
    // In order: maxTokens, context window, timeout, retries, temperature, topP, maxCompletionTokens.
    expect(numbers.map((input) => (input.element as HTMLInputElement).value)).toEqual([
      "50000",
      "256000",
      "300",
      "99",
      "0.7",
      "",
      "",
    ]);
    await saveDialog(list);
    expect((sent.settings as { models: ModelEntry[] }).models[0]!.timeout).toBe("PT300S");
  });

  it("round-trips fields without controls through edit, save and test", async () => {
    const page = await mountModelPage();
    const list = page.findComponent(ModelListCard);
    await button(list, t("common.edit"))!.trigger("click");
    await list.find("section").findAll("input")[2]!.setValue("https://new.example.com/v1");
    const trash = `.api-key-row button[aria-label="${t("common.delete") as string}"]`;
    await list.find("section").findAll(trash)[1]!.trigger("click");
    await saveDialog(list);

    const saved = (sent.settings as { models: Array<Record<string, unknown>> }).models[0]!;
    expect(saved).toMatchObject({
      baseUrl: "https://new.example.com/v1",
      apiKeys: ["", "sk-fake-cd34"],
      temperature: 0.7,
      maxRetries: 99,
      organizationId: "org-existing",
      projectId: "project-existing",
      stop: ["</end>"],
      customHeaders: { "X-Provider-Test": "keep" },
      logResponses: false,
    });
    expect(JSON.stringify(saved.customRequestParameters)).toBe(OPAQUE_CUSTOMS);
    // Unedited entries are submitted as-is.
    expect((sent.settings as { models: unknown[] }).models[1]).toEqual(fixtures.models[1]);

    // The test uses the saved entry and does not save again.
    await button(list, t("common.testModel"))!.trigger("click");
    const testDialog = page.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    const tested = (sent.test as { model: Record<string, unknown>; prompt: string });
    expect(tested.prompt).toBe("hello");
    expect(tested.model.baseUrl).toBe("https://new.example.com/v1");
    expect(tested.model.apiKeys).toEqual(["", "sk-fake-cd34"]);
    expect(JSON.stringify(tested.model.customRequestParameters)).toBe(OPAQUE_CUSTOMS);
    expect(api.saveModelSettings).toHaveBeenCalledTimes(1);
  });

  it("titles the model and embedding test dialogs after the selected entry", async () => {
    const page = await mountModelPage();
    const title = () =>
      page
        .findAllComponents({ name: "ElDialog" })
        .find((dialog) => dialog.props("modelValue"))!
        .props("title") as string;
    await button(page.findComponent(ModelListCard), t("common.testModel"))!.trigger("click");
    expect(title()).toBe(t("admin.testModelNamed", { name: "Qwen (qwen-main)" }));
    await button(page.findAll("section").at(-1)!, t("common.close"))!.trigger("click");
    await button(page.findComponent(EmbeddingModelConfigCard), t("common.testModel"))!.trigger(
      "click"
    );
    expect(title()).toBe(t("admin.testModelNamed", { name: t("admin.embeddingModelConfig") }));
  });

  it("saves the embedding model from its dialog as a full snapshot and tests the saved model", async () => {
    const page = await mountModelPage();
    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.findAll("section input")[1]!.setValue("sk-embed-2");
    await saveDialog(embedding);
    expect(sent.embedding).toEqual({ ...fixtures.embedding, apiKey: "sk-embed-2" });
    expect(sent.settings).toBeNull();
    expect(embedding.find("section").exists()).toBe(false);

    // The page reads the saved model back instead of keeping the submitted key, so the test sends what the server returned.
    expect(api.getBusinessConfig).toHaveBeenCalledTimes(2);
    await button(embedding, t("common.testModel"))!.trigger("click");
    const testDialog = page.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    expect(sent.embeddingTest).toEqual({
      modelConfig: { ...fixtures.embedding },
      userContent: "hello",
    });
  });
});

describe("vector rebuild and embedding test on the model config page", () => {
  // The api parses the wire data with the schema; the mocks hand it the same parsed shape.
  const status = (extra: Partial<Pick<VectorRebuildStatus, "state" | "total" | "done">>) =>
    vectorRebuildStatusSchema.parse({ ...fixtures.rebuildIdle, ...extra });
  const cardButton = (page: ReturnType<typeof mount>, label: string) =>
    button(page.findComponent(EmbeddingModelConfigCard), t(label));
  const rebuildButton = (page: ReturnType<typeof mount>) => cardButton(page, "admin.rebuildVectors")!;

  afterEach(() => {
    vi.useRealTimers();
  });

  // Design item 3/4: rebuilding is a separate, confirmed step; cancelling the confirmation starts nothing.
  it("confirms before rebuilding with the cost explained", async () => {
    const confirm = vi.spyOn(ElMessageBox, "confirm");
    vi.mocked(api.getVectorRebuildStatus).mockResolvedValue(status({ state: "PENDING" }));
    const page = await mountModelPage();
    confirm.mockRejectedValueOnce("cancel");
    await rebuildButton(page).trigger("click");
    await flushPromises();
    expect(confirm.mock.calls[0]![0]).toBe(t("admin.vectorRebuildConfirm"));
    expect(api.rebuildVectors).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce("confirm" as never);
    await rebuildButton(page).trigger("click");
    await flushPromises();
    expect(api.rebuildVectors).toHaveBeenCalledTimes(1);
  });

  // Contract 4/5: after starting, progress is polled while running and polling stops once the rebuild ends.
  it("polls the progress while a rebuild runs and stops when it ends", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValueOnce("confirm" as never);
    const read = vi.mocked(api.getVectorRebuildStatus);
    read
      .mockResolvedValueOnce(status({ state: "PENDING" }))
      .mockResolvedValueOnce(status({ state: "RUNNING", total: 10, done: 0 }))
      .mockResolvedValueOnce(status({ state: "RUNNING", total: 10, done: 6 }))
      .mockResolvedValueOnce(status({ total: 10, done: 10 }));
    const page = await mountModelPage();
    await rebuildButton(page).trigger("click");
    await flushPromises();
    const card = page.findComponent(EmbeddingModelConfigCard);
    expect(card.text()).toContain(t("admin.vectorRebuildRunning", { done: 0, total: 10 }));
    expect(cardButton(page, "admin.pauseVectorRebuild")).toBeDefined();

    await vi.advanceTimersByTimeAsync(3000);
    expect(card.text()).toContain(t("admin.vectorRebuildRunning", { done: 6, total: 10 }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(card.text()).not.toContain(t("admin.vectorRebuildRunning", { done: 10, total: 10 }));
    expect(card.text()).not.toContain(t("admin.vectorRebuildNeeded"));
    expect(read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(4);
  });

  // Pausing keeps polling until the run stops; a reload shows the paused round, and resuming asks nothing again.
  it("pauses, stops polling once paused, and resumes after a reload without a new confirmation", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const confirm = vi.spyOn(ElMessageBox, "confirm");
    const read = vi.mocked(api.getVectorRebuildStatus);
    read
      .mockResolvedValueOnce(status({ state: "RUNNING", total: 10, done: 4 }))
      .mockResolvedValueOnce(status({ state: "PAUSING", total: 10, done: 4 }))
      .mockResolvedValueOnce(status({ state: "PAUSED", total: 10, done: 5 }));
    const page = await mountModelPage();
    await cardButton(page, "admin.pauseVectorRebuild")!.trigger("click");
    await flushPromises();
    expect(api.pauseVectorRebuild).toHaveBeenCalledTimes(1);
    expect(cardButton(page, "admin.pauseVectorRebuild")!.attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(3000);
    const card = page.findComponent(EmbeddingModelConfigCard);
    expect(card.text()).toContain(t("admin.vectorRebuildPaused", { done: 5, total: 10 }));
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(3);
    page.unmount();

    read.mockResolvedValue(status({ state: "PAUSED", total: 10, done: 5 }));
    const reloaded = await mountModelPage();
    await cardButton(reloaded, "admin.resumeVectorRebuild")!.trigger("click");
    await flushPromises();
    expect(confirm).not.toHaveBeenCalled();
    expect(api.rebuildVectors).toHaveBeenCalledTimes(1);
  });

  // Java omits null fields; a malformed status is a load failure, not a crash or a silent state.
  it("normalizes omitted nulls and reports a malformed status as a load failure", async () => {
    expect(vectorRebuildStatusSchema.parse({ state: "READY", total: 0, done: 0 }).error).toBeNull();
    const failed = vectorRebuildStatusSchema.parse({
      state: "FAILED", total: 3, done: 1, error: { phase: "CLEAR", reason: "refused" },
    });
    expect(failed.error).toEqual({ phase: "CLEAR", itemType: null, itemId: null, reason: "refused" });

    const error = vi.spyOn(ElMessage, "error");
    for (const raw of [{ state: "FAILED", total: 3, done: 1 }, { state: "MIGRATING", total: 3, done: 1 }]) {
      error.mockClear();
      vi.mocked(api.getVectorRebuildStatus).mockImplementationOnce(async () => vectorRebuildStatusSchema.parse(raw));
      const page = await mountModelPage();
      expect(error).toHaveBeenCalledWith(t("admin.loadConfigFailed"));
      expect(page.findComponent(EmbeddingModelConfigCard).find(".vector-rebuild-status").exists()).toBe(false);
      page.unmount();
    }
  });

  // A poll answered after a newer read (here the one after pausing) must not overwrite it or keep polling.
  it("ignores a stale status response that arrives after a newer one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let answerPoll: (value: VectorRebuildStatus) => void = () => {};
    const read = vi.mocked(api.getVectorRebuildStatus);
    read
      .mockResolvedValueOnce(status({ state: "RUNNING", total: 10, done: 4 }))
      .mockImplementationOnce(() => new Promise((resolve) => (answerPoll = resolve)))
      .mockResolvedValueOnce(status({ state: "PAUSED", total: 10, done: 5 }));
    const page = await mountModelPage();
    await vi.advanceTimersByTimeAsync(3000);
    await cardButton(page, "admin.pauseVectorRebuild")!.trigger("click");
    await flushPromises();
    answerPoll(status({ state: "RUNNING", total: 10, done: 4 }));
    await flushPromises();

    const card = page.findComponent(EmbeddingModelConfigCard);
    expect(card.text()).toContain(t("admin.vectorRebuildPaused", { done: 5, total: 10 }));
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  // Task item 3: leaving the page stops the polling.
  it("stops polling when the page is left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const read = vi.mocked(api.getVectorRebuildStatus);
    read.mockResolvedValue(status({ state: "RUNNING", total: 10, done: 1 }));
    const page = await mountModelPage();
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).toHaveBeenCalledTimes(2);
    page.unmount();
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  // Design item 4: saving only stores the config; the page then reads the status again so the button can light up.
  // While a rebuild runs the backend rejects the save, and its message is shown verbatim.
  it("reads the rebuild status again after saving and shows a rejected save verbatim", async () => {
    const error = vi.spyOn(ElMessage, "error");
    const read = vi.mocked(api.getVectorRebuildStatus);
    const page = await mountModelPage();
    expect(read).toHaveBeenCalledTimes(1);
    expect(rebuildButton(page).attributes("disabled")).toBeDefined();

    read.mockResolvedValueOnce(status({ state: "PENDING" }));
    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.find("section").findAll(".el-input-number input")[1]!.setValue("1024");
    await saveDialog(embedding);
    expect(sent.embedding).toEqual({ ...fixtures.embedding, dimensions: 1024 });
    expect(api.rebuildVectors).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(2);
    expect(rebuildButton(page).attributes("disabled")).toBeUndefined();

    vi.mocked(api.saveEmbeddingModel).mockRejectedValueOnce(new Error("Vectors are being rebuilt; change the config after it finishes"));
    await button(embedding, t("common.edit"))!.trigger("click");
    await saveDialog(embedding);
    expect(error).toHaveBeenCalledWith("Vectors are being rebuilt; change the config after it finishes");
    expect(read).toHaveBeenCalledTimes(2);
  });

  // Design item 6: the test request carries the dimensions filled in the dialog, and a mismatch shows the backend message.
  it("sends the draft dimensions to the embedding test and shows its failure message", async () => {
    vi.mocked(api.testEmbeddingModel).mockRejectedValueOnce(
      new Error("Configured dimensions 4096, but the model returned 2048")
    );
    const page = await mountModelPage();
    const embedding = page.findComponent(EmbeddingModelConfigCard);
    await button(embedding, t("common.edit"))!.trigger("click");
    await embedding.find("section").findAll(".el-input-number input")[1]!.setValue("4096");
    await button(embedding.find("section"), t("common.testModel"))!.trigger("click");
    const testDialog = page.findAll("section").at(-1)!;
    await testDialog.find("textarea").setValue("hello");
    await button(testDialog, t("common.sendTest"))!.trigger("click");
    await flushPromises();
    expect(vi.mocked(api.testEmbeddingModel).mock.calls[0]![0]).toEqual({
      modelConfig: { ...fixtures.embedding, dimensions: 4096 },
      userContent: "hello",
    });
    expect(testDialog.text()).toContain("Configured dimensions 4096, but the model returned 2048");
    expect(api.saveEmbeddingModel).not.toHaveBeenCalled();
  });
});

describe("model selections", () => {
  /** Picks a value through the real select inside a selection control, as a choice of its dropdown would. */
  async function choose(control: Pick<VueWrapper, "findComponent">, value: string) {
    control.findComponent({ name: "ElSelect" }).vm.$emit("update:modelValue", value);
    await flushPromises();
  }
  const selectText = (control: { find: (selector: string) => { text(): string } }) =>
    control.find(".el-select__selected-item:not(.is-hidden)").text();

  it("shows a missing model ID as it is and asks for a new choice instead of falling back to the default", async () => {
    const page = await mountModelPage({ realSelects: true });
    const card = page.findComponent(OntologyAgentModelsCard);
    const [following, stale, future] = card.findAllComponents(ModelSelectionSelect);
    expect(selectText(following!)).toBe(t("admin.followDomainDefault", { model: "Qwen (qwen-lite)" }));
    expect(selectText(stale!)).toBe(t("admin.modelUnavailable", { id: "gone-model" }));
    expect(stale!.find("[role='alert']").text()).toBe(t("admin.modelSelectionMissing", { id: "gone-model" }));
    expect(stale!.props("modelValue")).toBe("gone-model");
    expect(selectText(future!)).toBe("Qwen (qwen-main)");
    // A kind the page does not know keeps the service's own name; known kinds are named in the page language.
    expect(card.findAll(".agent-model-name").map((name) => name.text())).toEqual([
      t("admin.ontologyAgentKinds.retrieval"),
      t("admin.ontologyAgentKinds.knowledgeGovernance"),
      "Service-named agent",
    ]);
    expect(api.saveOntologyAgentModel).not.toHaveBeenCalled();
  });

  it("reports a missing domain default the same way", async () => {
    server.defaultModelId = "gone-default";
    const page = await mountModelPage({ realSelects: true });
    const control = page.findComponent(ModelListCard).findComponent(ModelSelectionSelect);
    expect(selectText(control)).toBe(t("admin.modelUnavailable", { id: "gone-default" }));
    expect(control.find("[role='alert']").exists()).toBe(true);
  });

  it("saves one ontology agent's choice on its own and keeps the shown choice when the save is rejected", async () => {
    const error = vi.spyOn(ElMessage, "error");
    const page = await mountModelPage({ realSelects: true });
    const controls = () => page.findComponent(OntologyAgentModelsCard).findAllComponents(ModelSelectionSelect);
    await choose(controls()[1]!, "qwen-main");
    expect(sent.agentSaves).toEqual([{ id: "a-gone", modelId: "qwen-main" }]);
    expect(selectText(controls()[1]!)).toBe("Qwen (qwen-main)");
    expect(controls()[1]!.find("[role='alert']").exists()).toBe(false);

    // The null choice is "follow the domain default".
    await choose(controls()[2]!, "");
    expect(sent.agentSaves.at(-1)).toEqual({ id: "a-future", modelId: null });

    api.saveOntologyAgentModel.mockRejectedValueOnce(new Error("The selected model does not exist in this domain"));
    await choose(controls()[0]!, "qwen-main");
    expect(error).toHaveBeenCalledWith("The selected model does not exist in this domain");
    expect(controls()[0]!.props("modelValue")).toBeNull();
  });

  it("saves a new domain default with every model entry unchanged", async () => {
    const page = await mountModelPage({ realSelects: true });
    await choose(page.findComponent(ModelListCard).findComponent(ModelSelectionSelect), "qwen-main");
    expect(sent.settings).toEqual({ models: fixtures.models, defaultModelId: "qwen-main" });
    expect(JSON.stringify((sent.settings as ModelSettings).models[0]!.customRequestParameters)).toBe(OPAQUE_CUSTOMS);
    expect(page.findComponent(ModelListCard).props("defaultModelId")).toBe("qwen-main");
  });

  it("makes the first model of an empty library the default in the same save", async () => {
    server.models = [];
    server.defaultModelId = null;
    const page = await mountModelPage({ realSelects: true });
    const list = page.findComponent(ModelListCard);
    await button(list, t("admin.addModel"))!.trigger("click");
    await fillNewModel(list.find("section"), "first");
    await saveDialog(list.find("section"));
    expect((sent.settings as ModelSettings).defaultModelId).toBe("first");
  });

  it("removing another model keeps the default; removing the default chooses the next one or none in the same save", async () => {
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);
    server.models = [...JSON.parse(JSON.stringify(fixtures.models)), entry("deepseek")];
    const page = await mountModelPage({ realSelects: true });
    const deleteButtons = () =>
      page.findComponent(ModelListCard).findAll("button").filter((b) => b.text() === t("common.delete"));

    // qwen-main is not the default: a plain confirmation, and the default stays.
    await deleteButtons()[0]!.trigger("click");
    await flushPromises();
    expect(sent.settings).toEqual({
      models: [fixtures.models[1], entry("deepseek")],
      defaultModelId: "qwen-lite",
    });

    // qwen-lite is the default: nothing is saved until the replacement is chosen, offered first by default.
    sent.settings = null;
    await deleteButtons()[0]!.trigger("click");
    await flushPromises();
    expect(sent.settings).toBeNull();
    const dialog = page.findAll("section").at(-1)!;
    expect(dialog.text()).toContain(t("admin.deleteDefaultModelHint", { name: "Qwen (qwen-lite)" }));
    const replacement = page.findAllComponents(ModelSelectionSelect).at(-1)!;
    expect(replacement.props("modelValue")).toBe("deepseek");
    // Only the remaining models are offered.
    expect(replacement.props("models")!.map((model) => model.name)).toEqual(["deepseek"]);
    await choose(replacement, "");
    await button(dialog, t("common.delete"))!.trigger("click");
    await flushPromises();
    expect(sent.settings).toEqual({ models: [entry("deepseek")], defaultModelId: null });
    expect(page.findComponent(ModelListCard).find(".default-model-unset").exists()).toBe(true);
  });

  it("keeps the default and the model when the deletion with a new default is rejected", async () => {
    const error = vi.spyOn(ElMessage, "error");
    const page = await mountModelPage({ realSelects: true });
    api.saveModelSettings.mockRejectedValueOnce(new Error("Default references a missing model"));
    const deleteButtons = page.findComponent(ModelListCard).findAll("button").filter((b) => b.text() === t("common.delete"));
    await deleteButtons[1]!.trigger("click");
    await flushPromises();
    const dialog = page.findAll("section").at(-1)!;
    await button(dialog, t("common.delete"))!.trigger("click");
    await flushPromises();
    expect(error).toHaveBeenCalledWith("Default references a missing model");
    // The dialog stays open with the same choice for another try.
    expect(page.findAll("section").at(-1)!.text()).toContain(t("admin.deleteDefaultModelHint", { name: "Qwen (qwen-lite)" }));
    expect(page.findComponent(ModelListCard).props("models")).toHaveLength(2);
    expect(page.findComponent(ModelListCard).props("defaultModelId")).toBe("qwen-lite");
  });

  it("offers nothing to choose and reports nothing missing while the model library is unknown", async () => {
    api.getModelSettings.mockRejectedValueOnce(new Error("runtime down"));
    const page = await mountModelPage({ realSelects: true });
    const controls = page.findComponent(OntologyAgentModelsCard).findAllComponents(ModelSelectionSelect);
    expect(controls).toHaveLength(3);
    expect(controls.every((control) => control.find("[role='alert']").exists() === false)).toBe(true);
    expect(controls.every((control) => control.findComponent({ name: "ElSelect" }).props("disabled"))).toBe(true);
  });
});
