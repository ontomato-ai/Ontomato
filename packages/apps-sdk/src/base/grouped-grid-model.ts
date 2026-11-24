import type { PlatformObjectRecord } from "../panel/platform-objects";
import type {
  GroupedGridGroup,
  GroupedGridGroupSummary,
  GroupedGridItem,
  GroupedGridLayoutChange,
  GroupedGridSection,
} from "./grouped-grid-types";
import type { ObjectListRef } from "./object-list-types";

function rawRecordField(row: PlatformObjectRecord, key: string): unknown {
  if (key === "primaryKey") return row.primaryKey;
  if (key === "label") return row.label;
  if (key === "className") return row.className;
  if (key === "subtitle") return row.subtitle ?? row.fields.subtitle;
  return row.fields[key];
}

function unwrapJsonField(raw: unknown): unknown {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { kind?: unknown }).kind === "json" && "value" in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

export interface BuildGroupedGridOptions {
  readonly record: PlatformObjectRecord | null;
  readonly rows: readonly PlatformObjectRecord[];
  readonly rowObjectType: string;
  readonly columns: number;
  readonly minColSpan: number;
  readonly maxColSpan: number;
  readonly minRowSpan: number;
  readonly maxRowSpan: number;
  readonly groupsField: string;
  readonly groupKeyField: string;
  readonly groupTitleField: string;
  readonly sectionField?: string;
  readonly sectionOrder?: readonly string[];
  readonly colSpanField: string;
  readonly rowSpanField: string;
  readonly orderField: string;
  readonly fallbackGroupTitle?: string;
}

export function clampGridSpan(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  const resolved = Number.isFinite(num) ? Math.round(num) : fallback;
  return Math.max(min, Math.min(max, resolved));
}

function readNumericField(row: PlatformObjectRecord, field: string): number | undefined {
  const raw = unwrapJsonField(rawRecordField(row, field));
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readStringField(row: PlatformObjectRecord, field: string): string {
  const raw = unwrapJsonField(rawRecordField(row, field));
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "";
}

/** Extract ordered group descriptors from the optional parent container record's `groupsField`. */
export function extractContainerGroups(
  record: PlatformObjectRecord | null,
  groupsField: string,
): GroupedGridGroupSummary[] {
  if (!record || !groupsField) return [];
  const raw = unwrapJsonField(rawRecordField(record, groupsField));
  if (!Array.isArray(raw)) return [];
  const result: GroupedGridGroupSummary[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : typeof obj.key === "string" ? obj.key.trim() : "";
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = typeof obj.title === "string"
      ? obj.title
      : typeof obj.name === "string"
        ? obj.name
        : typeof obj.label === "string"
          ? obj.label
          : id;
    const order = typeof obj.order === "number" && Number.isFinite(obj.order) ? obj.order : index;
    result.push({ id, title, order });
  });
  return result.sort((a, b) => a.order - b.order);
}

/** Partition a group's items into section tracks when `sectionField` is configured. */
export function buildGroupSections(
  items: readonly GroupedGridItem[],
  sectionField?: string,
  sectionOrder?: readonly string[],
): GroupedGridSection[] {
  if (!sectionField) {
    return [{ key: "__default__", items }];
  }
  const bySection = new Map<string, GroupedGridItem[]>();
  const discoveredOrder: string[] = [];
  for (const item of items) {
    const key = item.section ?? "__default__";
    let bucket = bySection.get(key);
    if (!bucket) {
      bucket = [];
      bySection.set(key, bucket);
      discoveredOrder.push(key);
    }
    bucket.push(item);
  }
  const orderedKeys: string[] = [];
  if (sectionOrder && sectionOrder.length > 0) {
    for (const key of sectionOrder) {
      if (bySection.has(key) && !orderedKeys.includes(key)) orderedKeys.push(key);
    }
  }
  for (const key of discoveredOrder) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  }
  return orderedKeys.map((key) => ({
    key,
    items: (bySection.get(key) ?? []).slice().sort((a, b) => a.order - b.order || a.rowIndex - b.rowIndex),
  }));
}

