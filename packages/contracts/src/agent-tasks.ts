import { z } from "zod";
import { truncationSchema } from "./data-retrieval";
import { runtimeIdSchema, runtimeTimestampSchema } from "./agent-runtime-values";

/**
 * Work a reply delegated, read from the records that already own it: a retrieval task is a retrieval round (its ID),
 * a quality task is the quality job one branch of that round scheduled (its ID). Nothing here is stored as a task.
 */
const id = runtimeIdSchema;
export const agentTaskStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);
/** Why a task or branch did not complete; the owner chooses the code, the message is its own text when it has one. */
export const agentTaskErrorSchema = z.object({ code: z.string().min(1), message: z.string().nullable() }).strict();
/** The reply that delegated the task: the host's conversation and the run that is its reply. */
export const agentTaskRootSchema = z.object({ sessionId: id, runId: id }).strict();
/** A task's own agent run, readable while and after it runs; none before the run was admitted, or for a job. */
export const agentTaskProcessSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inline"), runtimeSessionId: id, runtimeRunId: id }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
]);
export const retrievalBranchSourceSchema = z.enum(["binding", "retriever"]);
/** One branch of a retrieval round as its owner settled it, with the datasets it delivered. */
export const retrievalBranchSchema = z.object({
  source: retrievalBranchSourceSchema,
  status: agentTaskStatusSchema,
  error: agentTaskErrorSchema.nullable(),
  datasets: z.array(z.object({
    id, title: z.string(), rowCount: z.number().int().nonnegative(), truncation: truncationSchema.nullable(),
  }).strict()),
}).strict();
const taskFields = {
  id,
  root: agentTaskRootSchema,
  status: agentTaskStatusSchema,
  error: agentTaskErrorSchema.nullable(),
  /** Absent for jobs admitted before their start times were kept. */
  createdAt: runtimeTimestampSchema.nullable(),
};
export const retrievalTaskSchema = z.object({
  ...taskFields,
  kind: z.literal("retrieval"),
  /** What this round was given: the question ask started it with, or the reply a resumed round continues with. */
  question: z.string(),
  parentTaskId: z.null(),
  process: agentTaskProcessSchema,
  branches: z.array(retrievalBranchSchema),
}).strict();
export const qualityTaskSchema = z.object({
  ...taskFields,
  kind: z.literal("quality"),
  /** The retrieval task whose branch was checked. */
  parentTaskId: id,
  process: z.object({ mode: z.literal("none") }).strict(),
  /** What was checked: one branch of the parent round and the datasets it delivered. */
  checks: z.object({ source: retrievalBranchSourceSchema, datasetIds: z.array(id) }).strict(),
}).strict();
export const agentTaskSchema = z.discriminatedUnion("kind", [retrievalTaskSchema, qualityTaskSchema]);
/** A completed check's conclusion; a check that did not complete has none, only its task's error. */
export const qualityResultSchema = z.object({
  taskId: id, score: z.number().finite(),
  /** One line for the business user on why the score is what it is; absent for checks settled before it was asked. */
  summary: z.string().nullable(),
  conclusion: z.string(), fittedQuestion: z.string(),
}).strict();
export const agentTasksSnapshotSchema = z.object({
  sessionId: id,
  tasks: z.array(agentTaskSchema),
  qualityResults: z.array(qualityResultSchema),
}).strict();
/**
 * One `event: tasks` frame of a session's task stream: always the complete snapshot. `settled` says nothing will change
 * until the conversation's next run, so the stream ends after it.
 */
export const agentTasksFrameSchema = agentTasksSnapshotSchema.extend({
  type: z.literal("tasks_snapshot"),
  settled: z.boolean(),
}).strict();

/** The ontology service's read of the given retrieval callers; the workbench assigns each caller's reply as root. */
export const callerTasksSchema = z.object({
  tasks: z.array(z.discriminatedUnion("kind", [
    retrievalTaskSchema.omit({ root: true }).extend({ callerId: id }).strict(),
    qualityTaskSchema.omit({ root: true }).extend({ callerId: id }).strict(),
  ])),
  qualityResults: z.array(qualityResultSchema),
  /** No task is running and no branch still owes its quality check. */
  settled: z.boolean(),
}).strict();

export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type AgentTaskError = z.infer<typeof agentTaskErrorSchema>;
export type RetrievalBranch = z.infer<typeof retrievalBranchSchema>;
export type RetrievalTask = z.infer<typeof retrievalTaskSchema>;
export type QualityTask = z.infer<typeof qualityTaskSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type QualityResult = z.infer<typeof qualityResultSchema>;
export type AgentTasksSnapshot = z.infer<typeof agentTasksSnapshotSchema>;
export type AgentTasksFrame = z.infer<typeof agentTasksFrameSchema>;
export type CallerTasks = z.infer<typeof callerTasksSchema>;
