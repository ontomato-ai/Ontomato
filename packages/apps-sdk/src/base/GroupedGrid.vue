<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelRowOperationAvailability, PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  directReadRowType,
  panelRowOperationKey,
} from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionSlot } from "../panel/context";
import { useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam } from "../panel/member";
import { admittedOperations } from "../panel/member-operations";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { stateObject, type PanelFieldValue } from "../panel/state";
import { useDataStateLabels } from "./data-state-labels";
import {
  buildGroupedGridGroups,
  buildLayoutChangePayload,
  clampGridSpan,
  moveGridItem,
  reorderGridGroups,
  resizeGridItem,
} from "./grouped-grid-model";
import type {
  GroupedGridGroup,
  GroupedGridGroupSlotScope,
  GroupedGridGroupSummary,
  GroupedGridItem,
  GroupedGridItemSlotScope,
  GroupedGridLayoutChange,
} from "./grouped-grid-types";
import {
  allowedRowOperationInputKeys,
  filterAllowedRowOperationInput,
  matchesRowActionWhen,
  resolveRowActionAddress,
  resolveRowOperationParams,
  resolveRowOperationTarget,
} from "./object-list-actions";
import type { ObjectListRef, ObjectListRowActions as ObjectListRowActionsConfig } from "./object-list-types";
import ObjectListRowActions, { type ResolvedRowActionItem } from "./ObjectListRowActions.vue";
import {
  formatOperationOutcome,
  resolveOperationInputFields,
} from "./operation-dispatch";
import { isActionValuesEnvelope, wrapActionOperationInput, type OperationInputField } from "./operation-input-schema";
import OperationInputDialog from "./OperationInputDialog.vue";

/**
 * Pure generic grouped 12-column grid layout with collapsible groups, optional section tracks, drag-and-drop
 * reordering (within and across groups, plus group reordering), pointer-driven cell resizing, selection sync, and
 * per-item row actions. Never fetches cell body content itself; callers render cell bodies through the `#item` slot.
 */
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Number of CSS grid columns (default `12`). */
    columns?: number;
    /** Base height in pixels for one grid row track (default `160`). */
    rowHeight?: number;
    /** Grid gap in pixels between cells (default `16`). */
    gap?: number;
    /** Item record field holding the group identifier (default `"groupId"`). */
    groupKeyField?: string;
    /** Item record field holding the fallback group title (default `"groupTitle"`). */
    groupTitleField?: string;
    /** Optional parent container `record` field holding ordered group metadata (default `"groups"`). */
    groupsField?: string;
    /** Optional item record field that partitions items into separate stacked grid tracks inside each group. */
    sectionField?: string;
    /** Optional explicit ordering of section track keys when `sectionField` is set. */
    sectionOrder?: readonly string[];
    /** Item record field holding the column span (default `"colSpan"`). */
    colSpanField?: string;
    /** Item record field holding the row span (default `"rowSpan"`). */
    rowSpanField?: string;
    /** Item record field holding the sort order within a group or section (default `"order"`). */
    orderField?: string;
    /** Minimum column span allowed when resizing (default `2`). */
    minColSpan?: number;
    /** Maximum column span allowed when resizing (default `12`, capped at `columns`). */
    maxColSpan?: number;
    /** Minimum row span allowed when resizing (default `1`). */
    minRowSpan?: number;
    /** Maximum row span allowed when resizing (default `6`). */
    maxRowSpan?: number;
    /** Enable drag-and-drop reordering and cell resize handles (default `true`). */
    editable?: boolean;
    /** Allow collapsing/expanding groups from the group header (default `true`). */
    collapsible?: boolean;
    /** Optional per-item row actions (same shape as `ObjectList.rowActions`). */
    rowActions?: ObjectListRowActionsConfig;
    /** Fallback text shown when there are no groups and no items. */
    emptyText?: string;
    /** Fallback text shown inside an empty group when `#group-empty` is not provided. */
    emptyGroupText?: string;
    /** Optional list of item primary keys to mark with a subtle highlight ring (for example draft-modified items). */
    highlightedIds?: readonly string[];
  }>(),
  {
    columns: 12,
    rowHeight: 160,
    gap: 16,
    groupKeyField: "groupId",
    groupTitleField: "groupTitle",
    groupsField: "groups",
    sectionField: undefined,
    sectionOrder: undefined,
    colSpanField: "colSpan",
    rowSpanField: "rowSpan",
    orderField: "order",
    minColSpan: 2,
    maxColSpan: 12,
    minRowSpan: 1,
    maxRowSpan: 6,
    editable: true,
    collapsible: true,
    rowActions: undefined,
    emptyText: undefined,
    emptyGroupText: undefined,
    highlightedIds: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted only when the user completes a drag reorder or resize interaction (never on load or restore). */
  "layout-change": [payload: GroupedGridLayoutChange];
  /** Emitted when the reader clicks an item to select it. */
  select: [ref: ObjectListRef | null];
  /** Emitted when a local row action (`kind: "local"`) is triggered on an item. */
  "row-action": [payload: { id: string; ref: ObjectListRef; index: number }];
}>();

