import { expect, it } from "vitest";
import { migrateLegacyModelSettings, importLegacyEmbedding, emptyModelSettings, unavailableReferencePrefix } from "../model-migration";
import { migrateModelReference } from "@ontomato/contracts/model-migration";
import { DEFAULT_CHAT_CONTEXT_WINDOW, DEFAULT_MODEL_TIMEOUT_SECONDS } from "@ontomato/contracts/model-settings";
import { sealModelKey, openSealedModelKey } from "@ontomato/contracts/model-key-seal";

const open = (value: string) => openSealedModelKey(value, "test-token");
const sealed = (value: string) => sealModelKey(value, "test-token");

it("turns providers into connections and names each model by its upstream ID", () => {
  const result = migrateLegacyModelSettings({
    providers: {
      gateway: {
        baseUrl: "https://gateway/v1", api: "openai-completions", apiKey: sealed("effective-key"),
        headers: { "X-Deployment": "fixture" },
        models: [
          { id: "chat", type: "chat", contextWindow: 32000, maxTokens: 4096, reasoning: true, input: ["text", "image"],
            samplingParams: { temperature: 0.25, top_p: 0.9, seed: 7 } },
          { id: "embed", type: "embedding", dimensions: 2 },
        ],
      },
      native: { baseUrl: "https://api.openai.com/v1", api: "openai-responses", apiKey: sealed("second-key"),
        models: [{ id: "chat", type: "chat" }] },
    },
    defaultModelId: "gateway/chat",
    embeddingModelId: "gateway/embed",
    retry: { provider: { timeoutMs: 120000, maxRetries: 4, maxRetryDelayMs: 60000 } },
  }, open);
  expect(result.mapping).toEqual({
    references: { "gateway/chat": "chat", "gateway/embed": "embed", "native/chat": "chat (native)" },
    unavailablePrefix: unavailableReferencePrefix,
  });
  expect(result.settings.connections).toEqual({
    gateway: { provider: "custom_openai", apiBase: "https://gateway/v1", apiKey: "effective-key",
      extraHeaders: { "X-Deployment": "fixture" } },
    native: { provider: "openai", apiBase: "https://api.openai.com/v1", apiKey: "second-key" },
  });
  // Chat values carry over; seed and other free-form parameters have no place in the new shape.
  expect(result.settings.models.chat).toEqual({ connection: "gateway", model: "chat", type: "chat",
    contextWindow: 32000, maxOutputTokens: 4096, timeoutSeconds: 120, maxRetries: 4,
    temperature: 0.25, topP: 0.9, supportsVision: true, supportsReasoning: true });
  expect(result.settings.models.embed).toEqual({ connection: "gateway", model: "embed", type: "embedding",
    dimensions: 2, timeoutSeconds: 120, maxRetries: 4 });
  expect(result.settings.defaultModel).toBe("chat");
  expect(result.settings.embeddingModel).toBe("embed");
});

it("gives a chat model the 256k default context and no output limit when the old entry left them out", () => {
  const result = migrateLegacyModelSettings({
    providers: { gateway: { baseUrl: "https://gateway/v1", api: "anthropic-messages", apiKey: sealed("key"),
      models: [{ id: "claude", type: "chat" }] } },
    defaultModelId: null,
  }, open);
  expect(result.settings.models.claude).toEqual({ connection: "gateway", model: "claude", type: "chat",
    contextWindow: DEFAULT_CHAT_CONTEXT_WINDOW, timeoutSeconds: DEFAULT_MODEL_TIMEOUT_SECONDS, maxRetries: 2 });
  expect(result.settings.connections.gateway!.provider).toBe("anthropic");
});

it("maps an old provider/model reference, and keeps an unmappable one unavailable", () => {
  const result = migrateLegacyModelSettings({ providers: {}, defaultModelId: "gone/chat" }, open);
  expect(result.settings.defaultModel).toBe("legacy/gone/chat");
  expect(migrateModelReference("gone/chat", result.mapping)).toBe("legacy/gone/chat");
  expect(migrateModelReference(null, result.mapping)).toBeNull();
  expect(migrateModelReference("old/name", { ...result.mapping, references: { "old/name": "chat" } })).toBe("chat");
});

it("reads pi's flat model list as connections of its own", () => {
  const result = migrateLegacyModelSettings({ models: [
    { name: "main", modelName: "chat", baseUrl: "https://gateway/v1", apiKeys: [sealed("first"), sealed("dropped")],
      timeout: "PT30S", maxRetries: 1, temperature: 0, topP: 0.2, organizationId: "org",
      customRequestParameters: { temperature: 0.7 } },
    { name: "other-headers", modelName: "chat", baseUrl: "https://gateway/v1", apiKeys: [sealed("first")],
      customHeaders: { "OpenAI-Organization": "other" } },
    { name: "nested", modelName: "vendor/chat", baseUrl: "https://gateway-2/v1", apiKeys: [sealed("third")] },
  ], defaultModelId: "main" }, open);
  expect(result.mapping.references).toEqual({
    main: "chat", "other-headers": "chat (gateway-2)", nested: "vendor/chat",
  });
  // One connection per distinct upstream: keys, headers and addresses decide.
  expect(Object.keys(result.settings.connections)).toEqual(["gateway", "gateway-2", "gateway-2-2"]);
  expect(result.discardedKeys).toBe(1);
  expect(result.settings.models.chat).toMatchObject({ connection: "gateway", model: "chat", timeoutSeconds: 30,
    maxRetries: 1, temperature: 0.7, topP: 0.2 });
  expect(result.settings.connections.gateway!.extraHeaders).toEqual({ "openai-organization": "org" });
  expect(result.settings.defaultModel).toBe("chat");
  expect(result.settings.embeddingModel).toBeNull();
});

it("imports a domain's old embedding settings once, as a connection of its own", () => {
  const settings = emptyModelSettings();
  const imported = importLegacyEmbedding(settings, { baseUrl: "https://gateway/v1", apiKey: "key", modelName: "embed",
    dimensions: 1024, headers: { "openai-organization": "org" }, timeoutMs: 180000 });
  expect(imported).toBe("embed");
  expect(settings.embeddingModel).toBe("embed");
  expect(settings.connections.gateway).toEqual({ provider: "custom_openai", apiBase: "https://gateway/v1",
    apiKey: "key", extraHeaders: { "openai-organization": "org" } });
  expect(settings.models.embed).toEqual({ connection: "gateway", model: "embed", type: "embedding",
    dimensions: 1024, timeoutSeconds: 180, maxRetries: 2 });
  // A name already taken by a chat model of the same connection gets the connection's name appended.
  importLegacyEmbedding(settings, { baseUrl: "https://gateway/v1", apiKey: "key", modelName: "embed", dimensions: 1024 });
  expect(settings.embeddingModel).toBe("embed");
});
