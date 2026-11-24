import type { FormFieldRejection } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { findPanelFormOption } from "@ontomato/contracts/form-fields";
import {
  panelFormObjectActiveFields,
  panelFormObjectActiveVariant,
  type PanelFormField,
  type PanelFormValues,
} from "@ontomato/contracts/panel-projection";
import { admitsNull, jsonValuesEqual, valueAt, withValueAt } from "../panel/form-values";

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

export interface ResolvedActiveFormField {
  readonly field: PanelFormField;
  readonly readOnly: boolean;
  readonly readOnlyReason?: string;
}

/**
 * Resolves the active visible field at `path` together with effective read-only state inherited from any ancestor
 * `object` or `object-array` field. Hidden fields and their descendants are treated as absent.
 */
export function resolveActiveField(
  fields: readonly PanelFormField[],
  values: PanelFormValues,
  path: string,
  base = "",
  inheritedReadOnly = false,
  inheritedReadOnlyReason?: string,
): ResolvedActiveFormField | undefined {
  for (const field of fields) {
    if (field.control.kind === "hidden") continue;
    const at = base + field.path;
    const readOnly = inheritedReadOnly || field.readOnly;
    const readOnlyReason = inheritedReadOnly
      ? inheritedReadOnlyReason
      : (field.readOnly ? field.readOnlyReason : undefined);
    if (path === at) return { field, readOnly, ...(readOnlyReason ? { readOnlyReason } : {}) };
    if (!path.startsWith(`${at}/`)) continue;
    const { control } = field;
    if (control.kind === "object") {
      const current = valueAt(values, at);
      if (!isPlainObject(current)) return undefined;
      return resolveActiveField(
        panelFormObjectActiveFields(control, current),
        values,
        path,
        at,
        readOnly,
        readOnlyReason,
      );
    }
    if (control.kind === "object-array") {
      const rowToken = path.slice(at.length + 1).split("/")[0]!;
      const index = Number(rowToken);
      const rows = valueAt(values, at);
      if (!/^\d+$/.test(rowToken) || !Array.isArray(rows) || !isPlainObject(rows[index])) return undefined;
      return resolveActiveField(
        control.itemFields,
        values,
        path,
        `${at}/${rowToken}`,
        readOnly,
        readOnlyReason,
      );
    }
  }
  return undefined;
}

/**
 * Validates that a value assigned via `fillForm` respects the same UI restrictions a human control enforces:
 * - A select can retain unavailable choices already held by the field.
 * - A choice matrix can retain unavailable tiers and historical rows, and cannot change a disabled row.
 * - Whole-object and whole-array assignments cannot alter nested `fixed`, `readOnly`, or `hidden` child fields,
 *   and nested editable children obey the same option/composite constraints.
 */
export function validateFormFieldValue(
  field: PanelFormField,
  pointer: string,
  value: RuntimeJsonValue,
  currentValues: PanelFormValues,
  fixedValues: Readonly<Record<string, RuntimeJsonValue>>,
): FormFieldRejection | null {
  return validateAssignedValue(field, pointer, value, valueAt(currentValues, pointer), fixedValues);
}

