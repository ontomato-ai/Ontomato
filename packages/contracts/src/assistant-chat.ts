import { z } from "zod";
import {
  runtimeMessageRecordSchema,
  runtimeRunSnapshotSchema,
} from "./agent-runtime";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import { retrievalSnapshotSchema } from "./data-retrieval";
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

/** Approved batch 3 host contract. */
export const assistantAgentSchema = z.object({
  id: runtimeIdSchema,
  workbenchId: runtimeKeySchema,
  name: runtimeKeySchema,
  description: z.string(),
  icon: z.string().nullable(),
  enabled: z.boolean(),
  modelRole: runtimeKeySchema,
  skills: z.array(runtimeSkillRefSchema),
}).strict();
export const assistantAgentDefinitionSchema = assistantAgentSchema.extend({systemPrompt:z.string()});
export const assistantAgentInputSchema = assistantAgentDefinitionSchema.omit({id:true});
export type AssistantAgentDefinition=z.infer<typeof assistantAgentDefinitionSchema>;
export type AssistantAgentInput=z.infer<typeof assistantAgentInputSchema>;
export const assistantAgentListSchema = z.object({
  agents: z.array(assistantAgentSchema),
}).strict();
export const assistantRunSchema = z.object({
  id: runtimeIdSchema,
  sessionId: runtimeIdSchema,
  status: runtimeRunStatusSchema,
  stopReason: runtimeStopReasonSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: runtimeTimestampSchema,
  finishedAt: runtimeTimestampSchema.nullable(),
}).strict();

export const assistantMessageSchema = runtimeMessageRecordSchema;
export const assistantRunSnapshotSchema = z.object({
  run: assistantRunSchema,
  cursor: runtimeCursorSchema,
  messages: z.array(assistantMessageSchema),
  pendingMessages: runtimeRunSnapshotSchema.shape.pendingMessages,
  toolExecutions: runtimeRunSnapshotSchema.shape.toolExecutions,
  artifacts: z.array(runtimeArtifactSchema),
}).strict();
export const assistantSessionSchema = z.object({
  id: runtimeIdSchema,
  workbenchId: runtimeKeySchema,
  agentId: runtimeIdSchema,
  title: z.string(),
  createdAt: runtimeTimestampSchema,
  updatedAt: runtimeTimestampSchema,
  latestRun: assistantRunSchema.nullable(),
}).strict();
export const assistantSessionSnapshotSchema = z.object({
  session: assistantSessionSchema,
  messages: z.array(assistantMessageSchema),
  latestRun: assistantRunSnapshotSchema.nullable(),
}).strict();
export const assistantSessionPageSchema = z.object({
  sessions: z.array(assistantSessionSchema),
  nextCursor: z.string().nullable(),
}).strict();
export const assistantCreateSessionSchema = z.object({
  workbenchId: runtimeKeySchema,
  agentId: runtimeIdSchema,
}).strict();
export const assistantCreateSessionResponseSchema = z.object({
  session: assistantSessionSchema,
  replayed: z.boolean(),
}).strict();
export const assistantStartRunSchema = z.object({
  message: z.string().refine((value) => value.trim().length > 0),
}).strict();
export const assistantAdmissionSchema = z.object({
  snapshot: assistantRunSnapshotSchema,
  replayed: z.boolean(),
}).strict();
export const assistantCancelResponseSchema = z.object({
  run: assistantRunSchema.nullable(),
}).strict().refine((value) => value.run === null || value.run.status === "stopped");
export const assistantArtifactResolutionSchema = z.object({
  artifact: runtimeArtifactSchema.nullable(),
}).strict();
/** Only accepted copied datasets receive a source; generic JSON files do not. */
export const assistantDatasetSourceSchema = z.object({
  retrievalId: runtimeIdSchema,
  sourceArtifactId: runtimeIdSchema,
  qualityCheck: retrievalSnapshotSchema.shape.qualityCheck,
}).strict();
export const assistantFeedbackTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), id: runtimeIdSchema }).strict(),
  z.object({ kind: z.literal("artifact"), id: runtimeIdSchema }).strict(),
]);
export const assistantFeedbackWriteSchema = z.object({
  runId: runtimeIdSchema,
  target: assistantFeedbackTargetSchema,
  rating: z.enum(["like", "dislike"]),
  text: z.string(),
}).strict().refine(
  (value) => value.rating !== "dislike" || value.text.trim().length > 0,
  { message: "A reason is required for dislike", path: ["text"] },
);
export const assistantFeedbackSchema = z.object({
  id: runtimeIdSchema,
  sessionId: runtimeIdSchema,
  runId: runtimeIdSchema,
  target: assistantFeedbackTargetSchema,
  rating: z.enum(["like", "dislike"]),
  text: z.string(),
  updatedAt: runtimeTimestampSchema,
}).strict();
export const assistantFeedbackListSchema = z.object({
  feedback: z.array(assistantFeedbackSchema),
}).strict();
/** Host errors describe HTTP operations; they never replace PI run state. */
export const assistantErrorSchema = z.object({
  error: z.object({ code: runtimeKeySchema, message: runtimeKeySchema }).strict(),
  correlationId: runtimeKeySchema,
}).strict();
export const assistantStreamFrameSchema = runtimeStreamFrameSchema;

export type AssistantAgent = z.infer<typeof assistantAgentSchema>;
export type AssistantAgentList = z.infer<typeof assistantAgentListSchema>;
export type AssistantRun = z.infer<typeof assistantRunSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantRunSnapshot = z.infer<typeof assistantRunSnapshotSchema>;
export type AssistantSession = z.infer<typeof assistantSessionSchema>;
export type AssistantSessionSnapshot = z.infer<typeof assistantSessionSnapshotSchema>;
export type AssistantSessionPage = z.infer<typeof assistantSessionPageSchema>;
export type AssistantCreateSession = z.infer<typeof assistantCreateSessionSchema>;
export type AssistantCreateSessionResponse = z.infer<typeof assistantCreateSessionResponseSchema>;
export type AssistantStartRun = z.infer<typeof assistantStartRunSchema>;
export type AssistantAdmission = z.infer<typeof assistantAdmissionSchema>;
export type AssistantCancelResponse = z.infer<typeof assistantCancelResponseSchema>;
export type AssistantArtifactResolution = z.infer<typeof assistantArtifactResolutionSchema>;
export type AssistantDatasetSource = z.infer<typeof assistantDatasetSourceSchema>;
export type AssistantFeedbackTarget = z.infer<typeof assistantFeedbackTargetSchema>;
export type AssistantFeedbackWrite = z.infer<typeof assistantFeedbackWriteSchema>;
export type AssistantFeedback = z.infer<typeof assistantFeedbackSchema>;
export type AssistantFeedbackList = z.infer<typeof assistantFeedbackListSchema>;
export type AssistantError = z.infer<typeof assistantErrorSchema>;
export type AssistantStreamFrame = z.infer<typeof assistantStreamFrameSchema>;
