<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { PanelRowOperationAvailability, PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  directReadRowType,
  panelRowOperationKey,
} from "@ontomato/contracts/panel-projection";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { usePanelContext, useProjectionForm, useProjectionSlot } from "../panel/context";
import type { PanelFormAdapter, PanelFormHandle } from "../panel/forms";
import { useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam } from "../panel/member";
import { admittedOperations } from "../panel/member-operations";
import type { PlatformObjectRecord } from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { stateObject, type PanelFieldValue } from "../panel/state";
import { useCollectionData } from "./collection-data";
import { useDataStateLabels } from "./data-state-labels";
import {
  buildGroupedGridGroups,
  buildLayoutChangePayload,
  buildStaticGroupedGridState,
  clampGridSpan,
  findGroupedGridSectionConfig,
  moveGridItem,
  reorderGridGroups,
  resizeGridItem,
  resolveSectionColumns,
  resolveSectionMinColSpan,
  serializeStaticGridLayout,
  setStaticGridItemHidden,
} from "./grouped-grid-model";
import type {
  GroupedGridControlsVisibility,
  GroupedGridDividerStyle,
  GroupedGridGroup,
  GroupedGridGroupSlotScope,
  GroupedGridGroupSummary,
  GroupedGridGroupSurface,
  GroupedGridItem,
  GroupedGridItemDraftOverride,
  GroupedGridItemSlotScope,
  GroupedGridItemSurface,
  GroupedGridLayoutChange,
  GroupedGridLayoutState,
  GroupedGridResizeAxis,
  GroupedGridRowSizing,
  GroupedGridSectionConfig,
  GroupedGridStaticGroupConfig,
  GroupedGridStaticItemConfig,
} from "./grouped-grid-types";
import {
  allowedRowOperationInputKeys,
  filterAllowedRowOperationInput,
  matchesRowActionWhen,
  resolveRowActionAddress,
  resolveRowOperationParams,
  resolveRowOperationPrefill,
  resolveRowOperationTarget,
} from "./object-list-actions";
import type {
  ObjectListRef,
  ObjectListRowActionPrefill,
  ObjectListRowActions as ObjectListRowActionsConfig,
} from "./object-list-types";
import ObjectListRowActions, { type ResolvedRowActionItem } from "./ObjectListRowActions.vue";
import {
  formatOperationOutcome,
  resolveOperationInputFields,
} from "./operation-dispatch";
import { isActionValuesEnvelope, wrapActionOperationInput, type OperationInputField } from "./operation-input-schema";
import { displayFieldText, recordFieldDisplayValue } from "./record-field";
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
    /** Ordered per-section grid track descriptors (`key`, optional `columns`, `rowHeight`, `minColSpan`, `resizeAxis`) used when `sectionField` is set. */
    sections?: readonly GroupedGridSectionConfig[];
    /** Item record field holding the column span (default `"colSpan"`). */
    colSpanField?: string;
    /** Item record field holding the row span (default `"rowSpan"`). */
    rowSpanField?: string;
    /** Item record field holding the sort order within a group or section (default `"order"`). */
    orderField?: string;
    /** Minimum column span allowed when resizing (default `2`). */
    minColSpan?: number;
    /** Maximum column span allowed when resizing; omitted defaults to each section's column count. */
    maxColSpan?: number;
    /** Minimum row span allowed when resizing (default `1`). */
    minRowSpan?: number;
    /** Maximum row span allowed when resizing (default `6`). */
    maxRowSpan?: number;
    /** Enable drag-and-drop reordering and cell resize handles (default `true`). */
    editable?: boolean;
    /** Lock drag reordering and resizing while keeping read/view controls usable (default `false`). */
    locked?: boolean;
    /** Optional explanation shown on disabled edit/resize controls while `locked` is true. */
    lockReason?: string;
    /** Allow collapsing/expanding groups from the group header (default `true`). */
    collapsible?: boolean;
    /** Outer surface presentation for each group container (`"plain"` or `"card"`, default `"plain"`). */
    groupSurface?: GroupedGridGroupSurface;
    /** Outer surface presentation for each item container (`"card"` or `"section"`, default `"card"`). */
    itemSurface?: GroupedGridItemSurface;
    /** Row track height strategy (`"fixed"` uses `rowHeight * rowSpan`; `"auto"` adapts to item content height). */
    rowSizing?: GroupedGridRowSizing;
    /** Bottom divider style under item headers: `"line"` (default), `"none"`, or per-section overrides (`{ metric: "none", chart: "line" }`). */
    itemHeaderDivider?: GroupedGridDividerStyle | Readonly<Record<string, GroupedGridDividerStyle>>;
    /** When item header actions, drag grip, and resize handles are visible (`"hover"` or `"always"`, default `"hover"`). */
    controlsVisibility?: GroupedGridControlsVisibility;
    /** Static item definitions for fixed-member mode (when no `rows` datum is bound). */
    items?: readonly GroupedGridStaticItemConfig[];
    /** Static group definitions for fixed-member mode (when no `rows` datum is bound). */
    groups?: readonly GroupedGridStaticGroupConfig[];
    /** Whether to render group header chrome (default `true`). Set `false` for a seamless single-group canvas. */
    showGroupHeaders?: boolean;
    /** Whether to render item header chrome (default `true`). */
    showItemHeaders?: boolean;
    /** Whether hideable static items show a hide button in their item header (default `false`). */
    allowHide?: boolean;
    /** Optional per-item row actions (same shape as `ObjectList.rowActions`). */
    rowActions?: ObjectListRowActionsConfig;
    /** Panel message key (or plain text) shown when there are no groups and no items. */
    emptyText?: string;
    /** Panel message key (or plain text) shown inside an empty group when `#group-empty` is not provided. */
    emptyGroupText?: string;
    /** Localized fallback title rendered when a group's title is empty (never falls back to raw group ID). */
    emptyGroupTitle?: string;
    /** Optional list of item primary keys to mark with a highlight ring (for example draft-modified items). */
    highlightedIds?: readonly string[];
    /** Optional bound projection write operation name (for example `"saveLayout"`) that persists unsaved whole-grid drafts through the platform's unified form and leave-protection flow. */
    saveOperation?: string;
  }>(),
  {
    columns: 12,
    rowHeight: 160,
    gap: 16,
    groupKeyField: "groupId",
    groupTitleField: "groupTitle",
    groupsField: "groups",
    sectionField: undefined,
    sections: undefined,
    colSpanField: "colSpan",
    rowSpanField: "rowSpan",
    orderField: "order",
    minColSpan: 2,
    maxColSpan: undefined,
    minRowSpan: 1,
    maxRowSpan: 6,
    editable: true,
    locked: false,
    lockReason: undefined,
    collapsible: true,
    groupSurface: "plain",
    itemSurface: "card",
    rowSizing: "fixed",
    itemHeaderDivider: undefined,
    controlsVisibility: "hover",
    items: undefined,
    groups: undefined,
    showGroupHeaders: true,
    showItemHeaders: true,
    allowHide: false,
    rowActions: undefined,
    emptyText: undefined,
    emptyGroupText: undefined,
    emptyGroupTitle: undefined,
    highlightedIds: undefined,
    saveOperation: undefined,
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
  /** Optional compact badge or indicator rendered beside the item title (for example a truncation warning icon). */
  "item-title-suffix"?(props: GroupedGridItemSlotScope): unknown;
  /** Optional header controls rendered beside built-in row actions on each item card. */
  "item-header-actions"?(props: GroupedGridItemSlotScope): unknown;
  /** Optional controls rendered on the right side of each group header. */
  "group-header-actions"?(props: GroupedGridGroupSlotScope): unknown;
  /** Custom empty state rendered inside an empty group. */
  "group-empty"?(props: { group: GroupedGridGroupSummary }): unknown;
  /** Custom empty state rendered when there are no groups and no items. */
  empty?(): unknown;
}>();

