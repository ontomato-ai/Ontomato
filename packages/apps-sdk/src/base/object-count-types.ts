/** One metric item rendered by `ObjectCount` from the member's bound record collection. */
export interface ObjectCountItem {
  /** Fallback unit label shown beside the count when neither `labelKey` nor `labels` resolves a label. */
  readonly label?: string;
  /** Panel message key (resolved via `panel.t`) or platform i18n key for the unit label. */
  readonly labelKey?: string;
  /** Locale-keyed unit labels (e.g. `{ en: "Object types", de: "Objekttypen" }`) used when `labelKey` is omitted. */
  readonly labels?: Readonly<Record<string, string>>;
  /**
   * Optional field key on each record to sum instead of counting rows. Supports numbers, numeric strings, arrays
   * (summed by length), and `{ kind: "json", value: ... }` field wrappers (array length or finite number).
   */
  readonly sumField?: string;
}
