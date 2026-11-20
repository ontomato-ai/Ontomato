import { z } from "zod";

export const panelDownloadMimeSchema = z.enum(["image/png", "text/csv", "application/zip"]);
export type PanelDownloadMime = z.infer<typeof panelDownloadMimeSchema>;

const extensions: Record<PanelDownloadMime, string> = {
  "image/png": ".png",
  "text/csv": ".csv",
  "application/zip": ".zip",
};

export const panelDownloadBasenameSchema = z.string().min(1).max(255).refine(
  (name) => name.trim().length > 0 && !name.startsWith(".") && !/[/\\\p{Cc}]/u.test(name),
  "Expected a single file basename without control characters or a leading dot",
);

function matchesExtension(mime: PanelDownloadMime, name: string): boolean {
  return name.toLowerCase().endsWith(extensions[mime]);
}

const extensionError = "The file extension must match the download MIME type";

/** The validated name and bytes handed directly to the browser or returned by a file-producing owner. */
export const panelDownloadFileSchema = z.object({
  bytes: z.union([z.instanceof(Blob), z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)]),
  mime: panelDownloadMimeSchema,
  suggestedName: panelDownloadBasenameSchema,
}).strict().refine(({ mime, suggestedName }) => matchesExtension(mime, suggestedName), {
  message: extensionError, path: ["suggestedName"],
});
export type PanelDownloadFile = z.infer<typeof panelDownloadFileSchema>;

/** The browser's receipt after saving the binary response of a read operation. */
export const panelDownloadReceiptSchema = z.object({
  kind: z.literal("file"),
  name: panelDownloadBasenameSchema,
  mime: panelDownloadMimeSchema,
}).strict().refine(({ mime, name }) => matchesExtension(mime, name), {
  message: extensionError, path: ["name"],
});
