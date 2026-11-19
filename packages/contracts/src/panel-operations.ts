import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema, runtimeKeySchema } from "./agent-runtime-values";
import { panelOperationCallSchema } from "./panel-manifest";
import { panelFormValuesSchema } from "./panel-projection";

/** The owner selects a named input or form slot to resolve before invoking the operation. */
export const panelOwnerOperationTargetSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("input"), input: runtimeKeySchema }).strict(),
  z.object({ source: z.literal("draft"), slot: runtimeKeySchema }).strict(),
  z.object({ source: z.literal("none") }).strict(),
]);

/** The trusted owner supplies the effect and schemas. Requests carry only the operation identity and input. */
export const panelOwnerOperationDescriptorSchema = z.object({
  handlerRef: z.string().min(1).max(300),
  effect: z.enum(["read", "write"]),
  target: panelOwnerOperationTargetSchema,
  inputSchema: runtimeJsonObjectSchema,
  resultSchema: runtimeJsonObjectSchema,
}).strict();

export const panelReadOperationDescriptorSchema = panelOwnerOperationDescriptorSchema.extend({ effect: z.literal("read") });

/** A read-only trial takes the current form values plus the execution parameter values. */
export const panelReadOperationInputSchema = z.object({
  draft: panelFormValuesSchema,
  parameters: runtimeJsonObjectSchema,
  bindingId: runtimeKeySchema.optional(),
}).strict();

export const panelReadOperationCallSchema = panelOperationCallSchema.omit({ draft: true }).extend({
  input: panelReadOperationInputSchema,
});

/** A read returns content for this panel instance. */
export const panelReadOperationResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("markdown"), markdown: z.string() }).strict(),
  z.object({ kind: z.literal("json"), value: runtimeJsonValueSchema }).strict(),
]);
export type PanelReadOperationResult = z.infer<typeof panelReadOperationResultSchema>;
