import { z } from "zod";
import {
  runtimeIdSchema, runtimeJsonValueSchema, runtimeKeySchema,
  runtimeSequenceSchema, runtimeTimestampSchema,
} from "./agent-runtime-values";

/** Opaque host content: the runtime never interprets a type or validates its business payload. */
export const runtimeArtifactContentSchema = z.object({
  type: runtimeKeySchema, payload: runtimeJsonValueSchema,
}).strict();
/** References are transport metadata, outside the opaque content. They must already be committed. */
export const runtimeArtifactOutputSchema = z.object({
  content: runtimeArtifactContentSchema, references: z.array(runtimeIdSchema),
}).strict();
/** (runId, toolCallId, outputIndex) identifies an immutable output across live/history reads. */
export const runtimeArtifactSchema = runtimeArtifactOutputSchema.extend({
  id: runtimeIdSchema, sessionId: runtimeIdSchema, runId: runtimeIdSchema,
  toolCallId: runtimeKeySchema, outputIndex: runtimeSequenceSchema,
  createdAt: runtimeTimestampSchema,
}).strict();
export type RuntimeArtifactContent = z.infer<typeof runtimeArtifactContentSchema>;
export type RuntimeArtifactOutput = z.infer<typeof runtimeArtifactOutputSchema>;
export type RuntimeArtifact = z.infer<typeof runtimeArtifactSchema>;
