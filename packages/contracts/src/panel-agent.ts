import { z } from "zod";
import { agentExecutionRefSchema, agentSessionRefSchema } from "./agent-channel";
import { agentQuestionAnswerReceiptSchema, agentUserQuestionReceiptSchema } from "./agent-user-questions";
import { formFieldErrorSchema } from "./form-fields";
import {
  panelMemberPathSchema, panelObjectIdentitySchema, panelOperationCallSchema, panelOperationIdSchema, panelOperationSchema,
} from "./panel-manifest";
import {
  panelBatchInvocationSchema, panelOperationAffectedSchema, panelOperationImpactSchema, panelOwnerOperationDescriptorSchema,
  panelReadOperationCallSchema, panelSingleInvocationSchema,
} from "./panel-operations";
import { ontologyElementRefSchema } from "./ontology-element-ref";
import { EXECUTE_OBJECT_ACTION } from "./platform-object-types";
import { panelUseRefSchema } from "./product-panels";
import { pageDraftSchema } from "./page-draft";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeKeySchema } from "./agent-runtime-values";

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
  operationId: panelOperationIdSchema,
  memberPath: z.lazy(() => panelMemberPathSchema.nonempty()).optional(),
}).strict();
export type PanelOperationRef = z.infer<typeof panelOperationRefSchema>;

/** Resolve the declared read under the caller's authority without creating a write intent. */
export const readPanelOperationRequestSchema = panelOperationRefSchema.extend({
  call: panelReadOperationCallSchema,
});
export type ReadPanelOperationRequest = z.infer<typeof readPanelOperationRequestSchema>;
export { panelReadOperationJsonResultSchema as readPanelOperationResponseSchema } from "./panel-operations";

export { panelOwnerOperationDescriptorSchema as panelOperationDescriptorResponseSchema } from "./panel-operations";
const panelIntentRequestScopeSchema = panelOperationRefSchema.extend({ intentId: runtimeIdSchema });

/** The host supplies session/run/initiator/executor from authenticated context. */
export const createPanelOperationIntentRequestSchema = z.union([
  panelIntentRequestScopeSchema.merge(panelSingleInvocationSchema),
  panelIntentRequestScopeSchema.merge(panelBatchInvocationSchema),
]);
export type CreatePanelOperationIntentRequest = z.infer<typeof createPanelOperationIntentRequestSchema>;

/** Both human and agent confirmation inspect the exact calls that will be decided together. */
export const inspectPanelOperationImpactRequestSchema = z.union([
  panelOperationRefSchema.merge(panelSingleInvocationSchema),
  panelOperationRefSchema.merge(panelBatchInvocationSchema),
]);

/** Dispatch reads the immutable stored call and channel evidence. No questionId, approval or changed call is accepted. */
export const dispatchPanelOperationIntentRequestSchema = z.object({}).strict();

const panelHumanSingleInvocationSchema = z.object({ call: panelOperationCallSchema.omit({ draft: true }) }).strict();

/** Node supplies the intent ID and the initiator from the authenticated reader. */
export const createPanelHumanOperationIntentRequestSchema = z.union([
  panelOperationRefSchema.merge(panelHumanSingleInvocationSchema),
  panelOperationRefSchema.merge(panelBatchInvocationSchema),
]);
export type CreatePanelHumanOperationIntentRequest = z.infer<typeof createPanelHumanOperationIntentRequestSchema>;

/** A multi-target batch names its targets. A single call confirms only when its owner inspects the impact. */
export const panelHumanOperationConfirmationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("impact"), impact: panelOperationImpactSchema }).strict(),
  z.object({
    kind: z.literal("batch"),
    targets: panelOperationImpactSchema.omit({ summary: true }),
    impact: panelOperationImpactSchema.optional(),
  }).strict(),
]);
export type PanelHumanOperationConfirmation = z.infer<typeof panelHumanOperationConfirmationSchema>;

/** Preparation returned by POST /panel-operations/intents and reread by the host before displaying confirmation. */
export const panelHumanOperationPreparationSchema = z.object({
  intentId: runtimeIdSchema,
  operationId: panelOperationIdSchema,
  label: z.string().min(1).max(200),
  confirmation: panelHumanOperationConfirmationSchema,
}).strict();
export type PanelHumanOperationPreparation = z.infer<typeof panelHumanOperationPreparationSchema>;

