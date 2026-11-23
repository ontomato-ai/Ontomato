import { z } from "zod";
import {
  DEFAULT_CHAT_CONTEXT_WINDOW, DEFAULT_MODEL_MAX_RETRIES, DEFAULT_MODEL_TIMEOUT_SECONDS,
  modelSettingsConfigurationSchema, type ModelEntry, type ModelProvider, type ModelSettingsConfiguration,
} from "@ontomato/contracts/model-settings";
import type { LegacyEmbeddingImport, ModelMigrationMap } from "@ontomato/contracts/model-migration";

/** References the runtime could not map stay under this prefix, so their owners keep failing explicitly. */
export const unavailableReferencePrefix = "legacy";

export function emptyModelSettings(): ModelSettingsConfiguration {
  return { connections: {}, models: {}, defaultModel: null, embeddingModel: null };
}

/** The API each earlier release stored a connection's protocol as, and the provider prefix it now is. */
export const legacyApiProviders: Record<string, ModelProvider> = {
  "openai-completions": "custom_openai",
  "openai-responses": "openai",
  "anthropic-messages": "anthropic",
  "google-generative-ai": "gemini",
};

/** An earlier release's connection with the models it hung under itself. */
const legacyProviderSchema = z.object({
  baseUrl: z.string(),
  api: z.enum(["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"]),
  apiKey: z.string(),
  headers: z.record(z.string()).optional(),
  models: z.array(z.object({
    id: z.string(), type: z.enum(["chat", "embedding"]),
    contextWindow: z.number().int().positive().nullish(), maxTokens: z.number().int().positive().nullish(),
    dimensions: z.number().int().positive().nullish(), reasoning: z.boolean().nullish(),
    input: z.array(z.string()).nullish(), samplingParams: z.record(z.unknown()).nullish(),
  }).passthrough()).default([]),
}).passthrough();
/** The oldest shape: one flat list of models, each with its address and keys, from pi's own settings file. */
const legacyModelSchema = z.object({
  name: z.string().min(1), modelName: z.string().min(1), baseUrl: z.string(),
  apiKeys: z.array(z.string()).min(1), timeout: z.string().nullish(), maxRetries: z.number().int().nonnegative().nullish(),
  contextWindow: z.number().int().positive().nullish(), maxTokens: z.number().int().positive().nullish(),
  temperature: z.number().nullish(), topP: z.number().nullish(),
  organizationId: z.string().nullish(), projectId: z.string().nullish(),
  customHeaders: z.record(z.string()).nullish(), customRequestParameters: z.record(z.unknown()).nullish(),
}).passthrough();
const legacyProvidersSchema = z.object({
  providers: z.record(legacyProviderSchema),
  defaultModelId: z.string().nullish(), embeddingModelId: z.string().nullish(),
  retry: z.object({ provider: z.object({
    timeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().nonnegative(),
    maxRetryDelayMs: z.number().int().nonnegative().optional(),
  }).passthrough() }).passthrough().optional(),
}).passthrough();
const legacyModelsSchema = z.object({ models: z.array(legacyModelSchema), defaultModelId: z.string().nullish() }).passthrough();

export function durationMs(value: string): number {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!m || !m.slice(1).some(Boolean)) throw new Error("Invalid legacy model timeout");
  return Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000);
}

const normalizedHeaders = (headers: Record<string, string> = {}) => Object.fromEntries(
  Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]).sort(([a], [b]) => a!.localeCompare(b!)),
);

/**
 * A model's public name: the upstream's own ID, and the connection's name appended when the domain already uses that
 * ID. Two models of one connection can never share an upstream ID, so this is the only collision to expect.
 */
function publicName(models: Record<string, ModelEntry>, preferred: string, connection: string): string {
  if (!models[preferred]) return preferred;
  const qualified = `${preferred} (${connection})`;
  if (!models[qualified]) return qualified;
  throw new Error(`Two models of connection ${connection} share the name ${preferred}`);
}

