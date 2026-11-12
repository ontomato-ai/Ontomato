import { z } from "zod";
import { truncationSchema } from "./data-retrieval";
import { runtimeIdSchema as id,runtimeTimestampSchema } from "./agent-runtime-values";

export const agentTaskStatusSchema = z.enum(["starting", "running", "completed", "failed", "cancelled"]);
/** Why a task or branch did not complete; the owner chooses the code, the message is its own text when it has one. */
export const agentTaskErrorSchema = z.object({ code: z.string().min(1), message: z.string().nullable() }).strict();
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
/** A completed check's conclusion; a check that did not complete has none, only its task's error. */
export const qualityResultSchema = z.object({
  taskId: id, score: z.number().finite(),
  /** One line for the business user on why the score is what it is; absent for checks settled before it was asked. */
  summary: z.string().nullable(),
  conclusion: z.string(), fittedQuestion: z.string(),
}).strict();

/** Current round facts; this revision is not a per-delivery revision claim. */
export const retrievalExtensionSchema=z.object({ question: z.string(),decisionRevision: z.number().int().nonnegative(),branches: z.array(retrievalBranchSchema) }).strict();
export const agentQualityProjectionSchema=z.object({
  kind: z.literal("quality"),id,parentTaskId: id,status: agentTaskStatusSchema,error: agentTaskErrorSchema.nullable(),createdAt: runtimeTimestampSchema.nullable(),
  process: z.object({mode:z.literal("none")}).strict(),
  checks: z.object({source:retrievalBranchSourceSchema,datasetIds:z.array(id)}).strict(),result:qualityResultSchema.nullable(),
}).strict();
export const agentFileSchema=z.object({
  id,name:z.string().min(1).refine(name=>!/[\\/\0]/u.test(name) && name!=="." && name!=="..","Expected a file name"),mediaType:z.string().min(1),href:z.string().min(1),
}).strict();
