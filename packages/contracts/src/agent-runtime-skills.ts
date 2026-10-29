import { z } from "zod";
import {
  runtimeKeySchema,
  runtimeRelativePathSchema,
} from "./agent-runtime-values";

export const runtimeSkillNamespaceSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("provider"), provider: runtimeKeySchema })
    .strict(),
  z.object({ kind: z.literal("domain"), domainId: runtimeKeySchema }).strict(),
]);
export const runtimeSkillRefSchema = z
  .object({
    namespace: runtimeSkillNamespaceSchema,
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
/** Package identity is the same at management and runtime publication boundaries. */
export const standardSkillFrontmatterSchema = z.object({
  name: runtimeSkillRefSchema.shape.name,
  description: z.string().min(1).max(1024).refine((value) => !!value.trim()),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  "allowed-tools": z.string().optional(),
}).strict();
export type StandardSkillFrontmatter = z.infer<typeof standardSkillFrontmatterSchema>;

export function runtimeSkillKey(skill: RuntimeSkillRef): string {
  return JSON.stringify([skill.namespace.kind,
    skill.namespace.kind === "provider" ? skill.namespace.provider : skill.namespace.domainId,
    skill.name]);
}
export const runtimeRegisteredSkillSchema = z
  .object({
    skill: runtimeSkillRefSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    description: z.string().min(1).max(1024),
  })
  .strict();
export const runtimeRegisterSkillRequestSchema = z
  .object({
    skill: runtimeSkillRefSchema,
    files: z
      .array(
        z
          .object({ path: runtimeRelativePathSchema, content: z.string() })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine(({ files }, ctx) => {
    const paths = new Set(files.map((f) => f.path));
    if (paths.size !== files.length || !paths.has("SKILL.md"))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unique files including SKILL.md are required",
      });
  });
export const runtimeEndUserCredentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bearer"), value: runtimeKeySchema }).strict(),
  z.object({ kind: z.literal("token"), value: runtimeKeySchema }).strict(),
  z.object({ kind: z.literal("api_key"), value: runtimeKeySchema }).strict(),
  z.object({ kind: z.literal("none") }).strict(),
]);
export const runtimeIdentityEnvironment = [
  "ONTOMATO_SESSION_ID",
  "ONTOMATO_RUN_ID",
  "ONTOMATO_CORRELATION_ID",
  "ONTOMATO_LANGUAGE",
  "ONTOMATO_WORKSPACE",
  "ONTOMATO_OUTPUT_DIR",
] as const;
const variable = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const runtimeEnvironmentSchema = z
  .object({
    values: z.record(
      variable,
      z.string().refine((v) => !v.includes("\0")),
    ),
    secrets: z.record(
      variable,
      z.string().refine((v) => !v.includes("\0")),
    ),
  })
  .strict()
  .superRefine(({ values, secrets }, ctx) => {
    for (const name of [...Object.keys(values), ...Object.keys(secrets)])
      if (
        runtimeIdentityEnvironment.includes(
          name as (typeof runtimeIdentityEnvironment)[number],
        ) ||
        (name in values && name in secrets) ||
        [
          "PATH",
          "HOME",
          "TMPDIR",
          "NODE_OPTIONS",
          "NODE_PATH",
          "LD_PRELOAD",
          "LD_LIBRARY_PATH",
          "PYTHONHOME",
          "PYTHONPATH",
        ].includes(name) ||
        name.startsWith("RUNTIME_")
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Reserved or repeated environment variable: ${name}`,
        });
  });
export type RuntimeSkillRef = z.infer<typeof runtimeSkillRefSchema>;
export type RuntimeEnvironment = z.infer<typeof runtimeEnvironmentSchema>;
