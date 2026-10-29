import { serviceLogCorrelationSchema } from "./service-logging";
import { z } from "zod";
import { codeLimitsSchema } from "./agent-runtime-code";
import { runtimeMcpRefSchema } from "./agent-runtime-mcp";
import { runtimeArtifactSchema } from "./agent-runtime-artifacts";
import {
  runtimeCursorSchema,
  runtimeToolExecutionSchema,
} from "./agent-runtime-events";
import {
  runtimeMessageSchema,
  runtimeSettledMessageSchema,
  runtimeUserMessageSchema,
} from "./agent-runtime-messages";
import {
  runtimeEnvironmentSchema,
  runtimeRegisteredSkillSchema,
  runtimeSkillRefSchema,
} from "./agent-runtime-skills";
import {
  runtimeIdSchema,
  runtimeKeySchema,
  runtimeRunStatusSchema,
  runtimeStopReasonSchema,
  runtimeSequenceSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";

/** Lowercase HTTP header names after transport normalization. No caller-supplied host ID. */
export const runtimeServiceHeadersSchema = z.object({
  authorization: z.string().regex(/^Bearer \S+$/),
  "x-correlation-id": serviceLogCorrelationSchema,
});
export const runtimeRequestHeadersSchema = runtimeServiceHeadersSchema.extend({
  "x-domain-id": runtimeKeySchema,
});
/** On session/run/call creation, the key is the resource UUID chosen before admission. */
export const runtimeAdmissionHeadersSchema = runtimeRequestHeadersSchema.extend(
  {
    "idempotency-key": runtimeIdSchema,
  },
);

/** Hosts send a complete non-secret definition on every run; role names are opaque strings. */
export const runtimeAgentDefinitionSchema = z
  .object({
    systemPrompt: z.string(),
    modelRole: runtimeKeySchema,
    skills: z.array(runtimeSkillRefSchema),
    sandbox: z.object({ limits: codeLimitsSchema }).strict(),
    externalMcp: z.array(runtimeMcpRefSchema),
    // Host-rendered instructions; the runtime prepends conversation and previous-summary blocks.
    compaction: z
      .object({
        systemPrompt: z.string(),
        summarizePrompt: z.string(),
        updatePrompt: z.string(),
      })
      .strict(),
  })
  .strict();

export const runtimeCreateSessionRequestSchema = z.object({}).strict();
export const runtimeStartRunRequestSchema = z
  .object({
    language: runtimeKeySchema,
    definition: runtimeAgentDefinitionSchema,
    input: runtimeUserMessageSchema,
    environment: runtimeEnvironmentSchema,
  })
  .strict();

export const runtimeSessionSchema = z
  .object({
    id: runtimeIdSchema,
    domainId: runtimeKeySchema,
    activeRunId: runtimeIdSchema.nullable(),
    latestRunId: runtimeIdSchema.nullable(),
    createdAt: runtimeTimestampSchema,
    updatedAt: runtimeTimestampSchema,
  })
  .strict();
const runtimeRunFields = {
  id: runtimeIdSchema,
  sessionId: runtimeIdSchema,
  domainId: runtimeKeySchema,
  status: runtimeRunStatusSchema,
  correlationId: runtimeKeySchema,
  language: runtimeKeySchema,
  createdAt: runtimeTimestampSchema,
  finishedAt: runtimeTimestampSchema.nullable(),
  stopReason: runtimeStopReasonSchema.nullable(),
  errorMessage: z.string().nullable(),
  resolvedSkills: z.array(runtimeRegisteredSkillSchema),
  environment: z.object({
    values: z.record(z.string()),
    secretNames: z.array(z.string()),
  }),
};
export const runtimeRunSchema = z
  .object({
    ...runtimeRunFields,
    definition: runtimeAgentDefinitionSchema,
  })
  .strict()
  .refine(
    (run) => (run.status === "running") === (run.finishedAt === null),
    "Only running runs have no finishedAt timestamp",
  );
export const runtimeAdmissionResponseSchema = z
  .object({
    run: runtimeRunSchema,
    // True means the same committed admission was returned, never another execution.
    replayed: z.boolean(),
  })
  .strict();
export const runtimeCreateSessionResponseSchema = z
  .object({
    session: runtimeSessionSchema,
    replayed: z.boolean(),
  })
  .strict();

/** Raw settled history is append-only. Compaction never replaces these rows. */
export const runtimeMessageRecordSchema = z
  .object({
    id: runtimeIdSchema,
    runId: runtimeIdSchema,
    messageSeq: runtimeSequenceSchema,
    message: runtimeSettledMessageSchema,
  })
  .strict();
export const runtimeRunSnapshotSchema = z
  .object({
    run: runtimeRunSchema,
    cursor: runtimeCursorSchema,
    messages: z.array(runtimeMessageRecordSchema),
    // Latest full live partials through cursor, not deltas to append to settled messages.
    pendingMessages: z.array(
      z.object({ id: runtimeIdSchema, message: runtimeMessageSchema }).strict(),
    ),
    toolExecutions: z.array(runtimeToolExecutionSchema),
    artifacts: z.array(runtimeArtifactSchema),
  })
  .strict();
export const runtimeSessionSnapshotSchema = z
  .object({
    session: runtimeSessionSchema,
    // Includes settled messages of the active run; merge using message IDs, never array offsets.
    messages: z.array(runtimeMessageRecordSchema),
    latestRun: runtimeRunSnapshotSchema.nullable(),
  })
  .strict();
/** Lightweight status reads exclude messages, definitions, artifacts and error text. */
export const runtimeSessionStatusSchema = z
  .object({
    session: runtimeSessionSchema,
    latestRun: z
      .object({
        id: runtimeIdSchema,
        status: runtimeRunStatusSchema,
        stopReason: runtimeStopReasonSchema.nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const runtimeSessionStatusesRequestSchema = z
  .object({
    sessionIds: z.array(runtimeIdSchema),
  })
  .strict();
export const runtimeSessionStatusesResponseSchema = z
  .object({
    // Same order as sessionIds; any missing/inaccessible session rejects the entire request.
    sessions: z.array(runtimeSessionStatusSchema),
  })
  .strict();
export const runtimeEventSubscriptionSchema = z
  .object({
    afterSeq: runtimeSequenceSchema,
    streamId: runtimeIdSchema,
  })
  .strict();
export const runtimeCancelRequestSchema = z.object({}).strict();
export const runtimeCancelResponseSchema = z
  .object({ run: runtimeRunSchema })
  .strict()
  .refine(
    ({ run }) => run.status !== "running",
    "Cancellation responds after the run settles",
  );

export const runtimeErrorCodeSchema = z.enum([
  "CODE_ISOLATION_UNAVAILABLE",
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SESSION_BUSY",
  "IDEMPOTENCY_CONFLICT",
  "SKILL_NOT_FOUND",
  "UNSUPPORTED_CAPABILITY",
  "RESOURCE_DELETED",
  "INTERNAL_ERROR",
  "MCP_NAME_EXISTS",
  "MCP_DISCOVERY_FAILED",
]);
export const runtimeErrorResponseSchema = z
  .object({
    error: z
      .object({ code: runtimeErrorCodeSchema, message: z.string().min(1) })
      .strict(),
    correlationId: runtimeKeySchema,
  })
  .strict();
export const RUNTIME_ERROR_HTTP_STATUS = {
  CODE_ISOLATION_UNAVAILABLE: 503,
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SESSION_BUSY: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SKILL_NOT_FOUND: 422,
  UNSUPPORTED_CAPABILITY: 422,
  RESOURCE_DELETED: 410,
  INTERNAL_ERROR: 500,
  MCP_NAME_EXISTS: 409,
  MCP_DISCOVERY_FAILED: 502,
} as const satisfies Record<z.infer<typeof runtimeErrorCodeSchema>, number>;

/** Success bodies are unwrapped JSON. Non-success responses use runtimeErrorResponseSchema. */
export const RUNTIME_HTTP_ROUTES = {
  createSession: { method: "POST", path: "/v1/sessions", status: 201 },
  readSession: { method: "GET", path: "/v1/sessions/:sessionId", status: 200 },
  readSessionStatuses: {
    method: "POST",
    path: "/v1/sessions/status",
    status: 200,
  },
  // Required by the existing governance user-deletion path; active sessions must be cancelled first.
  deleteSession: {
    method: "DELETE",
    path: "/v1/sessions/:sessionId",
    status: 204,
  },
  startRun: {
    method: "POST",
    path: "/v1/sessions/:sessionId/runs",
    status: 202,
  },
  readRun: { method: "GET", path: "/v1/runs/:runId", status: 200 },
  subscribe: { method: "GET", path: "/v1/runs/:runId/events", status: 200 },
  cancel: { method: "POST", path: "/v1/runs/:runId/cancel", status: 200 },
  readArtifact: {
    method: "GET",
    path: "/v1/artifacts/:artifactId",
    status: 200,
  },
  testModel: { method: "POST", path: "/v1/models/test", status: 200 },
  registerSkill: { method: "POST", path: "/v1/skills", status: 201 },
} as const;

export type RuntimeAgentDefinition = z.infer<
  typeof runtimeAgentDefinitionSchema
>;
export type RuntimeCreateSessionRequest = z.infer<
  typeof runtimeCreateSessionRequestSchema
>;
export type RuntimeCreateSessionResponse = z.infer<
  typeof runtimeCreateSessionResponseSchema
>;
export type RuntimeStartRunRequest = z.infer<
  typeof runtimeStartRunRequestSchema
>;
export type RuntimeSession = z.infer<typeof runtimeSessionSchema>;
export type RuntimeRun = z.infer<typeof runtimeRunSchema>;
export type RuntimeRunSnapshot = z.infer<typeof runtimeRunSnapshotSchema>;
export type RuntimeSessionSnapshot = z.infer<
  typeof runtimeSessionSnapshotSchema
>;
export type RuntimeAdmissionResponse = z.infer<
  typeof runtimeAdmissionResponseSchema
>;
export type RuntimeErrorResponse = z.infer<typeof runtimeErrorResponseSchema>;
export type RuntimeRegisteredSkill = z.infer<
  typeof runtimeRegisteredSkillSchema
>;
export type RuntimeCancelResponse = z.infer<typeof runtimeCancelResponseSchema>;

export type RuntimeSessionStatus = z.infer<typeof runtimeSessionStatusSchema>;
export type RuntimeSessionStatusesRequest = z.infer<
  typeof runtimeSessionStatusesRequestSchema
>;
export type RuntimeSessionStatusesResponse = z.infer<
  typeof runtimeSessionStatusesResponseSchema
>;