const { t, locale } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const member = useMember();

const isRecordMode = "rows" in member.projection.data;
const objectType = isRecordMode ? projectionElement(slot.projection).id : "grid:item";
const rowsDatum = isRecordMode ? member.projection.data.rows : undefined;
const rowObjectType = isRecordMode && rowsDatum ? (directReadRowType(member.projection, rowsDatum) ?? objectType) : "grid:item";

const rowsCollection = isRecordMode ? useCollectionData("rows") : null;
const rowsState = rowsCollection ? rowsCollection.state : null;
const hasRecordDatum = isRecordMode && "record" in member.projection.data;
const recordState = hasRecordDatum ? useMemberData("record") : null;
const operationsState = useMemberOperations();
const selectedParam = isRecordMode ? useMemberParam("selected") : null;
const layoutParam = !isRecordMode ? useMemberParam("layout") : null;

const effectiveColumns = computed(() => Math.max(1, Math.min(24, Math.floor(props.columns || 12))));
function sectionColumnCount(sectionKey: string | null | undefined): number {
  return resolveSectionColumns(sectionKey, effectiveColumns.value, props.sections);
}
const effectiveRowHeight = computed(() => Math.max(48, Math.floor(props.rowHeight || 160)));
function sectionRowHeight(sectionKey: string | null | undefined): number {
  const override = findGroupedGridSectionConfig(sectionKey, props.sections)?.rowHeight;
  return typeof override === "number" && Number.isFinite(override) && override > 0
    ? Math.max(48, Math.floor(override))
    : effectiveRowHeight.value;
}
function sectionResizeAxis(sectionKey: string | null | undefined): GroupedGridResizeAxis {
  return findGroupedGridSectionConfig(sectionKey, props.sections)?.resizeAxis ?? "both";
}
function sectionHeaderDivider(sectionKey: string | null | undefined): GroupedGridDividerStyle {
  const divider = props.itemHeaderDivider;
  if (typeof divider === "string") return divider;
  if (divider && typeof divider === "object") {
    if (sectionKey && sectionKey !== "__default__" && divider[sectionKey]) return divider[sectionKey]!;
    return divider.default ?? "line";
  }
  return "line";
}
const effectiveGap = computed(() => Math.max(0, Math.floor(props.gap ?? 16)));
const effectiveMaxColSpan = computed(() => (
  props.maxColSpan !== undefined
    ? Math.max(1, Math.min(24, Math.floor(props.maxColSpan)))
    : effectiveColumns.value
));
const effectiveMinColSpan = computed(() => Math.max(1, Math.min(effectiveMaxColSpan.value, Math.floor(props.minColSpan || 1))));
const effectiveMinRowSpan = computed(() => Math.max(1, Math.floor(props.minRowSpan || 1)));
const effectiveMaxRowSpan = computed(() => Math.max(effectiveMinRowSpan.value, Math.min(24, Math.floor(props.maxRowSpan || 6))));
const resolvedEmptyGroupTitle = computed(() => {
  if (props.emptyGroupTitle?.trim()) return props.emptyGroupTitle.trim();
  const key = "dashboard.unnamedDimension";
  const translated = t(key);
  return translated && translated !== key ? translated : "Untitled group";
});

const containerRecord = computed<PlatformObjectRecord | null>(() => {
  if (!recordState) return null;
  const current = recordState.value;
  if (current.status !== "ready" || !current.value || typeof current.value !== "object" || Array.isArray(current.value)) {
    return null;
  }
  return current.value as unknown as PlatformObjectRecord;
});

const rawRows = computed<readonly PlatformObjectRecord[]>(() => {
  if (!rowsCollection) return [];
  return rowsCollection.state.value.status === "ready" ? rowsCollection.rows.value : [];
});

const rowOperationsMap = computed<PanelRowOperationsMap | undefined>(() => {
  if (!rowsCollection) return undefined;
  return rowsCollection.state.value.status === "ready" ? rowsCollection.rowOperations.value : undefined;
});

const isRowsTruncated = computed(() => rowsCollection?.coverage.value.truncated === true);
const coverageNotice = computed<string | null>(() => {
  const coverage = rowsCollection?.coverage.value;
  if (!coverage || !coverage.truncated) return null;
  const base = coverage.total !== null
    ? t("platform.collectionGridTruncatedWithTotal", { loaded: coverage.loaded, total: coverage.total })
    : t("platform.collectionGridTruncated", { loaded: coverage.loaded });
  const parts = [base];
  if (props.editable) parts.push(t("platform.collectionGridTruncatedLockHint"));
  if (coverage.diagnostics.length > 0) parts.push(coverage.diagnostics.join("; "));
  return parts.join(" · ");
});

function resolveStaticTitle(entry: { readonly id: string; readonly title?: string; readonly titleKey?: string }): string {
  if (entry.titleKey) {
    const translated = typeof panel.t === "function" ? panel.t(entry.titleKey) : "";
    if (translated && translated !== entry.titleKey) return translated;
    if (entry.title?.trim()) return entry.title.trim();
    return translated || entry.id;
  }
  return entry.title?.trim() || "";
}

const externalLayoutState = computed<GroupedGridLayoutState | null>(() => {
  if (isRecordMode || !layoutParam) return null;
  const raw = layoutParam.value.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!Array.isArray((raw as { groups?: unknown }).groups)) return null;
  return raw as unknown as GroupedGridLayoutState;
});

const sourceStaticState = computed(() => {
  if (isRecordMode) {
    return { visibleGroups: [] as GroupedGridGroup[], layoutState: { groups: [] } as GroupedGridLayoutState, hiddenCount: 0 };
  }
  return buildStaticGroupedGridState({
    items: props.items ?? [],
    groups: props.groups,
    layout: externalLayoutState.value,
    columns: effectiveColumns.value,
    minColSpan: effectiveMinColSpan.value,
    maxColSpan: effectiveMaxColSpan.value,
    minRowSpan: effectiveMinRowSpan.value,
    maxRowSpan: effectiveMaxRowSpan.value,
    resolveTitle: resolveStaticTitle,
  });
});

const sourceGroups = computed<GroupedGridGroup[]>(() => {
  if (!isRecordMode) return sourceStaticState.value.visibleGroups;
  return buildGroupedGridGroups({
    record: containerRecord.value,
    rows: rawRows.value,
    rowObjectType,
    columns: effectiveColumns.value,
    minColSpan: effectiveMinColSpan.value,
    maxColSpan: props.maxColSpan,
    minRowSpan: effectiveMinRowSpan.value,
    maxRowSpan: effectiveMaxRowSpan.value,
    groupsField: props.groupsField,
    groupKeyField: props.groupKeyField,
    groupTitleField: props.groupTitleField,
    sectionField: props.sectionField,
    sections: props.sections,
    colSpanField: props.colSpanField,
    rowSpanField: props.rowSpanField,
    orderField: props.orderField,
  });
});

/* ── Unsaved draft preview & edit lock (D-26) ─────────────────────────────────────────────── */

const internalDraftValues = shallowRef<Record<string, RuntimeJsonValue> | null>(null);
const internalDraftSaving = ref(false);
const lastOpNotice = shallowRef<{ tone: "info" | "success" | "danger"; message: string } | null>(null);

