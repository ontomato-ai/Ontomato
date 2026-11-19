/** One option rendered by `SegmentedControl`, supplied by the panel template or projection display config. */
export interface SegmentedControlOption<Value extends string | number | boolean = string> {
  readonly value: Value;
  /** Panel message key (resolved via `panel.t`) or platform i18n key; used when `label` is omitted. */
  readonly labelKey?: string;
  /** Literal option label when not translating a key. */
  readonly label?: string;
  readonly disabled?: boolean;
}
