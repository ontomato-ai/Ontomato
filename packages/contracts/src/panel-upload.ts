import { z } from "zod";
import { runtimeIdSchema, runtimeKeySchema } from "./agent-runtime-values";
import { panelDownloadBasenameSchema } from "./panel-download";

/** The platform's hard limit for one staged file; an owner declares its own lower limit. */
export const PANEL_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** Node path, under `/api`, where a person stages a file for an operation that declares an upload. */
export const PANEL_UPLOADS_PATH = "/panel-operations/uploads";
/** A staged file is kept this long for the operation it was staged for, including an owner's retry after a refusal. */
export const PANEL_UPLOAD_TTL_MINUTES = 15;
/** An agent cannot yet hand an operation a file; the person uploads it on the page. */
export const AGENT_UPLOAD_UNSUPPORTED = "AGENT_UPLOAD_UNSUPPORTED";

/** One accepted file kind: the name must end in `extension`, and the staged file is recorded as `mime`. */
export const panelUploadAcceptSchema = z.object({
  mime: z.string().min(1).max(200),
  extension: z.string().regex(/^\.[a-z0-9]+$/u),
}).strict();

/** The owner's declaration that the operation input `input` is a file, which kinds it takes and how large it may be. */
export const panelUploadDeclarationSchema = z.object({
  input: runtimeKeySchema,
  accept: z.array(panelUploadAcceptSchema).nonempty(),
  maxBytes: z.number().int().positive().max(PANEL_UPLOAD_MAX_BYTES),
}).strict();
export type PanelUploadDeclaration = z.infer<typeof panelUploadDeclarationSchema>;

/**
 * The value of the declared file input in a write call. Only a file the person staged exists today; a later branch may
 * point at a file an agent's run produced, confirmed and executed once the same way.
 */
export const panelFileInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("upload"), uploadId: runtimeIdSchema }).strict(),
]);
export type PanelFileInput = z.infer<typeof panelFileInputSchema>;

/** What the person staged, as named in the confirmation. */
export const panelUploadFileSchema = z.object({
  name: panelDownloadBasenameSchema,
  size: z.number().int().positive().max(PANEL_UPLOAD_MAX_BYTES),
  mime: z.string().min(1).max(200),
}).strict();
export type PanelUploadFile = z.infer<typeof panelUploadFileSchema>;

/** Response of `POST /api/panel-operations/uploads`. */
export const panelUploadReceiptSchema = panelUploadFileSchema.extend({ uploadId: runtimeIdSchema }).strict();
export type PanelUploadReceipt = z.infer<typeof panelUploadReceiptSchema>;

/** Whether `name` ends in one of the declared extensions; the first match names the recorded MIME type. */
export function panelUploadAccepted(declaration: { accept: readonly z.infer<typeof panelUploadAcceptSchema>[] }, name: string) {
  const lower = name.toLowerCase();
  return declaration.accept.find(kind => lower.endsWith(kind.extension));
}

/** A file size as a person reads it, in the reader's locale (`12 kB`, `1.5 MB`). */
export function panelUploadSize(bytes: number, locale?: string) {
  const [value, unit] = bytes >= 1024 * 1024 ? [bytes / 1024 / 1024, "megabyte"] : [Math.max(bytes / 1024, 0.1), "kilobyte"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(value);
}
