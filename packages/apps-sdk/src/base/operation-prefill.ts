import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListRowActionPrefill } from "./object-list-types";
import type { OperationInputField } from "./operation-input-schema";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneSimpleValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneSimpleValue(item)) as unknown as T;
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneSimpleValue(v)])) as T;
  }
  return value;
}

/**
 * Extracts one prefill value from a list row record using a source path such as
 * `"label"`, `"primaryKey"`, `"subtitle"`, `"fields.<key>"`, or `"<fieldKey>"`.
 */
export function resolveRowPrefillSource(row: PlatformObjectRecord, source: string): unknown {
  const trimmed = source.trim();
  if (!trimmed) return undefined;
  if (trimmed === "primaryKey") return row.primaryKey;
  if (trimmed === "className") return row.className;
  if (trimmed === "label") return row.label;
  if (trimmed === "subtitle") return row.subtitle ?? row.fields.subtitle;

  const fieldKey = trimmed.startsWith("fields.") ? trimmed.slice("fields.".length) : trimmed;
  const raw = fieldKey === "label"
    ? row.label
    : fieldKey === "subtitle"
      ? (row.subtitle ?? row.fields.subtitle)
      : row.fields[fieldKey];
  if (raw === undefined) return undefined;

  if (isPlainRecord(raw) && typeof raw.kind === "string") {
    if (raw.kind === "reference" || raw.kind === "child-reference") {
      const label = typeof raw.label === "string" ? raw.label : "";
      const pk = typeof raw.primaryKey === "string" ? raw.primaryKey : "";
      return label || pk;
    }
    if (raw.kind === "json") {
      return raw.value;
    }
    if (raw.kind === "localized" && isPlainRecord(raw.values)) {
      const first = Object.values(raw.values).find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
      return first ?? "";
    }
  }
  return raw;
}

const AUTO_LABEL_FIELD_NAMES = new Set(["label", "name", "title"]);
const AUTO_SUBTITLE_FIELD_NAMES = new Set(["subtitle", "description"]);

/**
 * Resolves initial values for an `OperationInputDialog` from a target row record.
 * - `prefill === false` or `undefined`: returns `{}` (no automatic prefill).
 * - `prefill === true`: matches each non-password input field against `row.fields[name]`,
 *   falling back to `row.label` for `label`/`name`/`title` and `row.subtitle` for `subtitle`/`description`.
 * - `prefill` as a record map: resolves each `{ [inputField]: rowSource }` mapping against `row`.
 */
export function resolveRowOperationPrefill(
  row: PlatformObjectRecord,
  fields: readonly OperationInputField[],
  prefill: ObjectListRowActionPrefill | undefined,
): Record<string, unknown> {
  if (!prefill) return {};
  const allowedByName = new Map(fields.map((field) => [field.name, field] as const));
  const resolved: Record<string, unknown> = {};

  if (prefill === true) {
    for (const field of fields) {
      if (field.kind === "password") continue;
      if (Object.hasOwn(row.fields, field.name)) {
        const value = resolveRowPrefillSource(row, `fields.${field.name}`);
        if (value !== undefined) {
          resolved[field.name] = value;
          continue;
        }
      }
      if (AUTO_LABEL_FIELD_NAMES.has(field.name) && row.label) {
        resolved[field.name] = row.label;
      } else if (AUTO_SUBTITLE_FIELD_NAMES.has(field.name) && row.subtitle) {
        resolved[field.name] = row.subtitle;
      }
    }
    return resolved;
  }

  for (const [fieldName, source] of Object.entries(prefill)) {
    const field = allowedByName.get(fieldName);
    if (!field || field.kind === "password") continue;
    const value = resolveRowPrefillSource(row, source);
    if (value !== undefined) {
      resolved[fieldName] = value;
    }
  }
  return resolved;
}

/**
 * Overlays caller-supplied `initialValues` onto a base `OperationInputDialog` draft while
 * respecting each field's control kind and never prefilling password fields.
 */
export function applyOperationInputInitialValues(
  fields: readonly OperationInputField[],
  baseDraft: Readonly<Record<string, unknown>>,
  initialValues: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const draft: Record<string, unknown> = { ...baseDraft };
  if (!initialValues) return draft;

  for (const field of fields) {
    if (field.kind === "password") continue;
    if (!Object.hasOwn(initialValues, field.name)) continue;
    const raw = initialValues[field.name];
    if (raw === undefined || raw === null) continue;

    if (field.kind === "boolean") {
      if (typeof raw === "boolean") draft[field.name] = raw;
      continue;
    }
    if (field.kind === "number" || field.kind === "integer") {
      if (typeof raw === "number" && Number.isFinite(raw)) {
        draft[field.name] = String(raw);
      } else if (typeof raw === "string" && raw.trim() !== "") {
        draft[field.name] = raw;
      }
      continue;
    }
    if (field.kind === "select") {
      draft[field.name] = cloneSimpleValue(raw);
      continue;
    }
    if (typeof raw === "string") {
      draft[field.name] = raw;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      draft[field.name] = String(raw);
    }
  }

  return draft;
}
