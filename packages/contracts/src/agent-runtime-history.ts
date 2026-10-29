import { z } from "zod";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import { runtimeIdSchema, runtimeKeySchema, runtimeTimestampSchema } from "./agent-runtime-values";

/** This projection deliberately excludes prompts, thinking, tool messages and run annotations. */
export const runtimeHistoryQuerySchema = z.object({
  agentId: runtimeKeySchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  query: z.string().max(2000).default(""),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(v => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), "Invalid time range");
export const runtimeHistoryRecordSchema = z.object({
  hostId: runtimeKeySchema,
  runId: runtimeIdSchema,
  sessionId: runtimeIdSchema,
  agentId: runtimeKeySchema.nullable(),
  createdAt: runtimeTimestampSchema,
  finishedAt: runtimeTimestampSchema.nullable(),
  question: z.string(),
  answer: z.string().nullable(),
  artifacts: z.array(runtimeArtifactSchema),
}).strict();
export const runtimeHistoryPageSchema = z.object({
  records: z.array(runtimeHistoryRecordSchema),
  nextOffset: z.number().int().nonnegative().nullable(),
}).strict();
export type RuntimeHistoryQuery = z.infer<typeof runtimeHistoryQuerySchema>;
export type RuntimeHistoryRecord = z.infer<typeof runtimeHistoryRecordSchema>;
