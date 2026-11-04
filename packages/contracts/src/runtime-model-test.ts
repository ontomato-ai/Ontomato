import { z } from "zod";
import { modelEntrySchema, modelProviderConnectionSchema, modelProviderIdSchema, modelRetrySchema } from "./model-settings";

/** Test the unsaved provider/model draft once; masks resolve by providerId in the authenticated domain. */
export const runtimeModelTestRequestSchema = z.object({
  providerId: modelProviderIdSchema,
  provider: modelProviderConnectionSchema,
  model: modelEntrySchema,
  retry: modelRetrySchema,
  prompt: z.string().nullish().transform(value => value?.trim() ? value : "Hello"),
}).strict();
export const runtimeModelTestResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat"), content: z.string() }).strict(),
  z.object({ type: z.literal("embedding"), dimensions: z.number().int().positive() }).strict(),
]);
export type RuntimeModelTestRequest = z.input<typeof runtimeModelTestRequestSchema>;
export type RuntimeModelTestResponse = z.output<typeof runtimeModelTestResponseSchema>;

/** Discovery returns candidates only; the caller chooses type and dimensions before saving. */
export const runtimeModelDiscoveryRequestSchema = runtimeModelTestRequestSchema.omit({ model: true, prompt: true });
export const runtimeModelDiscoveryResponseSchema = z.object({
  models: z.array(z.object({ id: z.string().min(1), name: z.string().optional() }).strict()),
}).strict();
export type RuntimeModelDiscoveryRequest = z.input<typeof runtimeModelDiscoveryRequestSchema>;
export type RuntimeModelDiscoveryResponse = z.output<typeof runtimeModelDiscoveryResponseSchema>;