interface ConnectionSource {
  provider: ModelProvider;
  apiBase?: string;
  apiKey: string;
  extraHeaders?: Record<string, string>;
}

/** Reuse a connection with the same upstream, or take a free name derived from its host. */
function connectionFor(settings: ModelSettingsConfiguration, source: ConnectionSource): string {
  const equal = (connection: ConnectionSource) => connection.provider === source.provider
    && connection.apiBase === source.apiBase && connection.apiKey === source.apiKey
    && JSON.stringify(normalizedHeaders(connection.extraHeaders)) === JSON.stringify(normalizedHeaders(source.extraHeaders));
  const found = Object.entries(settings.connections).find(([, connection]) => equal(connection));
  if (found) return found[0];
  const base = new URL(source.apiBase ?? "https://gateway").hostname.replace(/[^a-zA-Z0-9.-]/g, "-") || "gateway";
  let name = base;
  for (let n = 2; settings.connections[name]; n++) name = `${base}-${n}`;
  settings.connections[name] = source;
  return name;
}

function chatEntry(model: z.output<typeof legacyProviderSchema>["models"][number], connection: string,
  timeoutSeconds: number, maxRetries: number): ModelEntry {
  const sampling = model.samplingParams ?? {};
  const temperature = sampling.temperature as number | undefined;
  const topP = sampling.top_p as number | undefined;
  return {
    connection,
    model: model.id,
    type: "chat",
    contextWindow: model.contextWindow ?? DEFAULT_CHAT_CONTEXT_WINDOW,
    ...(model.maxTokens == null ? {} : { maxOutputTokens: model.maxTokens }),
    timeoutSeconds,
    maxRetries,
    ...(temperature === undefined ? {} : { temperature }),
    ...(topP === undefined ? {} : { topP }),
    ...(model.input?.includes("image") ? { supportsVision: true } : {}),
    ...(model.reasoning ? { supportsReasoning: true } : {}),
  };
}

/** The providers-and-models shape, one release before named connections. */
function migrateProviders(raw: z.output<typeof legacyProvidersSchema>, open: (key: string) => string) {
  const settings = emptyModelSettings();
  const mapping: ModelMigrationMap = { references: {}, unavailablePrefix: unavailableReferencePrefix };
  const timeoutSeconds = Math.max(1, Math.round((raw.retry?.provider.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_SECONDS * 1000) / 1000));
  const maxRetries = raw.retry?.provider.maxRetries ?? DEFAULT_MODEL_MAX_RETRIES;
  for (const [id, provider] of Object.entries(raw.providers)) {
    const connection: ConnectionSource = {
      provider: legacyApiProviders[provider.api]!,
      apiBase: provider.baseUrl,
      apiKey: open(provider.apiKey),
      ...(provider.headers && Object.keys(provider.headers).length ? { extraHeaders: provider.headers } : {}),
    };
    settings.connections[id] = connection;
    for (const model of provider.models) {
      const name = publicName(settings.models, model.id, id);
      mapping.references[`${id}/${model.id}`] = name;
      settings.models[name] = model.type === "chat"
        ? chatEntry(model, id, timeoutSeconds, maxRetries)
        : { connection: id, model: model.id, type: "embedding", dimensions: model.dimensions!,
          ...(model.maxTokens == null ? {} : { maxOutputTokens: model.maxTokens }), timeoutSeconds, maxRetries };
    }
  }
  return { settings, mapping, discardedKeys: 0 };
}

