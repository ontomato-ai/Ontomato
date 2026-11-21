import type { PanelFormField } from "@ontomato/contracts/panel-projection";

/**
 * The drawn field a message at `path` is shown on, by its absolute path: the field itself, a field of an object or of
 * a list's row, or a language of a text kept in several. A message no drawn field shows (a hidden field's, a part of a
 * value no control draws on its own, or the whole form's) lands nowhere: it is said with the form itself.
 */
export function fieldShowing(fields: readonly PanelFormField[], path: string, at = ""): string | null {
  for (const field of fields) {
    if (field.control.kind === "hidden") continue;
    if (path === field.path) return at + field.path;
    if (!path.startsWith(`${field.path}/`)) continue;
    const rest = path.slice(field.path.length);
    const control = field.control;
    if (control.kind === "localized-text") return /^\/[^/]+$/.test(rest) ? at + field.path : null;
    if (control.kind === "object") return fieldShowing(control.fields, rest, at + field.path);
    if (control.kind === "object-array") {
      const row = /^(\/\d+)(\/.*)$/.exec(rest);
      return row ? fieldShowing(control.itemFields, row[2]!, at + field.path + row[1]) : null;
    }
    return null;
  }
  return null;
}
