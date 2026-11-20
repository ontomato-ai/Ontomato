import { modelSelectionSchema } from "./model-settings";
import { z } from "zod";
import { agentHostAgentSchema } from "./agent-host";
import {
  runtimeSkillNamespaceSchema,
  runtimeSkillRefSchema,
} from "./agent-runtime-skills";
import {
  runtimeKeySchema,
  runtimeIdSchema,
  runtimeTimestampSchema,
} from "./agent-runtime-values";
import { skillCatalogDiagnosticsSchema } from "./skills";
export const assistantAgentDefinitionSchema = agentHostAgentSchema.extend({
  executionUserId: z.string().trim().min(1).nullable(),
  modelSelection: modelSelectionSchema,
  skills: z.array(runtimeSkillRefSchema),
  classNames: z.array(z.string().trim().min(1)).default([]),
  enabledMcpServiceIds: z.array(runtimeIdSchema).default([]),
  sortOrder: z.number().int().default(0),
  systemPrompt: z.string(),
});
export const assistantAgentDefinitionListSchema = z
  .object({ agents: z.array(assistantAgentDefinitionSchema) })
  .strict();
export type AssistantAgentDefinitionList = z.infer<
  typeof assistantAgentDefinitionListSchema
>;
export const assistantSkillOptionSchema = z.object({
  skill: runtimeSkillRefSchema,
  title: z.string(),
  description: z.string(),
}).strict();
export const assistantSkillCatalogSchema = z.object({
  skills: z.array(assistantSkillOptionSchema),
  diagnostics: skillCatalogDiagnosticsSchema.optional(),
}).strict();
export type AssistantSkillOption = z.infer<typeof assistantSkillOptionSchema>;
export type AssistantSkillCatalog = z.infer<typeof assistantSkillCatalogSchema>;
/** A definition write can refer to the caller's domain without knowing its ID. */
export const assistantSkillInputSchema = runtimeSkillRefSchema.extend({
  namespace: z.discriminatedUnion("kind", [
    runtimeSkillNamespaceSchema.options[0],
    z
      .object({ kind: z.literal("domain"), domainId: runtimeKeySchema.optional() })
      .strict(),
  ]),
});
export const assistantAgentInputSchema = assistantAgentDefinitionSchema
  .omit({
    id: true,
  })
  .extend({
    name: assistantAgentDefinitionSchema.shape.name.trim().min(1),
    executionUserId: assistantAgentDefinitionSchema.shape.executionUserId.optional(),
    sortOrder: assistantAgentDefinitionSchema.shape.sortOrder.removeDefault().optional(),
    modelSelection: modelSelectionSchema.default({ modelId: null }),
    skills: z.array(assistantSkillInputSchema),
  });
/** An omitted skills field preserves the definition's existing selection. */
export const assistantAgentUpdateInputSchema = assistantAgentInputSchema.partial({ skills: true });
export type AssistantAgentUpdateInput = z.infer<typeof assistantAgentUpdateInputSchema>;

/** The settings panel carries unedited MCP and avatar values, and leaves sorting to the native owner. */
export const assistantAgentPanelValuesSchema = assistantAgentInputSchema.omit({ sortOrder: true }).extend({
  enabledMcpServiceIds: assistantAgentInputSchema.shape.enabledMcpServiceIds.removeDefault(),
});
export const assistantAgentPanelUpdateValuesSchema = assistantAgentPanelValuesSchema.partial({ skills: true });
export const assistantAgentValidationSchema = z.union([
  z.object({ target: z.object({ id: z.string().uuid() }).strict(), form: assistantAgentUpdateInputSchema }).strict(),
  z.object({ target: z.object({}).strict(), form: assistantAgentInputSchema }).strict(),
]);
export type AssistantAgentValidation = z.infer<typeof assistantAgentValidationSchema>;
export const agentExecutionOptionsSchema = z.object({
  selected: z.object({
    id: z.string().min(1), name: z.string(), available: z.boolean(), reason: z.enum(["disabled", "deleted", "not-member"]).optional(),
  }).strict().optional(),
  canSetExecutionUser: z.boolean(),
  users: z.array(z.object({ id: z.string().min(1), name: z.string() }).strict()),
}).strict();
export type AgentExecutionOptions = z.infer<typeof agentExecutionOptionsSchema>;
export type AssistantAgentDefinition = z.infer<
  typeof assistantAgentDefinitionSchema
>;
export type AssistantAgentInput = z.infer<typeof assistantAgentInputSchema>;
export const assistantAgentOptionSchema = agentHostAgentSchema.extend({
  effectiveSkills: z.array(runtimeSkillRefSchema),
}).strict();
export const assistantAgentListSchema = z.object({
  agents: z.array(assistantAgentOptionSchema),
  /** Present only for a page-filtered directory. */
  defaultAgentId: runtimeIdSchema.optional(),
}).strict();
export type AssistantAgentList = z.infer<typeof assistantAgentListSchema>;
/** Only accepted copied datasets receive a source; generic JSON files do not. */
export const assistantDatasetSourceSchema = z.union([
  z.object({ retrievalId: runtimeIdSchema, sourceArtifactId: runtimeIdSchema }).strict(),
  z.object({ retrievalId: runtimeIdSchema, sourceOutputId: runtimeIdSchema }).strict(),
]);
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
