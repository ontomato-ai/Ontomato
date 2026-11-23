import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import {
  panelRecordObjectRef,
  type ProjectionOperationBinding,
} from "@ontomato/contracts/panel-projection";
import type { MemberInputs } from "../panel/direct";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { stateObject, type PanelFieldValue } from "../panel/state";
import type { OperationInputField } from "./operation-input-schema";
import type { ObjectListRowActionCondition } from "./object-list-types";
import { isRecordReference, rawRecordField } from "./record-field";

function readConditionField(row: PlatformObjectRecord, field: string): unknown {
  if (field === "primaryKey") return row.primaryKey;
  if (field === "label") return row.label;
  if (field === "className") return row.className;
  if (field === "subtitle") return row.subtitle ?? row.fields.subtitle;
  const raw = rawRecordField(row, field);
  if (isRecordReference(raw)) return raw.primaryKey;
  return raw;
}

function valuesEqual(actual: unknown, expected: RuntimeJsonValue): boolean {
  if (actual === expected) return true;
  if (actual === null || actual === undefined || expected === null) return false;
  if (typeof actual === "object" && typeof expected === "object") {
    try {
      return JSON.stringify(actual) === JSON.stringify(expected);
    } catch {
      return false;
    }
  }
  return false;
}

function isTruthyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Evaluates one per-row visibility or disabled condition against a row record. */
export function evaluateRowActionCondition(
  row: PlatformObjectRecord,
  condition: ObjectListRowActionCondition,
): boolean {
  const actual = readConditionField(row, condition.field);
  if (condition.equals !== undefined && !valuesEqual(actual, condition.equals)) return false;
  if (condition.notEquals !== undefined && valuesEqual(actual, condition.notEquals)) return false;
  if (condition.in !== undefined && !condition.in.some((item) => valuesEqual(actual, item))) return false;
  if (condition.notIn !== undefined && condition.notIn.some((item) => valuesEqual(actual, item))) return false;
  if (condition.truthy !== undefined && isTruthyValue(actual) !== condition.truthy) return false;
  return true;
}

/** Evaluates a single condition or an AND-list of conditions against a row record. */
export function matchesRowActionWhen(
  row: PlatformObjectRecord,
  when: ObjectListRowActionCondition | readonly ObjectListRowActionCondition[] | undefined,
  defaultWhenMissing = true,
): boolean {
  if (!when) return defaultWhenMissing;
  if (Array.isArray(when)) {
    return when.every((condition) => evaluateRowActionCondition(row, condition));
  }
  return evaluateRowActionCondition(row, when as ObjectListRowActionCondition);
}

/**
 * Resolves the concrete dispatch target for a row-scoped operation declared on an `ObjectList` projection.
 * Returns `null` when the operation is targetless, a concrete `{ kind: "object", ... }` target when resolved,
 * or `undefined` when the declared target cannot be resolved for this row.
 */
export function resolveRowOperationTarget(
  binding: ProjectionOperationBinding,
  row: PlatformObjectRecord,
  fallbackClassName: string,
  inputs: MemberInputs,
): PanelOperationCall["target"] | undefined {
  const { target } = binding;
  if (!target) return null;
  if ("literal" in target) {
    return { kind: "object", objectType: target.literal.className, primaryKey: target.literal.primaryKey };
  }
  if ("input" in target) {
    const ref = stateObject(inputs[target.input] as PanelFieldValue);
    return ref ? { kind: "object", objectType: ref.className, primaryKey: ref.primaryKey } : undefined;
  }
  if ("row" in target) {
    const ref = panelRecordObjectRef(row, fallbackClassName);
    return { kind: "object", objectType: ref.className, primaryKey: ref.primaryKey };
  }
  const raw = rawRecordField(row, target.rowField);
  if (isRecordReference(raw)) {
    return { kind: "object", objectType: raw.className, primaryKey: raw.primaryKey };
  }
  const ref = stateObject(raw as PanelFieldValue);
  return ref ? { kind: "object", objectType: ref.className, primaryKey: ref.primaryKey } : undefined;
}

/** Resolves declared row/input/literal operation parameters for a single list row. */
export function resolveRowOperationParams(
  binding: ProjectionOperationBinding,
  row: PlatformObjectRecord,
  inputs: MemberInputs,
): Record<string, RuntimeJsonValue> {
  const resolved: Record<string, RuntimeJsonValue> = {};
  for (const [paramKey, spec] of Object.entries(binding.params ?? {})) {
    if ("literal" in spec) {
      resolved[paramKey] = spec.literal;
    } else if ("input" in spec) {
      if (Object.hasOwn(inputs, spec.input) && inputs[spec.input] !== undefined) {
        resolved[paramKey] = inputs[spec.input]!;
      }
    } else if ("row" in spec) {
      resolved[paramKey] = spec.row === "primaryKey" ? row.primaryKey : row.label;
    } else if ("rowField" in spec) {
      const raw = rawRecordField(row, spec.rowField);
      if (raw !== undefined) {
        resolved[paramKey] = raw as RuntimeJsonValue;
      }
    }
  }
  return resolved;
}

/**
 * Returns the whitelist of owner-declared editable parameter keys that may be supplied by a caller
 * (`extraInput` or the operation input dialog), excluding every key declared in `binding.params`.
 */
export function allowedRowOperationInputKeys(
  binding: ProjectionOperationBinding,
  editableFields: readonly OperationInputField[],
): Set<string> {
  const declaredBoundKeys = new Set(Object.keys(binding.params ?? {}));
  const allowed = new Set<string>();
  for (const field of editableFields) {
    if (!declaredBoundKeys.has(field.name)) allowed.add(field.name);
  }
  return allowed;
}

/** Filters caller-supplied or dialog-supplied parameters to the owner-declared editable whitelist. */
export function filterAllowedRowOperationInput(
  input: Readonly<Record<string, RuntimeJsonValue>> | undefined,
  allowedKeys: ReadonlySet<string>,
): Record<string, RuntimeJsonValue> {
  if (!input) return {};
  const filtered: Record<string, RuntimeJsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowedKeys.has(key) && value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/** Interpolates `{primaryKey}`, `{className}`, `{label}`, or `{fieldKey}` placeholders in a local row action address. */
export function resolveRowActionAddress(
  template: string,
  row: PlatformObjectRecord,
  fallbackClassName: string,
): string {
  const ref = panelRecordObjectRef(row, fallbackClassName);
  return template.replace(/\{([^{}]+)\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key === "primaryKey") return encodeURIComponent(ref.primaryKey);
    if (key === "className") return encodeURIComponent(ref.className);
    if (key === "label") return encodeURIComponent(row.label);
    const val = readConditionField(row, key);
    return val === null || val === undefined ? "" : encodeURIComponent(String(val));
  });
}

/** Formats a numeric pixel width or CSS length string into a CSS style value. */
export function formatColumnLength(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}
