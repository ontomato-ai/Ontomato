import { z } from "zod";
import { runtimeJsonValueSchema } from "./agent-runtime-values";
import { serviceLogQuerySchema, serviceLogServiceSchema } from "./service-logging";

export const DIAGNOSIS_AGENT_ID = "64348621-8f48-4734-b498-a265598c19f0";
export const diagnosisTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("assistant-run"), sessionId: z.string().uuid(), runId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("turn"), turnKey: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("autotest-case"), testRunId: z.string().min(1), caseId: z.string().min(1) }).strict(),
]);
export type DiagnosisTarget = z.infer<typeof diagnosisTargetSchema>;
export const diagnosisEvidenceSchema = z.object({
  target: diagnosisTargetSchema,
  resolvedAt: z.string().datetime(),
  runs: z.array(z.object({
    owner: z.enum(["workbench", "ontology"]), sessionId: z.string().uuid(), runId: z.string().uuid(),
    correlationId: z.string().nullable(), artifactIds: z.array(z.string().uuid()),
  }).strict()),
  logQueries: z.array(z.object({ service: serviceLogServiceSchema, query: serviceLogQuerySchema }).strict()),
  gaps: z.array(z.object({ source: z.string(), code: z.string(), message: z.string() }).strict()),
}).strict();
export type DiagnosisEvidence = z.infer<typeof diagnosisEvidenceSchema>;
export const diagnosisQueryInputSchema = z.object({
  query: z.record(runtimeJsonValueSchema), limit: z.number().int().min(1).max(25).default(25),
}).strict();
export const diagnosisQueryPreviewSchema = z.object({
  rows: z.array(runtimeJsonValueSchema), receivedRowCount: z.number().int().nonnegative(),
  upstreamTruncation: z.object({ truncated: z.literal(true), rowLimit: z.number().optional(), truncationHint: z.string() }).nullable(),
}).strict();
