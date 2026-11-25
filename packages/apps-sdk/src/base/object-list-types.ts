import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import type {
  PanelObjectListColumn,
  PanelObjectListRowActionCondition,
  PanelObjectListRowActionItem,
  PanelObjectListRowActions,
} from "@ontomato/contracts/panel-projection";
import type { PanelWriteResult } from "../panel/instance";

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

/** One item (operation, local button, or conversation entry) inside `ObjectList`'s `rowActions.items`. */
export type ObjectListRowActionItem =
  | (Extract<PanelObjectListRowActionItem, { kind: "operation" }> & {
      /** Maps operation input dialog field names to row field sources, or `true` to prefill matching fields from the row. */
      readonly prefill?: ObjectListRowActionPrefill;
    })
  | Exclude<PanelObjectListRowActionItem, { kind: "operation" }>;

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

/** Pagination and loading snapshot exposed by `ObjectList`'s `#status` slot. */
export interface ObjectListStateSnapshot {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number | null;
  readonly totalPages: number;
  readonly count: number;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly retry: (() => void) | null;
}

/** Safe row summary carried by `row-action-result` events. */
export interface ObjectListRowActionRowSummary {
  readonly className: string;
  readonly primaryKey: string;
  readonly label: string;
}

/** Payload emitted by `ObjectList`'s `row-action-result` event. */
export interface ObjectListRowActionResultEvent {
  readonly actionId: string;
  readonly row: ObjectListRowActionRowSummary;
  readonly ref: ObjectListRef;
  readonly ok: boolean;
  readonly outcome?: unknown;
  readonly data?: unknown;
  readonly message?: string;
  readonly error?: string;
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

/** Per-row, per-operation execution state and retained result inside `ObjectList`. */
export interface ObjectListRowOperationState {
  readonly running: boolean;
  readonly result?: PanelReadOperationResult;
  readonly receipt?: PanelHumanOperationDispatchResponse;
  readonly named?: PanelWriteResult["named"];
  readonly error?: string;
}

/** Configuration for submitting the `ObjectList` top search box on Enter. */
export interface ObjectListSearchSubmit {
  readonly operation: string;
  readonly inputField: string;
}

/** Supported semantic tones for whole-row table highlighting (`rowToneField` / `rowToneMap`). */
export type ObjectListRowTone = "success" | "danger" | "warning" | "info";