const hasInternalDraft = computed(() => internalDraftValues.value !== null && Object.keys(internalDraftValues.value).length > 0);
const isLocked = computed(() => props.locked || hasInternalDraft.value || isRowsTruncated.value);
const effectiveLockReason = computed(() => {
  if (props.lockReason) return props.lockReason;
  if (isRowsTruncated.value) {
    return t("platform.collectionGridTruncatedLockHint");
  }
  if (hasInternalDraft.value) {
    const key = "dashboard.previewLockedHint";
    const translated = t(key);
    return translated && translated !== key
      ? translated
      : "Save or discard the unsaved preview before making manual layout edits";
  }
  return "";
});
const canEdit = computed(() => props.editable && !isLocked.value);

const draftItemOverrides = computed<Readonly<Record<string, GroupedGridItemDraftOverride>>>(() => {
  const raw = internalDraftValues.value?.itemOverrides;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: Record<string, GroupedGridItemDraftOverride> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    map[id] = {
      ...(typeof obj.title === "string" ? { title: obj.title } : {}),
      ...(obj.fileOverride !== undefined ? { fileOverride: obj.fileOverride } : {}),
      ...(obj.fields && typeof obj.fields === "object" && !Array.isArray(obj.fields)
        ? { fields: obj.fields as Record<string, unknown> }
        : {}),
    };
  }
  return map;
});

const draftGroupRenames = computed<Readonly<Record<string, string>>>(() => {
  const raw = internalDraftValues.value?.groupRenames;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: Record<string, string> = {};
  for (const [id, title] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof title === "string") map[id] = title;
  }
  return map;
});

const draftItemRenames = computed<Readonly<Record<string, string>>>(() => {
  const raw = internalDraftValues.value?.itemRenames;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: Record<string, string> = {};
  for (const [id, title] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof title === "string") map[id] = title;
  }
  return map;
});

const draftChangedIds = computed<ReadonlySet<string>>(() => {
  const set = new Set<string>();
  for (const id of Object.keys(draftItemRenames.value)) set.add(id);
  for (const id of Object.keys(draftItemOverrides.value)) set.add(id);
  const rawIds = internalDraftValues.value?.highlightedIds;
  if (Array.isArray(rawIds)) {
    for (const entry of rawIds) {
      if (typeof entry === "string" && entry) set.add(entry);
    }
  }
  return set;
});

const effectiveDraftNotice = computed(() => {
  if (!hasInternalDraft.value) return "";
  const explicit = internalDraftValues.value?.summary ?? internalDraftValues.value?.notice;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const changedCount = draftChangedIds.value.size + Object.keys(draftGroupRenames.value).length;
  return changedCount > 0
    ? `${t("platform.unsavedChanges")} (${changedCount})`
    : t("platform.unsavedChanges");
});

function applyDraftToGroups(groups: readonly GroupedGridGroup[]): readonly GroupedGridGroup[] {
  if (!hasInternalDraft.value) return groups;
  const gRenames = draftGroupRenames.value;
  const iRenames = draftItemRenames.value;
  const overrides = draftItemOverrides.value;
  if (
    Object.keys(gRenames).length === 0
    && Object.keys(iRenames).length === 0
    && Object.keys(overrides).length === 0
  ) {
    return groups;
  }
  return groups.map((group) => {
    const nextGroupTitle = gRenames[group.id] ?? group.title;
    const mapItem = (item: GroupedGridItem): GroupedGridItem => {
      const renamed = iRenames[item.primaryKey] ?? iRenames[item.itemId] ?? overrides[item.primaryKey]?.title ?? overrides[item.itemId]?.title;
      return renamed !== undefined ? { ...item, title: renamed } : item;
    };
    return {
      ...group,
      title: nextGroupTitle,
      items: group.items.map(mapItem),
      sections: group.sections.map((section) => ({ ...section, items: section.items.map(mapItem) })),
    };
  });
}

function draftSaveTarget() {
  const target = containerRecord.value;
  if (target) {
    return {
      kind: "object" as const,
      objectType: target.className || objectType,
      primaryKey: target.primaryKey,
    };
  }
  const inputTarget = stateObject(member.inputs.value.target as PanelFieldValue);
  if (inputTarget) {
    return {
      kind: "object" as const,
      objectType: inputTarget.className || objectType,
      primaryKey: inputTarget.primaryKey,
    };
  }
  return null;
}

function draftOperationInput(draft: Readonly<Record<string, RuntimeJsonValue>>): Record<string, RuntimeJsonValue> {
  const input: Record<string, RuntimeJsonValue> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (key === "summary" || key === "notice" || key === "highlightedIds") continue;
    input[key] = value;
  }
  return input;
}

async function discardDraft(confirm = false): Promise<boolean> {
  if (!hasInternalDraft.value) return true;
  if (confirm && panel.confirmLeaveUnsaved) {
    const leave = await panel.confirmLeaveUnsaved();
    if (!leave) return false;
  }
  internalDraftValues.value = null;
  return true;
}

async function saveDraft(): Promise<unknown> {
  if (!props.saveOperation || !hasInternalDraft.value || internalDraftSaving.value) return undefined;
  const descriptor = admittedOperations(operationsState.value)[props.saveOperation];
  const binding = member.projection.operations?.[props.saveOperation];
  const target = draftSaveTarget();
  if (!descriptor || !binding || !target) {
    lastOpNotice.value = { tone: "danger", message: t("platform.operationUnavailable") };
    return undefined;
  }
  const input = draftOperationInput(internalDraftValues.value ?? {});
  const operationId = panel.instance.operationIdOf(slot.slot, props.saveOperation);
  internalDraftSaving.value = true;
  lastOpNotice.value = null;
  try {
    const answer = await panel.instance.writeOperation(operationId, { call: { target, input } });
    if (answer.decision === "cancel" || !answer.response) return answer;
    if (answer.response.kind === "not-dispatched") {
      lastOpNotice.value = { tone: "danger", message: answer.response.message };
      return answer;
    }
    const outcome = answer.response.outcome;
    if (outcome?.kind === "success") {
      internalDraftValues.value = null;
      panel.notify({ kind: "success", text: formatOperationOutcome(outcome, t) });
    } else if (outcome && outcome.kind !== "batch") {
      lastOpNotice.value = {
        tone: outcome.kind === "failure" || outcome.kind === "refusal" ? "danger" : "info",
        message: formatOperationOutcome(outcome, t),
      };
    }
    return answer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastOpNotice.value = { tone: "danger", message };
    return undefined;
  } finally {
    internalDraftSaving.value = false;
  }
}

