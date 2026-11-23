import type {
  PanelObjectListColumn,
  PanelObjectListRowActionCondition,
  PanelObjectListRowActionItem,
  PanelObjectListRowActions,
} from "@ontomato/contracts/panel-projection";

/** One column of `ObjectList` in table mode; omit `labelKey` when the field is named by its owner via `fieldLabels`. */
export type ObjectListColumn = PanelObjectListColumn;

/** Built-in action column configuration for `ObjectList`. */
export type ObjectListRowActions = PanelObjectListRowActions;

/** One item (operation or local button) inside `ObjectList`'s `rowActions.items`. */
export type ObjectListRowActionItem = PanelObjectListRowActionItem;

/** Per-row visibility or disabled condition evaluated against a row's fields. */
export type ObjectListRowActionCondition = PanelObjectListRowActionCondition;

/** Full object identity held in `ObjectList` single-selection and multi-selection ports. */
export interface ObjectListRef {
  readonly className: string;
  readonly primaryKey: string;
}