defineSlots<{
  /** Cell body renderer; receives item metadata, reference, spans, selection, drag/resize state, and row operations. */
  item?(props: GroupedGridItemSlotScope): unknown;
  /** Optional header controls rendered beside built-in row actions on each item card. */
  "item-header-actions"?(props: GroupedGridItemSlotScope): unknown;
  /** Optional controls rendered on the right side of each group header. */
  "group-header-actions"?(props: GroupedGridGroupSlotScope): unknown;
  /** Custom empty state rendered inside an empty group. */
  "group-empty"?(props: { group: GroupedGridGroupSummary }): unknown;
  /** Custom empty state rendered when there are no groups and no items. */
  empty?(): unknown;
}>();

const { t } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const member = useMember();
const objectType = projectionElement(slot.projection).id;

const rowsDatum = member.projection.data.rows;
if (!rowsDatum) {
  throw new Error(`Projection ${member.projection.id} declares no 'rows' datum for GroupedGrid`);
}
const rowObjectType = directReadRowType(member.projection, rowsDatum) ?? objectType;

const rowsState = useMemberData("rows");
const hasRecordDatum = "record" in member.projection.data;
const recordState = hasRecordDatum ? useMemberData("record") : null;
const operationsState = useMemberOperations();
const selectedParam = useMemberParam("selected");

const effectiveColumns = computed(() => Math.max(1, Math.min(24, Math.floor(props.columns || 12))));
const effectiveRowHeight = computed(() => Math.max(48, Math.floor(props.rowHeight || 160)));
const effectiveGap = computed(() => Math.max(0, Math.floor(props.gap ?? 16)));
const effectiveMaxColSpan = computed(() => Math.max(1, Math.min(effectiveColumns.value, Math.floor(props.maxColSpan || effectiveColumns.value))));
const effectiveMinColSpan = computed(() => Math.max(1, Math.min(effectiveMaxColSpan.value, Math.floor(props.minColSpan || 1))));
const effectiveMinRowSpan = computed(() => Math.max(1, Math.floor(props.minRowSpan || 1)));
const effectiveMaxRowSpan = computed(() => Math.max(effectiveMinRowSpan.value, Math.floor(props.maxRowSpan || 6)));

const containerRecord = computed<PlatformObjectRecord | null>(() => {
  if (!recordState) return null;
  const current = recordState.value;
  if (current.status !== "ready" || !current.value || typeof current.value !== "object" || Array.isArray(current.value)) {
    return null;
  }
  return current.value as unknown as PlatformObjectRecord;
});

const rawRows = computed<readonly PlatformObjectRecord[]>(() => {
  const current = rowsState.value;
  if (current.status !== "ready") return [];
  return Array.isArray(current.value) ? (current.value as unknown as readonly PlatformObjectRecord[]) : [];
});

const rowOperationsMap = computed<PanelRowOperationsMap | undefined>(() => {
  const current = rowsState.value;
  if (current.status !== "ready") return undefined;
  return current.rowOperations;
});

const sourceGroups = computed<GroupedGridGroup[]>(() =>
  buildGroupedGridGroups({
    record: containerRecord.value,
    rows: rawRows.value,
    rowObjectType,
    columns: effectiveColumns.value,
    minColSpan: effectiveMinColSpan.value,
    maxColSpan: effectiveMaxColSpan.value,
    minRowSpan: effectiveMinRowSpan.value,
    maxRowSpan: effectiveMaxRowSpan.value,
    groupsField: props.groupsField,
    groupKeyField: props.groupKeyField,
    groupTitleField: props.groupTitleField,
    sectionField: props.sectionField,
    sectionOrder: props.sectionOrder,
    colSpanField: props.colSpanField,
    rowSpanField: props.rowSpanField,
    orderField: props.orderField,
  }),
);

/** Local optimistic layout applied immediately after a user drag/resize until fresh server data arrives. */
const localGroups = shallowRef<GroupedGridGroup[] | null>(null);
watch([rawRows, containerRecord], () => {
  localGroups.value = null;
});

const groups = computed<readonly GroupedGridGroup[]>(() => localGroups.value ?? sourceGroups.value);

const totalItems = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0));

const gridDataResult = computed<DataStateResult<readonly GroupedGridGroup[]>>(() => {
  const r = rowsState.value;
  if (r.status === "loading" || r.status === "awaiting" || r.status === "forbidden" || r.status === "error") {
    return r;
  }
  if (recordState) {
    const rec = recordState.value;
    if (rec.status === "loading" || rec.status === "awaiting" || rec.status === "forbidden" || rec.status === "error") {
      return rec;
    }
  }
  if (groups.value.length === 0) {
    return { status: "empty" };
  }
  return { status: "ready", value: groups.value };
});

