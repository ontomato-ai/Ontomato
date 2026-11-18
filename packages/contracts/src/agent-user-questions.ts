import { z } from "zod";
import {
  agentActorRefSchema,
  agentExecutionRefSchema,
  agentMessageSourceSchema,
  agentQuestionOptionsSchema,
  agentSessionRefSchema,
  agentUserRecipientSchema,
} from "./agent-channel";
import { runtimeIdSchema } from "./agent-runtime-values";

/** Service-only channel transport. The channel does not interpret business approval. */
export const agentUserQuestionRequestSchema = z.object({
  /** Restored by the host from its authenticated execution, never a model-selected sender. */
  source: agentExecutionRefSchema,
  message: z.string().min(1),
  defaultAssumption: z.string().min(1),
  options: agentQuestionOptionsSchema.optional(),
}).strict();
export type AgentUserQuestionRequest = z.infer<typeof agentUserQuestionRequestSchema>;

export { agentUserRecipientSchema, type AgentUserRecipient } from "./agent-channel";

export const agentUserQuestionReceiptSchema = z.object({
  questionId: runtimeIdSchema,
  source: agentExecutionRefSchema,
  recipient: agentUserRecipientSchema,
}).strict();
export type AgentUserQuestionReceipt = z.infer<typeof agentUserQuestionReceiptSchema>;

/** Optional addition to the EXISTING human answer request, not a separate answer endpoint. */
export const agentAnswerSelectionSchema = z.object({
  /** Zero-based index in the question's persisted options. Free text has no selected option. */
  selectedOption: z.number().int().nonnegative().optional(),
}).strict();
export type AgentAnswerSelection = z.infer<typeof agentAnswerSelectionSchema>;

/**
 * Channel-owned evidence read from persisted input, not accepted from a browser or a skill as proof.
 * The channel records provenance and selection; only the operation owner interprets their business meaning.
 */
export const agentQuestionAnswerReceiptSchema = z.object({
  questionId: runtimeIdSchema,
  answerId: runtimeIdSchema,
  source: agentMessageSourceSchema,
  /** The authenticated answer's caller reference; hosts restore the real initiator through the existing caller owner. */
  respondent: agentActorRefSchema,
  recipientSession: agentSessionRefSchema,
  selectedOption: z.number().int().nonnegative().nullable(),
  text: z.string(),
}).strict();
export type AgentQuestionAnswerReceipt = z.infer<typeof agentQuestionAnswerReceiptSchema>;
