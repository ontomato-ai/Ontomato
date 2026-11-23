import { z } from "zod";
import {
  runtimeIdSchema,
  runtimeKeySchema,
  runtimeRelativePathSchema,
} from "./agent-runtime-values";

/**
 * A process entry shown beside the reply: engine facts the conversation would otherwise lose, such as a
 * changed file, a context compaction or a warning. It is one shape for every execution engine, so the shell
 * renders it without knowing which engine produced it and the entry survives a refresh.
 *
 * `key` is the entry's identity inside the run: a later entry with the same key replaces the earlier one
 * (a running difference view, a warning whose wording changes), and entries with different keys accumulate.
 * `text` is the only thing the shell must show; the other fields are what the category means, validated
 * here instead of carrying an engine's native payload.
 */
export const runtimeRunDetailCategorySchema = z.enum([
  "file_change",
  "compaction",
  "diagnostic",
  "attachment",
  "hook",
  "model",
  "moderation",
  "review",
]);
/** What a detail is about. `message` and `tool` also name which one, in `ref`. */
export const runtimeRunDetailScopeSchema = z.enum(["session", "run", "message", "tool"]);
const fields = { key: runtimeKeySchema, text: z.string().min(1), ref: z.string().min(1).nullable() };

/** A file the run added, changed or removed, with the change when the engine reports one. */
export const runtimeFileChangeDetailSchema = z
  .object({
    ...fields,
    category: z.literal("file_change"),
    scope: z.literal("run"),
    path: runtimeRelativePathSchema,
    operation: z.enum(["added", "modified", "deleted"]),
    patch: z.string().nullable(),
  })
  .strict();

/** The engine's own context compaction: the platform conversation keeps its history either way. */
export const runtimeCompactionDetailSchema = z
  .object({
    ...fields,
    category: z.literal("compaction"),
    scope: z.literal("run"),
    status: z.enum(["started", "completed"]),
  })
  .strict();

/** Something the engine reported that the user should know, with what can be done about it. */
export const runtimeDiagnosticDetailSchema = z
  .object({
    ...fields,
    category: z.literal("diagnostic"),
    scope: z.enum(["session", "run", "message", "tool"]),
    level: z.enum(["info", "warning", "error"]),
    action: z.string().nullable(),
  })
  .strict();

/** An attachment or a setting the engine changed for itself during the run. */
export const runtimeAttachmentDetailSchema = z
  .object({
    ...fields,
    category: z.literal("attachment"),
    scope: z.enum(["run", "message"]),
    object: runtimeKeySchema,
    operation: z.string().min(1),
  })
  .strict();

/** An engine hook that ran, and its visible output when it has one. */
export const runtimeHookDetailSchema = z
  .object({
    ...fields,
    category: z.literal("hook"),
    scope: z.enum(["run", "tool"]),
    name: runtimeKeySchema,
    status: z.enum(["started", "completed"]),
  })
  .strict();

/** The model that actually served a reply, when it differs from the one the platform selected. */
export const runtimeModelDetailSchema = z
  .object({
    ...fields,
    category: z.literal("model"),
    scope: z.enum(["run", "message"]),
    model: runtimeKeySchema,
  })
  .strict();

/** A moderation or safety hold the engine reported, with the stage the user is waiting in. */
export const runtimeModerationDetailSchema = z
  .object({
    ...fields,
    category: z.literal("moderation"),
    scope: z.literal("run"),
    stage: z.string().min(1),
    reason: z.string().nullable(),
  })
  .strict();

/** An engine-side review of the run that produced a visible conclusion. */
export const runtimeReviewDetailSchema = z
  .object({
    ...fields,
    category: z.literal("review"),
    scope: z.enum(["run", "message"]),
    name: runtimeKeySchema,
    status: z.enum(["started", "completed"]),
  })
  .strict();

export const runtimeRunDetailSchema = z
  .discriminatedUnion("category", [
    runtimeFileChangeDetailSchema,
    runtimeCompactionDetailSchema,
    runtimeDiagnosticDetailSchema,
    runtimeAttachmentDetailSchema,
    runtimeHookDetailSchema,
    runtimeModelDetailSchema,
    runtimeModerationDetailSchema,
    runtimeReviewDetailSchema,
  ])
  .superRefine((detail, context) => {
    const named = detail.scope === "message" || detail.scope === "tool";
    if (named === (detail.ref === null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A message or tool detail names its subject; every other detail names none",
      });
    if (detail.scope === "message" && detail.ref && !runtimeIdSchema.safeParse(detail.ref).success)
      context.addIssue({ code: z.ZodIssueCode.custom, message: "A message detail refers to a message id" });
  });

export type RuntimeRunDetail = z.infer<typeof runtimeRunDetailSchema>;
export type RuntimeRunDetailCategory = z.infer<typeof runtimeRunDetailCategorySchema>;
export type RuntimeFileChangeDetail = z.infer<typeof runtimeFileChangeDetailSchema>;
