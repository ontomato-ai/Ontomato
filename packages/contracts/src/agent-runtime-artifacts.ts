import { z } from "zod";
import {
  runtimeIdSchema,
  runtimeKeySchema,
  runtimeRelativePathSchema,
  runtimeSequenceSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";
export const runtimeFileMetadataSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: runtimeSequenceSchema,
    mediaType: runtimeKeySchema,
  })
  .strict();
export const runtimeArtifactSchema = runtimeFileMetadataSchema
  .extend({
    id: runtimeIdSchema,
    sessionId: runtimeIdSchema,
    runId: runtimeIdSchema,
    toolCallId: runtimeKeySchema.nullable(),
    path: runtimeRelativePathSchema,
    createdAt: runtimeTimestampSchema,
    seq: runtimeSequenceSchema,
  })
  .strict();
export type RuntimeFileMetadata = z.infer<typeof runtimeFileMetadataSchema>;
export type RuntimeArtifact = z.infer<typeof runtimeArtifactSchema>;
