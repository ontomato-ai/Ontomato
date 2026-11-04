import { z } from "zod";
import { runtimeHttpUrlSchema, runtimeJsonObjectSchema } from "./agent-runtime-values";

export const SECRET_MASK_PREFIX = "******";
export function isMaskedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith(SECRET_MASK_PREFIX);
}
export function maskModelKey(value: string): string {
  return value ? SECRET_MASK_PREFIX + (value.length > 8 ? value.slice(-4) : "") : value;
}

export const modelProviderIdSchema = z.string().min(1).regex(/^[^/\s]+$/);
export const modelIdSchema = z.string().trim().min(1);
/** Split only at the first slash: provider model IDs may themselves contain slashes. */
export const modelReferenceSchema = z.string().trim().refine(value => {
  const slash = value.indexOf("/");
  return slash > 0 && modelProviderIdSchema.safeParse(value.slice(0, slash)).success
    && modelIdSchema.safeParse(value.slice(slash + 1)).success
    && value.slice(slash + 1) === value.slice(slash + 1).trim();
}, "Expected provider/model-id");
export type ModelReference = z.output<typeof modelReferenceSchema>;

/** Custom APIs supported with a base URL and a literal API key. */
export const modelApiSchema = z.enum([
  "openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai",
]);
export type ModelApi = z.output<typeof modelApiSchema>;
export const modelTypeSchema = z.enum(["chat", "embedding"]);

/** pi's values for chat model fields that are left out of an entry. */
export const PI_CHAT_MODEL_DEFAULTS = { contextWindow: 128000, maxTokens: 16384 } as const;

const modelFields = {
  id: modelIdSchema,
  name: z.string().trim().min(1).optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(["text", "image"])).nonempty().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  samplingParams: runtimeJsonObjectSchema.optional(),
};
export const modelEntrySchema = z.discriminatedUnion("type", [
  z.object({ ...modelFields, type: z.literal("chat") }).strict(),
  z.object({ ...modelFields, type: z.literal("embedding"), dimensions: z.number().int().positive() }).strict(),
]);
export type ModelEntry = z.output<typeof modelEntrySchema>;
export type ModelEntryInput = z.input<typeof modelEntrySchema>;

/** Configuration values are literals, never pi environment interpolation or commands. */
const literalValueSchema = z.string().refine(value =>
  !/^[!$]/.test(value.trimStart()) && !/\$(?:\{|[A-Za-z_])/.test(value),
"Environment interpolation and commands are not supported");
export const modelApiKeyWriteSchema = literalValueSchema
  .refine(value => value.trim().length > 0, "An API key is required")
  .refine(value => !value.trimStart().startsWith("enc:v1:"), "Enter an API key, not ciphertext");
const providerFields = {
  name: z.string().trim().min(1).optional(),
  baseUrl: runtimeHttpUrlSchema,
  api: modelApiSchema,
  headers: z.record(literalValueSchema).optional(),
};
/** Draft credentials can retain a saved key only under the same domain and provider ID. */
export const modelProviderConnectionSchema = z.object({
  ...providerFields, apiKey: modelApiKeyWriteSchema,
}).strict();
export function supportsEmbeddings(api: ModelApi): boolean {
  return api === "openai-completions" || api === "openai-responses";
}
const uniqueModels = (provider: { api: ModelApi; models: ModelEntry[] }, ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  provider.models.forEach((model, index) => {
    if (seen.has(model.id)) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ["models", index, "id"], message: "Model IDs must be unique within a provider" });
    seen.add(model.id);
    if (model.type === "embedding" && !supportsEmbeddings(provider.api))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["models", index, "type"],
        message: "Embedding models require an OpenAI-compatible provider" });
  });
};
export const modelProviderWriteSchema = modelProviderConnectionSchema.extend({
  models: z.array(modelEntrySchema),
}).superRefine(uniqueModels);
export const modelProviderSchema = z.object({
  ...providerFields,
  apiKey: z.string().refine(isMaskedSecret, "Model reads must contain masked keys"),
  models: z.array(modelEntrySchema),
}).strict().superRefine(uniqueModels);
export type ModelProviderWrite = z.input<typeof modelProviderWriteSchema>;
export type ModelProvider = z.output<typeof modelProviderSchema>;

/** Provider-level settings from pi settings.json, shared by all calls in one domain. */
export const modelRetrySchema = z.object({
  provider: z.object({
    timeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().nonnegative(),
    maxRetryDelayMs: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type ModelRetry = z.output<typeof modelRetrySchema>;
const defaults = {
  defaultModelId: modelReferenceSchema.nullable(),
  embeddingModelId: modelReferenceSchema.nullable(),
};
export const modelSettingsConfigurationSchema = z.object({
  providers: z.record(modelProviderIdSchema, modelProviderWriteSchema),
  ...defaults,
  retry: modelRetrySchema,
}).strict();
/** Provider IDs that prefix unavailable legacy model references; no configured provider may use them. */
/** Prefix of migrated references whose model no longer exists; no provider may take it, so they stay unavailable. */
export const UNCONFIGURED_MODEL_PROVIDER_ID = "legacy";
export const RESERVED_MODEL_PROVIDER_IDS: readonly string[] = [UNCONFIGURED_MODEL_PROVIDER_ID];
export const modelSettingsWriteSchema = modelSettingsConfigurationSchema.superRefine((settings, ctx) => {
  for (const id of Object.keys(settings.providers)) {
    if (RESERVED_MODEL_PROVIDER_IDS.includes(id)) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ["providers", id], message: "Provider ID is reserved for unavailable legacy model references" });
  }
  for (const [field, type] of [["defaultModelId", "chat"], ["embeddingModelId", "embedding"]] as const) {
    const ref = settings[field];
    if (ref === null) continue;
    const slash = ref.indexOf("/");
    const model = settings.providers[ref.slice(0, slash)]?.models.find(item => item.id === ref.slice(slash + 1));
    if (!model || model.type !== type) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: [field], message: `Selection must reference a configured ${type} model` });
  }
});
export type ModelSettingsWrite = z.input<typeof modelSettingsWriteSchema>;
export const modelSettingsSchema = z.object({
  providers: z.record(modelProviderIdSchema, modelProviderSchema),
  ...defaults,
  retry: modelRetrySchema,
}).strict();
export type ModelSettingsData = z.output<typeof modelSettingsSchema>;

/** Null follows the domain chat default; an explicit missing reference never falls back. */
export const modelSelectionSchema = z.object({
  modelId: modelReferenceSchema.nullish().transform(value => value ?? null),
}).strict();
export type ModelSelection = z.output<typeof modelSelectionSchema>;
const optionFields = { ref: modelReferenceSchema, name: z.string().min(1) };
export const modelOptionSchema = z.discriminatedUnion("type", [
  z.object({ ...optionFields, type: z.literal("chat") }).strict(),
  z.object({ ...optionFields, type: z.literal("embedding"), dimensions: z.number().int().positive() }).strict(),
]);
export type ModelOption = z.output<typeof modelOptionSchema>;
export const modelOptionsSchema = z.object({ models: z.array(modelOptionSchema), ...defaults }).strict();
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
