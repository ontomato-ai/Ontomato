import { z } from "zod";
import { runtimeHttpUrlSchema } from "./agent-runtime-values";

export const SECRET_MASK_PREFIX = "******";
export function isMaskedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith(SECRET_MASK_PREFIX);
}
export function maskModelKey(value: string): string {
  return value ? SECRET_MASK_PREFIX + (value.length > 8 ? value.slice(-4) : "") : value;
}

/** A connection's name is the key models reference it by; it never contains a slash. */
export const modelConnectionNameSchema = z.string().min(1).regex(/^[^/\s]+$/);
/** A model's public name: what callers name in requests, unique in the domain, and the only name stored elsewhere. */
export const modelNameSchema = z.string().trim().min(1);

/**
 * LiteLLM provider prefixes the platform offers. Each decides how LiteLLM reaches the upstream: its own native API, a
 * conversion from Chat (for upstreams that only speak Chat), or the Anthropic and Gemini APIs of migrated settings.
 */
export const modelProviderSchema = z.enum([
  "openai", "azure", "bigmodel", "volcengine", "deepseek", "dashscope", "moonshot",
  "custom_openai", "anthropic", "gemini",
]);
export type ModelProvider = z.output<typeof modelProviderSchema>;
export const modelTypeSchema = z.enum(["chat", "embedding"]);
export type ModelType = z.output<typeof modelTypeSchema>;

/** A chat model's context length when the connection's owner leaves it out; it is not the upstream's limit. */
export const DEFAULT_CHAT_CONTEXT_WINDOW = 262144;
/** What a model waits for its upstream when its owner configures no timeout. */
export const DEFAULT_MODEL_TIMEOUT_SECONDS = 300;
export const DEFAULT_MODEL_MAX_RETRIES = 2;

/** Anthropic serves no embeddings API; every other provider prefix here does. */
export function supportsEmbeddings(provider: ModelProvider): boolean {
  return provider !== "anthropic";
}

/** Configuration values are literals, never environment interpolation or commands. */
const literalValueSchema = z.string().refine(value =>
  !/^[!$]/.test(value.trimStart()) && !/\$(?:\{|[A-Za-z_])/.test(value),
"Environment interpolation and commands are not supported");
export const modelApiKeyWriteSchema = literalValueSchema
  .refine(value => value.trim().length > 0, "An API key is required")
  .refine(value => !value.trimStart().startsWith("enc:v1:"), "Enter an API key, not ciphertext");

/**
 * A named connection: everything that belongs to the upstream service, stored once and shared by its models. The key
 * never leaves the runtime in clear text and is written as a masked value on reads.
 */
const connectionFields = {
  provider: modelProviderSchema,
  apiBase: runtimeHttpUrlSchema.optional(),
  extraHeaders: z.record(literalValueSchema).optional(),
};
export const modelConnectionWriteSchema = z.object({ ...connectionFields, apiKey: modelApiKeyWriteSchema }).strict();
export const modelConnectionSchema = z.object({
  ...connectionFields,
  apiKey: z.string().refine(isMaskedSecret, "Model reads must contain masked keys"),
}).strict();
export type ModelConnectionWrite = z.input<typeof modelConnectionWriteSchema>;
export type ModelConnection = z.output<typeof modelConnectionSchema>;

const modelFields = {
  /** The connection this model calls through; the key is the connection it references. */
  connection: modelConnectionNameSchema,
  /** The upstream's own model name, sent after the provider prefix. */
  model: z.string().trim().min(1),
  contextWindow: z.number().int().positive().optional(),
  /** Unset sends no output limit, leaving the upstream's own default. */
  maxOutputTokens: z.number().int().positive().optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  supportsVision: z.boolean().optional(),
  supportsReasoning: z.boolean().optional(),
};
export const modelEntrySchema = z.discriminatedUnion("type", [
  z.object({ ...modelFields, type: z.literal("chat") }).strict(),
  z.object({ ...modelFields, type: z.literal("embedding"), dimensions: z.number().int().positive() }).strict(),
]);
export type ModelEntry = z.output<typeof modelEntrySchema>;
export type ModelEntryChat = Extract<ModelEntry, { type: "chat" }>;
export type ModelEntryEmbedding = Extract<ModelEntry, { type: "embedding" }>;

const defaults = {
  defaultModel: modelNameSchema.nullable(),
  embeddingModel: modelNameSchema.nullable(),
};

function checkModels(settings: {
  connections: Record<string, { provider: ModelProvider }>;
  models: Record<string, ModelEntry>;
  defaultModel: string | null;
  embeddingModel: string | null;
}, ctx: z.RefinementCtx) {
  for (const [name, model] of Object.entries(settings.models)) {
    const connection = settings.connections[model.connection];
    if (!connection) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["models", name, "connection"],
        message: "A model must reference a configured connection" });
      continue;
    }
    if (model.type === "embedding" && !supportsEmbeddings(connection.provider))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["models", name, "type"],
        message: "This provider serves no embeddings" });
  }
  for (const [field, type] of [["defaultModel", "chat"], ["embeddingModel", "embedding"]] as const) {
    const name = settings[field];
    if (name === null) continue;
    const model = settings.models[name];
    if (!model || model.type !== type)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field],
        message: `Selection must reference a configured ${type} model` });
  }
}

