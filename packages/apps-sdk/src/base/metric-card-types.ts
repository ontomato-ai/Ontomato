import type { PanelFieldTone } from "@ontomato/contracts/panel-projection";
import type { TypedNumberFormat } from "./display-value";

/** One statistic entry rendered by `MetricCard` when presenting multiple KPIs from one read or static values. */
export interface MetricCardItem {
  /** Fallback display title for this metric; omitted on a metric `result` falls back to the column's label or key. */
  readonly label?: string;
  /** Panel message key (resolved via `panel.t`) or platform i18n key for the metric title. */
  readonly labelKey?: string;
  /** Locale-keyed titles (for example `{ en: "Object types", "zh-CN": "对象类型" }`). */
  readonly labels?: Readonly<Record<string, string>>;
  /** Direct scalar value in standalone mode (ignored when reading from a bound datum unless the datum is absent). */
  readonly value?: string | number | null;
  /** Column key on a bound metric `result` (defaults to the first column) or field key on a bound `record`. */
  readonly field?: string;
  /** Zero-based row index when reading from a bound metric `result` table. Defaults to `0`. */
  readonly rowIndex?: number;
  /** Fallback unit suffix shown beside the numeral (for example `"%"`, `"ms"`). */
  readonly unit?: string;
  /** Panel or platform i18n key for the unit suffix. */
  readonly unitKey?: string;
  /** Locale-keyed unit suffixes. */
  readonly units?: Readonly<Record<string, string>>;
  /** Fallback supporting description rendered under the numeral. */
  readonly description?: string;
  /** Panel or platform i18n key for the supporting description. */
  readonly descriptionKey?: string;
  /** Locale-keyed supporting descriptions. */
  readonly descriptions?: Readonly<Record<string, string>>;
  /** Semantic tone emphasizing the card numeral or accent (`"default" | "info" | "success" | "warning" | "danger"`). */
  readonly tone?: PanelFieldTone;
  /** Optional `Intl.NumberFormat` options for numeric values. */
  readonly numberFormat?: TypedNumberFormat;
}
