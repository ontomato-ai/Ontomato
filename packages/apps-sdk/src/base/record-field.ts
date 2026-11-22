import {
  panelRecordFieldText,
  type PanelRecordFieldArrayItem,
  type PanelRecordFieldScalar,
  type PanelRecordFieldValue,
  type PanelRecordReferenceFieldValue,
} from "@ontomato/contracts/panel-projection";
import type { PlatformFieldReference, PlatformObjectRecord } from "../panel/platform-objects";

/** Type guard for a clickable object reference stored in `PlatformObjectRecord.fields`. */
export function isRecordReference(
  value: PanelRecordFieldValue | PanelRecordFieldArrayItem | undefined,
): value is PanelRecordReferenceFieldValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "reference";
}

/** Extract the navigation payload carried by a reference field value. */
export function toFieldReference(reference: PanelRecordReferenceFieldValue): PlatformFieldReference {
  return {
    className: reference.className,
    primaryKey: reference.primaryKey,
    label: reference.label,
  };
}

/** Readable label for a reference field value, falling back to its primary key when label is empty. */
export function referenceDisplayLabel(reference: PanelRecordReferenceFieldValue): string {
  return reference.label || reference.primaryKey;
}

/** Raw field value on a record, including top-level `label` and `subtitle`. */
export function rawRecordField(record: PlatformObjectRecord, key: string): PanelRecordFieldValue | undefined {
  if (key === "label") return record.label;
  if (key === "subtitle") return record.subtitle;
  return record.fields[key];
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
 * - references return `label || primaryKey`;
 * - arrays join formatted element texts with `", "`;
 * - json payloads summarize via `panelRecordFieldText`.
 */
export function displayFieldText(
  value: PanelRecordFieldValue | undefined,
  locale: string,
  translate: (key: string) => string,
): string {
  if (value === undefined) return "";
  if (typeof value === "boolean") return scalarFieldText(value, translate);
  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecordReference(item) ? referenceDisplayLabel(item) : scalarFieldText(item, translate)))
      .filter((part) => part.length > 0)
      .join(", ");
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
