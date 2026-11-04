import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";

export const packagePathSchema = z.string().min(1).refine(
  (path) => !path.startsWith("/") && !path.includes("\\") &&
    !path.split("/").some((part) => !part || part === "." || part === "..") &&
    !path.includes(":"), "Expected a package-relative file path",
);
const role = z.enum(["value", "group", "filter", "join"]);
const input = z.union([
  z.object({ query: z.string().min(1), key: z.string().min(1), role }).strict(),
  z.object({ operation: z.string().min(1), role }).strict(),
]);
export const queryParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["TYPE_STRING", "TYPE_NUMBER", "TYPE_TIME", "TYPE_STRING_ARRAY", "TYPE_NUMBER_ARRAY",
    "TYPE_TIME_ARRAY", "TYPE_ONTOOBJ", "TYPE_DATASET", "TYPE_VECTOR"]),
  value: runtimeJsonValueSchema,
  description: z.string().nullable().optional(), sample: runtimeJsonValueSchema.optional(),
  classNames: z.array(z.string()).nullable().optional(),
}).strict();
export const queryPackageManifestSchema = z.object({
  schema: z.literal("ontomato.query-package.v1"),
  entry: z.union([
    z.object({ kind: z.literal("dsl"), query: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("python"), path: packagePathSchema }).strict(),
  ]),
  queries: z.record(packagePathSchema),
  modules: z.array(packagePathSchema),
  parameterDefs: z.array(queryParameterSchema),
  parameterBindings: z.array(z.object({
    query: z.string().min(1), pointer: z.string().startsWith("/"), parameter: z.string().min(1),
  }).strict()),
  computation: z.object({
    operations: z.array(z.object({
      id: z.string().min(1),
      operation: z.enum(["project", "filter", "group", "aggregate", "join", "calculate", "constant"]),
      expression: z.string().min(1), inputs: z.array(input),
    }).strict()),
    outputs: z.array(z.object({ key: z.string().min(1), from: z.string().min(1) }).strict()),
  }).strict().nullable(),
}).strict();
export const queryPackageShapeSchema = z.object({
  manifest: queryPackageManifestSchema,
  files: z.array(z.object({ path: packagePathSchema, content: z.string() }).strict()).min(1),
}).strict();
export const queryPackageSchema = queryPackageShapeSchema.superRefine((value, ctx) => {
  const paths = value.files.map((f) => f.path);
  const expected = [...Object.values(value.manifest.queries), ...value.manifest.modules,
    ...(value.manifest.entry.kind === "python" ? [value.manifest.entry.path] : [])];
  if (new Set(paths).size !== paths.length || new Set(expected).size !== expected.length ||
      JSON.stringify([...paths].sort()) !== JSON.stringify(expected.sort()))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Package files must match the manifest exactly" });
  if (value.manifest.entry.kind === "dsl" && !value.manifest.queries[value.manifest.entry.query])
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown DSL entry query" });
});
export type QueryPackage = z.infer<typeof queryPackageSchema>;

export const packageRecipeSchema = z.object({
  kind: z.literal("package"), package: queryPackageSchema,
  parameters: runtimeJsonObjectSchema,
  columnLabels: z.record(z.string().min(1)),
  packageSha256: z.string().optional(), executionInputSha256: z.string().optional(),
  // Removed with the separately coordinated package QC cutover.
  executedCode: z.string().optional(),
}).strict();
