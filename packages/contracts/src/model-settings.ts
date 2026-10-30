import { z } from "zod";

export const MODEL_ROLES = ["query", "coding", "general", "diagnosis", "knowledgeGovernance"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
export const SECRET_MASK_PREFIX = "******";
export function isMaskedSecret(value: string | null | undefined): boolean {
  return !!value && value.startsWith(SECRET_MASK_PREFIX);
}
export function maskModelKey(value: string): string {
  return value ? SECRET_MASK_PREFIX + (value.length > 8 ? value.slice(-4) : "") : value;
}
const optional = <T extends z.ZodTypeAny>(schema: T) => schema.nullish().transform(value => value ?? undefined);

/** One provider parameter definition for saved models and unsaved connection tests. */
export const modelConfigurationSchema = z.object({
  name: z.string(),
  baseUrl: z.string().url().refine(value => /^https?:/.test(value), "HTTP(S) URL required"),
  modelName: z.string().trim().min(1),
  maxTokens: z.number().int().positive().nullish().transform(value => value ?? 50000),
  contextWindow: z.number().int().positive().nullish().transform(value => value ?? 256000),
  timeout: optional(z.string().refine(value => {
    try { return parseIsoDurationSeconds(value) > 0; } catch { return false; }
  }, "Positive ISO-8601 duration required")),
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
  strictJsonSchema: optional(z.boolean()),
  seed: optional(z.number().int()),
  user: optional(z.string()),
  parallelToolCalls: optional(z.boolean()),
  store: optional(z.boolean()),
  metadata: optional(z.record(z.string())),
  serviceTier: optional(z.string()),
  reasoningEffort: optional(z.string()),
  logRequests: optional(z.boolean()),
  logResponses: optional(z.boolean()),
  supportedCapabilities: optional(z.array(z.string())),
});

export const modelEntrySchema = modelConfigurationSchema.extend({
  displayName: z.string().nullish().transform(value => value ?? ""),
  apiKeys: z.array(z.string()).default([]),
}).transform(model => ({ ...model, displayName: model.displayName.trim() || model.name }));
export type BackendModelConfig = z.output<typeof modelEntrySchema>;
export type ModelEntryInput = z.input<typeof modelEntrySchema>;
const roleReference = z.string().trim().nullable().transform(value => value || null);
const roles = { query: roleReference, coding: roleReference, general: roleReference,
  diagnosis: roleReference, knowledgeGovernance: roleReference };
export const modelRoleReferencesSchema = z.object(roles).strict();
export const modelAgentsSchema = z.object({
  query: z.object({ model: roleReference }).strict(), coding: z.object({ model: roleReference }).strict(),
  general: z.object({ model: roleReference }).strict(), diagnosis: z.object({ model: roleReference }).strict(),
  knowledgeGovernance: z.object({ model: roleReference }).strict(),
}).strict();
export type BackendAgentConfig = { model: string | null };
export const modelSettingsWriteSchema = z.object({
  models: z.array(modelEntrySchema), agents: modelRoleReferencesSchema,
}).strict().superRefine(({ models, agents }, ctx) => {
  const ids = new Set<string>();
  for (const model of models) {
    if (!model.name.trim() || ids.has(model.name))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Model IDs must be nonempty and unique" });
    ids.add(model.name);
    if (!model.apiKeys.some(key => key.trim()))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each model requires an API key" });
  }
  if (Object.values(agents).some(id => id !== null && !ids.has(id)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Role references a missing model" });
});
export type ModelSettingsWrite = z.input<typeof modelSettingsWriteSchema>;
export const modelSettingsSchema = z.object({
  models: z.array(modelEntrySchema.refine(model => model.apiKeys.every(key => key === "" || isMaskedSecret(key)), "Model reads must contain masked keys")),
  agents: modelAgentsSchema,
});
export type ModelSettingsData = z.output<typeof modelSettingsSchema>;

/**
 * Parses an ISO-8601 duration string (time part, e.g. PT5M, PT300S, PT1H30M, PT0.5S) into seconds.
 * Throws an error for invalid format.
 */
export function parseIsoDurationSeconds(isoDuration: string): number {
  if (typeof isoDuration !== "string" || !isoDuration.trim()) {
    throw new Error(`Invalid ISO-8601 duration: "${isoDuration}"`);
  }
  const trimmed = isoDuration.trim();
  const match = trimmed.match(
    /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/
  );
  if (
    !match ||
    (match[1] === undefined && match[2] === undefined && match[3] === undefined)
  ) {
    throw new Error(`Invalid ISO-8601 duration: "${isoDuration}"`);
  }
  const hours = match[1] ? parseFloat(match[1]) : 0;
  const minutes = match[2] ? parseFloat(match[2]) : 0;
  const seconds = match[3] ? parseFloat(match[3]) : 0;

  return hours * 3600 + minutes * 60 + seconds;
}

