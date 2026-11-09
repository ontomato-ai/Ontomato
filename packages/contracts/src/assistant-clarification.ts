import { z } from "zod";

export const assistantClarificationSchema = z.object({
  schema: z.literal("ontomato.clarification.v1"),
  title: z.string().min(1).max(160),
  retrieval: z.object({ id: z.string().uuid(), runId: z.string().uuid(), decisionRevision: z.number().int().nonnegative() }).strict().optional(),
  questions: z.array(z.object({
    id: z.string().min(1), label: z.string().min(1).max(300),
    kind: z.enum(["single", "multiple", "date", "text"]),
    required: z.boolean().default(true),
    options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) }).strict()).max(12).default([]),
  }).strict()).min(1).max(6),
}).strict().superRefine((card, context) => {
  if (new Set(card.questions.map((question) => question.id)).size !== card.questions.length)
    context.addIssue({ code: "custom", message: "Question identities must be unique" });
  card.questions.forEach((question, index) => {
    if (["single", "multiple"].includes(question.kind) && !question.options.length)
      context.addIssue({ code: "custom", path: ["questions", index], message: "Choice questions require options" });
    if (new Set(question.options.map((option) => option.value)).size !== question.options.length)
      context.addIssue({ code: "custom", path: ["questions", index], message: "Option identities must be unique" });
  });
});

export const clarificationValuesSchema = z.object({
  values: z.record(z.union([z.string().max(4000), z.array(z.string().max(1000)).max(12)])),
  notes: z.string().max(4000).default(""),
}).strict();
export const clarificationStateSchema = clarificationValuesSchema.extend({
  status: z.enum(["draft", "submitted"]), continuationRunId: z.string().uuid().nullable(),
  locked: z.boolean().default(false),
  continuation: z.enum(["not_started", "pending", "accepted", "conversation", "stale", "needs_attention", "unavailable"]).default("not_started"),
});