if (props.saveOperation) {
  const draftIdentity = () => JSON.stringify([panel.instance.memberPathOf(slot.slot), member.inputs.value]);
  const draftInputStateKeys = () => {
    const declaration = panel.manifest.members[slot.slot];
    if (!declaration) return [] as string[];
    const keys = new Set<string>();
    if ("fromState" in declaration.target) keys.add(declaration.target.fromState);
    for (const input of Object.values(declaration.inputs ?? {})) {
      if ("state" in input) keys.add(input.state);
    }
    return [...keys];
  };
  const restored = panel.instance.forms.takeStashedDraft<Record<string, RuntimeJsonValue>>(slot.slot, draftIdentity());
  if (restored) {
    internalDraftValues.value = { ...restored };
  }
  const emptyFields = ref([] as const);
  const emptyErrors = ref<Readonly<Record<string, string>>>({});
  const formHandle: PanelFormHandle = {
    fields: emptyFields,
    values: computed(() => internalDraftValues.value ?? {}),
    errors: emptyErrors,
    changed: computed(() => new Set(Object.keys(internalDraftValues.value ?? {}))),
    busy: internalDraftSaving,
    dirty: hasInternalDraft,
    dirtyFields: computed(() => new Set(Object.keys(internalDraftValues.value ?? {}))),
    submitting: internalDraftSaving,
    canSubmit: computed(() => hasInternalDraft.value && !internalDraftSaving.value),
    set(path, value) {
      const key = path.replace(/^\/+/, "");
      internalDraftValues.value = { ...(internalDraftValues.value ?? {}), [key]: value };
    },
    async refreshDraft() {},
    async submit() {
      return saveDraft();
    },
    async reset(options) {
      return discardDraft(Boolean(options?.confirm));
    },
  };
  const adapter: PanelFormAdapter = {
    handle: formHandle,
    async fill(values, options) {
      if (hasInternalDraft.value && !options?.overwriteUnsaved) {
        return {
          ok: false,
          reason: "blocked_unsaved",
          message: "Grid already has unsaved preview edits",
        };
      }
      const next: Record<string, RuntimeJsonValue> = { ...(internalDraftValues.value ?? {}), ...values };
      internalDraftValues.value = next;
      return { ok: true, filledFields: Object.keys(values) };
    },
    async submit() {
      return saveDraft();
    },
    dirty: () => hasInternalDraft.value,
    discard: () => {
      internalDraftValues.value = null;
    },
    editingTarget: () => {
      const target = containerRecord.value;
      if (!target) return null;
      return {
        kind: "object",
        objectType: target.className || objectType,
        primaryKey: target.primaryKey,
      };
    },
    draft: {
      identity: draftIdentity,
      inputStateKeys: draftInputStateKeys,
      capture: () => (internalDraftValues.value ? { ...internalDraftValues.value } : null),
      restore: (draft) => {
        internalDraftValues.value = draft ? { ...(draft as Record<string, RuntimeJsonValue>) } : null;
      },
    },
    snapshot: () => {
      const target = containerRecord.value;
      if (!target && isRecordMode) return null;
      return {
        dirty: hasInternalDraft.value,
        values: internalDraftValues.value ?? {},
        dirtyFields: Object.keys(internalDraftValues.value ?? {}),
        ...(target
          ? {
            target: {
              kind: "object" as const,
              objectType: target.className || objectType,
              primaryKey: target.primaryKey,
            },
          }
          : {}),
      };
    },
  };
  useProjectionForm(adapter);
}

/** Local optimistic layout applied immediately after a user drag/resize/hide until fresh data or state arrives. */
const localGroups = shallowRef<GroupedGridGroup[] | null>(null);
const dragPreviewGroups = shallowRef<GroupedGridGroup[] | null>(null);
const localStaticLayout = shallowRef<GroupedGridLayoutState | null>(null);
watch([rawRows, containerRecord], () => {
  if (isRecordMode) localGroups.value = null;
});
watch([externalLayoutState, () => props.items, () => props.groups], () => {
  if (!isRecordMode) {
    localGroups.value = null;
    localStaticLayout.value = null;
  }
});

const renderedGroups = computed<readonly GroupedGridGroup[]>(() =>
  applyDraftToGroups(dragPreviewGroups.value ?? localGroups.value ?? sourceGroups.value),
);
const currentStaticLayout = computed<GroupedGridLayoutState>(() => localStaticLayout.value ?? sourceStaticState.value.layoutState);

const totalItems = computed(() => renderedGroups.value.reduce((sum, group) => sum + group.items.length, 0));
const hiddenCount = computed(() => {
  if (isRecordMode) return 0;
  return currentStaticLayout.value.groups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.hidden === true).length,
    0,
  );
});

const gridDataResult = computed<DataStateResult<readonly GroupedGridGroup[]>>(() => {
  if (!isRecordMode) {
    if (renderedGroups.value.length === 0 || (totalItems.value === 0 && (!props.showGroupHeaders || !props.groups?.length))) {
      return { status: "empty" };
    }
    return { status: "ready", value: renderedGroups.value };
  }
  const r = rowsState!.value;
  if (r.status === "loading" || r.status === "awaiting" || r.status === "forbidden" || r.status === "error") {
    return r;
  }
  if (recordState) {
    const rec = recordState.value;
    if (rec.status === "loading" || rec.status === "awaiting" || rec.status === "forbidden" || rec.status === "error") {
      return rec;
    }
  }
  if (renderedGroups.value.length === 0) {
    return { status: "empty" };
  }
  return { status: "ready", value: renderedGroups.value };
});

const dataStateLabels = useDataStateLabels(() => (props.emptyText ? panel.t(props.emptyText) : t("platform.dataEmpty")));

useMemberOutput("status", () => gridDataResult.value.status);
useMemberOutput("groupCount", () => (gridDataResult.value.status === "ready" ? renderedGroups.value.length : 0));
useMemberOutput("itemCount", () => (gridDataResult.value.status === "ready" ? totalItems.value : 0));
useMemberOutput("hiddenCount", () => hiddenCount.value);

/* ── Selection & highlight ────────────────────────────────────────────────────────────────── */

const selectedKey = computed<string | null>(() => {
  if (!selectedParam) return null;
  const obj = stateObject(selectedParam.value.value as PanelFieldValue);
  if (!obj) return null;
  return `${obj.className}:${obj.primaryKey}`;
});

const highlightedSet = computed(() => {
  const set = new Set(props.highlightedIds ?? []);
  for (const id of draftChangedIds.value) set.add(id);
  return set;
});

function isItemInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, a, input, textarea, select, [role='button'], [role='menuitem'], .sdk-grouped-grid-resize-handle, [data-no-drag]"));
}

