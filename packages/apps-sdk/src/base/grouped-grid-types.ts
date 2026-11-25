import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelRowOperationAvailability } from "@ontomato/contracts/panel-host";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import type { ObjectListRef } from "./object-list-types";

/** Resize axis constraint for one grid section or item. */
export type GroupedGridResizeAxis = "both" | "horizontal" | "vertical" | "none";

/** Outer surface style for each group container. */
export type GroupedGridGroupSurface = "plain" | "card";

/** Outer surface style for each item container. */
export type GroupedGridItemSurface = "card" | "section";

/** Row height sizing strategy for grid tracks. */
export type GroupedGridRowSizing = "fixed" | "auto";

/** Bottom divider style under an item header. */
export type GroupedGridDividerStyle = "line" | "none";

/** When item header controls, drag grip, and resize handles are visible. */
export type GroupedGridControlsVisibility = "hover" | "always";

/** Optional unsaved draft override associated with one item during whole-grid draft preview. */
export interface GroupedGridItemDraftOverride {
  readonly title?: string;
  readonly fileOverride?: unknown;
  readonly fields?: Readonly<Record<string, unknown>>;
}

/** Static group definition for fixed-member mode of `GroupedGrid` (when no `rows` datum is bound). */
export interface GroupedGridStaticGroupConfig {
  readonly id: string;
  readonly title?: string;
  readonly titleKey?: string;
}

/** Static item definition for fixed-member mode of `GroupedGrid` (when no `rows` datum is bound). */
export interface GroupedGridStaticItemConfig {
  readonly id: string;
  readonly title?: string;
  readonly titleKey?: string;
  readonly groupId?: string;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly minColSpan?: number;
  readonly maxColSpan?: number;
  readonly minRowSpan?: number;
  readonly maxRowSpan?: number;
  readonly hidden?: boolean;
  readonly hideable?: boolean;
}

/** Typed `grid-layout` state value read from and written back to the panel's `layout` port. */
export interface GroupedGridLayoutState {
  readonly groups: readonly {
    readonly id: string;
    readonly title?: string;
    readonly items: readonly {
      readonly id: string;
      readonly colSpan: number;
      readonly rowSpan: number;
      readonly hidden?: boolean;
    }[];
  }[];
}

/** Metadata for one group extracted from the parent record or derived from item records. */
export interface GroupedGridGroupSummary {
  readonly id: string;
  readonly title: string;
  readonly order: number;
}

/** One resolved item inside a group or section of `GroupedGrid`. */
export interface GroupedGridItem {
  readonly key: string;
  readonly itemId: string;
  readonly title: string;
  readonly primaryKey: string;
  readonly row: PlatformObjectRecord;
  readonly itemRef: ObjectListRef;
  readonly rowIndex: number;
  readonly groupId: string;
  readonly section: string | undefined;
  readonly order: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly minColSpan?: number;
  readonly maxColSpan?: number;
  readonly minRowSpan?: number;
  readonly maxRowSpan?: number;
  readonly hideable?: boolean;
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

/** Scoped props passed to `#item`, `#item-title-suffix`, and `#item-header-actions` slots. */
export interface GroupedGridItemSlotScope {
  readonly itemId: string;
  readonly title: string;
  readonly row: PlatformObjectRecord;
  readonly itemRef: ObjectListRef;
  readonly group: GroupedGridGroupSummary;
  readonly section: string | undefined;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly resizing: boolean;
  readonly locked: boolean;
  readonly modified: boolean;
  readonly draftOverride?: GroupedGridItemDraftOverride;
  readonly operations: Readonly<Record<string, PanelRowOperationAvailability>>;
  readonly runOperation: (operation: string, extraInput?: Readonly<Record<string, RuntimeJsonValue>>) => Promise<void>;
}

/** Scoped props passed to `#group-header-actions` slot. */
export interface GroupedGridGroupSlotScope {
  readonly group: GroupedGridGroupSummary;
  readonly index: number;
  readonly itemCount: number;
  readonly collapsed: boolean;
  readonly locked: boolean;
  readonly toggleCollapse: () => void;
}