function validateAssignedValue(
  field: PanelFormField,
  pointer: string,
  value: RuntimeJsonValue,
  currentValue: RuntimeJsonValue | undefined,
  fixedValues: Readonly<Record<string, RuntimeJsonValue>>,
): FormFieldRejection | null {
  const { control } = field;
  const invalid = (message: string): FormFieldRejection => ({ path: pointer, reason: "invalid_value", message });
  if (control.kind === "select") {
    const checkChoice = (choice: RuntimeJsonValue): FormFieldRejection | null => {
      const matched = findPanelFormOption(control.options, choice);
      if (matched?.disabled) return invalid(matched.disabledReason!);
      if (!matched && !control.allowCreate)
        return invalid(`Value ${JSON.stringify(choice)} is not an allowed option for field ${pointer}.`);
      return null;
    };
    if (control.multiple) {
      if (!Array.isArray(value)) return invalid(`Field ${pointer} expects an array of choices.`);
      const currentChoices = Array.isArray(currentValue) ? currentValue : [];
      for (const item of value) {
        if (currentChoices.some(held => jsonValuesEqual(held, item))) continue;
        const rejection = checkChoice(item);
        if (rejection) return rejection;
      }
      return null;
    }
    if (jsonValuesEqual(value, currentValue)) return null;
    if (value === null) {
      const objectSelect = control.options.some(option => typeof option.value === "object");
      return !field.required && (objectSelect || admitsNull(field.valueSchema))
        ? null
        : invalid(`Field ${pointer} requires choosing one of its allowed options.`);
    }
    return checkChoice(value);
  }

  if (control.kind === "choice-matrix") {
    if (!isPlainObject(value)) return invalid(`Field ${pointer} expects an object of row choices.`);
    const currentObj = isPlainObject(currentValue) ? currentValue : {};
    const rowsByKey = new Map(control.rows.map(row => [row.key, row]));
    for (const row of control.rows) {
      if (row.disabled && Object.hasOwn(currentObj, row.key)
        && (!Object.hasOwn(value, row.key) || !jsonValuesEqual(value[row.key], currentObj[row.key]))) {
        return invalid(row.disabledReason!);
      }
    }
    for (const [key, choice] of Object.entries(value)) {
      if (Object.hasOwn(currentObj, key) && jsonValuesEqual(currentObj[key], choice)) continue;
      const row = rowsByKey.get(key);
      if (!row) return invalid(`Row ${JSON.stringify(key)} is not declared for field ${pointer}.`);
      if (row.disabled) return invalid(row.disabledReason!);
      const option = findPanelFormOption(control.options, choice);
      if (!option) return invalid(`Value ${JSON.stringify(choice)} is not an allowed tier for row ${JSON.stringify(key)} of field ${pointer}.`);
      if (option.disabled) return invalid(option.disabledReason!);
    }
    return null;
  }

  const schemaEnum = field.valueSchema.enum;
  if (Array.isArray(schemaEnum) && schemaEnum.length > 0) {
    if (!schemaEnum.some((allowed) => jsonValuesEqual(allowed as RuntimeJsonValue, value))) {
      return {
        path: pointer,
        reason: "invalid_value",
        message: `Value ${JSON.stringify(value)} is not an allowed enum value for field ${pointer}.`,
      };
    }
  }

  if (control.kind === "object") {
    const currentObj = isPlainObject(currentValue) ? currentValue : undefined;
    const fixedDescendants = Object.keys(fixedValues).filter((fixedPath) => fixedPath.startsWith(`${pointer}/`));
    if (value === null) {
      if (field.required) {
        return { path: pointer, reason: "invalid_value", message: `Field ${pointer} is required and cannot be null.` };
      }
      if (fixedDescendants.length > 0) {
        return {
          path: pointer,
          reason: "fixed",
          message: `Field ${pointer} contains fixed field ${fixedDescendants[0]} and cannot be cleared.`,
        };
      }
      if (currentObj) {
        for (const child of panelFormObjectActiveFields(control, currentObj)) {
          const beforeChild = valueAt(currentObj, child.path);
          if ((child.readOnly || child.control.kind === "hidden") && beforeChild !== undefined) {
            return {
              path: pointer,
              reason: "read_only",
              message: child.readOnlyReason ?? `Nested field ${pointer}${child.path} is read-only and cannot be removed.`,
            };
          }
        }
      }
      return null;
    }
    if (!isPlainObject(value)) {
      return { path: pointer, reason: "invalid_value", message: `Field ${pointer} expects an object value.` };
    }
    for (const fixedPath of fixedDescendants) {
      const relPath = fixedPath.slice(pointer.length);
      if (!jsonValuesEqual(valueAt(value, relPath), fixedValues[fixedPath])) {
        return {
          path: pointer,
          reason: "fixed",
          message: `Nested field ${fixedPath} is fixed by page state and cannot be modified.`,
        };
      }
    }
    const nextActive = panelFormObjectActiveFields(control, value);
    const checkedPaths = new Set<string>();
    const checkChild = (child: PanelFormField): FormFieldRejection | null => {
      if (checkedPaths.has(child.path)) return null;
      checkedPaths.add(child.path);
      const childAbsPath = `${pointer}${child.path}`;
      const beforeChild = currentObj ? valueAt(currentObj, child.path) : undefined;
      const afterChild = valueAt(value, child.path);
      if (child.control.kind === "hidden" || child.readOnly) {
        if (!jsonValuesEqual(beforeChild, afterChild)) {
          return {
            path: pointer,
            reason: "read_only",
            message: child.readOnlyReason ?? `Nested field ${childAbsPath} is read-only and cannot be modified.`,
          };
        }
        return null;
      }
      if (afterChild !== undefined) {
        const nestedRejection = validateAssignedValue(child, childAbsPath, afterChild, beforeChild, fixedValues);
        if (nestedRejection) return { ...nestedRejection, path: pointer };
      }
      return null;
    };
    for (const child of nextActive) {
      const rejection = checkChild(child);
      if (rejection) return rejection;
    }
    if (currentObj) {
      for (const child of panelFormObjectActiveFields(control, currentObj)) {
        if (child.readOnly || child.control.kind === "hidden") {
          const rejection = checkChild(child);
          if (rejection) return rejection;
        }
      }
    }
    return null;
  }

  if (control.kind === "object-array") {
    if (!Array.isArray(value)) {
      return { path: pointer, reason: "invalid_value", message: `Field ${pointer} expects an array of objects.` };
    }
    const fixedDescendants = Object.keys(fixedValues).filter((fixedPath) => fixedPath.startsWith(`${pointer}/`));
    for (const fixedPath of fixedDescendants) {
      const relPath = fixedPath.slice(pointer.length);
      const nextFixed = valueAt({ _: value }, `/_${relPath}`);
      if (!jsonValuesEqual(nextFixed, fixedValues[fixedPath])) {
        return {
          path: pointer,
          reason: "fixed",
          message: `Nested field ${fixedPath} is fixed by page state and cannot be modified.`,
        };
      }
    }
    const prevRows = Array.isArray(currentValue) ? currentValue : [];
    const keyPath = control.itemKeyPath;
    for (let index = 0; index < value.length; index++) {
      const row = value[index];
      if (!isPlainObject(row)) {
        return { path: pointer, reason: "invalid_value", message: `Row ${index} of ${pointer} must be an object.` };
      }
      const rowKey = keyPath ? valueAt(row, keyPath) : undefined;
      const prevRowCandidate = keyPath && rowKey !== undefined
        ? prevRows.find((candidate) => isPlainObject(candidate) && jsonValuesEqual(valueAt(candidate, keyPath), rowKey))
        : prevRows[index];
      const prevRow = isPlainObject(prevRowCandidate) ? prevRowCandidate : undefined;
      for (const child of control.itemFields) {
        const childAbsPath = `${pointer}/${index}${child.path}`;
        const beforeChild = prevRow
          ? valueAt(prevRow, child.path)
          : (control.defaultItem ? valueAt(control.defaultItem, child.path) : undefined);
        const afterChild = valueAt(row, child.path);
        if (child.control.kind === "hidden" || child.readOnly) {
          if (!jsonValuesEqual(beforeChild, afterChild)) {
            return {
              path: pointer,
              reason: "read_only",
              message: child.readOnlyReason ?? `Nested field ${childAbsPath} is read-only and cannot be modified.`,
            };
          }
          continue;
        }
        if (afterChild !== undefined) {
          const nestedRejection = validateAssignedValue(child, childAbsPath, afterChild, prevRow ? beforeChild : undefined, fixedValues);
          if (nestedRejection) return { ...nestedRejection, path: pointer };
        }
      }
    }
    return null;
  }

  return null;
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
