import { z } from "zod";
import { panelMemberPathSchema } from "./panel-manifest";
import { defaultAgentSchema } from "./default-agent";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";

const pageKeySchema = z.string().min(1);
const permissionCodeSchema = z.string().min(1);
const domainMemberLocator = z.object({ access: z.literal("domain-member"), pageKey: pageKeySchema }).strict();

export const pageSkillLocatorSchema = z.union([
  z.object({ permissionCode: permissionCodeSchema }).strict(),
  domainMemberLocator,
]);
export type PageSkillLocator = z.infer<typeof pageSkillLocatorSchema>;

export const pageSkillEntranceSchema = z.union([
  z.object({ permissionCode: permissionCodeSchema, pageKey: pageKeySchema }).strict(),
  domainMemberLocator,
]);
export type PageSkillEntrance = z.infer<typeof pageSkillEntranceSchema>;

export const pageSkillDefaultSchema = z.object({
  pageKey: pageKeySchema,
  defaultAgent: defaultAgentSchema,
}).strict();
export const pageSkillGroupSchema = z.object({
  locator: pageSkillLocatorSchema,
  skills: z.array(runtimeSkillRefSchema),
  defaults: z.array(pageSkillDefaultSchema),
}).strict();
export type PageSkillGroup = z.infer<typeof pageSkillGroupSchema>;

export const pageSkillSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("application-use"), applicationId: z.string().min(1), useId: z.string().min(1) }).strict(),
  z.object({
    kind: z.literal("object-detail"),
    useId: z.string().min(1),
    object: z.object({ className: z.string().min(1), primaryKey: z.string().min(1) }).strict(),
  }).strict(),
  z.object({ kind: z.literal("home") }).strict(),
  z.object({ kind: z.literal("panel-preview"), panelId: z.string().min(1) }).strict(),
]);
export type PageSkillSource = z.infer<typeof pageSkillSourceSchema>;

export const pageSkillMemberSchema = z.object({
  source: pageSkillSourceSchema,
  memberPath: panelMemberPathSchema,
  ref: runtimeSkillRefSchema,
}).strict();
export type PageSkillMember = z.infer<typeof pageSkillMemberSchema>;

export const pageSkillContextSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("public"), locator: pageSkillEntranceSchema }).strict(),
  z.object({ mode: z.literal("member"), locator: pageSkillEntranceSchema, member: pageSkillMemberSchema.nullable() }).strict(),
]);
export type PageSkillContext = z.infer<typeof pageSkillContextSchema>;

const pageSkillFields = {
  skill: runtimeSkillRefSchema,
  defaults: z.array(pageSkillDefaultSchema).optional(),
};

/** The application owns the mapping; leaf pages retain their existing menu codes. */
const pageSkillMappings = [
  z.object({ permissionCode: z.string().min(1), ...pageSkillFields }).strict(),
  z.object({ access: z.literal("domain-member"), pageKey: z.string().min(1), ...pageSkillFields }).strict(),
] as const;
export const pageSkillSchema = z.union(pageSkillMappings);
export type PageSkill = z.infer<typeof pageSkillSchema>;

/** Java's initiator projection carries a public skill only when the admitted group has one. */
export const pageSkillsProjectionSchema = z.object({
  pageSkills: z.array(z.union([
    pageSkillMappings[0].partial({ skill: true }),
    pageSkillMappings[1].partial({ skill: true }),
  ])),
  registeredSkills: z.array(runtimeSkillRefSchema),
  admittedEntrances: z.array(pageSkillEntranceSchema).optional(),
}).strict();
export type PageSkillsProjection = z.infer<typeof pageSkillsProjectionSchema>;

const queryPageSkillMemberSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}, pageSkillMemberSchema);

/** A member query carries the complete snapshot member in one URL parameter. */
export const assistantAgentsQuerySchema = z.union([
  z.object({}).strict(),
  z.object({ pageKey: pageKeySchema, permissionCode: permissionCodeSchema }).strict(),
  domainMemberLocator,
  z.object({ pageKey: pageKeySchema, permissionCode: permissionCodeSchema, member: queryPageSkillMemberSchema }).strict(),
  z.object({ access: z.literal("domain-member"), pageKey: pageKeySchema, member: queryPageSkillMemberSchema }).strict(),
]);
export type AssistantAgentsQuery = z.infer<typeof assistantAgentsQuerySchema>;