export const modelSettingsWriteSchema = z.object({
  connections: z.record(modelConnectionNameSchema, modelConnectionWriteSchema),
  models: z.record(modelNameSchema, modelEntrySchema),
  ...defaults,
}).strict().superRefine(checkModels);
export type ModelSettingsWrite = z.input<typeof modelSettingsWriteSchema>;
export const modelSettingsConfigurationSchema = z.object({
  connections: z.record(modelConnectionNameSchema, modelConnectionWriteSchema),
  models: z.record(modelNameSchema, modelEntrySchema),
  ...defaults,
}).strict();
export const modelSettingsSchema = z.object({
  connections: z.record(modelConnectionNameSchema, modelConnectionSchema),
  models: z.record(modelNameSchema, modelEntrySchema),
  ...defaults,
}).strict();
export type ModelSettingsData = z.output<typeof modelSettingsSchema>;

export type ModelSettingsConfiguration = z.output<typeof modelSettingsConfigurationSchema>;

/** Null follows the domain chat default; an explicit missing reference never falls back. */
export const modelSelectionSchema = z.object({
  modelId: modelNameSchema.nullish().transform(value => value ?? null),
}).strict();
export type ModelSelection = z.output<typeof modelSelectionSchema>;

const optionFields = { name: modelNameSchema };
export const modelOptionSchema = z.discriminatedUnion("type", [
  z.object({ ...optionFields, type: z.literal("chat") }).strict(),
  z.object({ ...optionFields, type: z.literal("embedding"), dimensions: z.number().int().positive() }).strict(),
]);
export type ModelOption = z.output<typeof modelOptionSchema>;
export const modelOptionsSchema = z.object({
  models: z.array(modelOptionSchema), defaultModel: modelNameSchema.nullable(), embeddingModel: modelNameSchema.nullable(),
}).strict();
export type ModelOptions = z.output<typeof modelOptionsSchema>;

/** The ontology host owns its agent catalog and selections, outside runtime model settings. */
export const ontologyAgentModelSchema = z.object({
  id: z.string().uuid(), kind: z.string().min(1), name: z.string().min(1), modelSelection: modelSelectionSchema,
}).strict();
export const ontologyAgentModelsSchema = z.object({ agents: z.array(ontologyAgentModelSchema) }).strict();
export const ontologyAgentModelWriteSchema = z.object({ modelSelection: modelSelectionSchema }).strict();
export type OntologyAgentModel = z.output<typeof ontologyAgentModelSchema>;
export type OntologyAgentModels = z.output<typeof ontologyAgentModelsSchema>;
export type OntologyAgentModelWrite = z.input<typeof ontologyAgentModelWriteSchema>;