function selectItem(item: GroupedGridItem, event?: Event) {
  if (event && isItemInteractiveTarget(event.target)) return;
  const finish = () => {
    emit("select", item.itemRef);
  };
  if (!selectedParam) {
    finish();
    return;
  }
  const applied = selectedParam.set({ className: item.itemRef.className, primaryKey: item.itemRef.primaryKey });
  if (applied === true) {
    finish();
  } else if (applied !== false) {
    void applied.then((ok) => {
      if (ok) finish();
    });
  }
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
        tone: item.tone ?? "default",
        disabled: false,
      });
      continue;
    }
    if (item.kind === "conversation") {
      if (!item.id) continue;
      const label = item.labelKey ? panel.t(item.labelKey) : item.label ?? t("platform.conversationEntryOpen");
      resolved.push({
        key: `conv:${item.id}:${i}`,
        kind: "conversation",
        id: item.id,
        target: item.target,
        conversationPrefill: item.prefill,
        prefillKey: item.prefillKey,
        submit: item.submit,
        newSession: item.newSession,
        label,
        icon: item.icon ?? "Sparkles",
        iconOnly: item.iconOnly,
        tone: item.tone ?? "default",
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
    const binding = member.projection.operations?.[item.operation];
    const opTarget = binding
      ? resolveRowOperationTarget(binding, row, rowObjectType, member.inputs.value)
      : { kind: "object" as const, objectType: row.className ?? rowObjectType, primaryKey: row.primaryKey };
    const opKey = descriptor?.handlerRef ?? panel.instance.operationIdOf(slot.slot, item.operation);
    const sharedBusy = descriptor?.effect !== "read"
      && opTarget?.kind === "object"
      && Boolean(panel.instance.isObjectWriteInFlight?.(opTarget, opKey));
    resolved.push({
      key: `op:${item.operation}:${i}`,
      kind: "operation",
      operation: item.operation,
      label,
      icon: item.icon,
      iconOnly: item.iconOnly,
      busy: sharedBusy,
      tone: item.tone ?? (descriptor?.inspectImpact ? "danger" : "default"),
      prefill: item.prefill,
      disabled: unavailable,
      reason,
    });
  }
  return resolved;
}

const rowOpRunning = ref(false);
const pendingInputDialog = shallowRef<{
  row: PlatformObjectRecord;
  operation: string;
  descriptor: PanelOwnerOperationDescriptor;
  fields: readonly OperationInputField[];
  boundInput: Record<string, RuntimeJsonValue>;
  extraInput: Record<string, RuntimeJsonValue>;
  initialValues?: Record<string, unknown>;
} | null>(null);

function configuredRowActionPrefill(operation: string): ObjectListRowActionPrefill | undefined {
  const items = props.rowActions?.items;
  if (!items) return undefined;
  for (const item of items) {
    if (item.kind === "operation" && item.operation === operation && item.prefill !== undefined) {
      return item.prefill;
    }
  }
  return undefined;
}

async function dispatchRowOperation(
  row: PlatformObjectRecord,
  operation: string,
  extraInput: Readonly<Record<string, RuntimeJsonValue>> = {},
  prefillOverride?: ObjectListRowActionPrefill,
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
    const effectivePrefill = prefillOverride !== undefined ? prefillOverride : configuredRowActionPrefill(operation);
    pendingInputDialog.value = {
      row,
      operation,
      descriptor,
      fields: missingFields,
      boundInput,
      extraInput: filteredExtra,
      initialValues: resolveRowOperationPrefill(row, missingFields, effectivePrefill),
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
  const operationKey = descriptor.handlerRef ?? operationId;
  if (
    descriptor.effect !== "read"
    && target?.kind === "object"
    && panel.instance.isObjectWriteInFlight?.(target, operationKey)
  ) {
    return;
  }
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
    const answer = await panel.instance.writeOperation(
      operationId,
      { call: { target, input } },
      { handlerRef: descriptor.handlerRef },
    );
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

function resolveConversationTarget(action: ResolvedRowActionItem): PanelConversationEntry["target"] {
  return action.target ?? slot.projection.conversationEntry?.target ?? { kind: "page-default" };
}

function resolveConversationPrefill(item: GroupedGridItem, action: ResolvedRowActionItem): string {
  const ref = item.itemRef;
  const refJson = JSON.stringify({ className: ref.className, primaryKey: ref.primaryKey });
  const rawTemplate = (() => {
    if (action.prefillKey !== undefined) {
      const translated = panel.t(action.prefillKey, {
        label: item.row.label,
        primaryKey: ref.primaryKey,
        className: ref.className,
        ref: refJson,
      });
      if (translated !== action.prefillKey) return translated;
    }
    if (action.conversationPrefill !== undefined) return action.conversationPrefill;
    const declared = slot.projection.conversationEntry;
    if (declared?.prefillKey !== undefined) {
      const keyed = panel.t(declared.prefillKey, {
        label: item.row.label,
        primaryKey: ref.primaryKey,
        className: ref.className,
        ref: refJson,
      });
      if (keyed !== declared.prefillKey) return keyed;
    }
    return declared?.prefill;
  })();
  const interpolated = rawTemplate !== undefined
    ? rawTemplate.replace(/\{([^{}]+)\}/g, (_match, rawKey: string) => {
        const key = rawKey.trim();
        if (key === "primaryKey") return ref.primaryKey;
        if (key === "className") return ref.className;
        if (key === "label") return item.row.label;
        if (key === "ref") return refJson;
        return displayFieldText(recordFieldDisplayValue(item.row, key), locale.value, t);
      })
    : "";
  if (!interpolated.trim()) {
    return `${item.row.label || ref.primaryKey} ${refJson}`;
  }
  if (!interpolated.includes(ref.primaryKey) || !interpolated.includes(ref.className)) {
    return `${interpolated}\n${refJson}`;
  }
  return interpolated;
}

async function runConversationRowAction(item: GroupedGridItem, action: ResolvedRowActionItem, event?: MouseEvent) {
  const target = resolveConversationTarget(action);
  const prefill = resolveConversationPrefill(item, action);
  const declared = slot.projection.conversationEntry;
  const submit = action.submit ?? declared?.submit;
  const newSession = action.newSession ?? declared?.newSession;
  lastOpNotice.value = null;
  try {
    await panel.expandPageComposer({
      slot: slot.slot,
      target,
      prefill,
      ...(submit !== undefined ? { submit } : {}),
      ...(newSession !== undefined ? { newSession } : {}),
    }, event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastOpNotice.value = { tone: "danger", message };
  }
}

function triggerRowAction(item: GroupedGridItem, action: ResolvedRowActionItem, event?: MouseEvent) {
  if (action.kind === "local" && action.id) {
    const address = action.to ? resolveRowActionAddress(action.to, item.row, rowObjectType) : null;
    if (address) {
      void panel.navigate(address);
      return;
    }
    emit("row-action", { id: action.id, ref: item.itemRef, index: item.rowIndex });
    return;
  }
  if (action.kind === "conversation") {
    void runConversationRowAction(item, action, event);
    return;
  }
  if (action.kind === "operation" && action.operation) {
    void dispatchRowOperation(item.row, action.operation, {}, action.prefill);
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
  dragPreviewGroups.value = null;
}

function commitLayoutChange(next: GroupedGridGroup[] | null) {
  if (!next) return;
  localGroups.value = next;
  if (!isRecordMode) {
    const nextLayout = serializeStaticGridLayout(next, currentStaticLayout.value, props.items ?? []);
    localStaticLayout.value = nextLayout;
    layoutParam?.set(nextLayout as unknown as RuntimeJsonValue);
  }
  emit("layout-change", buildLayoutChangePayload(next));
}

function hideStaticItem(item: GroupedGridItem) {
  if (isRecordMode || !canEdit.value) return;
  const nextLayout = setStaticGridItemHidden(currentStaticLayout.value, item.itemId, true);
  const built = buildStaticGroupedGridState({
    items: props.items ?? [],
    groups: props.groups,
    layout: nextLayout,
    columns: effectiveColumns.value,
    minColSpan: effectiveMinColSpan.value,
    maxColSpan: effectiveMaxColSpan.value,
    minRowSpan: effectiveMinRowSpan.value,
    maxRowSpan: effectiveMaxRowSpan.value,
    resolveTitle: resolveStaticTitle,
  });
  localGroups.value = built.visibleGroups;
  localStaticLayout.value = nextLayout;
  layoutParam?.set(nextLayout as unknown as RuntimeJsonValue);
  emit("layout-change", buildLayoutChangePayload(built.visibleGroups));
}

function onGroupDragStart(groupId: string, event: DragEvent) {
  if (!canEdit.value) {
    event.preventDefault();
    return;
  }
  draggingGroupId.value = groupId;
  draggingItemKey.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `group:${groupId}`);
  }
}

function onGroupDragOver(targetGroupId: string, event: DragEvent) {
  if (!canEdit.value) return;
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
  if (!canEdit.value) return;
  event.preventDefault();
  const baseGroups = localGroups.value ?? sourceGroups.value;
  if (draggingGroupId.value) {
    const position = dropGroupTarget.value?.groupId === targetGroupId ? dropGroupTarget.value.position : "before";
    const next = reorderGridGroups(baseGroups, draggingGroupId.value, targetGroupId, position);
    clearDragState();
    commitLayoutChange(next);
    return;
  }
  if (draggingItemKey.value) {
    const next = dragPreviewGroups.value
      ?? moveGridItem(baseGroups, draggingItemKey.value, targetGroupId, {
        sectionField: props.sectionField,
        sections: props.sections,
      });
    clearDragState();
    commitLayoutChange(next);
  }
}

function onItemDragStart(item: GroupedGridItem, event: DragEvent, fromCard = false) {
  if (!canEdit.value || activeResize.value) {
    event.preventDefault();
    return;
  }
  if (fromCard && isItemInteractiveTarget(event.target)) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  draggingItemKey.value = item.key;
  draggingGroupId.value = null;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `item:${item.key}`);
  }
}

function onItemDragOver(groupId: string, targetItem: GroupedGridItem, event: DragEvent) {
  if (!canEdit.value || !draggingItemKey.value || draggingItemKey.value === targetItem.key) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const el = event.currentTarget as HTMLElement | null;
  const rect = el?.getBoundingClientRect();
  const position: "before" | "after" = rect && event.clientX > rect.left + rect.width / 2 ? "after" : "before";
  const prev = dropItemTarget.value;
  if (prev?.groupId === groupId && prev.itemKey === targetItem.key && prev.position === position) return;
  dropItemTarget.value = { groupId, itemKey: targetItem.key, position };
  // Live smooth reorder preview while dragging (D-19).
  const preview = moveGridItem(dragPreviewGroups.value ?? localGroups.value ?? sourceGroups.value, draggingItemKey.value, groupId, {
    targetItemKey: targetItem.key,
    position,
    sectionField: props.sectionField,
    sections: props.sections,
  });
  if (preview) {
    dragPreviewGroups.value = preview;
  }
}

function onItemDrop(groupId: string, targetItem: GroupedGridItem, event: DragEvent) {
  if (!canEdit.value || !draggingItemKey.value) return;
  event.preventDefault();
  event.stopPropagation();
  const baseGroups = localGroups.value ?? sourceGroups.value;
  const position = dropItemTarget.value?.itemKey === targetItem.key ? dropItemTarget.value.position : "before";
  const next = dragPreviewGroups.value
    ?? moveGridItem(baseGroups, draggingItemKey.value, groupId, {
      targetItemKey: targetItem.key,
      position,
      sectionField: props.sectionField,
      sections: props.sections,
    });
  clearDragState();
  commitLayoutChange(next);
}

/* ── Pointer-driven cell resizing ─────────────────────────────────────────────────────────── */

interface ResizeSession {
  readonly itemKey: string;
  readonly axis: GroupedGridResizeAxis;
  readonly startX: number;
  readonly startY: number;
  readonly startColSpan: number;
  readonly startRowSpan: number;
  readonly minColSpan: number;
  readonly maxColSpan: number;
  readonly minRowSpan: number;
  readonly maxRowSpan: number;
  readonly colUnit: number;
  readonly rowUnit: number;
  colSpan: number;
  rowSpan: number;
}

const activeResize = ref<ResizeSession | null>(null);

function startItemResize(item: GroupedGridItem, event: PointerEvent) {
  const axis = sectionResizeAxis(item.section);
  if (!canEdit.value || axis === "none") return;
  event.preventDefault();
  event.stopPropagation();
  const cellEl = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>(".sdk-grouped-grid-item");
  const trackEl = cellEl?.parentElement;
  const trackWidth = trackEl?.getBoundingClientRect().width || 960;
  const cols = sectionColumnCount(item.section);
  const gap = effectiveGap.value;
  const colUnit = Math.max(24, (trackWidth - gap * (cols - 1)) / cols + gap);
  const rowUnit = Math.max(48, sectionRowHeight(item.section) + gap);

  const sectionMaxCols = props.maxColSpan !== undefined
    ? Math.max(1, Math.min(cols, Math.floor(props.maxColSpan)))
    : cols;
  const itemMaxCol = item.maxColSpan !== undefined
    ? Math.max(1, Math.min(cols, Math.floor(item.maxColSpan)))
    : sectionMaxCols;
  const itemMinCol = item.minColSpan !== undefined
    ? Math.max(1, Math.min(itemMaxCol, Math.floor(item.minColSpan)))
    : resolveSectionMinColSpan(item.section, effectiveMinColSpan.value, itemMaxCol, props.sections);
  const itemMaxRow = item.maxRowSpan !== undefined
    ? Math.max(1, Math.min(24, Math.floor(item.maxRowSpan)))
    : effectiveMaxRowSpan.value;
  const itemMinRow = item.minRowSpan !== undefined
    ? Math.max(1, Math.min(itemMaxRow, Math.floor(item.minRowSpan)))
    : Math.min(itemMaxRow, effectiveMinRowSpan.value);

  activeResize.value = {
    itemKey: item.key,
    axis,
    startX: event.clientX,
    startY: event.clientY,
    startColSpan: item.colSpan,
    startRowSpan: item.rowSpan,
    minColSpan: itemMinCol,
    maxColSpan: itemMaxCol,
    minRowSpan: itemMinRow,
    maxRowSpan: itemMaxRow,
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
  if (session.axis === "both" || session.axis === "horizontal") {
    const deltaCols = Math.round((event.clientX - session.startX) / session.colUnit);
    session.colSpan = clampGridSpan(
      session.startColSpan + deltaCols,
      session.minColSpan,
      session.maxColSpan,
      session.startColSpan,
    );
  }
  if (session.axis === "both" || session.axis === "vertical") {
    const deltaRows = Math.round((event.clientY - session.startY) / session.rowUnit);
    session.rowSpan = clampGridSpan(
      session.startRowSpan + deltaRows,
      session.minRowSpan,
      session.maxRowSpan,
      session.startRowSpan,
    );
  }
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
  const next = resizeGridItem(renderedGroups.value, session.itemKey, session.colSpan, session.rowSpan);
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
  const override = draftItemOverrides.value[item.primaryKey] ?? draftItemOverrides.value[item.itemId];
  return {
    itemId: item.itemId,
    title: item.title,
    row: item.row,
    itemRef: item.itemRef,
    group: { id: group.id, title: group.title, order: group.order },
    section: item.section,
    colSpan,
    rowSpan,
    selected: selectedKey.value === item.key,
    dragging: draggingItemKey.value === item.key,
    resizing: activeResize.value?.itemKey === item.key,
    locked: isLocked.value,
    modified: highlightedSet.value.has(item.primaryKey),
    ...(override ? { draftOverride: override } : {}),
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
    locked: isLocked.value,
    toggleCollapse: () => toggleGroupCollapsed(group.id),
  };
}

function displayGroupTitle(group: GroupedGridGroup): string {
  return group.title.trim() || resolvedEmptyGroupTitle.value;
}

const gridCssVars = computed(() => ({
  "--gg-columns": String(effectiveColumns.value),
  "--gg-row-height": `${effectiveRowHeight.value}px`,
  "--gg-gap": `${effectiveGap.value}px`,
}));
</script>

<template>
  <div
    class="sdk-grouped-grid"
    :class="[
      `is-group-surface-${groupSurface}`,
      `is-item-surface-${itemSurface}`,
      `is-row-sizing-${rowSizing}`,
      `is-controls-${controlsVisibility}`,
      { 'is-locked': isLocked },
    ]"
    :style="gridCssVars"
  >
    <div
      v-if="effectiveDraftNotice"
      class="sdk-grouped-grid-draft-bar"
      role="status"
      data-testid="grouped-grid-draft-bar"
    >
      <span class="sdk-grouped-grid-draft-text">{{ effectiveDraftNotice }}</span>
      <div class="sdk-grouped-grid-draft-actions">
        <button
          type="button"
          class="sdk-grouped-grid-draft-btn secondary"
          :disabled="internalDraftSaving"
          data-testid="grouped-grid-draft-discard"
          @click="void discardDraft(true)"
        >
          {{ t("platform.discard") }}
        </button>
        <button
          type="button"
          class="sdk-grouped-grid-draft-btn primary"
          :disabled="internalDraftSaving"
          data-testid="grouped-grid-draft-save"
          @click="void saveDraft()"
        >
          {{ t("platform.save") }}
        </button>
      </div>
    </div>

    <p
      v-if="lastOpNotice"
      class="sdk-grouped-grid-op-outcome"
      :data-tone="lastOpNotice.tone"
      :role="lastOpNotice.tone === 'danger' ? 'alert' : 'status'"
    >
      <span>{{ lastOpNotice.message }}</span>
      <button type="button" class="sdk-grouped-grid-op-dismiss" aria-label="Dismiss" @click="lastOpNotice = null">×</button>
    </p>

    <p
      v-if="coverageNotice"
      class="sdk-grouped-grid-coverage"
      role="status"
      data-grid-coverage="partial"
    >
      {{ coverageNotice }}
    </p>

    <div v-if="gridDataResult.status === 'empty' && $slots.empty" class="sdk-grouped-grid-custom-empty">
      <slot name="empty"></slot>
    </div>

    <DataState v-else :result="gridDataResult" :labels="dataStateLabels">
      <div class="sdk-grouped-grid-groups">
        <section
          v-for="(group, groupIndex) in renderedGroups"
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
          <header v-if="showGroupHeaders" class="sdk-grouped-grid-group-header">
            <span
              v-if="editable"
              class="sdk-grouped-grid-group-handle"
              :class="{ 'is-disabled': isLocked }"
              data-testid="grouped-grid-group-handle"
              :draggable="canEdit"
              :title="isLocked ? effectiveLockReason : undefined"
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

            <h3 class="sdk-grouped-grid-group-title" :title="displayGroupTitle(group)">
              {{ displayGroupTitle(group) }}
            </h3>

            <div v-if="$slots['group-header-actions']" class="sdk-grouped-grid-group-actions">
              <slot name="group-header-actions" v-bind="groupSlotScope(group, groupIndex)"></slot>
            </div>
          </header>

          <div v-if="!showGroupHeaders || !isGroupCollapsed(group.id)" class="sdk-grouped-grid-group-body">
            <div v-if="group.items.length === 0" class="sdk-grouped-grid-group-empty">
              <slot name="group-empty" :group="{ id: group.id, title: group.title, order: group.order }">
                <span class="sdk-grouped-grid-group-empty-text">{{ emptyGroupText ? panel.t(emptyGroupText) : t("platform.dataEmpty") }}</span>
              </slot>
            </div>

            <template v-else>
              <div
                v-for="section in group.sections"
                :key="section.key"
                class="sdk-grouped-grid-track"
                :style="{
                  '--gg-columns': String(sectionColumnCount(section.key)),
                  '--gg-row-height': `${sectionRowHeight(section.key)}px`,
                }"
                :data-section="section.key === '__default__' ? undefined : section.key"
                :data-columns="sectionColumnCount(section.key)"
              >
                <article
                  v-for="item in section.items"
                  :key="item.key"
                  :ref="(el) => setItemElement(item.key, el)"
                  class="sdk-grouped-grid-item"
                  tabindex="0"
                  role="group"
                  :aria-label="item.title"
                  :draggable="canEdit && isRecordMode"
                  :data-item-key="item.key"
                  :data-item-id="item.itemId"
                  :data-primary-key="item.primaryKey"
                  :data-header-divider="sectionHeaderDivider(item.section)"
                  :class="{
                    'is-selected': selectedKey === item.key,
                    'is-highlighted': highlightedSet.has(item.primaryKey),
                    'is-draft-modified': draftChangedIds.has(item.primaryKey) || Boolean(effectiveDraftNotice && highlightedSet.has(item.primaryKey)),
                    'is-dragging': draggingItemKey === item.key,
                    'is-resizing': activeResize?.itemKey === item.key,
                    'is-drop-before': dropItemTarget?.itemKey === item.key && dropItemTarget.position === 'before',
                    'is-drop-after': dropItemTarget?.itemKey === item.key && dropItemTarget.position === 'after',
                  }"
                  :style="{
                    gridColumn: `span ${displayColSpan(item)}`,
                    ...(rowSizing === 'fixed' ? { gridRow: `span ${displayRowSpan(item)}` } : {}),
                  }"
                  @click="selectItem(item, $event)"
                  @keydown.enter.self.prevent="selectItem(item)"
                  @dragstart="isRecordMode ? onItemDragStart(item, $event, true) : undefined"
                  @dragend="clearDragState"
                  @dragover="onItemDragOver(group.id, item, $event)"
                  @drop="onItemDrop(group.id, item, $event)"
                >
                  <div
                    v-if="showItemHeaders"
                    class="sdk-grouped-grid-item-header"
                    :class="`is-divider-${sectionHeaderDivider(item.section)}`"
                  >
                    <span
                      v-if="editable && !isRecordMode"
                      class="sdk-grouped-grid-item-handle"
                      :class="{ 'is-disabled': isLocked }"
                      data-testid="grouped-grid-item-handle"
                      :draggable="canEdit"
                      :title="isLocked ? effectiveLockReason : undefined"
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

                    <div class="sdk-grouped-grid-item-heading">
                      <span class="sdk-grouped-grid-item-title" :title="item.title">
                        {{ item.title }}
                      </span>
                      <slot
                        v-if="$slots['item-title-suffix']"
                        name="item-title-suffix"
                        v-bind="itemSlotScope(group, item)"
                      ></slot>
                    </div>

                    <div class="sdk-grouped-grid-item-actions" @click.stop>
                      <slot
                        v-if="$slots['item-header-actions']"
                        name="item-header-actions"
                        v-bind="itemSlotScope(group, item)"
                      ></slot>
                      <button
                        v-if="!isRecordMode && allowHide && item.hideable !== false"
                        type="button"
                        class="sdk-grouped-grid-hide-btn"
                        data-testid="grouped-grid-item-hide"
                        :disabled="isLocked"
                        aria-label="Hide item"
                        title="Hide item"
                        @click.stop="hideStaticItem(item)"
                      >
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M2 2l12 12" />
                          <path d="M6.5 6.6A2 2 0 0 0 9.4 9.5" />
                          <path d="M9.9 4.2A7.5 7.5 0 0 1 14 8c-.6 1-1.5 1.9-2.5 2.5" />
                          <path d="M6.1 11.8A7.5 7.5 0 0 1 2 8c.6-1 1.5-1.9 2.5-2.5" />
                        </svg>
                      </button>
                      <ObjectListRowActions
                        v-if="resolvedRowActionsFor(item.row).length > 0"
                        :items="resolvedRowActionsFor(item.row)"
                        :max-visible="rowActions?.maxVisible ?? 0"
                        :busy="rowOpRunning"
                        :row-label="item.title || item.primaryKey"
                        @trigger="(action, ev) => triggerRowAction(item, action, ev)"
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
                    {{ sectionResizeAxis(item.section) === 'horizontal' ? `${displayColSpan(item)} col` : `${displayColSpan(item)} × ${displayRowSpan(item)}` }}
                  </span>

                  <button
                    v-if="editable && sectionResizeAxis(item.section) !== 'none'"
                    type="button"
                    class="sdk-grouped-grid-resize-handle"
                    :class="[`is-axis-${sectionResizeAxis(item.section)}`, { 'is-disabled': isLocked }]"
                    data-testid="grouped-grid-resize-handle"
                    :disabled="isLocked"
                    :aria-disabled="isLocked ? 'true' : undefined"
                    :title="isLocked ? effectiveLockReason : 'Resize item'"
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
      :initial-values="pendingInputDialog.initialValues"
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

