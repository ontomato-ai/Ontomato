/** One metric item rendered by `ObjectCount` from the member's bound record collection. */
export interface ObjectCountItem {
  /** Fallback unit label shown beside the count when `labelKey` resolves no label. */
  readonly label?: string;
  /** Panel message key (resolved via `panel.t`) or platform i18n key for the unit label. */
  readonly labelKey?: string;
}