/** pi's own settings file: one flat list, every entry an OpenAI-compatible connection of its own. */
function migrateModels(raw: z.output<typeof legacyModelsSchema>, open: (key: string) => string) {
  const settings = emptyModelSettings();
  const mapping: ModelMigrationMap = { references: {}, unavailablePrefix: unavailableReferencePrefix };
  let discardedKeys = 0;
  const defaults = { timeoutSeconds: DEFAULT_MODEL_TIMEOUT_SECONDS, maxRetries: DEFAULT_MODEL_MAX_RETRIES };
  for (const model of raw.models) {
    const headers: Record<string, string> = {};
    if (model.organizationId) headers["openai-organization"] = model.organizationId;
    if (model.projectId) headers["openai-project"] = model.projectId;
    Object.assign(headers, normalizedHeaders(model.customHeaders ?? {}));
    const connection = connectionFor(settings, { provider: "custom_openai", apiBase: model.baseUrl,
      apiKey: model.apiKeys[0] ? open(model.apiKeys[0]) : "unused",
      ...(Object.keys(headers).length ? { extraHeaders: headers } : {}) });
    const name = publicName(settings.models, model.modelName, connection);
    mapping.references[model.name] = name;
    // A stored request parameter was merged over the named one, so it is what the model actually called with.
    const parameters = model.customRequestParameters ?? {};
    const temperature = (parameters.temperature as number | undefined) ?? model.temperature ?? undefined;
    const topP = (parameters.top_p as number | undefined) ?? model.topP ?? undefined;
    settings.models[name] = {
      connection,
      model: model.modelName,
      type: "chat",
      contextWindow: model.contextWindow ?? DEFAULT_CHAT_CONTEXT_WINDOW,
      ...(model.maxTokens == null ? {} : { maxOutputTokens: model.maxTokens }),
      timeoutSeconds: model.timeout ? Math.max(1, Math.round(durationMs(model.timeout) / 1000)) : defaults.timeoutSeconds,
      maxRetries: model.maxRetries ?? defaults.maxRetries,
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
    };
    discardedKeys += Math.max(0, model.apiKeys.length - 1);
  }
  return { settings, mapping, discardedKeys };
}

function mapped(ref: string | null | undefined, mapping: ModelMigrationMap): string | null {
  if (ref == null) return null;
  return mapping.references[ref] ?? `${mapping.unavailablePrefix}/${ref}`;
}

/** Reads any earlier stored shape into named connections, keeping every reference's meaning. */
export function migrateLegacyModelSettings(raw: unknown, open: (key: string) => string) {
  const providers = legacyProvidersSchema.safeParse(raw);
  if (providers.success) {
    const migrated = migrateProviders(providers.data, open);
    migrated.settings.defaultModel = mapped(providers.data.defaultModelId, migrated.mapping);
    migrated.settings.embeddingModel = mapped(providers.data.embeddingModelId, migrated.mapping);
    return { settings: modelSettingsConfigurationSchema.parse(migrated.settings), mapping: migrated.mapping,
      discardedKeys: migrated.discardedKeys };
  }
  const models = legacyModelsSchema.parse(raw), migrated = migrateModels(models, open);
  migrated.settings.defaultModel = mapped(models.defaultModelId, migrated.mapping);
  return { settings: modelSettingsConfigurationSchema.parse(migrated.settings), mapping: migrated.mapping,
    discardedKeys: migrated.discardedKeys };
}

/** One domain's embedding settings from before the model library imported once, as a connection of its own. */
export function importLegacyEmbedding(settings: ModelSettingsConfiguration, input: LegacyEmbeddingImport): string {
  const connection = connectionFor(settings, { provider: "custom_openai", apiBase: input.baseUrl, apiKey: input.apiKey,
    ...(input.headers ? { extraHeaders: input.headers } : {}) });
  const name = publicName(settings.models, input.modelName, connection);
  settings.models[name] = {
    connection, model: input.modelName, type: "embedding", dimensions: input.dimensions,
    timeoutSeconds: input.timeoutMs ? Math.max(1, Math.round(input.timeoutMs / 1000)) : DEFAULT_MODEL_TIMEOUT_SECONDS,
    maxRetries: DEFAULT_MODEL_MAX_RETRIES,
  };
  if (settings.embeddingModel === null) settings.embeddingModel = name;
  return name;
}