const dataStateLabels = useDataStateLabels(() => props.emptyText || t("platform.dataEmpty"));

useMemberOutput("status", () => gridDataResult.value.status);
useMemberOutput("groupCount", () => (gridDataResult.value.status === "ready" ? groups.value.length : 0));
useMemberOutput("itemCount", () => (gridDataResult.value.status === "ready" ? totalItems.value : 0));

/* ── Selection & highlight ────────────────────────────────────────────────────────────────── */

const selectedKey = computed<string | null>(() => {
  const obj = stateObject(selectedParam.value.value as PanelFieldValue);
  if (!obj) return null;
  return `${obj.className}:${obj.primaryKey}`;
});

const highlightedSet = computed(() => new Set(props.highlightedIds ?? []));

function selectItem(item: GroupedGridItem) {
  selectedParam.set({ className: item.itemRef.className, primaryKey: item.itemRef.primaryKey });
  emit("select", item.itemRef);
}

const itemElements = new Map<string, HTMLElement>();
function setItemElement(key: string, el: unknown) {
  if (el instanceof HTMLElement) {
    itemElements.set(key, el);
  } else {
    itemElements.delete(key);
  }
}

let lastScrolledKey: string | null = null;
watch(
  [selectedKey, () => gridDataResult.value.status, () => totalItems.value],
  ([key, status]) => {
    if (!key) {
      lastScrolledKey = null;
      return;
    }
    if (status !== "ready" || key === lastScrolledKey) return;
    void nextTick(() => {
      const target = itemElements.get(key);
      if (target) {
        lastScrolledKey = key;
        target.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      }
    });
  },
  { immediate: true },
);

/* ── Collapsible groups ───────────────────────────────────────────────────────────────────── */

const collapsedGroups = reactive(new Set<string>());

function isGroupCollapsed(groupId: string): boolean {
  return props.collapsible && collapsedGroups.has(groupId);
}

function toggleGroupCollapsed(groupId: string) {
  if (!props.collapsible) return;
  if (collapsedGroups.has(groupId)) collapsedGroups.delete(groupId);
  else collapsedGroups.add(groupId);
}

/* ── Row actions & operation dispatch ─────────────────────────────────────────────────────── */

const admittedOperationDescriptors = computed<Readonly<Record<string, PanelOwnerOperationDescriptor>>>(() =>
  admittedOperations(operationsState.value),
);

function rowOperationsFor(row: PlatformObjectRecord): Readonly<Record<string, PanelRowOperationAvailability>> {
  const key = panelRowOperationKey(row, rowObjectType);
  return rowOperationsMap.value?.[key] ?? {};
}

function resolvedRowActionsFor(row: PlatformObjectRecord): readonly ResolvedRowActionItem[] {
  const cfg = props.rowActions;
  if (!cfg?.items?.length) return [];
  const rowOps = rowOperationsFor(row);
  const resolved: ResolvedRowActionItem[] = [];
  for (let i = 0; i < cfg.items.length; i += 1) {
    const item = cfg.items[i]!;
    if (!matchesRowActionWhen(row, item.when)) continue;
    if (item.kind === "local") {
      if (!item.id) continue;
      const label = item.labelKey ? panel.t(item.labelKey) : item.label ?? item.id;
      resolved.push({
        key: `local:${item.id}:${i}`,
        kind: "local",
        id: item.id,
        to: item.to,
        label,
        icon: item.icon,
        iconOnly: item.iconOnly,
        danger: Boolean(item.danger),
        primary: Boolean(item.primary),
        disabled: false,
      });
      continue;
    }
    if (!item.operation) continue;
    const label = item.labelKey ? panel.t(item.labelKey) : item.label ?? item.operation;
    const availability = rowOps[item.operation];
    const descriptor = admittedOperationDescriptors.value[item.operation];
    const unavailable = availability ? !availability.available : !descriptor;
    if (unavailable && item.hideWhenUnavailable) continue;
    const reason = availability?.unavailable?.reason ?? (descriptor ? undefined : t("platform.operationUnavailable"));
    resolved.push({
      key: `op:${item.operation}:${i}`,
      kind: "operation",
      operation: item.operation,
      label,
      icon: item.icon,
      iconOnly: item.iconOnly,
      danger: Boolean(item.danger),
      primary: Boolean(item.primary),
      disabled: unavailable,
      reason,
    });
  }
  return resolved;
}

const rowOpRunning = ref(false);
const lastOpNotice = shallowRef<{ tone: "info" | "success" | "danger"; message: string } | null>(null);
const pendingInputDialog = shallowRef<{
  row: PlatformObjectRecord;
  operation: string;
  descriptor: PanelOwnerOperationDescriptor;
  fields: readonly OperationInputField[];
  boundInput: Record<string, RuntimeJsonValue>;
  extraInput: Record<string, RuntimeJsonValue>;
} | null>(null);

