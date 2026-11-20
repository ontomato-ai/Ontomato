import type { PanelObjectListColumn } from "@ontomato/contracts/panel-projection";

/** One column of `ObjectList` in table mode; omit `labelKey` when the field is named by its owner via `fieldLabels`. */
export type ObjectListColumn = PanelObjectListColumn;

/** Full object identity held in `ObjectList` single-selection and multi-selection ports. */
export interface ObjectListRef {
  readonly className: string;
  readonly primaryKey: string;
}
