import { z } from "zod";
import { modelConnectionNameSchema, modelConnectionWriteSchema, modelEntrySchema } from "./model-settings";

/**
 * Test one unsaved connection and model before saving; a masked key resolves by the connection name in the
 * authenticated domain, so an unsaved model can be tried with the key already stored for that connection.
 */
const modelDraftSchema = z.object({
  connectionName: modelConnectionNameSchema,
  connection: modelConnectionWriteSchema,
  prompt: z.string().nullish().transform(value => value?.trim() ? value : "Hello"),
}).strict();
export const runtimeModelTestRequestSchema = modelDraftSchema.extend({ model: modelEntrySchema }).strict();
export const runtimeModelTestResponseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat"), content: z.string() }).strict(),
  z.object({ type: z.literal("embedding"), dimensions: z.number().int().positive() }).strict(),
]);
export type RuntimeModelTestRequest = z.input<typeof runtimeModelTestRequestSchema>;
export type RuntimeModelTestResponse = z.output<typeof runtimeModelTestResponseSchema>;

/** Discovery returns candidates only; the caller chooses the name, type and dimensions before saving. */
export const runtimeModelDiscoveryRequestSchema = modelDraftSchema;
export const runtimeModelDiscoveryResponseSchema = z.object({
  models: z.array(z.object({ id: z.string().min(1) }).strict()),
}).strict();
export type RuntimeModelDiscoveryRequest = z.input<typeof runtimeModelDiscoveryRequestSchema>;
export type RuntimeModelDiscoveryResponse = z.output<typeof runtimeModelDiscoveryResponseSchema>;