/** Build ordered groups and grid items from optional container record + flat item records. */
export function buildGroupedGridGroups(options: BuildGroupedGridOptions): GroupedGridGroup[] {
  const maxCols = Math.max(1, Math.min(options.columns, options.maxColSpan));
  const minCols = Math.max(1, Math.min(maxCols, options.minColSpan));
  const minRows = Math.max(1, options.minRowSpan);
  const maxRows = Math.max(minRows, options.maxRowSpan);

  const containerGroups = extractContainerGroups(options.record, options.groupsField);
  const groupMap = new Map<string, { id: string; title: string; order: number; items: GroupedGridItem[] }>();
  for (const group of containerGroups) {
    groupMap.set(group.id, { ...group, items: [] });
  }

  options.rows.forEach((row, rowIndex) => {
    const rawGroupId = readStringField(row, options.groupKeyField);
    const groupId = rawGroupId || "__ungrouped__";
    const groupTitle = readStringField(row, options.groupTitleField)
      || (rawGroupId || options.fallbackGroupTitle || "");
    let group = groupMap.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        title: groupTitle,
        order: groupMap.size,
        items: [],
      };
      groupMap.set(groupId, group);
    } else if (!group.title && groupTitle) {
      group.title = groupTitle;
    }

    const section = options.sectionField ? (readStringField(row, options.sectionField) || undefined) : undefined;
    const order = readNumericField(row, options.orderField) ?? rowIndex;
    const colSpan = clampGridSpan(rawRecordField(row, options.colSpanField), minCols, maxCols, Math.min(6, maxCols));
    const rowSpan = clampGridSpan(rawRecordField(row, options.rowSpanField), minRows, maxRows, 1);
    const itemRef: ObjectListRef = {
      className: row.className || options.rowObjectType,
      primaryKey: row.primaryKey,
    };

    group.items.push({
      key: `${itemRef.className}:${itemRef.primaryKey}`,
      primaryKey: row.primaryKey,
      row,
      itemRef,
      rowIndex,
      groupId,
      section,
      order,
      colSpan,
      rowSpan,
    });
  });

  const sortedGroups = [...groupMap.values()].sort((a, b) => a.order - b.order);
  return sortedGroups.map((group, index) => {
    const sortedItems = group.items.slice().sort((a, b) => a.order - b.order || a.rowIndex - b.rowIndex);
    const sections = buildGroupSections(sortedItems, options.sectionField, options.sectionOrder);
    return {
      id: group.id,
      title: group.title,
      order: index,
      items: sections.flatMap((section) => section.items),
      sections,
    };
  });
}

/** Reorder a group from `sourceGroupId` to the position of `targetGroupId` (before or after). */
export function reorderGridGroups(
  groups: readonly GroupedGridGroup[],
  sourceGroupId: string,
  targetGroupId: string,
  position: "before" | "after" = "before",
): GroupedGridGroup[] | null {
  if (sourceGroupId === targetGroupId) return null;
  const sourceIndex = groups.findIndex((g) => g.id === sourceGroupId);
  const targetIndex = groups.findIndex((g) => g.id === targetGroupId);
  if (sourceIndex < 0 || targetIndex < 0) return null;
  const next = groups.slice();
  const [moved] = next.splice(sourceIndex, 1);
  if (!moved) return null;
  const adjustedTarget = next.findIndex((g) => g.id === targetGroupId);
  const insertAt = position === "after" ? adjustedTarget + 1 : adjustedTarget;
  next.splice(insertAt, 0, moved);
  const changed = next.some((group, idx) => group.id !== groups[idx]?.id);
  if (!changed) return null;
  return next.map((group, order) => ({ ...group, order }));
}

