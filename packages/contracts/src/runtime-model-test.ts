import { z } from "zod";

// Java emits null for unset draft fields. This is an HTTP boundary, not persisted settings.
const optional = <T extends z.ZodTypeAny>(value: T) =>
  z.preprocess((input) => input === null ? undefined : input, value.optional());

export const runtimeModelConfigurationSchema = z.object({
  name: z.string(),
  baseUrl: z.string().url(),
  modelName: z.string().min(1),
  maxTokens: z.number().int().positive(),
  contextWindow: z.number().int().positive(),
  timeout: optional(z.string()),
  maxRetries: optional(z.number().int().nonnegative()),
  temperature: optional(z.number()),
  topP: optional(z.number()),
  customRequestParameters: optional(z.record(z.unknown())),
  customHeaders: optional(z.record(z.string())),
  organizationId: optional(z.string()),
  projectId: optional(z.string()),
  stop: optional(z.array(z.string())),
  maxCompletionTokens: optional(z.number().int().positive()),
  presencePenalty: optional(z.number()),
  frequencyPenalty: optional(z.number()),
  logitBias: optional(z.record(z.number())),
  responseFormat: optional(z.string()),
  seed: optional(z.number().int()),
  user: optional(z.string()),
  parallelToolCalls: optional(z.boolean()),
  store: optional(z.boolean()),
  metadata: optional(z.record(z.string())),
  serviceTier: optional(z.string()),
  reasoningEffort: optional(z.string()),
});

export const runtimeModelTestRequestSchema = z.object({
  model: runtimeModelConfigurationSchema.extend({
    name: z.string().nullish().transform((value) => value ?? "draft"),
    apiKey: z.string(),
  }),
  prompt: z.string().min(1).default("Hello"),
}).strict();
export const runtimeModelTestResponseSchema = z.object({ content: z.string() }).strict();
export type RuntimeModelTestRequest = z.infer<typeof runtimeModelTestRequestSchema>;