async function dispatchRowOperation(
  row: PlatformObjectRecord,
  operation: string,
  extraInput: Readonly<Record<string, RuntimeJsonValue>> = {},
) {
  if (rowOpRunning.value) return;
  const descriptor = admittedOperationDescriptors.value[operation];
  const binding = member.projection.operations?.[operation];
  if (!descriptor || !binding) {
    lastOpNotice.value = { tone: "danger", message: t("platform.operationUnavailable") };
    return;
  }

  const boundInput = resolveRowOperationParams(binding, row, member.inputs.value);
  const allFields = resolveOperationInputFields(panel, slot, operation, descriptor);
  const allowedKeys = allowedRowOperationInputKeys(binding, allFields);
  const filteredExtra = filterAllowedRowOperationInput(extraInput, allowedKeys);
  const suppliedKeys = new Set([...Object.keys(boundInput), ...Object.keys(filteredExtra)]);
  const missingFields = allFields.filter((field) => allowedKeys.has(field.name) && !suppliedKeys.has(field.name));
  if (missingFields.length > 0) {
    pendingInputDialog.value = {
      row,
      operation,
      descriptor,
      fields: missingFields,
      boundInput,
      extraInput: filteredExtra,
    };
    return;
  }

  await executeRowOperation(row, operation, descriptor, boundInput, filteredExtra);
}

async function executeRowOperation(
  row: PlatformObjectRecord,
  operation: string,
  descriptor: PanelOwnerOperationDescriptor,
  boundInput: Record<string, RuntimeJsonValue>,
  providedInput: Record<string, RuntimeJsonValue>,
) {
  const binding = member.projection.operations?.[operation];
  if (!binding) return;
  const target = resolveRowOperationTarget(binding, row, rowObjectType, member.inputs.value);
  if (target === undefined) return;
  const operationId = panel.instance.operationIdOf(slot.slot, operation);
  const input: Record<string, RuntimeJsonValue> = isActionValuesEnvelope(descriptor.inputSchema)
    ? wrapActionOperationInput(descriptor.inputSchema, boundInput, providedInput)
    : { ...providedInput, ...boundInput };

  rowOpRunning.value = true;
  lastOpNotice.value = null;
  try {
    if (descriptor.effect === "read") {
      await panel.instance.readOperation(operationId, { target, input });
      return;
    }
    const answer = await panel.instance.writeOperation(operationId, { call: { target, input } });
    if (answer.decision === "cancel" || !answer.response) return;
    const outcome = answer.response.kind === "dispatched" ? answer.response.outcome : undefined;
    if (outcome?.kind === "success") {
      panel.notify({ kind: "success", text: formatOperationOutcome(outcome, t) });
    } else if (outcome && outcome.kind !== "batch") {
      lastOpNotice.value = {
        tone: outcome.kind === "failure" || outcome.kind === "refusal" ? "danger" : "info",
        message: formatOperationOutcome(outcome, t),
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastOpNotice.value = { tone: "danger", message };
  } finally {
    rowOpRunning.value = false;
  }
}

async function submitPendingInputDialog(values: Record<string, RuntimeJsonValue>) {
  const pending = pendingInputDialog.value;
  if (!pending) return;
  pendingInputDialog.value = null;
  await executeRowOperation(pending.row, pending.operation, pending.descriptor, pending.boundInput, {
    ...values,
    ...pending.extraInput,
  });
}

function triggerRowAction(item: GroupedGridItem, action: ResolvedRowActionItem) {
  if (action.kind === "local" && action.id) {
    const address = action.to ? resolveRowActionAddress(action.to, item.row, rowObjectType) : null;
    if (address) {
      void panel.navigate(address);
      return;
    }
    emit("row-action", { id: action.id, ref: item.itemRef, index: item.rowIndex });
    return;
  }
  if (action.kind === "operation" && action.operation) {
    void dispatchRowOperation(item.row, action.operation);
  }
}

/* ── Drag and drop (groups & items) ───────────────────────────────────────────────────────── */

const draggingGroupId = ref<string | null>(null);
const dropGroupTarget = ref<{ groupId: string; position: "before" | "after" } | null>(null);

const draggingItemKey = ref<string | null>(null);
const dropItemTarget = ref<{ groupId: string; itemKey?: string; position?: "before" | "after" } | null>(null);

function clearDragState() {
  draggingGroupId.value = null;
  dropGroupTarget.value = null;
  draggingItemKey.value = null;
  dropItemTarget.value = null;
}

function commitLayoutChange(next: GroupedGridGroup[] | null) {
  if (!next) return;
  localGroups.value = next;
  emit("layout-change", buildLayoutChangePayload(next));
}

function onGroupDragStart(groupId: string, event: DragEvent) {
  if (!props.editable) return;
  draggingGroupId.value = groupId;
  draggingItemKey.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `group:${groupId}`);
  }
}

