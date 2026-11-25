import type {
  PanelObjectListColumn,
  PanelObjectListRowActionCondition,
  PanelObjectListRowActionItem,
  PanelObjectListRowActions,
} from "@ontomato/contracts/panel-projection";

/** Visual variant for `ObjectList` when `layout` is `"tabs"`. */
export type ObjectListTabsVariant = "underline" | "pill";

/**
 * Row-to-dialog prefill mapping for an operation row action.
 * - `true`: automatically prefills matching input fields from the row (`row.fields[name]`, or `row.label` for `"label"`/`"name"`/`"title"`).
 * - `Record<string, string>`: maps each dialog input field key to a row source (`"label"`, `"primaryKey"`, `"subtitle"`, `"fields.<key>"`, or `"<fieldKey>"`).
 */
export type ObjectListRowActionPrefill = boolean | Readonly<Record<string, string>>;

/** One column of `ObjectList` in table mode; omit `labelKey` when the field is named by its owner via `fieldLabels`. */
export type ObjectListColumn = PanelObjectListColumn;

/** One item (operation or local button) inside `ObjectList`'s `rowActions.items`. */
export type ObjectListRowActionItem =
  | (Extract<PanelObjectListRowActionItem, { kind: "operation" }> & {
      /** Maps operation input dialog field names to row field sources, or `true` to prefill matching fields from the row. */
      readonly prefill?: ObjectListRowActionPrefill;
    })
  | Extract<PanelObjectListRowActionItem, { kind: "local" }>;

/** Built-in action column configuration for `ObjectList`. */
export interface ObjectListRowActions extends Omit<PanelObjectListRowActions, "items"> {
  readonly items: readonly ObjectListRowActionItem[];
}

/** Per-row visibility or disabled condition evaluated against a row's fields. */
export type ObjectListRowActionCondition = PanelObjectListRowActionCondition;

/** Full object identity held in `ObjectList` single-selection and multi-selection ports. */
export interface ObjectListRef {
  readonly className: string;
  readonly primaryKey: string;
}

/** Event payload emitted when an inline tab rename commits a changed label. */
export interface ObjectListRenameCommitPayload {
  readonly ref: ObjectListRef;
  readonly value: string;
  readonly previousValue: string;
  readonly index: number;
}

/** Event payload emitted when an inline tab rename is cancelled or closed unchanged. */
export interface ObjectListRenameCancelPayload {
  readonly ref: ObjectListRef;
  readonly index: number;
}
