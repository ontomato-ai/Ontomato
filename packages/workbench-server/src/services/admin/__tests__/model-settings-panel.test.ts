import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as panelCheck from "@ontomato/contracts/panel-check";
import { platformTypeTableEntrySchema } from "@ontomato/contracts/platform-type-table";
import {
  ADD_MODEL_ENTRY,
  DELETE_MODEL_CONNECTION,
  DELETE_MODEL_ENTRY,
  DISCOVER_MODEL_CONNECTION,
  MODEL_CONNECTION,
  MODEL_ENTRY,
  MODEL_USAGE,
  PAUSE_VECTOR_REBUILD,
  REBUILD_VECTORS,
  TEST_MODEL_CONNECTION,
} from "@ontomato/contracts/platform-object-types";
import type { ModelSettingsData } from "@ontomato/contracts/model-settings";
import { panelFormDescriptionSchema, type PanelFormValues } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en } from "../../../i18n/locales/en";
import {
  createModelConnectionReads,
  createModelUsageReads,
  modelSettingsServerOperations,
  PROVIDER_SPECS,
} from "../model-settings-panel";
import { platformTypeEntries } from "../../product-panels/type-table";
import { validateBuiltinProductReferences } from "../../product-panels/references";
import { validateProjectionComponent } from "../../product-panels/component-catalogue";
import type {
  PanelImpactInspector,
  PanelOperationHost,
  PanelOperationTarget,
  PanelReadServerOperation,
  SinglePanelOperationOutcome,
} from "../../product-panels/server-operations";

const { assertPermission } = vi.hoisted(() => ({ assertPermission: vi.fn() }));
vi.mock("../../../identity/installed", () => ({ assertPermission }));
vi.mock("../../assistant/skills", () => ({}));

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

const mockFetch = vi.fn();
vi.mock("../../product-panels/operation-host", () => ({
  operationHost: () => ({
    request: (path: string, init: FetchInit) => mockFetch(path, init),
  }),
}));

const actor = {
  owner: { domainId: "domain-1", userId: "admin-1" },
  credentials: { type: "anonymous" as const, locale: "en" },
};

let storedSettings: ModelSettingsData;
let storedAgents: { id: string; kind: string; name: string; modelSelection: { modelId: string | null } }[];
let storedRebuild: Record<string, unknown>;
let savedBodies: unknown[];
let savedAgentModels: Array<{ id: string; body: unknown }>;

function makeHost(): PanelOperationHost {
  return {
    initiator: actor,
    executor: actor,
    locale: "en",
    requestWorkbench: vi.fn(),
    request: (path, init) => mockFetch(path, init),
  };
}

interface TargetedWriteOp {
  inspectImpact?: PanelImpactInspector;
  execute(
    host: PanelOperationHost,
    target: PanelOperationTarget,
    input: Record<string, unknown>,
    intentId: string,
  ): Promise<SinglePanelOperationOutcome>;
}

function writeOp(id: string): TargetedWriteOp {
  const found = modelSettingsServerOperations.find((entry) => entry.handlerRef === id);
  if (!found || found.effect !== "write" || found.batch || (found.kind === "action" && !("targetInput" in found))) {
    throw new Error(`Missing targeted single write operation ${id}`);
  }
  return found as TargetedWriteOp;
}

function readOp(id: string): PanelReadServerOperation {
  const found = modelSettingsServerOperations.find((entry) => entry.handlerRef === id);
  if (!found || found.effect !== "read") throw new Error(`Missing read operation ${id}`);
  return found;
}

beforeAll(() => {
  configureI18n({
    defaultLocale: "en",
    appTextLocale: "en",
    languageSwitchEnabled: false,
    packs: {
      en: { messages: en, languageName: "English", outputInstruction: "", conclusionPrefix: "" },
    },
  });
});

