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
const actionParameterSchema = queryParameterSchema.pick({ name: true, type: true, description: true, value: true })
  .partial({ value: true })
  .extend({ className: runtimeKeySchema.nullable().optional() });

export const actionAuthoringTestRequestSchema = z.object({
  code: authoringCodeSchema,
  parameterDefs: z.array(actionParameterSchema),
  sourceAnalysis: querySubgraphSchema.optional(),
}).strict();

export const metricViewAuthoringTestRequestSchema = z.object({
  queryPackage: queryPackageSchema,
  columnLabels: packageRecipeSchema.shape.columnLabels.optional(),
}).strict();

export const authoringReadTestParamsSchema = z.object({ executionId: runtimeIdSchema }).strict();
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

export const authoringExplainDraftRequestSchema = z.object({ code: authoringCodeSchema }).strict();
export const actionExplanationRefSchema = runtimeIdSchema;
export const authoringExplainDraftResponseSchema = z.object({
  explanation: runtimeJsonObjectSchema,
  explanationRef: actionExplanationRefSchema,
}).strict();

/** The Action owner recognizes the explanation reference on the ordinary page draft form. */
export const actionAuthoringPageDraftSchema = pageDraftSchema.extend({
  form: z.object({ explanationRef: actionExplanationRefSchema.optional() }).catchall(runtimeJsonValueSchema),
});

export const authoringAdoptionResponseSchema = authoringEvidenceSchema.extend({ definition: runtimeJsonObjectSchema });
export type AuthoringAdoptionResponse = z.infer<typeof authoringAdoptionResponseSchema>;

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
  testRecord: authoringTestRecordSchema,
  explainDraftRequest: authoringExplainDraftRequestSchema,
  explainDraftResponse: authoringExplainDraftResponseSchema,
  actionPageDraft: actionAuthoringPageDraftSchema,
  adoptionResponse: authoringAdoptionResponseSchema,
};
