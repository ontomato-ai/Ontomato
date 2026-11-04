import { z } from "zod";
import { modelReferenceSchema } from "./model-settings";

/** The runtime resolves the domain embedding selection; hosts provide no model or credentials. */
export const runtimeEmbeddingsRequestSchema = z.object({ texts: z.array(z.string()).nonempty() }).strict();
export const runtimeEmbeddingsResponseSchema = z.object({
  modelId: modelReferenceSchema,
  dimensions: z.number().int().positive(),
  vectors: z.array(z.array(z.number().finite())).nonempty(),
}).strict().superRefine(({ dimensions, vectors }, ctx) => {
  vectors.forEach((vector, index) => {
    if (vector.length !== dimensions) ctx.addIssue({ code: z.ZodIssueCode.custom,
      path: ["vectors", index], message: "Vector length must match dimensions" });
  });
});
export type RuntimeEmbeddingsRequest = z.input<typeof runtimeEmbeddingsRequestSchema>;
export type RuntimeEmbeddingsResponse = z.output<typeof runtimeEmbeddingsResponseSchema>;
