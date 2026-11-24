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
    { id: "11111111-1111-4111-8111-111111111111", kind: "qa", name: "Ontology QA", modelSelection: { modelId: "gpt-4o" } },
    { id: "22222222-2222-4222-8222-222222222222", kind: "analysis", name: "Analysis", modelSelection: { modelId: null } },
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
    if (path === "/api/data-query/ontology/ai/agent-models") {
      return Response.json({ success: true, data: { agents: storedAgents } });
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
    expect(refreshed.errors).toEqual([]);
    expect(JSON.stringify([await reads.list(), await reads.record("openai-main"), editForm, refreshed]))
      .not.toContain(storedSettings.connections["openai-main"]!.apiKey);
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
    expect(draft.values).toEqual({});
    expect(draft.errors).toEqual([]);

    storedSettings.defaultModel = null;
    storedSettings.embeddingModel = null;
    const opened = panelFormDescriptionSchema.parse(await usage.form("domain", {}));
    expect(opened.values).toEqual({});
  });

  it("exposes vector rebuild outputs and ontology agent usages", async () => {
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

    const agents = await usage.agentUsages("domain");
    expect(agents.map((row) => row.fields)).toEqual([
      { agent: "Ontology QA", model: "gpt-4o", status: "Configured" },
      { agent: "Analysis", model: "Follow domain default (gpt-4o)", status: "Configured" },
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
    expect(impact?.summary).toContain("Ontology QA");

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
    expect(editImpact?.summary).toContain("Ontology QA");

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
  ])("clears stored model selections when saving $description", async ({ values }) => {
    const saveUsage = writeOp(`${MODEL_USAGE}.save`);
    const result = await saveUsage.execute(
      makeHost(),
      { kind: "object", objectType: MODEL_USAGE, primaryKey: "domain" },
      { values, submittedFields: ["/defaultModel", "/embeddingModel"] },
      "intent-clear",
    );
    expect(result).toMatchObject({ kind: "success", data: {} });
    expect(result.kind === "success" && result.data).toEqual({});
    expect(savedBodies).toEqual([expect.objectContaining({ defaultModel: null, embeddingModel: null })]);
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
    const uses = settings.declaration.panelUses;
    expect(uses).toHaveLength(2);
    for (const use of uses) {
      panelCheck.builtinApplicationPanelUseSchema.parse(use);
      expect(panels.has(use.panelId)).toBe(true);
    }
  });
});
