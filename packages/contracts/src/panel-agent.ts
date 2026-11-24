import { z } from "zod";
import { agentExecutionRefSchema, agentSessionRefSchema } from "./agent-channel";
import { agentQuestionAnswerReceiptSchema } from "./agent-user-questions";
import { formFieldErrorSchema } from "./form-fields";
import {
  panelMemberPathSchema, panelObjectIdentitySchema, panelOperationCallSchema, panelOperationIdSchema,
  panelOperationSchema,
} from "./panel-manifest";
import {
  panelBatchInvocationSchema, panelOperationAffectedSchema, panelOperationImpactSchema, panelOwnerOperationDescriptorSchema,
  panelReadOperationCallSchema, panelSingleInvocationSchema,
} from "./panel-operations";
import { ontologyElementRefSchema } from "./ontology-element-ref";
import { EXECUTE_OBJECT_ACTION } from "./platform-object-types";
import { applicationFrameSourceSchema, panelUseRefSchema } from "./product-panels";
import { panelUploadFileSchema } from "./panel-upload";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema, runtimeKeySchema } from "./agent-runtime-values";

const key = z.string().min(1).max(200);

export { panelUseRefSchema, type PanelUseRef } from "./product-panels";

/** Node-owned user identity. Unlike a channel actor, userId is the restored initiator's actual host owner ID. */
const initiatorSchema = z.object({ domainId: runtimeKeySchema, userId: runtimeKeySchema }).strict();

export const panelOperationSettingsSchema = z.object({
  rootSession: agentSessionRefSchema,
  confirmBeforeExecute: z.boolean(),
}).strict();
export type PanelOperationSettings = z.infer<typeof panelOperationSettingsSchema>;
/** Authenticated root-session owner only; this request is not a skill/callback operation. */
export const updatePanelOperationSettingsRequestSchema = z.object({ confirmBeforeExecute: z.boolean() }).strict();
export type UpdatePanelOperationSettingsRequest = z.infer<typeof updatePanelOperationSettingsRequestSchema>;

/** Locate the published operation through its actual application use and any nested publisher. */
export const panelOperationRefSchema = panelUseRefSchema.extend({
  root: applicationFrameSourceSchema.shape.kind.optional(),
  operationId: panelOperationIdSchema,
  memberPath: z.lazy(() => panelMemberPathSchema.nonempty()).optional(),
}).strict();
export type PanelOperationRef = z.infer<typeof panelOperationRefSchema>;

/**
 * Multipart fields of `POST /api/panel-operations/uploads` besides the `file` part: `operation` is this ref as JSON text.
 * The file is kept for the reader and that operation only, and its receipt goes into the call's declared file input.
 */
export const panelUploadRequestSchema = z.object({ operation: panelOperationRefSchema }).strict();

/** Resolve the declared read under the caller's authority without creating a write intent. */
export const readPanelOperationRequestSchema = panelOperationRefSchema.extend({
  call: panelReadOperationCallSchema,
});
export type ReadPanelOperationRequest = z.infer<typeof readPanelOperationRequestSchema>;
export { panelReadOperationJsonResultSchema as readPanelOperationResponseSchema } from "./panel-operations";

export { panelOwnerOperationDescriptorSchema as panelOperationDescriptorResponseSchema } from "./panel-operations";
const panelHumanSingleInvocationSchema = panelSingleInvocationSchema;

/** Both human and agent confirmation inspect the exact calls that will be decided together. */
export const inspectPanelOperationImpactRequestSchema = z.union([
  panelOperationRefSchema.merge(panelSingleInvocationSchema),
  panelOperationRefSchema.merge(panelBatchInvocationSchema),
]);

/** Identifies the active agent tool call that asked the displayed page to execute an operation. */
export const panelAgentRunRefSchema = z.object({
  sessionId: runtimeIdSchema,
  runId: runtimeIdSchema,
  toolCallId: runtimeKeySchema,
}).strict();
export type PanelAgentRunRef = z.infer<typeof panelAgentRunRefSchema>;

/** Requests conversation confirmation for a destructive action on the live panel. */
export const localPanelConfirmationRequestSchema = z.object({
  agentRun: panelAgentRunRefSchema,
  operationLabel: z.string().min(1),
  targetLabel: z.string().min(1),
  impactSummary: z.string().min(1).optional(),
  requireConfirmation: z.boolean().optional(),
}).strict();
export type PanelLocalConfirmationRequest = z.infer<typeof localPanelConfirmationRequestSchema>;

