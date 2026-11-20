import { panelDownloadFileSchema, panelDownloadReceiptSchema, type PanelDownloadFile } from "@ontomato/contracts/panel-download";

/*
 * A file the panel's page hands the reader (A's download contract, 2026-11-21): a PNG the page drew, or the file an
 * owner's read operation sent. The panel runs in the platform's own page, so the browser saves it here; no host takes
 * part. Its name and type are the contract's one rule: a single file name with the extension of one of the allowed
 * types, or the file is refused, saying why.
 */

export type PanelDownloadReceipt = ReturnType<typeof panelDownloadReceiptSchema.parse>;

/** Saves one file for the reader, under its own name, and says what was saved. */
export function savePanelFile(file: PanelDownloadFile): PanelDownloadReceipt {
  const { bytes, mime, suggestedName } = panelDownloadFileSchema.parse(file);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();
  // The browser starts the save from the click; the address is released once it has.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { kind: "file", name: suggestedName, mime };
}

/**
 * The file name an owner's attachment names: its `filename*` (RFC 5987, percent-encoded in its charset) before its
 * plain `filename`. A file without a name is refused.
 */
export function attachmentName(disposition: string): string {
  const extended = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition);
  if (extended) return decodeURIComponent(extended[1]!.trim());
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(disposition);
  if (plain) return plain[1] !== undefined ? plain[1].replace(/\\(.)/g, "$1") : plain[2]!.trim();
  throw new Error("The file the owner sent carries no name");
}