.sdk-grouped-grid-draft-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-sm, 12px);
  padding: 10px 14px;
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: var(--radius-md, 8px);
  background: var(--el-color-primary-light-9);
  color: var(--el-text-color-primary);
  font-size: var(--text-sm, 13px);
}

.sdk-grouped-grid-coverage {
  margin: 0 0 10px;
  padding: 8px 12px;
  border: 1px solid var(--el-color-warning-light-7, #f3d19e);
  border-radius: var(--radius-md, 8px);
  background: var(--el-color-warning-light-9, #fdf6ec);
  color: var(--el-color-warning-dark-2, #b88230);
  font-size: var(--text-xs, 12px);
  line-height: 1.4;
}

.sdk-grouped-grid-draft-text {
  flex: 1 1 200px;
  min-width: 0;
  line-height: 1.5;
}

.sdk-grouped-grid-draft-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs, 8px);
  flex: none;
}

.sdk-grouped-grid-draft-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 12px;
  border-radius: var(--radius-sm, 6px);
  font-size: var(--text-xs, 12px);
  font-weight: var(--font-medium, 500);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.sdk-grouped-grid-draft-btn.secondary {
  border: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
}

.sdk-grouped-grid-draft-btn.secondary:hover:not(:disabled) {
  border-color: var(--el-border-color-hover, var(--el-border-color-dark));
  background: var(--el-fill-color-light);
}

.sdk-grouped-grid-draft-btn.primary {
  border: 1px solid var(--el-color-primary);
  background: var(--el-color-primary);
  color: #fff;
}

.sdk-grouped-grid-draft-btn.primary:hover:not(:disabled) {
  background: var(--el-color-primary-light-3);
  border-color: var(--el-color-primary-light-3);
}

.sdk-grouped-grid-draft-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sdk-grouped-grid-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm, 12px);
  min-width: 0;
  border-radius: var(--radius-md, 8px);
  transition: box-shadow 0.15s ease, opacity 0.15s ease;
}