const panelHumanIntentScopeSchema = panelOperationRefSchema.extend({
  agentRun: panelAgentRunRefSchema.optional(),
});

/** Node supplies the intent ID and the initiator from the authenticated reader. */
export const createPanelHumanOperationIntentRequestSchema = z.union([
  panelHumanIntentScopeSchema.merge(panelHumanSingleInvocationSchema),
  panelHumanIntentScopeSchema.merge(panelBatchInvocationSchema),
]);
export type CreatePanelHumanOperationIntentRequest = z.infer<typeof createPanelHumanOperationIntentRequestSchema>;

export const cancelPanelOperationIntentRequestSchema = z.object({
  code: key,
  message: z.string().min(1).max(1000),
}).strict();
export type CancelPanelOperationIntentRequest = z.infer<typeof cancelPanelOperationIntentRequestSchema>;

/** A multi-target batch names its targets. A single call confirms only when its owner inspects the impact. */
export const panelHumanOperationConfirmationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({
    kind: z.literal("impact"),
    impact: panelOperationImpactSchema,
    /** The staged file the call hands its owner, named beside what the owner said it affects. */
    upload: panelUploadFileSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("batch"),
    targets: panelOperationImpactSchema.omit({ summary: true }),
    impact: panelOperationImpactSchema.optional(),
    skippedSummary: z.string().min(1).optional(),
  }).strict(),
]);
export type PanelHumanOperationConfirmation = z.infer<typeof panelHumanOperationConfirmationSchema>;

/** Preparation returned by POST /panel-operations/intents and reread by the host before displaying confirmation. */
export const panelHumanOperationPreparationSchema = z.object({
  intentId: runtimeIdSchema,
  operationId: panelOperationIdSchema,
  label: z.string().min(1).max(200),
  confirmation: panelHumanOperationConfirmationSchema,
  /** Present for agent-initiated page actions: true when the conversation runs in full-auto mode. */
  autoMode: z.boolean().optional(),
  /** Present for agent-initiated page actions that require user confirmation in the conversation. */
  questionId: runtimeIdSchema.optional(),
}).strict();
export type PanelHumanOperationPreparation = z.infer<typeof panelHumanOperationPreparationSchema>;

/** GET /panel-operation-intents/:intentId and POST /panel-operations/intents/:intentId/dispatch. */
export const panelHumanOperationIntentParamsSchema = z.object({ intentId: runtimeIdSchema }).strict();

/** The host dispatches the stored call by intent ID. */
export const dispatchPanelHumanOperationIntentRequestSchema = z.object({}).strict();

const rejectedFormFields = {
  errors: z.array(formFieldErrorSchema).optional(),
  /** Acknowledged values, keyed by field pointer, when a save stopped after already saving some fields. */
  savedFields: z.record(formFieldErrorSchema.shape.field, runtimeJsonValueSchema).optional(),
  affected: panelOperationAffectedSchema.optional(),
};

const singleOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("success"),
    /** The owner's localized completion text, separate from the operation result. */
    message: z.string().min(1).optional(),
    data: runtimeJsonObjectSchema,
    affected: panelOperationAffectedSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal("refusal"), code: key, message: z.string(), details: runtimeJsonObjectSchema.optional(),
    /** Field validation failures use the same pointers and codes as form reads. */
    ...rejectedFormFields,
  }).strict(),
  z.object({
    kind: z.literal("failure"), code: key, message: z.string(), details: runtimeJsonObjectSchema.optional(),
    ...rejectedFormFields,
  }).strict(),
  /** A dispatch with no authoritative answer is never released for redispatch. */
  z.object({ kind: z.literal("unknown"), message: z.string() }).strict(),
]);

const batchItemOutcomeSchema = z.discriminatedUnion("kind", [
  ...singleOutcomeSchema.options,
  z.object({ kind: z.literal("skipped"), reason: z.string().min(1), code: key.optional() }).strict(),
]);

