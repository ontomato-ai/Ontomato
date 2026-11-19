import { z } from "zod";
import { runtimeArtifactSchema, runtimeFileMetadataSchema } from "./agent-runtime-artifacts";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema, runtimeKeySchema, runtimeSequenceSchema } from "./agent-runtime-values";
import { pageDraftSchema } from "./page-draft";
import { packageRecipeSchema, queryPackageSchema, queryParameterSchema } from "./query-package";
import { querySubgraphSchema } from "./query-subgraph";

export const authoringKindSchema = z.enum(["action", "metric-view"]);
export type AuthoringKind = z.infer<typeof authoringKindSchema>;

export const authoringRunRefSchema = runtimeArtifactSchema.pick({ sessionId: true, runId: true });
export const authoringArtifactRefSchema = authoringRunRefSchema.extend({ artifactId: runtimeArtifactSchema.shape.id });

export const authoringTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("live") }).strict(),
  z.object({ kind: z.literal("build-test"), contextId: runtimeIdSchema }).strict(),
]);

/** The authenticated Workbench host supplies this context independently of author operation bodies. */
export const authoringHostRunSchema = authoringRunRefSchema.extend({
  hostId: z.literal("workbench"),
  ownerId: runtimeKeySchema,
  executionUserId: runtimeKeySchema,
  domainId: runtimeKeySchema,
  classNames: z.array(runtimeKeySchema),
  /** Unix epoch milliseconds, at the earlier of the run and credential deadlines. */
  expiresAt: runtimeSequenceSchema,
  target: authoringTargetSchema,
});
export type AuthoringHostRun = z.infer<typeof authoringHostRunSchema>;

/** An evidence read uses the originating run's host facts and its recorded target. */
export const authoringHistoricalRunSchema = authoringHostRunSchema.omit({ target: true });
export type AuthoringHistoricalRun = z.infer<typeof authoringHistoricalRunSchema>;

export const authoringContextSchema = z.object({
  ontology: runtimeJsonValueSchema,
  knowledge: runtimeJsonValueSchema,
  helpers: z.object({ markdown: z.string() }).strict(),
}).strict();

/** The Action author prepares inline sandbox samples; the sandbox owner validates classes and row values. */
export const authoringPrepareRequestSchema = z.object({
  objDatas: z.array(z.object({ className: runtimeKeySchema, rows: z.array(runtimeJsonObjectSchema) }).strict()),
  relDatas: z.array(z.object({
    relationName: runtimeKeySchema,
    sourceObjId: runtimeKeySchema,
    targetObjId: runtimeKeySchema,
  }).strict()),
  vectorDatas: z.array(z.object({
    className: runtimeKeySchema,
    objectId: runtimeKeySchema,
    attrName: runtimeKeySchema,
    text: runtimeKeySchema,
  }).strict()).optional(),
}).strict();
export const authoringPrepareResponseSchema = z.object({ prepared: z.literal(true) }).strict();

export const authoringResetRequestSchema = z.object({}).strict();
export const authoringResetResponseSchema = z.object({ reset: z.literal(true) }).strict();

export const authoringQuerySandboxRequestSchema = z.object({ dsl: runtimeJsonObjectSchema }).strict();
export const authoringQuerySandboxResponseSchema = runtimeJsonObjectSchema;

const authoringCodeSchema = z.string().regex(/\S/u, "Source code is required");
/** Action authoring carries the asset parameter shape and the shared function parameter types. */
export const actionAuthoringParameterDefsSchema = z.array(queryParameterSchema.partial({ value: true }));

export const authoringExplainDraftRequestSchema = z.object({
  code: authoringCodeSchema,
  parameterDefs: actionAuthoringParameterDefsSchema,
}).strict();

export const actionAuthoringTestRequestSchema = authoringExplainDraftRequestSchema.extend({
  sourceAnalysis: querySubgraphSchema.optional(),
});

export const metricViewAuthoringTestRequestSchema = z.object({
  queryPackage: queryPackageSchema,
  columnLabels: packageRecipeSchema.shape.columnLabels.optional(),
}).strict();

export const authoringReadTestParamsSchema = z.object({ executionId: runtimeIdSchema }).strict();
export const authoringReadTestRequestSchema = z.object({
  run: authoringHistoricalRunSchema,
  input: authoringReadTestParamsSchema,
}).strict();
const authoringEvidenceSchema = authoringReadTestParamsSchema.extend({ digest: runtimeFileMetadataSchema.shape.sha256 });

/** The business test result preserves the Python result text and partial-query metadata. */
export const authoringTestResultSchema = z.object({
  result: z.string().nullish(),
  error: z.string().nullish(),
  spendTime: runtimeSequenceSchema.nullish(),
  partialQuery: runtimeJsonObjectSchema.nullish(),
}).strict();

export const authoringTestRecordSchema = authoringEvidenceSchema.extend({ result: authoringTestResultSchema });
export type AuthoringTestRecord = z.infer<typeof authoringTestRecordSchema>;

/** The UUID of the explanation business run that holds the accepted result. */
export const actionExplanationRefSchema = runtimeIdSchema;

