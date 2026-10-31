import { z } from "zod";
import {
  runtimeMessageRecordSchema,
  runtimeRunSnapshotSchema,
  runtimeRunViewSchema,
} from "./agent-runtime";
import { sessionHistoryBoundsSchema } from "./session-history";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import {
  runtimeCursorSchema,
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
export const agentHostRunSchema = runtimeRunViewSchema
  .extend({
    retrievals: z
      .array(
        z
          .object({
            retrievalId: runtimeIdSchema,
            runId: runtimeIdSchema,
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
/** A session row names its latest run without carrying the run's body: lists stay one read per page. */
export const agentHostRunStatusSchema = z
  .object({
    id: runtimeIdSchema,
    status: runtimeRunStatusSchema,
    stopReason: runtimeStopReasonSchema.nullable(),
  })
  .strict();
export const agentHostMessageSchema = runtimeMessageRecordSchema;
export const agentHostRunSnapshotSchema = z
  .object({
    run: agentHostRunSchema,
    cursor: runtimeCursorSchema,
    messages: z.array(agentHostMessageSchema),
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
    createdAt: runtimeTimestampSchema,
    updatedAt: runtimeTimestampSchema,
    latestRun: agentHostRunStatusSchema.nullable(),
  })
  .strict();
export const agentHostSessionSnapshotSchema = z
  .object({
    session: agentHostSessionSchema,
    messages: z.array(agentHostMessageSchema),
    latestRun: agentHostRunSnapshotSchema.nullable(),
  })
  .strict();
export const agentHostSessionHistorySchema = z.object({
  session: agentHostSessionSchema,
  messages: z.array(agentHostMessageSchema),
  runs: z.array(agentHostRunSchema),
  latestRun: agentHostRunSnapshotSchema.nullable(),
  page: sessionHistoryBoundsSchema,
}).strict();
export type AgentHostSessionHistory = z.infer<typeof agentHostSessionHistorySchema>;
export const agentHostSessionPageSchema = z
  .object({
    sessions: z.array(agentHostSessionSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const agentHostCreateSessionSchema = z
  .object({ agentId: runtimeIdSchema })
  .strict();
export const agentHostCreateSessionResponseSchema = z
  .object({ session: agentHostSessionSchema, replayed: z.boolean() })
  .strict();
export const agentHostStartRunSchema = z
  .object({ message: z.string().refine((v) => v.trim().length > 0) })
  .strict();
export const agentHostAdmissionSchema = z
  .object({ snapshot: agentHostRunSnapshotSchema, replayed: z.boolean() })
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
export type AgentHostStartRun = z.infer<typeof agentHostStartRunSchema>;
export type AgentHostAdmission = z.infer<typeof agentHostAdmissionSchema>;
export type AgentHostCancelResponse = z.infer<
  typeof agentHostCancelResponseSchema
>;
export type AgentHostArtifactResolution = z.infer<
  typeof agentHostArtifactResolutionSchema
>;
export type AgentHostError = z.infer<typeof agentHostErrorSchema>;
export type AgentHostStreamFrame = z.infer<typeof agentHostStreamFrameSchema>;