.sdk-grouped-grid.is-group-surface-card .sdk-grouped-grid-group {
  padding: var(--surface-padding, 16px);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md, 8px);
  background: var(--el-bg-color);
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
  gap: var(--spacing-xs, 8px);
  min-height: 36px;
  min-width: 0;
}

.sdk-grouped-grid-group-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 30px;
  height: 30px;
  color: var(--el-text-color-placeholder);
  cursor: grab;
  border-radius: var(--radius-md, 8px);
  transition: background-color 0.15s ease, color 0.15s ease;
}

.sdk-grouped-grid-group-handle:hover:not(.is-disabled) {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.sdk-grouped-grid-item-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--el-text-color-placeholder);
  cursor: grab;
  border-radius: var(--radius-sm, 4px);
  transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
}

.sdk-grouped-grid-item-handle:hover:not(.is-disabled) {
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
}

.sdk-grouped-grid-group-handle:active:not(.is-disabled),
.sdk-grouped-grid-item-handle:active:not(.is-disabled) {
  cursor: grabbing;
}

.sdk-grouped-grid-group-handle.is-disabled,
.sdk-grouped-grid-item-handle.is-disabled {
  cursor: not-allowed;
  opacity: 0.4;
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
  font-size: var(--text-lg, 16px);
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

.sdk-grouped-grid.is-row-sizing-auto .sdk-grouped-grid-track {
  grid-auto-rows: auto;
  align-items: start;
}

.sdk-grouped-grid-item {
  container: sdk-grouped-grid-item / inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--surface-padding, 16px);
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md, 8px);
  background: var(--el-bg-color);
  box-shadow: var(--shadow-card, none);
  overflow: hidden;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease, transform 0.15s ease;
}

