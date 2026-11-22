import type { PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import type { PlatformObjectRecord, TextHighlightRange } from "../panel/platform-objects";
import {
  displayFieldText,
  isRecordReference,
  rawRecordField,
  referenceDisplayLabel,
  scalarFieldText,
} from "./record-field";

/** One rendered group of filtered records when `ObjectList` has `groupBy` configured. */
export interface ObjectListGroup {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly PlatformObjectRecord[];
  readonly count: number;
}

/** Collect plain leaf text strings from arbitrary JSON values for case-insensitive local search. */
function collectJsonSearchTexts(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (value.trim() !== "") out.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonSearchTexts(item, out);
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectJsonSearchTexts(entry, out);
    }
  }
}

/** Collect searchable text fragments from a single typed record field value. */
function collectFieldSearchTexts(
  value: PanelRecordFieldValue | undefined,
  locale: string,
  translate: (key: string) => string,
  out: string[],
): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string") {
    if (value.trim() !== "") out.push(value);
    return;
  }
  if (typeof value === "number") {
    out.push(String(value));
    return;
  }
  if (typeof value === "boolean") {
    out.push(String(value));
    const localized = scalarFieldText(value, translate);
    if (localized !== String(value)) out.push(localized);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecordReference(item)) {
        if (item.label) out.push(item.label);
        if (item.primaryKey) out.push(item.primaryKey);
      } else if (typeof item === "object" && item !== null) {
        collectJsonSearchTexts(item, out);
      } else {
        collectFieldSearchTexts(item, locale, translate, out);
      }
    }
    return;
  }
  if (isRecordReference(value)) {
    if (value.label) out.push(value.label);
    if (value.primaryKey) out.push(value.primaryKey);
    return;
  }
  if (typeof value === "object" && "kind" in value) {
    if (value.kind === "localized") {
      const display = displayFieldText(value, locale, translate);
      if (display) out.push(display);
      for (const text of Object.values(value.values)) {
        if (text.trim() !== "") out.push(text);
      }
      return;
    }
    if (value.kind === "json") {
      collectJsonSearchTexts(value.value, out);
      return;
    }
  }
  collectJsonSearchTexts(value, out);
}

/**
 * Extract all searchable text fragments from a record: its `label`, `primaryKey`, `subtitle`, every field value
 * (including references, localized maps, arrays and nested JSON/object fields such as attribute lists), and tags.
 */
export function extractSearchableTexts(
  row: PlatformObjectRecord,
  locale: string,
  translate: (key: string) => string,
): readonly string[] {
  const texts: string[] = [];
  if (row.label) texts.push(row.label);
  if (row.primaryKey) texts.push(row.primaryKey);
  if (row.subtitle) texts.push(row.subtitle);
  for (const fieldValue of Object.values(row.fields)) {
    collectFieldSearchTexts(fieldValue, locale, translate, texts);
  }
  if (row.tags) {
    for (const list of Object.values(row.tags)) {
      for (const tag of list) {
        if (tag.trim() !== "") texts.push(tag);
      }
    }
  }
  return texts;
}

/** Case-insensitive substring match across a record's searchable text fragments. */
export function matchesLocalSearch(
  row: PlatformObjectRecord,
  normalizedQuery: string,
  locale: string,
  translate: (key: string) => string,
): boolean {
  if (!normalizedQuery) return true;
  const texts = extractSearchableTexts(row, locale, translate);
  return texts.some((fragment) => fragment.toLowerCase().includes(normalizedQuery));
}

/**
 * Compute non-overlapping case-insensitive highlight ranges for a local search query within a displayed string.
 * Falls back cleanly to no highlights if case-folding alters string length.
 */
export function findLocalHighlightRanges(text: string, normalizedQuery: string): readonly TextHighlightRange[] {
  if (!text || !normalizedQuery) return [];
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [];
  const ranges: TextHighlightRange[] = [];
  let cursor = 0;
  while (cursor <= lower.length - normalizedQuery.length) {
    const found = lower.indexOf(normalizedQuery, cursor);
    if (found < 0) break;
    ranges.push({ start: found, end: found + normalizedQuery.length });
    cursor = found + normalizedQuery.length;
  }
  return ranges;
}

/** Whether a local filter value is populated and should narrow visible rows. */
export function isLocalFilterValueActive(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.some((item) => isLocalFilterValueActive(item));
  return true;
}

function isObjectRefFilter(value: unknown): value is { className?: string; primaryKey: string } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { primaryKey?: unknown }).primaryKey === "string";
}

/** Resolve a record's raw field value, falling back to top-level `primaryKey` / `className` when absent from `fields`. */
function resolveRecordField(
  row: PlatformObjectRecord,
  fieldKey: string,
  fallbackClassName: string,
): PanelRecordFieldValue | undefined {
  const field = rawRecordField(row, fieldKey);
  if (field !== undefined) return field;
  if (fieldKey === "primaryKey") return row.primaryKey;
  if (fieldKey === "className") return row.className ?? fallbackClassName;
  return undefined;
}

