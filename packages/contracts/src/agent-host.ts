import { agentInputDeliverySchema, agentPendingQuestionSchema, agentSessionRefSchema } from "./agent-channel";
import { presentationBindingSchema, presentationFrameSchema, presentationReceiptSchema } from "./agent-presentation";
import { panelObjectIdentitySchema } from "./panel-manifest";
import { panelOperationAffectedSchema } from "./panel-operations";
import { z } from "zod";
import { pageSkillContextSchema } from "./page-skills";
import {
  runtimeMessageRecordSchema,
  runtimeRunSnapshotSchema,
  runtimeRunViewSchema,
} from "./agent-runtime";
import { sessionHistoryBoundsSchema } from "./session-history";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import {
  runtimeCursorSchema,
  runtimeSessionRunFrameSchema,
  runtimeStreamFrameSchema,
} from "./agent-runtime-events";
import {
  runtimeIdSchema,
  runtimeKeySchema,
  runtimeRunStatusSchema,
  runtimeStopReasonSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";
/** Application-neutral metadata for the shell's read-only agent selector. */
export const agentHostAgentSchema = z
  .object({
    id: runtimeIdSchema,
    name: runtimeKeySchema,
    description: z.string(),
    icon: z.string().nullable(),
    enabled: z.boolean(),
  })
  .strict();
export const agentHostAgentListSchema = z
  .object({ agents: z.array(agentHostAgentSchema) })
  .strict();
export const agentHostRunSchema = runtimeRunViewSchema;
/** A session row names its latest run without carrying the run's body: lists stay one read per page. */
export const agentHostRunStatusSchema = z
  .object({
    id: runtimeIdSchema,
    status: runtimeRunStatusSchema,
    stopReason: runtimeStopReasonSchema.nullable(),
  })
  .strict();
/** Only a shell with a display port requests a binding when it opens the stream. */
export const agentHostSessionRunEventsQuerySchema = z.object({
  viewId: presentationBindingSchema.shape.viewId.optional(),
}).strict();
/** Ready for a registered view identifies this particular connection. */
export const agentHostSessionRunFrameSchema = z.union([
  z.object({ type: z.literal("ready"), connectionId: presentationReceiptSchema.shape.connectionId }).strict(),
  runtimeSessionRunFrameSchema,
]);
const objectChangedFrame = z.object({
  type: z.literal("object-changed"),
  session: agentSessionRefSchema,
}).strict();
/** A batch or a type-only invalidation can carry the owner result without a single target. */
export const agentHostObjectChangedFrameSchema = z.union([
  objectChangedFrame.extend({ target: panelObjectIdentitySchema, affected: panelOperationAffectedSchema.optional() }),
  objectChangedFrame.extend({ target: z.null(), affected: panelOperationAffectedSchema }),
]);
/** Live frames on the same stream have their own SSE event names and no replay cursor. */
export const agentHostSessionLiveFrameSchema = z.union([
  presentationFrameSchema,
  agentHostObjectChangedFrameSchema,
]);
export const agentHostSessionStatusRequestSchema = z
  .object({ sessionIds: z.array(runtimeIdSchema) })
  .strict();
/** State is read by session ID after a notice or ready; null only means the session has no run. */
export const agentHostSessionRunSnapshotSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: runtimeIdSchema,
          latestRun: agentHostRunStatusSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const agentHostMessageSchema = runtimeMessageRecordSchema;
export const agentHostRunSnapshotSchema = z
  .object({
    run: agentHostRunSchema,
    cursor: runtimeCursorSchema,
    messages: z.array(agentHostMessageSchema),
    pendingQuestions: z.array(agentPendingQuestionSchema),
    pendingMessages: runtimeRunSnapshotSchema.shape.pendingMessages,
    toolExecutions: runtimeRunSnapshotSchema.shape.toolExecutions,
    artifacts: z.array(runtimeArtifactSchema),
  })
  .strict();
export const agentHostSessionSchema = z
  .object({
    id: runtimeIdSchema,
    agentId: runtimeIdSchema,
    title: z.string(),
    workspaceId: runtimeIdSchema.nullable().optional(),
    createdAt: runtimeTimestampSchema,
    updatedAt: runtimeTimestampSchema,
    latestRun: agentHostRunStatusSchema.nullable(),
    /** How the session was started; absent means by its user. scheduled: by one of the user's scheduled tasks. */
    origin: z.enum(["user", "scheduled", "delegated"]).optional(),
  })
  .strict();
export const agentHostSessionSnapshotSchema = z
  .object({
    session: agentHostSessionSchema,
    messages: z.array(agentHostMessageSchema),
    pendingQuestions: z.array(agentPendingQuestionSchema),
    latestRun: agentHostRunSnapshotSchema.nullable(),
  })
  .strict();
export const agentHostSessionHistorySchema = z.object({
  session: agentHostSessionSchema,
  messages: z.array(agentHostMessageSchema),
    pendingQuestions: z.array(agentPendingQuestionSchema),
  runs: z.array(agentHostRunSchema),
  latestRun: agentHostRunSnapshotSchema.nullable(),
  page: sessionHistoryBoundsSchema,
}).strict();
export type AgentHostSessionHistory = z.infer<typeof agentHostSessionHistorySchema>;
export const agentHostSessionPageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();
export type AgentHostSessionPageQuery = z.infer<typeof agentHostSessionPageQuerySchema>;
export const agentHostSessionPageSchema = z
  .object({
    sessions: z.array(agentHostSessionSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const agentHostCreateSessionSchema = z
  .object({ agentId: runtimeIdSchema, workspaceId: runtimeIdSchema.optional() })
  .strict();
export const agentHostRenameSessionSchema = z.object({ title: z.string().trim().min(1).max(200) }).strict();
export const agentHostCreateSessionResponseSchema = z
  .object({ session: agentHostSessionSchema, replayed: z.boolean() })
  .strict();
export const agentHostSendRequestSchema = z
  .object({
    message: z.string().refine((v) => v.trim().length > 0),
    replyTo: runtimeIdSchema.optional(),
    selectedOption: z.number().int().nonnegative().optional(),
    /** Only a new human run can use the binding; steering does not change the running view. */
    presentationBinding: presentationBindingSchema.optional(),
    pageSkillContext: pageSkillContextSchema.optional(),
    /** Structured variables supplied by an external workflow or integration. */
    variables: z.record(z.unknown()).optional(),
  })
  .strict().refine(value => value.selectedOption === undefined || value.replyTo !== undefined, "A selection requires replyTo");
export const agentHostSendResultSchema = z
  .object({ delivery: agentInputDeliverySchema, input: agentHostMessageSchema, snapshot: agentHostRunSnapshotSchema.nullable(), pendingQuestions: z.array(agentPendingQuestionSchema), replayed: z.boolean() })
  .strict();
export const agentHostCancelResponseSchema = z
  .object({ run: agentHostRunSchema.nullable() })
  .strict()
  .refine((v) => v.run === null || v.run.status === "stopped");
export const agentHostArtifactResolutionSchema = z
  .object({ artifact: runtimeArtifactSchema.nullable() })
  .strict();
export const agentHostErrorSchema = z
  .object({
    error: z
      .object({ code: runtimeKeySchema, message: runtimeKeySchema })
      .strict(),
    correlationId: runtimeKeySchema,
  })
  .strict();
export const agentHostStreamFrameSchema = runtimeStreamFrameSchema;
export type AgentHostAgent = z.infer<typeof agentHostAgentSchema>;
export type AgentHostAgentList = z.infer<typeof agentHostAgentListSchema>;
export type AgentHostRun = z.infer<typeof agentHostRunSchema>;
export type AgentHostRunStatus = z.infer<typeof agentHostRunStatusSchema>;
export type AgentHostSessionRunFrame = z.infer<typeof agentHostSessionRunFrameSchema>;
export type AgentHostObjectChangedFrame = z.infer<typeof agentHostObjectChangedFrameSchema>;
export type AgentHostSessionLiveFrame = z.infer<typeof agentHostSessionLiveFrameSchema>;
export type AgentHostSessionStatusRequest = z.infer<
  typeof agentHostSessionStatusRequestSchema
>;
export type AgentHostSessionRunSnapshot = z.infer<
  typeof agentHostSessionRunSnapshotSchema
>;
export type AgentHostMessage = z.infer<typeof agentHostMessageSchema>;
export type AgentHostRunSnapshot = z.infer<typeof agentHostRunSnapshotSchema>;
export type AgentHostSession = z.infer<typeof agentHostSessionSchema>;
export type AgentHostSessionSnapshot = z.infer<
  typeof agentHostSessionSnapshotSchema
>;
export type AgentHostSessionPage = z.infer<typeof agentHostSessionPageSchema>;
export type AgentHostCreateSession = z.infer<
  typeof agentHostCreateSessionSchema
>;
export type AgentHostCreateSessionResponse = z.infer<
  typeof agentHostCreateSessionResponseSchema
>;
export type AgentHostSendRequest = z.infer<typeof agentHostSendRequestSchema>;
export type AgentHostSendResult = z.infer<typeof agentHostSendResultSchema>;
export type AgentHostCancelResponse = z.infer<
  typeof agentHostCancelResponseSchema
>;
export type AgentHostArtifactResolution = z.infer<
  typeof agentHostArtifactResolutionSchema
>;
export type AgentHostError = z.infer<typeof agentHostErrorSchema>;
export type AgentHostStreamFrame = z.infer<typeof agentHostStreamFrameSchema>;
