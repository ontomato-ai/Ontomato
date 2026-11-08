import { z } from "zod";

export const actionParameterSchema = z.object({
  name: z.string().min(1), type: z.string(), description: z.string(), required: z.boolean(),
});
export const assistantActionOptionSchema = z.object({
  id: z.string().min(1), name: z.string(), description: z.string(), version: z.string(),
  parameters: z.array(actionParameterSchema), effects: z.array(z.string()),
});
export const assistantActionProposalSchema = z.object({
  schema: z.literal("ontomato.action-proposal.v1"),
  actionId: z.string().min(1), version: z.string().min(1), reason: z.string().min(1),
  parameters: z.record(z.unknown()),
  display: z.object({
    summary: z.string().min(1),
    target: z.string().optional(),
    parameterLabels: z.record(z.string()).default({}),
  }).optional(),
}).strict();
export const assistantActionExecutionSchema = z.object({
  status: z.enum(["executing", "succeeded", "failed", "unknown"]),
  parameters: z.record(z.unknown()), result: z.unknown().nullable(), error: z.string().nullable(),
});
export const assistantActionCardSchema = z.object({
  proposal: assistantActionProposalSchema,
  action: assistantActionOptionSchema,
  execution: assistantActionExecutionSchema.nullable(),
});
export type AssistantActionOption = z.infer<typeof assistantActionOptionSchema>;
export type AssistantActionProposal = z.infer<typeof assistantActionProposalSchema>;
export type AssistantActionCard = z.infer<typeof assistantActionCardSchema>;