function onGroupDragOver(targetGroupId: string, event: DragEvent) {
  if (!props.editable) return;
  if (draggingGroupId.value && draggingGroupId.value !== targetGroupId) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const el = event.currentTarget as HTMLElement | null;
    const rect = el?.getBoundingClientRect();
    const position: "before" | "after" = rect && event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    dropGroupTarget.value = { groupId: targetGroupId, position };
    return;
  }
  if (draggingItemKey.value) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (!dropItemTarget.value || dropItemTarget.value.groupId !== targetGroupId) {
      dropItemTarget.value = { groupId: targetGroupId };
    }
  }
}

function onGroupDrop(targetGroupId: string, event: DragEvent) {
  if (!props.editable) return;
  event.preventDefault();
  if (draggingGroupId.value) {
    const position = dropGroupTarget.value?.groupId === targetGroupId ? dropGroupTarget.value.position : "before";
    const next = reorderGridGroups(groups.value, draggingGroupId.value, targetGroupId, position);
    clearDragState();
    commitLayoutChange(next);
    return;
  }
  if (draggingItemKey.value) {
    const next = moveGridItem(groups.value, draggingItemKey.value, targetGroupId, {
      sectionField: props.sectionField,
      sectionOrder: props.sectionOrder,
    });
    clearDragState();
    commitLayoutChange(next);
  }
}

function onItemDragStart(item: GroupedGridItem, event: DragEvent) {
  if (!props.editable || activeResize.value) return;
  event.stopPropagation();
  draggingItemKey.value = item.key;
  draggingGroupId.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `item:${item.key}`);
  }
}

function onItemDragOver(groupId: string, targetItem: GroupedGridItem, event: DragEvent) {
  if (!props.editable || !draggingItemKey.value || draggingItemKey.value === targetItem.key) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const el = event.currentTarget as HTMLElement | null;
  const rect = el?.getBoundingClientRect();
  const position: "before" | "after" = rect && event.clientX > rect.left + rect.width / 2 ? "after" : "before";
  dropItemTarget.value = { groupId, itemKey: targetItem.key, position };
}

function onItemDrop(groupId: string, targetItem: GroupedGridItem, event: DragEvent) {
  if (!props.editable || !draggingItemKey.value) return;
  event.preventDefault();
  event.stopPropagation();
  const position = dropItemTarget.value?.itemKey === targetItem.key ? dropItemTarget.value.position : "before";
  const next = moveGridItem(groups.value, draggingItemKey.value, groupId, {
    targetItemKey: targetItem.key,
    position,
    sectionField: props.sectionField,
    sectionOrder: props.sectionOrder,
  });
  clearDragState();
  commitLayoutChange(next);
}

/* ── Pointer-driven cell resizing ─────────────────────────────────────────────────────────── */

interface ResizeSession {
  readonly itemKey: string;
  readonly startX: number;
  readonly startY: number;
  readonly startColSpan: number;
  readonly startRowSpan: number;
  readonly colUnit: number;
  readonly rowUnit: number;
  colSpan: number;
  rowSpan: number;
}

const activeResize = ref<ResizeSession | null>(null);

function startItemResize(item: GroupedGridItem, event: PointerEvent) {
  if (!props.editable) return;
  event.preventDefault();
  event.stopPropagation();
  const cellEl = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(".sdk-grouped-grid-item");
  const trackEl = cellEl?.parentElement;
  const trackWidth = trackEl?.getBoundingClientRect().width || 960;
  const cols = effectiveColumns.value;
  const gap = effectiveGap.value;
  const colUnit = Math.max(24, (trackWidth - gap * (cols - 1)) / cols + gap);
  const rowUnit = Math.max(48, effectiveRowHeight.value + gap);

  activeResize.value = {
    itemKey: item.key,
    startX: event.clientX,
    startY: event.clientY,
    startColSpan: item.colSpan,
    startRowSpan: item.rowSpan,
    colUnit,
    rowUnit,
    colSpan: item.colSpan,
    rowSpan: item.rowSpan,
  };

  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeEnd);
  window.addEventListener("pointercancel", onResizeCancel);
}

function onResizeMove(event: PointerEvent) {
  const session = activeResize.value;
  if (!session) return;
  const deltaCols = Math.round((event.clientX - session.startX) / session.colUnit);
  const deltaRows = Math.round((event.clientY - session.startY) / session.rowUnit);
  session.colSpan = clampGridSpan(
    session.startColSpan + deltaCols,
    effectiveMinColSpan.value,
    effectiveMaxColSpan.value,
    session.startColSpan,
  );
  session.rowSpan = clampGridSpan(
    session.startRowSpan + deltaRows,
    effectiveMinRowSpan.value,
    effectiveMaxRowSpan.value,
    session.startRowSpan,
  );
}

function detachResizeListeners() {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
  window.removeEventListener("pointercancel", onResizeCancel);
}

