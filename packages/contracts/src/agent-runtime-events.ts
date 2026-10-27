import { z } from "zod";
import {
  runtimeAssistantStreamEventSchema,
  runtimeImageSchema, runtimeMessageSchema, runtimeSettledMessageSchema, runtimeTextSchema,
  runtimeToolResultMessageSchema,
} from "./agent-runtime-messages";
import {
  runtimeFailureSchema, runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema,
  runtimeKeySchema, runtimeSequenceSchema, runtimeTerminalStatusSchema, runtimeTimestampSchema,
} from "./agent-runtime-values";

/** Also stored in the PI toolResult message's details, so live and history reference the same IDs. */
export const runtimeToolResultDetailsSchema = z.object({
  artifactIds: z.array(runtimeIdSchema), data: runtimeJsonValueSchema.optional(),
}).strict();
export const runtimeToolResultSchema = z.object({
  content: z.array(z.union([runtimeTextSchema, runtimeImageSchema])), details: runtimeToolResultDetailsSchema,
}).strict();

/** PI lifecycle names with stable message identities and an explicit persisted terminal status. */
export const runtimeAgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent_start") }).strict(),
  z.object({
    type: z.literal("agent_end"), messages: z.array(runtimeSettledMessageSchema),
    status: runtimeTerminalStatusSchema, error: runtimeFailureSchema.nullable(),
  }).strict(),
  z.object({ type: z.literal("turn_start"), turnIndex: runtimeSequenceSchema }).strict(),
  z.object({
    type: z.literal("turn_end"), turnIndex: runtimeSequenceSchema,
    message: runtimeSettledMessageSchema, toolResults: z.array(runtimeToolResultMessageSchema),
  }).strict(),
  z.object({
    type: z.literal("message_start"), messageId: runtimeIdSchema, message: runtimeMessageSchema,
  }).strict(),
  z.object({
    type: z.literal("message_update"), messageId: runtimeIdSchema,
    assistantMessageEvent: runtimeAssistantStreamEventSchema,
  }).strict(),
  z.object({
    type: z.literal("message_end"), messageId: runtimeIdSchema,
    messageSeq: runtimeSequenceSchema, message: runtimeSettledMessageSchema,
  }).strict(),
  z.object({
    type: z.literal("tool_execution_start"), toolCallId: runtimeKeySchema,
    toolName: runtimeKeySchema, args: runtimeJsonObjectSchema,
  }).strict(),
  z.object({
    type: z.literal("tool_execution_update"), toolCallId: runtimeKeySchema,
    toolName: runtimeKeySchema, args: runtimeJsonObjectSchema,
    partialResult: z.object({ text: z.string(), data: runtimeJsonValueSchema.optional() }).strict(),
  }).strict(),
  z.object({
    type: z.literal("tool_execution_end"), toolCallId: runtimeKeySchema,
    toolName: runtimeKeySchema, result: runtimeToolResultSchema, isError: z.boolean(),
    durationMs: z.number().nonnegative().finite().optional(),
  }).strict(),
]);

/** seq is run-local and monotonic, not contiguous. Never substitute a session messageSeq. */
export const runtimeCursorSchema = z.object({
  runId: runtimeIdSchema, seq: runtimeSequenceSchema,
  // Changes when volatile replay state is lost, including a runtime restart.
  streamId: runtimeIdSchema,
}).strict();
export const runtimeEventEnvelopeSchema = z.object({
  sessionId: runtimeIdSchema, cursor: runtimeCursorSchema,
  timestamp: runtimeTimestampSchema, event: runtimeAgentEventSchema,
}).strict();

/** Stream control is not an agent event and does not consume an event sequence. */
export const runtimeSnapshotRequiredSchema = z.object({
  type: z.literal("snapshot_required"), runId: runtimeIdSchema,
  reason: z.enum(["buffer_lost", "stream_replaced"]),
}).strict();
export const runtimeStreamFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), envelope: runtimeEventEnvelopeSchema }).strict(),
  runtimeSnapshotRequiredSchema,
]);

/** Stable tool state included in snapshots, even when progress deltas are unavailable. */
export const runtimeToolExecutionSchema = z.object({
  toolCallId: runtimeKeySchema, toolName: runtimeKeySchema, args: runtimeJsonObjectSchema,
  status: z.enum(["running", "completed", "failed", "unknown"]),
  result: runtimeToolResultSchema.nullable(),
}).strict();

export type RuntimeAgentEvent = z.infer<typeof runtimeAgentEventSchema>;
export type RuntimeEventEnvelope = z.infer<typeof runtimeEventEnvelopeSchema>;
export type RuntimeCursor = z.infer<typeof runtimeCursorSchema>;
export type RuntimeStreamFrame = z.infer<typeof runtimeStreamFrameSchema>;
