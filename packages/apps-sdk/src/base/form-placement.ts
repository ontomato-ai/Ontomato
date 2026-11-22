import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  panelFormObjectActiveFields,
  panelFormObjectActiveVariant,
  type PanelFormField,
  type PanelFormValues,
} from "@ontomato/contracts/panel-projection";
import { jsonValuesEqual, valueAt, withValueAt } from "../panel/form-values";

function isPlainObject(value: RuntimeJsonValue | undefined): value is PanelFormValues {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

/**
 * The drawn field a message at `path` is shown on, by its absolute path: the field itself, an active child field of a
 * present object or of an existing list row, or a language of a text kept in several. A message no currently drawn
 * field shows (a hidden field's, an inactive variant's, a null object's child, or the whole form's) lands nowhere: it
 * is said with the form itself.
 */
export function fieldShowing(
  fields: readonly PanelFormField[],
  values: PanelFormValues,
  path: string,
  at = "",
): string | null {
  for (const field of fields) {
    if (field.control.kind === "hidden") continue;
    const fieldAtPath = at + field.path;
    if (path === field.path) return fieldAtPath;
    if (!path.startsWith(`${field.path}/`)) continue;
    const rest = path.slice(field.path.length);
    const control = field.control;
    if (control.kind === "localized-text") return /^\/[^/]+$/.test(rest) ? fieldAtPath : null;
    if (control.kind === "object") {
      const current = valueAt(values, fieldAtPath);
      if (!isPlainObject(current)) return null;
      return fieldShowing(panelFormObjectActiveFields(control, current), values, rest, fieldAtPath);
    }
    if (control.kind === "object-array") {
      const row = /^(\/(\d+))(\/.*)$/.exec(rest);
      if (!row) return null;
      const rows = valueAt(values, fieldAtPath);
      const index = Number(row[2]);
      if (!Array.isArray(rows) || !isPlainObject(rows[index])) return null;
      return fieldShowing(control.itemFields, values, row[3]!, fieldAtPath + row[1]!);
    }
    return null;
  }
  return null;
}

/**
 * The owner's active description of the field an absolute pointer names, resolving discriminated object variants
 * against the current `values`. Returns undefined when the pointer names no active field (such as a field in an
 * inactive variant, a child of a null object, or an out-of-range array row).
 */
export function activeFieldAt(
  fields: readonly PanelFormField[],
  values: PanelFormValues,
  path: string,
  base = "",
): PanelFormField | undefined {
  for (const field of fields) {
    const at = base + field.path;
    if (path === at) return field;
    if (!path.startsWith(`${at}/`)) continue;
    const { control } = field;
    if (control.kind === "object") {
      const current = valueAt(values, at);
      if (!isPlainObject(current)) return undefined;
      return activeFieldAt(panelFormObjectActiveFields(control, current), values, path, at);
    }
    if (control.kind === "object-array") {
      const rowToken = path.slice(at.length + 1).split("/")[0]!;
      const index = Number(rowToken);
      const rows = valueAt(values, at);
      if (!/^\d+$/.test(rowToken) || !Array.isArray(rows) || !isPlainObject(rows[index])) return undefined;
      return activeFieldAt(control.itemFields, values, path, `${at}/${rowToken}`);
    }
  }
  return undefined;
}

/** Top-level described field paths whose values differ between two form snapshots, independent of object key order. */
export function changedFieldPaths(
  fields: readonly PanelFormField[],
  before: PanelFormValues,
  after: PanelFormValues,
): ReadonlySet<string> {
  return new Set(
    fields
      .filter((field) => !jsonValuesEqual(valueAt(before, field.path), valueAt(after, field.path)))
      .map((field) => field.path),
  );
}

/**
 * Copies inactive object-variant field values from `previous` into `next`, recursively across nested objects and
 * object-array rows, without overwriting any active field or any value `next` already carries. Used after an owner
 * refresh (`refreshOnChange`) so pruning the request payload never drops draft values the reader typed in other variants.
 */
export function preserveInactiveVariantValues(
  fields: readonly PanelFormField[],
  previous: PanelFormValues,
  next: PanelFormValues,
): PanelFormValues {
  let merged = next;
  for (const field of fields) {
    const { control } = field;
    if (control.kind === "object") {
      const prevObj = valueAt(previous, field.path);
      const nextObj = valueAt(merged, field.path);
      if (!isPlainObject(prevObj) || !isPlainObject(nextObj)) continue;
      let updated = nextObj;
      const activeFields = panelFormObjectActiveFields(control, updated);
      if (control.variants) {
        const activeVariant = panelFormObjectActiveVariant(control, updated);
        const activePaths = activeFields.map((child) => child.path);
        for (const [key, variantFields] of Object.entries(control.variants)) {
          if (key === activeVariant) continue;
          for (const variantField of variantFields) {
            if (activePaths.some((activePath) => pathsOverlap(activePath, variantField.path))) continue;
            const kept = valueAt(prevObj, variantField.path);
            if (kept !== undefined && valueAt(updated, variantField.path) === undefined) {
              updated = withValueAt(updated, variantField.path, kept);
            }
          }
        }
      }
      updated = preserveInactiveVariantValues(activeFields, prevObj, updated);
      if (updated !== nextObj) merged = withValueAt(merged, field.path, updated);
    } else if (control.kind === "object-array") {
      const prevRows = valueAt(previous, field.path);
      const nextRows = valueAt(merged, field.path);
      if (!Array.isArray(prevRows) || !Array.isArray(nextRows)) continue;
      const keyPath = control.itemKeyPath;
      let changed = false;
      const mergedRows = nextRows.map((row, index) => {
        if (!isPlainObject(row)) return row;
        const rowKey = keyPath ? valueAt(row, keyPath) : undefined;
        const prevRow = keyPath && rowKey !== undefined
          ? prevRows.find((candidate) => isPlainObject(candidate) && jsonValuesEqual(valueAt(candidate, keyPath), rowKey))
          : prevRows[index];
        if (!isPlainObject(prevRow)) return row;
        const updated = preserveInactiveVariantValues(control.itemFields, prevRow, row);
        if (updated !== row) changed = true;
        return updated;
      });
      if (changed) merged = withValueAt(merged, field.path, mergedRows);
    }
  }
  return merged;
}
