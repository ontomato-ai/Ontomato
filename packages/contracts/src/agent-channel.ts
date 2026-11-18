import { retrievalExtensionSchema,agentQualityProjectionSchema,agentFileSchema } from "./agent-task-results";
import { z } from "zod";
import { runtimeIdSchema as id, runtimeKeySchema as key, runtimeJsonObjectSchema, runtimeTimestampSchema } from "./agent-runtime-values";

export const agentRefSchema = z.object({ providerId: key, agentId: key }).strict();
export const agentSessionRefSchema = z.object({ providerId: key, sessionId: id }).strict();
/** Identity is restored by the platform; a model never supplies identity or credentials. */
export const agentActorRefSchema = z.object({ id, domainId: key }).strict();
/** Trusted human delivery context; actor.id is an opaque host caller reference, never an executor. */
export const agentUserRecipientSchema = z.object({ session: agentSessionRefSchema, actor: agentActorRefSchema }).strict();
export type AgentUserRecipient = z.infer<typeof agentUserRecipientSchema>;
export const agentExecutionActorRefSchema = z.object({ userId: key, domainId: key }).strict();
export type AgentExecutionActorRef = z.infer<typeof agentExecutionActorRefSchema>;
export const agentCallerAdmissionSchema = z.object({ id, deadlineAt: runtimeTimestampSchema }).strict();
export const agentCallerResolveSchema = z.object({ actor: agentActorRefSchema, readOnly: z.boolean().optional() }).strict();
export const agentCallerIdentitySchema = z.object({ userId: key, domainId: key, expiresAt: z.number() }).strict();
/** Private admission transport only; never part of a message, intent, binding or run snapshot. */
export const agentCredentialSchema = z.object({ token: z.string().nullable(), apiKey: z.string().nullable() }).strict();
export type AgentCredential = z.infer<typeof agentCredentialSchema>;
export const agentSteerPreparationSchema = z.object({ accepted: z.literal(true), context: z.string().optional() }).strict();
export const agentProviderAcknowledgementSchema = z.object({ accepted: z.literal(true) }).strict();
export const agentExecutionRefSchema = z.object({ session: agentSessionRefSchema, runId: id }).strict();
export const agentMessageSourceSchema = z.union([agentExecutionRefSchema,z.object({ kind: z.enum(["external", "user"]) }).strict()]);
export const agentQuestionOptionSchema = z.object({ label: key, description: z.string().optional(), isDefault: z.boolean().optional() }).strict();
export const agentQuestionOptionsSchema = z.array(agentQuestionOptionSchema).min(1).refine(options => options.filter(option => option.isDefault).length === 1, "Exactly one option must be the default");
export const agentPendingQuestionSchema = z.object({ requestId: id, source: agentExecutionRefSchema, message: z.string(), defaultAssumption: z.string(), options: agentQuestionOptionsSchema.optional() }).strict();
export const agentInputDeliverySchema = z.object({ messageId: id, sessionRef: agentSessionRefSchema, runId: id, delivery: z.enum(["steer", "run", "receipt"]), status: z.enum(["starting", "running", "completed"]) }).strict();
export const agentNotificationSchema = z.object({
  role: z.literal("notification"),
  kind: z.enum(["agent-message", "agent-result", "agent-question", "agent-answer"]),
  source: agentMessageSourceSchema,
  replyTo: id.optional(),
  /** Explicit human delivery; ordinary agent questions keep their existing route. */
  recipient: z.literal("user").optional(),
  selectedOption: z.number().int().nonnegative().optional(),
  /** Set by the authenticated human host, never by the model or browser body. */
  respondent: agentActorRefSchema.optional(),
  /** Original receipt identity when a human answer is forwarded to the questioning session. */
  answerId: id.optional(),
  defaultAssumption: z.string().optional(), options: agentQuestionOptionsSchema.optional(),
  outcome: z.enum(["completed", "failed", "cancelled"]).optional(),
  content: z.string(), timestamp: z.number().int().nonnegative(),
}).strict();
export const agentInputSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("user"), content: z.string().min(1), timestamp: z.number().int().nonnegative() }).strict(),
  agentNotificationSchema,
]);
export const agentProviderListRequestSchema = z.object({ providerId: key, actor: agentActorRefSchema, executionActor: agentExecutionActorRefSchema.nullable().optional(), language: key }).strict();
export const agentDirectoryEntrySchema = z.object({
  ref: agentRefSchema, name: key, description: z.string(),
  contextSchema: runtimeJsonObjectSchema.optional(),
}).strict();
export const agentDirectorySchema = z.object({ agents: z.array(agentDirectoryEntrySchema) }).strict();
export const agentAuthoritySchema = z.object({ classNames: z.array(key), executionKind: z.enum(["live", "build-test"]), executionContextId: key.optional() }).strict();
export const agentRunContextSchema = z.object({
  agent: agentRefSchema, actor: agentActorRefSchema,
  authority: agentAuthoritySchema,
  requestedBy: agentExecutionRefSchema.nullable(), root: agentExecutionRefSchema,
  /** Human hosts set this; children inherit it. Older/background/external roots have none. */
  userRecipient: agentUserRecipientSchema.nullable().optional(),
}).strict();
export const agentPrepareRequestSchema = z.object({
  mode: z.enum(["run", "steer"]), language: key,
  agent: agentRefSchema, sessionId: id, runId: id, actor: agentActorRefSchema,
  executionActor: agentExecutionActorRefSchema.nullable().optional(),
  inputId: id, input: agentInputSchema, authority: agentAuthoritySchema, requestedBy: agentExecutionRefSchema.nullable(), root: agentExecutionRefSchema,
  /** Human hosts set this; children inherit it. Older/background/external roots have none. */
  userRecipient: agentUserRecipientSchema.nullable().optional(), context: runtimeJsonObjectSchema.optional(),
}).strict();
export const agentProviderExecutionSchema = z.object({ execution: agentExecutionRefSchema, actor: agentActorRefSchema, executionActor: agentExecutionActorRefSchema.nullable().optional(), fileId: id.optional() }).strict();
export const agentDeliverySchema = z.object({
  /** All host-owned attachments have settled; independent from this execution's status. */
  settled: z.boolean(),
  status: z.enum(["starting", "running", "completed", "failed", "cancelled"]), summary: z.string(),
  process: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("inline"), runtimeSessionId: id, runtimeRunId: id }).strict(),
    z.object({ mode: z.literal("page"), href: key }).strict(),
    z.object({ mode: z.literal("none") }).strict(),
  ]),
  results: z.array(z.object({ kind: key, href: key, title: z.string() }).strict()),
  retrieval: retrievalExtensionSchema.optional(),quality: z.array(agentQualityProjectionSchema),files: z.array(agentFileSchema),
}).strict();
export const agentChannelCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("list"), query: z.string().optional() }).strict(),
  z.object({ op: z.literal("start"), agent: agentRefSchema, message: z.string().min(1), title: z.string().optional(), context: runtimeJsonObjectSchema.optional() }).strict(),
  z.object({ op: z.literal("send"), session: z.union([agentSessionRefSchema,z.literal("parent")]), message: z.string().min(1), steer: z.boolean().optional(), needsInput: z.boolean().optional(), replyTo: id.optional(),
  /** Explicit human delivery; ordinary agent questions keep their existing route. */
  recipient: z.literal("user").optional(),
  selectedOption: z.number().int().nonnegative().optional(),
  /** Set by the authenticated human host, never by the model or browser body. */
  respondent: agentActorRefSchema.optional(),
  /** Original receipt identity when a human answer is forwarded to the questioning session. */
  answerId: id.optional(),
  defaultAssumption: z.string().min(1).optional(), options: agentQuestionOptionsSchema.optional() }).strict(),
  z.object({ op: z.literal("read"), taskId: id, files: z.boolean().optional(), view: z.enum(["result", "messages"]).optional(), cursor: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(100).optional() }).strict(),
  z.object({ op: z.literal("cancel"), taskId: id }).strict(),
]).superRefine((command,ctx) => {
  if (command.op !== "send") return;
  if (command.needsInput && !command.defaultAssumption) ctx.addIssue({ code: z.ZodIssueCode.custom,path: ["defaultAssumption"],message: "A question requires its default assumption" });
  if (command.options && !command.needsInput) ctx.addIssue({ code: z.ZodIssueCode.custom,path: ["options"],message: "Options belong to a question" });
  if (command.needsInput && command.replyTo) ctx.addIssue({ code: z.ZodIssueCode.custom,path: ["replyTo"],message: "A question cannot also be an answer" });
});
/** A preparing intent occupies the session before a host callback starts. It is not a running run. */
export const agentRunIntentSchema = z.object({
  id, session: agentSessionRefSchema, channel: agentRunContextSchema, language: key,
  inputId: id, context: runtimeJsonObjectSchema.optional(), title: z.string().optional(),
  status: z.enum(["starting", "running", "completed", "failed", "cancelled"]),
  executionUserId: key.nullable().optional(),
  createdAt: runtimeTimestampSchema, error: z.string().nullable(), cancelled: z.boolean(), cancelMode: z.literal("model").optional(),
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

export type AgentInputDelivery = z.infer<typeof agentInputDeliverySchema>;
export type AgentPendingQuestion = z.infer<typeof agentPendingQuestionSchema>;