function onResizeEnd() {
  detachResizeListeners();
  const session = activeResize.value;
  activeResize.value = null;
  if (!session) return;
  const next = resizeGridItem(groups.value, session.itemKey, session.colSpan, session.rowSpan);
  commitLayoutChange(next);
}

function onResizeCancel() {
  detachResizeListeners();
  activeResize.value = null;
}

onBeforeUnmount(() => {
  detachResizeListeners();
});

function displayColSpan(item: GroupedGridItem): number {
  return activeResize.value?.itemKey === item.key ? activeResize.value.colSpan : item.colSpan;
}

function displayRowSpan(item: GroupedGridItem): number {
  return activeResize.value?.itemKey === item.key ? activeResize.value.rowSpan : item.rowSpan;
}

function itemSlotScope(group: GroupedGridGroup, item: GroupedGridItem): GroupedGridItemSlotScope {
  const colSpan = displayColSpan(item);
  const rowSpan = displayRowSpan(item);
  return {
    row: item.row,
    itemRef: item.itemRef,
    group: { id: group.id, title: group.title, order: group.order },
    section: item.section,
    colSpan,
    rowSpan,
    selected: selectedKey.value === item.key,
    dragging: draggingItemKey.value === item.key,
    resizing: activeResize.value?.itemKey === item.key,
    operations: rowOperationsFor(item.row),
    runOperation: (opName, extra) => dispatchRowOperation(item.row, opName, extra),
  };
}

function groupSlotScope(group: GroupedGridGroup, index: number): GroupedGridGroupSlotScope {
  return {
    group: { id: group.id, title: group.title, order: group.order },
    index,
    itemCount: group.items.length,
    collapsed: isGroupCollapsed(group.id),
    toggleCollapse: () => toggleGroupCollapsed(group.id),
  };
}

const gridCssVars = computed(() => ({
  "--gg-columns": String(effectiveColumns.value),
  "--gg-row-height": `${effectiveRowHeight.value}px`,
  "--gg-gap": `${effectiveGap.value}px`,
}));
</script>

