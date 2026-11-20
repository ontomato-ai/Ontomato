import {z} from "zod";
import {runtimeJsonObjectSchema,runtimeIdSchema as id} from "./agent-runtime-values";
import {retrievalCallerInputSchema} from "./data-retrieval";

/** Execution selection belongs to the trusted host envelope, not dataset contents. */
export const assistantRetrievalCallerInputSchema=retrievalCallerInputSchema.extend({executionUserId:z.string().min(1).nullable().optional()});
export type AssistantRetrievalCallerInput=z.infer<typeof assistantRetrievalCallerInputSchema>;

/** Host retrieval operations name business inputs, never an upstream path or authentication. */
export const assistantRetrievalOperationSchema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("begin"),key:id,input:runtimeJsonObjectSchema}).strict(),
 z.object({operation:z.literal("submit"),retrievalId:id,retrievalRunId:id,key:id,input:runtimeJsonObjectSchema}).strict(),
 z.object({operation:z.literal("submit-metric"),retrievalId:id,retrievalRunId:id,key:id,input:runtimeJsonObjectSchema}).strict(),
 z.object({operation:z.literal("status"),retrievalId:id,retrievalRunId:id,key:id}).strict(),
 z.object({operation:z.literal("content"),retrievalId:id,retrievalRunId:id,key:id}).strict(),
 z.object({operation:z.literal("close"),retrievalId:id,retrievalRunId:id}).strict(),
]);
export type AssistantRetrievalOperation=z.infer<typeof assistantRetrievalOperationSchema>;
