import { expect, it } from "vitest";
import { migrateLegacyModelSettings, importLegacyEmbedding, emptyModelSettings, defaultModelRetry } from "../model-migration";
import { migrateModelReference } from "@ontomato/contracts/model-migration";
import { modelSettingsWriteSchema, modelReferenceSchema } from "@ontomato/contracts/model-settings";
import { sealModelKey, openSealedModelKey } from "@ontomato/contracts/model-key-seal";
const key = sealModelKey("effective-key", "test-token");
const old = (name: string, extra = {}) => ({ name, modelName: "chat", baseUrl: "https://gateway/v1", apiKeys: [key], ...extra });
it("preserves headers, duplicate IDs, parameters and selections while discarding unused keys", () => {
  const result = migrateLegacyModelSettings({ models: [
    old("main", { apiKeys: [key, "discarded"], timeout: "PT30S", maxRetries: 2, temperature: 0,
      topP: 0.2, organizationId: "org", customRequestParameters: { temperature: 0.7 } }),
    old("other-headers", { customHeaders: { "OpenAI-Organization": "other" }, timeout: "PT2M", maxRetries: 4 }),
    old("other-parameters", { organizationId: "org", temperature: 1 }),
  ], defaultModelId: "main" }, value => openSealedModelKey(value, "test-token"));
  expect(result.discardedKeys).toBe(1);
  expect(result.mapping.references).toEqual({ main: "gateway/chat", "other-headers": "gateway-2/chat", "other-parameters": "gateway-3/chat" });
  expect(result.settings.providers.gateway!.models[0]!.samplingParams).toEqual({ temperature: 0.7, top_p: 0.2 });
  // other-parameters sets no timeout, which meant the provider default (300 s).
  expect(result.settings.retry.provider).toEqual({ timeoutMs: 300000, maxRetries: 4, maxRetryDelayMs: 60000 });
  expect(result.settings.defaultModelId).toBe("gateway/chat");
  expect(migrateModelReference("missing", result.mapping)).toBe("legacy/missing");
  expect(migrateModelReference(null, result.mapping)).toBeNull();
  expect(migrateModelReference("old/name", { ...result.mapping, references: { "old/name": "gateway/chat" } })).toBe("gateway/chat");
  expect(migrateModelReference("missing", { ...result.mapping, unconfiguredProviderId: "legacy-unconfigured" })).toBe("legacy-unconfigured/missing");
  const ref = importLegacyEmbedding(result.settings, { baseUrl: "https://gateway/v1", apiKey: "effective-key",
    modelName: "embed", dimensions: 2, headers: { "openai-organization": "org" }, timeoutMs: 180000 });
  expect(ref).toBe("gateway/embed");
  expect(result.settings.embeddingModelId).toBe(ref);
  expect(result.settings.providers.gateway!.models[1]).toEqual({ id: "embed", type: "embedding", dimensions: 2 });
  // The import only raises the domain timeout; 180 s stays below the 300 s already required above.
  expect(result.settings.retry.provider.timeoutMs).toBe(300000);
});
it("retains missing defaults, uses runtime retry defaults, and preserves user embedding choices", () => {
  const result = migrateLegacyModelSettings({ models: [], defaultModelId: "gone" }, value => value);
  expect(result.settings.defaultModelId).toBe("legacy/gone");
  expect(result.settings.retry).toEqual(emptyModelSettings().retry);
  result.settings.embeddingModelId = "user/embed";
  importLegacyEmbedding(result.settings, { baseUrl: "https://legacy/v1", apiKey: "key", modelName: "embed", dimensions: 3 });
  expect(result.settings.embeddingModelId).toBe("user/embed");
  expect(result.settings.providers).not.toHaveProperty("legacy");
});
it("rejects expressions, unsupported APIs and non-OpenAI embedding providers", () => {
  const settings = emptyModelSettings();
  importLegacyEmbedding(settings, { baseUrl: "https://gateway/v1", apiKey: "key", modelName: "embed", dimensions: 2 });
  expect(modelSettingsWriteSchema.safeParse(settings).success).toBe(true);
  for (const api of ["anthropic-messages", "google-generative-ai", "bedrock-converse-stream"])
    expect(modelSettingsWriteSchema.safeParse({ ...settings, providers: { gateway: { ...settings.providers.gateway, api } } }).success).toBe(false);
  for (const apiKey of ["$KEY", "${KEY}", "!printenv KEY", "enc:v1:cipher"])
    expect(modelSettingsWriteSchema.safeParse({ ...settings, providers: { gateway: { ...settings.providers.gateway, apiKey } } }).success).toBe(false);
});

it("counts an unset legacy retry count as the old default of three", () => {
  expect(defaultModelRetry().provider).toEqual({ timeoutMs: 300000, maxRetries: 3, maxRetryDelayMs: 60000 });
  for (const models of [[], [old("unset"), old("null", { maxRetries: null })]]) {
    const result = migrateLegacyModelSettings({ models, defaultModelId: null }, value => openSealedModelKey(value, "test-token"));
    expect(result.settings.retry.provider.maxRetries).toBe(3);
  }
  for (const [withUnset, counts, expected] of [[true, [0], 3], [true, [1, 5], 5], [false, [0], 0], [false, [1, 2], 2]] as const) {
    const models = [...(withUnset ? [old("unset")] : []), ...counts.map((maxRetries, index) => old(`set-${index}`, { maxRetries }))];
    const result = migrateLegacyModelSettings({ models, defaultModelId: null }, value => openSealedModelKey(value, "test-token"));
    expect(result.settings.retry.provider.maxRetries).toBe(expected);
  }
});
it("rejects reserved provider IDs on write while keeping unavailable legacy references valid", () => {
  const settings = emptyModelSettings();
  importLegacyEmbedding(settings, { baseUrl: "https://gateway/v1", apiKey: "key", modelName: "embed", dimensions: 2 });
  for (const id of ["legacy", "legacy-unconfigured"]) {
    const result = modelSettingsWriteSchema.safeParse({ ...settings,
      providers: { [id]: settings.providers.gateway }, embeddingModelId: `${id}/embed` });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({ path: ["providers", id] }));
    expect(modelReferenceSchema.safeParse(`${id}/missing`).success).toBe(true);
  }
  expect(modelSettingsWriteSchema.safeParse({ ...settings,
    providers: { "legacy-2": settings.providers.gateway }, embeddingModelId: "legacy-2/embed" }).success).toBe(true);
});
