import { z } from "zod";
import { panelMemberPathSchema } from "./panel-manifest";
import { defaultAgentSchema } from "./default-agent";
import { runtimeSkillRefSchema } from "./agent-runtime-skills";

const pageKeySchema = z.string().min(1);
export const pageSkillLocatorSchema = z.object({
  applicationId: z.string().min(1),
  entryKey: z.string().min(1),
  pageKey: pageKeySchema,
}).strict();
export type PageSkillLocator = z.infer<typeof pageSkillLocatorSchema>;

export const pageSkillEntranceSchema = pageSkillLocatorSchema;
export type PageSkillEntrance = PageSkillLocator;

/** Compare an entry's identity and its current page location. */
export function pageSkillPlacementKey({ applicationId, entryKey, pageKey }: PageSkillEntrance): string {
  return JSON.stringify([applicationId, entryKey, pageKey]);
}

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

const applicationPageSkillSourceSchema = z.object({
  kind: z.literal("application-use"), applicationId: z.string().min(1), useId: z.string().min(1),
}).strict();
export const pageSkillSourceSchema = z.discriminatedUnion("kind", [
  applicationPageSkillSourceSchema,
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
  z.object({
    mode: z.literal("member"), locator: pageSkillEntranceSchema, member: pageSkillMemberSchema.nullable(),
    entry: applicationPageSkillSourceSchema.optional(),
  }).strict(),
]);
export type PageSkillContext = z.infer<typeof pageSkillContextSchema>;

const pageSkillFields = {
  skill: runtimeSkillRefSchema,
  defaults: z.array(pageSkillDefaultSchema).optional(),
};

/** An application declaration already supplies the enclosing application ID. */
export const pageSkillSchema = pageSkillEntranceSchema.omit({ applicationId: true }).extend(pageSkillFields);
export type PageSkill = z.infer<typeof pageSkillSchema>;

/** Java's initiator projection carries a public skill only when the admitted entry has one. */
export const pageSkillsProjectionSchema = z.object({
  pageSkills: z.array(pageSkillEntranceSchema.extend(pageSkillFields).partial({ skill: true })),
  registeredSkills: z.array(runtimeSkillRefSchema),
  admittedEntrances: z.array(pageSkillEntranceSchema).optional(),
}).strict();
export type PageSkillsProjection = z.infer<typeof pageSkillsProjectionSchema>;

const queryPageSkillMemberSchema = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid member JSON" });
    return z.NEVER;
  }
}).pipe(pageSkillMemberSchema);

/** A member query carries the complete snapshot member in one URL parameter. */
export const assistantAgentsQuerySchema = z.union([
  z.object({}).strict(),
  pageSkillEntranceSchema.extend({ member: queryPageSkillMemberSchema.optional() }),
]);
export type AssistantAgentsQuery = z.infer<typeof assistantAgentsQuerySchema>;
