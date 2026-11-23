import { computed, type ComputedRef } from "vue";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { DashboardMetricOutput } from "@ontomato/contracts/dashboard";
import type { PanelFieldTone, PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { formatListTime } from "@ontomato/workbench-ui/utils/relative-time";
import type { MemberDataState } from "../panel/direct";
import { readerDataState, type PanelMemberContext } from "../panel/member";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { isRecordReference } from "./record-field";

/** Supported display modes for `TypedValue` and `RecordTemplate` field formatting. */
export type TypedValueKind =
  | "auto"
  | "text"
  | "number"
  | "date"
  | "datetime"
  | "relative-time"
  | "boolean"
  | "tag"
  | "tags"
  | "reference"
  | "localized"
  | "list"
  | "code"
  | "json";

/** `Intl.NumberFormat` display options accepted by `TypedValue` and `MetricCard`. */
export interface TypedNumberFormat {
  /** Number formatting style (`"decimal"`, `"percent"`, or `"currency"`). */
  readonly style?: "decimal" | "percent" | "currency";
  /** ISO 4217 currency code when `style` is `"currency"` (for example `"USD"`, `"CNY"`). */
  readonly currency?: string;
  /** Minimum number of fraction digits. */
  readonly minimumFractionDigits?: number;
  /** Maximum number of fraction digits. */
  readonly maximumFractionDigits?: number;
  /** Whether to use grouping separators such as thousands commas. Defaults to `true`. */
  readonly useGrouping?: boolean;
}

/** Per-field formatting options accepted by `RecordTemplate`'s `fieldFormats` prop. */
export interface TypedFieldFormat {
  /** Explicit display kind; defaults to `"auto"`. */
  readonly kind?: TypedValueKind;
  /** Optional tone override for `"tag"` values. */
  readonly tone?: PanelFieldTone;
  /** Optional unit suffix shown after numeric/scalar values. */
  readonly unit?: string;
  /** Optional `Intl.NumberFormat` options for `"number"` values. */
  readonly numberFormat?: TypedNumberFormat;
  /** Optional list separator for `"list"` values. */
  readonly separator?: string;
  /** Optional list style (`"inline"` or `"tags"`). */
  readonly listStyle?: "inline" | "tags";
}

/** Token produced by `parseTemplateTokens` when splitting a declarative fixed-sentence template string. */
export type TemplateToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "field"; readonly key: string };

/** Column metadata resolved from a `DashboardMetricOutput` table. */
export interface MetricColumnMeta {
  readonly key: string;
  readonly label: string | null;
  readonly type: string | null;
}

/** Cell extracted from a `DashboardMetricOutput` (`metricOutput`) datum. */
export interface ResolvedMetricCell {
  readonly column: MetricColumnMeta | null;
  readonly value: RuntimeJsonValue | undefined;
  readonly rowCount: number;
  readonly truncationHint?: string;
}

/** Normalized visual state for lightweight inline/card display components. */
export type DisplayDataStateKind = "standalone" | "loading" | "empty" | "ready" | "forbidden" | "error" | "awaiting";

export const VALID_TONES = new Set<PanelFieldTone>(["default", "info", "success", "warning", "danger"]);

export function asTone(value: unknown): PanelFieldTone | undefined {
  return typeof value === "string" && VALID_TONES.has(value as PanelFieldTone)
    ? (value as PanelFieldTone)
    : undefined;
}

/**
 * Resolves a column definition from a `DashboardMetricOutput` table.
 * When `field` is omitted, defaults to the first declared column (or the first key of the selected row),
 * making single-value KPI metrics usable without repeating the column name.
 */
export function resolveMetricColumn(
  output: DashboardMetricOutput | null | undefined,
  field?: string,
  rowIndex = 0,
): MetricColumnMeta | null {
  if (!output) return null;
  const columns = Array.isArray(output.columns) ? output.columns : [];
  if (field) {
    const exact = columns.find((col) => col.key === field);
    if (exact) return exact;
    return { key: field, label: null, type: null };
  }
  if (columns.length > 0) return columns[0]!;
  const row = Array.isArray(output.rows) ? output.rows[rowIndex] : undefined;
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const firstKey = Object.keys(row)[0];
    if (firstKey) return { key: firstKey, label: null, type: null };
  }
  return null;
}