.sdk-grouped-grid-item:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}

.sdk-grouped-grid.is-item-surface-section .sdk-grouped-grid-item {
  padding: var(--spacing-md, 16px) 0 0;
  border: 0;
  border-top: 1px solid var(--el-border-color-light);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.sdk-grouped-grid.is-row-sizing-auto .sdk-grouped-grid-item {
  overflow: visible;
}

.sdk-grouped-grid.is-item-surface-card .sdk-grouped-grid-item:hover {
  border-color: var(--el-border-color-dark, var(--el-border-color-hover, var(--el-border-color)));
}

.sdk-grouped-grid-item.is-selected {
  border-color: var(--el-color-primary);
  box-shadow: inset 0 0 0 2px var(--el-color-primary);
}

.sdk-grouped-grid-item.is-highlighted:not(.is-selected) {
  border-color: var(--el-color-warning);
  box-shadow: 0 0 0 2px var(--el-color-warning-light-8);
}

.sdk-grouped-grid-item.is-draft-modified:not(.is-selected) {
  border-style: dashed;
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
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
  gap: var(--spacing-xs, 8px);
  flex: none;
  padding: 0 0 10px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  min-width: 0;
}

.sdk-grouped-grid-item-header.is-divider-none {
  padding: 0;
  margin-bottom: 10px;
  border-bottom: 0;
}

.sdk-grouped-grid.is-item-surface-section .sdk-grouped-grid-item-header {
  padding: 0 0 10px;
  margin-bottom: 4px;
  border-bottom: 0;
}

.sdk-grouped-grid-item-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.sdk-grouped-grid-item-title {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
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
  transition: opacity 0.15s ease;
}

.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item-actions,
.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item-handle {
  opacity: 0;
  pointer-events: none;
}

.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item:hover .sdk-grouped-grid-item-actions,
.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item:focus-within .sdk-grouped-grid-item-actions,
.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item:has([aria-expanded="true"]) .sdk-grouped-grid-item-actions,
.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item:hover .sdk-grouped-grid-item-handle,
.sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item:focus-within .sdk-grouped-grid-item-handle {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item-actions,
  .sdk-grouped-grid.is-controls-hover .sdk-grouped-grid-item-handle {
    opacity: 1;
    pointer-events: auto;
  }
}

@container sdk-grouped-grid-item (max-width: 200px) {
  .sdk-grouped-grid-item-header {
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .sdk-grouped-grid-item-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

.sdk-grouped-grid-hide-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}

.sdk-grouped-grid-hide-btn:hover:not(:disabled) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.sdk-grouped-grid-hide-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sdk-grouped-grid-item-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sdk-grouped-grid.is-row-sizing-auto .sdk-grouped-grid-item-body {
  overflow: visible;
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
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.sdk-grouped-grid-resize-handle.is-axis-both {
  right: 2px;
  bottom: 2px;
  width: 14px;
  height: 14px;
  cursor: nwse-resize;
}

.sdk-grouped-grid-resize-handle.is-axis-both::after {
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

.sdk-grouped-grid-resize-handle.is-axis-horizontal {
  top: 12px;
  right: 0;
  bottom: 12px;
  width: 8px;
  cursor: ew-resize;
}

.sdk-grouped-grid-resize-handle.is-axis-horizontal::after {
  content: "";
  position: absolute;
  top: 50%;
  right: 2px;
  width: 3px;
  height: 24px;
  transform: translateY(-50%);
  border-radius: 2px;
  background: var(--el-border-color-dark, var(--el-text-color-placeholder));
}

.sdk-grouped-grid-resize-handle.is-axis-vertical {
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 8px;
  cursor: ns-resize;
}

.sdk-grouped-grid-resize-handle.is-axis-vertical::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: 2px;
  width: 24px;
  height: 3px;
  transform: translateX(-50%);
  border-radius: 2px;
  background: var(--el-border-color-dark, var(--el-text-color-placeholder));
}

.sdk-grouped-grid-resize-handle.is-disabled {
  cursor: not-allowed;
}

.sdk-grouped-grid-item:hover .sdk-grouped-grid-resize-handle,
.sdk-grouped-grid-item.is-selected .sdk-grouped-grid-resize-handle,
.sdk-grouped-grid-item.is-resizing .sdk-grouped-grid-resize-handle,
.sdk-grouped-grid-resize-handle:focus-visible {
  opacity: 1;
}

.sdk-grouped-grid-item:hover .sdk-grouped-grid-resize-handle.is-disabled {
  opacity: 0.35;
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
