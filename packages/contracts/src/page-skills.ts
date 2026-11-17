import { z } from "zod";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";

const pageSkillFields = {
  skill: runtimeSkillRefSchema,
  defaults: z.array(z.object({
    pageKey: z.string().min(1),
    agentKey: z.string().min(1),
  }).strict()).optional(),
};

/** The application owns the mapping; leaf pages retain their existing menu codes. */
export const pageSkillSchema = z.union([
  z.object({ permissionCode: z.string().min(1), ...pageSkillFields }).strict(),
  z.object({ access: z.literal("domain-member"), ...pageSkillFields }).strict(),
]);
export type PageSkill = z.infer<typeof pageSkillSchema>;

export const pageSkillsProjectionSchema = z.object({
  pageSkills: z.array(pageSkillSchema),
  registeredSkills: z.array(runtimeSkillRefSchema),
}).strict();
export type PageSkillsProjection = z.infer<typeof pageSkillsProjectionSchema>;

/** pageKey selects a local default; permissionCode/access locates the mapping. */
export const assistantAgentsQuerySchema = z.union([
  z.object({}).strict(),
  z.object({ pageKey: z.string().min(1), permissionCode: z.string().min(1) }).strict(),
  z.object({ pageKey: z.string().min(1), access: z.literal("domain-member") }).strict(),
]);
export type AssistantAgentsQuery = z.infer<typeof assistantAgentsQuerySchema>;
