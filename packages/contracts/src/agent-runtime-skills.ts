import { z } from "zod";
import { runtimeArtifactContentSchema } from "./agent-runtime-artifacts";
import {
  runtimeFailureSchema, runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema,
  runtimeKeySchema, runtimeRelativePathSchema,
} from "./agent-runtime-values";

/** Provider names are configured against service identities; they are not claimed by scripts. */
export const runtimeSkillNamespaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("provider"), provider: runtimeKeySchema }).strict(),
  z.object({ kind: z.literal("domain"), domainId: runtimeKeySchema }).strict(),
]);
export const runtimeSkillRefSchema = z.object({
  namespace: runtimeSkillNamespaceSchema,
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  version: runtimeKeySchema,
}).strict();

/** runtime.json, referenced by SKILL.md metadata. This is the single tool declaration owner. */
export const runtimeSkillManifestSchema = z.object({
  version: runtimeKeySchema,
  tools: z.array(z.object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    description: z.string().min(1),
    inputSchema: runtimeJsonObjectSchema,
    outputSchema: runtimeJsonObjectSchema.optional(),
    entry: runtimeRelativePathSchema.refine((path) => path.endsWith(".mjs")),
  }).strict()),
  contextEntry: runtimeRelativePathSchema.refine((path) => path.endsWith(".mjs")).optional(),
}).strict();

/** Push all package files. No server-side fetching and no caller-supplied host filesystem paths. */
export const runtimeRegisterSkillRequestSchema = z.object({
  skill: runtimeSkillRefSchema,
  files: z.array(z.object({
    path: runtimeRelativePathSchema,
    content: z.string(),
  }).strict()).min(1),
}).strict().superRefine(({ files }, ctx) => {
  const paths = new Set(files.map((file) => file.path));
  if (paths.size !== files.length || !paths.has("SKILL.md") || !paths.has("runtime.json")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unique paths, SKILL.md and runtime.json are required" });
  }
});
export const runtimeRegisteredSkillSchema = z.object({
  skill: runtimeSkillRefSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: runtimeSkillManifestSchema,
}).strict();

/** One JSON document on stdin followed by EOF. Identity and credentials only arrive via env. */
export const runtimeSkillInputSchema = z.discriminatedUnion("kind", [
  z.object({
    protocolVersion: z.literal(1), kind: z.literal("tool"),
    toolName: runtimeKeySchema, arguments: runtimeJsonObjectSchema,
  }).strict(),
  z.object({ protocolVersion: z.literal(1), kind: z.literal("context") }).strict(),
]);
const skillErrorSchema = z.object({ type: z.literal("error"), error: runtimeFailureSchema }).strict();
export const runtimeToolSkillOutputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), text: z.string(), data: runtimeJsonValueSchema.optional() }).strict(),
  z.object({
    type: z.literal("result"), text: z.string(), data: runtimeJsonValueSchema.optional(),
    artifacts: z.array(runtimeArtifactContentSchema),
  }).strict(),
  skillErrorSchema,
]);
export const runtimeContextSkillOutputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("context_result"), systemContext: z.string() }).strict(),
  skillErrorSchema,
]);
export const runtimeSkillOutputSchema = z.union([
  runtimeToolSkillOutputSchema, runtimeContextSkillOutputSchema,
]);

/** String-valued child env, freshly constructed; never inherit the runtime's service secrets. */
export const RUNTIME_SKILL_ENV = {
  sessionId: "ONTOMATO_SESSION_ID",
  runId: "ONTOMATO_RUN_ID",
  invocationId: "ONTOMATO_INVOCATION_ID",
  toolCallId: "ONTOMATO_TOOL_CALL_ID",
  domainId: "ONTOMATO_DOMAIN_ID",
  correlationId: "ONTOMATO_CORRELATION_ID",
  language: "ONTOMATO_LANGUAGE",
  targetUrl: "ONTOMATO_TARGET_URL",
  credential: "ONTOMATO_CREDENTIAL_JSON",
  context: "ONTOMATO_CONTEXT_JSON",
  workspace: "ONTOMATO_WORKSPACE",
} as const;

/** Credentials are opaque to the runtime, except for the temporary Java model-read adapter. */
export const runtimeEndUserCredentialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("token"), value: runtimeKeySchema }).strict(),
  z.object({ kind: z.literal("api_key"), value: runtimeKeySchema }).strict(),
]);
export const runtimeSkillInvocationIdentitySchema = z.object({
  sessionId: runtimeIdSchema, runId: runtimeIdSchema,
  invocationId: runtimeIdSchema, toolCallId: runtimeKeySchema.nullable(),
}).strict();

export type RuntimeSkillRef = z.infer<typeof runtimeSkillRefSchema>;
export type RuntimeSkillManifest = z.infer<typeof runtimeSkillManifestSchema>;
export type RuntimeSkillInput = z.infer<typeof runtimeSkillInputSchema>;
export type RuntimeSkillOutput = z.infer<typeof runtimeSkillOutputSchema>;
export type RuntimeSkillInvocationIdentity = z.infer<typeof runtimeSkillInvocationIdentitySchema>;