<template>
  <div class="sdk-grouped-grid" :style="gridCssVars">
    <p
      v-if="lastOpNotice"
      class="sdk-grouped-grid-op-outcome"
      :data-tone="lastOpNotice.tone"
      :role="lastOpNotice.tone === 'danger' ? 'alert' : 'status'"
    >
      <span>{{ lastOpNotice.message }}</span>
      <button type="button" class="sdk-grouped-grid-op-dismiss" aria-label="Dismiss" @click="lastOpNotice = null">×</button>
    </p>

    <div v-if="gridDataResult.status === 'empty' && $slots.empty" class="sdk-grouped-grid-custom-empty">
      <slot name="empty"></slot>
    </div>

    <DataState v-else :result="gridDataResult" :labels="dataStateLabels">
      <div class="sdk-grouped-grid-groups">
        <section
          v-for="(group, groupIndex) in groups"
          :key="group.id"
          class="sdk-grouped-grid-group"
          :data-group-id="group.id"
          :class="{
            'is-dragging': draggingGroupId === group.id,
            'is-drop-before': dropGroupTarget?.groupId === group.id && dropGroupTarget.position === 'before',
            'is-drop-after': dropGroupTarget?.groupId === group.id && dropGroupTarget.position === 'after',
            'is-item-drop-target': dropItemTarget?.groupId === group.id && !dropItemTarget.itemKey,
          }"
          @dragover="onGroupDragOver(group.id, $event)"
          @drop="onGroupDrop(group.id, $event)"
        >
          <header class="sdk-grouped-grid-group-header">
            <span
              v-if="editable"
              class="sdk-grouped-grid-group-handle"
              data-testid="grouped-grid-group-handle"
              draggable="true"
              aria-label="Drag to reorder group"
              @dragstart="onGroupDragStart(group.id, $event)"
              @dragend="clearDragState"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="4" r="1.2" />
                <circle cx="11" cy="4" r="1.2" />
                <circle cx="5" cy="8" r="1.2" />
                <circle cx="11" cy="8" r="1.2" />
                <circle cx="5" cy="12" r="1.2" />
                <circle cx="11" cy="12" r="1.2" />
              </svg>
            </span>

            <button
              v-if="collapsible"
              type="button"
              class="sdk-grouped-grid-collapse-btn"
              :aria-expanded="!isGroupCollapsed(group.id)"
              @click="toggleGroupCollapsed(group.id)"
            >
              <span class="sdk-grouped-grid-collapse-icon" :class="{ collapsed: isGroupCollapsed(group.id) }" aria-hidden="true">▾</span>
            </button>

            <h3 class="sdk-grouped-grid-group-title" :title="group.title">
              {{ group.title }}
            </h3>

            <div v-if="$slots['group-header-actions']" class="sdk-grouped-grid-group-actions">
              <slot name="group-header-actions" v-bind="groupSlotScope(group, groupIndex)"></slot>
            </div>
          </header>

          <div v-if="!isGroupCollapsed(group.id)" class="sdk-grouped-grid-group-body">
            <div v-if="group.items.length === 0" class="sdk-grouped-grid-group-empty">
              <slot name="group-empty" :group="{ id: group.id, title: group.title, order: group.order }">
                <span class="sdk-grouped-grid-group-empty-text">{{ emptyGroupText || t("platform.dataEmpty") }}</span>
              </slot>
            </div>

            <template v-else>
              <div
                v-for="section in group.sections"
                :key="section.key"
                class="sdk-grouped-grid-track"
                :data-section="section.key === '__default__' ? undefined : section.key"
              >
                <article
                  v-for="item in section.items"
                  :key="item.key"
                  :ref="(el) => setItemElement(item.key, el)"
                  class="sdk-grouped-grid-item"
                  :data-item-key="item.key"
                  :data-primary-key="item.primaryKey"
                  :class="{
                    'is-selected': selectedKey === item.key,
                    'is-highlighted': highlightedSet.has(item.primaryKey),
                    'is-dragging': draggingItemKey === item.key,
                    'is-resizing': activeResize?.itemKey === item.key,
                    'is-drop-before': dropItemTarget?.itemKey === item.key && dropItemTarget.position === 'before',
                    'is-drop-after': dropItemTarget?.itemKey === item.key && dropItemTarget.position === 'after',
                  }"
                  :style="{
                    gridColumn: `span ${displayColSpan(item)}`,
                    gridRow: `span ${displayRowSpan(item)}`,
                  }"
                  @click="selectItem(item)"
                  @dragover="onItemDragOver(group.id, item, $event)"
                  @drop="onItemDrop(group.id, item, $event)"
                >
                  <div class="sdk-grouped-grid-item-header">
                    <span
                      v-if="editable"
                      class="sdk-grouped-grid-item-handle"
                      data-testid="grouped-grid-item-handle"
                      draggable="true"
                      aria-label="Drag to reorder item"
                      @click.stop
                      @dragstart="onItemDragStart(item, $event)"
                      @dragend="clearDragState"
                    >
                      <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                        <circle cx="5" cy="4" r="1.2" />
                        <circle cx="11" cy="4" r="1.2" />
                        <circle cx="5" cy="8" r="1.2" />
                        <circle cx="11" cy="8" r="1.2" />
                        <circle cx="5" cy="12" r="1.2" />
                        <circle cx="11" cy="12" r="1.2" />
                      </svg>
                    </span>

                    <span class="sdk-grouped-grid-item-title" :title="item.row.label">
                      {{ item.row.label }}
                    </span>

                    <div class="sdk-grouped-grid-item-actions" @click.stop>
                      <slot
                        v-if="$slots['item-header-actions']"
                        name="item-header-actions"
                        v-bind="itemSlotScope(group, item)"
                      ></slot>
                      <ObjectListRowActions
                        v-if="resolvedRowActionsFor(item.row).length > 0"
                        :items="resolvedRowActionsFor(item.row)"
                        :max-visible="rowActions?.maxVisible ?? 0"
                        :busy="rowOpRunning"
                        :row-label="item.row.label || item.primaryKey"
                        @trigger="(action) => triggerRowAction(item, action)"
                      />
                    </div>
                  </div>

                  <div class="sdk-grouped-grid-item-body">
                    <slot name="item" v-bind="itemSlotScope(group, item)">
                      <span class="sdk-grouped-grid-item-fallback">{{ item.row.label }}</span>
                    </slot>
                  </div>

                  <span
                    v-if="activeResize?.itemKey === item.key"
                    class="sdk-grouped-grid-resize-badge"
                    aria-live="polite"
                  >
                    {{ displayColSpan(item) }} × {{ displayRowSpan(item) }}
                  </span>

                  <button
                    v-if="editable"
                    type="button"
                    class="sdk-grouped-grid-resize-handle"
                    data-testid="grouped-grid-resize-handle"
                    aria-label="Resize item"
                    @click.stop
                    @pointerdown="startItemResize(item, $event)"
                  ></button>
                </article>
              </div>
            </template>
          </div>
        </section>
      </div>
    </DataState>

    <OperationInputDialog
      v-if="pendingInputDialog"
      :model-value="true"
      :title="pendingInputDialog.descriptor.label || pendingInputDialog.operation"
      :fields="pendingInputDialog.fields"
      :busy="rowOpRunning"
      @update:model-value="(open) => { if (!open) pendingInputDialog = null; }"
      @confirm="submitPendingInputDialog"
    />
  </div>
</template>

<style scoped>
.sdk-grouped-grid {
  container: sdk-grouped-grid / inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md, 16px);
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.sdk-grouped-grid-groups {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg, 20px);
  width: 100%;
  min-width: 0;
}

.sdk-grouped-grid-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 12px);
  min-width: 0;
  border-radius: var(--radius-md, 8px);
  transition: box-shadow 0.15s ease, opacity 0.15s ease;
}