const acceptedActionExplanationSchema = z.object({
  codeSegments: z.array(runtimeJsonObjectSchema).nonempty(),
  businessMeaning: z.object({
    operations: z.array(z.string()),
    negativeEffect: z.string(),
  }).strict().nullable(),
}).strict();

export const authoringExplainDraftResponseSchema = acceptedActionExplanationSchema.extend({
  explanationRef: actionExplanationRefSchema,
});

/** The accepted JSON and its evidence are retained on the same immutable explanation business run. */
export const actionExplanationEvidenceSchema = z.object({
  sourceDigest: runtimeFileMetadataSchema.shape.sha256,
  explanationVersion: z.number().int().positive(),
  acceptedResultRef: actionExplanationRefSchema,
  acceptedResult: acceptedActionExplanationSchema,
}).strict();

/** The Action owner recognizes the explanation reference on the ordinary page draft form. */
export const actionAuthoringPageDraftSchema = pageDraftSchema.extend({
  form: z.object({ explanationRef: actionExplanationRefSchema.optional() }).catchall(runtimeJsonValueSchema),
});

/** The host extracts a draft's form from its immutable artifact, or supplies the actual definition to be saved. */
const authoringAdoptionInputSchema = z.object({ definition: runtimeJsonObjectSchema }).strict();

export const authoringAdoptionRequestSchema = z.object({
  run: authoringHistoricalRunSchema,
  input: authoringAdoptionInputSchema,
}).strict();

export const authoringAdoptionResponseSchema = authoringEvidenceSchema.extend({
  definition: authoringAdoptionInputSchema.shape.definition,
  /** Null when the actual input matches the current saved definition's digest. */
  executionId: authoringEvidenceSchema.shape.executionId.nullable(),
});
export type AuthoringAdoptionResponse = z.infer<typeof authoringAdoptionResponseSchema>;

const platformAuthoringPath = "/ontology/ai/generation/platform/:kind";
export const platformAuthoringEvidenceOperations = {
  "read-test": {
    method: "POST", path: `${platformAuthoringPath}/read-test`, body: authoringReadTestRequestSchema, response: authoringTestRecordSchema,
  },
  adopt: {
    method: "POST", path: `${platformAuthoringPath}/adopt`, body: authoringAdoptionRequestSchema, response: authoringAdoptionResponseSchema,
  },
} as const;

/** Paths are relative to /api/assistant/executions/:runId/authoring. */
export const authoringOperations = {
  action: {
    context: { method: "GET", path: "/action/context", response: authoringContextSchema },
    prepare: { method: "POST", path: "/action/prepare", body: authoringPrepareRequestSchema, response: authoringPrepareResponseSchema },
    reset: { method: "POST", path: "/action/reset", body: authoringResetRequestSchema, response: authoringResetResponseSchema },
    "query-sandbox": { method: "POST", path: "/action/query-sandbox", body: authoringQuerySandboxRequestSchema, response: authoringQuerySandboxResponseSchema },
    test: { method: "POST", path: "/action/test", body: actionAuthoringTestRequestSchema, response: authoringTestRecordSchema },
    "read-test": { method: "GET", path: "/action/tests/:executionId", params: authoringReadTestParamsSchema, response: authoringTestRecordSchema },
    "explain-draft": { method: "POST", path: "/action/explain-draft", body: authoringExplainDraftRequestSchema, response: authoringExplainDraftResponseSchema },
  },
  "metric-view": {
    context: { method: "GET", path: "/metric-view/context", response: authoringContextSchema },
    test: { method: "POST", path: "/metric-view/test", body: metricViewAuthoringTestRequestSchema, response: authoringTestRecordSchema },
    "read-test": { method: "GET", path: "/metric-view/tests/:executionId", params: authoringReadTestParamsSchema, response: authoringTestRecordSchema },
  },
} as const;

/** Definitions exported to the generated JSON Schema for the Java consumer. */
export const authoringWireSchemas = {
  kind: authoringKindSchema,
  hostRun: authoringHostRunSchema,
  historicalRun: authoringHistoricalRunSchema,
  runRef: authoringRunRefSchema,
  artifactRef: authoringArtifactRefSchema,
  context: authoringContextSchema,
  prepareRequest: authoringPrepareRequestSchema,
  prepareResponse: authoringPrepareResponseSchema,
  resetRequest: authoringResetRequestSchema,
  resetResponse: authoringResetResponseSchema,
  querySandboxRequest: authoringQuerySandboxRequestSchema,
  querySandboxResponse: authoringQuerySandboxResponseSchema,
  actionTestRequest: actionAuthoringTestRequestSchema,
  metricViewTestRequest: metricViewAuthoringTestRequestSchema,
  readTestParams: authoringReadTestParamsSchema,
  readTestRequest: authoringReadTestRequestSchema,
  testRecord: authoringTestRecordSchema,
  explainDraftRequest: authoringExplainDraftRequestSchema,
  explainDraftResponse: authoringExplainDraftResponseSchema,
  actionExplanationEvidence: actionExplanationEvidenceSchema,
  actionPageDraft: actionAuthoringPageDraftSchema,
  adoptionRequest: authoringAdoptionRequestSchema,
  adoptionResponse: authoringAdoptionResponseSchema,
};
