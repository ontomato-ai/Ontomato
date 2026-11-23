export interface CellAttachment {
  url: string;
  caption: string;
  kind: "image" | "pdf" | "file";
}

/** Recognize attachment values without interpreting source data as HTML. */
export function cellAttachments(text: string): CellAttachment[] {
  let value: unknown = text.trim();
  if (!value) return [];
  if (typeof value === "string" && /^[[{]/.test(value)) {
    try { value = JSON.parse(value); } catch { return []; }
  }
  const items = Array.isArray(value) ? value : [value];
  if (!items.length) return [];
  const attachments: CellAttachment[] = [];
  for (const item of items) {
    const object = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null;
    const url = typeof item === "string" ? item.trim() : typeof object?.path === "string" ? object.path.trim() : "";
    // Relative web paths and HTTP(S) only; never execute a scheme supplied by a data row.
    if (!url || Array.from(url).some((ch) => ch.charCodeAt(0) <= 0x20 || ch === "\\") || !/^(?:https?:\/\/|\/(?!\/)|\.\.?\/)/i.test(url)) return [];
    const pathname = url.split(/[?#]/)[0]!;
    const kind = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(pathname) ? "image"
      : /\.pdf$/i.test(pathname) ? "pdf" : "file";
    // Plain prose/URLs stay text unless their extension identifies supported media.
    if (!object && kind === "file") return [];
    let name = pathname.split("/").at(-1) || url;
    try { name = decodeURIComponent(name); } catch { /* Keep the original file name. */ }
    attachments.push({ url, kind, caption: typeof object?.text === "string" && object.text.trim() ? object.text : name });
  }
  return attachments;
}
