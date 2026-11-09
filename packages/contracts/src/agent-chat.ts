import { z } from "zod";

/** One tool call shown in a chat transcript; the id is the Harness tool-call id. */
export const agentChatToolSegmentSchema = z.object({
  type: z.literal("tool_call"),
  toolCallId: z.string(),
  tool: z.string(),
  args: z.string(),
  result: z.unknown().optional(),
  isError: z.boolean().optional(),
  status: z.enum(["running", "done"]),
});

export const agentChatSegmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("thinking"), content: z.string() }),
  agentChatToolSegmentSchema,
]);

/** Display projection of Harness messages shared by history snapshots and live tails. */
export const agentChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  segments: z.array(agentChatSegmentSchema).optional(),
});

export type AgentChatMessage = z.infer<typeof agentChatMessageSchema>;

export type AgentResponseTerminalStatus = "completed" | "failed" | "cancelled";

/** Events of one server-owned response, replayable by sequence id. */
export const agentResponseEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response_started"), message: z.string() }),
  z.object({ type: z.literal("token"), content: z.string() }),
  z.object({ type: z.literal("thinking"), content: z.string() }),
  z.object({
    type: z.literal("tool_start"),
    toolCallId: z.string(),
    tool: z.string(),
    args: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal("tool_end"),
    toolCallId: z.string(),
    tool: z.string(),
    result: z.unknown(),
    isError: z.boolean(),
  }),
  z.object({ type: z.literal("response_end"), status: z.enum(["completed", "cancelled"]) }),
  z.object({ type: z.literal("response_unavailable") }),
  z.object({ type: z.literal("error"), error: z.string(), timestamp: z.number() }),
]);

export type AgentResponseEvent = z.infer<typeof agentResponseEventSchema>;
