import { z } from "zod";
import { modelSettingsConfigurationSchema, type ModelEntry, type ModelSettingsWrite, type ModelProviderWrite } from "@ontomato/contracts/model-settings";
import { type LegacyEmbeddingImport, type ModelMigrationMap } from "@ontomato/contracts/model-migration";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";

export const defaultModelRetry = () => ({ provider: { timeoutMs: 300000, maxRetries: 0, maxRetryDelayMs: 60000 } });
export const emptyModelSettings = (): ModelSettingsWrite => ({ providers: {}, defaultModelId: null, embeddingModelId: null, retry: defaultModelRetry() });
const legacyModelSchema = z.object({
  name: z.string().min(1), modelName: z.string().min(1), baseUrl: z.string().url(),
  displayName: z.string().nullish(), apiKeys: z.array(z.string()),
  timeout: z.string().nullish(), maxRetries: z.number().int().nonnegative().nullish(),
  contextWindow: z.number().int().positive().nullish(), maxTokens: z.number().int().positive().nullish(),
  customHeaders: z.record(z.string()).nullish(), customRequestParameters: runtimeJsonObjectSchema.nullish(),
}).passthrough();
const legacySettingsSchema = z.object({ models: z.array(legacyModelSchema), defaultModelId: z.string().nullable() });
export function durationMs(value: string): number {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!m || !m.slice(1).some(Boolean)) throw new Error("Invalid legacy model timeout");
  return Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000);
}
const parameterNames: Record<string, string> = {
  temperature: "temperature", topP: "top_p", stop: "stop", maxCompletionTokens: "max_completion_tokens",
  presencePenalty: "presence_penalty", frequencyPenalty: "frequency_penalty", logitBias: "logit_bias",
  seed: "seed", user: "user", parallelToolCalls: "parallel_tool_calls", store: "store", metadata: "metadata",
  serviceTier: "service_tier", reasoningEffort: "reasoning_effort",
};
const normalizedHeaders = (headers: Record<string, string> = {}) => Object.fromEntries(
  Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a!.localeCompare(b!)),
);
/** Every legacy entry survives, including duplicate API model IDs with different parameters. */
export function appendImportedModel(settings: ModelSettingsWrite, connection: Omit<ModelProviderWrite, "models">, model: ModelEntry): string {
  const equal = (provider: ModelProviderWrite) => provider.baseUrl === connection.baseUrl
    && provider.apiKey === connection.apiKey && (provider.api === connection.api
      || (model.type === "embedding" && provider.api === "openai-responses"))
    && JSON.stringify(normalizedHeaders(provider.headers)) === JSON.stringify(normalizedHeaders(connection.headers));
  const found = Object.entries(settings.providers).find(([, p]) => equal(p) && !p.models.some(m => m.id === model.id));
  if (found) { found[1].models.push(model); return `${found[0]}/${model.id}`; }
  let base = new URL(connection.baseUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, "-") || "gateway";
  if (base === "legacy" || base === "legacy-unconfigured") base = "gateway";
  let id = base;
  for (let n = 2; settings.providers[id]; n++) id = `${base}-${n}`;
  settings.providers[id] = { ...connection, name: id, models: [model] };
  return `${id}/${model.id}`;
}
export function migrateLegacyModelSettings(raw: unknown, open: (key: string) => string) {
  const old = legacySettingsSchema.parse(raw), settings = emptyModelSettings();
  const mapping: ModelMigrationMap = { references: {}, unconfiguredProviderId: "legacy" };
  let discardedKeys = 0;
  const timeouts: number[] = [], retries: number[] = [];
  for (const model of old.models) {
    const headers: Record<string, string> = {};
    if (typeof model.organizationId === "string" && model.organizationId) headers["openai-organization"] = model.organizationId;
    if (typeof model.projectId === "string" && model.projectId) headers["openai-project"] = model.projectId;
    Object.assign(headers, normalizedHeaders(model.customHeaders ?? {}));
    const samplingParams: Record<string, unknown> = {};
    for (const [oldName, name] of Object.entries(parameterNames))
      if (model[oldName] !== undefined && model[oldName] !== null) samplingParams[name] = model[oldName];
    if (typeof model.responseFormat === "string" && model.responseFormat) samplingParams.response_format = { type: model.responseFormat };
    Object.assign(samplingParams, model.customRequestParameters);
    mapping.references[model.name] = appendImportedModel(settings, {
      baseUrl: model.baseUrl, api: "openai-completions", apiKey: model.apiKeys[0] ? open(model.apiKeys[0]) : "unused", headers,
    }, { id: model.modelName, name: model.displayName?.trim() || model.name, type: "chat", reasoning: false,
      input: ["text", "image"], contextWindow: model.contextWindow ?? 256000, maxTokens: model.maxTokens ?? 50000,
      samplingParams: runtimeJsonObjectSchema.parse(samplingParams) });
    discardedKeys += Math.max(0, model.apiKeys.length - 1);
    if (model.timeout) timeouts.push(durationMs(model.timeout));
    if (model.maxRetries != null) retries.push(model.maxRetries);
  }
  settings.defaultModelId = old.defaultModelId === null ? null : mapping.references[old.defaultModelId] ?? `legacy/${old.defaultModelId}`;
  if (timeouts.length) settings.retry.provider.timeoutMs = Math.max(...timeouts);
  if (retries.length) settings.retry.provider.maxRetries = Math.max(...retries);
  return { settings: modelSettingsConfigurationSchema.parse(settings), mapping, discardedKeys };
}
export function importLegacyEmbedding(settings: ModelSettingsWrite, input: LegacyEmbeddingImport): string {
  const ref = appendImportedModel(settings, { baseUrl: input.baseUrl, api: "openai-completions", apiKey: input.apiKey,
    headers: input.headers }, { id: input.modelName, type: "embedding", dimensions: input.dimensions });
  if (settings.embeddingModelId === null) settings.embeddingModelId = ref;
  if (input.timeoutMs) settings.retry.provider.timeoutMs = Math.max(settings.retry.provider.timeoutMs, input.timeoutMs);
  return ref;
}