export const panelOperationOutcomeSchema = z.discriminatedUnion("kind", [
  ...singleOutcomeSchema.options,
  z.object({
    kind: z.literal("batch"),
    items: z.array(z.object({ target: panelObjectIdentitySchema, outcome: batchItemOutcomeSchema }).strict()).nonempty(),
    /** The owner may report the affected objects and types from successful writes once for the batch. */
    affected: panelOperationAffectedSchema.optional(),
  }).strict(),
]).superRefine((outcome, ctx) => {
  if (outcome.kind === "batch" && outcome.affected && !outcome.items.some(item => item.outcome.kind === "success"))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["affected"], message: "A batch needs a successful write to report changes" });
});
export type PanelOperationOutcome = z.infer<typeof panelOperationOutcomeSchema>;

/** The server resolves and freezes the owner description before confirmation. */
export const panelObjectActionSnapshotSchema = z.object({
  actionId: key,
  codeHash: z.string().regex(/^[a-f0-9]{64}$/u),
  /** Omitted for a targetless Action (`target: null`). */
  object: panelObjectIdentitySchema.optional(),
  /** Customer object types affected by a targetless Action, used for stale confirmation matching. */
  affects: z.array(runtimeKeySchema).optional(),
}).strict();
export type PanelObjectActionSnapshot = z.infer<typeof panelObjectActionSnapshotSchema>;

/** Availability is a live display fact. The owner checks the concrete target again when executing. */
export const panelWriteOperationSnapshotSchema = panelOwnerOperationDescriptorSchema.omit({ unavailable: true }).extend({
  id: panelOperationIdSchema,
  kind: z.enum(["form.save", "action"]),
  slot: key,
  memberPath: panelOperationRefSchema.shape.memberPath,
  publisherPanelId: key.optional(),
  effect: z.literal("write"),
  action: panelObjectActionSnapshotSchema.optional(),
}).superRefine((operation, ctx) => {
  if ((operation.handlerRef === EXECUTE_OBJECT_ACTION) !== (operation.action !== undefined))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["action"], message: "Only an object action carries its frozen owner facts" });
});

const commonIntentFactsSchema = z.object({
  intentId: runtimeIdSchema,
  use: panelUseRefSchema,
  root: panelOperationRefSchema.shape.root,
  panelId: key,
  projectionId: key.nullable(),
  binding: ontologyElementRefSchema.nullable(),
  initiator: initiatorSchema,
  /** Claimed atomically before the owner call and never reset. */
  dispatched: z.boolean(),
}).strict();

const legacyAgentIntentFactsSchema = commonIntentFactsSchema.extend({
  source: agentExecutionRefSchema,
  rootSession: agentSessionRefSchema,
  executionUserId: runtimeKeySchema.nullable(),
  confirmation: z.enum(["required", "automatic"]),
  questionId: runtimeIdSchema.nullable(),
  answer: agentQuestionAnswerReceiptSchema.omit({ text: true }).nullable(),
  invalidated: z.object({ code: key, message: z.string() }).strict().optional(),
});

const currentOperationFields = {
  operation: panelWriteOperationSnapshotSchema,
  outcome: panelOperationOutcomeSchema.nullable(),
};
const legacyCallSchema = panelOperationCallSchema.extend({ draft: z.unknown().optional() });
const legacyCurrentAgentIntentFactsSchema = legacyAgentIntentFactsSchema.extend(currentOperationFields);
const legacyAgentOperationIntentSchema = z.union([
  legacyCurrentAgentIntentFactsSchema.extend({ call: legacyCallSchema }),
  legacyCurrentAgentIntentFactsSchema.merge(panelBatchInvocationSchema),
]);

const humanIntentFactsSchema = commonIntentFactsSchema.extend({
  ...currentOperationFields,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("human") }).strict(),
    z.object({
      kind: z.literal("agent-page"),
      sessionId: runtimeIdSchema,
      runId: runtimeIdSchema,
      toolCallId: runtimeKeySchema,
      autoMode: z.boolean(),
      questionId: runtimeIdSchema.nullable(),
      confirmedBy: runtimeKeySchema.nullable().optional(),
    }).strict(),
  ]),
  /** The host reads the frozen decision and names from Node for the same request. */
  confirmation: panelHumanOperationConfirmationSchema,
  /** Set when an unexecuted confirmation is cancelled or invalidated because page/form state changed. */
  invalidated: z.object({ code: key, message: z.string() }).strict().optional(),
});
export const panelHumanOperationIntentSchema = z.union([
  humanIntentFactsSchema.merge(panelHumanSingleInvocationSchema),
  humanIntentFactsSchema.merge(panelBatchInvocationSchema),
]);
export type PanelHumanOperationIntent = z.infer<typeof panelHumanOperationIntentSchema>;

