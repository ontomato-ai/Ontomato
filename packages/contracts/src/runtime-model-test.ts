import { z } from "zod";
import { modelConfigurationSchema, modelEntrySchema } from "./model-settings";

export const runtimeModelConfigurationSchema = modelConfigurationSchema;
export const runtimeModelTestRequestSchema = z.object({
  model: modelEntrySchema,
  prompt: z.string().nullish().transform(value => value?.trim() ? value : "Hello"),
}).strict();
export const runtimeModelTestResponseSchema = z.object({ content: z.string() }).strict();
export type RuntimeModelTestRequest = z.input<typeof runtimeModelTestRequestSchema>;
