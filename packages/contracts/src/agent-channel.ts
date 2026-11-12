import { z } from "zod";
import { runtimeIdSchema as id, runtimeKeySchema as key, runtimeJsonObjectSchema, runtimeTimestampSchema } from "./agent-runtime-values";

export const agentRefSchema = z.object({ providerId: key, agentId: key }).strict();
export const agentSessionRefSchema = z.object({ providerId: key, sessionId: id }).strict();
/** Identity is restored by the platform; a model never supplies identity or credentials. */
export const agentActorRefSchema = z.object({ id, domainId: key }).strict();
export const agentCallerAdmissionSchema = z.object({ id, deadlineAt: runtimeTimestampSchema }).strict();
export const agentCallerResolveSchema = z.object({ actor: agentActorRefSchema, readOnly: z.boolean().optional() }).strict();
export const agentCallerIdentitySchema = z.object({ userId: key, domainId: key, apiKey: z.string().nullable(), expiresAt: z.number() }).strict();
export const agentProviderAcknowledgementSchema = z.object({ accepted: z.literal(true) }).strict();
export const agentExecutionRefSchema = z.object({ session: agentSessionRefSchema, runId: id }).strict();
export const agentNotificationSchema = z.object({
  role: z.literal("notification"),
  kind: z.enum(["agent-message", "agent-result", "agent-question", "agent-answer"]),
  source: agentExecutionRefSchema,
  replyTo: id.optional(), defaultAssumption: z.string().optional(),
  outcome: z.enum(["completed", "failed", "cancelled"]).optional(),
  content: z.string(), timestamp: z.number().int().nonnegative(),
}).strict();
export const agentInputSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string().min(1), timestamp: z.number().int().nonnegative() }).strict(),
  agentNotificationSchema,
]);
export const agentDirectoryEntrySchema = z.object({
  ref: agentRefSchema, name: key, description: z.string(),
  contextSchema: runtimeJsonObjectSchema.optional(),
}).strict();
export const agentDirectorySchema = z.object({ agents: z.array(agentDirectoryEntrySchema) }).strict();
export const agentAuthoritySchema = z.object({ classNames: z.array(key), executionKind: z.enum(["live", "build-test"]) }).strict();
export const agentRunContextSchema = z.object({
  agent: agentRefSchema, actor: agentActorRefSchema,
  authority: agentAuthoritySchema,
  requestedBy: agentExecutionRefSchema.nullable(), root: agentExecutionRefSchema,
}).strict();
export const agentPrepareRequestSchema = z.object({
  mode: z.enum(["run", "steer"]), language: key,
  agent: agentRefSchema, sessionId: id, runId: id, actor: agentActorRefSchema,
  input: agentInputSchema, authority: agentAuthoritySchema, context: runtimeJsonObjectSchema.optional(),
}).strict();
export const agentProviderExecutionSchema = z.object({ execution: agentExecutionRefSchema, actor: agentActorRefSchema }).strict();
export const agentDeliverySchema = z.object({
  status: z.enum(["starting", "running", "completed", "failed", "cancelled"]), summary: z.string(),
  process: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("inline"), runtimeSessionId: id, runtimeRunId: id }).strict(),
    z.object({ mode: z.literal("page"), href: key }).strict(),
    z.object({ mode: z.literal("none") }).strict(),
  ]),
  results: z.array(z.object({ kind: key, href: key, title: z.string() }).strict()),
}).strict();
export const agentChannelCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list"), query: z.string().optional() }).strict(),
  z.object({ op: z.literal("start"), agent: agentRefSchema, message: z.string().min(1), title: z.string().optional(), context: runtimeJsonObjectSchema.optional() }).strict(),
  z.object({ op: z.literal("send"), session: agentSessionRefSchema, message: z.string().min(1), kind: z.enum(["agent-message", "agent-question", "agent-answer"]).optional(), replyTo: id.optional(), defaultAssumption: z.string().optional() }).strict(),
  z.object({ op: z.literal("read"), taskId: id, view: z.enum(["result", "messages"]).optional(), cursor: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ op: z.literal("cancel"), taskId: id }).strict(),
]);
/** A preparing intent occupies the session before a host callback starts. It is not a running run. */
export const agentRunIntentSchema = z.object({
  id, session: agentSessionRefSchema, channel: agentRunContextSchema, language: key,
  inputId: id, context: runtimeJsonObjectSchema.optional(), title: z.string().optional(),
  status: z.enum(["starting", "running", "completed", "failed", "cancelled"]),
  createdAt: runtimeTimestampSchema, error: z.string().nullable(), cancelled: z.boolean(),
}).strict();
export type AgentRef = z.infer<typeof agentRefSchema>;
export type AgentSessionRef = z.infer<typeof agentSessionRefSchema>;
export type AgentActorRef = z.infer<typeof agentActorRefSchema>;
export type AgentExecutionRef = z.infer<typeof agentExecutionRefSchema>;
export type AgentNotification = z.infer<typeof agentNotificationSchema>;
export type AgentInput = z.infer<typeof agentInputSchema>;
export type AgentRunContext = z.infer<typeof agentRunContextSchema>;
export type AgentRunIntent = z.infer<typeof agentRunIntentSchema>;
export type AgentPrepareRequest = z.infer<typeof agentPrepareRequestSchema>;
export type AgentDelivery = z.infer<typeof agentDeliverySchema>;
export type AgentChannelCommand = z.infer<typeof agentChannelCommandSchema>;