beforeEach(() => {
  assertPermission.mockReset();
  assertPermission.mockResolvedValue(undefined);
  savedBodies = [];
  savedAgentModels = [];
  storedSettings = {
    connections: {
      "openai-main": {
        provider: "openai",
        apiBase: "https://api.openai.com/v1",
        apiKey: "******1234",
        extraHeaders: { "X-Org": "demo" },
      },
      "claude-main": {
        provider: "anthropic",
        apiKey: "******9999",
      },
    },
    models: {
      "gpt-4o": {
        connection: "openai-main",
        model: "gpt-4o",
        type: "chat",
        contextWindow: 128000,
        supportsVision: true,
      },
      "embed-3": {
        connection: "openai-main",
        model: "text-embedding-3-small",
        type: "embedding",
        dimensions: 1536,
      },
      "claude-sonnet": {
        connection: "claude-main",
        model: "claude-3-7-sonnet",
        type: "chat",
        supportsReasoning: true,
      },
    },
    defaultModel: "gpt-4o",
    embeddingModel: "embed-3",
  };
  storedAgents = [
    { id: "11111111-1111-4111-8111-111111111111", kind: "quality", name: "Question quality check", modelSelection: { modelId: "gpt-4o" } },
    { id: "22222222-2222-4222-8222-222222222222", kind: "describe", name: "Program description", modelSelection: { modelId: null } },
    { id: "33333333-3333-4333-8333-333333333333", kind: "explain", name: "Action explanation", modelSelection: { modelId: null } },
    { id: "44444444-4444-4444-8444-444444444444", kind: "metric", name: "Metric crystallization", modelSelection: { modelId: null } },
    { id: "dd3b91b9-9214-4aa6-9937-fb07fd37b232", kind: "retrieval", name: "Data retrieval", modelSelection: { modelId: "gpt-4o" } },
  ];
  storedRebuild = { configured: true, state: "PENDING", total: 10, done: 0, error: null };

  mockFetch.mockImplementation(async (path: string, init?: FetchInit) => {
    if (path === "/api/data-query/model-settings" && init?.method === "GET") {
      return Response.json({ success: true, data: storedSettings });
    }
    if (path === "/api/data-query/model-settings/save" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      savedBodies.push(body);
      storedSettings = structuredClone(body) as ModelSettingsData;
      for (const connection of Object.values(storedSettings.connections)) {
        if (connection.apiKey) connection.apiKey = `******${connection.apiKey.slice(-4)}`;
      }
      return Response.json({ success: true, data: storedSettings });
    }
    if (path === "/api/data-query/model-settings/discover" && init?.method === "POST") {
      return Response.json({ success: true, data: { models: [{ id: "gpt-4o" }, { id: "gpt-4.1" }] } });
    }
    if (path === "/api/data-query/model-settings/test" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (body.model.type === "embedding") {
        return Response.json({ success: true, data: { type: "embedding", dimensions: body.model.dimensions } });
      }
      return Response.json({ success: true, data: { type: "chat", content: "pong" } });
    }
    if (path === "/api/data-query/ontology/ai/agent-models" && init?.method === "GET") {
      return Response.json({ success: true, data: { agents: storedAgents } });
    }
    if (path.startsWith("/api/data-query/ontology/ai/agent-models/") && init?.method === "PUT") {
      const id = decodeURIComponent(path.slice("/api/data-query/ontology/ai/agent-models/".length));
      const body = JSON.parse(String(init.body)) as { modelSelection: { modelId: string | null } };
      savedAgentModels.push({ id, body });
      const target = storedAgents.find((agent) => agent.id === id);
      if (!target) return Response.json({ success: false, message: "Not found" }, { status: 404 });
      target.modelSelection = body.modelSelection;
      return Response.json({ success: true, data: target });
    }
    if (path === "/api/data-query/businessConfig/vectorRebuildStatus") {
      return Response.json({ success: true, data: storedRebuild });
    }
    if (path === "/api/data-query/businessConfig/rebuildVectors") {
      storedRebuild = { configured: true, state: "RUNNING", total: 10, done: 0, error: null };
      return Response.json({ success: true, data: {} });
    }
    if (path === "/api/data-query/businessConfig/pauseVectorRebuild") {
      storedRebuild = { configured: true, state: "PAUSING", total: 10, done: 4, error: null };
      return Response.json({ success: true, data: {} });
    }
    throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
  });
});

