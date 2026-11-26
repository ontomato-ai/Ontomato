import {
  panelRecordFieldText,
  type PanelRecordChildReferenceFieldValue,
  type PanelRecordFieldArrayItem,
  type PanelRecordFieldScalar,
  type PanelRecordFieldValue,
  type PanelRecordReferenceFieldValue,
  type PanelRecordTagFieldValue,
} from "@ontomato/contracts/panel-projection";
import type { PlatformChildFieldReference, PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";

/** Type guard for a clickable object reference stored in `PlatformObjectRecord.fields`. */
export function isRecordReference(
  value: PanelRecordFieldValue | PanelRecordFieldArrayItem | undefined,
): value is PanelRecordReferenceFieldValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "reference";
}

/** Type guard for a clickable parent-scoped child reference stored in `PlatformObjectRecord.fields`. */
export function isRecordChildReference(
  value: PanelRecordFieldValue | PanelRecordFieldArrayItem | undefined,
): value is PanelRecordChildReferenceFieldValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "child-reference";
}

/** Type guard for a value-carried tagged display value stored in `PlatformObjectRecord.fields` or its arrays. */
export function isRecordTag(
  value: PanelRecordFieldValue | PanelRecordFieldArrayItem | undefined,
): value is PanelRecordTagFieldValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "tag";
}

/** Extract the navigation payload carried by a reference field value. */
export function toFieldReference(reference: PanelRecordReferenceFieldValue): PlatformFieldReference {
  return {
    className: reference.className,
    primaryKey: reference.primaryKey,
    label: reference.label,
  };
}

/** Extract the navigation payload carried by a child-reference field value. */
export function toChildFieldReference(reference: PanelRecordChildReferenceFieldValue): PlatformChildFieldReference {
  return {
    parent: {
      objectType: reference.parent.objectType,
      primaryKey: reference.parent.primaryKey,
    },
    collection: reference.collection,
    primaryKey: reference.primaryKey,
    label: reference.label,
  };
}

/** Readable label for a reference field value, falling back to its primary key when label is empty. */
export function referenceDisplayLabel(reference: PanelRecordReferenceFieldValue): string {
  return reference.label || reference.primaryKey;
}

/** Readable label for a child-reference field value, falling back to its primary key when label is empty. */
export function childReferenceDisplayLabel(reference: PanelRecordChildReferenceFieldValue): string {
  return reference.label || reference.primaryKey;
}

/** Raw field value on a record, including top-level `label` and `subtitle`. */
export function rawRecordField(record: PlatformObjectRecord, key: string): PanelRecordFieldValue | undefined {
  if (key === "label") return record.label;
  if (key === "subtitle") return record.subtitle;
  return record.fields[key];
}

/**
 * The field value a page shows: when the owner declares one display name beside a scalar value (its `tags` entry for
 * that field), that name replaces the value on screen; the record's own value is untouched for sorting, forms and the
 * operations that read it.
 */
export function recordFieldDisplayValue(
  record: PlatformObjectRecord,
  key: string,
): PanelRecordFieldValue | undefined {
  const raw = rawRecordField(record, key);
  const names = record.tags?.[key];
  if (names?.length === 1 && (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"))
    return names[0];
  return raw;
}

/** Format a scalar field value for UI display, localizing booleans in the reader's language. */
export function scalarFieldText(value: PanelRecordFieldScalar, translate: (key: string) => string): string {
  if (typeof value === "boolean") return translate(value ? "platform.booleanTrue" : "platform.booleanFalse");
  return String(value);
}

/**
 * Format any `PanelRecordFieldValue` into plain display text in the reader's locale:
 * - booleans localize via `platform.booleanTrue` / `platform.booleanFalse`;
 * - localized maps resolve by the reader's active locale via `panelRecordFieldText`;
 * - references and child references return `label || primaryKey`;
 * - tagged values return `label`;
 * - arrays join formatted element texts with `listSeparator` (default `", "`);
 * - json payloads summarize via `panelRecordFieldText`.
 */
export function displayFieldText(
  value: PanelRecordFieldValue | undefined,
  locale: string,
  translate: (key: string) => string,
  listSeparator = ", ",
): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return scalarFieldText(value, translate);
  if (isRecordChildReference(value)) return childReferenceDisplayLabel(value);
  if (isRecordTag(value)) return value.label;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        isRecordReference(item)
          ? referenceDisplayLabel(item)
          : isRecordChildReference(item)
            ? childReferenceDisplayLabel(item)
            : isRecordTag(item)
              ? item.label
              : scalarFieldText(item, translate),
      )
      .filter((part) => part.length > 0)
      .join(listSeparator);
  }
  return panelRecordFieldText(value, locale);
}

/** Array items stored either in `record.fields[key]` (as an array) or in `record.tags[key]`. */
export function recordFieldArrayItems(
  record: PlatformObjectRecord,
  key: string,
): readonly PanelRecordFieldArrayItem[] {
  const raw = rawRecordField(record, key);
  if (Array.isArray(raw) && raw.length > 0) return raw;
  return record.tags?.[key] ?? [];
}
