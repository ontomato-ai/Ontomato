import { z } from "zod";
import { runtimeJsonValueSchema } from "./agent-runtime-values";

/** A model-extracted intent is frozen at admission, not a grant or a verified interpretation. */
export const queryIntentSchema = z.object({
  schema: z.literal("ontomato.query-intent.v1"),
  conditions: z.array(z.object({
    id: z.string().min(1), quote: z.string().min(1),
    mapping: z.object({ className: z.string().min(1), field: z.string().min(1),
      operator: z.enum(["=", "!=", ">", ">=", "<", "<=", "in", "like"]), value: runtimeJsonValueSchema,
    }).strict().nullable(),
  }).strict()).max(64),
  outputs: z.array(z.string().min(1)).min(1),
}).strict().superRefine((value, context) => {
  if (new Set(value.conditions.map(item => item.id)).size !== value.conditions.length)
    context.addIssue({ code: "custom", message: "Condition identities must be unique" });
});

export const queryCoverageSchema = z.object({
  status: z.enum(["covered", "partial", "unverified"]),
  conditions: z.array(z.object({ id: z.string(), status: z.enum(["present", "missing", "unmapped", "unverified"]) }).strict()),
  checks: z.array(z.string()),
}).strict();

/** A retriever may resolve an unknown mapping, never replace the admitted condition. */
export const queryConditionBindingsSchema = z.record(z.object({
  className: z.string().min(1), field: z.string().min(1),
  operator: z.enum(["=", "!=", ">", ">=", "<", "<=", "in", "like"]), value: runtimeJsonValueSchema,
}).strict());