/** Extracts one row object from `DashboardMetricOutput`, returning `null` when out of range or empty. */
export function extractMetricRow(
  output: DashboardMetricOutput | null | undefined,
  rowIndex = 0,
): Readonly<Record<string, RuntimeJsonValue>> | null {
  if (!output || !Array.isArray(output.rows) || output.rows.length === 0) return null;
  const index = Number.isInteger(rowIndex) && rowIndex >= 0 ? rowIndex : 0;
  const row = output.rows[index];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  return row;
}

/** Extracts a single cell (plus its column metadata and optional truncation hint) from `DashboardMetricOutput`. */
export function extractMetricCell(
  output: DashboardMetricOutput | null | undefined,
  field?: string,
  rowIndex = 0,
): ResolvedMetricCell {
  const rowCount = Array.isArray(output?.rows) ? output!.rows.length : 0;
  const column = resolveMetricColumn(output, field, rowIndex);
  const row = extractMetricRow(output, rowIndex);
  const value = row && column ? row[column.key] : undefined;
  const truncationHint = output?.truncation?.truncationHint;
  return {
    column,
    value,
    rowCount,
    ...(truncationHint ? { truncationHint } : {}),
  };
}

/** Infers a `TypedValueKind` from a metric column's declared data type string, when present. */
export function kindFromMetricColumnType(columnType: string | null | undefined): TypedValueKind | null {
  if (!columnType) return null;
  const normalized = columnType.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "date") return "date";
  if (normalized === "datetime" || normalized === "timestamp" || normalized.includes("timestamp") || normalized.includes("datetime")) {
    return "datetime";
  }
  if (normalized === "bool" || normalized === "boolean") return "boolean";
  if (
    normalized === "number"
    || normalized === "numeric"
    || normalized === "int"
    || normalized === "integer"
    || normalized === "bigint"
    || normalized === "long"
    || normalized === "float"
    || normalized === "double"
    || normalized === "decimal"
    || normalized === "percent"
    || normalized === "currency"
  ) {
    return "number";
  }
  return null;
}

/** Unwraps `{ kind: "json", value }` field wrappers into raw JSON values while preserving other field shapes. */
export function unwrapJsonField(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { kind?: unknown }).kind === "json" && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

/** Checks whether a runtime value is a `{ kind: "localized", values: Record<string, string> }` field wrapper. */
export function isLocalizedField(value: unknown): value is { readonly kind: "localized"; readonly values: Readonly<Record<string, string>> } {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "localized"
    && typeof (value as { values?: unknown }).values === "object"
    && (value as { values?: unknown }).values !== null,
  );
}

/** Infers the effective display kind when `kind` is `"auto"` or omitted. */
export function inferValueKind(
  value: unknown,
  options: {
    readonly explicitKind?: TypedValueKind;
    readonly hasTone?: boolean;
    readonly isTagsField?: boolean;
    readonly columnType?: string | null;
  } = {},
): Exclude<TypedValueKind, "auto"> {
  if (options.explicitKind && options.explicitKind !== "auto") return options.explicitKind;
  if (options.isTagsField) return "tags";
  if (isRecordReference(value as PanelRecordFieldValue | undefined)) return "reference";
  if (isLocalizedField(value)) return "localized";
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "boolean";
  if (options.hasTone) return "tag";
  if (typeof value === "number") return "number";
  const fromColumn = kindFromMetricColumnType(options.columnType);
  if (fromColumn && fromColumn !== "auto") return fromColumn;
  if (value && typeof value === "object") {
    const unwrapped = unwrapJsonField(value);
    if (unwrapped !== value) {
      if (Array.isArray(unwrapped)) return "list";
      if (typeof unwrapped === "boolean") return "boolean";
      if (typeof unwrapped === "number") return "number";
      if (typeof unwrapped === "string") return "text";
      return "json";
    }
    return "json";
  }
  return "text";
}

/** Formats a finite number (or numeric string) with `Intl.NumberFormat` in the reader's locale. */
export function formatTypedNumber(
  value: unknown,
  locale: string,
  format?: TypedNumberFormat,
): string {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numeric)) return value === null || value === undefined ? "" : String(value);
  try {
    const options: Intl.NumberFormatOptions = {
      useGrouping: format?.useGrouping ?? true,
      ...(format?.style ? { style: format.style } : {}),
      ...(format?.style === "currency" && format.currency ? { currency: format.currency } : {}),
      ...(format?.minimumFractionDigits !== undefined ? { minimumFractionDigits: format.minimumFractionDigits } : {}),
      ...(format?.maximumFractionDigits !== undefined ? { maximumFractionDigits: format.maximumFractionDigits } : {}),
    };
    return new Intl.NumberFormat(locale || undefined, options).format(numeric);
  } catch {
    return String(numeric);
  }
}