/** Move or reorder an item into a target group (and optionally before/after a target item). */
export function moveGridItem(
  groups: readonly GroupedGridGroup[],
  itemKey: string,
  targetGroupId: string,
  options?: {
    targetItemKey?: string;
    position?: "before" | "after";
    sectionField?: string;
    sectionOrder?: readonly string[];
  },
): GroupedGridGroup[] | null {
  let sourceGroupIndex = -1;
  let sourceItem: GroupedGridItem | null = null;
  for (let i = 0; i < groups.length; i += 1) {
    const found = groups[i]!.items.find((item) => item.key === itemKey);
    if (found) {
      sourceGroupIndex = i;
      sourceItem = found;
      break;
    }
  }
  if (!sourceItem || sourceGroupIndex < 0) return null;
  const targetGroupIndex = groups.findIndex((g) => g.id === targetGroupId);
  if (targetGroupIndex < 0) return null;
  if (options?.targetItemKey === itemKey) return null;

  const movedItem: GroupedGridItem = {
    ...sourceItem,
    groupId: targetGroupId,
  };

  const next = groups.map((group) => {
    const remaining = group.items.filter((item) => item.key !== itemKey);
    if (group.id !== targetGroupId) {
      const reindexed = remaining.map((item, idx) => ({ ...item, order: idx }));
      return {
        ...group,
        items: reindexed,
        sections: buildGroupSections(reindexed, options?.sectionField, options?.sectionOrder),
      };
    }

    const updated = remaining.slice();
    if (options?.targetItemKey) {
      const targetIdx = updated.findIndex((item) => item.key === options.targetItemKey);
      if (targetIdx >= 0) {
        const insertAt = options.position === "after" ? targetIdx + 1 : targetIdx;
        updated.splice(insertAt, 0, movedItem);
      } else {
        updated.push(movedItem);
      }
    } else {
      updated.push(movedItem);
    }

    // Reassign deterministic order per section (or overall when unsectioned).
    const sections = buildGroupSections(updated, options?.sectionField, options?.sectionOrder).map((section) => ({
      ...section,
      items: section.items.map((item, idx) => ({ ...item, order: idx })),
    }));
    const flatItems = sections.flatMap((section) => section.items);
    return {
      ...group,
      items: flatItems,
      sections,
    };
  });

  // Verify something actually changed (group or order).
  const prevSig = groups.map((g) => `${g.id}:${g.items.map((i) => i.key).join(",")}`).join("|");
  const nextSig = next.map((g) => `${g.id}:${g.items.map((i) => i.key).join(",")}`).join("|");
  if (prevSig === nextSig) return null;
  return next;
}

/** Update one item's column/row span and return the updated groups (or null if unchanged). */
export function resizeGridItem(
  groups: readonly GroupedGridGroup[],
  itemKey: string,
  colSpan: number,
  rowSpan: number,
): GroupedGridGroup[] | null {
  let changed = false;
  const next = groups.map((group) => {
    let groupChanged = false;
    const items = group.items.map((item) => {
      if (item.key !== itemKey) return item;
      if (item.colSpan === colSpan && item.rowSpan === rowSpan) return item;
      changed = true;
      groupChanged = true;
      return { ...item, colSpan, rowSpan };
    });
    if (!groupChanged) return group;
    const sections = group.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => (item.key === itemKey ? { ...item, colSpan, rowSpan } : item)),
    }));
    return { ...group, items, sections };
  });
  return changed ? next : null;
}

/** Convert current group structure into the structured `@layout-change` payload. */
export function buildLayoutChangePayload(groups: readonly GroupedGridGroup[]): GroupedGridLayoutChange {
  return {
    groups: groups.map((group) => ({
      id: group.id,
      title: group.title,
      items: group.items.map((item, index) => ({
        ref: item.itemRef,
        primaryKey: item.primaryKey,
        ...(item.section !== undefined ? { section: item.section } : {}),
        order: index,
        colSpan: item.colSpan,
        rowSpan: item.rowSpan,
      })),
    })),
  };
}