/** Node's single immutable intent contains either one call or every item of the batch. */
export const panelOperationIntentSchema = panelHumanOperationIntentSchema;
export type PanelOperationIntent = z.infer<typeof panelOperationIntentSchema>;

export function isPanelHumanOperationIntent(intent: PanelOperationIntent): intent is PanelHumanOperationIntent {
  return "kind" in intent.source;
}

const legacyStoredIntentSchema = z.union([
  legacyAgentOperationIntentSchema,
  legacyAgentIntentFactsSchema.extend({
    operation: panelOperationSchema,
    call: legacyCallSchema,
    outcome: singleOutcomeSchema.nullable(),
  }),
]);

export const PANEL_CONFIRMATION_EXPIRED = "PANEL_CONFIRMATION_EXPIRED";

/** At the persisted-data boundary, old records can report historical facts but cannot become current intents. */
export function readStoredPanelOperationIntent(value: unknown) {
  const current = panelOperationIntentSchema.safeParse(value);
  if (current.success) return { kind: "current", intent: current.data } as const;
  const legacy = legacyStoredIntentSchema.parse(value);
  if (legacy.dispatched || legacy.outcome !== null)
    return { kind: "historical", intent: legacy } as const;
  return { kind: "confirmation-expired", intentId: legacy.intentId, code: PANEL_CONFIRMATION_EXPIRED } as const;
}
export type StoredPanelOperationIntent = ReturnType<typeof readStoredPanelOperationIntent>;

const dispatchedResponseSchema = z.object({
  kind: z.literal("dispatched"), intentId: runtimeIdSchema, outcome: panelOperationOutcomeSchema.nullable(),
}).strict();
const notDispatchedResponseSchema = z.object({
  kind: z.literal("not-dispatched"), intentId: runtimeIdSchema, code: key, message: z.string(),
}).strict();

export const panelHumanOperationDispatchResponseSchema = z.discriminatedUnion("kind", [
  dispatchedResponseSchema, notDispatchedResponseSchema,
]);
export type PanelHumanOperationDispatchResponse = z.infer<typeof panelHumanOperationDispatchResponseSchema>;

export type SinglePanelOperationOutcome = z.infer<typeof singleOutcomeSchema>;
export type BatchItemOperationOutcome = z.infer<typeof batchItemOutcomeSchema>;

/**
 * Single authoritative classification of an owner panel operation outcome for agent-facing receipts,
 * shared by live browser receipts, confirmed-dispatch summaries, and server timeout recovery.
 *
 * Strictly distinguishes the 4 real states:
 * - `executed`: single success or a completed batch with only successful or skipped items.
 * - `partial`: refusal/failure that still persisted `savedFields` or recorded affected writes, or a batch with both
 *   recorded writes and explicit refusals/failures (never disguised as full `executed` or clean `failed`).
 * - `failed`: `not-dispatched`, refusal/failure with no recorded writes, or an all-failed batch — preserving the
 *   owner's exact error code (e.g. `TASK_RUNNING`) rather than collapsing to a generic code.
 * - `unknown`: null outcome, `unknown`, or any batch containing an `unknown` item.
 */
export type PanelOperationAgentClassification =
  | {
      readonly kind: "executed";
      readonly outcome: PanelOperationOutcome;
      readonly summary: string;
    }
  | {
      readonly kind: "partial";
      readonly code: string;
      readonly message: string;
      readonly outcome: PanelOperationOutcome;
      readonly savedFields?: readonly string[];
      readonly summary: string;
    }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly message: string;
      readonly outcome?: PanelOperationOutcome;
    }
  | {
      readonly kind: "unknown";
      readonly code: "ACTION_OUTCOME_UNKNOWN";
      readonly message: string;
      readonly outcome?: PanelOperationOutcome | null;
    };

function hasRecordedSingleWrites(outcome: BatchItemOperationOutcome): boolean {
  if (outcome.kind === "success") return true;
  if (outcome.kind === "unknown" || outcome.kind === "skipped") return false;
  return Object.keys(outcome.savedFields ?? {}).length > 0
    || Boolean(outcome.affected?.objects.length || outcome.affected?.removed?.length || outcome.affected?.objectTypes.length);
}

