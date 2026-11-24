import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListColumn } from "./object-list-types";

/**
 * Collect owner-supplied field display labels across loaded records.
 * The first non-empty label encountered for each key wins, preserving key insertion order.
 */
export function collectDynamicFieldLabels(rows: readonly PlatformObjectRecord[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const row of rows) {
    if (!row.fieldLabels) continue;
    for (const [key, label] of Object.entries(row.fieldLabels)) {
      if (label && !(key in labels)) {
        labels[key] = label;
      }
    }
  }
  return labels;
}

/**
 * Derive table columns automatically from loaded records when `dynamicColumns` is enabled
 * and no explicit static `columns` are configured.
 *
 * Column ordering prefers owner-supplied `fieldLabels` keys first, then appends any remaining
 * record `fields` keys in first-seen order. Array-valued complex fields (where any loaded row
 * holds an array for that field) are excluded so table cells stay readable; if every field is
 * excluded or no fields exist, falls back to the record `label` column.
 */
export function deriveDynamicColumns(rows: readonly PlatformObjectRecord[]): readonly ObjectListColumn[] {
  if (rows.length === 0) return [];

  const arrayKeys = new Set<string>();
  const orderedKeys: string[] = [];
  const seenKeys = new Set<string>();

  const addCandidate = (key: string) => {
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    orderedKeys.push(key);
  };

  for (const row of rows) {
    if (row.fieldLabels) {
      for (const key of Object.keys(row.fieldLabels)) {
        addCandidate(key);
      }
    }
  }

  for (const row of rows) {
    for (const [key, value] of Object.entries(row.fields)) {
      if (Array.isArray(value)) arrayKeys.add(key);
      addCandidate(key);
    }
    if (row.tags) {
      for (const [key, value] of Object.entries(row.tags)) {
        if (row.fields[key] === undefined && Array.isArray(value)) {
          arrayKeys.add(key);
        }
      }
    }
  }

  const columns: ObjectListColumn[] = [];
  for (const key of orderedKeys) {
    if (!arrayKeys.has(key)) {
      columns.push({ key });
    }
  }

  return columns.length > 0 ? columns : [{ key: "label" }];
}

/** Stable schema key for the current column set, used to reset visibility state when columns change. */
export function columnSchemaKey(columns: readonly ObjectListColumn[]): string {
  return columns.map((column) => column.key).join("\u0000");
}

/**
 * Filter columns by hidden keys while guaranteeing at least one column remains visible
 * whenever the underlying column list is non-empty.
 */
export function filterVisibleColumns(
  columns: readonly ObjectListColumn[],
  hiddenKeys: ReadonlySet<string>,
): readonly ObjectListColumn[] {
  if (columns.length === 0 || hiddenKeys.size === 0) return columns;
  const visible = columns.filter((column) => !hiddenKeys.has(column.key));
  return visible.length > 0 ? visible : [columns[0]!];
}

/**
 * Pure visibility toggle transition for one column key.
 * Refuses to hide the last remaining visible column so the table never becomes empty of columns.
 */
export function toggleColumnKeyVisibility(
  columns: readonly ObjectListColumn[],
  hiddenKeys: ReadonlySet<string>,
  key: string,
  visible: boolean,
): ReadonlySet<string> {
  if (visible) {
    if (!hiddenKeys.has(key)) return hiddenKeys;
    const next = new Set(hiddenKeys);
    next.delete(key);
    return next;
  }
  if (hiddenKeys.has(key)) return hiddenKeys;
  const currentlyVisibleCount = columns.filter((column) => !hiddenKeys.has(column.key)).length;
  if (currentlyVisibleCount <= 1) return hiddenKeys;
  const next = new Set(hiddenKeys);
  next.add(key);
  return next;
}

/** Escape one CSV cell according to RFC 4180 (quotes, commas, CR, LF). */
export function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

/** Build a UTF-8 BOM-prefixed RFC 4180 CSV document from display headers and formatted row cells. */
export function buildCsvContent(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines: string[] = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function formatDateStamp(now: Date): string {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Normalize an optional export file name into a safe single-basename `.csv` file name
 * compatible with `panelDownloadFileSchema` (`records-YYYY-MM-DD.csv` by default).
 */
export function resolveCsvFileName(exportFileName?: string, now: Date = new Date()): string {
  const fallbackStem = `records-${formatDateStamp(now)}`;
  const sanitized = (exportFileName ?? "")
    .trim()
    .replace(/[/\\\p{Cc}]+/gu, "-")
    .trim();

  const withoutExt = sanitized.toLowerCase().endsWith(".csv") ? sanitized.slice(0, -4) : sanitized;
  const stem = withoutExt.replace(/^[\s.]+/, "").trim();
  const base = stem.length > 0 ? stem : fallbackStem;
  const maxStemLength = 255 - 4;
  return `${base.slice(0, maxStemLength)}.csv`;
}
