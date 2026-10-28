import { z } from "zod";
import { agentHostAgentSchema } from "./agent-host";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";
import { retrievalSnapshotSchema } from "./data-retrieval";
import {
  runtimeKeySchema,
  runtimeIdSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";
export const assistantGraphScopeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("panorama") }).strict(),
  z
    .object({
      mode: z.literal("subgraph"),
      rootClassNames: z.array(z.string().trim().min(1)).min(1),
      maxDepth: z.number().int().min(0).max(10),
    })
    .strict(),
]);
export type AssistantGraphScope = z.infer<typeof assistantGraphScopeSchema>;
export const assistantAgentDefinitionSchema = agentHostAgentSchema.extend({
  modelRole: runtimeKeySchema,
  skills: z.array(runtimeSkillRefSchema),
  classNames: z.array(z.string().trim().min(1)).default([]),
  graphScope: assistantGraphScopeSchema.default({ mode: "panorama" }),
  enabledMcpServiceNames: z.array(z.string().trim().min(1)).default([]),
  sortOrder: z.number().int().default(0),
  systemPrompt: z.string(),
});
export const assistantAgentDefinitionListSchema = z
  .object({ agents: z.array(assistantAgentDefinitionSchema) })
  .strict();
export type AssistantAgentDefinitionList = z.infer<
  typeof assistantAgentDefinitionListSchema
>;
export const assistantAgentInputSchema = assistantAgentDefinitionSchema
  .omit({
    id: true,
  })
  .extend({ modelRole: runtimeKeySchema.optional() });
export type AssistantAgentDefinition = z.infer<
  typeof assistantAgentDefinitionSchema
>;
export type AssistantAgentInput = z.infer<typeof assistantAgentInputSchema>;
/** Only accepted copied datasets receive a source; generic JSON files do not. */
export const assistantDatasetSourceSchema = z
  .object({
    retrievalId: runtimeIdSchema,
    sourceArtifactId: runtimeIdSchema,
    qualityCheck: retrievalSnapshotSchema.shape.qualityCheck,
  })
  .strict();
export const assistantFeedbackTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), id: runtimeIdSchema }).strict(),
  z.object({ kind: z.literal("artifact"), id: runtimeIdSchema }).strict(),
]);
export const assistantFeedbackWriteSchema = z
  .object({
    runId: runtimeIdSchema,
    target: assistantFeedbackTargetSchema,
    rating: z.enum(["like", "dislike"]),
    text: z.string(),
  })
  .strict()
  .refine(
    (value) => value.rating !== "dislike" || value.text.trim().length > 0,
    { message: "A reason is required for dislike", path: ["text"] },
  );
export const assistantFeedbackSchema = z
  .object({
    id: runtimeIdSchema,
    sessionId: runtimeIdSchema,
    runId: runtimeIdSchema,
    target: assistantFeedbackTargetSchema,
    rating: z.enum(["like", "dislike"]),
    text: z.string(),
    updatedAt: runtimeTimestampSchema,
  })
  .strict();
export const assistantFeedbackListSchema = z
  .object({
    feedback: z.array(assistantFeedbackSchema),
  })
  .strict();
export type AssistantDatasetSource = z.infer<
  typeof assistantDatasetSourceSchema
>;
export type AssistantFeedbackTarget = z.infer<
  typeof assistantFeedbackTargetSchema
>;
export type AssistantFeedbackWrite = z.infer<
  typeof assistantFeedbackWriteSchema
>;
export type AssistantFeedback = z.infer<typeof assistantFeedbackSchema>;
export type AssistantFeedbackList = z.infer<typeof assistantFeedbackListSchema>;