/** Classifies a recorded `PanelOperationOutcome` (or `null` when dispatched without an outcome yet). */
export function classifyPanelOperationOutcome(
  outcome: PanelOperationOutcome | null | undefined,
  intentId?: string,
): PanelOperationAgentClassification {
  if (!outcome) {
    return {
      kind: "unknown",
      code: "ACTION_OUTCOME_UNKNOWN",
      message: intentId
        ? `Operation was dispatched, but its outcome is not yet recorded. Check /api/panel-operation-intents/${intentId} without retrying.`
        : "Operation was dispatched, but its outcome is unknown.",
      outcome: null,
    };
  }
  if (outcome.kind === "unknown") {
    return {
      kind: "unknown",
      code: "ACTION_OUTCOME_UNKNOWN",
      message: outcome.message || "Operation was dispatched, but its outcome is unknown.",
      outcome,
    };
  }
  if (outcome.kind === "success") {
    return {
      kind: "executed",
      outcome,
      summary: outcome.message ?? "Completed successfully.",
    };
  }
  if (outcome.kind === "refusal" || outcome.kind === "failure") {
    const savedFields = Object.keys(outcome.savedFields ?? {});
    if (hasRecordedSingleWrites(outcome)) {
      const summary = savedFields.length
        ? `Partially completed (saved: ${savedFields.join(", ")}); ${outcome.message}`
        : `Partially completed: ${outcome.message}`;
      return {
        kind: "partial",
        code: outcome.code,
        message: outcome.message,
        outcome,
        ...(savedFields.length ? { savedFields } : {}),
        summary,
      };
    }
    return {
      kind: "failed",
      code: outcome.code,
      message: outcome.message,
      outcome,
    };
  }
  // Batch outcome.
  const unknownItem = outcome.items.find((item) => item.outcome.kind === "unknown");
  if (unknownItem) {
    const detail = unknownItem.outcome.kind === "unknown" && unknownItem.outcome.message
      ? unknownItem.outcome.message
      : intentId
        ? `Batch operation was dispatched with an unknown item outcome. Check /api/panel-operation-intents/${intentId} without retrying.`
        : "Batch operation was dispatched with an unknown item outcome.";
    return {
      kind: "unknown",
      code: "ACTION_OUTCOME_UNKNOWN",
      message: detail,
      outcome,
    };
  }
  const problems = outcome.items
    .map((item) => item.outcome)
    .filter((item): item is Extract<SinglePanelOperationOutcome, { kind: "refusal" | "failure" }> =>
      item.kind === "refusal" || item.kind === "failure",
    );
  const succeededCount = outcome.items.filter((item) => item.outcome.kind === "success").length;
  const skippedCount = outcome.items.filter((item) => item.outcome.kind === "skipped").length;
  const skipped = skippedCount ? `, ${skippedCount} skipped` : "";
  if (problems.length === 0) {
    return {
      kind: "executed",
      outcome,
      summary: `Batch completed: ${succeededCount}/${outcome.items.length} succeeded${skipped}.`,
    };
  }
  const firstProblem = problems[0]!;
  const anyRecordedWrites = outcome.items.some((item) => hasRecordedSingleWrites(item.outcome));
  if (!anyRecordedWrites) {
    return {
      kind: "failed",
      code: firstProblem.code,
      message: firstProblem.message,
      outcome,
    };
  }
  const savedFields = [...new Set(
    outcome.items.flatMap((item) =>
      item.outcome.kind === "refusal" || item.outcome.kind === "failure"
        ? Object.keys(item.outcome.savedFields ?? {})
        : [],
    ),
  )];
  return {
    kind: "partial",
    code: firstProblem.code,
    message: firstProblem.message,
    outcome,
    ...(savedFields.length ? { savedFields } : {}),
    summary: `Batch partially completed: ${succeededCount}/${outcome.items.length} succeeded${skipped}, ${problems.length} failed (${firstProblem.code}: ${firstProblem.message}).`,
  };
}

/** Classifies a full dispatch response (`not-dispatched` or `dispatched` + outcome) via the single shared classifier. */
export function classifyPanelOperationDispatch(
  response: PanelHumanOperationDispatchResponse,
  intentId?: string,
): PanelOperationAgentClassification {
  if (response.kind === "not-dispatched") {
    return {
      kind: "failed",
      code: response.code,
      message: response.message,
    };
  }
  return classifyPanelOperationOutcome(response.outcome, intentId ?? response.intentId);
}
