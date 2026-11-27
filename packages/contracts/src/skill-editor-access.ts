import { z } from "zod";
import { agentSkillTargetSchema } from "./skills";

/**
 * The platform:Skill/editorAccess owner fact shares admission with POST /authorization/objects/skill-editor-access.
 * - draft: target and ownerFacts are absent; Java evaluates `Create(Kind.AGENT)`.
 * - existing agent: target is the same AGENT object as agentTarget and ownerFacts are the workbench-owned row facts;
 *   Java evaluates `ObjectAccess(target, EDIT, ownerFacts)`.
 * - malformed combinations are 400; the result is the Java authorization Decision.
 */
export const skillEditorObjectTargetSchema = z.object({
  domainId: z.string().min(1),
  kind: z.literal("AGENT"),
  id: z.string().min(1),
}).strict();
export const skillEditorOwnerFactsSchema = z.object({
  ownerId: z.string().min(1).nullable(),
  state: z.enum(["DRAFT", "PUBLISHED"]),
}).strict();
export const skillEditorAccessRequestSchema = z.object({
  agentTarget: agentSkillTargetSchema,
  target: skillEditorObjectTargetSchema.optional(),
  ownerFacts: skillEditorOwnerFactsSchema.optional(),
}).strict();
export const skillEditorAccessDecisionSchema = z.object({
  allowed: z.boolean(),
  code: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
}).strict();
export type SkillEditorAccessRequest = z.infer<typeof skillEditorAccessRequestSchema>;
export type SkillEditorAccessDecision = z.infer<typeof skillEditorAccessDecisionSchema>;
