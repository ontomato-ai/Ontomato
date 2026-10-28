import { z } from "zod";
import {
  runtimeEndUserCredentialSchema,
  runtimeSkillRefSchema,
} from "./agent-runtime-skills";
import {
  runtimeIdSchema,
  runtimeJsonObjectSchema,
  runtimeRelativePathSchema,
} from "./agent-runtime-values";

export const codeLimitsSchema = z
  .object({
    wallTimeMs: z.number().int().positive().default(120000),
    cpuSeconds: z.number().int().positive().default(120),
    memoryBytes: z
      .number()
      .int()
      .positive()
      .default(1024 * 1024 * 1024),
    processCount: z.number().int().positive().default(32),
    fileBytes: z
      .number()
      .int()
      .positive()
      .default(32 * 1024 * 1024),
    outputBytes: z
      .number()
      .int()
      .positive()
      .default(16 * 1024 * 1024),
  })
  .strict();
export const pythonBindingSchema = z
  .object({
    targetUrl: z.string().url().nullable(),
    credential: runtimeEndUserCredentialSchema,
    context: runtimeJsonObjectSchema,
    libraries: z.array(
      z
        .object({
          skill: runtimeSkillRefSchema,
          path: runtimeRelativePathSchema,
        })
        .strict(),
    ),
    limits: codeLimitsSchema,
  })
  .strict();
export const codeFileSchema = z
  .object({ path: runtimeRelativePathSchema, content: z.string() })
  .strict();
export const codeExecutionRequestSchema = z
  .object({
    language: z.literal("python"),
    files: z.array(codeFileSchema).min(1),
    entry: runtimeRelativePathSchema,
    arguments: z.array(z.string()),
    outputPaths: z.array(runtimeRelativePathSchema),
    binding: pythonBindingSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const paths = new Set(value.files.map((f) => f.path));
    if (paths.size !== value.files.length || !paths.has(value.entry))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unique files including the entry are required",
      });
  });
export const codeExecutionSchema = z
  .object({
    id: runtimeIdSchema,
    runId: runtimeIdSchema.nullable(),
    status: z.enum([
      "running",
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ]),
    source: z.string(),
    entry: runtimeRelativePathSchema,
    sourceSha256: z.string(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    outputs: z.array(z.string()),
    error: z.object({ code: z.string(), message: z.string() }).nullable(),
  })
  .strict();
export type CodeLimits = z.infer<typeof codeLimitsSchema>;
export type PythonBinding = z.infer<typeof pythonBindingSchema>;
export type CodeExecutionRequest = z.infer<typeof codeExecutionRequestSchema>;
export type CodeExecution = z.infer<typeof codeExecutionSchema>;