describe("model settings owner reads & forms", () => {
  it("applies provider_create_fields rules (azure/custom_openai require apiBase; others optional) and secret apiKey", async () => {
    const reads = createModelConnectionReads(actor);

    const azureForm = await reads.createForm({ values: { provider: "azure" } });
    const azureBase = azureForm.fields.find((f) => f.path === "/apiBase")!;
    const azureKey = azureForm.fields.find((f) => f.path === "/apiKey")!;
    expect(azureBase.required).toBe(true);
    expect(azureBase.control).toMatchObject({ kind: "text", placeholder: PROVIDER_SPECS.azure.apiBasePlaceholder });
    expect(azureKey.required).toBe(true);
    expect(azureKey.control).toMatchObject({ kind: "text", secret: true });
    expect(azureForm.errors).toContainEqual(expect.objectContaining({ field: "/apiKey" }));
    expect(azureForm.errors.some((e) => e.field === "/apiBase" && e.code === "required")).toBe(true);

    const customForm = await reads.createForm({ values: { provider: "custom_openai" } });
    expect(customForm.fields.find((f) => f.path === "/apiBase")!.required).toBe(true);
    expect(customForm.errors.some((e) => e.field === "/apiBase" && e.code === "required")).toBe(true);

    const invalidProviderForm = await reads.createForm({ values: { name: "bad", provider: "bogus", apiKey: "sk-1" } });
    expect(invalidProviderForm.values.provider).toBe("bogus");
    expect(invalidProviderForm.errors.some((e) => e.field === "/provider" && e.code === "invalid_option")).toBe(true);

    const deepseekForm = await reads.createForm({ values: { provider: "deepseek" } });
    expect(deepseekForm.fields.find((f) => f.path === "/apiBase")!.required).toBe(false);
    expect(deepseekForm.fields.find((f) => f.path === "/apiBase")!.control).toMatchObject({
      placeholder: PROVIDER_SPECS.deepseek.apiBasePlaceholder,
    });

    expect(assertPermission).toHaveBeenCalledWith(actor.credentials, ["system-config"]);
  });

  it("keeps the saved key out of connection list, detail, and edit form responses", async () => {
    const reads = createModelConnectionReads(actor);
    const editForm = await reads.form("openai-main", {});
    expect(editForm.values.apiKey).toBe("");
    const editKey = editForm.fields.find((f) => f.path === "/apiKey")!;
    expect(editKey).toMatchObject({
      required: false,
      valueSchema: { type: "string" },
      control: { kind: "text", secret: true },
    });
    expect(editKey.valueSchema).not.toHaveProperty("minLength");
    expect(editForm.fields.find((f) => f.path === "/name")!.readOnly).toBe(true);
    const refreshed = await reads.form("openai-main", { values: { provider: "deepseek" } });
    expect(refreshed.values.apiKey).toBe("");
    expect(refreshed.fields.find((f) => f.path === "/provider")?.warning).toBe(
      "This provider type does not support embedding models.",
    );
    expect(refreshed.errors).toEqual([{
      field: "/provider", code: "invalid_option", message: "This provider type does not support embedding models.",
    }]);
    expect(JSON.stringify([await reads.list(), await reads.record("openai-main"), editForm, refreshed]))
      .not.toContain(storedSettings.connections["openai-main"]!.apiKey);
  });

  it("exposes connection status/subtitle/existingModelIds, inline extraHeaders, stepper model inputs, and usages", async () => {
    const reads = createModelConnectionReads(actor);

    const list = await reads.list();
    const openai = list.find((row) => row.primaryKey === "openai-main")!;
    expect(openai.fields).toMatchObject({
      status: "ready",
      statusLabel: "Ready",
      summary: "OpenAI / OpenAI Compatible (Responses) · 2 models",
    });
    expect(openai.tones).toEqual({ statusLabel: "success" });
    expect(JSON.parse(String(openai.outputs?.existingModelIds))).toEqual(
      expect.arrayContaining(["gpt-4o", "embed-3", "text-embedding-3-small"]),
    );

    storedSettings.connections["empty-azure"] = { provider: "azure", apiKey: "******0000" };
    const incomplete = (await reads.list()).find((row) => row.primaryKey === "empty-azure")!;
    expect(incomplete.fields.status).toBe("incomplete");
    expect(incomplete.tones).toEqual({ statusLabel: "warning" });

    const editOpenAi = await reads.form("openai-main", {});
    const openAiHeaders = editOpenAi.fields.find((f) => f.path === "/extraHeaders")!;
    expect(openAiHeaders.control).toMatchObject({ kind: "object-array", presentation: "inline" });
    expect(openAiHeaders.advanced).toBeUndefined();

    const editClaude = await reads.form("claude-main", {});
    const claudeHeaders = editClaude.fields.find((f) => f.path === "/extraHeaders")!;
    expect(claudeHeaders.control).toMatchObject({ kind: "object-array", presentation: "inline" });
    expect(claudeHeaders.advanced).toBe(true);

    const chatForm = await reads.createModelForm("openai-main", {});
    expect(chatForm.fields.find((f) => f.path === "/contextWindow")?.control).toMatchObject({
      kind: "number",
      presentation: "stepper",
      min: 1,
    });
    expect(chatForm.fields.find((f) => f.path === "/timeoutSeconds")?.control).toMatchObject({
      kind: "number",
      presentation: "stepper",
      min: 1,
    });
    expect(chatForm.fields.find((f) => f.path === "/maxRetries")?.control).toMatchObject({
      kind: "number",
      presentation: "stepper",
      min: 0,
    });

    const embedForm = await reads.createModelForm("openai-main", { values: { type: "embedding" } });
    expect(embedForm.fields.find((f) => f.path === "/dimensions")?.control).toMatchObject({
      kind: "number",
      presentation: "stepper",
      min: 1,
    });

    const models = await reads.models("openai-main");
    expect(models.find((m) => m.primaryKey === "gpt-4o")?.fields.nameParts).toEqual([
      "gpt-4o",
      "gpt-4o",
      "Default chat",
    ]);

    const usages = await reads.usages("openai-main");
    expect(usages.map((row) => ({ where: row.fields.where, model: row.fields.model }))).toEqual([
      { where: "Domain default chat model", model: "gpt-4o" },
      { where: "Domain embedding model", model: "embed-3" },
      { where: "Question quality check", model: "gpt-4o" },
      { where: "Data retrieval", model: "gpt-4o" },
    ]);
    expect(await reads.usages("claude-main")).toEqual([]);
  });

  it("shows chat fields vs embedding dimensions by model type and disables embedding for anthropic", async () => {
    const reads = createModelConnectionReads(actor);

    const anthropicModelForm = await reads.createModelForm("claude-main", {});
    const typeField = anthropicModelForm.fields.find((f) => f.path === "/type")!;
    expect(typeField.control.kind).toBe("select");
    if (typeField.control.kind === "select") {
      const embOpt = typeField.control.options.find((o) => o.value === "embedding")!;
      expect(embOpt.disabled).toBe(true);
    }
    expect(anthropicModelForm.fields.some((f) => f.path === "/contextWindow")).toBe(true);
    expect(anthropicModelForm.fields.some((f) => f.path === "/dimensions")).toBe(false);

    const embedForm = await reads.createModelForm("openai-main", { values: { type: "embedding" } });
    expect(embedForm.fields.some((f) => f.path === "/dimensions")).toBe(true);
    expect(embedForm.fields.some((f) => f.path === "/contextWindow")).toBe(false);
    expect(embedForm.fields.some((f) => f.path === "/supportsVision")).toBe(false);
  });

  it("opens model usage with unset defaults and preserves omissions when checking a draft", async () => {
    const usage = createModelUsageReads(actor);
    const draft = panelFormDescriptionSchema.parse(await usage.form("domain", { values: {} }));
    expect(draft.values).toEqual({
      taskModels: {
        quality: "gpt-4o",
        describe: "@default",
        explain: "@default",
        metric: "@default",
      },
    });
    expect(draft.errors).toEqual([]);

    storedSettings.defaultModel = null;
    storedSettings.embeddingModel = null;
    const opened = panelFormDescriptionSchema.parse(await usage.form("domain", {}));
    expect(opened.values).toEqual({
      defaultModel: "@none",
      embeddingModel: "@none",
      taskModels: {
        quality: "gpt-4o",
        describe: "@default",
        explain: "@default",
        metric: "@default",
      },
    });
    const defaultField = opened.fields.find((f) => f.path === "/defaultModel")!;
    const embeddingField = opened.fields.find((f) => f.path === "/embeddingModel")!;
    expect(defaultField.control).toMatchObject({
      kind: "select",
      options: expect.arrayContaining([expect.objectContaining({ value: "@none", label: "No default chat model" })]),
    });
    expect(embeddingField.control).toMatchObject({
      kind: "select",
      options: expect.arrayContaining([expect.objectContaining({ value: "@none", label: "No embedding model" })]),
    });
    expect(embeddingField.help).toBe("Used for semantic search and vector indexing.");
  });

  it("includes embeddingRebuildHint when an embedding model is selected", async () => {
    const usage = createModelUsageReads(actor);
    const form = panelFormDescriptionSchema.parse(await usage.form("domain", {}));
    const embeddingField = form.fields.find((f) => f.path === "/embeddingModel")!;
    expect(embeddingField.help).toContain("Changing the embedding model or its dimensions requires rebuilding domain vectors.");
  });

  it("exposes vector rebuild outputs and the four background task models with domain default labels", async () => {
    const usage = createModelUsageReads(actor);
    const rebuild = await usage.vectorRebuild("domain");
    expect(rebuild.outputs).toMatchObject({
      configured: true,
      state: "PENDING",
      tone: "warning",
      alive: false,
      canRebuild: true,
      canResume: false,
      canPause: false,
    });

    const form = panelFormDescriptionSchema.parse(await usage.form("domain", {}));
    expect(form.sections?.map((section) => section.key)).toEqual(["defaults", "backgroundTasks"]);
    const taskFields = form.fields.filter((field) => field.section === "backgroundTasks");
    expect(taskFields.map((field) => field.path)).toEqual([
      "/taskModels/quality",
      "/taskModels/describe",
      "/taskModels/explain",
      "/taskModels/metric",
    ]);
    expect(taskFields[0]!.control).toMatchObject({
      kind: "select",
      options: expect.arrayContaining([
        expect.objectContaining({ value: "@default", label: "Follow domain default (current: gpt-4o)" }),
      ]),
    });

    const save = writeOp(`${MODEL_USAGE}.save`);
    expect(await save.inspectImpact!.inspect(makeHost(), [{
      target: { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" },
      input: { values: { taskModels: { quality: "@default", describe: "claude-sonnet" } }, submittedFields: ["/taskModels/quality", "/taskModels/describe"] },
    }])).toBeNull();

    const outcome = await save.execute(makeHost(), { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" }, {
      values: { taskModels: { quality: "@default", describe: "claude-sonnet" } },
      submittedFields: ["/taskModels/quality", "/taskModels/describe"],
    }, "intent-tasks");
    expect(outcome).toMatchObject({
      kind: "success",
      data: {
        defaultModel: "gpt-4o",
        embeddingModel: "embed-3",
        taskModels: { quality: "@default", describe: "claude-sonnet", explain: "@default", metric: "@default" },
      },
    });
    expect(savedBodies).toHaveLength(0);
    expect(savedAgentModels).toEqual([
      { id: "11111111-1111-4111-8111-111111111111", body: { modelSelection: { modelId: null } } },
      { id: "22222222-2222-4222-8222-222222222222", body: { modelSelection: { modelId: "claude-sonnet" } } },
    ]);
  });
});

describe("model settings owner writes, impact confirmation, and draft reads", () => {
  it("reports the identity of a newly created model connection", async () => {
    const save = writeOp(`${MODEL_CONNECTION}.save`);
    const outcome = await save.execute(makeHost(), { kind: "draft" }, {
      values: { name: "openai-backup", provider: "openai", apiKey: "sk-backup" },
    }, "intent-1");
    expect(outcome).toMatchObject({ kind: "success", created: { objectType: MODEL_CONNECTION, primaryKey: "openai-backup" } });
  });

  it("refuses to create a connection with a blank API key", async () => {
    const save = writeOp(`${MODEL_CONNECTION}.save`);
    const outcome = await save.execute(makeHost(), { kind: "draft" }, {
      values: { name: "openai-backup", provider: "openai", apiKey: "" },
    }, "intent-1");
    expect(outcome).toMatchObject({
      kind: "refusal",
      code: "INVALID_CONNECTION",
      errors: [expect.objectContaining({ field: "/apiKey", message: expect.stringMatching(/API key.*required/i) })],
    });
    expect(savedBodies).toHaveLength(0);
  });

  it.each([
    { input: "omitted", values: {}, apiKey: "******1234" },
    { input: "blank", values: { apiKey: "" }, apiKey: "******1234" },
    { input: "replaced", values: { apiKey: "sk-replacement" }, apiKey: "sk-replacement" },
  ])("saves connection edits with the API key $input", async ({ values, apiKey }) => {
    const saveConn = writeOp(`${MODEL_CONNECTION}.save`);
    const outcome = await saveConn.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_CONNECTION, primaryKey: "openai-main" },
      { values: { ...values, apiBase: "https://proxy.example.com/v1" } },
      "intent-1",
    );
    expect(outcome).toMatchObject({ kind: "success", data: { id: "openai-main" } });
    expect(JSON.stringify(outcome)).not.toContain(apiKey);
    expect(savedBodies).toHaveLength(1);
    expect((savedBodies[0] as ModelSettingsData).connections["openai-main"]).toMatchObject({
      provider: "openai",
      apiBase: "https://proxy.example.com/v1",
      apiKey,
    });
  });

  it("inspects impact before deleting a connection or model and clears affected defaults on execute", async () => {
    const deleteConn = writeOp(DELETE_MODEL_CONNECTION);
    const impact = await deleteConn.inspectImpact!.inspect(makeHost(), [
      { target: { kind: "object", objectType: MODEL_CONNECTION, primaryKey: "openai-main" }, input: {} },
    ]);
    expect(impact?.summary).toContain("gpt-4o");
    expect(impact?.summary).toContain("embed-3");
    expect(impact?.summary).toContain("Question quality check");

    const outcome = await deleteConn.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_CONNECTION, primaryKey: "openai-main" },
      {},
      "intent-2",
    );
    expect(outcome.kind).toBe("success");
    expect(storedSettings.connections["openai-main"]).toBeUndefined();
    expect(storedSettings.models["gpt-4o"]).toBeUndefined();
    expect(storedSettings.defaultModel).toBeNull();
    expect(storedSettings.embeddingModel).toBeNull();
  });

  it("adds, renames, and deletes models with default retargeting", async () => {
    const addModel = writeOp(ADD_MODEL_ENTRY);
    const added = await addModel.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_CONNECTION, primaryKey: "openai-main" },
      { values: { name: "gpt-4.1", model: "gpt-4.1", type: "chat", contextWindow: 262144 } },
      "intent-3",
    );
    expect(added).toMatchObject({ kind: "success", created: { objectType: MODEL_ENTRY, primaryKey: "gpt-4.1" } });
    expect(storedSettings.models["gpt-4.1"]).toMatchObject({ connection: "openai-main", type: "chat", contextWindow: 262144 });

    const editModel = writeOp(`${MODEL_ENTRY}.save`);
    const editImpact = await editModel.inspectImpact!.inspect(makeHost(), [
      { target: { kind: "object", objectType: MODEL_ENTRY, primaryKey: "gpt-4o" }, input: { values: { name: "gpt-4o-renamed" } } },
    ]);
    expect(editImpact?.summary).toContain("Question quality check");

    const renamed = await editModel.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_ENTRY, primaryKey: "gpt-4o" },
      { values: { name: "gpt-4o-renamed" } },
      "intent-4",
    );
    expect(renamed.kind).toBe("success");
    expect(storedSettings.defaultModel).toBe("gpt-4o-renamed");
    expect(storedSettings.models["gpt-4o"]).toBeUndefined();

    const deleteModel = writeOp(DELETE_MODEL_ENTRY);
    const deleted = await deleteModel.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_ENTRY, primaryKey: "gpt-4o-renamed" },
      {},
      "intent-5",
    );
    expect(deleted.kind).toBe("success");
    expect(storedSettings.defaultModel).toBeNull();
  });

  it.each<{ description: string; values: PanelFormValues }>([
    { description: "omitted defaults", values: {} },
    { description: "null defaults", values: { defaultModel: null, embeddingModel: null } },
    { description: "explicit @none defaults", values: { defaultModel: "@none", embeddingModel: "@none" } },
  ])("clears stored model selections when saving $description", async ({ values }) => {
    const saveUsage = writeOp(`${MODEL_USAGE}.save`);
    const result = await saveUsage.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" },
      { values, submittedFields: ["/defaultModel", "/embeddingModel"] },
      "intent-clear",
    );
    expect(result).toMatchObject({ kind: "success" });
    expect(result.kind === "success" && result.data).toEqual({
      defaultModel: "@none",
      embeddingModel: "@none",
      taskModels: {
        quality: "gpt-4o",
        describe: "@default",
        explain: "@default",
        metric: "@default",
      },
    });
    expect(savedBodies).toEqual([expect.objectContaining({ defaultModel: null, embeddingModel: null })]);
  });

  it("preserves an unsubmitted embedding selection in the impact preview and save", async () => {
    const saveUsage = writeOp(`${MODEL_USAGE}.save`);
    const host = makeHost();
    const target = { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" } as const;
    const input = { values: { defaultModel: "claude-sonnet" }, submittedFields: ["/defaultModel"] };

    const fullImpact = await saveUsage.inspectImpact!.inspect(host, [{
      target,
      input: { values: { defaultModel: "claude-sonnet", embeddingModel: "embed-3" } },
    }]);
    expect(fullImpact).not.toBeNull();
    expect(await saveUsage.inspectImpact!.inspect(host, [{ target, input }])).toEqual(fullImpact);

    expect((await saveUsage.execute(host, target, input, "intent-partial")).kind).toBe("success");
    expect(savedBodies).toEqual([expect.objectContaining({ defaultModel: "claude-sonnet", embeddingModel: "embed-3" })]);
  });

  it("confirms default chat/embedding changes and vector rebuild actions", async () => {
    const saveUsage = writeOp(`${MODEL_USAGE}.save`);
    const impact = await saveUsage.inspectImpact!.inspect(makeHost(), [
      {
        target: { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" },
        input: { values: { defaultModel: "claude-sonnet", embeddingModel: null } },
      },
    ]);
    expect(impact?.summary).toContain("claude-sonnet");
    expect(impact?.summary).toContain("embedding");

    const saved = await saveUsage.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" },
      { values: { defaultModel: "claude-sonnet", embeddingModel: null } },
      "intent-6",
    );
    expect(saved.kind).toBe("success");
    expect(storedSettings.defaultModel).toBe("claude-sonnet");
    expect(storedSettings.embeddingModel).toBeNull();

    const rebuild = writeOp(REBUILD_VECTORS);
    const rebuildImpact = await rebuild.inspectImpact!.inspect(makeHost(), [
      { target: { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" }, input: {} },
    ]);
    expect(rebuildImpact).not.toBeNull();
    expect((await rebuild.execute(makeHost(), { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" }, {}, "intent-7")).kind).toBe("success");

    const pause = writeOp(PAUSE_VECTOR_REBUILD);
    expect((await pause.execute(makeHost(), { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" }, {}, "intent-8")).kind).toBe("success");
  });

  it.each<{ input: string; values: PanelFormValues; apiKey: string }>([
    { input: "omitted", values: {}, apiKey: "******1234" },
    { input: "blank", values: { apiKey: "" }, apiKey: "******1234" },
    { input: "replaced", values: { apiKey: "sk-unsaved" }, apiKey: "sk-unsaved" },
  ])("discovers and tests models with the draft API key $input", async ({ values, apiKey }) => {
    const draft = { name: "openai-main", provider: "openai", apiBase: "https://proxy.example.com/v1", ...values };
    const discover = readOp(DISCOVER_MODEL_CONNECTION);
    const discovered = await discover.execute(makeHost(), {
      target: undefined,
      input: { draft, parameters: {} },
    });
    expect(discovered).toEqual({ kind: "json", value: { models: [{ id: "gpt-4o" }, { id: "gpt-4.1" }] } });
    const discoveryCall = mockFetch.mock.calls.at(-1)!;
    expect(discoveryCall[0]).toBe("/api/data-query/model-settings/discover");
    expect(JSON.parse(String((discoveryCall[1] as FetchInit).body))).toMatchObject({
      connectionName: draft.name,
      connection: { apiKey, apiBase: draft.apiBase },
    });

    const test = readOp(TEST_MODEL_CONNECTION);
    const tested = await test.execute(makeHost(), {
      target: undefined,
      input: { draft, parameters: { modelName: "gpt-4o" } },
    });
    expect(tested).toEqual({ kind: "json", value: { type: "chat", content: "pong" } });
    const lastCall = mockFetch.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("/api/data-query/model-settings/test");
    expect(JSON.parse(String((lastCall[1] as FetchInit).body))).toMatchObject({
      connectionName: draft.name,
      connection: { apiKey, apiBase: draft.apiBase },
    });
  });

  it("tests a model directly from a declarative ObjectList row action without a form draft", async () => {
    const test = readOp(TEST_MODEL_CONNECTION);
    const tested = await test.execute(makeHost(), {
      target: undefined,
      input: { modelName: "embed-3" },
    });
    expect(tested).toEqual({ kind: "json", value: { type: "embedding", dimensions: 1536 } });
    const lastCall = mockFetch.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("/api/data-query/model-settings/test");
    expect(JSON.parse(String((lastCall[1] as FetchInit).body))).toMatchObject({
      connectionName: "openai-main",
      connection: { provider: "openai", apiKey: "******1234" },
      model: { connection: "openai-main", model: "text-embedding-3-small", type: "embedding", dimensions: 1536 },
    });
  });
});

describe("built-in model panels validation", () => {
  it("passes checkBuiltinPanelSource, projection expansion, reference checks, settings.json uses, and avoids usePanelData", async () => {
    const repoRoot = resolve(__dirname, "../../../../../..");
    const { checkBuiltinPanelSource } = await import(resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs"));
    const { components } = await import(resolve(repoRoot, "packages/apps-sdk/src/catalogue.ts"));

    const typeMap = platformTypeEntries();
    const draftReadOperationIds = [...typeMap.values()].flatMap(({ operations = [] }) =>
      operations.filter((operation) => operation.effect === "read" && operation.target.source === "draft").map((operation) => operation.id),
    );
    const connOps = typeMap.get(MODEL_CONNECTION)?.operations?.map((operation) => operation.id) ?? [];
    expect(connOps).toContain(DISCOVER_MODEL_CONNECTION);
    expect(connOps).toContain(TEST_MODEL_CONNECTION);
    expect(typeMap.get(MODEL_CONNECTION)?.reads).toHaveProperty("usages");

    const typeTable = {
      objectTypes: z.record(platformTypeTableEntrySchema).parse(Object.fromEntries(typeMap)),
    };
    const catalogueMap = new Map(components.map((component: { module: string; componentId: string }) => {
      const pkg = component.module.split("/", component.module.startsWith("@") ? 2 : 1).join("/");
      return [`${pkg}:${component.componentId}`, component];
    }));
    const readCatalogue = async () => ({ version: "1.1.2", digest: "test", components: catalogueMap });

    const panels = new Map();
    const projections = new Map();
    for (const dirName of ["model-connections", "model-usage"]) {
      const dir = resolve(repoRoot, "packages/platform-admin/resources/builtin-panels", dirName);
      await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds });
      const mod = readFileSync(resolve(dir, "panel.mjs"), "utf8");
      expect(mod).not.toContain("usePanelData");

      const reg = JSON.parse(readFileSync(resolve(dir, "registration.json"), "utf8"));
      const desc = JSON.parse(readFileSync(resolve(dir, "panel.json"), "utf8"));
      const html = readFileSync(resolve(dir, "panel.html"), "utf8");
      if (dirName === "model-connections") {
        expect(desc.manifest.members).toHaveProperty("usagesList");
        expect(desc.manifest.members.connections.config).toMatchObject({
          searchable: true,
          statusStyle: "dot",
          statusField: "statusLabel",
          subtitleField: "summary",
        });
        expect(desc.manifest.members.connectionForm.config).toMatchObject({ columns: 2 });
        expect(desc.manifest.members.deleteConnection.config).toMatchObject({ type: "danger", icon: "trash-2" });
        expect(desc.manifest.members.deleteConnection.config.plain).toBeUndefined();
        expect(desc.manifest.members.modelsList.config).toMatchObject({ groupBy: "typeLabel" });
        expect(desc.manifest.members.modelsList.config.rowActions.items[0]).toMatchObject({
          kind: "operation",
          operation: "testModel",
        });
        expect(desc.manifest.members.createModelForm.config).toMatchObject({ columns: 2 });
        expect(desc.manifest.members.editModelForm.config).toMatchObject({ columns: 2 });
        expect(html).toContain("usagesList");
        expect(html).not.toContain("openUsage");
      }
      if (dirName === "model-usage") {
        expect(desc.manifest.members.usageForm.config).toMatchObject({ showToc: false });
        expect(html).not.toContain("openConnections");
        expect(mod).toContain("setInterval");
      }
      const { state, members, ...decl } = desc.manifest;
      const placements = Object.fromEntries(Object.entries(members).map(([member, def]) => {
        if (!("component" in (def as Record<string, unknown>))) return [member, def];
        const typed = def as { id: string; name?: string; description?: string };
        const { projection, placement } = panelCheck.expandPanelAuthoringMember(member, def as never, {
          state,
          components: [...catalogueMap.values()] as never,
          typeTable,
        });
        projections.set(typed.id, panelCheck.builtinProductProjectionInputSchema.parse({
          ...projection,
          visibility: "platform",
          name: typed.name ?? member,
          description: typed.description ?? member,
        }));
        return [member, { ...placement, target: { projectionId: typed.id } }];
      }));
      const { id, input } = reg.panels[0];
      panels.set(id, panelCheck.builtinProductPanelInputSchema.parse({
        ...input,
        visibility: "platform",
        manifest: { ...decl, state, members: placements },
        content: { ...desc.content, html, module: mod },
      }));
    }

    for (const [id, proj] of projections) {
      await validateProjectionComponent(id, proj, readCatalogue as never);
    }
    await validateBuiltinProductReferences(panels, projections, readCatalogue as never);

    const settings = JSON.parse(readFileSync(resolve(repoRoot, "packages/data-engine-core/src/main/resources/applications/settings.json"), "utf8"));
    const uses = settings.declaration.panelUses as Array<{ id: string; panelId?: string; kind?: string }>;
    for (const use of uses) {
      if (use.kind === "native") {
        panelCheck.builtinNativeEntrySchema.parse(use);
      } else {
        panelCheck.builtinApplicationPanelUseSchema.parse(use);
      }
    }
    const modelUses = uses.filter((use) => use.id === "model-usage" || use.id === "model-connections");
    expect(modelUses).toHaveLength(2);
    for (const use of modelUses) {
      expect(panels.has(use.panelId!)).toBe(true);
    }
  });
});