function matchesSingleFilterValue(
  row: PlatformObjectRecord,
  fieldKey: string,
  expected: unknown,
  fallbackClassName: string,
  locale: string,
  translate: (key: string) => string,
): boolean {
  const raw = resolveRecordField(row, fieldKey, fallbackClassName);

  if (isObjectRefFilter(expected)) {
    const matchRef = (candidate: PanelRecordFieldValue | undefined): boolean => {
      if (isRecordReference(candidate)) {
        return candidate.primaryKey === expected.primaryKey
          && (!expected.className || candidate.className === expected.className);
      }
      if (typeof candidate === "string") return candidate === expected.primaryKey;
      return false;
    };
    if (Array.isArray(raw)) return raw.some((item) => matchRef(item));
    return matchRef(raw);
  }

  const expectedText = String(expected);
  const matchItem = (candidate: unknown): boolean => {
    if (candidate === undefined || candidate === null) return false;
    if (candidate === expected) return true;
    if (typeof candidate === "boolean") {
      return String(candidate) === expectedText || scalarFieldText(candidate, translate) === expectedText;
    }
    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate) === expectedText;
    }
    if (isRecordReference(candidate as PanelRecordFieldValue)) {
      const refVal = candidate as { primaryKey: string; label: string };
      return refVal.primaryKey === expectedText || refVal.label === expectedText;
    }
    if (typeof candidate === "object" && "kind" in (candidate as Record<string, unknown>)) {
      const typed = candidate as PanelRecordFieldValue;
      if (typeof typed === "object" && typed !== null && !Array.isArray(typed) && typed.kind === "localized") {
        if (displayFieldText(typed, locale, translate) === expectedText) return true;
        return Object.values(typed.values).some((entry) => entry === expectedText);
      }
      if (typeof typed === "object" && typed !== null && !Array.isArray(typed) && typed.kind === "json") {
        return typed.value === expected || String(typed.value) === expectedText;
      }
    }
    return false;
  };

  if (Array.isArray(raw)) {
    if (raw.some(matchItem)) return true;
  } else if (raw !== undefined && matchItem(raw)) {
    return true;
  }

  const tags = row.tags?.[fieldKey];
  if (tags && tags.some((tag) => tag === expectedText)) return true;
  return false;
}

/**
 * Local equality filter for one field key on a record. Array filter values match when any element matches;
 * object-reference filter values match against reference fields or matching primary keys.
 */
export function matchesLocalFieldFilter(
  row: PlatformObjectRecord,
  fieldKey: string,
  filterValue: unknown,
  fallbackClassName: string,
  locale: string,
  translate: (key: string) => string,
): boolean {
  if (!isLocalFilterValueActive(filterValue)) return true;
  if (Array.isArray(filterValue)) {
    const activeValues = filterValue.filter((item) => isLocalFilterValueActive(item));
    return activeValues.some((item) =>
      matchesSingleFilterValue(row, fieldKey, item, fallbackClassName, locale, translate),
    );
  }
  return matchesSingleFilterValue(row, fieldKey, filterValue, fallbackClassName, locale, translate);
}

/** Resolve one record's group identity key and display label for `groupBy`. */
export function resolveGroupForRecord(
  row: PlatformObjectRecord,
  groupBy: string,
  fallbackClassName: string,
  locale: string,
  translate: (key: string) => string,
  emptyLabel: string,
): { readonly key: string; readonly label: string; readonly isEmpty: boolean } {
  const raw = resolveRecordField(row, groupBy, fallbackClassName);
  if (isRecordReference(raw)) {
    const label = referenceDisplayLabel(raw).trim();
    if (!label) return { key: "", label: emptyLabel, isEmpty: true };
    return { key: raw.primaryKey || label, label, isEmpty: false };
  }
  const text = displayFieldText(raw, locale, translate).trim();
  if (!text) return { key: "", label: emptyLabel, isEmpty: true };
  return { key: text, label: text, isEmpty: false };
}

/**
 * Group already-filtered rows by `groupBy`, preserving first-seen order with any empty/missing-value group
 * placed last. Groups with zero matching rows are omitted.
 */
export function buildObjectListGroups(
  rows: readonly PlatformObjectRecord[],
  groupBy: string,
  fallbackClassName: string,
  locale: string,
  translate: (key: string) => string,
  emptyLabel: string,
): readonly ObjectListGroup[] {
  const buckets = new Map<string, { key: string; label: string; rows: PlatformObjectRecord[] }>();
  let emptyBucket: { key: string; label: string; rows: PlatformObjectRecord[] } | null = null;

  for (const row of rows) {
    const resolved = resolveGroupForRecord(row, groupBy, fallbackClassName, locale, translate, emptyLabel);
    if (resolved.isEmpty) {
      if (!emptyBucket) emptyBucket = { key: "", label: resolved.label, rows: [] };
      emptyBucket.rows.push(row);
      continue;
    }
    let bucket = buckets.get(resolved.key);
    if (!bucket) {
      bucket = { key: resolved.key, label: resolved.label, rows: [] };
      buckets.set(resolved.key, bucket);
    }
    bucket.rows.push(row);
  }

  const ordered = [...buckets.values()];
  if (emptyBucket) ordered.push(emptyBucket);
  return ordered.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    rows: bucket.rows,
    count: bucket.rows.length,
  }));
}
