import type { PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";

/** One key-value pair rendered inside `ObjectSummary`'s nested two-column `<dl>` grid. */
export interface SummaryKeyValueEntry {
  readonly key: string;
  readonly value: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatBoolean(value: boolean, translate?: (key: string) => string): string {
  const key = value ? "platform.booleanTrue" : "platform.booleanFalse";
  if (translate) {
    const translated = translate(key);
    if (translated && translated !== key) return translated;
  }
  return value ? "true" : "false";
}

/** Formats one value inside a key-value map for display in `ObjectSummary`. */
export function formatSummaryKvValue(value: unknown, translate?: (key: string) => string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return formatBoolean(value, translate);
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value
      .map((item) => {
        if (item === null || item === undefined) return "—";
        if (typeof item === "boolean") return formatBoolean(item, translate);
        if (typeof item === "string" || typeof item === "number") return String(item);
        return JSON.stringify(item);
      })
      .join(", ");
  }
  return JSON.stringify(value);
}

const STRUCTURED_ENTRY_KEYS = new Set(["key", "label", "value"]);

function isStructuredKvEntryList(value: unknown): value is readonly { key: string; label?: string; value: unknown }[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => {
    if (!isPlainObject(item)) return false;
    if (typeof item.key !== "string" || item.key.trim().length === 0) return false;
    if (!Object.hasOwn(item, "value")) return false;
    return Object.keys(item).every((k) => STRUCTURED_ENTRY_KEYS.has(k));
  });
}

/**
 * Extracts structured key-value entries from an `ObjectSummary` field value when it carries
 * a key-value map (`{ kind: "json", value: { ... } }` or a plain non-tagged object) or a
 * structured JSON array of `{ key, label?, value }` entries.
 *
 * Returns `null` for scalars, tag arrays, references, child references, localized strings,
 * and non-map JSON payloads so callers keep their default rendering untouched.
 * Returns `[]` for an empty key-value object so callers can render `"—"` instead of `"{}"`.
 */
export function extractSummaryKeyValueEntries(
  value: PanelRecordFieldValue | undefined,
  translate?: (key: string) => string,
): readonly SummaryKeyValueEntry[] | null {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  if ("kind" in value) {
    if (value.kind === "reference" || value.kind === "child-reference" || value.kind === "localized") {
      return null;
    }
    if (value.kind === "json") {
      const payload = value.value;
      if (isPlainObject(payload)) {
        return Object.entries(payload).map(([k, v]) => ({
          key: k,
          value: formatSummaryKvValue(v, translate),
        }));
      }
      if (isStructuredKvEntryList(payload)) {
        return payload.map((item) => ({
          key: typeof item.label === "string" && item.label.trim().length > 0 ? item.label : item.key,
          value: formatSummaryKvValue(item.value, translate),
        }));
      }
      return null;
    }
    return null;
  }

  if (isPlainObject(value)) {
    return Object.entries(value).map(([k, v]) => ({
      key: k,
      value: formatSummaryKvValue(v, translate),
    }));
  }

  return null;
}