/** Formats an ISO string or epoch millisecond timestamp as date, datetime, or relative time. */
export function formatTypedTime(
  value: unknown,
  kind: "date" | "datetime" | "relative-time",
  locale: string,
): { readonly text: string; readonly title?: string } {
  if (value === null || value === undefined || value === "") return { text: "" };
  const parsed = typeof value === "number"
    ? new Date(value)
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { text: String(value) };
  }
  const fullTitle = parsed.toLocaleString(locale || undefined);
  if (kind === "date") {
    return {
      text: parsed.toLocaleDateString(locale || undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
      title: fullTitle,
    };
  }
  if (kind === "datetime") {
    return {
      text: parsed.toLocaleString(locale || undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      title: fullTitle,
    };
  }
  const iso = parsed.toISOString();
  return {
    text: formatListTime(iso) || fullTitle,
    title: fullTitle,
  };
}

/**
 * Splits a fixed sentence template string (for example `"{source} → {target} ({cardinality})"`) into alternating
 * literal text and `{fieldKey}` placeholder tokens. Double braces (`{{` / `}}`) produce literal braces. Pure
 * presentation only: no expressions, calculation, or conditional sentence branching are evaluated.
 */
export function parseTemplateTokens(template: string): readonly TemplateToken[] {
  if (!template) return [];
  const tokens: TemplateToken[] = [];
  let literal = "";
  let index = 0;

  const flushLiteral = () => {
    if (literal.length > 0) {
      tokens.push({ kind: "text", text: literal });
      literal = "";
    }
  };

  while (index < template.length) {
    const ch = template[index]!;
    if (ch === "{") {
      if (template[index + 1] === "{") {
        literal += "{";
        index += 2;
        continue;
      }
      const close = template.indexOf("}", index + 1);
      if (close > index + 1) {
        const key = template.slice(index + 1, close).trim();
        if (key.length > 0 && !key.includes("{")) {
          flushLiteral();
          tokens.push({ kind: "field", key });
          index = close + 1;
          continue;
        }
      }
      literal += ch;
      index += 1;
      continue;
    }
    if (ch === "}" && template[index + 1] === "}") {
      literal += "}";
      index += 2;
      continue;
    }
    literal += ch;
    index += 1;
  }

  flushLiteral();
  return tokens;
}

/** Numeric contribution of one record field value when summing across rows (`MetricCard` / `ObjectCount`). */
export function numericFieldContribution(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === "object" && "kind" in raw && (raw as { kind?: unknown }).kind === "json" && "value" in raw) {
    return numericFieldContribution((raw as { value?: unknown }).value);
  }
  return 0;
}

/** Sums a field's numeric/array-length values across a collection of platform records. */
export function sumRecordField(rows: readonly PlatformObjectRecord[], field: string): number {
  let total = 0;
  for (const row of rows) {
    const value = row.fields?.[field] ?? row.tags?.[field];
    total += numericFieldContribution(value);
  }
  return total;
}

/**
 * Selects the first declared datum among `candidates` on an optional `PanelMemberContext` and wraps it with
 * `readerDataState`. Returns `null` when the component is rendered standalone outside a projection member or when none
 * of the candidate datums is declared on the projection.
 */
export function useOptionalMemberDatum<Name extends string>(
  member: PanelMemberContext | null,
  candidates: readonly Name[],
): { readonly name: Name; readonly state: ComputedRef<MemberDataState> } | null {
  if (!member) return null;
  const data = member.projection.data ?? {};
  for (const name of candidates) {
    if (Object.hasOwn(data, name)) {
      return { name, state: readerDataState(member.data.use(name)) };
    }
  }
  return null;
}

/** Reads an optional projection's `config` object safely. */
export function useProjectionConfig(member: PanelMemberContext | null): ComputedRef<Readonly<Record<string, unknown>> | undefined> {
  return computed(() => {
    const cfg = member?.projection.config;
    return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
  });
}
