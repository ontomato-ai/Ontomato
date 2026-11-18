import { z } from "zod";
import { agentExecutionRefSchema, agentSessionRefSchema } from "./agent-channel";
import { agentQuestionAnswerReceiptSchema, agentUserQuestionReceiptSchema } from "./agent-user-questions";
import { panelOperationCallSchema, panelOperationSchema } from "./panel-manifest";
import { ontologyElementRefSchema } from "./product-panels";
import { pageDraftSchema } from "./page-draft";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeKeySchema } from "./agent-runtime-values";

const key = z.string().min(1).max(200);

export const panelUseRefSchema = z.object({ applicationId: key, useId: key }).strict();
export type PanelUseRef = z.infer<typeof panelUseRefSchema>;

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

/** The host supplies session/run/initiator/executor from authenticated context, not this body. */
export const createPanelOperationIntentRequestSchema = panelUseRefSchema.extend({
  intentId: runtimeIdSchema,
  operationId: key,
  call: panelOperationCallSchema,
}).strict();
export type CreatePanelOperationIntentRequest = z.infer<typeof createPanelOperationIntentRequestSchema>;
/** Dispatch reads the immutable stored call and channel evidence. No questionId, approval or changed call is accepted. */
export const dispatchPanelOperationIntentRequestSchema = z.object({}).strict();

export const panelOperationOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("success"), data: runtimeJsonObjectSchema }).strict(),
  z.object({ kind: z.literal("failure"), code: key, message: z.string(), details: runtimeJsonObjectSchema.optional() }).strict(),
  /** A dispatched call with no authoritative answer is never released for redispatch. */
  z.object({ kind: z.literal("unknown"), message: z.string() }).strict(),
]);
export type PanelOperationOutcome = z.infer<typeof panelOperationOutcomeSchema>;

/** Node's minimal invocation fact; no revision history, approval workflow or credential snapshot. */
export const panelOperationIntentSchema = z.object({
  intentId: runtimeIdSchema,
  source: agentExecutionRefSchema,
  rootSession: agentSessionRefSchema,
  use: panelUseRefSchema,
  panelId: key,
  projectionId: key.nullable(),
  binding: ontologyElementRefSchema.nullable(),
  /** Server-derived description at this invocation; dispatch resolves current semantics again, never an old version. */
  operation: panelOperationSchema,
  call: panelOperationCallSchema,
  initiator: initiatorSchema,
  /** C-package semantics: null means the original initiator; otherwise the run's fixed real execution user. */
  executionUserId: runtimeKeySchema.nullable(),
  confirmation: z.enum(["required", "automatic"]),
  /** Server-assigned message identity, reserved with this intent before user-question delivery. */
  questionId: runtimeIdSchema.nullable(),
  /** Keep authorization provenance, not another copy of the channel-owned answer text. */
  answer: agentQuestionAnswerReceiptSchema.omit({ text: true }).nullable(),
  /** Claimed atomically before the owner call and never reset, including on a refusal or unknown result. */
  dispatched: z.boolean(),
  outcome: panelOperationOutcomeSchema.nullable(),
}).strict();
export type PanelOperationIntent = z.infer<typeof panelOperationIntentSchema>;

export const panelOperateResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirmation-required"), intentId: runtimeIdSchema, question: agentUserQuestionReceiptSchema }).strict(),
  /** Default form.save returns the existing unsaved draft envelope; the CLI writes the existing draft artifact. */
  z.object({ kind: z.literal("draft"), intentId: runtimeIdSchema, draft: pageDraftSchema }).strict(),
  z.object({ kind: z.literal("dispatched"), intentId: runtimeIdSchema, outcome: panelOperationOutcomeSchema.nullable() }).strict(),
  z.object({ kind: z.literal("not-dispatched"), intentId: runtimeIdSchema, code: key, message: z.string() }).strict(),
]);
export type PanelOperateResponse = z.infer<typeof panelOperateResponseSchema>;
