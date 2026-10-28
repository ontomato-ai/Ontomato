import { z } from "zod";
import {
  runtimeJsonObjectSchema,
  runtimeJsonValueSchema,
  runtimeKeySchema,
  runtimeSequenceSchema,
} from "./agent-runtime-values";

/** PI 1.4 conversation wire profile. Provider extensions are admitted explicitly. */
export const runtimeTextSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    textSignature: z.string().optional(),
  })
  .strict();
export const runtimeImageSchema = z
  .object({
    type: z.literal("image"),
    data: z.string(),
    mimeType: runtimeKeySchema,
  })
  .strict();
export const runtimeThinkingSchema = z
  .object({
    type: z.literal("thinking"),
    thinking: z.string(),
    thinkingSignature: z.string().optional(),
    redacted: z.boolean().optional(),
  })
  .strict();
export const runtimeToolCallSchema = z
  .object({
    type: z.literal("toolCall"),
    id: runtimeKeySchema,
    name: runtimeKeySchema,
    arguments: runtimeJsonObjectSchema,
    thoughtSignature: z.string().optional(),
    namespace: z.string().optional(),
    argumentsError: z.string().optional(),
  })
  .strict();
export const runtimeUsageSchema = z
  .object({
    input: runtimeSequenceSchema,
    output: runtimeSequenceSchema,
    cacheRead: runtimeSequenceSchema,
    cacheWrite: runtimeSequenceSchema,
    cacheWrite1h: runtimeSequenceSchema.optional(),
    reasoning: runtimeSequenceSchema.optional(),
    totalTokens: runtimeSequenceSchema,
    cost: z
      .object({
        input: z.number().finite(),
        output: z.number().finite(),
        cacheRead: z.number().finite(),
        cacheWrite: z.number().finite(),
        total: z.number().finite(),
      })
      .strict(),
  })
  .strict();

/** JSON Schema, interpreted at the skill/provider boundary rather than by a business host. */
export const runtimeToolDeclarationSchema = z
  .object({
    name: runtimeKeySchema,
    description: z.string(),
    parameters: runtimeJsonObjectSchema,
  })
  .strict();
export const runtimeSystemMessageSchema = z
  .object({
    role: z.literal("system"),
    content: z.union([z.string(), z.array(runtimeTextSchema)]),
    sections: z.record(z.string().nullable()).optional(),
    toolsAdded: z.array(runtimeToolDeclarationSchema).optional(),
    toolsRemoved: z
      .array(z.object({ name: runtimeKeySchema }).strict())
      .optional(),
    timestamp: runtimeSequenceSchema,
  })
  .strict();
export const runtimeUserMessageSchema = z
  .object({
    role: z.literal("user"),
    content: z.union([
      z.string(),
      z.array(z.union([runtimeTextSchema, runtimeImageSchema])),
    ]),
    timestamp: runtimeSequenceSchema,
  })
  .strict();
export const runtimeAssistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.array(
      z.union([
        runtimeTextSchema,
        runtimeThinkingSchema,
        runtimeToolCallSchema,
      ]),
    ),
    api: runtimeKeySchema.nullable(),
    provider: runtimeKeySchema.nullable(),
    model: runtimeKeySchema.nullable(),
    origin: z.literal("runtime").optional(),
    responseModel: z.string().optional(),
    responseId: z.string().optional(),
    providerThinkingLevel: z.string().optional(),
    thinkingLevel: z
      .enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"])
      .optional(),
    usage: runtimeUsageSchema.nullable(),
    // Pending is only valid in an in-memory partial, never a settled message row.
    stopReason: z.enum([
      "pending",
      "stop",
      "length",
      "toolUse",
      "error",
      "aborted",
    ]),
    errorMessage: z.string().optional(),
    rawStopReason: z.string().optional(),
    endTurn: z.boolean().optional(),
    timestamp: runtimeSequenceSchema,
    durationMs: z.number().nonnegative().finite().optional(),
  })
  .strict();
export const runtimeToolResultMessageSchema = z
  .object({
    role: z.literal("toolResult"),
    toolCallId: runtimeKeySchema,
    toolName: runtimeKeySchema,
    content: z.array(z.union([runtimeTextSchema, runtimeImageSchema])),
    details: runtimeJsonValueSchema.optional(),
    usage: runtimeUsageSchema.optional(),
    isError: z.boolean(),
    timestamp: runtimeSequenceSchema,
    durationMs: z.number().nonnegative().finite().optional(),
  })
  .strict();
export const runtimeMessageSchema = z.discriminatedUnion("role", [
  runtimeSystemMessageSchema,
  runtimeUserMessageSchema,
  runtimeAssistantMessageSchema,
  runtimeToolResultMessageSchema,
]);
export const runtimeSettledMessageSchema = runtimeMessageSchema.refine(
  (message) => message.role !== "assistant" || message.stopReason !== "pending",
  "A persisted message must be settled",
);

/** Wire updates carry deltas only; complete partials belong to the authoritative snapshot. */
export const runtimeAssistantStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z
    .object({
      type: z.literal("text_start"),
      contentIndex: runtimeSequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("text_delta"),
      contentIndex: runtimeSequenceSchema,
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("text_end"),
      contentIndex: runtimeSequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("thinking_start"),
      contentIndex: runtimeSequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("thinking_delta"),
      contentIndex: runtimeSequenceSchema,
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("thinking_end"),
      contentIndex: runtimeSequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("toolcall_start"),
      contentIndex: runtimeSequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("toolcall_delta"),
      contentIndex: runtimeSequenceSchema,
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("toolcall_end"),
      contentIndex: runtimeSequenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("done"),
      reason: z.enum(["stop", "length", "toolUse"]),
    })
    .strict(),
  z
    .object({ type: z.literal("error"), reason: z.enum(["error", "aborted"]) })
    .strict(),
]);

export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;
export type RuntimeAssistantMessage = z.infer<
  typeof runtimeAssistantMessageSchema
>;
export type RuntimeAssistantStreamEvent = z.infer<
  typeof runtimeAssistantStreamEventSchema
>;
