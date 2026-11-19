import type { PlatformObjectFacetOption } from "../panel/platform-objects";

/** One column of `ObjectList` in table mode; field names, labels and rendering kinds come from the projection. */
export interface ObjectListColumn {
  /** Key in `record.fields`, or `"label"` / `"subtitle"` for the record's primary/secondary text. */
  readonly key: string;
  /** Column header text supplied by the projection/owner. */
  readonly label: string;
  /** Cell presentation: plain text, semantic status tag, tag list, or clickable object reference. */
  readonly kind?: "text" | "tag" | "tags" | "reference";
  /** Optional secondary field key drawn muted beneath this cell's primary value. */
  readonly subtitleKey?: string;
  /** Placeholder when the cell value is empty (defaults to `"—"`). */
  readonly empty?: string;
}

/** One option of a filter control (static or updated from the adapter's dynamic `facets`). */
export type ObjectListFilterOption = PlatformObjectFacetOption;

/** One filter control declared on `ObjectList`; query semantics belong to the resource adapter. */
export interface ObjectListFilter {
  /** Filter key passed to `adapter.query({ filters: { [key]: value } })`. */
  readonly key: string;
  /** Accessible label and dropdown placeholder. */
  readonly label: string;
  /** `"tabs"` renders segmented buttons (with optional counts); `"select"` renders a dropdown. */
  readonly kind?: "tabs" | "select";
  /** Initial or static options; replaced by dynamic `result.facets` matching `key` when returned. */
  readonly options?: readonly ObjectListFilterOption[];
  /** Initial filter value when the list mounts. */
  readonly defaultValue?: string;
}

/** Full object identity held in `ObjectList` single-selection and multi-selection ports. */
export interface ObjectListRef {
  readonly className: string;
  readonly primaryKey: string;
}
