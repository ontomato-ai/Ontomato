import { runtimeStopReasonSchema } from "./agent-runtime-values";
import { z } from "zod";
import { querySubgraphSchema } from "./query-subgraph";
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
      bindingId: z.string().optional(),
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
    // Optional only while reading datasets created before the source-analysis cutover.
    sourceAnalysis: querySubgraphSchema.optional(),
    outKeyRefs: z.array(fieldSourceSchema).optional(),
    truncation: truncationSchema.nullable(),
    assumptions: z.array(z.string()),
    decisionIds: z.array(id),
    metricUses: z.array(metricUseSchema),
    selfCheck: selfCheckSchema.nullable(),
    execution: z.object({ receiptId: id, executedAt: z.string() }).strict(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const keys = data.columns.map((c) => c.key).sort(),
      sources = data.sourceAnalysis ? data.sourceAnalysis.nodes.filter((n) => n.kind === "output").map((n) => n.key).sort() : (data.outKeyRefs ?? []).map((c) => c.key).sort();
    if (
      new Set(keys).size !== keys.length ||
      (data.sourceAnalysis && JSON.stringify(data.sourceAnalysis.nodes
        .filter((n) => n.kind === "output").map((n) => n.key).sort()) !== JSON.stringify(keys)) ||
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
    timeoutSeconds: z.number().int().min(1).max(600).optional(),
    userQuotes: z.array(z.string()).default([]),
    classNames: z.array(z.string()).optional(),
    previousDatasetIds: z.array(id).default([]),
    interaction: z.enum(["resumable", "non_interactive"]).default("resumable"),
  })
  .strict();
export const bindingRetrievalSchema = z.object({
  status: z.enum(["running", "completed", "cancelled", "interrupted"]),
  error: z.string().nullable(),
  datasets: z.array(z.object({ id, sha256: z.string(), title: z.string(), qualityCheck: runtimeJsonObjectSchema.optional() })),
});
const retrievalRunStateSchema = z.object({
  status: z.enum(["running", "stopped"]), stopReason: runtimeStopReasonSchema.nullable(), errorMessage: z.string().nullable(),
});
export const retrievalDeliverySchema = z.object({
  cursor: z.number().int().positive(), runId: id, source: z.enum(["binding", "retriever"]),
  data: z.object({
    answer: z.string(), run: retrievalRunStateSchema.nullable(), error: z.string().optional(),
    runtimeSessionId: id.optional(), runtimeRunId: id.optional(),
    datasets: z.array(z.object({ id, sha256: z.string(), title: z.string(), rowCount: z.number().int().nonnegative(),
      truncation: truncationSchema.nullable(), binding: runtimeJsonObjectSchema.optional() })),
  }),
});
export const retrievalPollSchema = z.object({
  bindings: bindingRetrievalSchema,
  qualityCheck: runtimeJsonObjectSchema.optional(),
  id, roundId: id, cursor: z.number().int().nonnegative(), decisionRevision: z.number().int(),
  runtimeSessionId: id.nullable(), runtimeRunId: id.nullable(), run: retrievalRunStateSchema.nullable(),
  pending: z.object({ retriever: z.boolean(), bindings: z.boolean() }), deliveries: z.array(retrievalDeliverySchema),
});
export type RetrievalPoll = z.infer<typeof retrievalPollSchema>;

export const retrievalSnapshotSchema = z.object({
  bindings: bindingRetrievalSchema.optional(),
  retrieverPending: z.boolean().optional(),
  bindingPending: z.boolean().optional(),
  admissionError: z.string().nullable().optional(),
  createdAt: z.string().optional(),
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
  /** Delivery cursor, independent of the runtime event stream's streamId/seq. */
  cursor: z.number().int().nonnegative(),
  deliveries: z.array(retrievalDeliverySchema),
  datasetArtifactIds: z.array(id),
  decisionRevision: z.number().int(),
});
export const retrievalAnswersSchema = z
  .object({
    timeoutSeconds: z.number().int().min(1).max(600).optional(),
    expectedRunId: id,
    expectedDecisionRevision: z.number().int().nonnegative(),
    message: z.string().trim().min(1),
  })
  .strict();
export const prepareDatasetSchema = z
  .object({
    recipe: recipeSchema,
    sourceAnalysis: querySubgraphSchema.optional(),
    title: z.string().min(1),
    question: z.string().min(1),
    assumptions: z.array(z.string()),
    metricUses: z.array(metricUseSchema),
    selfCheck: selfCheckSchema,
    decisionIds: z.array(id),
  })
  .strict().superRefine((data, context) => {
    if (data.recipe.kind !== "metric" && !data.sourceAnalysis) context.addIssue({ code: z.ZodIssueCode.custom, message: "sourceAnalysis is required" });
  });
export type DatasetPayload = z.infer<typeof datasetPayloadSchema>;
export type RetrievalInput = z.infer<typeof retrievalInputSchema>;
export type RetrievalSnapshot = z.infer<typeof retrievalSnapshotSchema>;

export const retrievalEvidenceSchema = z.object({ input: retrievalInputSchema, snapshot: retrievalSnapshotSchema }).strict();
export const retrievalCallerInputSchema = z.object({ classNames: z.array(z.string()), continuationIds: z.array(id), deadlineAt: z.string().datetime() }).strict();
export const retrievalCallerSchema = z.object({ id, closed: z.boolean(), retrievals: z.array(z.object({ retrievalId: id, runId: id }).strict()) }).strict();

export const retrievalCallerAdmissionSchema = z.object({ id, expiresAt: z.string().datetime({ offset: true }) }).strict();
export type RetrievalCallerInput = z.infer<typeof retrievalCallerInputSchema>;