/** GET /panel-operation-intents/:intentId and POST /panel-operations/intents/:intentId/dispatch. */
export const panelHumanOperationIntentParamsSchema = z.object({ intentId: runtimeIdSchema }).strict();

/** The host dispatches the frozen intent once after confirmation. */
export const dispatchPanelHumanOperationIntentRequestSchema = dispatchPanelOperationIntentRequestSchema;

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
    errors: z.array(formFieldErrorSchema).optional(),
  }).strict(),
  z.object({
    kind: z.literal("failure"), code: key, message: z.string(), details: runtimeJsonObjectSchema.optional(),
  }).strict(),
  /** A dispatch with no authoritative answer is never released for redispatch. */
  z.object({ kind: z.literal("unknown"), message: z.string() }).strict(),
]);

export const panelOperationOutcomeSchema = z.discriminatedUnion("kind", [
  ...singleOutcomeSchema.options,
  z.object({
    kind: z.literal("batch"),
    items: z.array(z.object({ target: panelObjectIdentitySchema, outcome: singleOutcomeSchema }).strict()).nonempty(),
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
  object: panelObjectIdentitySchema,
}).strict();
export type PanelObjectActionSnapshot = z.infer<typeof panelObjectActionSnapshotSchema>;

export const panelWriteOperationSnapshotSchema = panelOwnerOperationDescriptorSchema.extend({
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
  panelId: key,
  projectionId: key.nullable(),
  binding: ontologyElementRefSchema.nullable(),
  initiator: initiatorSchema,
  /** Claimed atomically before the owner call and never reset. */
  dispatched: z.boolean(),
}).strict();

const intentFactsSchema = commonIntentFactsSchema.extend({
  /** Original question execution for provenance; later dispatch binds only its session. */
  source: agentExecutionRefSchema,
  rootSession: agentSessionRefSchema,
  /** Null means the original initiator. */
  executionUserId: runtimeKeySchema.nullable(),
  confirmation: z.enum(["required", "automatic"]),
  questionId: runtimeIdSchema.nullable(),
  answer: agentQuestionAnswerReceiptSchema.omit({ text: true }).nullable(),
});

const currentOperationFields = {
  operation: panelWriteOperationSnapshotSchema,
  outcome: panelOperationOutcomeSchema.nullable(),
};
const currentIntentFactsSchema = intentFactsSchema.extend(currentOperationFields);

export const panelAgentOperationIntentSchema = z.union([
  currentIntentFactsSchema.merge(panelSingleInvocationSchema),
  currentIntentFactsSchema.merge(panelBatchInvocationSchema),
]);
export type PanelAgentOperationIntent = z.infer<typeof panelAgentOperationIntentSchema>;

const humanIntentFactsSchema = commonIntentFactsSchema.extend({
  ...currentOperationFields,
  source: z.object({ kind: z.literal("human") }).strict(),
  /** The host reads the frozen decision and names from Node for the same request. */
  confirmation: panelHumanOperationConfirmationSchema,
});
export const panelHumanOperationIntentSchema = z.union([
  humanIntentFactsSchema.merge(panelHumanSingleInvocationSchema),
  humanIntentFactsSchema.merge(panelBatchInvocationSchema),
]);
export type PanelHumanOperationIntent = z.infer<typeof panelHumanOperationIntentSchema>;

/** Node's single immutable intent contains either one call or every item of the batch. */
export const panelOperationIntentSchema = z.union([panelAgentOperationIntentSchema, panelHumanOperationIntentSchema]);
export type PanelOperationIntent = z.infer<typeof panelOperationIntentSchema>;

export function isPanelHumanOperationIntent(intent: PanelOperationIntent): intent is PanelHumanOperationIntent {
  return "kind" in intent.source;
}

const legacyStoredIntentSchema = intentFactsSchema.extend({
  operation: panelOperationSchema,
  call: panelOperationCallSchema,
  outcome: singleOutcomeSchema.nullable(),
});

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

export const panelOperateResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirmation-required"), intentId: runtimeIdSchema, question: agentUserQuestionReceiptSchema }).strict(),
  /** Default form.save returns the existing unsaved draft envelope; the CLI writes the existing draft artifact. */
  z.object({ kind: z.literal("draft"), intentId: runtimeIdSchema, draft: pageDraftSchema }).strict(),
  dispatchedResponseSchema, notDispatchedResponseSchema,
]);
export type PanelOperateResponse = z.infer<typeof panelOperateResponseSchema>;
