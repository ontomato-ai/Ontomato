import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelRowOperationAvailability } from "@ontomato/contracts/panel-host";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListRef } from "./object-list-types";

/** Metadata for one group extracted from the parent record or derived from item records. */
export interface GroupedGridGroupSummary {
  readonly id: string;
  readonly title: string;
  readonly order: number;
}

/** One resolved item inside a group or section of `GroupedGrid`. */
export interface GroupedGridItem {
  readonly key: string;
  readonly primaryKey: string;
  readonly row: PlatformObjectRecord;
  readonly itemRef: ObjectListRef;
  readonly rowIndex: number;
  readonly groupId: string;
  readonly section: string | undefined;
  readonly order: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** One section track inside a group (present when `sectionField` partitions items into separate grid tracks). */
export interface GroupedGridSection {
  readonly key: string;
  readonly items: readonly GroupedGridItem[];
}

/** One rendered group in `GroupedGrid`, preserving empty groups from the parent record when supplied. */
export interface GroupedGridGroup {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly items: readonly GroupedGridItem[];
  readonly sections: readonly GroupedGridSection[];
}

/** Structured item layout entry emitted by `@layout-change`. */
export interface GroupedGridLayoutItem {
  readonly ref: ObjectListRef;
  readonly primaryKey: string;
  readonly section?: string;
  readonly order: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

/** Structured group layout entry emitted by `@layout-change`. */
export interface GroupedGridLayoutGroup {
  readonly id: string;
  readonly title: string;
  readonly items: readonly GroupedGridLayoutItem[];
}

/** Payload emitted by `GroupedGrid` when the user completes a drag reorder or resize interaction. */
export interface GroupedGridLayoutChange {
  readonly groups: readonly GroupedGridLayoutGroup[];
}

/** Scoped props passed to `#item` and `#item-header-actions` slots. */
export interface GroupedGridItemSlotScope {
  readonly row: PlatformObjectRecord;
  readonly itemRef: ObjectListRef;
  readonly group: GroupedGridGroupSummary;
  readonly section: string | undefined;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly resizing: boolean;
  readonly operations: Readonly<Record<string, PanelRowOperationAvailability>>;
  readonly runOperation: (operation: string, extraInput?: Readonly<Record<string, RuntimeJsonValue>>) => Promise<void>;
}

/** Scoped props passed to `#group-header-actions` slot. */
export interface GroupedGridGroupSlotScope {
  readonly group: GroupedGridGroupSummary;
  readonly index: number;
  readonly itemCount: number;
  readonly collapsed: boolean;
  readonly toggleCollapse: () => void;
}
