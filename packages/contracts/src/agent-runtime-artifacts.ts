import { z } from "zod";
import {
  runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema,
  runtimeKeySchema, runtimeSequenceSchema, runtimeTimestampSchema,
} from "./agent-runtime-values";

/** Tool-owned payloads. The runtime stores them; the host validates business meaning and renders. */
export const runtimeArtifactContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dataset"),
    payload: z.object({
      title: z.string(),
      columns: z.array(z.object({ key: runtimeKeySchema, label: z.string() }).strict()),
      rows: z.array(z.record(runtimeJsonValueSchema)),
      totalRows: runtimeSequenceSchema.nullable(),
      truncated: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("chart"),
    payload: z.object({
      title: z.string(), html: z.string(), datasetArtifactIds: z.array(runtimeIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("report"),
    payload: z.object({
      title: z.string(), markdown: z.string(), artifactIds: z.array(runtimeIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("input_request"),
    payload: z.object({
      title: z.string(),
      questions: z.array(z.object({
        id: runtimeKeySchema, prompt: z.string().min(1),
        options: z.array(z.object({ value: runtimeKeySchema, label: z.string() }).strict()).optional(),
      }).strict()).min(1),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("interpretation"),
    payload: z.object({
      title: z.string(), markdown: z.string(), sourceArtifactIds: z.array(runtimeIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("interpretation_check"),
    payload: z.object({
      interpretationArtifactId: runtimeIdSchema,
      outcome: z.enum(["confirmed", "conflict", "needs_input"]),
      explanation: z.string(), evidence: runtimeJsonObjectSchema,
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("file"),
    payload: z.object({
      name: runtimeKeySchema, mimeType: runtimeKeySchema,
      // Inline bytes are immutable; never expose a host path or an expiring download URL.
      dataBase64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    }).strict(),
  }).strict(),
]);

/** (runId, toolCallId, outputIndex) identifies one immutable output across live/history reads. */
export const runtimeArtifactSchema = z.object({
  id: runtimeIdSchema, sessionId: runtimeIdSchema, runId: runtimeIdSchema,
  toolCallId: runtimeKeySchema, outputIndex: runtimeSequenceSchema,
  createdAt: runtimeTimestampSchema, content: runtimeArtifactContentSchema,
}).strict();
export type RuntimeArtifactContent = z.infer<typeof runtimeArtifactContentSchema>;
export type RuntimeArtifact = z.infer<typeof runtimeArtifactSchema>;
