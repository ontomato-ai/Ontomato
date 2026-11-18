import { z } from "zod";
import { runtimeMessageRecordSchema } from "./agent-runtime";
import { agentRefSchema, agentSessionRefSchema, agentExecutionRefSchema, agentNotificationSchema, agentPendingQuestionSchema } from "./agent-channel";
import { agentTaskStatusSchema,agentTaskErrorSchema,retrievalBranchSchema,retrievalBranchSourceSchema,qualityResultSchema,retrievalExtensionSchema } from "./agent-task-results";
export { agentTaskStatusSchema,agentTaskErrorSchema,retrievalBranchSchema,retrievalBranchSourceSchema,qualityResultSchema } from "./agent-task-results";
import { runtimeIdSchema, runtimeTimestampSchema } from "./agent-runtime-values";

/**
 * Work a reply delegated: agent executions and the quality jobs their business branches scheduled.
 * Each projection is read from its existing owner; nothing here is stored as a task.
 */
const id = runtimeIdSchema;
/** The reply that delegated the task: the host's conversation and the run that is its reply. */
export const agentTaskRootSchema = z.object({ sessionId: id, runId: id }).strict();
/** A task's own agent run, readable while and after it runs; none before the run was admitted, or for a job. */
export const agentTaskProcessSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inline"), runtimeSessionId: id, runtimeRunId: id }).strict(),
  z.object({ mode: z.literal("page"), href: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
]);
const taskFields = {
  id,
  root: agentTaskRootSchema,
  status: agentTaskStatusSchema,
  error: agentTaskErrorSchema.nullable(),
  /** Absent for jobs admitted before their start times were kept. */
  createdAt: runtimeTimestampSchema.nullable(),
};
export const qualityTaskSchema = z.object({
  ...taskFields,
  kind: z.literal("quality"),
  /** The retrieval task whose branch was checked. */
  parentTaskId: id,
  process: z.object({ mode: z.literal("none") }).strict(),
  /** What was checked: one branch of the parent round and the datasets it delivered. */
  checks: z.object({ source: retrievalBranchSourceSchema, datasetIds: z.array(id) }).strict(),
}).strict();
export const channelAgentTaskSchema = z.object({
  ...taskFields, kind: z.literal("agent"), title: z.string(),
  requestedBy: agentExecutionRefSchema, parentTaskId: id.nullable(),
  agentRef: agentRefSchema, sessionRef: agentSessionRefSchema, runId: id,
  process: agentTaskProcessSchema,
  results: z.array(z.object({ kind: z.string(), href: z.string(), title: z.string() }).strict()),
  retrieval: retrievalExtensionSchema.optional(),
}).strict();
export const agentTaskSchema = z.discriminatedUnion("kind", [qualityTaskSchema,channelAgentTaskSchema]);
export const agentTasksSnapshotSchema = z.object({
  sessionId: id,
  tasks: z.array(agentTaskSchema),
  /** Authoritative human questions, also while the conversation has no active run. */
  pendingQuestions: z.array(agentPendingQuestionSchema).optional(),
  qualityResults: z.array(qualityResultSchema),
  notifications: z.array(runtimeMessageRecordSchema.extend({ message: agentNotificationSchema, agentPendingQuestionSchema })).optional(),
  /** Failed preparations have no run; the intent owns this diagnostic, never a synthetic user message. */
  preparationFailures: z.array(z.object({ runId: id, inputId: id, error: z.string(), createdAt: runtimeTimestampSchema }).strict()).optional(),
}).strict();
/**
 * One `event: tasks` frame of a session's task stream: always the complete snapshot. `settled` says nothing will change
 * until the conversation's next input. Keep the stream open while human questions are pending.
 */
export const agentTasksFrameSchema = agentTasksSnapshotSchema.extend({
  type: z.literal("tasks_snapshot"),
  settled: z.boolean(),
}).strict();

export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type AgentTaskError = z.infer<typeof agentTaskErrorSchema>;
export type RetrievalBranch = z.infer<typeof retrievalBranchSchema>;
export type QualityTask = z.infer<typeof qualityTaskSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type QualityResult = z.infer<typeof qualityResultSchema>;
export type AgentTasksSnapshot = z.infer<typeof agentTasksSnapshotSchema>;
export type AgentTasksFrame = z.infer<typeof agentTasksFrameSchema>;

export type ChannelAgentTask = z.infer<typeof channelAgentTaskSchema>;
