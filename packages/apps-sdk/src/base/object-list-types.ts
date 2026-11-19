import type { PanelObjectListColumn } from "@ontomato/contracts/panel-projection";
import type { PlatformObjectFacetOption } from "../panel/platform-objects";

/** One column of `ObjectList` in table mode; omit `labelKey` when the field is named by its owner via `fieldLabels`. */
export type ObjectListColumn = PanelObjectListColumn;

/** One option of a filter control (static or updated from the adapter's dynamic `facets`). */
export type ObjectListFilterOption = PlatformObjectFacetOption;

/** One filter control declared on `ObjectList`; query semantics belong to the resource adapter. */
export interface ObjectListFilter {
  /** Filter key passed to `adapter.query({ filters: { [key]: value } })`. */
  readonly key: string;
  /** Accessible label or panel message key, and dropdown placeholder. */
  readonly label?: string;
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