.sdk-grouped-grid-group.is-dragging {
  opacity: 0.55;
}

.sdk-grouped-grid-group.is-drop-before {
  box-shadow: 0 -2px 0 0 var(--el-color-primary);
}

.sdk-grouped-grid-group.is-drop-after {
  box-shadow: 0 2px 0 0 var(--el-color-primary);
}

.sdk-grouped-grid-group.is-item-drop-target {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: 4px;
}

.sdk-grouped-grid-group-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 6px);
  min-height: 32px;
  min-width: 0;
}

.sdk-grouped-grid-group-handle,
.sdk-grouped-grid-item-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  color: var(--el-text-color-placeholder);
  cursor: grab;
  border-radius: var(--radius-sm, 4px);
  padding: 2px;
}

.sdk-grouped-grid-group-handle:hover,
.sdk-grouped-grid-item-handle:hover {
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
}

.sdk-grouped-grid-group-handle:active,
.sdk-grouped-grid-item-handle:active {
  cursor: grabbing;
}

.sdk-grouped-grid-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.sdk-grouped-grid-collapse-btn:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.sdk-grouped-grid-collapse-icon {
  display: inline-block;
  transition: transform 0.15s ease;
}

.sdk-grouped-grid-collapse-icon.collapsed {
  transform: rotate(-90deg);
}

.sdk-grouped-grid-group-title {
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-md, 15px);
  font-weight: var(--font-semibold, 600);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-grouped-grid-group-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  flex: none;
}

.sdk-grouped-grid-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--gg-gap, 16px);
  min-width: 0;
}

.sdk-grouped-grid-group-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  padding: var(--spacing-lg, 20px);
  border: 1px dashed var(--ui-divider, var(--el-border-color));
  border-radius: var(--radius-md, 8px);
  background: var(--el-fill-color-blank);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}

.sdk-grouped-grid-track {
  display: grid;
  grid-template-columns: repeat(var(--gg-columns, 12), minmax(0, 1fr));
  grid-auto-rows: var(--gg-row-height, 160px);
  gap: var(--gg-gap, 16px);
  width: 100%;
  min-width: 0;
}

.sdk-grouped-grid-item {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  border-radius: var(--radius-md, 8px);
  background: var(--el-bg-color);
  overflow: hidden;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}

.sdk-grouped-grid-item:hover {
  border-color: var(--el-border-color-hover, var(--el-border-color));
}

.sdk-grouped-grid-item.is-selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.sdk-grouped-grid-item.is-highlighted:not(.is-selected) {
  border-color: var(--el-color-warning);
  box-shadow: 0 0 0 2px var(--el-color-warning-light-8);
}

.sdk-grouped-grid-item.is-dragging {
  opacity: 0.45;
}

.sdk-grouped-grid-item.is-resizing {
  z-index: 2;
  border-color: var(--el-color-primary);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  user-select: none;
}

.sdk-grouped-grid-item.is-drop-before {
  box-shadow: -3px 0 0 0 var(--el-color-primary);
}

.sdk-grouped-grid-item.is-drop-after {
  box-shadow: 3px 0 0 0 var(--el-color-primary);
}

.sdk-grouped-grid-item-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 6px);
  flex: none;
  padding: var(--spacing-xs, 8px) var(--spacing-sm, 12px);
  border-bottom: 1px solid var(--ui-divider, var(--el-border-color-extra-light));
  min-width: 0;
}

.sdk-grouped-grid-item-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-medium, 500);
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-grouped-grid-item-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
}

.sdk-grouped-grid-item-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sdk-grouped-grid-item-fallback {
  padding: var(--spacing-md, 12px);
  color: var(--el-text-color-secondary);
  font-size: var(--text-sm, 13px);
}

.sdk-grouped-grid-resize-badge {
  position: absolute;
  right: 20px;
  bottom: 8px;
  padding: 2px 6px;
  border-radius: var(--radius-sm, 4px);
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.sdk-grouped-grid-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: nwse-resize;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.sdk-grouped-grid-resize-handle::after {
  content: "";
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--el-text-color-placeholder);
  border-bottom: 2px solid var(--el-text-color-placeholder);
  border-radius: 0 0 2px 0;
}

.sdk-grouped-grid-item:hover .sdk-grouped-grid-resize-handle,
.sdk-grouped-grid-item.is-selected .sdk-grouped-grid-resize-handle,
.sdk-grouped-grid-item.is-resizing .sdk-grouped-grid-resize-handle,
.sdk-grouped-grid-resize-handle:focus-visible {
  opacity: 1;
}

@container sdk-grouped-grid (max-width: 640px) {
  .sdk-grouped-grid-track {
    grid-template-columns: minmax(0, 1fr);
  }
  .sdk-grouped-grid-item {
    grid-column: span 1 !important;
  }
}
</style>
