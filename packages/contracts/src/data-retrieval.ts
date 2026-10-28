import { runtimeMessageRecordSchema } from "./agent-runtime";
import { runtimeStopReasonSchema } from "./agent-runtime-values";
import { z } from "zod";
import {
  runtimeJsonValueSchema,
  runtimeJsonObjectSchema,
} from "./agent-runtime-values";

const id = z.string().uuid();
export const fieldSourceSchema = z
  .object({
    key: z.string().min(1),
    className: z.string().min(1),
    attrName: z.string().min(1),
    asGroupBy: z.boolean(),
    statCal: z.boolean(),
  })
  .strict();
export const truncationSchema = z
  .object({
    truncated: z.literal(true),
    rowLimit: z.number().int().positive(),
    truncationHint: z.string().min(1),
  })
  .strict();
export const recipeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("python"),
      code: z.string().min(1),
      sha256: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("dsl"),
      dsl: runtimeJsonObjectSchema,
      executedCode: z.string().optional(),
      sha256: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("metric"),
      metricId: z.string(),
      revision: z.string(),
      parameters: runtimeJsonObjectSchema,
      executedCode: z.string().optional(),
      sha256: z.string().optional(),
    })
    .strict(),
]);
export const metricUseSchema = z
  .object({
    id: z.string(),
    revision: z.string(),
    use: z.enum(["direct", "derived", "not_used"]),
    reason: z.string().min(1),
  })
  .strict();
export const selfCheckSchema = z
  .object({
    scope: z.string(),
    filters: z.string(),
    grain: z.string(),
    denominator: z.string(),
    nullGroups: z.string(),
    comparisons: z.array(
      z
        .object({
          metricId: z.string(),
          comparable: z.boolean(),
          explanation: z.string(),
          executionRef: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const datasetPayloadSchema = z
  .object({
    schema: z.literal("workbench.dataset.v1"),
    title: z.string().min(1),
    question: z.string().min(1),
    columns: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          type: z.string().nullable(),
        })
        .strict(),
    ),
    rows: z.array(z.record(runtimeJsonValueSchema)),
    recipe: recipeSchema,
    outKeyRefs: z.array(fieldSourceSchema),
    truncation: truncationSchema.nullable(),
    assumptions: z.array(z.string()),
    decisionIds: z.array(id),
    metricUses: z.array(metricUseSchema),
    selfCheck: selfCheckSchema,
    execution: z.object({ receiptId: id, executedAt: z.string() }).strict(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const keys = data.columns.map((c) => c.key).sort(),
      sources = data.outKeyRefs.map((c) => c.key).sort();
    if (
      new Set(keys).size !== keys.length ||
      JSON.stringify(keys) !== JSON.stringify(sources) ||
      data.rows.some(
        (row) =>
          JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(keys),
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Dataset row, column and source keys must match exactly",
      });
  });
export const retrievalInputSchema = z
  .object({
    question: z.string().trim().min(1),
    userQuotes: z.array(z.string()).default([]),
    classNames: z.array(z.string()).optional(),
    previousDatasetIds: z.array(id).default([]),
    interaction: z.enum(["resumable", "non_interactive"]).default("resumable"),
  })
  .strict();
export const retrievalSnapshotSchema = z.object({
  qualityCheck: runtimeJsonObjectSchema.optional(),
  id,
  revision: z.number().int(),
  runtimeSessionId: id.nullable(),
  runtimeRunId: id.nullable(),
  run: z
    .object({
      status: z.enum(["running", "stopped"]),
      stopReason: runtimeStopReasonSchema.nullable(),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
  messages: z.array(runtimeMessageRecordSchema),
  datasetArtifactIds: z.array(id),
  decisionRevision: z.number().int(),
});
export const retrievalAnswersSchema = z
  .object({
    expectedRunId: id,
    expectedDecisionRevision: z.number().int().nonnegative(),
    message: z.string().trim().min(1),
  })
  .strict();
export const prepareDatasetSchema = z
  .object({
    recipe: recipeSchema,
    title: z.string().min(1),
    question: z.string().min(1),
    outKeyRefs: z.array(fieldSourceSchema),
    assumptions: z.array(z.string()),
    metricUses: z.array(metricUseSchema),
    selfCheck: selfCheckSchema,
    decisionIds: z.array(id),
  })
  .strict();
export type DatasetPayload = z.infer<typeof datasetPayloadSchema>;
export type RetrievalInput = z.infer<typeof retrievalInputSchema>;
export type RetrievalSnapshot = z.infer<typeof retrievalSnapshotSchema>;
