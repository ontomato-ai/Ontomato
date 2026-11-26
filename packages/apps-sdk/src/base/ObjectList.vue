<script setup lang="ts">
import { Comment, Fragment, Text, computed, getCurrentInstance, nextTick, onBeforeUnmount, ref, shallowRef, useSlots, watch, type Slot, type VNode } from "vue";
import { useI18n } from "vue-i18n";
import { ElAlert } from "element-plus/es/components/alert/index";
import { ElButton } from "element-plus/es/components/button/index";
import { ElSkeleton } from "element-plus/es/components/skeleton/index";
import { ElTooltip } from "element-plus/es/components/tooltip/index";
import type { PageActionConfirmedDispatchResult } from "@ontomato/contracts/agent-presentation";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { randomId } from "@ontomato/contracts/random-id";
import type { PanelHumanOperationDispatchResponse } from "@ontomato/contracts/panel-agent";
import type { PanelConversationEntry } from "@ontomato/contracts/panel-conversation-entry";
import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import type { PanelChildObjectIdentity, PanelObjectIdentity } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor, PanelReadOperationResult } from "@ontomato/contracts/panel-operations";
import {
  authoredReadParameterSource,
  directReadDeclaration,
  directReadRowType,
  panelRecordItemKey,
  panelRecordObjectRef,
  panelRowOperationKey,
  type PanelFieldTone,
  type PanelRecordChildReferenceFieldValue,
  type PanelRecordFieldArrayItem,
  type PanelRecordFieldValue,
  type PanelRecordQuery,
  type PanelRecordReferenceFieldValue,
  type PanelRecordTagFieldValue,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyObjectsResponse } from "@ontomato/contracts/platform-ontology";
import { DataState, type DataStateResult } from "@ontomato/foundation-ui/data-state";
import { ElOption, ElSelect } from "element-plus/es/components/select/index";
import { confirmDanger } from "@ontomato/platform-shell";
import { appIcon, curatedIcon } from "@ontomato/platform-shell/icons";
import { formatListTime } from "@ontomato/workbench-ui/utils/relative-time";
import { slotOutputState, usePanelContext, useProjectionSlot } from "../panel/context";
import type { PanelFormAdapters } from "../panel/forms";
import { useLocalDraftStore } from "../panel/local-drafts";
import { paramValues, type MemberReadyData } from "../panel/direct";
import {
  classifyDispatchResponseForAction,
  classifyDispatchResponseForConfirmation,
  PanelConfirmationDeferred,
  PanelOperationDeferred,
  type PanelAgentActionContext,
  type PanelWriteResult,
} from "../panel/instance";
import {
  createDeferredConfirmation,
  matchesExpectedTarget,
  PanelSubmissionStaleError,
  type SubmissionEvaluator,
} from "../panel/operation-binding";
import { useMember, useMemberData, useMemberOperations, useMemberOutput, useMemberParam, useMemberRefresh } from "../panel/member";
import { admittedOperations, missingOperationDescriptorResult } from "../panel/member-operations";
import type {
  PlatformChildFieldReference,
  PlatformFieldReference,
  PlatformGraphStatus,
  PlatformObjectRecord,
  TextHighlightRange,
} from "../panel/platform-objects";
import { projectionElement } from "../panel/projection-element";
import { savePanelFile } from "../panel/save-file";
import type { ListRowSlotOperation } from "../panel/slot-context";
import {
  stateChildObject,
  stateObject,
  stateObjects,
  type PanelFieldValue,
  type PanelStateChangeSource,
  type PanelStateWriteResult,
} from "../panel/state";
import { resolveValueMapEntry, type ResolvedValueMapEntry } from "./display-value";
import { useContainerWidth } from "./container-width";
import ListRowSlotHost from "./ListRowSlotHost.vue";
import ObjectListBatchActions from "./ObjectListBatchActions.vue";
import ObjectListColumnToggle from "./ObjectListColumnToggle.vue";
import ObjectListRowActions, { type ResolvedRowActionItem } from "./ObjectListRowActions.vue";
import OperationBatchReceipt from "./OperationBatchReceipt.vue";
import OperationInputDialog from "./OperationInputDialog.vue";
import OperationResult from "./OperationResult.vue";
import RowDetailFormScope, { type RowDetailFormRegistration } from "./RowDetailFormScope";
import TypedValue from "./TypedValue.vue";
import {
  formatOperationOutcome,
  resolveOperationInputFields,
  type OperationBatchReceipt as BatchReceipt,
  type OperationOutcome,
  type SingleOperationOutcome,
  agentOperationSecretRefusal,
} from "./operation-dispatch";
import {
  isActionValuesEnvelope,
  hasAgentOperationSecretInput,
  wrapActionOperationInput,
  type OperationInputField,
} from "./operation-input-schema";
import {
  allowedRowOperationInputKeys,
  filterAllowedRowOperationInput,
  formatColumnLength,
  matchesRowActionWhen,
  resolveRowActionAddress,
  resolveRowOperationParams,
  resolveRowOperationPrefill,
  resolveRowOperationTarget,
} from "./object-list-actions";
import {
  computeRevealTabScrollLeft,
  computeTabScrollStep,
  resolveInlineRenameCommit,
  resolveInlineRenameFieldKey,
} from "./object-list-tabs";
import {
  buildCsvContent,
  collectDynamicFieldLabels,
  columnSchemaKey,
  deriveDynamicColumns,
  filterVisibleColumns,
  resolveCsvFileName,
  toggleColumnKeyVisibility,
} from "./object-list-dynamic";
import {
  buildObjectListGroups,
  findLocalHighlightRanges,
  isLocalFilterValueActive,
  matchesLocalFieldFilter,
  matchesLocalSearch,
  type ObjectListGroup,
} from "./object-list-local";
import {
  addExpandedRowKey,
  isInteractiveRowClickTarget,
  matchesRowExpandedKey,
  normalizeExpandedKeys,
  removeExpandedRowAliases,
} from "./object-list-expand";
import { filterResponsiveColumns } from "./object-list-responsive";
import type {
  ObjectListColumn,
  ObjectListRef,
  ObjectListRenameCancelPayload,
  ObjectListRenameCommitPayload,
  ObjectListRowActionCondition,
  ObjectListRowActionPrefill,
  ObjectListRowActions as ObjectListRowActionsConfig,
  ObjectListRowOperationState,
  ObjectListRowTone,
  ObjectListStateSnapshot,
  ObjectListTabsVariant,
} from "./object-list-types";
import {
  buildVirtualGridBands,
  computeScrollTopForIndex,
  computeVirtualWindow,
  VIRTUAL_OVERSCAN,
  VIRTUAL_ROW_THRESHOLD,
} from "./object-list-virtual";
import {
  childReferenceDisplayLabel,
  displayFieldText,
  isRecordChildReference,
  isRecordReference,
  isRecordTag,
  rawRecordField,
  recordFieldArrayItems,
  referenceDisplayLabel,
  scalarFieldText,
  toChildFieldReference,
  toFieldReference,
} from "./record-field";
import { textHighlightSegments } from "./text-highlight";
import { useDataStateLabels } from "./data-state-labels";
import StatusDot from "./StatusDot.vue";

type ObjectListSelection = ObjectListRef | PanelChildObjectIdentity;

type FlatListItem =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly groupKey: string;
      readonly label: string;
      readonly count: number;
      readonly collapsed: boolean;
    }
  | {
      readonly kind: "row";
      readonly key: string;
      readonly row: PlatformObjectRecord;
      readonly rowIndex: number;
    };

const RESERVED_MEMBER_INPUTS = new Set([
  "selected",
  "checked",
  "listed",
  "search",
  "value",
  "cursor",
  "size",
  "page",
  "layout",
  "columns",
  "statusField",
  "statusStyle",
  "tagsField",
  "subtitleField",
  "subtitleLines",
  "pageSize",
  "fallbackToFirst",
  "toggleable",
  "emptyText",
  "emptyHint",
  "noMatchText",
  "searchPlaceholder",
  "pagination",
  "pageSizes",
  "showChevron",
  "showHeader",
  "showFooter",
  "creatingRow",
  "searchable",
  "searchFields",
  "groupBy",
  "groupEmptyLabel",
  "localFilters",
  "rowActions",
  "leadingIconField",
  "leadingIconSize",
  "openOutput",
  "dynamicColumns",
  "showColumnToggle",
  "exportable",
  "exportFileName",
  "skeletonCount",
  "actionErrorPlacement",
  "border",
  "stripe",
  "showRowIndex",
  "pinPrimaryColumn",
  "rowActivation",
  "showPageJumper",
  "showRangeBar",
  "tabsVariant",
  "inlineRenameOperation",
  "inlineRenameField",
  "renamingKey",
  "expandedKeys",
  "rowExpandMode",
  "rowResultDisplay",
  "showDraftIndicator",
  "rowToneField",
  "checkDisabledWhen",
  "rowActionIconVariant",
  "metaField",
]);

interface ParsedListData {
  readonly rows: readonly PlatformObjectRecord[];
  readonly total: number | null;
  readonly hasTotal: boolean;
  readonly nextCursor?: string;
  /** What the owner says of a partial answer, in the reader's language, shown beside the rows. */
  readonly diagnostics: readonly string[];
  readonly status: PlatformGraphStatus;
  readonly reason?: string;
}

/**
 * Platform objects as a selectable list or multi-column table. Reads its member's `rows` (`panelRecordList` /
 * `panelRecordQuery`) or `objects` (`panelOntologyObjects`) datum through `useMemberData` and exchanges search,
 * pagination, single selection and checked items through `useMemberParam`. Search input, pagination controls and
 * multi-row checkboxes are inferred from the owner's read signature and the member's output bindings.
 */
const props = withDefaults(
  defineProps<{
    /**
     * How records are arranged: `"auto"` (default) draws a table when `columns` is given and a compact list otherwise;
     * `"list"` forces the compact list, `"table"` draws the table when `columns` is given, `"cards"` draws a
     * responsive card grid showing label, subtitle, status, tags and any configured `columns`, `"tabs"` draws a
     * single-row horizontal tab strip with overflow scroll buttons and compact per-tab row actions, and `"accordion"`
     * draws a collapsible disclosure list driven by `expandedKeys` / `rowExpandMode` and rendering `#row-detail` or
     * configured `columns` / record fields.
     * The compact list uses the object's `label` as its main title and has no `titleField` prop. To display a
     * different title field, use `"table"` with explicit `columns` or a row slot.
     */
    layout?: "auto" | "list" | "table" | "cards" | "tabs" | "accordion";
    /**
     * The table's columns, each a field of the owner's records (`key`, its header `labelKey`, and how it is drawn); absent,
     * the list is compact: each item shows its label, then `statusField`, `subtitleField` and `tagsField` as configured.
     */
    columns?: readonly ObjectListColumn[];
    /**
     * The field shown as a status tag at the end of each compact item. Its colour is the owner's tone for that field on the
     * record (`tones`): an owner that gives none has it shown as plain text, and the colour is the owner's to give.
     */
    statusField?: string;
    /**
     * How `statusField` is drawn on compact list items: `"tag"` (default) shows a tinted pill at the end of the title row,
     * `"dot"` shows a subtle status dot before the item title.
     */
    statusStyle?: "tag" | "dot";
    /** The key in the owner's record `tags` whose values are shown as small tags beneath each compact item. */
    tagsField?: string;
    /**
     * Field key whose value is each item's summary line in compact list mode, beneath its label (such as a description);
     * absent, the owner's own subtitle for the record is shown, if it gives one.
     */
    subtitleField?: string;
    /** Maximum number of visible lines in a compact summary. Omit it to show the whole summary. */
    subtitleLines?: number;
    /** How many items a page holds when the owner's read pages (a query's cursor, or page numbers); 20 by default. */
    pageSize?: number;
    /** On the initial load, select the first listed item if there is no current selection. */
    fallbackToFirst?: boolean;
    /** Whether clicking the selected item again clears the selection; off, a click always selects. */
    toggleable?: boolean;
    /** The panel's message key for what an empty list says, in place of the platform's own words. */
    emptyText?: string;
    /** Optional panel message key for a secondary hint shown beneath the empty message (e.g. pointing to header create). */
    emptyHint?: string;
    /** Optional panel message key for what a narrowed empty list (no search/filter match) says. */
    noMatchText?: string;
    /** Optional panel message key for the search input placeholder; defaults to `platform.listSearchPlaceholder`. */
    searchPlaceholder?: string;
    /**
     * Pagination control style for cursor-paged reads: `"auto"` (default) keeps numeric pages in `page` mode and Load
     * more in `cursor` mode; `"pages"` uses a cursor stack with Previous / Next page controls and page-size selector.
     */
    pagination?: "auto" | "pages" | "load-more";
    /** Selectable page sizes offered in the pagination footer when `pagination === "pages"` and the read accepts `size` or `page`. */
    pageSizes?: readonly number[];
    /** Whether selectable table or compact list rows render a subtle trailing chevron (`>`). */
    showChevron?: boolean;
    /** Whether table layout renders its `<thead>` column header row; defaults to `true`. */
    showHeader?: boolean;
    /** Whether the bottom total/pagination footer is rendered; defaults to `true`. */
    showFooter?: boolean;
    /** Controls visibility of the top `#create-row` inline form block; omitted, shown whenever `#create-row` has content. */
    creatingRow?: boolean;
    /**
     * Enables zero-request local search when the owner's read does not page (`pageMode === "none"`) and declares no
     * server `search` parameter. Omitted, local search is enabled automatically whenever the member binds `search`
     * input or output state; set to `false` to hide the list's built-in search input (for example when an outer toolbar
     * provides the search box) while still reading the bound `search` state.
     */
    searchable?: boolean;
    /**
     * Optional allowlist of record keys (`"label"`, `"primaryKey"`, `"subtitle"`, or field/tag keys) checked during
     * local search. Omitted, all record fields and tags are searched.
     */
    searchFields?: readonly string[];
    /**
     * Record field key used to group filtered rows under collapsible section headers showing each group's label and
     * real-time filtered count (groups with zero matching rows are omitted). Works across list, table, and card layouts.
     */
    groupBy?: string;
    /** Optional panel message key for the group heading of records whose `groupBy` field is missing or empty; defaults to `"—"`. */
    groupEmptyLabel?: string;
    /**
     * Optional field-equality filters applied locally on unpaged lists without issuing additional reads. Non-read panel
     * inputs bound on the member also filter locally by matching field key.
     */
    localFilters?: Readonly<Record<string, unknown>>;
    /**
     * Built-in per-row action column configuration. Mixes declared projection operations (`kind: "operation"`, rendered
     * only when admitted and consuming batch per-row availability) and local buttons (`kind: "local"`, for modals,
     * drawers or navigation), overflowing items beyond `maxVisible` (default 2) into a "More" dropdown menu.
     */
    rowActions?: ObjectListRowActionsConfig;
    /** Optional field key holding a platform icon name rendered before each card or compact list title. */
    leadingIconField?: string;
    /** Optional pixel size override for the leading icon; defaults to `16`. */
    leadingIconSize?: number;
    /** Optional owner-declared string output key on each record (`row.outputs[openOutput]`) opened via host navigation when clicking a row or card. */
    openOutput?: string;
    /**
     * Derive multi-column table definitions automatically from returned records (`fieldLabels` key order, then `fields`
     * key order, excluding array-valued fields) when no static `columns` are configured. Preserves the last derived
     * headers during an empty state within the same scope. Defaults to `false`.
     */
    dynamicColumns?: boolean;
    /**
     * Show a toolbar column-visibility popover (`Columns`) in table mode so readers can hide or show columns locally
     * without issuing reads or writes. Automatically resets when the underlying column set changes. Defaults to `false`.
     */
    showColumnToggle?: boolean;
    /**
     * Show a toolbar button (`Export current page (CSV)`) that downloads the currently loaded rows using the visible
     * columns and display headers as a UTF-8 BOM RFC 4180 CSV file. Disabled when no rows are loaded. Defaults to `false`.
     */
    exportable?: boolean;
    /** Optional base file name (`.csv` added if omitted) for current-page CSV export; defaults to `records-YYYY-MM-DD.csv`. */
    exportFileName?: string;
    /** Number of card skeleton placeholders shown during initial loading in `"cards"` layout; defaults to `6`. */
    skeletonCount?: number;
    /** Where row-action errors render: `"inline"` (default, below the list) or `"top"` (a dismissible error banner at the top of the list). */
    actionErrorPlacement?: "inline" | "top";
    /** Draw vertical cell borders in `"table"` layout. Defaults to `false`. */
    border?: boolean;
    /** Draw alternating zebra-striped rows in `"table"` layout. Defaults to `false`. */
    stripe?: boolean;
    /** Show a 1-based leading row index column (`50px` wide) in table layout, offset by current page; defaults to `false`. */
    showRowIndex?: boolean;
    /** Pin the first visible table column to the left (`position: sticky; left: 0`) and style its text as a primary clickable link when rows are activatable; defaults to `false`. */
    pinPrimaryColumn?: boolean;
    /**
     * How rows trigger activation: `"click"` (default) activates (`choose` / `openOutput`) on single click;
     * `"dblclick"` highlights the row on single click (preserving text selection) and activates on double-click or
     * primary-column link click; `"expand"` toggles inline `#row-detail` (or accordion) expansion on whole-row click
     * or `Enter`/`Space` with a trailing chevron indicator and dirty-form leave confirmation.
     */
    rowActivation?: "click" | "dblclick" | "expand";
    /** Show a "Go to page" jumper input in the pagination footer when in numeric `page` mode with known total pages; defaults to `true`. */
    showPageJumper?: boolean;
    /** Show a compact range summary bar (`Showing X–Y of Z`) above the list or table when rows are loaded; defaults to `false`. */
    showRangeBar?: boolean;
    /**
     * Visual presentation of the horizontal tab strip when `layout` is `"tabs"`: `"underline"` (default) shows bottom
     * indicator tabs; `"pill"` draws compact rounded pill tabs with neutral dark active fill and hover-revealed actions.
     */
    tabsVariant?: ObjectListTabsVariant;
    /**
     * Declared row operation name (for example `"rename"`) handled via in-place tab editing instead of opening the
     * operation input dialog when `layout` is `"tabs"`. Binding this operation enables in-place tab renaming.
     */
    inlineRenameOperation?: string;
    /**
     * Input parameter key passed to `inlineRenameOperation` on commit (for example `"name"`). When omitted, the sole
     * unbound editable text field from the operation schema is inferred automatically.
     */
    inlineRenameField?: string;
    /**
     * Optional controlled row key (`primaryKey` or composite `<className>:<primaryKey>`) currently showing an inline
     * rename input in `"tabs"` layout. Supports `v-model:renamingKey`.
     */
    renamingKey?: string | null;
    /** Optional controlled list of expanded row keys (primary keys or composite row identities). Supports `v-model:expandedKeys` and panel `expandedKeys` state bindings. */
    expandedKeys?: readonly string[];
    /** Row expansion mode: `"single"` (default) keeps at most one expanded row; `"multiple"` allows concurrent expanded rows. */
    rowExpandMode?: "single" | "multiple";
    /** How per-row operation results are displayed: `"none"` (default), `"inline"` (exposed to slots without auto-expand), or `"expand"` (auto-expand row and render result). */
    rowResultDisplay?: "none" | "inline" | "expand";
    /** Show a 6px warning dot beside rows whose object has an unsaved local draft in this browser. */
    showDraftIndicator?: boolean;
    /** Optional field key in `row.fields` used to apply semantic whole-row background tinting in table mode (tone comes from the value or `row.tones[rowToneField]`). */
    rowToneField?: string;
    /** Optional per-row condition(s) disabling row selection checkboxes and excluding matching rows from select-all. */
    checkDisabledWhen?: ObjectListRowActionCondition | readonly ObjectListRowActionCondition[];
    /** Visual variant for icon-only inline row action buttons: `"ghost"` (default) or `"bordered"` (`24x24` outlined square). */
    rowActionIconVariant?: "ghost" | "bordered";
    /** Optional field key rendered right-aligned on the second line beside the subtitle in compact `"list"` layout. */
    metaField?: string;
  }>(),
  {
    layout: "auto",
    columns: undefined,
    statusField: undefined,
    statusStyle: "tag",
    tagsField: undefined,
    pageSize: 20,
    fallbackToFirst: false,
    toggleable: false,
    emptyText: undefined,
    emptyHint: undefined,
    noMatchText: undefined,
    searchPlaceholder: undefined,
    pagination: "auto",
    pageSizes: () => [10, 20, 50],
    showChevron: false,
    showHeader: true,
    showFooter: true,
    creatingRow: undefined,
    searchable: undefined,
    searchFields: undefined,
    groupBy: undefined,
    groupEmptyLabel: undefined,
    localFilters: undefined,
    rowActions: undefined,
    leadingIconField: undefined,
    leadingIconSize: undefined,
    openOutput: undefined,
    dynamicColumns: false,
    showColumnToggle: false,
    exportable: false,
    exportFileName: undefined,
    skeletonCount: 6,
    actionErrorPlacement: "inline",
    border: false,
    stripe: false,
    showRowIndex: false,
    pinPrimaryColumn: false,
    rowActivation: "click",
    showPageJumper: true,
    showRangeBar: false,
    tabsVariant: "underline",
    inlineRenameOperation: undefined,
    inlineRenameField: undefined,
    renamingKey: undefined,
    expandedKeys: undefined,
    rowExpandMode: undefined,
    rowResultDisplay: undefined,
    showDraftIndicator: undefined,
    rowToneField: undefined,
    checkDisabledWhen: undefined,
    rowActionIconVariant: undefined,
    metaField: undefined,
  },
);

const emit = defineEmits<{
  /** Emitted when the single viewing selection changes (including automatic fallback). */
  "update:selected": [value: ObjectListSelection | null];
  /** Emitted only when the reader explicitly clicks or activates a row/card to select it. */
  choose: [value: ObjectListSelection | null];
  /** Emitted when the explicit multi-selection set changes. */
  "update:checked": [value: readonly ObjectListRef[]];
  /**
   * Emitted when the object references of the current result batch change: the current page when the owner's read
   * pages (`cursor` or `page`), or all matching rows when the read does not page; empty when no rows are shown.
   */
  "update:listed": [value: readonly ObjectListRef[]];
  /** Emitted when a reader clicks a reference cell carrying an owner-supplied object reference. */
  navigate: [reference: PlatformFieldReference, columnKey: string];
  /** Emitted when a reader clicks a parent-scoped child reference cell or inline child reference item. */
  "navigate-child": [reference: PlatformChildFieldReference, columnKey: string];
  /** Emitted when the reader clicks Clear filters from the narrowed empty state. */
  "clear-filters": [];
  /** Emitted when the reader clicks a local button (`kind: "local"`) in the built-in row action column. */
  "row-action": [payload: { id: string; ref: ObjectListRef; index: number }];
  /** Emitted after a declared row operation dispatches and the owner answers. */
  "operation-done": [operation: string, outcome: OperationOutcome, ref: ObjectListRef];
  /** Emitted when an inline tab rename commits a changed non-empty label. */
  "rename-commit": [payload: ObjectListRenameCommitPayload];
  /** Emitted when an inline tab rename is cancelled via Escape or closed unchanged. */
  "rename-cancel": [payload: ObjectListRenameCancelPayload];
  /** Emitted when the active inline-renaming tab key changes. */
  "update:renamingKey": [key: string | null];
  /** Emitted when the set of expanded row keys changes. */
  "update:expandedKeys": [keys: string[]];
}>();

type RowRefSlotScope = {
  readonly ref: ObjectListSelection;
  readonly index: number;
};

type ItemLeadingSlotScope = RowRefSlotScope & {
  readonly icon: string | null;
};

type RowActionsSlotScope = RowRefSlotScope & {
  readonly operations: Readonly<Record<string, ListRowSlotOperation>>;
  readonly operationResults: Readonly<Record<string, ObjectListRowOperationState>>;
  readonly runOperation: (operationName: string, extraInput?: Readonly<Record<string, RuntimeJsonValue>>) => Promise<void>;
  readonly clearOperationResult: (operationName?: string) => void;
};

type CellSlotScope = RowActionsSlotScope & {
  readonly column: ObjectListColumn;
  readonly value: unknown;
  readonly displayText: string;
  readonly tone: string;
};

defineSlots<{
  /** Auxiliary filter controls placed beside search in the top toolbar. */
  filters?(): unknown;
  /** Batch controls shown when one or more rows are checked. */
  "batch-actions"?(props: { checked: readonly ObjectListRef[]; clear: () => void }): unknown;
  /** Primary toolbar controls on the right side of the top toolbar. */
  "toolbar-actions"?(): unknown;
  /** Inline create block shown at the top of the list when `creatingRow` is active. */
  "create-row"?(): unknown;
  /** Custom empty state rendered when no rows match or the list is empty. */
  empty?(props: { narrowed: boolean; clearFilters: () => void }): unknown;
  /** Custom cell renderer for any column; receives only this cell's value, display text, tone, and row reference. */
  cell?(props: CellSlotScope): unknown;
  /** Custom cell renderer for a specific column key (`#cell-<columnKey>`). */
  [key: `cell-${string}`]: ((props: CellSlotScope) => unknown) | undefined;
  /** Custom row actions content; receives row reference and declared row operations. */
  actions?(props: RowActionsSlotScope): unknown;
  /** Expanded detail region rendered inline below a row; receives typed row reference to drive child projections. */
  "row-detail"?(
    props: RowRefSlotScope & {
      collapse: () => void;
      operationResults: Readonly<Record<string, ObjectListRowOperationState>>;
      clearOperationResult: (operationName?: string) => void;
    },
  ): unknown;
  /** Decorative leading badge, avatar, or icon rendered before each card or compact list item's title and subtitle. */
  "item-leading"?(props: ItemLeadingSlotScope): unknown;
  /** Trailing inline controls placed at the end of the horizontal tab bar in `"tabs"` layout (for example a create button). */
  "tabs-extra"?(): unknown;
  /** Status / scope summary strip rendered directly above the list or table. */
  status?(props: ObjectListStateSnapshot): unknown;
  /** Custom loading placeholder overriding the default skeleton or data-state loader. */
  loading?(): unknown;
  /** Custom card renderer in `"cards"` layout; falls back to the default card when empty. */
  card?(
    props: RowActionsSlotScope & {
      title: string;
      subtitle: string;
      description: string;
      icon: string | null;
      selected: boolean;
      checked: boolean;
      toggleCheck: (next?: boolean) => void;
      expanded: boolean;
      toggleExpand: () => void;
      rowActions: readonly ResolvedRowActionItem[];
      triggerAction: (item: ResolvedRowActionItem, event?: MouseEvent) => void;
    },
  ): unknown;
}>();

const slots = useSlots();
const batchReceipt = shallowRef<BatchReceipt | null>(null);
function publishBatchReceipt(receipt: BatchReceipt | null) {
  batchReceipt.value = receipt;
}

const { t, te, locale } = useI18n();
const slot = useProjectionSlot();
const panel = usePanelContext();
const member = useMember();
const objectType = projectionElement(slot.projection).id;

const datumName: "rows" | "objects" = "objects" in member.projection.data ? "objects" : "rows";
const datum = member.projection.data[datumName];
if (!datum) {
  throw new Error(`Projection ${member.projection.id} declares neither 'rows' nor 'objects' datum`);
}

const placement = panel.manifest.members[member.key]!;
const declaration = directReadDeclaration(member.projection, datum);
const rowObjectType = directReadRowType(member.projection, datum) ?? objectType;
const hasObjectRows = datumName === "objects" || declaration?.rowType !== undefined
  || ("type" in datum.source && (datum.source.type.kind === "ObjectType" || datum.source.type.kind === "PlatformObjectType"));
const signatureParams = declaration?.parameterMode === "fixed" ? declaration.params : {};
const requiredParamNames = new Set(declaration?.parameterMode === "fixed" ? (declaration.requiredParams ?? []) : []);

function isFixedLiteral(name: string): boolean {
  const mapped = datum!.params[name];
  if (mapped && "literal" in mapped) return true;
  const input = placement.inputs?.[paramNameOf(name)];
  return Boolean(input && "literal" in input);
}

function isWritableParam(name: string): boolean {
  if (isFixedLiteral(name)) return false;
  const key = paramNameOf(name);
  const input = placement.inputs?.[key];
  return !input || "state" in input;
}

function isAuthoredParam(name: string): boolean {
  return Boolean(authoredReadParameterSource(datum!.params, name, placement));
}

function paramNameOf(name: string): string {
  const mapped = datum!.params[name];
  return mapped && "input" in mapped ? mapped.input : name;
}

const rawConfig = computed<Readonly<Record<string, unknown>> | undefined>(() => {
  const cfg = member.projection.config;
  return cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : undefined;
});
const effectiveRowExpandMode = computed<"single" | "multiple">(() => {
  const raw = props.rowExpandMode ?? rawConfig.value?.rowExpandMode;
  return raw === "multiple" ? "multiple" : "single";
});
const effectiveRowResultDisplay = computed<"none" | "inline" | "expand">(() => {
  const raw = props.rowResultDisplay ?? rawConfig.value?.rowResultDisplay;
  return raw === "expand" || raw === "inline" ? raw : "none";
});
const effectiveShowDraftIndicator = computed<boolean>(() =>
  props.showDraftIndicator ?? Boolean(rawConfig.value?.showDraftIndicator),
);
const effectiveRowToneField = computed<string | undefined>(() => {
  const raw = props.rowToneField ?? rawConfig.value?.rowToneField;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
});
const effectiveCheckDisabledWhen = computed<
  ObjectListRowActionCondition | readonly ObjectListRowActionCondition[] | undefined
>(() => {
  const raw = props.checkDisabledWhen ?? rawConfig.value?.checkDisabledWhen;
  if (!raw || typeof raw !== "object") return undefined;
  if (Array.isArray(raw)) {
    return raw.length > 0 ? (raw as readonly ObjectListRowActionCondition[]) : undefined;
  }
  return raw as ObjectListRowActionCondition;
});
function isRowCheckDisabled(row: PlatformObjectRecord): boolean {
  return matchesRowActionWhen(row, effectiveCheckDisabledWhen.value, false);
}
const effectiveRowActionIconVariant = computed<"ghost" | "bordered">(() => {
  const raw = props.rowActionIconVariant ?? rawConfig.value?.rowActionIconVariant;
  return raw === "bordered" ? "bordered" : "ghost";
});
const effectiveMetaField = computed<string | undefined>(() => {
  const raw = props.metaField ?? rawConfig.value?.metaField;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
});
const headerHelpIcon = curatedIcon("circle-help");

const VALID_ROW_TONES = new Set<ObjectListRowTone>(["success", "danger", "warning", "info"]);
function resolveRowTone(row: PlatformObjectRecord): ObjectListRowTone | null {
  const field = effectiveRowToneField.value;
  if (!field) return null;
  const raw = rawRecordField(row, field);
  if (isRecordTag(raw) && raw.tone && VALID_ROW_TONES.has(raw.tone as ObjectListRowTone)) {
    return raw.tone as ObjectListRowTone;
  }
  const ownerTone = row.tones?.[field];
  if (ownerTone && VALID_ROW_TONES.has(ownerTone as ObjectListRowTone)) {
    return ownerTone as ObjectListRowTone;
  }
  if (typeof raw === "string" && VALID_ROW_TONES.has(raw as ObjectListRowTone)) {
    return raw as ObjectListRowTone;
  }
  return null;
}
function rowToneClass(row: PlatformObjectRecord): string | undefined {
  const tone = resolveRowTone(row);
  return tone ? `is-tone-${tone}` : undefined;
}

const localDraftStore = useLocalDraftStore();
const localDraftTick = ref(0);
if (localDraftStore) {
  onBeforeUnmount(localDraftStore.subscribe(() => {
    localDraftTick.value += 1;
  }));
}
function hasRowDraft(row: PlatformObjectRecord): boolean {
  if (!effectiveShowDraftIndicator.value) return false;
  void localDraftTick.value;
  const refObj = rowObjectRef(row);
  if (localDraftStore?.hasObject(refObj.className, refObj.primaryKey)) return true;
  return panel.hasLocalDraft(refObj);
}

const hasServerSearch = "search" in signatureParams && isWritableParam("search");
const pageMode: "cursor" | "page" | "none" = "cursor" in signatureParams
  ? "cursor"
  : "page" in signatureParams
    ? "page"
    : "none";
const hasWritableSearchInput = Boolean(
  placement.inputs?.search && "state" in placement.inputs.search,
);
const searchStateBound = Boolean(hasWritableSearchInput || placement.outputs?.search);
const isLocalSearchActive = computed(
  () => !hasServerSearch && pageMode === "none" && (props.searchable === true || searchStateBound),
);
const canSearch = computed(
  () =>
    props.searchable !== false
    && (hasServerSearch || (isLocalSearchActive.value && isWritableParam("search"))),
);
const canCheck = Boolean(slotOutputState(panel.manifest, member.key, "checked"));
const selectedStateName = slotOutputState(panel.manifest, member.key, "selected")
  ?? (placement.inputs?.selected && "state" in placement.inputs.selected ? placement.inputs.selected.state : undefined);
const selectedStateType = selectedStateName ? panel.manifest.state[selectedStateName]?.type : undefined;
const isChildObjectSelection = selectedStateType?.kind === "child-object";
const canSelect = Boolean(slotOutputState(panel.manifest, member.key, "selected"));
const hasWritableSelectedInput = Boolean(
  placement.inputs?.selected && "state" in placement.inputs.selected,
);
// Only a state-backed selection binding (outputs.selected or state inputs.selected) is writable on row click;
// a fixed literal inputs.selected provides read-only highlight without making rows interactive or calling .set().
const hasSelectedBinding = Boolean(canSelect || hasWritableSelectedInput);
const hasSelectedSource = Boolean(hasSelectedBinding || placement.inputs?.selected);
const vnodeProps = getCurrentInstance()?.vnode.props as Record<string, unknown> | null | undefined;
const hasChooseListener = Boolean(
  vnodeProps && (typeof vnodeProps.onChoose === "function" || Array.isArray(vnodeProps.onChoose)),
);
const hasUpdateSelectedListener = Boolean(
  vnodeProps && (typeof vnodeProps["onUpdate:selected"] === "function" || Array.isArray(vnodeProps["onUpdate:selected"])),
);
const rowSelectable = hasSelectedBinding || hasChooseListener || hasUpdateSelectedListener;
const rowActivatable = computed(() => rowSelectable || Boolean(props.openOutput));
const cardHeaderActions = computed(() => isCards.value && props.rowActions?.placement === "header");
const usesCursorPages = computed(() => pageMode === "cursor" && props.pagination === "pages");
const activePageSize = ref(props.pageSize > 0 ? props.pageSize : 20);
watch(() => props.pageSize, (next) => {
  if (next > 0) activePageSize.value = next;
});
const effectivePageSize = computed(() => activePageSize.value);
const cursorStack = ref<readonly (string | null)[]>([null]);

const searchParam = isWritableParam("search") ? useMemberParam(paramNameOf("search")) : null;
const cursorParam = pageMode === "cursor" ? useMemberParam(paramNameOf("cursor")) : null;
const sizeParam = (pageMode === "cursor" || pageMode === "page") && "size" in signatureParams
  ? useMemberParam(paramNameOf("size"))
  : null;
const pageParam = pageMode === "page" ? useMemberParam(paramNameOf("page")) : null;
const selectedParam = useMemberParam("selected");
const checkedParam = useMemberParam("checked");
const canOutputExpandedKeys = Boolean(slotOutputState(panel.manifest, member.key, "expandedKeys"));
const hasWritableExpandedKeysInput = Boolean(
  placement.inputs?.expandedKeys && "state" in placement.inputs.expandedKeys,
);
const hasExpandedKeysSource = Boolean(canOutputExpandedKeys || placement.inputs?.expandedKeys);
const expandedKeysParam = useMemberParam("expandedKeys");

const datumMappedInputNames = new Set([
  ...("object" in datum.source && "input" in datum.source.object ? [datum.source.object.input] : []),
  ...Object.values(datum.params).flatMap((mapped) => ("input" in mapped ? [mapped.input] : [])),
  ...Object.values(member.projection.operations ?? {}).flatMap((op) => [
    ...(op.target && "input" in op.target ? [op.target.input] : []),
    ...Object.values(op.params ?? {}).flatMap((param) => ("input" in param ? [param.input] : [])),
  ]),
]);
const localFilterParamEntries = pageMode === "none"
  ? Object.keys(placement.inputs ?? {})
      .filter((key) =>
        !(key in signatureParams)
        && !(key in datum.params)
        && !datumMappedInputNames.has(key)
        && !RESERVED_MEMBER_INPUTS.has(key),
      )
      .map((key) => ({
        key,
        param: useMemberParam(key),
        writable: isWritableParam(key),
      }))
  : [];
const localFiltersInputParam = pageMode === "none" && placement.inputs?.localFilters && isWritableParam("localFilters")
  ? useMemberParam("localFilters")
  : null;

const currentPage = ref(1);
interface CursorBatch {
  readonly cursor: string | null;
  readonly rows: readonly PlatformObjectRecord[];
  readonly rowOperations?: PanelRowOperationsMap;
}
const cursorBatches = ref<readonly CursorBatch[]>([]);
const loadingMore = ref(false);
let pendingAppendCursor: string | null = null;
const lastKnownTotal = ref<number | null>(null);
const lastKnownHasTotal = ref(false);

// Seed runtime pagination parameters before useMemberData starts its immediate watch, avoiding a double initial read.
if (pageMode === "cursor" && sizeParam && !isAuthoredParam("size")) {
  sizeParam.set(effectivePageSize.value);
}
if (pageMode === "page" && pageParam && !isAuthoredParam("page")) {
  pageParam.set({ number: 1, size: effectivePageSize.value });
}
if (pageMode === "page" && sizeParam && !isAuthoredParam("size")) {
  sizeParam.set(effectivePageSize.value);
}

function resetPaging() {
  if (currentPage.value !== 1) currentPage.value = 1;
  cursorBatches.value = [];
  cursorStack.value = [null];
  loadingMore.value = false;
  pendingAppendCursor = null;
  if (pageMode === "cursor" && cursorParam && !isAuthoredParam("cursor") && cursorParam.value.value !== null) {
    cursorParam.set(null);
  }
  if (pageMode === "page" && pageParam && !isAuthoredParam("page")) {
    const current = pageParam.value.value as { number?: number; size?: number } | null;
    if (!current || current.number !== 1 || current.size !== effectivePageSize.value) {
      pageParam.set({ number: 1, size: effectivePageSize.value });
    }
  }
}

function defaultFilterParamValue(name: string): unknown {
  const key = paramNameOf(name);
  const input = placement.inputs?.[key];
  if (input && "state" in input) {
    return panel.manifest.state[input.state]?.default;
  }
  return undefined;
}

const pagingParams = new Set(["cursor", "size", "page"]);
const nonPagingParamNames = [...new Set([...Object.keys(datum.params), ...Object.keys(signatureParams)])]
  .filter((name) => !pagingParams.has(name));
const clearableFilterParams = nonPagingParamNames
  .filter((name) => name !== "search" && !requiredParamNames.has(name) && isWritableParam(name))
  .map((name) => ({ name, param: useMemberParam(paramNameOf(name)) }));

const currentParams = computed(() =>
  paramValues(member.projection, datum, placement, member.inputs.value, panel.instance.ownParams(member.key)),
);
const hasRowDetailSlot = computed(() => Boolean(slots["row-detail"]));
const hasActionsSlot = computed(() => Boolean(slots.actions));
const hasActionColumn = computed(() => {
  if (hasActionsSlot.value) return true;
  if (!props.rowActions || props.rowActions.items.length === 0) return false;
  if (rows.value.length > 0 && rows.value.every((row) => resolvedRowActionsFor(row).length === 0)) {
    return false;
  }
  return true;
});
function columnCellSlot(columnKey: string): Slot | null {
  return (slots[`cell-${columnKey}`] ?? slots.cell ?? null) as Slot | null;
}
function columnStyle(column: ObjectListColumn): Record<string, string | undefined> {
  return {
    width: formatColumnLength(column.width),
    minWidth: formatColumnLength(column.minWidth),
    textAlign: column.align,
  };
}
const actionColumnHeader = computed(() => {
  if (props.rowActions?.labelKey) return panel.t(props.rowActions.labelKey);
  if (props.rowActions?.label) return props.rowActions.label;
  return t("platform.listActions");
});
const actionColumnStyle = computed<Record<string, string | undefined>>(() => ({
  width: formatColumnLength(props.rowActions?.width),
  minWidth: formatColumnLength(props.rowActions?.minWidth),
  textAlign: props.rowActions?.align ?? "right",
}));
const showRowChevron = computed(
  () => Boolean(props.showChevron) && isTable.value && !hasRowDetailSlot.value && !hasActionColumn.value,
);
const showListChevron = computed(
  () => Boolean(props.showChevron) && !isTable.value && !isCards.value && !hasActionColumn.value,
);
const isRowExpandActivation = computed(
  () => props.rowActivation === "expand" && (hasRowDetailSlot.value || isAccordion.value),
);
const showLeadingExpandColumn = computed(
  () => hasRowDetailSlot.value && props.rowActivation !== "expand",
);
const showTrailingExpandColumn = computed(
  () => isTable.value && hasRowDetailSlot.value && props.rowActivation === "expand",
);
const showRowIndexColumn = computed(() => Boolean(props.showRowIndex) && isTable.value);
const tableColumnCount = computed(
  () =>
    (showLeadingExpandColumn.value ? 1 : 0)
    + (canCheck ? 1 : 0)
    + (showRowIndexColumn.value ? 1 : 0)
    + visibleColumns.value.length
    + (hasActionColumn.value ? 1 : 0)
    + (showRowChevron.value ? 1 : 0)
    + (showTrailingExpandColumn.value ? 1 : 0),
);
const listRootRef = ref<HTMLElement | null>(null);
const scrollContainerRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const containerWidth = ref(0);
const { width: rootContainerWidth } = useContainerWidth(listRootRef, "--bp-object-list", 0);
watch(
  rootContainerWidth,
  (next) => {
    if (Number.isFinite(next) && next > 0) {
      containerWidth.value = next;
    }
  },
  { immediate: true },
);
const measuredHeights = new Map<string, number>();
const measuredDetailHeights = new Map<string, number>();
const measureTick = ref(0);

function readObservedContainerWidth(el: HTMLElement, entry?: ResizeObserverEntry): number {
  const entryWidth = entry?.contentRect?.width;
  if (typeof entryWidth === "number" && Number.isFinite(entryWidth) && entryWidth > 0) {
    return entryWidth;
  }
  const rectWidth = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect().width : 0;
  if (Number.isFinite(rectWidth) && rectWidth > 0) return rectWidth;
  return el.clientWidth;
}

function recordMeasuredHeight(map: Map<string, number>, key: string, height: number) {
  if (height <= 0) return;
  const previous = map.get(key);
  if (previous !== undefined && Math.abs(previous - height) <= 1) return;
  map.set(key, height);
  measureTick.value += 1;
}

function onContainerScroll(event: Event) {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  scrollTop.value = el.scrollTop;
  if (el.clientHeight !== viewportHeight.value) viewportHeight.value = el.clientHeight;
  const measuredWidth = readObservedContainerWidth(el);
  if (measuredWidth > 0 && measuredWidth !== containerWidth.value) {
    containerWidth.value = measuredWidth;
  }
}

let containerResizeObserver: ResizeObserver | null = null;
let componentUnmounted = false;
watch(
  scrollContainerRef,
  (el) => {
    containerResizeObserver?.disconnect();
    containerResizeObserver = null;
    if (!el) return;
    viewportHeight.value = el.clientHeight;
    const initialWidth = readObservedContainerWidth(el);
    if (initialWidth > 0) containerWidth.value = initialWidth;
    if (typeof ResizeObserver !== "undefined") {
      containerResizeObserver = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        const nextHeight = entry?.contentRect?.height;
        viewportHeight.value = typeof nextHeight === "number" && nextHeight > 0 ? nextHeight : el.clientHeight;
        const nextWidth = readObservedContainerWidth(el, entry);
        if (nextWidth > 0) containerWidth.value = nextWidth;
      });
      containerResizeObserver.observe(el);
    }
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  componentUnmounted = true;
  containerResizeObserver?.disconnect();
  containerResizeObserver = null;
});

const isPropControlledExpandedKeys = computed(() => props.expandedKeys !== undefined);
const hasControlledExpandedKeys = computed(() => isPropControlledExpandedKeys.value || hasExpandedKeysSource);
const internalExpandedKeys = ref<readonly string[]>([]);
const expandedKeyList = computed<readonly string[]>(() => {
  const mode = effectiveRowExpandMode.value;
  if (props.expandedKeys !== undefined) {
    return normalizeExpandedKeys(props.expandedKeys, mode);
  }
  if (hasExpandedKeysSource) {
    return normalizeExpandedKeys(expandedKeysParam.value.value, mode);
  }
  return normalizeExpandedKeys(internalExpandedKeys.value, mode);
});
const expandedKeySet = computed<ReadonlySet<string>>(() => new Set(expandedKeyList.value));
const detailElements = new Map<string, HTMLElement>();
const rowDetailFormsByRowKey = new Map<string, Set<RowDetailFormRegistration>>();
let expandGuardPending = false;

function registerRowDetailForm(rowKey: string, entry: RowDetailFormRegistration): () => void {
  let set = rowDetailFormsByRowKey.get(rowKey);
  if (!set) {
    set = new Set();
    rowDetailFormsByRowKey.set(rowKey, set);
  }
  set.add(entry);
  return () => {
    const current = rowDetailFormsByRowKey.get(rowKey);
    if (!current) return;
    current.delete(entry);
    if (current.size === 0) rowDetailFormsByRowKey.delete(rowKey);
  };
}

function collectScopedRowDetailForms(rowKeys: readonly string[]): Map<PanelFormAdapters, string[]> {
  const byRegistry = new Map<PanelFormAdapters, Set<string>>();
  for (const rowKey of rowKeys) {
    const entries = rowDetailFormsByRowKey.get(rowKey);
    if (!entries) continue;
    for (const entry of entries) {
      const registry = entry.forms ?? panel.instance.forms;
      if (!registry) continue;
      let slotSet = byRegistry.get(registry);
      if (!slotSet) {
        slotSet = new Set<string>();
        byRegistry.set(registry, slotSet);
      }
      slotSet.add(entry.slot);
    }
  }
  const grouped = new Map<PanelFormAdapters, string[]>();
  for (const [registry, slotSet] of byRegistry) {
    if (slotSet.size > 0) grouped.set(registry, [...slotSet]);
  }
  return grouped;
}

function hasDirtyRowDetailForms(rowKeys: readonly string[]): boolean {
  if (rowKeys.length === 0) return false;
  for (const [registry, slotList] of collectScopedRowDetailForms(rowKeys)) {
    if (registry.dirty(slotList)) return true;
  }
  return false;
}

function discardRowDetailForms(rowKeys: readonly string[]): void {
  for (const [registry, slotList] of collectScopedRowDetailForms(rowKeys)) {
    registry.discardAll(slotList);
  }
}

function askLeaveUnsavedRowDetail(): Promise<boolean> {
  if (panel.confirmLeaveUnsaved) {
    return panel.confirmLeaveUnsaved();
  }
  return confirmDanger(
    t("platform.formLeaveUnsaved"),
    t("platform.unsavedChanges"),
    {
      confirmButtonText: t("platform.discard"),
      cancelButtonText: t("platform.keepEditing"),
    },
  );
}

function guardAndApplyRowExpand(collapsingRowKeys: readonly string[], apply: () => void): void {
  if (!hasDirtyRowDetailForms(collapsingRowKeys)) {
    apply();
    return;
  }
  if (expandGuardPending) return;
  expandGuardPending = true;
  void (async () => {
    try {
      const leave = await askLeaveUnsavedRowDetail();
      if (componentUnmounted || !leave) return;
      discardRowDetailForms(collapsingRowKeys);
      apply();
    } catch {
      // Treat a rejected confirmation prompt as cancelling the collapse/switch.
    } finally {
      expandGuardPending = false;
    }
  })();
}

function setDetailElement(key: string, element: unknown) {
  if (element instanceof HTMLElement) {
    detailElements.set(key, element);
    if (element.offsetHeight > 0) recordMeasuredHeight(measuredDetailHeights, key, element.offsetHeight);
  } else {
    detailElements.delete(key);
  }
}

function rowExpandAliases(row: PlatformObjectRecord): readonly string[] {
  const identity = rowIdentityKey(row);
  const itemKey = rowItemKey(row);
  const itemKeyStr = typeof itemKey === "string" ? itemKey : `${itemKey.className}:${itemKey.primaryKey}`;
  const aliases = [identity];
  if (itemKeyStr && itemKeyStr !== identity) aliases.push(itemKeyStr);
  if (row.primaryKey && !aliases.includes(row.primaryKey)) aliases.push(row.primaryKey);
  return aliases;
}

const hasDuplicatePrimaryKeys = computed(() => {
  const seen = new Set<string>();
  for (const row of rows.value) {
    if (seen.has(row.primaryKey)) return true;
    seen.add(row.primaryKey);
  }
  return false;
});

function rowExpandCanonicalKey(row: PlatformObjectRecord): string {
  if (hasDuplicatePrimaryKeys.value) return rowIdentityKey(row);
  return row.primaryKey || rowIdentityKey(row);
}

function findRowByExpandKey(key: string): PlatformObjectRecord | undefined {
  return rows.value.find((row) => rowExpandAliases(row).includes(key));
}

function setExpandedKeys(next: readonly string[]) {
  const normalized = normalizeExpandedKeys(next, effectiveRowExpandMode.value);
  if (!isPropControlledExpandedKeys.value && !hasExpandedKeysSource) {
    internalExpandedKeys.value = normalized;
  }
  if (placement.outputs?.expandedKeys) {
    void panel.instance.output(member.key, "expandedKeys", normalized as unknown as RuntimeJsonValue);
  } else if (hasWritableExpandedKeysInput) {
    expandedKeysParam.set(normalized as unknown as RuntimeJsonValue);
  }
  emit("update:expandedKeys", normalized);
}

function isRowExpanded(row: PlatformObjectRecord): boolean {
  return matchesRowExpandedKey(expandedKeySet.value, rowExpandAliases(row));
}

function expandRowKeyImmediate(key: string, knownRow?: PlatformObjectRecord) {
  const row = knownRow ?? findRowByExpandKey(key);
  const canonical = row ? rowExpandCanonicalKey(row) : key;
  const aliases = row ? rowExpandAliases(row) : [key];
  const current = expandedKeyList.value;
  const next = addExpandedRowKey(current, canonical, aliases, effectiveRowExpandMode.value);
  if (next.length === current.length && next.every((item, idx) => item === current[idx])) return;
  setExpandedKeys(next);
}

function collapseRowKeyImmediate(key: string, knownRow?: PlatformObjectRecord) {
  const row = knownRow ?? findRowByExpandKey(key);
  const aliases = row ? rowExpandAliases(row) : [key];
  const current = expandedKeyList.value;
  const next = removeExpandedRowAliases(current, aliases);
  if (next.length === current.length) return;
  setExpandedKeys(next);
}

function expandRowKey(key: string) {
  expandRowKeyImmediate(key);
}

function collapseRowKey(key: string) {
  collapseRowKeyImmediate(key);
}

function requestCollapseRow(row: PlatformObjectRecord) {
  const identity = rowIdentityKey(row);
  guardAndApplyRowExpand([identity], () => collapseRowKeyImmediate(identity, row));
}

function toggleRowExpanded(row: PlatformObjectRecord) {
  const identity = rowIdentityKey(row);
  if (isRowExpanded(row)) {
    guardAndApplyRowExpand([identity], () => collapseRowKeyImmediate(identity, row));
    return;
  }
  if (effectiveRowExpandMode.value === "single") {
    const collapsingSet = new Set<string>();
    for (const candidate of rows.value) {
      const candidateIdentity = rowIdentityKey(candidate);
      if (candidateIdentity !== identity && isRowExpanded(candidate)) {
        collapsingSet.add(candidateIdentity);
      }
    }
    for (const registeredKey of rowDetailFormsByRowKey.keys()) {
      if (registeredKey !== identity) collapsingSet.add(registeredKey);
    }
    guardAndApplyRowExpand([...collapsingSet], () => expandRowKeyImmediate(identity, row));
    return;
  }
  expandRowKeyImmediate(identity, row);
}

watch(effectiveRowExpandMode, (mode) => {
  if (mode === "single" && !hasControlledExpandedKeys.value && internalExpandedKeys.value.length > 1) {
    internalExpandedKeys.value = [internalExpandedKeys.value[0]!];
  }
});
function rowExpandAriaLabel(row: PlatformObjectRecord): string {
  const label = row.label || row.primaryKey;
  return isRowExpanded(row)
    ? t("platform.listCollapseRow", { label })
    : t("platform.listExpandRow", { label });
}

const activeType = computed<string | null>(() => {
  if (datumName !== "objects") return rowObjectType;
  const value = currentParams.value.type;
  return typeof value === "string" && value ? value : null;
});

const filterSignature = computed(() =>
  JSON.stringify(nonPagingParamNames.map((name) => currentParams.value[name] ?? null)),
);
let initialLoadDone = false;
let pendingScrollToTop = false;

// Synchronously clear local search and reset paging when switching dynamic type, so useMemberData issues one read.
if (datumName === "objects") {
  watch(
    activeType,
    (next, prev) => {
      if (next === prev) return;
      if (searchParam && !isAuthoredParam("search") && searchParam.value.value !== null) {
        searchParam.set(null);
      }
      resetPaging();
    },
    { flush: "sync" },
  );
}
if ("object" in datum.source) {
  const parentSource = datum.source.object;
  const parentSourceKey = computed(() =>
    "literal" in parentSource
      ? JSON.stringify(parentSource.literal)
      : JSON.stringify(member.inputs.value[parentSource.input] ?? null),
  );
  watch(
    parentSourceKey,
    (next, prev) => {
      if (next === prev) return;
      initialLoadDone = false;
      activeRowLabel.value = null;
      if (expandedKeyList.value.length > 0) setExpandedKeys([]);
      rowOperationResults.value = {};
      lastNoneModeFeedback.value = null;
      resetPaging();
    },
    { flush: "sync" },
  );
}

// Reset paging before useMemberData's pre-flush watch reacts to search or filter changes.
if (nonPagingParamNames.length > 0) {
  watch(
    filterSignature,
    (next, prev) => {
      if (next === prev) return;
      if (initialLoadDone) pendingScrollToTop = true;
      if (pageMode !== "none") resetPaging();
    },
    { flush: "sync" },
  );
}

if (pageMode === "page") {
  watch(
    () => JSON.stringify(currentParams.value.page ?? null),
    (next, prev) => {
      if (next === prev || !initialLoadDone) return;
      pendingScrollToTop = true;
    },
    { flush: "sync" },
  );
}

const datumState = useMemberData(datumName);
const refreshDatum = useMemberRefresh(datumName);
const highlightedIdentity = ref<string | null>(null);
const hasSupplement = Object.hasOwn(member.projection.data, "supplement");
const supplementState = hasSupplement ? useMemberData("supplement") : null;

const supplementLoading = computed(() => Boolean(supplementState && supplementState.value.status === "loading"));
const supplementError = computed<string | null>(() => {
  if (!supplementState) return null;
  const state = supplementState.value;
  if (state.status === "error") return state.message || t("platform.dataUnreachable");
  if (state.status === "forbidden") return state.reason || t("platform.dataForbidden");
  return null;
});

function isCellAwaitingSupplement(row: PlatformObjectRecord, key: string): boolean {
  return supplementLoading.value
    && key !== "label"
    && key !== "primaryKey"
    && rawRecordField(row, key) === undefined
    && row.tags?.[key] === undefined;
}

const isCompleteList = computed<boolean>(() => {
  if (datumName !== "rows" || pageMode !== "none" || hasServerSearch) return false;
  if (declaration) return declaration.result === "panelRecordList";
  return datumState.value.status === "ready" ? Array.isArray(datumState.value.value) : true;
});

const activeReadyDatum = computed<MemberReadyData | undefined>(() => {
  const state = datumState.value;
  if (state.status === "ready") return state;
  if (state.status === "error" || state.status === "loading") return state.previous;
  return undefined;
});

function parseReadyDatum(ready: MemberReadyData | undefined): ParsedListData {
  if (!ready) {
    return { rows: [], total: null, hasTotal: false, diagnostics: [], status: "ok" };
  }
  const value = ready.value;
  if (datumName === "objects") {
    const response = value as unknown as PlatformOntologyObjectsResponse;
    if (response.status !== "ok") {
      return {
        rows: [],
        total: null,
        hasTotal: false,
        diagnostics: [],
        status: response.status,
        reason: response.reason,
      };
    }
    const items: PlatformObjectRecord[] = response.items.map((item) => {
      const fields: Record<string, string> = item.detail !== undefined ? { detail: item.detail } : {};
      return {
        primaryKey: item.node.primaryKey,
        className: item.node.className,
        label: item.label,
        ...(item.detail !== undefined ? { subtitle: item.detail } : {}),
        fields,
      };
    });
    const hasTotal = typeof response.total === "number" && Number.isFinite(response.total);
    return { rows: items, total: hasTotal ? response.total : null, hasTotal, diagnostics: [], status: "ok" };
  }
  if (Array.isArray(value)) {
    const items = value as unknown as readonly PlatformObjectRecord[];
    return { rows: items, total: items.length, hasTotal: true, diagnostics: [], status: "ok" };
  }
  const queryResult = value as unknown as PanelRecordQuery;
  const items = queryResult.rows as unknown as readonly PlatformObjectRecord[];
  // Strictly adopt the owner-returned total for query reads; never substitute loaded row counts when total is absent.
  const hasTotal = typeof queryResult.total === "number" && Number.isFinite(queryResult.total);
  return {
    rows: items,
    total: hasTotal ? queryResult.total! : null,
    hasTotal,
    nextCursor: queryResult.nextCursor,
    diagnostics: queryResult.diagnostics ?? [],
    status: "ok",
  };
}

const parsedData = computed<ParsedListData>(() => parseReadyDatum(activeReadyDatum.value));
const hasPreviousOnError = computed(
  () => datumState.value.status === "error" && Boolean(datumState.value.previous) && parsedData.value.status === "ok",
);
const hasPreviousOnLoading = computed(
  () => datumState.value.status === "loading" && Boolean(datumState.value.previous) && parsedData.value.status === "ok",
);
const isRefreshingWithPrevious = computed(
  () => hasPreviousOnLoading.value || (datumState.value.status === "ready" && Boolean(datumState.value.refreshing)),
);

const rawRows = computed<readonly PlatformObjectRecord[]>(() => {
  if (pageMode === "cursor" && !usesCursorPages.value && cursorBatches.value.length > 0) {
    const seen = new Set<string>();
    const merged: PlatformObjectRecord[] = [];
    for (const batch of cursorBatches.value) {
      for (const row of batch.rows) {
        const key = rowIdentityKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(row);
      }
    }
    return merged;
  }
  return parsedData.value.rows;
});

const mergedRowOperations = computed<PanelRowOperationsMap>(() => {
  if (pageMode === "cursor" && !usesCursorPages.value && cursorBatches.value.length > 0) {
    const merged: Record<string, PanelRowOperationsMap[string]> = {};
    for (const batch of cursorBatches.value) {
      if (!batch.rowOperations) continue;
      for (const [key, ops] of Object.entries(batch.rowOperations)) {
        merged[key] = ops;
      }
    }
    return merged;
  }
  return activeReadyDatum.value?.rowOperations ?? {};
});

// Keep accumulated cursor batches synced synchronously with datumState so `rows`, `listResult`, and `listed` stay consistent.
watch(
  datumState,
  (state) => {
    if (state.status === "loading" || (state.status === "ready" && state.refreshing)) return;
    if (state.status === "empty") {
      cursorBatches.value = [];
      loadingMore.value = false;
      pendingAppendCursor = null;
      return;
    }
    if (state.status !== "ready" || parsedData.value.status !== "ok") {
      if (state.status === "error") {
        loadingMore.value = false;
        if (hasPreviousOnError.value || (pendingAppendCursor !== null && cursorBatches.value.length > 0)) return;
        pendingAppendCursor = null;
        return;
      }
      cursorBatches.value = [];
      loadingMore.value = false;
      pendingAppendCursor = null;
      return;
    }
    lastKnownTotal.value = parsedData.value.total;
    lastKnownHasTotal.value = parsedData.value.hasTotal;
    if (pageMode === "cursor") {
      const activeCursor = typeof currentParams.value.cursor === "string" ? currentParams.value.cursor : null;
      const incoming = parsedData.value.rows;
      const incomingRowOps = state.rowOperations;
      if (activeCursor === null) {
        cursorBatches.value = [{ cursor: null, rows: incoming, rowOperations: incomingRowOps }];
      } else if (pendingAppendCursor === activeCursor) {
        const existingIndex = cursorBatches.value.findIndex((batch) => batch.cursor === activeCursor);
        cursorBatches.value = existingIndex >= 0
          ? cursorBatches.value.map((batch, index) => (index === existingIndex ? { cursor: activeCursor, rows: incoming, rowOperations: incomingRowOps } : batch))
          : [...cursorBatches.value, { cursor: activeCursor, rows: incoming, rowOperations: incomingRowOps }];
      } else {
        const existingIndex = cursorBatches.value.findIndex((batch) => batch.cursor === activeCursor);
        cursorBatches.value = existingIndex >= 0
          ? cursorBatches.value.map((batch, index) => (index === existingIndex ? { cursor: activeCursor, rows: incoming, rowOperations: incomingRowOps } : batch))
          : [{ cursor: activeCursor, rows: incoming, rowOperations: incomingRowOps }];
      }
      loadingMore.value = false;
      pendingAppendCursor = null;
    }
  },
  { immediate: true, flush: "sync" },
);

const supplementLookup = computed<{
  readonly byIdentity: ReadonlyMap<string, PlatformObjectRecord>;
  readonly byPrimaryKey: ReadonlyMap<string, PlatformObjectRecord>;
} | null>(() => {
  if (!supplementState || supplementState.value.status !== "ready" || !Array.isArray(supplementState.value.value)) {
    return null;
  }
  const items = supplementState.value.value as unknown as readonly PlatformObjectRecord[];
  if (items.length === 0) return null;
  const byIdentity = new Map<string, PlatformObjectRecord>();
  const byPrimaryKey = new Map<string, PlatformObjectRecord>();
  const ambiguousPrimaryKeys = new Set<string>();
  for (const item of items) {
    byIdentity.set(rowIdentityKey(item), item);
    if (!item.className) {
      if (ambiguousPrimaryKeys.has(item.primaryKey)) continue;
      if (byPrimaryKey.has(item.primaryKey)) {
        byPrimaryKey.delete(item.primaryKey);
        ambiguousPrimaryKeys.add(item.primaryKey);
      } else {
        byPrimaryKey.set(item.primaryKey, item);
      }
    }
  }
  return { byIdentity, byPrimaryKey };
});

const mergedRows = computed<readonly PlatformObjectRecord[]>(() => {
  const lookup = supplementLookup.value;
  if (!lookup || rawRows.value.length === 0) return rawRows.value;
  const primaryKeyCounts = new Map<string, number>();
  for (const row of rawRows.value) {
    primaryKeyCounts.set(row.primaryKey, (primaryKeyCounts.get(row.primaryKey) ?? 0) + 1);
  }
  return rawRows.value.map((row) => {
    const sup = lookup.byIdentity.get(rowIdentityKey(row))
      ?? (primaryKeyCounts.get(row.primaryKey) === 1 ? lookup.byPrimaryKey.get(row.primaryKey) : undefined);
    if (!sup) return row;
    const fieldLabels = row.fieldLabels || sup.fieldLabels
      ? { ...(row.fieldLabels ?? {}), ...(sup.fieldLabels ?? {}) }
      : undefined;
    const tones = row.tones || sup.tones
      ? { ...(row.tones ?? {}), ...(sup.tones ?? {}) }
      : undefined;
    const tags = row.tags ?? sup.tags;
    return {
      ...row,
      ...(row.subtitle === undefined && sup.subtitle !== undefined ? { subtitle: sup.subtitle } : {}),
      fields: { ...(row.fields ?? {}), ...(sup.fields ?? {}) },
      ...(fieldLabels ? { fieldLabels } : {}),
      ...(tones ? { tones } : {}),
      ...(tags ? { tags } : {}),
    };
  });
});

const searchText = computed<string>(() => {
  const raw = searchParam?.value.value;
  return typeof raw === "string" ? raw : "";
});
const normalizedLocalQuery = computed(() =>
  isLocalSearchActive.value ? searchText.value.trim().toLowerCase() : "",
);
const activeLocalFieldFilters = computed<readonly (readonly [string, unknown])[]>(() => {
  if (pageMode !== "none") return [];
  const entries = new Map<string, unknown>();
  for (const { key, param } of localFilterParamEntries) {
    const val = param.value.value;
    if (isLocalFilterValueActive(val)) entries.set(key, val);
  }
  const inputMap = localFiltersInputParam?.value.value;
  if (inputMap && typeof inputMap === "object" && !Array.isArray(inputMap)) {
    for (const [key, val] of Object.entries(inputMap as Record<string, unknown>)) {
      if (isLocalFilterValueActive(val)) entries.set(key, val);
    }
  }
  if (props.localFilters) {
    for (const [key, val] of Object.entries(props.localFilters)) {
      if (isLocalFilterValueActive(val)) entries.set(key, val);
    }
  }
  return [...entries.entries()];
});
const hasActiveLocalFilter = computed(
  () => pageMode === "none" && (normalizedLocalQuery.value !== "" || activeLocalFieldFilters.value.length > 0),
);

const rows = computed<readonly PlatformObjectRecord[]>(() => {
  if (!hasActiveLocalFilter.value) return mergedRows.value;
  const query = normalizedLocalQuery.value;
  const filters = activeLocalFieldFilters.value;
  const fallbackClassName = activeType.value ?? rowObjectType;
  return mergedRows.value.filter((row) => {
    if (query !== "" && !matchesLocalSearch(row, query, locale.value, t, props.searchFields)) return false;
    for (const [fieldKey, expected] of filters) {
      if (!matchesLocalFieldFilter(row, fieldKey, expected, fallbackClassName, locale.value, t)) return false;
    }
    return true;
  });
});

const total = computed<number | null>(() => {
  if (hasActiveLocalFilter.value) return rows.value.length;
  if (datumState.value.status === "empty" && isCompleteList.value) return 0;
  return parsedData.value.total;
});
const effectiveHasTotal = computed(
  () =>
    isCompleteList.value
      ? (canSearch.value || hasActiveLocalFilter.value)
      : parsedData.value.hasTotal,
);
const nextCursor = computed(() => parsedData.value.nextCursor);
const queryStatus = computed(() => parsedData.value.status);
const diagnostics = computed(() => parsedData.value.diagnostics);
const queryReason = computed(() => parsedData.value.reason);

const childSelectionParent = computed<PanelObjectIdentity | null>(() => {
  if (!isChildObjectSelection || !("object" in datum.source)) return null;
  if ("literal" in datum.source.object) {
    const literal = datum.source.object.literal;
    return { objectType: literal.className, primaryKey: literal.primaryKey };
  }
  const inputRef = stateObject(member.inputs.value[datum.source.object.input] as PanelFieldValue | undefined);
  if (!inputRef) return null;
  return { objectType: inputRef.className, primaryKey: inputRef.primaryKey };
});

function rowObjectRef(row: PlatformObjectRecord) {
  return panelRecordObjectRef(row, activeType.value ?? rowObjectType);
}

function rowSelectionValue(row: PlatformObjectRecord): ObjectListSelection {
  const parent = childSelectionParent.value;
  if (parent) {
    return { parent, primaryKey: row.primaryKey };
  }
  return rowObjectRef(row);
}
const listedRefs = computed(() => rows.value.map(rowObjectRef));

function rowItemKey(row: PlatformObjectRecord) {
  return panelRecordItemKey(row, { fallbackClassName: activeType.value ?? rowObjectType });
}

function rowClassName(row: PlatformObjectRecord): string {
  return rowObjectRef(row).className;
}

function refKey(refValue: ObjectListRef): string {
  return `${refValue.className}\u0000${refValue.primaryKey}`;
}

function rowCheckKey(row: PlatformObjectRecord): string {
  return refKey(rowObjectRef(row));
}

function selectionIdentity(value: ObjectListSelection | null): string | null {
  if (!value) return null;
  if ("parent" in value) return `child\u0000${value.parent.objectType}\u0000${value.parent.primaryKey}\u0000${value.primaryKey}`;
  return refKey(value);
}

function rowIdentityKey(row: PlatformObjectRecord): string {
  return selectionIdentity(rowSelectionValue(row))!;
}

const chosenRef = computed<ObjectListSelection | null>(() => {
  if (!hasSelectedSource) return null;
  const raw = selectedParam.value.value as PanelFieldValue;
  return stateChildObject(raw) ?? stateObject(raw);
});
const chosenIdentity = computed<string | null>(() => selectionIdentity(chosenRef.value));

const checkedRefs = computed<readonly ObjectListRef[]>(() =>
  stateObjects(checkedParam.value.value as PanelFieldValue),
);
const checkedIdentityKeys = computed(() => new Set(checkedRefs.value.map(refKey)));
const selectableVisibleRows = computed(() => rows.value.filter((row) => !isRowCheckDisabled(row)));
const allVisibleChecked = computed(
  () =>
    selectableVisibleRows.value.length > 0
    && selectableVisibleRows.value.every((row) => checkedIdentityKeys.value.has(rowCheckKey(row))),
);
const someVisibleChecked = computed(
  () =>
    !allVisibleChecked.value
    && selectableVisibleRows.value.some((row) => checkedIdentityKeys.value.has(rowCheckKey(row))),
);

const lastDynamicColumns = ref<readonly ObjectListColumn[]>([]);
const lastDynamicFieldLabels = ref<Readonly<Record<string, string>>>({});
const hiddenColumnKeys = ref<ReadonlySet<string>>(new Set());
const columnToggleOpen = ref(false);

const dynamicColumnScopeKey = computed(() =>
  JSON.stringify({
    activeType: activeType.value,
    typeParam: currentParams.value.type ?? null,
    classNameParam: currentParams.value.className ?? null,
    parent: "object" in datum.source
      ? ("literal" in datum.source.object
        ? datum.source.object.literal
        : (member.inputs.value[datum.source.object.input] ?? null))
      : null,
  }),
);

watch(
  dynamicColumnScopeKey,
  (next, prev) => {
    if (next === prev) return;
    lastDynamicColumns.value = [];
    lastDynamicFieldLabels.value = {};
    hiddenColumnKeys.value = new Set();
    columnToggleOpen.value = false;
    highlightedIdentity.value = null;
  },
  { flush: "sync" },
);

watch(
  [() => props.dynamicColumns, () => Boolean(props.columns?.length), mergedRows] as const,
  ([dynamicEnabled, hasStaticColumns, currentRows]) => {
    if (!dynamicEnabled || hasStaticColumns) {
      if (lastDynamicColumns.value.length > 0) lastDynamicColumns.value = [];
      if (Object.keys(lastDynamicFieldLabels.value).length > 0) lastDynamicFieldLabels.value = {};
      return;
    }
    if (currentRows.length > 0) {
      lastDynamicColumns.value = deriveDynamicColumns(currentRows);
      lastDynamicFieldLabels.value = collectDynamicFieldLabels(currentRows);
    }
  },
  { immediate: true, flush: "sync" },
);

const allColumns = computed<readonly ObjectListColumn[]>(() => {
  if (props.columns?.length) return props.columns;
  if (!props.dynamicColumns) return [];
  if (mergedRows.value.length > 0) return deriveDynamicColumns(mergedRows.value);
  return lastDynamicColumns.value;
});

const currentColumnSchemaKey = computed(() => columnSchemaKey(allColumns.value));

watch(
  currentColumnSchemaKey,
  (next, prev) => {
    if (next !== prev) {
      hiddenColumnKeys.value = new Set();
      columnToggleOpen.value = false;
    }
  },
  { flush: "sync" },
);

const responsiveColumns = computed<readonly ObjectListColumn[]>(() =>
  filterResponsiveColumns(allColumns.value, containerWidth.value),
);

const visibleColumns = computed<readonly ObjectListColumn[]>(() =>
  filterVisibleColumns(responsiveColumns.value, hiddenColumnKeys.value),
);

function setColumnVisible(key: string, visible: boolean) {
  hiddenColumnKeys.value = toggleColumnKeyVisibility(responsiveColumns.value, hiddenColumnKeys.value, key, visible);
}

function resetColumnVisibility() {
  if (hiddenColumnKeys.value.size > 0) hiddenColumnKeys.value = new Set();
}

function openColumnToggle() {
  if (allColumns.value.length > 0) columnToggleOpen.value = true;
}

function closeColumnToggle() {
  columnToggleOpen.value = false;
}

const effectiveLayout = computed<"list" | "table" | "cards" | "tabs" | "accordion">(() => {
  if (props.layout === "tabs") return "tabs";
  if (props.layout === "cards") return "cards";
  if (props.layout === "accordion") return "accordion";
  if (props.layout === "list") return "list";
  return props.columns?.length || props.dynamicColumns ? "table" : "list";
});
const isTable = computed(() => effectiveLayout.value === "table");
const isCards = computed(() => effectiveLayout.value === "cards");
const isTabs = computed(() => effectiveLayout.value === "tabs");
const isAccordion = computed(() => effectiveLayout.value === "accordion");
const isCompact = computed(() => !isTable.value && !isCards.value && !isTabs.value && !isAccordion.value);
const resolvedSkeletonCount = computed(() => Math.max(1, Math.floor(props.skeletonCount ?? 6)));
const effectiveCardSubtitleLines = computed(() => props.subtitleLines ?? 2);

const tabsScrollerRef = ref<HTMLElement | null>(null);
const tabsCanScrollLeft = ref(false);
const tabsCanScrollRight = ref(false);
const openTabMenuKey = ref<string | null>(null);
const internalRenamingKey = ref<string | null>(null);
const inlineRenameDraft = ref("");
const inlineRenameOriginal = ref("");
const inlineRenameInputRef = ref<HTMLInputElement | null>(null);
let inlineRenameHandled = false;
let inlineRenameFocusTimer: ReturnType<typeof setTimeout> | null = null;
let tabsResizeObserver: ResizeObserver | null = null;

function onTabMenuOpenChange(rowKey: string, open: boolean) {
  if (open) {
    openTabMenuKey.value = rowKey;
  } else if (openTabMenuKey.value === rowKey) {
    openTabMenuKey.value = null;
  }
}

function setInlineRenameInput(el: unknown) {
  inlineRenameInputRef.value = el instanceof HTMLInputElement ? el : null;
}

function matchesTabRenamingKey(row: PlatformObjectRecord, targetKey: string | null | undefined): boolean {
  if (!targetKey) return false;
  return rowIdentityKey(row) === targetKey || row.primaryKey === targetKey;
}

const activeRenamingKey = computed<string | null>(() =>
  props.renamingKey !== undefined ? (props.renamingKey || null) : internalRenamingKey.value,
);

function isTabRenaming(row: PlatformObjectRecord): boolean {
  return isTabs.value && matchesTabRenamingKey(row, activeRenamingKey.value);
}

function focusInlineRenameInput() {
  void nextTick(() => {
    const input = inlineRenameInputRef.value;
    if (!input) return;
    input.focus();
    input.select();
    if (inlineRenameFocusTimer !== null) clearTimeout(inlineRenameFocusTimer);
    inlineRenameFocusTimer = setTimeout(() => {
      inlineRenameFocusTimer = null;
      const current = inlineRenameInputRef.value;
      if (current && document.activeElement !== current) {
        current.focus();
        current.select();
      }
    }, 0);
  });
}

function startTabInlineRename(row: PlatformObjectRecord) {
  const key = rowIdentityKey(row);
  inlineRenameHandled = false;
  inlineRenameDraft.value = row.label;
  inlineRenameOriginal.value = row.label;
  openTabMenuKey.value = null;
  internalRenamingKey.value = key;
  emit("update:renamingKey", row.primaryKey);
  focusInlineRenameInput();
}

function finishTabInlineRename() {
  internalRenamingKey.value = null;
  emit("update:renamingKey", null);
}

function commitTabInlineRename(row: PlatformObjectRecord, index: number) {
  if (inlineRenameHandled) return;
  inlineRenameHandled = true;
  const resolution = resolveInlineRenameCommit(inlineRenameDraft.value, inlineRenameOriginal.value);
  const previousValue = inlineRenameOriginal.value;
  finishTabInlineRename();
  if (resolution.kind === "cancel") {
    emit("rename-cancel", { ref: rowObjectRef(row), index });
    return;
  }
  emit("rename-commit", {
    ref: rowObjectRef(row),
    value: resolution.value,
    previousValue,
    index,
  });
  const opName = props.inlineRenameOperation;
  if (!opName) return;
  const descriptor = admittedOpMap.value[opName];
  const binding = member.projection.operations?.[opName];
  if (!descriptor || !binding) return;
  const allFields = resolveOperationInputFields(panel, slot, opName, descriptor);
  const allowedKeys = allowedRowOperationInputKeys(binding, allFields);
  const allowedFields = allFields.filter((field) => allowedKeys.has(field.name));
  const fieldKey = resolveInlineRenameFieldKey(props.inlineRenameField, allowedFields);
  if (!fieldKey) return;
  void runRowOperation(row, opName, { [fieldKey]: resolution.value });
}

function cancelTabInlineRename(row: PlatformObjectRecord, index: number) {
  if (inlineRenameHandled) return;
  inlineRenameHandled = true;
  finishTabInlineRename();
  emit("rename-cancel", { ref: rowObjectRef(row), index });
}

function onInlineRenameKeydown(row: PlatformObjectRecord, index: number, event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Enter") {
    if (event.isComposing) return;
    event.preventDefault();
    commitTabInlineRename(row, index);
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancelTabInlineRename(row, index);
  }
}

watch(
  () => props.renamingKey,
  (next) => {
    if (!next || !isTabs.value) return;
    const match = rows.value.find((row) => matchesTabRenamingKey(row, next));
    if (!match) return;
    inlineRenameHandled = false;
    inlineRenameDraft.value = match.label;
    inlineRenameOriginal.value = match.label;
    openTabMenuKey.value = null;
    focusInlineRenameInput();
  },
);

function updateTabsOverflow() {
  const el = tabsScrollerRef.value;
  if (!el || !isTabs.value) {
    tabsCanScrollLeft.value = false;
    tabsCanScrollRight.value = false;
    return;
  }
  tabsCanScrollLeft.value = el.scrollLeft > 1;
  tabsCanScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

function tabLeftRelativeToScroller(strip: HTMLElement, tab: HTMLElement): number {
  if (tab.offsetParent === strip) return tab.offsetLeft;
  const stripRect = strip.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  return tabRect.left - stripRect.left + strip.scrollLeft;
}

function revealActiveTab() {
  const el = tabsScrollerRef.value;
  if (!el || !isTabs.value) {
    updateTabsOverflow();
    return;
  }
  const active = el.querySelector<HTMLElement>(".sdk-object-list-tab.chosen");
  if (!active) {
    updateTabsOverflow();
    return;
  }
  const tabLeft = tabLeftRelativeToScroller(el, active);
  const nextScrollLeft = computeRevealTabScrollLeft(el.scrollLeft, el.clientWidth, tabLeft, active.offsetWidth);
  if (nextScrollLeft !== el.scrollLeft) {
    el.scrollLeft = nextScrollLeft;
  }
  updateTabsOverflow();
}

function scrollTabsBy(direction: -1 | 1) {
  const el = tabsScrollerRef.value;
  if (!el) return;
  const tabEls = Array.from(el.querySelectorAll<HTMLElement>(".sdk-object-list-tab"));
  const bounds = tabEls.map((tab) => ({
    left: tabLeftRelativeToScroller(el, tab),
    width: tab.offsetWidth,
  }));
  const step = computeTabScrollStep(bounds, el.scrollLeft, el.clientWidth, direction, 4);
  if (typeof el.scrollBy === "function") {
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  } else {
    el.scrollLeft += direction * step;
  }
  updateTabsOverflow();
}

function onTabKeydown(row: PlatformObjectRecord, index: number, event: KeyboardEvent) {
  if (isTabRenaming(row)) return;
  if (event.key === "Enter" || event.key === " ") {
    if (rowActivatable.value) {
      event.preventDefault();
      choose(row);
    }
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const list = rows.value;
  if (list.length <= 1) return;
  event.preventDefault();
  const nextIndex = event.key === "ArrowRight"
    ? (index + 1) % list.length
    : (index - 1 + list.length) % list.length;
  const nextRow = list[nextIndex];
  if (!nextRow) return;
  const el = tabsScrollerRef.value?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex];
  el?.focus();
}

watch(tabsScrollerRef, (el) => {
  tabsResizeObserver?.disconnect();
  tabsResizeObserver = null;
  if (!el) {
    tabsCanScrollLeft.value = false;
    tabsCanScrollRight.value = false;
    return;
  }
  if (typeof ResizeObserver !== "undefined") {
    tabsResizeObserver = new ResizeObserver(() => revealActiveTab());
    tabsResizeObserver.observe(el);
  }
  void nextTick(revealActiveTab);
});

watch(
  [isTabs, chosenIdentity, () => rows.value.length],
  () => {
    if (isTabs.value) void nextTick(revealActiveTab);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  tabsResizeObserver?.disconnect();
  tabsResizeObserver = null;
  if (inlineRenameFocusTimer !== null) {
    clearTimeout(inlineRenameFocusTimer);
    inlineRenameFocusTimer = null;
  }
});

/** From this many characters a text column shrinks to the table's room and ends in an ellipsis rather than set its width. */
const LONG_TEXT = 24;
/** A column's text in a row, as the cell shows it. */
function columnText(row: PlatformObjectRecord, column: ObjectListColumn): string {
  const derived = resolveResultFromCell(row, column);
  if (derived) {
    if (derived.hasExplicitLabel) return derived.text;
    const mappedLabel = columnMapped(row, column)?.label;
    return mappedLabel ?? derived.text;
  }
  return displayFieldText(rawRecordField(row, column.key), locale.value, t, column.listSeparator ?? ", ");
}
/** A column's secondary line text in a row, when `subtitleKey` is configured. */
function columnSubtitleText(row: PlatformObjectRecord, column: ObjectListColumn): string {
  if (!column.subtitleKey) return "";
  const text = fieldValue(row, column.subtitleKey);
  if (text !== "") return text;
  return column.subtitleEmptyKey ? panel.t(column.subtitleEmptyKey) : "";
}
/**
 * How a column is laid out, with no width of its own: one line at its own width by default, so a short value never
 * breaks; a text column whose values (including its optional `subtitleKey` line) run long shrinks to the room left and
 * ends in an ellipsis; a column the panel marks `wrap` runs onto several lines. A table wider than its frame scrolls
 * inside it.
 */
const columnFit = computed(() => new Map(visibleColumns.value.map((column) => [column.key,
  columnCellSlot(column.key) ? (column.wrap ? "sdk-object-list-col-wrap" : "")
    : column.wrap ? "sdk-object-list-col-wrap"
      : (column.kind === undefined || column.kind === "text" || column.kind === "reference")
        && rows.value.some((row) => columnText(row, column).length > LONG_TEXT || columnSubtitleText(row, column).length > LONG_TEXT)
        ? "sdk-object-list-col-shrink" : ""])));
/**
 * Format a time column's ISO value in the reader's locale and time zone: relative by default (`formatListTime`), or
 * full local date-time (`datetime`) / local date (`date`). A value that is no time is shown as it is.
 */
function timeText(value: string, timeFormat?: ObjectListColumn["timeFormat"]): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  if (timeFormat === "datetime") {
    return parsed.toLocaleString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (timeFormat === "date") {
    return parsed.toLocaleDateString(locale.value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  return formatListTime(value) || value;
}
/** The text a cell's title gives in full: a supplement error for an unpopulated column, a long text column's whole text, or a time column's whole local time. */
function cellTitle(row: PlatformObjectRecord, column: ObjectListColumn): string | undefined {
  if (
    supplementError.value
    && column.key !== "label"
    && column.key !== "primaryKey"
    && rawRecordField(row, column.key) === undefined
    && row.tags?.[column.key] === undefined
  ) {
    return supplementError.value;
  }
  if (column.kind === "time") {
    const value = fieldValue(row, column.key);
    return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString(locale.value) : undefined;
  }
  if (columnFit.value.get(column.key) === "sdk-object-list-col-shrink") {
    const main = columnText(row, column);
    const sub = columnSubtitleText(row, column);
    return sub ? (main ? `${main}\n${sub}` : sub) : main;
  }
  return undefined;
}
const totalPages = computed(() => Math.max(1, Math.ceil((total.value ?? 0) / effectivePageSize.value)));

type PaginationItem = number | "ellipsis";

const showNumericPages = computed(() => pageMode === "page" && effectiveHasTotal.value);

const paginationItems = computed<readonly PaginationItem[]>(() => {
  const pages = totalPages.value;
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const current = currentPage.value;
  const items: PaginationItem[] = [1];
  const windowStart = Math.max(2, current - 1);
  const windowEnd = Math.min(pages - 1, current + 1);
  if (windowStart > 2) items.push("ellipsis");
  for (let page = windowStart; page <= windowEnd; page += 1) items.push(page);
  if (windowEnd < pages - 1) items.push("ellipsis");
  items.push(pages);
  return items;
});

const footerReady = computed(
  () =>
    (datumState.value.status === "ready" && queryStatus.value === "ok" && (rows.value.length > 0 || (isTable.value && usesCursorPages.value)))
    || (loadingMore.value && rows.value.length > 0)
    || ((hasPreviousOnError.value || hasPreviousOnLoading.value) && rows.value.length > 0),
);
const footerHasTotal = computed(() => (loadingMore.value ? lastKnownHasTotal.value : effectiveHasTotal.value));
const footerTotal = computed<number | null>(() => (loadingMore.value ? lastKnownTotal.value : total.value));
const showFooterTotal = computed(() => footerHasTotal.value && footerTotal.value !== null && (
  footerReady.value
  || (datumState.value.status === "ready" && queryStatus.value === "ok")
  || (datumState.value.status === "empty" && isCompleteList.value)
));

const showPageSizeSelect = computed(() => {
  if (!footerReady.value || (props.pageSizes?.length ?? 0) === 0) return false;
  if (usesCursorPages.value) return Boolean(sizeParam && isWritableParam("size"));
  if (pageMode === "page") {
    return Boolean((pageParam && isWritableParam("page")) || (sizeParam && isWritableParam("size")));
  }
  return false;
});

const showPageControls = computed(
  () =>
    pageMode === "page"
    && footerReady.value
    && ((footerHasTotal.value && (footerTotal.value ?? 0) > effectivePageSize.value) || currentPage.value > 1),
);

const showPageJumperControl = computed(
  () => props.showPageJumper !== false && showPageControls.value && showNumericPages.value,
);

const jumperText = ref(String(currentPage.value));
watch(currentPage, (page) => {
  jumperText.value = String(page);
});

function commitPageJump() {
  const parsed = Math.trunc(Number(jumperText.value));
  if (Number.isFinite(parsed) && parsed >= 1) {
    const clamped = Math.min(totalPages.value, parsed);
    if (clamped !== currentPage.value) goPage(clamped);
  }
  jumperText.value = String(currentPage.value);
}

function rowDisplayIndex(rowIndex: number): number {
  if (pageMode === "page" || usesCursorPages.value) {
    return (currentPage.value - 1) * effectivePageSize.value + rowIndex + 1;
  }
  return rowIndex + 1;
}

const showRangeSummary = computed(
  () =>
    Boolean(props.showRangeBar)
    && rows.value.length > 0
    && (
      (datumState.value.status === "ready" && queryStatus.value === "ok")
      || hasPreviousOnError.value
      || hasPreviousOnLoading.value
      || loadingMore.value
    ),
);

const rangeSummaryText = computed(() => {
  const start = rowDisplayIndex(0);
  const end = start + rows.value.length - 1;
  if (footerHasTotal.value && footerTotal.value !== null) {
    return t("platform.listShowingRangeOfTotal", { start, end, total: footerTotal.value });
  }
  return t("platform.listShowingRange", { start, end });
});

const showCursorPageControls = computed(
  () => usesCursorPages.value && footerReady.value,
);

const showLoadMore = computed(
  () =>
    pageMode === "cursor"
    && !usesCursorPages.value
    && footerReady.value
    && (loadingMore.value || nextCursor.value !== undefined || currentPage.value > 1),
);

const showFooter = computed(
  () =>
    !isTabs.value
    && props.showFooter !== false
    && (showFooterTotal.value || showPageSizeSelect.value || showPageControls.value || showCursorPageControls.value || showLoadMore.value),
);

const showCheckRow = computed(
  () => canCheck && !isTable.value && !isTabs.value && (rows.value.length > 0 || checkedRefs.value.length > 0),
);

const showBuiltInColumnToggle = computed(() => Boolean(props.showColumnToggle) && isTable.value);
const showBuiltInExport = computed(() => Boolean(props.exportable));
const hasBuiltInToolbarActions = computed(() => showBuiltInColumnToggle.value || showBuiltInExport.value);

const showToolbar = computed(
  () =>
    canSearch.value
    || Boolean(slots.filters)
    || Boolean(slots["toolbar-actions"])
    || hasBuiltInToolbarActions.value
    || showCheckRow.value
    || (canCheck && checkedRefs.value.length > 0),
);

function hasRenderableVNodes(vnodes: readonly VNode[]): boolean {
  return vnodes.some((node) => {
    if (node.type === Comment) return false;
    if (node.type === Text) return String(node.children ?? "").trim() !== "";
    if (node.type === Fragment) {
      return Array.isArray(node.children) && hasRenderableVNodes(node.children as VNode[]);
    }
    return true;
  });
}

const showCreateRow = computed(() => {
  if (props.creatingRow === false) return false;
  const createSlot = slots["create-row"];
  if (!createSlot) return false;
  if (props.creatingRow === true) return true;
  return hasRenderableVNodes(createSlot());
});

const queryStatusLabel = computed(() => {
  if (queryStatus.value === "refused") return t("platform.graphStatusRefused");
  if (queryStatus.value === "failed") return t("platform.graphStatusFailed");
  if (queryStatus.value === "unavailable") return t("platform.graphStatusUnavailable");
  return "";
});

/**
 * Whether the reader narrowed the read: their search (server or local), a value the panel's state gives one of its
 * optional filter parameters, or any active local field filter. An empty answer to a narrowed list says nothing
 * matches and offers Clear filters, rather than saying there is nothing at all.
 */
const narrowed = computed(
  () =>
    ((hasServerSearch || isLocalSearchActive.value) && searchText.value !== "")
    || activeLocalFieldFilters.value.length > 0
    || nonPagingParamNames.some((name) => {
      if (name === "search" || isFixedLiteral(name) || requiredParamNames.has(name)) return false;
      const value = currentParams.value[name];
      const defaultValue = defaultFilterParamValue(name);
      if (defaultValue !== undefined && value === defaultValue) return false;
      return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
    }),
);

function clearFilters() {
  if ((hasServerSearch || isLocalSearchActive.value) && searchParam && isWritableParam("search") && searchParam.value.value !== null) {
    searchParam.set(null);
  }
  for (const { name, param } of clearableFilterParams) {
    const value = param.value.value;
    const defaultValue = defaultFilterParamValue(name);
    const resetValue = defaultValue !== undefined ? defaultValue : null;
    if (value !== resetValue && value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0)) {
      param.set(resetValue as never);
    }
  }
  for (const { param, writable } of localFilterParamEntries) {
    if (!writable) continue;
    const value = param.value.value;
    if (isLocalFilterValueActive(value)) {
      param.set(null);
    }
  }
  if (localFiltersInputParam && localFiltersInputParam.value.value !== null) {
    localFiltersInputParam.set(null);
  }
  resetPaging();
  emit("clear-filters");
}

const resolvedEmptyHint = computed(() => (props.emptyHint ? panel.t(props.emptyHint) : ""));

const listResult = computed<DataStateResult<readonly PlatformObjectRecord[]>>(() => {
  if (loadingMore.value && rows.value.length > 0) {
    return { status: "ready", value: rows.value };
  }
  if (hasPreviousOnError.value || hasPreviousOnLoading.value) {
    if (rows.value.length > 0) {
      return { status: "ready", value: rows.value };
    }
    return narrowed.value
      ? { status: "empty", narrowed: true, clearFilters }
      : { status: "empty", ...(resolvedEmptyHint.value ? { emptyHint: resolvedEmptyHint.value } : {}) };
  }
  const state = datumState.value;
  const empty = state.status === "empty" || (state.status === "ready" && rows.value.length === 0);
  if (empty) {
    return narrowed.value
      ? { status: "empty", narrowed: true, clearFilters }
      : { status: "empty", ...(resolvedEmptyHint.value ? { emptyHint: resolvedEmptyHint.value } : {}) };
  }
  if (state.status === "forbidden") {
    const reason = (state as { reason?: string }).reason;
    return reason ? { status: "forbidden", reason } : { status: "forbidden" };
  }
  if (state.status !== "ready") return state as DataStateResult<readonly PlatformObjectRecord[]>;
  return { status: "ready", value: rows.value };
});

const currentErrorMessage = computed<string | null>(() => {
  const state = datumState.value;
  if (state.status !== "error") return null;
  return state.message || t("platform.dataUnreachable");
});

function retryLoad() {
  const state = datumState.value;
  if (state.status === "error" && typeof state.retry === "function") {
    state.retry();
    return;
  }
  refreshDatum();
}

const listStateSnapshot = computed<ObjectListStateSnapshot>(() => {
  const state = datumState.value;
  const isLoading = state.status === "loading";
  const isRefreshing = (isLoading && (initialLoadDone || Boolean(state.previous) || rows.value.length > 0))
    || (state.status === "ready" && Boolean(state.refreshing));
  const resolvedTotal = footerTotal.value ?? total.value;
  return {
    page: currentPage.value,
    pageSize: effectivePageSize.value,
    total: resolvedTotal,
    totalPages: totalPages.value,
    count: rows.value.length,
    loading: isLoading,
    refreshing: isRefreshing,
    error: currentErrorMessage.value,
    retry: retryLoad,
  };
});

const dataStateLabels = useDataStateLabels(
  () => (props.emptyText ? panel.t(props.emptyText) : t("platform.dataEmpty")),
  () => resolvedEmptyHint.value || undefined,
  () => (props.noMatchText ? panel.t(props.noMatchText) : t("platform.dataNoMatch")),
);
const isStickyCheckBar = computed(() => !isTable.value && !isCards.value && !canSearch.value && canCheck);

const ownerFieldLabels = computed<Readonly<Record<string, string>>>(() => {
  const live = collectDynamicFieldLabels(mergedRows.value.length > 0 ? mergedRows.value : rows.value);
  if (Object.keys(lastDynamicFieldLabels.value).length === 0) return live;
  return { ...lastDynamicFieldLabels.value, ...live };
});

function columnLabel(column: ObjectListColumn): string {
  if (column.labelKey) return panel.t(column.labelKey);
  return ownerFieldLabels.value[column.key] ?? column.key;
}

const columnToggleItems = computed(() =>
  responsiveColumns.value.map((column) => ({ key: column.key, label: columnLabel(column) })),
);

const exportColumns = computed<readonly ObjectListColumn[]>(() => {
  if (visibleColumns.value.length > 0) return visibleColumns.value;
  return deriveDynamicColumns(rows.value);
});

const canExportCsv = computed(() => rows.value.length > 0 && exportColumns.value.length > 0);

function csvCellText(row: PlatformObjectRecord, column: ObjectListColumn): string {
  if (column.key === "primaryKey" && rawRecordField(row, column.key) === undefined) {
    return row.primaryKey;
  }
  const mappedLabel = columnMapped(row, column)?.label;
  if (mappedLabel) return mappedLabel;
  if (column.kind === "time") {
    const value = fieldValue(row, column.key);
    return value !== "" ? timeText(value, column.timeFormat) : "";
  }
  if (column.kind === "tags") {
    const items = recordFieldArrayItems(row, column.key);
    if (items.length > 0) {
      return items
        .map((item) =>
          isRecordReference(item)
            ? referenceDisplayLabel(item)
            : isRecordChildReference(item)
              ? childReferenceDisplayLabel(item)
              : resolveTagArrayItem(item, column).label,
        )
        .filter((part) => part.length > 0)
        .join(column.listSeparator ?? ", ");
    }
  }
  return columnText(row, column);
}

function exportCurrentPageCsv() {
  if (!canExportCsv.value) return;
  const cols = exportColumns.value;
  const headers = cols.map((column) => columnLabel(column));
  const dataRows = rows.value.map((row) => cols.map((column) => csvCellText(row, column)));
  const csv = buildCsvContent(headers, dataRows);
  savePanelFile({
    bytes: new TextEncoder().encode(csv),
    mime: "text/csv",
    suggestedName: resolveCsvFileName(props.exportFileName),
  });
}

function columnEmpty(column: ObjectListColumn): string {
  return column.emptyKey ? panel.t(column.emptyKey) : "—";
}

function setSelected(next: ObjectListSelection | null, source?: PanelStateChangeSource): PanelStateWriteResult {
  const writeOptions = source ? { source } : undefined;
  let applied: PanelStateWriteResult = true;
  if (placement.outputs?.selected) {
    applied = panel.instance.output(member.key, "selected", next as RuntimeJsonValue, writeOptions);
  } else if (hasSelectedBinding) {
    applied = selectedParam.set(next as RuntimeJsonValue, writeOptions);
  }
  const notifyUpdate = () => {
    if (hasSelectedBinding || hasUpdateSelectedListener) {
      emit("update:selected", next);
    }
  };
  if (applied === false) {
    return false;
  }
  if (applied && typeof applied !== "boolean") {
    return applied.then((ok) => {
      if (ok) notifyUpdate();
      return ok;
    });
  }
  notifyUpdate();
  return true;
}

function setChecked(next: readonly ObjectListRef[]) {
  if (placement.outputs?.checked) {
    void panel.instance.output(member.key, "checked", next as unknown as RuntimeJsonValue);
  } else if (isWritableParam("checked")) {
    checkedParam.set(next as unknown as RuntimeJsonValue);
  } else {
    return;
  }
  emit("update:checked", next);
}

function selectInitially(listed: readonly PlatformObjectRecord[]) {
  if (initialLoadDone) return;
  initialLoadDone = true;
  if (hasSelectedBinding && props.fallbackToFirst && chosenIdentity.value === null && listed.length > 0) {
    void setSelected(rowSelectionValue(listed[0]!), "auto");
  }
}

let lastListedSignature: string | null = null;
function publishListed(refs: readonly ObjectListRef[]) {
  const signature = JSON.stringify(refs);
  if (signature === lastListedSignature) return;
  lastListedSignature = signature;
  if (placement.outputs?.listed) {
    void panel.instance.output(member.key, "listed", refs as unknown as RuntimeJsonValue);
  }
  emit("update:listed", refs);
}

watch(
  datumState,
  (state) => {
    if (state.status === "loading" || (state.status === "ready" && state.refreshing)) return;
    if (state.status === "empty") {
      pendingScrollToTop = false;
      publishListed([]);
      selectInitially([]);
      return;
    }
    if (state.status !== "ready" || parsedData.value.status !== "ok") {
      publishListed([]);
      return;
    }
    const allLoaded = rawRows.value;
    if (isChildObjectSelection && selectedStateType?.kind === "child-object" && childSelectionParent.value) {
      panel.instance.nameChildObjects(childSelectionParent.value, selectedStateType.collection, allLoaded);
    } else {
      const byType = new Map<string, { primaryKey: string; label: string }[]>();
      for (const item of allLoaded) {
        const itemType = rowClassName(item);
        let bucket = byType.get(itemType);
        if (!bucket) {
          bucket = [];
          byType.set(itemType, bucket);
        }
        bucket.push(item);
      }
      for (const [itemType, items] of byType) panel.instance.nameObjects(itemType, items);
    }
    publishListed(listedRefs.value);
    selectInitially(rows.value);
    if (pendingScrollToTop) {
      pendingScrollToTop = false;
      scrollTop.value = 0;
      void nextTick(() => {
        if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = 0;
      });
    }
  },
  { immediate: true },
);

const localFilterSignature = computed(() => {
  if (pageMode !== "none") return "";
  return JSON.stringify([
    isLocalSearchActive.value ? searchText.value : null,
    localFilterParamEntries.map(({ key, param }) => [key, param.value.value ?? null]),
    localFiltersInputParam?.value.value ?? null,
    props.localFilters ?? null,
  ]);
});

if (hasSupplement) {
  watch(listedRefs, (refs) => {
    if (datumState.value.status === "ready" && parsedData.value.status === "ok") {
      publishListed(refs);
    }
  });
}

if (pageMode === "none") {
  watch(
    localFilterSignature,
    (next, prev) => {
      if (next === prev || !initialLoadDone) return;
      if (datumState.value.status !== "ready" || parsedData.value.status !== "ok") return;
      scrollTop.value = 0;
      if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = 0;
      publishListed(listedRefs.value);
    },
    { flush: "sync" },
  );
}

function onSearchInput(event: Event) {
  if (!searchParam || !isWritableParam("search")) return;
  const next = (event.target as HTMLInputElement).value;
  searchParam.set(next === "" ? null : next);
}

function goPage(nextPage: number) {
  if (nextPage < 1 || nextPage === currentPage.value) return;
  if (pageMode === "page" && pageParam) {
    if (effectiveHasTotal.value && nextPage > totalPages.value) return;
    pendingScrollToTop = true;
    currentPage.value = nextPage;
    pageParam.set({ number: nextPage, size: effectivePageSize.value });
  }
}

const searchPlaceholderText = computed(() =>
  props.searchPlaceholder ? panel.t(props.searchPlaceholder) : t("platform.listSearchPlaceholder"),
);
const tablePreservesEmpty = computed(
  () => isTable.value && visibleColumns.value.length > 0 && listResult.value.status === "empty",
);
const tableDataResult = computed<DataStateResult<readonly PlatformObjectRecord[]>>(() =>
  tablePreservesEmpty.value ? { status: "ready", value: [] } : listResult.value,
);

function loadMore() {
  if (pageMode !== "cursor" || !cursorParam || nextCursor.value === undefined || loadingMore.value) return;
  const targetCursor = nextCursor.value;
  pendingAppendCursor = targetCursor;
  loadingMore.value = true;
  currentPage.value += 1;
  cursorParam.set(targetCursor);
}

function goCursorNext() {
  if (!usesCursorPages.value || !cursorParam || nextCursor.value === undefined) return;
  const targetCursor = nextCursor.value;
  pendingScrollToTop = true;
  cursorStack.value = [...cursorStack.value, targetCursor];
  currentPage.value = cursorStack.value.length;
  cursorParam.set(targetCursor);
}

function goCursorPrev() {
  if (!usesCursorPages.value || !cursorParam || cursorStack.value.length <= 1) return;
  const nextStack = cursorStack.value.slice(0, -1);
  pendingScrollToTop = true;
  cursorStack.value = nextStack;
  currentPage.value = nextStack.length;
  cursorParam.set(nextStack[nextStack.length - 1] ?? null);
}

function onPageSizeChange(nextValue: number | string) {
  const next = Number(nextValue);
  if (!Number.isFinite(next) || next <= 0 || next === activePageSize.value) return;
  activePageSize.value = next;
  pendingScrollToTop = true;
  cursorStack.value = [null];
  cursorBatches.value = [];
  currentPage.value = 1;
  if (pageMode === "cursor") {
    cursorParam?.set(null);
    sizeParam?.set(next);
  } else if (pageMode === "page") {
    if (pageParam && isWritableParam("page")) pageParam.set({ number: 1, size: next });
    if (sizeParam && isWritableParam("size")) sizeParam.set(next);
  }
}

const rowElements = new Map<string, HTMLElement>();
function setRowElement(key: string, element: unknown) {
  if (element instanceof HTMLElement) {
    rowElements.set(key, element);
    if (element.offsetHeight > 0) recordMeasuredHeight(measuredHeights, key, element.offsetHeight);
  } else {
    rowElements.delete(key);
  }
}

function setGroupHeaderElement(key: string, element: unknown) {
  if (element instanceof HTMLElement && element.offsetHeight > 0) {
    recordMeasuredHeight(measuredHeights, key, element.offsetHeight);
  }
}

/** Grouping (`groupBy`) over the already-filtered rows, with collapsible headers and real-time filtered counts. */
const isGrouped = computed(() => Boolean(props.groupBy && props.groupBy.trim() !== ""));
const collapsedGroups = ref<ReadonlySet<string>>(new Set());
function toggleGroupCollapsed(groupKey: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(groupKey)) next.delete(groupKey);
  else next.add(groupKey);
  collapsedGroups.value = next;
}
watch(() => props.groupBy, () => {
  collapsedGroups.value = new Set();
});

const resolvedGroupEmptyLabel = computed(() => (props.groupEmptyLabel ? panel.t(props.groupEmptyLabel) : "—"));
const groups = computed<readonly ObjectListGroup[]>(() =>
  isGrouped.value
    ? buildObjectListGroups(
        rows.value,
        props.groupBy!.trim(),
        activeType.value ?? rowObjectType,
        locale.value,
        t,
        resolvedGroupEmptyLabel.value,
      )
    : [],
);

const rowGroupKeyByIdentity = computed(() => {
  const map = new Map<string, string>();
  if (!isGrouped.value) return map;
  for (const group of groups.value) {
    for (const row of group.rows) {
      map.set(rowIdentityKey(row), group.key);
    }
  }
  return map;
});

const flatItems = computed<readonly FlatListItem[]>(() => {
  if (!isGrouped.value) {
    return rows.value.map((row, rowIndex) => ({
      kind: "row" as const,
      key: rowIdentityKey(row),
      row,
      rowIndex,
    }));
  }
  const items: FlatListItem[] = [];
  let rowIndex = 0;
  for (const group of groups.value) {
    const collapsed = collapsedGroups.value.has(group.key);
    items.push({
      kind: "group",
      key: `group\u0000${group.key}`,
      groupKey: group.key,
      label: group.label,
      count: group.count,
      collapsed,
    });
    if (collapsed) continue;
    for (const row of group.rows) {
      items.push({
        kind: "row",
        key: rowIdentityKey(row),
        row,
        rowIndex,
      });
      rowIndex += 1;
    }
  }
  return items;
});

const navigableRows = computed<readonly PlatformObjectRecord[]>(() =>
  flatItems.value
    .filter((item): item is Extract<FlatListItem, { kind: "row" }> => item.kind === "row")
    .map((item) => item.row),
);

/** Windowed rendering for large unpaged lists (> VIRTUAL_ROW_THRESHOLD items). */
const isVirtualized = computed(() => pageMode === "none" && flatItems.value.length > VIRTUAL_ROW_THRESHOLD);

watch([effectiveLayout, () => props.groupBy], () => {
  measuredHeights.clear();
  measuredDetailHeights.clear();
  measureTick.value += 1;
});

function estimatedItemHeight(item: FlatListItem): number {
  if (item.kind === "group") {
    return measuredHeights.get(item.key) ?? 32;
  }
  const baseDefault = isCards.value ? 160 : isTable.value ? 40 : (listHasTwoLines.value ? 64 : 48);
  const measured = measuredHeights.get(item.key);
  const expanded = isRowExpanded(item.row);
  if (isTable.value) {
    const rowHeight = measured ?? baseDefault;
    return expanded ? rowHeight + (measuredDetailHeights.get(item.key) ?? 200) : rowHeight;
  }
  if (measured !== undefined) return measured;
  return expanded ? baseDefault + 200 : baseDefault;
}

const flatHeights = computed<readonly number[]>(() => {
  void measureTick.value;
  return flatItems.value.map(estimatedItemHeight);
});

const linearVirtual = computed(() =>
  isVirtualized.value && !isCards.value
    ? computeVirtualWindow(flatHeights.value, scrollTop.value, viewportHeight.value, VIRTUAL_OVERSCAN)
    : null,
);

const cardsColumns = computed(() =>
  containerWidth.value > 0 ? Math.max(1, Math.floor((containerWidth.value + 12) / (256 + 12))) : 1,
);

const cardVirtual = computed(() => {
  if (!isVirtualized.value || !isCards.value) return null;
  const bands = buildVirtualGridBands(
    flatItems.value.map((item) => item.kind),
    flatHeights.value,
    cardsColumns.value,
  );
  const window = computeVirtualWindow(
    bands.map((band) => band.height),
    scrollTop.value,
    viewportHeight.value,
    VIRTUAL_OVERSCAN,
  );
  const startItemIndex = bands[window.startIndex]?.startItemIndex ?? 0;
  const endItemIndex = window.endIndex > 0 ? (bands[window.endIndex - 1]?.endItemIndex ?? flatItems.value.length) : 0;
  return { bands, window, startItemIndex, endItemIndex };
});

const renderedItems = computed<readonly FlatListItem[]>(() => {
  if (!isVirtualized.value) return flatItems.value;
  if (cardVirtual.value) {
    return flatItems.value.slice(cardVirtual.value.startItemIndex, cardVirtual.value.endItemIndex);
  }
  if (linearVirtual.value) {
    return flatItems.value.slice(linearVirtual.value.startIndex, linearVirtual.value.endIndex);
  }
  return flatItems.value;
});

const virtualTopPadding = computed(() =>
  cardVirtual.value?.window.topPadding ?? linearVirtual.value?.topPadding ?? 0,
);
const virtualBottomPadding = computed(() =>
  cardVirtual.value?.window.bottomPadding ?? linearVirtual.value?.bottomPadding ?? 0,
);

function ensureRowInVirtualWindow(identity: string): boolean {
  if (!isVirtualized.value) return false;
  const itemIndex = flatItems.value.findIndex((item) => item.kind === "row" && item.key === identity);
  if (itemIndex < 0) return false;

  let targetScrollTop = scrollTop.value;
  let alreadyRendered = false;
  if (cardVirtual.value) {
    alreadyRendered = itemIndex >= cardVirtual.value.startItemIndex && itemIndex < cardVirtual.value.endItemIndex;
    const bandIndex = cardVirtual.value.bands.findIndex(
      (band) => itemIndex >= band.startItemIndex && itemIndex < band.endItemIndex,
    );
    if (bandIndex >= 0) {
      targetScrollTop = computeScrollTopForIndex(
        cardVirtual.value.window.offsets,
        bandIndex,
        scrollTop.value,
        viewportHeight.value,
      );
    }
  } else if (linearVirtual.value) {
    alreadyRendered = itemIndex >= linearVirtual.value.startIndex && itemIndex < linearVirtual.value.endIndex;
    targetScrollTop = computeScrollTopForIndex(
      linearVirtual.value.offsets,
      itemIndex,
      scrollTop.value,
      viewportHeight.value,
    );
  }

  if (targetScrollTop !== scrollTop.value || !alreadyRendered) {
    scrollTop.value = targetScrollTop;
    if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = targetScrollTop;
    return true;
  }
  return false;
}

let lastScrolledIdentity: string | null = null;
watch(
  [chosenIdentity, rows],
  ([identity, listed]) => {
    if (!identity) {
      lastScrolledIdentity = null;
      return;
    }
    if (identity === lastScrolledIdentity) return;
    if (!listed.some((row) => rowIdentityKey(row) === identity)) return;
    lastScrolledIdentity = identity;

    // Auto-expand the containing group if the selected item is inside a collapsed group.
    const containingGroup = rowGroupKeyByIdentity.value.get(identity);
    if (containingGroup !== undefined && collapsedGroups.value.has(containingGroup)) {
      const next = new Set(collapsedGroups.value);
      next.delete(containingGroup);
      collapsedGroups.value = next;
    }

    const jumped = ensureRowInVirtualWindow(identity);
    void nextTick(() => {
      if (jumped) {
        ensureRowInVirtualWindow(identity);
        if (scrollContainerRef.value && scrollContainerRef.value.scrollTop !== scrollTop.value) {
          scrollContainerRef.value.scrollTop = scrollTop.value;
        }
      }
      const target = rowElements.get(identity);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest" });
      }
    });
  },
  { immediate: true },
);

const scrolledExpandedKeys = new Set<string>();
watch(
  [expandedKeyList, rows],
  ([keys, listed]) => {
    const activeKeySet = new Set(keys);
    for (const seen of [...scrolledExpandedKeys]) {
      if (!activeKeySet.has(seen)) scrolledExpandedKeys.delete(seen);
    }
    let targetRow: PlatformObjectRecord | undefined;
    let targetKey: string | undefined;
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index]!;
      if (scrolledExpandedKeys.has(key)) continue;
      const matched = listed.find((row) => rowExpandAliases(row).includes(key));
      if (matched) {
        targetRow = matched;
        targetKey = key;
        break;
      }
    }
    if (!targetRow || !targetKey) return;
    scrolledExpandedKeys.add(targetKey);
    const identity = rowIdentityKey(targetRow);
    const containingGroup = rowGroupKeyByIdentity.value.get(identity);
    if (containingGroup !== undefined && collapsedGroups.value.has(containingGroup)) {
      const next = new Set(collapsedGroups.value);
      next.delete(containingGroup);
      collapsedGroups.value = next;
    }
    ensureRowInVirtualWindow(identity);
    void nextTick(() => {
      const target = detailElements.get(identity) ?? rowElements.get(identity);
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest" });
      }
    });
  },
  { immediate: true },
);

watch(rows, (listed) => {
  if (hasControlledExpandedKeys.value) return;
  if (datumState.value.status === "loading" || internalExpandedKeys.value.length === 0) return;
  const present = new Set<string>();
  for (const row of listed) {
    for (const alias of rowExpandAliases(row)) present.add(alias);
  }
  const next = internalExpandedKeys.value.filter((key) => present.has(key));
  if (next.length !== internalExpandedKeys.value.length) {
    internalExpandedKeys.value = next;
  }
});

const activeRowLabel = ref<string | null>(null);

// When external or agent state changes `selected`, discard any stale human-click label so `activeLabel` stays in sync.
watch(chosenIdentity, () => {
  activeRowLabel.value = null;
});

function rowOpenPath(row: PlatformObjectRecord): string | null {
  if (!props.openOutput) return null;
  const value = row.outputs?.[props.openOutput];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

const showLeadingIcon = computed(() => Boolean(props.leadingIconField));

function rowLeadingIcon(row: PlatformObjectRecord): string | null {
  const field = props.leadingIconField;
  if (!field) return null;
  const raw = rawRecordField(row, field);
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function resolvedLeadingIconSize(): number {
  if (typeof props.leadingIconSize === "number" && Number.isFinite(props.leadingIconSize) && props.leadingIconSize > 0) {
    return props.leadingIconSize;
  }
  return 16;
}

function cardDescription(row: PlatformObjectRecord): string {
  return fieldValue(row, summaryKey.value);
}

function cardTooltip(row: PlatformObjectRecord): string {
  const description = cardDescription(row);
  return description ? `${row.label}\n${description}` : row.label;
}

function accordionSubtitleText(row: PlatformObjectRecord): string {
  const title = row.label || row.primaryKey;
  const candidate = props.subtitleField
    ? (props.subtitleField === "primaryKey" ? row.primaryKey : fieldValue(row, props.subtitleField))
    : (row.subtitle ?? "");
  return candidate && candidate !== title ? candidate : "";
}

function formatAccordionFieldValue(rawField: unknown): { readonly text: string; readonly isPre: boolean } {
  const raw =
    rawField !== null &&
    typeof rawField === "object" &&
    !Array.isArray(rawField) &&
    (rawField as { kind?: unknown }).kind === "json" &&
    "value" in rawField
      ? (rawField as { value: unknown }).value
      : rawField;
  if (raw === undefined || raw === null || raw === "") {
    return { text: "", isPre: false };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { text: "", isPre: false };
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isPre: true };
      } catch {
        return { text: raw, isPre: raw.includes("\n") };
      }
    }
    return { text: raw, isPre: raw.includes("\n") };
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return { text: scalarFieldText(raw, t), isPre: false };
  }
  if (typeof raw === "object") {
    const fieldVal = raw as PlatformObjectRecord["fields"][string];
    if (isRecordReference(fieldVal)) return { text: referenceDisplayLabel(fieldVal), isPre: false };
    if (isRecordChildReference(fieldVal)) return { text: childReferenceDisplayLabel(fieldVal), isPre: false };
    try {
      return { text: JSON.stringify(raw, null, 2), isPre: true };
    } catch {
      return { text: String(raw), isPre: false };
    }
  }
  return { text: String(raw), isPre: false };
}

interface AccordionBodyField {
  readonly key: string;
  readonly label: string;
  readonly text: string;
  readonly isPre: boolean;
}

function accordionBodyFields(row: PlatformObjectRecord): readonly AccordionBodyField[] {
  const entries: AccordionBodyField[] = [];
  if (visibleColumns.value.length > 0) {
    for (const column of visibleColumns.value) {
      const derived = resolveResultFromCell(row, column);
      const formatted = derived
        ? { text: columnText(row, column), isPre: false }
        : formatAccordionFieldValue(rawRecordField(row, column.key));
      if (!formatted.text) continue;
      const label = column.labelKey
        ? panel.t(column.labelKey)
        : column.key === "description"
          ? ""
          : (row.fieldLabels?.[column.key] ?? ownerFieldLabels.value[column.key] ?? column.key);
      entries.push({ key: column.key, label, text: formatted.text, isPre: formatted.isPre });
    }
    return entries;
  }
  for (const [key, rawField] of Object.entries(row.fields ?? {})) {
    if (props.subtitleField && key === props.subtitleField) continue;
    const formatted = formatAccordionFieldValue(rawField);
    if (!formatted.text) continue;
    const explicitLabel = row.fieldLabels?.[key];
    const label = key === "description" && !explicitLabel ? "" : (explicitLabel ?? key);
    entries.push({ key, label, text: formatted.text, isPre: formatted.isPre });
  }
  return entries;
}

function choose(row: PlatformObjectRecord) {
  const openTarget = rowOpenPath(row);
  if (openTarget) {
    highlightedIdentity.value = rowIdentityKey(row);
    void panel.navigate(openTarget);
  }
  if (!rowSelectable) {
    if (!openTarget) highlightedIdentity.value = rowIdentityKey(row);
    return;
  }
  const identity = rowIdentityKey(row);
  const next = props.toggleable && chosenIdentity.value === identity
    ? null
    : rowSelectionValue(row);
  const finish = () => {
    highlightedIdentity.value = identity;
    if (hasChooseListener) {
      activeRowLabel.value = next ? (row.label || row.primaryKey) : null;
      emit("choose", next);
    }
  };
  if (hasSelectedBinding || hasUpdateSelectedListener) {
    const applied = setSelected(next);
    if (applied === true) finish();
    else if (applied !== false) void applied.then((ok) => { if (ok) finish(); });
  } else {
    finish();
  }
}

function isPinnedPrimaryColumn(columnIndex: number): boolean {
  return Boolean(props.pinPrimaryColumn) && columnIndex === 0;
}

function onTableRowClick(row: PlatformObjectRecord, event?: MouseEvent) {
  if (props.rowActivation === "expand") {
    if (isRowExpandActivation.value) {
      if (event && isInteractiveRowClickTarget(event.target, event.currentTarget)) return;
      toggleRowExpanded(row);
    }
    return;
  }
  if (props.rowActivation === "dblclick") {
    highlightedIdentity.value = rowIdentityKey(row);
    return;
  }
  if (rowActivatable.value) choose(row);
}

function onTableRowDblclick(row: PlatformObjectRecord) {
  if (props.rowActivation !== "dblclick") return;
  if (rowActivatable.value) choose(row);
}

function onCardClick(row: PlatformObjectRecord, event: MouseEvent) {
  if (props.rowActivation === "expand" && isRowExpandActivation.value) {
    if (isInteractiveRowClickTarget(event.target, event.currentTarget)) return;
    toggleRowExpanded(row);
    return;
  }
  if (rowActivatable.value) choose(row);
}

function onListItemClick(row: PlatformObjectRecord, event: MouseEvent) {
  if (props.rowActivation === "expand" && isRowExpandActivation.value) {
    if (isInteractiveRowClickTarget(event.target, event.currentTarget)) return;
    toggleRowExpanded(row);
    return;
  }
  if (rowSelectable) choose(row);
}

function focusRowByIdentity(identity: string, mode: "table" | "cards" | "list") {
  const scrolled = ensureRowInVirtualWindow(identity);
  const focusNow = () => {
    const rowEl = rowElements.get(identity);
    if (!rowEl) return false;
    const focusable = mode === "list"
      ? rowEl.querySelector<HTMLElement>(".sdk-object-list-item-btn") ?? rowEl
      : rowEl;
    focusable.focus();
    return true;
  };
  if (!scrolled && focusNow()) return;
  void nextTick(() => {
    focusNow();
  });
}

function navigateRowFocus(
  row: PlatformObjectRecord,
  event: KeyboardEvent,
  mode: "table" | "cards" | "list",
): boolean {
  const list = navigableRows.value;
  if (list.length === 0) return false;
  const identity = rowIdentityKey(row);
  const index = list.findIndex((item) => rowIdentityKey(item) === identity);
  if (index < 0) return false;

  let nextIndex = -1;
  if (event.key === "ArrowDown" || (mode === "cards" && event.key === "ArrowRight")) {
    if (index + 1 < list.length) nextIndex = index + 1;
  } else if (event.key === "ArrowUp" || (mode === "cards" && event.key === "ArrowLeft")) {
    if (index - 1 >= 0) nextIndex = index - 1;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = list.length - 1;
  }
  if (nextIndex < 0) return false;
  event.preventDefault();
  focusRowByIdentity(rowIdentityKey(list[nextIndex]!), mode);
  return true;
}

/**
 * Keyboard activation and row-to-row focus movement for table rows: only handles keys when the row itself holds
 * focus so checkboxes, reference links and other interactive controls inside a cell keep their own keys.
 */
function onRowKeydown(row: PlatformObjectRecord, event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    if (props.rowActivation === "expand") {
      if (!isRowExpandActivation.value) return;
      event.preventDefault();
      toggleRowExpanded(row);
      return;
    }
    if (!rowSelectable) return;
    event.preventDefault();
    choose(row);
    return;
  }
  navigateRowFocus(row, event, "table");
}

/** Keyboard activation and neighbour focus movement for cards without colliding with inner checkboxes or reference links. */
function onCardKeydown(row: PlatformObjectRecord, event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    if (props.rowActivation === "expand" && isRowExpandActivation.value) {
      event.preventDefault();
      toggleRowExpanded(row);
      return;
    }
    if (!rowActivatable.value) return;
    event.preventDefault();
    choose(row);
    return;
  }
  navigateRowFocus(row, event, "cards");
}

/** Keyboard focus movement for compact list items, supporting grouped and virtualized lists smoothly. */
function onListItemKeydown(row: PlatformObjectRecord, event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (
    props.rowActivation === "expand"
    && isRowExpandActivation.value
    && (event.key === "Enter" || event.key === " " || event.key === "Spacebar")
  ) {
    event.preventDefault();
    toggleRowExpanded(row);
    return;
  }
  navigateRowFocus(row, event, "list");
}

function toggleChecked(row: PlatformObjectRecord, checked: boolean) {
  const identity = rowCheckKey(row);
  if (checked) {
    if (isRowCheckDisabled(row)) return;
    if (checkedIdentityKeys.value.has(identity)) return;
    setChecked([...checkedRefs.value, rowObjectRef(row)]);
  } else {
    setChecked(checkedRefs.value.filter((item) => refKey(item) !== identity));
  }
}

function toggleAllVisible(checked: boolean) {
  const selectable = selectableVisibleRows.value;
  const selectableKeys = new Set(selectable.map(rowCheckKey));
  if (checked) {
    const added = selectable
      .filter((row) => !checkedIdentityKeys.value.has(rowCheckKey(row)))
      .map(rowObjectRef);
    setChecked([...checkedRefs.value, ...added]);
  } else {
    setChecked(checkedRefs.value.filter((item) => !selectableKeys.has(refKey(item))));
  }
}

function clearChecked() {
  setChecked([]);
}

function navigateTo(reference: PlatformFieldReference, columnKey: string) {
  const output = placement.outputs?.[columnKey] ? columnKey : "navigate";
  void panel.instance.output(member.key, output, { className: reference.className, primaryKey: reference.primaryKey });
  emit("navigate", reference, columnKey);
}

function navigateToChild(reference: PlatformChildFieldReference, columnKey: string) {
  emit("navigate-child", {
    parent: reference.parent,
    collection: reference.collection,
    primaryKey: reference.primaryKey,
    label: reference.label,
  }, columnKey);
}

/** The field each compact item's summary line shows: the one configured, else the owner's own subtitle. */
const summaryKey = computed(() => props.subtitleField ?? "subtitle");

function rowHasSecondLine(row: PlatformObjectRecord): boolean {
  return fieldValue(row, summaryKey.value) !== ""
    || Boolean(effectiveMetaField.value && fieldValue(row, effectiveMetaField.value) !== "")
    || Boolean(props.tagsField && recordFieldArrayItems(row, props.tagsField).length > 0);
}

const listHasTwoLines = computed(() =>
  Boolean(props.subtitleField || effectiveMetaField.value || props.tagsField)
  || rows.value.some(rowHasSecondLine),
);

function fieldValue(row: PlatformObjectRecord, key: string): string {
  return displayFieldText(rawRecordField(row, key), locale.value, t);
}

function referenceField(row: PlatformObjectRecord, key: string): PanelRecordReferenceFieldValue | null {
  const raw = rawRecordField(row, key);
  return isRecordReference(raw) ? raw : null;
}

function childReferenceField(row: PlatformObjectRecord, key: string): PanelRecordChildReferenceFieldValue | null {
  const raw = rawRecordField(row, key);
  return isRecordChildReference(raw) ? raw : null;
}

function arrayHasChildReference(row: PlatformObjectRecord, key: string): boolean {
  const raw = rawRecordField(row, key);
  return Array.isArray(raw) && raw.some((item) => isRecordChildReference(item));
}

function usesTypedValueCell(row: PlatformObjectRecord, column: ObjectListColumn): boolean {
  if (resolveResultFromCell(row, column)) return false;
  if (column.kind !== "text" && childReferenceField(row, column.key)) return true;
  const raw = rawRecordField(row, column.key);
  if (Array.isArray(raw)) {
    return column.listSeparator !== undefined
      || column.listStyle !== undefined
      || arrayHasChildReference(row, column.key);
  }
  return false;
}

function highlightRangesFor(row: PlatformObjectRecord, key: string, text: string): readonly TextHighlightRange[] | undefined {
  const ownerRanges = row.highlights?.[key];
  if (ownerRanges?.length) return ownerRanges;
  if (normalizedLocalQuery.value !== "") {
    const localRanges = findLocalHighlightRanges(text, normalizedLocalQuery.value);
    if (localRanges.length > 0) return localRanges;
  }
  return undefined;
}

function textSegmentsFor(row: PlatformObjectRecord, key: string, text: string) {
  return textHighlightSegments(text, highlightRangesFor(row, key, text));
}

function cellSegments(row: PlatformObjectRecord, key: string, empty = "—") {
  const text = fieldValue(row, key);
  if (text === "") return [{ text: empty, hit: false }];
  return textSegmentsFor(row, key, text);
}

function subtitleSegments(row: PlatformObjectRecord, column: ObjectListColumn) {
  if (!column.subtitleKey) return [];
  const text = fieldValue(row, column.subtitleKey);
  if (text !== "") return textSegmentsFor(row, column.subtitleKey, text);
  return column.subtitleEmptyKey ? [{ text: panel.t(column.subtitleEmptyKey), hit: false }] : [];
}

const VALID_RESULT_TONES = new Set<string>(["default", "info", "success", "warning", "danger"]);

function normalizeResultTone(value: unknown): string | undefined {
  return typeof value === "string" && VALID_RESULT_TONES.has(value) ? value : undefined;
}

function readDotPath(root: unknown, path: string): unknown {
  if (root === null || root === undefined || typeof root !== "object") return undefined;
  if (!Array.isArray(root) && Object.hasOwn(root, path)) {
    return (root as Record<string, unknown>)[path];
  }
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function formatResultScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface ResolvedResultFromCell {
  readonly rawValue: unknown;
  readonly text: string;
  readonly tone?: string;
  readonly running?: boolean;
  readonly isError?: boolean;
  readonly hasExplicitLabel?: boolean;
  readonly hasExplicitTone?: boolean;
}

function resolveResultFromCell(row: PlatformObjectRecord, column: ObjectListColumn): ResolvedResultFromCell | null {
  const source = column.resultFrom;
  if (!source) return null;
  const opState = rowResultsFor(row)[source.operation];
  if (!opState) return null;
  if (opState.running) {
    return {
      rawValue: null,
      text: t("platform.readerLoading"),
      tone: "info",
      running: true,
      hasExplicitLabel: true,
      hasExplicitTone: true,
    };
  }
  if (opState.error) {
    return {
      rawValue: opState.error,
      text: opState.error,
      tone: "danger",
      isError: true,
      hasExplicitLabel: true,
      hasExplicitTone: true,
    };
  }
  if (opState.receipt && !(opState.receipt.kind === "dispatched" && opState.receipt.outcome?.kind === "success")) {
    const message = opState.receipt.kind === "not-dispatched"
      ? opState.receipt.message
      : opState.receipt.outcome && opState.receipt.outcome.kind !== "batch"
        ? saidRowOp(opState.receipt.outcome)
        : t("platform.operationUnknown", { message: "" });
    return {
      rawValue: message,
      text: message,
      tone: "danger",
      isError: true,
      hasExplicitLabel: true,
      hasExplicitTone: true,
    };
  }
  if (opState.result) {
    const res = opState.result;
    if (res.kind === "json") {
      const rawField = source.field ? readDotPath(res.value, source.field) : res.value;
      let text = "";
      let rawValue: unknown = rawField;
      let explicitTone: string | undefined;
      let hasExplicitLabel = false;
      if (
        rawField !== null
        && typeof rawField === "object"
        && !Array.isArray(rawField)
        && ("label" in rawField || "text" in rawField || "tone" in rawField || "value" in rawField)
      ) {
        const obj = rawField as { label?: unknown; text?: unknown; value?: unknown; tone?: unknown };
        explicitTone = normalizeResultTone(obj.tone);
        if ("value" in obj && obj.value !== undefined) {
          rawValue = obj.value;
        }
        if (typeof obj.label === "string" && obj.label !== "") {
          text = obj.label;
          hasExplicitLabel = true;
        } else if (typeof obj.text === "string" && obj.text !== "") {
          text = obj.text;
          hasExplicitLabel = true;
        } else if (obj.value !== undefined) {
          text = formatResultScalar(obj.value);
        }
      } else if (rawField !== undefined && rawField !== null) {
        text = formatResultScalar(rawField);
      } else if (typeof res.message === "string" && res.message !== "") {
        text = res.message;
        rawValue = res.message;
        hasExplicitLabel = true;
      }
      return {
        rawValue,
        text,
        tone: explicitTone,
        hasExplicitLabel,
        hasExplicitTone: explicitTone !== undefined,
      };
    }
    if (res.kind === "markdown") {
      return { rawValue: res.markdown, text: res.markdown, hasExplicitLabel: true };
    }
    if (res.kind === "file") {
      return { rawValue: res.name, text: res.name, hasExplicitLabel: true };
    }
  }
  return null;
}

const resultFromOperations = computed<ReadonlySet<string>>(() => {
  const names = new Set<string>();
  for (const col of allColumns.value) {
    if (col.resultFrom?.operation) names.add(col.resultFrom.operation);
  }
  return names;
});

function columnMapped(row: PlatformObjectRecord, column: ObjectListColumn): ResolvedValueMapEntry | null {
  if (!column.valueMap) return null;
  const derived = resolveResultFromCell(row, column);
  if (derived) {
    if (derived.running || derived.isError) return null;
    return resolveValueMapEntry(derived.rawValue, column.valueMap, {
      locale: locale.value,
      panelText: panel.t,
      t,
      te,
    });
  }
  return resolveValueMapEntry(rawRecordField(row, column.key), column.valueMap, {
    locale: locale.value,
    panelText: panel.t,
    t,
    te,
  });
}

interface ResolvedTagArrayItem {
  readonly label: string;
  readonly tone: PanelFieldTone;
  readonly icon?: string;
}

/**
 * Resolve display text, semantic tone, and optional platform icon for one non-reference item inside a tag array.
 * Tag tones travel on the value itself (`kind: "tag"`) — never via `column.valueMap` or `row.tones`.
 */
function resolveTagArrayItem(
  item: Exclude<PanelRecordFieldArrayItem, PanelRecordReferenceFieldValue | PanelRecordChildReferenceFieldValue>,
  column?: ObjectListColumn,
): ResolvedTagArrayItem {
  if (isRecordTag(item)) {
    return {
      label: item.label,
      tone: item.tone ?? "info",
      icon: item.icon,
    };
  }
  if (column?.valueMap) {
    const mapped = resolveValueMapEntry(item, column.valueMap, {
      locale: locale.value,
      panelText: panel.t,
      t,
      te,
    });
    if (mapped) {
      return {
        label: mapped.label ?? scalarFieldText(item, t),
        tone: "info",
        icon: mapped.icon,
      };
    }
  }
  return {
    label: scalarFieldText(item, t),
    tone: "info",
  };
}

function recordTagField(row: PlatformObjectRecord, key: string): PanelRecordTagFieldValue | null {
  const raw = rawRecordField(row, key);
  return isRecordTag(raw) ? raw : null;
}

function statusFieldTone(row: PlatformObjectRecord, field: string): string {
  const tag = recordTagField(row, field);
  if (tag) return tag.tone ?? "default";
  return row.tones?.[field] ?? "default";
}

function columnIsTag(row: PlatformObjectRecord, column: ObjectListColumn): boolean {
  const derived = resolveResultFromCell(row, column);
  if (derived) {
    const mapped = columnMapped(row, column);
    if (derived.text === "" && !mapped?.label) return false;
    return column.kind === "tag" || Boolean(derived.tone);
  }
  if (fieldValue(row, column.key) === "") return false;
  if (column.kind !== "text") {
    if (recordTagField(row, column.key)) return true;
    const ownerTone = row.tones?.[column.key];
    if (ownerTone && ownerTone !== "default") return true;
  }
  return column.kind === "tag";
}

function columnTone(row: PlatformObjectRecord, column: ObjectListColumn): string {
  const derived = resolveResultFromCell(row, column);
  if (derived) {
    if (derived.hasExplicitTone && derived.tone) return derived.tone;
    return derived.tone ?? "default";
  }
  const tag = recordTagField(row, column.key);
  if (tag) return tag.tone ?? "default";
  return row.tones?.[column.key] ?? "default";
}

function columnTagIcon(row: PlatformObjectRecord, column: ObjectListColumn): string | undefined {
  const tag = recordTagField(row, column.key);
  if (tag?.icon) return tag.icon;
  return columnMapped(row, column)?.icon;
}

function columnIconName(row: PlatformObjectRecord, column: ObjectListColumn): string | undefined {
  const mappedIcon = columnMapped(row, column)?.icon;
  if (mappedIcon) return mappedIcon;
  if (column.iconKey) {
    const rawIcon = fieldValue(row, column.iconKey);
    if (rawIcon) return rawIcon;
  }
  return undefined;
}

function columnCellSegments(row: PlatformObjectRecord, column: ObjectListColumn) {
  const derived = resolveResultFromCell(row, column);
  if (derived) {
    const display = derived.hasExplicitLabel
      ? derived.text
      : (columnMapped(row, column)?.label ?? derived.text);
    return [{ text: display || columnEmpty(column), hit: false }];
  }
  const mappedLabel = columnMapped(row, column)?.label;
  if (mappedLabel) return textSegmentsFor(row, column.key, mappedLabel);
  return cellSegments(row, column.key, columnEmpty(column));
}

function selectAllCheckboxRef(element: unknown) {
  if (element instanceof HTMLInputElement) element.indeterminate = someVisibleChecked.value;
}

watch(someVisibleChecked, () => {
  // Keeps indeterminate synced through the function ref above on reactive updates.
});

// --- Batch per-row operations availability, built-in action column & row operation runner ---

const memberOperationsState = useMemberOperations();
const admittedOpMap = computed(() => admittedOperations(memberOperationsState.value));

const rowOperationResults = ref<Readonly<Record<string, Readonly<Record<string, ObjectListRowOperationState>>>>>({});
const lastNoneModeFeedback = ref<{ readonly rowKey: string; readonly operationName: string } | null>(null);
const lastNoneModeFeedbackConsumedByColumn = computed(() =>
  Boolean(lastNoneModeFeedback.value && resultFromOperations.value.has(lastNoneModeFeedback.value.operationName)),
);

function rowResultsForKey(rowKey: string): Readonly<Record<string, ObjectListRowOperationState>> {
  return rowOperationResults.value[rowKey] ?? {};
}
function rowResultsFor(row: PlatformObjectRecord): Readonly<Record<string, ObjectListRowOperationState>> {
  return rowResultsForKey(rowIdentityKey(row));
}
function isRowBusyKey(rowKey: string): boolean {
  const ops = rowOperationResults.value[rowKey];
  if (!ops) return false;
  return Object.values(ops).some((state) => state.running);
}
function isRowBusy(row: PlatformObjectRecord): boolean {
  return isRowBusyKey(rowIdentityKey(row));
}
function setRowOpState(rowKey: string, opName: string, state: ObjectListRowOperationState) {
  const prevRow = rowOperationResults.value[rowKey] ?? {};
  rowOperationResults.value = {
    ...rowOperationResults.value,
    [rowKey]: {
      ...prevRow,
      [opName]: state,
    },
  };
}
function clearRowOperationResult(rowKey: string, operationName?: string) {
  const prevRow = rowOperationResults.value[rowKey];
  if (!prevRow) {
    if (!hasRowDetailSlot.value && !isAccordion.value) collapseRowKey(rowKey);
    return;
  }
  if (!operationName) {
    const next = { ...rowOperationResults.value };
    delete next[rowKey];
    rowOperationResults.value = next;
    if (lastNoneModeFeedback.value?.rowKey === rowKey) lastNoneModeFeedback.value = null;
    if (!hasRowDetailSlot.value && !isAccordion.value) collapseRowKey(rowKey);
    return;
  }
  if (!(operationName in prevRow)) return;
  const nextRow = { ...prevRow };
  delete nextRow[operationName];
  const next = { ...rowOperationResults.value };
  if (Object.keys(nextRow).length === 0) {
    delete next[rowKey];
    if (!hasRowDetailSlot.value && !isAccordion.value) collapseRowKey(rowKey);
  } else {
    next[rowKey] = nextRow;
  }
  rowOperationResults.value = next;
  if (lastNoneModeFeedback.value?.rowKey === rowKey && lastNoneModeFeedback.value.operationName === operationName) {
    lastNoneModeFeedback.value = null;
  }
}

function hasVisibleRowOpState(state: ObjectListRowOperationState): boolean {
  return Boolean(
    state.error
    || state.result
    || (state.receipt && !(state.receipt.kind === "dispatched" && state.receipt.outcome?.kind === "success")),
  );
}

function rowOperationFeedbackEntries(row: PlatformObjectRecord): readonly {
  readonly operationName: string;
  readonly state: ObjectListRowOperationState;
}[] {
  const map = rowResultsFor(row);
  return Object.entries(map)
    .filter(([, state]) => hasVisibleRowOpState(state))
    .map(([operationName, state]) => ({ operationName, state }));
}

function shouldShowRowDetail(row: PlatformObjectRecord): boolean {
  if (!isRowExpanded(row)) return false;
  if (hasRowDetailSlot.value) return true;
  return effectiveRowResultDisplay.value === "expand" && rowOperationFeedbackEntries(row).length > 0;
}

const noneModeFeedbackState = computed<ObjectListRowOperationState | null>(() => {
  if (effectiveRowResultDisplay.value !== "none") return null;
  const refKeyInfo = lastNoneModeFeedback.value;
  if (!refKeyInfo) return null;
  const state = rowOperationResults.value[refKeyInfo.rowKey]?.[refKeyInfo.operationName];
  return state && hasVisibleRowOpState(state) ? state : null;
});

function rowOperationsFor(row: PlatformObjectRecord): Readonly<Record<string, ListRowSlotOperation>> {
  const fallbackClassName = activeType.value ?? rowObjectType;
  const rowKey = panelRowOperationKey(row, fallbackClassName);
  const batchForRow = mergedRowOperations.value[rowKey];
  const rowResults = rowResultsFor(row);
  const admitted = admittedOpMap.value;
  const bindings = member.projection.operations ?? {};
  const result: Record<string, ListRowSlotOperation> = {};
  for (const opName of Object.keys(bindings)) {
    const descriptor = admitted[opName];
    if (!descriptor) continue;
    const binding = bindings[opName]!;
    const resolvedTarget = resolveRowOperationTarget(binding, row, fallbackClassName, member.inputs.value);
    const batchEntry = batchForRow?.[opName];
    const unavailable = batchEntry ? batchEntry.unavailable : descriptor.unavailable;
    const available = resolvedTarget !== undefined
      && (batchEntry ? batchEntry.available : !descriptor.unavailable);
    result[opName] = {
      name: opName,
      label: descriptor.label,
      available,
      unavailable,
      danger: Boolean(descriptor.inspectImpact),
      effect: descriptor.effect,
      running: Boolean(rowResults[opName]?.running),
    };
  }
  return result;
}

const busyRowActions = ref<ReadonlySet<string>>(new Set());
const busyWriteRowActions = ref<ReadonlySet<string>>(new Set());
const rowOpRunning = computed(() => busyRowActions.value.size > 0);
const writeRowOpRunning = computed(() => busyWriteRowActions.value.size > 0);

function rowActionBusyKey(row: PlatformObjectRecord, actionId: string): string {
  const fallbackClassName = activeType.value ?? rowObjectType;
  return `${panelRowOperationKey(row, fallbackClassName)}\0${actionId}`;
}

function isRowActionBusy(row: PlatformObjectRecord, actionId: string): boolean {
  return busyRowActions.value.has(rowActionBusyKey(row, actionId));
}

function isRowWriteOperationInFlight(row: PlatformObjectRecord, operationName: string): boolean {
  const descriptor = admittedOpMap.value[operationName];
  if (descriptor?.effect === "read") return false;
  const binding = member.projection.operations?.[operationName];
  const fallbackClassName = activeType.value ?? rowObjectType;
  const ref = rowObjectRef(row);
  const target = binding
    ? resolveRowOperationTarget(binding, row, fallbackClassName, member.inputs.value)
    : { kind: "object" as const, objectType: ref.className, primaryKey: ref.primaryKey };
  if (target?.kind !== "object") return false;
  const operationKey = descriptor?.handlerRef ?? panel.instance.operationIdOf(slot.slot, operationName);
  return Boolean(panel.instance.isObjectWriteInFlight?.(target, operationKey));
}

function markRowActionBusy(busyKey: string, busy: boolean, isWrite = false) {
  const next = new Set(busyRowActions.value);
  if (busy) next.add(busyKey);
  else next.delete(busyKey);
  busyRowActions.value = next;
  if (isWrite) {
    const nextWrite = new Set(busyWriteRowActions.value);
    if (busy) nextWrite.add(busyKey);
    else nextWrite.delete(busyKey);
    busyWriteRowActions.value = nextWrite;
  }
}

function resolvedRowActionsFor(row: PlatformObjectRecord): readonly ResolvedRowActionItem[] {
  const config = props.rowActions;
  if (!config || config.items.length === 0) return [];
  const rowOps = rowOperationsFor(row);
  const resolved: ResolvedRowActionItem[] = [];
  config.items.forEach((item, index) => {
    if (!matchesRowActionWhen(row, item.when, true)) return;
    const disabledByCondition = item.disabledWhen ? matchesRowActionWhen(row, item.disabledWhen, false) : false;
    if (item.kind === "operation" || (!("kind" in item) && "operation" in item && typeof (item as { operation?: unknown }).operation === "string")) {
      const opName = (item as { operation: string }).operation;
      const op = rowOps[opName];
      if (!op || (item.hideWhenUnavailable && !op.available)) return;
      const label = item.labelKey ? panel.t(item.labelKey) : item.label ?? op.label;
      resolved.push({
        key: `op:${opName}:${index}`,
        kind: "operation",
        operation: opName,
        prefill: "prefill" in item ? item.prefill : undefined,
        label,
        icon: item.icon,
        iconOnly: item.iconOnly,
        active: item.active,
        busy: isRowActionBusy(row, opName) || isRowWriteOperationInFlight(row, opName),
        tone: item.tone ?? (op.danger ? "danger" : "default"),
        disabled: disabledByCondition || !op.available,
        running: Boolean(op.running),
        reason: op.unavailable?.reason,
      });
      return;
    }
    if (item.kind === "conversation") {
      const label = item.labelKey ? panel.t(item.labelKey) : item.label ?? t("platform.conversationEntryOpen");
      resolved.push({
        key: `conv:${item.id}:${index}`,
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
        active: item.active,
        busy: isRowActionBusy(row, item.id),
        tone: item.tone ?? "default",
        disabled: disabledByCondition,
      });
      return;
    }
    const label = item.labelKey ? panel.t(item.labelKey) : item.label ?? item.id;
    resolved.push({
      key: `local:${item.id}:${index}`,
      kind: "local",
      id: item.id,
      to: item.to,
      label,
      icon: item.icon,
      iconOnly: item.iconOnly,
      active: item.active,
      busy: isRowActionBusy(row, item.id),
      tone: item.tone ?? "default",
      disabled: disabledByCondition,
    });
  });
  return resolved;
}

const rowOpInputDialogOpen = ref(false);
const rowOpPendingRow = shallowRef<PlatformObjectRecord | null>(null);
const rowOpPendingName = ref<string | null>(null);
const rowOpPendingDescriptor = shallowRef<PanelOwnerOperationDescriptor | null>(null);
const rowOpPendingBaseInput = shallowRef<Record<string, RuntimeJsonValue>>({});
const rowOpPendingExtraInput = shallowRef<Record<string, RuntimeJsonValue>>({});
const rowOpPendingInitialValues = shallowRef<Record<string, unknown>>({});

const rowOpPendingInputFields = computed<readonly OperationInputField[]>(() => {
  if (!rowOpPendingName.value || !rowOpPendingDescriptor.value) return [];
  const binding = member.projection.operations?.[rowOpPendingName.value];
  if (!binding) return [];
  const fields = resolveOperationInputFields(panel, slot, rowOpPendingName.value, rowOpPendingDescriptor.value);
  const allowedKeys = allowedRowOperationInputKeys(binding, fields);
  const suppliedKeys = new Set(Object.keys(rowOpPendingBaseInput.value));
  return fields.filter((field) => allowedKeys.has(field.name) && !suppliedKeys.has(field.name));
});

const saidRowOp = (single: SingleOperationOutcome) => formatOperationOutcome(single, t);

const topRowActionErrorMessage = computed<string | null>(() => {
  if (props.actionErrorPlacement !== "top") return null;
  const feedback = noneModeFeedbackState.value;
  if (!feedback) return null;
  if (feedback.error) return feedback.error;
  const receipt = feedback.receipt;
  if (!receipt) return null;
  if (receipt.kind === "not-dispatched") return receipt.message;
  const outcome = receipt.outcome;
  if (!outcome) return t("platform.operationUnknown", { message: "" });
  if (outcome.kind === "success" || outcome.kind === "batch") return null;
  return saidRowOp(outcome);
});

function dismissRowActionError() {
  const info = lastNoneModeFeedback.value;
  if (info) {
    clearRowOperationResult(info.rowKey, info.operationName);
  } else {
    lastNoneModeFeedback.value = null;
  }
}

const hasCustomRowActionSlot = computed(() =>
  Boolean(
    slots.actions
    || slots.card
    || slots.cell
    || slots["row-detail"]
    || Object.keys(slots).some((name) => name.startsWith("cell-")),
  ),
);

/**
 * Evaluates whether a row operation button is currently visible and enabled for a human on `row`,
 * following `rowActions` `when` and `disabledWhen` rules.
 */
function rowActionButtonState(
  row: PlatformObjectRecord,
  operationName: string,
): { readonly ok: true } | { readonly ok: false; readonly message: string } {
  const configured = (props.rowActions?.items ?? []).filter(
    (item) => item.kind === "operation" && item.operation === operationName,
  );
  if (configured.length === 0) {
    if (hasCustomRowActionSlot.value) return { ok: true };
    return {
      ok: false,
      message: `Row action '${operationName}' is not rendered on rows of this list.`,
    };
  }
  const visible = configured.filter((item) => matchesRowActionWhen(row, item.when, true));
  if (visible.length === 0) {
    return {
      ok: false,
      message: `Row action '${operationName}' is not shown on row '${row.primaryKey}'.`,
    };
  }
  const enabled = visible.filter((item) => !(item.disabledWhen ? matchesRowActionWhen(row, item.disabledWhen, false) : false));
  if (enabled.length === 0) {
    return {
      ok: false,
      message: `Row action '${operationName}' is currently disabled on row '${row.primaryKey}'.`,
    };
  }
  return { ok: true };
}

let listUnmounted = false;
onBeforeUnmount(() => {
  listUnmounted = true;
});

/** Unique mounted list instance ID; rotates on remount, dynamic type switch, or parent/member input change. */
const listInstanceId = ref(randomId());
watch(
  () => JSON.stringify({ activeType: activeType.value, inputs: member.inputs.value }),
  (next, prev) => {
    if (next !== prev) listInstanceId.value = randomId();
  },
);

/**
 * Whether this list is declared or observed to hold multiple/dynamic object types, in which case
 * row actions must always use the composite `<className>:<primaryKey>` key and reject bare primary keys.
 */
const requiresCompositeRowKey = computed<boolean>(() => {
  if (datumName === "objects" || !rowObjectType) return true;
  const isUnionState = (stateName: string | undefined) => {
    if (!stateName) return false;
    const field = panel.manifest.state[stateName];
    if (!field) return false;
    return field.type.kind === "object-union"
      || (field.type.kind === "list" && field.type.items.kind === "object-union");
  };
  if (
    isUnionState(placement.inputs?.selected && "state" in placement.inputs.selected ? placement.inputs.selected.state : undefined)
    || isUnionState(placement.outputs?.selected?.state)
    || isUnionState(placement.outputs?.checked?.state)
  ) {
    return true;
  }
  const fallback = activeType.value ?? rowObjectType;
  return rows.value.some((item) => Boolean(item.className && item.className !== fallback));
});

/** Briefly waits for an in-flight initial list load to settle so row actions do not falsely report `action_not_found`. */
function waitForInitialRowsLoad(timeoutMs = 2000): Promise<boolean> {
  if (datumState.value.status !== "loading") return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    let stop: (() => void) | null = null;
    const finish = (settled: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop?.();
      resolve(settled);
    };
    const timer = setTimeout(() => finish(datumState.value.status !== "loading"), timeoutMs);
    stop = watch(
      () => datumState.value.status,
      (status) => {
        if (listUnmounted || panel.instance.isDisposed()) finish(false);
        else if (status !== "loading") finish(true);
      },
      { immediate: true },
    );
  });
}

/**
 * Resolves a loaded row by composite `<className>:<primaryKey>` key first (required for mixed-type and
 * dynamic-type lists), falling back to plain `primaryKey` only on fixed single-type lists when unambiguous.
 */
function findLoadedRowByKey(
  rowKey: string,
): { readonly ok: true; readonly row: PlatformObjectRecord } | { readonly ok: false; readonly reason: "action_not_found" | "input_required"; readonly message: string } {
  const fallbackClassName = activeType.value ?? rowObjectType;
  const exactMatches = rows.value.filter((item) => panelRowOperationKey(item, fallbackClassName) === rowKey);
  if (exactMatches.length === 1) return { ok: true, row: exactMatches[0]! };
  if (exactMatches.length > 1) {
    return {
      ok: false,
      reason: "input_required",
      message: `Row key '${rowKey}' matched multiple loaded rows.`,
    };
  }
  if (requiresCompositeRowKey.value) {
    return {
      ok: false,
      reason: "input_required",
      message: `Row key '${rowKey}' must use the composite '<className>:<primaryKey>' format on a multi-type or dynamic-type list.`,
    };
  }
  const plainMatches = rows.value.filter((item) => item.primaryKey === rowKey);
  if (plainMatches.length === 0) {
    return {
      ok: false,
      reason: "action_not_found",
      message: `Row '${rowKey}' is not currently loaded in this list.`,
    };
  }
  if (plainMatches.length > 1) {
    const candidates = plainMatches.map((item) => panelRowOperationKey(item, fallbackClassName)).join(", ");
    return {
      ok: false,
      reason: "input_required",
      message: `Row key '${rowKey}' is ambiguous across multiple object types (${candidates}); specify the composite '<className>:<primaryKey>' key.`,
    };
  }
  return { ok: true, row: plainMatches[0]! };
}

interface RowOperationExecutionOutcome {
  readonly status: "executed" | "cancelled" | "skipped";
  readonly result?: PanelReadOperationResult;
  readonly receipt?: PanelHumanOperationDispatchResponse;
  readonly outcome?: OperationOutcome;
  readonly error?: string;
}

async function executeRowOperation(
  row: PlatformObjectRecord,
  operationName: string,
  descriptor: PanelOwnerOperationDescriptor,
  boundInput: Record<string, RuntimeJsonValue>,
  providedInput: Record<string, RuntimeJsonValue>,
  agentContext?: PanelAgentActionContext,
): Promise<RowOperationExecutionOutcome> {
  const rowIdKey = rowIdentityKey(row);
  if (isRowBusyKey(rowIdKey)) return { status: "skipped" };
  const binding = member.projection.operations?.[operationName];
  if (!binding) return { status: "skipped" };
  const fallbackClassName = activeType.value ?? rowObjectType;
  const target = resolveRowOperationTarget(binding, row, fallbackClassName, member.inputs.value);
  if (target === undefined) return { status: "skipped" };
  const operationId = panel.instance.operationIdOf(slot.slot, operationName);
  const operationKey = descriptor.handlerRef ?? operationId;
  const capturedCompositeKey = panelRowOperationKey(row, fallbackClassName);
  const busyKey = `${capturedCompositeKey}\0${operationName}`;
  const isWriteOp = descriptor.effect !== "read";
  const isSharedWriteBusy = () =>
    isWriteOp && target?.kind === "object" && Boolean(panel.instance.isObjectWriteInFlight?.(target, operationKey));
  if (busyRowActions.value.has(busyKey) || (isWriteOp && writeRowOpRunning.value) || isSharedWriteBusy()) return { status: "skipped" };
  const ref = rowObjectRef(row);
  const input: Record<string, RuntimeJsonValue> = isActionValuesEnvelope(descriptor.inputSchema)
    ? wrapActionOperationInput(descriptor.inputSchema, boundInput, providedInput)
    : { ...providedInput, ...boundInput };

  const evaluateRowSubmission: SubmissionEvaluator = (phase) => {
    if (listUnmounted || panel.instance.isDisposed()) {
      return { ok: false, message: "The list was closed or unmounted." };
    }
    if (phase === "confirm" && (isRowBusyKey(rowIdKey) || busyRowActions.value.has(busyKey) || (isWriteOp && writeRowOpRunning.value) || isSharedWriteBusy())) {
      return { ok: false, message: "Another operation is currently running on this row." };
    }
    const liveFallback = activeType.value ?? rowObjectType;
    const liveRow = rows.value.find((item) => panelRowOperationKey(item, liveFallback) === capturedCompositeKey);
    if (!liveRow) {
      return { ok: false, message: `Row '${capturedCompositeKey}' is no longer displayed.` };
    }
    const liveBinding = member.projection.operations?.[operationName];
    const liveDescriptor = admittedOpMap.value[operationName];
    if (!liveBinding || !liveDescriptor) {
      return { ok: false, message: `Operation '${operationName}' is no longer available on this list.` };
    }
    const liveButton = rowActionButtonState(liveRow, operationName);
    if (!liveButton.ok) {
      return { ok: false, message: liveButton.message };
    }
    const liveRowOp = rowOperationsFor(liveRow)[operationName];
    if (!liveRowOp?.available) {
      return {
        ok: false,
        message: liveRowOp?.unavailable?.reason ?? `Operation '${operationName}' is no longer available on row '${capturedCompositeKey}'.`,
      };
    }
    const liveTarget = resolveRowOperationTarget(liveBinding, liveRow, liveFallback, member.inputs.value);
    if (liveTarget === undefined) {
      return { ok: false, message: `Operation '${operationName}' no longer resolves a valid target for row '${capturedCompositeKey}'.` };
    }
    const liveBoundInput = resolveRowOperationParams(liveBinding, liveRow, member.inputs.value);
    const liveInput: Record<string, RuntimeJsonValue> = isActionValuesEnvelope(liveDescriptor.inputSchema)
      ? wrapActionOperationInput(liveDescriptor.inputSchema, liveBoundInput, providedInput)
      : { ...providedInput, ...liveBoundInput };
    return {
      ok: true,
      instanceId: panel.instance.instanceId,
      operationId: panel.instance.operationIdOf(slot.slot, operationName),
      target: liveTarget,
      payload: { rowKey: capturedCompositeKey, input: liveInput },
    };
  };

  markRowActionBusy(busyKey, true, isWriteOp);
  setRowOpState(rowIdKey, operationName, { running: true });
  try {
    if (descriptor.effect === "read") {
      const readResult = await panel.instance.readOperation(operationId, { target, input }, agentContext?.agentRun);
      setRowOpState(rowIdKey, operationName, { running: false, result: readResult });
      if (effectiveRowResultDisplay.value === "expand") {
        expandRowKey(rowIdKey);
      } else if (effectiveRowResultDisplay.value === "none") {
        lastNoneModeFeedback.value = { rowKey: rowIdKey, operationName };
      }
      return { status: "executed", result: readResult };
    }
    const applyRowAnswer = (
      answer: { decision: "confirm" | "cancel"; response?: PanelHumanOperationDispatchResponse; named: PanelWriteResult["named"] },
    ) => {
      if (answer.decision === "cancel" || !answer.response) return undefined;
      const answered = answer.response.kind === "dispatched" ? answer.response.outcome : undefined;
      setRowOpState(rowIdKey, operationName, {
        running: false,
        receipt: answer.response,
        named: answer.named,
      });
      if (answered?.kind === "success") {
        panel.notify({ kind: "success", text: saidRowOp(answered) });
      } else {
        if (effectiveRowResultDisplay.value === "expand") {
          expandRowKey(rowIdKey);
        } else if (effectiveRowResultDisplay.value === "none") {
          lastNoneModeFeedback.value = { rowKey: rowIdKey, operationName };
        }
      }
      if (answered) emit("operation-done", operationName, answered, ref);
      return answered;
    };
    let answer: PanelWriteResult;
    try {
      answer = agentContext
        ? await panel.instance.writeOperation(
            operationId,
            { call: { target, input } },
            { agentContext, evaluateSubmission: evaluateRowSubmission, handlerRef: descriptor.handlerRef },
          )
        : await panel.instance.writeOperation(
            operationId,
            { call: { target, input } },
            { handlerRef: descriptor.handlerRef },
          );
    } catch (reason) {
      if (reason instanceof PanelOperationDeferred) {
        const deferred = reason;
        const { preparation } = deferred;
        setRowOpState(rowIdKey, operationName, { running: false });
        const confirmation = createDeferredConfirmation({
          intentId: preparation.intentId,
          questionId: preparation.questionId!,
          operationId: preparation.operationId,
          label: preparation.label,
          staleCode: "ROW_ACTION_CONFIRMATION_STALE",
          isStillValid: deferred.isStillValid,
          cancel: deferred.cancelNow,
          async dispatchVerified(): Promise<PageActionConfirmedDispatchResult> {
            if (writeRowOpRunning.value || isSharedWriteBusy()) {
              return { ok: false, intentId: preparation.intentId, reason: "failed", message: "Another row action is currently running." };
            }
            markRowActionBusy(busyKey, true, true);
            setRowOpState(rowIdKey, operationName, { running: true });
            try {
              const confirmed = await deferred.dispatchNow();
              if (confirmed.decision !== "confirm") {
                setRowOpState(rowIdKey, operationName, { running: false });
                return { ok: false, intentId: preparation.intentId, reason: "not_dispatched", message: "Operation was cancelled." };
              }
              applyRowAnswer({ ...confirmed, named: deferred.named });
              return classifyDispatchResponseForConfirmation(preparation.intentId, confirmed.response);
            } catch (dispatchReason) {
              if (dispatchReason instanceof PanelSubmissionStaleError) {
                setRowOpState(rowIdKey, operationName, { running: false });
                return {
                  ok: false,
                  intentId: preparation.intentId,
                  reason: "stale",
                  message: dispatchReason.message,
                };
              }
              const message = dispatchReason instanceof Error ? dispatchReason.message : String(dispatchReason);
              setRowOpState(rowIdKey, operationName, { running: false, error: message });
              if (effectiveRowResultDisplay.value === "expand") {
                expandRowKey(rowIdKey);
              } else if (effectiveRowResultDisplay.value === "none") {
                lastNoneModeFeedback.value = { rowKey: rowIdKey, operationName };
              }
              return {
                ok: false,
                intentId: preparation.intentId,
                reason: "failed",
                message,
              };
            } finally {
              markRowActionBusy(busyKey, false, true);
              const current = rowOperationResults.value[rowIdKey]?.[operationName];
              if (current?.running) {
                setRowOpState(rowIdKey, operationName, { ...current, running: false });
              }
            }
          },
        });
        throw new PanelConfirmationDeferred(confirmation);
      }
      throw reason;
    }
    if (answer.decision === "cancel") {
      setRowOpState(rowIdKey, operationName, { running: false });
      return { status: "cancelled" };
    }
    const outcome = applyRowAnswer(answer);
    return { status: "executed", receipt: answer.response, outcome: outcome ?? undefined };
  } catch (reason) {
    if (reason instanceof PanelConfirmationDeferred || reason instanceof PanelSubmissionStaleError) {
      const current = rowOperationResults.value[rowIdKey]?.[operationName];
      if (current?.running) {
        setRowOpState(rowIdKey, operationName, { ...current, running: false });
      }
      throw reason;
    }
    const message = reason instanceof Error ? reason.message : String(reason);
    setRowOpState(rowIdKey, operationName, { running: false, error: message });
    if (effectiveRowResultDisplay.value === "expand") {
      expandRowKey(rowIdKey);
    } else if (effectiveRowResultDisplay.value === "none") {
      lastNoneModeFeedback.value = { rowKey: rowIdKey, operationName };
    }
    return { status: "executed", error: message };
  } finally {
    markRowActionBusy(busyKey, false, isWriteOp);
    const current = rowOperationResults.value[rowIdKey]?.[operationName];
    if (current?.running) {
      setRowOpState(rowIdKey, operationName, { ...current, running: false });
    }
  }
}

function configuredRowActionPrefill(operationName: string): ObjectListRowActionPrefill | undefined {
  const match = (props.rowActions?.items ?? []).find(
    (item) => item.kind === "operation" && item.operation === operationName,
  );
  return match && match.kind === "operation" ? match.prefill : undefined;
}

async function runRowOperation(
  row: PlatformObjectRecord,
  operationName: string,
  extraInput?: Readonly<Record<string, RuntimeJsonValue>>,
  prefillOverride?: ObjectListRowActionPrefill,
): Promise<void> {
  if (isRowActionBusy(row, operationName) || isRowBusy(row) || isRowWriteOperationInFlight(row, operationName)) return;
  const descriptor = admittedOpMap.value[operationName];
  const binding = member.projection.operations?.[operationName];
  if (!descriptor || !binding) return;
  if (descriptor.effect !== "read" && writeRowOpRunning.value) return;
  const rowOp = rowOperationsFor(row)[operationName];
  if (!rowOp || !rowOp.available) return;

  const boundInput = resolveRowOperationParams(binding, row, member.inputs.value);
  const allFields = resolveOperationInputFields(panel, slot, operationName, descriptor);
  const allowedKeys = allowedRowOperationInputKeys(binding, allFields);
  const filteredExtra = filterAllowedRowOperationInput(extraInput, allowedKeys);
  // Declared projection bindings always take precedence; caller extraInput may only supply unbound editable fields.
  const baseInput: Record<string, RuntimeJsonValue> = {
    ...filteredExtra,
    ...boundInput,
  };
  const suppliedKeys = new Set(Object.keys(baseInput));
  const missingFields = allFields.filter((field) => allowedKeys.has(field.name) && !suppliedKeys.has(field.name));
  if (missingFields.length > 0) {
    const effectivePrefill = prefillOverride !== undefined ? prefillOverride : configuredRowActionPrefill(operationName);
    rowOpPendingRow.value = row;
    rowOpPendingName.value = operationName;
    rowOpPendingDescriptor.value = descriptor;
    rowOpPendingBaseInput.value = baseInput;
    rowOpPendingExtraInput.value = filteredExtra;
    rowOpPendingInitialValues.value = resolveRowOperationPrefill(row, missingFields, effectivePrefill);
    rowOpInputDialogOpen.value = true;
    return;
  }
  await executeRowOperation(row, operationName, descriptor, boundInput, filteredExtra);
}

async function confirmRowOpInput(providedInput: Record<string, RuntimeJsonValue>) {
  const row = rowOpPendingRow.value;
  const operationName = rowOpPendingName.value;
  const descriptor = rowOpPendingDescriptor.value;
  if (!row || !operationName || !descriptor) return;
  const binding = member.projection.operations?.[operationName];
  if (!binding) return;
  const allFields = resolveOperationInputFields(panel, slot, operationName, descriptor);
  const allowedKeys = allowedRowOperationInputKeys(binding, allFields);
  const filteredProvided = filterAllowedRowOperationInput(providedInput, allowedKeys);
  const boundInput = resolveRowOperationParams(binding, row, member.inputs.value);
  // Dialog input can only populate unbound editable fields and never overrides base or bound parameters.
  const provided: Record<string, RuntimeJsonValue> = {
    ...filteredProvided,
    ...rowOpPendingExtraInput.value,
  };
  rowOpInputDialogOpen.value = false;
  await executeRowOperation(row, operationName, descriptor, boundInput, provided);
}

const mountedRowActionOperations = computed<readonly string[]>(() => {
  const declared = Object.keys(member.projection.operations ?? {});
  if (hasCustomRowActionSlot.value) return declared;
  const configured = new Set(
    (props.rowActions?.items ?? [])
      .filter((item): item is Extract<typeof item, { kind: "operation" }> => item.kind === "operation")
      .map((item) => item.operation),
  );
  return declared.filter((name) => configured.has(name));
});

let unregisterRowActionHandlers: (() => void)[] = [];
function clearRowActionHandlers() {
  for (const unregister of unregisterRowActionHandlers) unregister();
  unregisterRowActionHandlers = [];
}
watch(
  mountedRowActionOperations,
  (operationNames) => {
    clearRowActionHandlers();
    unregisterRowActionHandlers = operationNames.map((operationName) =>
      panel.instance.registerActionHandler(
        panel.instance.operationIdOf(slot.slot, operationName),
        async ({ rowKey, input, expectedTarget, agentContext }) => {
          if (!rowKey) {
            return { ok: false, reason: "input_required", message: `Row action '${operationName}' requires rowKey.` };
          }
          if (datumState.value.status === "loading" && (!initialLoadDone || rows.value.length === 0)) {
            const settled = await waitForInitialRowsLoad();
            if (!settled || listUnmounted || panel.instance.isDisposed()) {
              return {
                ok: false,
                reason: "action_not_ready",
                message: `List is still loading rows for action '${operationName}'.`,
              };
            }
          }
          const matched = findLoadedRowByKey(rowKey);
          if (!matched.ok) {
            return { ok: false, reason: matched.reason, message: matched.message };
          }
          const { row } = matched;
          const binding = member.projection.operations?.[operationName];
          if (!binding) {
            return { ok: false, reason: "action_not_found", message: `Row operation '${operationName}' is not declared on this list.` };
          }
          if (expectedTarget !== undefined) {
            const fallbackClassName = activeType.value ?? rowObjectType;
            const resolvedTarget = resolveRowOperationTarget(binding, row, fallbackClassName, member.inputs.value);
            const effectiveTarget = resolvedTarget ?? {
              kind: "object" as const,
              objectType: rowObjectRef(row).className,
              primaryKey: rowObjectRef(row).primaryKey,
            };
            if (!matchesExpectedTarget(effectiveTarget, expectedTarget)) {
              return {
                ok: false,
                reason: "stale",
                message: `Row operation '${operationName}' target no longer matches the expected target.`,
              };
            }
          }
          const descriptor = admittedOpMap.value[operationName];
          if (!descriptor) {
            return missingOperationDescriptorResult(memberOperationsState.value, operationName);
          }
          if (isRowActionBusy(row, operationName) || isRowBusy(row) || isRowWriteOperationInFlight(row, operationName) || (descriptor.effect !== "read" && writeRowOpRunning.value)) {
            return {
              ok: false,
              reason: "action_unavailable",
              message: `Row '${rowKey}' is busy executing another operation; cannot run '${operationName}'.`,
            };
          }
          const buttonState = rowActionButtonState(row, operationName);
          if (!buttonState.ok) {
            return { ok: false, reason: "action_unavailable", message: buttonState.message };
          }
          const rowOp = rowOperationsFor(row)[operationName];
          if (!rowOp || !rowOp.available) {
            return {
              ok: false,
              reason: "action_unavailable",
              message: rowOp?.unavailable?.reason ?? `Operation '${operationName}' is not available on row '${rowKey}'.`,
            };
          }
          if (agentContext && hasAgentOperationSecretInput(descriptor, input)) return agentOperationSecretRefusal;
          const boundInput = resolveRowOperationParams(binding, row, member.inputs.value);
          const allFields = resolveOperationInputFields(panel, slot, operationName, descriptor);
          const allowedKeys = allowedRowOperationInputKeys(binding, allFields);
          const filteredExtra = filterAllowedRowOperationInput(input, allowedKeys);
          const baseInput: Record<string, RuntimeJsonValue> = { ...filteredExtra, ...boundInput };
          const suppliedKeys = new Set(Object.keys(baseInput));
          const missing = allFields
            .filter((field) => field.required && allowedKeys.has(field.name) && !suppliedKeys.has(field.name))
            .map((field) => field.name);
          if (missing.length > 0) {
            return {
              ok: false,
              reason: "input_required",
              message: `Row operation '${operationName}' requires input fields: ${missing.join(", ")}.`,
            };
          }
          const exec = await executeRowOperation(row, operationName, descriptor, boundInput, filteredExtra, agentContext);
          const dispatchedResponse = exec.receipt ?? agentContext?.completed?.response;
          if (dispatchedResponse) {
            return classifyDispatchResponseForAction(dispatchedResponse);
          }
          if (exec.error) {
            return { ok: false, reason: "failed", message: exec.error };
          }
          if (exec.status === "cancelled") {
            return { ok: false, reason: "cancelled", message: `Row operation '${operationName}' was cancelled.` };
          }
          if (exec.status === "skipped") {
            return {
              ok: false,
              reason: "action_unavailable",
              message: `Row operation '${operationName}' could not be executed because the row is busy.`,
            };
          }
          if (exec.result) {
            return { ok: true, outcome: exec.result };
          }
          return { ok: true, outcome: exec.outcome ?? undefined };
        },
        { scope: "row", entryInstanceId: () => listInstanceId.value },
      ),
    );
  },
  { immediate: true },
);
onBeforeUnmount(clearRowActionHandlers);

function resolveConversationTarget(item: ResolvedRowActionItem): PanelConversationEntry["target"] {
  return item.target ?? slot.projection.conversationEntry?.target ?? { kind: "page-default" };
}

function resolveConversationPrompt(row: PlatformObjectRecord, item: ResolvedRowActionItem): string {
  const ref = rowObjectRef(row);
  const refJson = JSON.stringify({ className: ref.className, primaryKey: ref.primaryKey });
  const rawTemplate = (() => {
    if (item.prefillKey !== undefined) {
      const translated = panel.t(item.prefillKey, {
        label: row.label,
        primaryKey: ref.primaryKey,
        className: ref.className,
        ref: refJson,
      });
      if (translated !== item.prefillKey) return translated;
    }
    if (item.conversationPrefill !== undefined) return item.conversationPrefill;
    const declared = slot.projection.conversationEntry;
    if (declared?.prefillKey !== undefined) {
      const keyed = panel.t(declared.prefillKey, {
        label: row.label,
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
        if (key === "label") return row.label;
        if (key === "ref") return refJson;
        return fieldValue(row, key);
      })
    : "";
  if (!interpolated.trim()) {
    return `${row.label || ref.primaryKey} ${refJson}`;
  }
  if (!interpolated.includes(ref.primaryKey) || !interpolated.includes(ref.className)) {
    return `${interpolated}\n${refJson}`;
  }
  return interpolated;
}

async function runConversationRowAction(
  row: PlatformObjectRecord,
  item: ResolvedRowActionItem,
  event?: MouseEvent,
): Promise<void> {
  const actionId = item.id ?? "conversation";
  const fallbackClassName = activeType.value ?? rowObjectType;
  const capturedCompositeKey = panelRowOperationKey(row, fallbackClassName);
  const busyKey = `${capturedCompositeKey}\0${actionId}`;
  if (busyRowActions.value.has(busyKey)) return;

  const target = resolveConversationTarget(item);
  const prefill = resolveConversationPrompt(row, item);
  const declared = slot.projection.conversationEntry;
  const submit = item.submit ?? declared?.submit;
  const newSession = item.newSession ?? declared?.newSession;

  const rowIdKey = rowIdentityKey(row);
  markRowActionBusy(busyKey, true);
  try {
    await panel.expandPageComposer({
      slot: slot.slot,
      target,
      prefill,
      ...(submit !== undefined ? { submit } : {}),
      ...(newSession !== undefined ? { newSession } : {}),
    }, event);
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    setRowOpState(rowIdKey, actionId, { running: false, error: error.message });
    if (effectiveRowResultDisplay.value === "none") {
      lastNoneModeFeedback.value = { rowKey: rowIdKey, operationName: actionId };
    }
  } finally {
    markRowActionBusy(busyKey, false);
  }
}

function triggerRowAction(row: PlatformObjectRecord, index: number, item: ResolvedRowActionItem, event?: MouseEvent) {
  activeRowLabel.value = row.label || row.primaryKey;
  if (item.kind === "operation" && item.operation) {
    if (isTabs.value && Boolean(props.inlineRenameOperation) && props.inlineRenameOperation === item.operation) {
      startTabInlineRename(row);
      return;
    }
    void runRowOperation(row, item.operation, undefined, item.prefill);
    return;
  }
  if (item.kind === "conversation") {
    void runConversationRowAction(row, item, event);
    return;
  }
  if (item.kind === "local" && item.id) {
    const ref = rowObjectRef(row);
    if (item.to) {
      const address = resolveRowActionAddress(item.to, row, activeType.value ?? rowObjectType);
      void panel.navigate(address);
    }
    emit("row-action", { id: item.id, ref, index });
  }
}

function cardSlotProps(row: PlatformObjectRecord, index: number, entryKey: string) {
  const subtitle = fieldValue(row, summaryKey.value);
  return {
    ...rowActionsSlotProps(row, index),
    title: row.label,
    subtitle,
    description: fieldValue(row, "description") || subtitle,
    icon: rowLeadingIcon(row),
    selected: entryKey === chosenIdentity.value,
    checked: checkedIdentityKeys.value.has(rowCheckKey(row)),
    toggleCheck: (next?: boolean) => toggleChecked(row, next ?? !checkedIdentityKeys.value.has(rowCheckKey(row))),
    expanded: isRowExpanded(row),
    toggleExpand: () => toggleRowExpanded(row),
    rowActions: resolvedRowActionsFor(row),
    triggerAction: (item: ResolvedRowActionItem, event?: MouseEvent) => triggerRowAction(row, index, item, event),
  };
}

function rowRefSlotProps(row: PlatformObjectRecord, index: number): RowRefSlotScope {
  return {
    ref: rowSelectionValue(row),
    index,
  };
}

function itemLeadingSlotProps(row: PlatformObjectRecord, index: number): ItemLeadingSlotScope {
  return {
    ...rowRefSlotProps(row, index),
    icon: rowLeadingIcon(row),
  };
}

function rowActionsSlotProps(row: PlatformObjectRecord, index: number): RowActionsSlotScope {
  const rowIdKey = rowIdentityKey(row);
  return {
    ref: rowSelectionValue(row),
    index,
    operations: rowOperationsFor(row),
    operationResults: rowResultsForKey(rowIdKey),
    runOperation: (operationName: string, extraInput?: Readonly<Record<string, RuntimeJsonValue>>) =>
      runRowOperation(row, operationName, extraInput),
    clearOperationResult: (operationName?: string) => clearRowOperationResult(rowIdKey, operationName),
  };
}

function cellSlotProps(row: PlatformObjectRecord, index: number, column: ObjectListColumn): CellSlotScope {
  const derived = resolveResultFromCell(row, column);
  return {
    ...rowActionsSlotProps(row, index),
    column,
    value: derived ? derived.rawValue : rawRecordField(row, column.key),
    displayText: columnText(row, column),
    tone: columnTone(row, column),
  };
}

// --- Read-only component outputs (kept separate from writable manifest.state) ---

const selectedRowLabel = computed<string | null>(() => {
  const identity = chosenIdentity.value;
  if (!identity) return null;
  const match = rawRows.value.find((row) => rowIdentityKey(row) === identity);
  return match ? (match.label || match.primaryKey) : null;
});

useMemberOutput("status", () => datumState.value.status);
useMemberOutput("listed", () => {
  if (!hasObjectRows) return null;
  if (datumState.value.status === "empty") return [];
  return datumState.value.status === "ready" && queryStatus.value === "ok" ? listedRefs.value : null;
});
useMemberOutput("total", () => {
  if (datumState.value.status === "ready" && parsedData.value.status === "ok") {
    return parsedData.value.hasTotal ? parsedData.value.total : null;
  }
  if (datumState.value.status === "empty" && isCompleteList.value) return 0;
  return null;
});
useMemberOutput("loadedCount", () => {
  if (datumState.value.status === "ready" && parsedData.value.status === "ok") return rawRows.value.length;
  if (datumState.value.status === "empty") return 0;
  return null;
});
useMemberOutput("filteredCount", () => {
  if (!isCompleteList.value) return null;
  if (datumState.value.status === "ready" && parsedData.value.status === "ok") return rows.value.length;
  if (datumState.value.status === "empty") return 0;
  return null;
});
useMemberOutput("checkedCount", () => checkedRefs.value.length);
useMemberOutput("selectedLabel", () => selectedRowLabel.value);
useMemberOutput("activeLabel", () => selectedRowLabel.value ?? activeRowLabel.value);

defineExpose({
  openColumnToggle,
  closeColumnToggle,
  resetColumnVisibility,
  exportCurrentPageCsv,
});
</script>

<template>
  <div
    ref="listRootRef"
    class="sdk-object-list"
    :class="{ 'sdk-object-list-compact': isCompact, 'sdk-object-list-tabs-mode': isTabs }"
    :data-refreshing="isRefreshingWithPrevious ? 'true' : undefined"
    :aria-busy="isRefreshingWithPrevious ? 'true' : undefined"
  >
    <div v-if="showToolbar" class="sdk-object-list-toolbar" :class="{ 'sdk-object-list-toolbar-sticky': isStickyCheckBar }">
      <div v-if="canSearch" class="sdk-object-list-search-wrap">
        <svg class="sdk-object-list-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          class="sdk-object-list-search"
          :value="searchText"
          :placeholder="searchPlaceholderText"
          :aria-label="searchPlaceholderText"
          @input="onSearchInput"
        />
      </div>
      <div v-if="$slots.filters" class="sdk-object-list-filters">
        <slot name="filters"></slot>
      </div>
      <div v-if="showCheckRow" class="sdk-object-list-check-row">
        <label class="sdk-object-list-select-all" :class="{ disabled: !selectableVisibleRows.length }">
          <input
            :ref="selectAllCheckboxRef"
            type="checkbox"
            :checked="allVisibleChecked"
            :indeterminate.prop="someVisibleChecked"
            :disabled="!selectableVisibleRows.length"
            @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ t("platform.listSelectAll") }}</span>
        </label>
        <span v-if="checkedRefs.length > 0" class="sdk-object-list-selected-count" role="status">
          {{ t("platform.listSelectedCount", { count: checkedRefs.length }) }}
        </span>
      </div>
      <ObjectListBatchActions v-if="canCheck && checkedRefs.length > 0" :publish-receipt="publishBatchReceipt">
        <span v-if="isTable" class="sdk-object-list-selected-count" role="status">
          {{ t("platform.listSelectedCount", { count: checkedRefs.length }) }}
        </span>
        <slot name="batch-actions" :checked="checkedRefs" :clear="clearChecked"></slot>
        <button type="button" class="sdk-object-list-link-btn" @click="clearChecked">
          {{ t("platform.listClearSelection") }}
        </button>
      </ObjectListBatchActions>
      <div v-if="$slots['toolbar-actions'] || hasBuiltInToolbarActions" class="sdk-object-list-toolbar-actions">
        <slot name="toolbar-actions"></slot>
        <ObjectListColumnToggle
          v-if="showBuiltInColumnToggle"
          v-model:open="columnToggleOpen"
          :columns="columnToggleItems"
          :hidden-keys="hiddenColumnKeys"
          @toggle="setColumnVisible"
          @reset="resetColumnVisibility"
        />
        <button
          v-if="showBuiltInExport"
          type="button"
          class="sdk-object-list-btn sdk-object-list-toolbar-btn"
          data-testid="object-list-export-csv"
          :disabled="!canExportCsv"
          :title="canExportCsv ? t('platform.listExportCurrentPageCsv') : t('platform.listExportEmptyHint')"
          @click="exportCurrentPageCsv"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span>{{ t("platform.listExportCurrentPageCsv") }}</span>
        </button>
      </div>
    </div>

    <OperationBatchReceipt
      v-if="batchReceipt"
      class="sdk-object-list-batch-receipt"
      :items="batchReceipt.items"
      :named="batchReceipt.named"
      dismissible
      @dismiss="publishBatchReceipt(null)"
    />

    <div v-if="showCreateRow" class="sdk-object-list-create-row" data-create-row="true">
      <slot name="create-row"></slot>
    </div>

    <ul v-if="diagnostics.length" class="sdk-object-list-diagnostics" role="status">
      <li v-for="note in diagnostics" :key="note">{{ note }}</li>
    </ul>

    <div v-if="$slots.status" class="sdk-object-list-status-bar">
      <slot name="status" v-bind="listStateSnapshot"></slot>
    </div>

    <el-alert
      v-if="topRowActionErrorMessage"
      class="sdk-object-list-op-top-alert"
      type="error"
      :closable="true"
      show-icon
      :title="topRowActionErrorMessage"
      @close="dismissRowActionError"
    />

    <el-alert
      v-if="hasPreviousOnError && currentErrorMessage"
      class="sdk-object-list-preserved-error"
      data-testid="object-list-stale-error"
      type="error"
      :closable="false"
      show-icon
      :title="currentErrorMessage"
    >
      <el-button
        text
        size="small"
        class="sdk-object-list-stale-retry"
        data-testid="object-list-stale-retry"
        @click="retryLoad"
      >
        {{ dataStateLabels.retry }}
      </el-button>
    </el-alert>

    <div
      v-if="showRangeSummary"
      class="sdk-object-list-range-bar"
      data-testid="object-list-range-bar"
      role="status"
    >
      {{ rangeSummaryText }}
    </div>

    <p
      v-if="datumState.status === 'ready' && queryStatus !== 'ok'"
      class="sdk-object-list-status"
      :data-status="queryStatus"
      :role="queryStatus === 'failed' ? 'alert' : 'status'"
    >
      <span class="sdk-object-list-status-label">{{ queryStatusLabel }}</span>
      <span v-if="queryReason" class="sdk-object-list-status-reason">{{ queryReason }}</span>
    </p>
    <div
      v-else-if="listResult.status === 'loading' && $slots.loading"
      class="sdk-object-list-custom-loading"
      aria-busy="true"
    >
      <slot name="loading"></slot>
    </div>
    <div
      v-else-if="isCards && listResult.status === 'loading'"
      class="sdk-object-list-cards sdk-object-list-cards-loading"
      aria-busy="true"
    >
      <el-skeleton
        v-for="idx in resolvedSkeletonCount"
        :key="idx"
        class="sdk-object-list-card-skeleton"
        :rows="2"
        animated
      />
    </div>
    <div
      v-else-if="!isTable && listResult.status === 'empty' && $slots.empty"
      class="sdk-object-list-custom-empty"
    >
      <slot name="empty" :narrowed="narrowed" :clear-filters="clearFilters"></slot>
    </div>
    <div
      v-else-if="isTabs && listResult.status === 'empty' && $slots['tabs-extra']"
      class="sdk-object-list-tabs-bar is-empty"
      :class="{ 'is-pill': tabsVariant === 'pill' }"
    >
      <span class="sdk-object-list-tabs-empty-text">{{ emptyText ? panel.t(emptyText) : t("platform.dataEmpty") }}</span>
      <div class="sdk-object-list-tabs-extra">
        <slot name="tabs-extra"></slot>
      </div>
    </div>
    <data-state v-else :result="tableDataResult" :labels="dataStateLabels">
      <div
        v-if="isTable"
        ref="scrollContainerRef"
        class="sdk-object-list-table-wrap"
        :data-virtualized="isVirtualized ? 'true' : undefined"
        @scroll="onContainerScroll"
      >
        <table
          class="sdk-object-list-table"
          :class="{ 'is-bordered': border, 'is-striped': stripe }"
          :data-border="border ? 'true' : undefined"
          :data-stripe="stripe ? 'true' : undefined"
        >
          <thead v-if="showHeader !== false">
            <tr>
              <th v-if="showLeadingExpandColumn" class="sdk-object-list-expand-col"></th>
              <th v-if="canCheck" class="sdk-object-list-check-col">
                <input
                  :ref="selectAllCheckboxRef"
                  type="checkbox"
                  :aria-label="t('platform.listSelectAll')"
                  :checked="allVisibleChecked"
                  :indeterminate.prop="someVisibleChecked"
                  :disabled="!selectableVisibleRows.length"
                  @change="toggleAllVisible(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th v-if="showRowIndexColumn" class="sdk-object-list-index-col">{{ t("platform.listRowIndex") }}</th>
              <th
                v-for="(column, colIndex) in visibleColumns"
                :key="column.key"
                :class="[columnFit.get(column.key), { 'sdk-object-list-col-pinned-left': isPinnedPrimaryColumn(colIndex) }]"
                :style="columnStyle(column)"
              >
                <span v-if="column.headerTooltipKey" class="sdk-object-list-th-with-tip">
                  <span>{{ columnLabel(column) }}</span>
                  <el-tooltip :content="panel.t(column.headerTooltipKey)" placement="top">
                    <span
                      class="sdk-object-list-th-help"
                      tabindex="0"
                      :aria-label="panel.t(column.headerTooltipKey)"
                      @click.stop
                    >
                      <component :is="headerHelpIcon" :size="14" aria-hidden="true" />
                    </span>
                  </el-tooltip>
                </span>
                <template v-else>{{ columnLabel(column) }}</template>
              </th>
              <th
                v-if="hasActionColumn"
                class="sdk-object-list-actions-col"
                :class="{ 'sdk-object-list-actions-fixed': rowActions?.fixed === 'right' }"
                :style="actionColumnStyle"
              >{{ actionColumnHeader }}</th>
              <th v-if="showRowChevron" class="sdk-object-list-chevron-col" aria-hidden="true"></th>
              <th v-if="showTrailingExpandColumn" class="sdk-object-list-expand-trailing-col" aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody v-if="tablePreservesEmpty" class="sdk-object-list-empty-body">
            <tr class="sdk-object-list-empty-row">
              <td :colspan="tableColumnCount" class="sdk-object-list-empty-cell">
                <slot v-if="$slots.empty" name="empty" :narrowed="narrowed" :clear-filters="clearFilters"></slot>
                <data-state v-else :result="listResult" :labels="dataStateLabels" />
              </td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-if="isVirtualized && virtualTopPadding > 0" class="sdk-object-list-virtual-spacer-row" aria-hidden="true">
              <td :colspan="tableColumnCount" class="sdk-object-list-virtual-spacer-cell" :style="{ height: `${virtualTopPadding}px` }"></td>
            </tr>
            <template v-for="entry in renderedItems" :key="entry.key">
              <tr
                v-if="entry.kind === 'group'"
                :ref="(el) => setGroupHeaderElement(entry.key, el)"
                class="sdk-object-list-group-row"
                :data-group-key="entry.groupKey"
              >
                <td :colspan="tableColumnCount" class="sdk-object-list-group-cell">
                  <button
                    type="button"
                    class="sdk-object-list-group-btn"
                    :aria-expanded="!entry.collapsed"
                    @click="toggleGroupCollapsed(entry.groupKey)"
                  >
                    <span class="sdk-object-list-expand-icon" :class="{ expanded: !entry.collapsed }" aria-hidden="true">▸</span>
                    <span class="sdk-object-list-group-label">{{ entry.label }}</span>
                    <span class="sdk-object-list-group-count">{{ entry.count }}</span>
                  </button>
                </td>
              </tr>
              <template v-else>
                <tr
                  :ref="(el) => setRowElement(entry.key, el)"
                  :tabindex="rowSelectable || isRowExpandActivation ? 0 : undefined"
                  data-row-item="true"
                  :data-expanded="isRowExpanded(entry.row) ? 'true' : undefined"
                  :data-highlighted="rowActivation === 'dblclick' && entry.key === highlightedIdentity ? 'true' : undefined"
                  :aria-selected="rowSelectable ? entry.key === chosenIdentity : undefined"
                  :aria-expanded="isRowExpandActivation ? isRowExpanded(entry.row) : undefined"
                  :class="[
                    {
                      chosen: entry.key === chosenIdentity,
                      expanded: isRowExpandActivation && isRowExpanded(entry.row),
                      highlighted: rowActivation === 'dblclick' && entry.key === highlightedIdentity,
                      'is-non-selectable': (!rowActivatable && !isRowExpandActivation) || rowActivation === 'dblclick',
                    },
                    rowToneClass(entry.row),
                  ]"
                  @click="onTableRowClick(entry.row, $event)"
                  @dblclick="onTableRowDblclick(entry.row)"
                  @keydown="(rowSelectable || isRowExpandActivation) ? onRowKeydown(entry.row, $event) : undefined"
                >
                  <td v-if="showLeadingExpandColumn" class="sdk-object-list-expand-col" @click.stop>
                    <button
                      type="button"
                      class="sdk-object-list-expand-btn"
                      :aria-expanded="isRowExpanded(entry.row)"
                      :aria-label="rowExpandAriaLabel(entry.row)"
                      @click="toggleRowExpanded(entry.row)"
                    >
                      <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(entry.row) }" aria-hidden="true">▸</span>
                    </button>
                  </td>
                  <td v-if="canCheck" class="sdk-object-list-check-col" @click.stop>
                    <input
                      type="checkbox"
                      :aria-label="entry.row.label"
                      :checked="checkedIdentityKeys.has(rowCheckKey(entry.row))"
                      :disabled="isRowCheckDisabled(entry.row)"
                      @change="toggleChecked(entry.row, ($event.target as HTMLInputElement).checked)"
                    />
                  </td>
                  <td v-if="showRowIndexColumn" class="sdk-object-list-index-col">{{ rowDisplayIndex(entry.rowIndex) }}</td>
                  <td
                    v-for="(column, colIndex) in visibleColumns"
                    :key="column.key"
                    :class="[columnFit.get(column.key), { 'sdk-object-list-col-pinned-left': isPinnedPrimaryColumn(colIndex) }]"
                    :style="columnStyle(column)"
                    :title="columnCellSlot(column.key) ? undefined : cellTitle(entry.row, column)"
                  >
                    <div class="sdk-object-list-td-body" :class="{ 'has-draft-dot': colIndex === 0 && hasRowDraft(entry.row) }">
                      <span
                        v-if="colIndex === 0 && hasRowDraft(entry.row)"
                        class="sdk-object-list-draft-dot"
                        :title="t('platform.formDraftIndicator')"
                        :aria-label="t('platform.formDraftIndicator')"
                      ></span>
                      <list-row-slot-host
                        v-if="columnCellSlot(column.key)"
                        :list-slot="member.key"
                        :row-ref="rowObjectRef(entry.row)"
                        :index="entry.rowIndex"
                        :operations="rowOperationsFor(entry.row)"
                        :operation-results="rowResultsFor(entry.row)"
                        :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                        :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                        :render-slot="columnCellSlot(column.key)!"
                        :slot-props="cellSlotProps(entry.row, entry.rowIndex, column)"
                        :fallback-to-default="true"
                      >
                      <span
                        v-if="isCellAwaitingSupplement(entry.row, column.key)"
                        class="sdk-object-list-cell-pending"
                        aria-busy="true"
                      >…</span>
                      <TypedValue
                        v-else-if="usesTypedValueCell(entry.row, column)"
                        :value="rawRecordField(entry.row, column.key)"
                        :field="column.key"
                        :kind="Array.isArray(rawRecordField(entry.row, column.key)) ? (column.kind === 'tags' ? 'tags' : 'list') : 'reference'"
                        :list-style="column.kind === 'tags' ? 'tags' : (column.listStyle ?? 'inline')"
                        :separator="column.listSeparator ?? ', '"
                        :empty-text="columnEmpty(column)"
                        @navigate="(ref) => navigateTo(ref, column.key)"
                        @navigate-child="(ref) => navigateToChild(ref, column.key)"
                      />
                      <button
                        v-else-if="column.kind !== 'text' && referenceField(entry.row, column.key)"
                        type="button"
                        class="sdk-object-ref-link"
                        @click.stop="navigateTo(toFieldReference(referenceField(entry.row, column.key)!), column.key)"
                      >
                        <template v-for="(part, index) in textSegmentsFor(entry.row, column.key, referenceDisplayLabel(referenceField(entry.row, column.key)!))" :key="index">
                          <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                        </template>
                      </button>
                      <span v-else-if="Array.isArray(rawRecordField(entry.row, column.key)) || column.kind === 'tags'" class="sdk-object-list-item-tags">
                        <template v-for="(item, itemIndex) in recordFieldArrayItems(entry.row, column.key)" :key="itemIndex">
                          <button
                            v-if="isRecordChildReference(item)"
                            type="button"
                            class="sdk-object-ref-link"
                            @click.stop="navigateToChild(toChildFieldReference(item), column.key)"
                          >
                            {{ childReferenceDisplayLabel(item) }}
                          </button>
                          <button
                            v-else-if="isRecordReference(item)"
                            type="button"
                            class="sdk-object-ref-link"
                            @click.stop="navigateTo(toFieldReference(item), column.key)"
                          >
                            {{ referenceDisplayLabel(item) }}
                          </button>
                          <span
                            v-else
                            class="sdk-object-list-tag"
                            :data-tone="resolveTagArrayItem(item, column).tone"
                            :data-effect="column.tagEffect"
                          >
                            <component
                              :is="appIcon(resolveTagArrayItem(item, column).icon!)"
                              v-if="resolveTagArrayItem(item, column).icon"
                              :size="13"
                              :stroke-width="2"
                              class="sdk-object-list-tag-icon"
                              :data-icon="resolveTagArrayItem(item, column).icon"
                              aria-hidden="true"
                            />
                            <span>{{ resolveTagArrayItem(item, column).label }}</span>
                          </span>
                        </template>
                        <template v-if="!recordFieldArrayItems(entry.row, column.key).length">{{ columnEmpty(column) }}</template>
                      </span>
                      <span
                        v-else-if="columnIsTag(entry.row, column)"
                        class="sdk-object-list-tag"
                        :data-tone="columnTone(entry.row, column)"
                        :data-effect="column.tagEffect"
                      >
                        <component
                          :is="appIcon(columnTagIcon(entry.row, column)!)"
                          v-if="columnTagIcon(entry.row, column)"
                          :size="13"
                          :stroke-width="2"
                          class="sdk-object-list-tag-icon"
                          :data-icon="columnTagIcon(entry.row, column)"
                          aria-hidden="true"
                        />
                        <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                          <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                        </template>
                      </span>
                      <template v-else-if="column.kind === 'time'">{{ fieldValue(entry.row, column.key) !== '' ? timeText(fieldValue(entry.row, column.key), column.timeFormat) : columnEmpty(column) }}</template>
                      <div v-else class="sdk-object-list-cell" :class="{ 'has-icon': Boolean(columnIconName(entry.row, column)) }">
                        <span v-if="columnIconName(entry.row, column)" class="sdk-object-list-cell-icon" :data-icon="columnIconName(entry.row, column)" aria-hidden="true">
                          <component :is="appIcon(columnIconName(entry.row, column)!)" :size="16" :stroke-width="1.75" />
                        </span>
                        <div class="sdk-object-list-cell-text">
                          <button
                            v-if="isPinnedPrimaryColumn(colIndex) && rowActivatable && !isRowExpandActivation"
                            type="button"
                            class="sdk-object-list-primary-link"
                            @click.stop="choose(entry.row)"
                          >
                            <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                            </template>
                          </button>
                          <span v-else class="sdk-object-list-cell-main">
                            <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                            </template>
                          </span>
                          <span v-if="subtitleSegments(entry.row, column).length" class="sdk-object-list-cell-sub">
                            <template v-for="(part, index) in subtitleSegments(entry.row, column)" :key="index">
                              <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                            </template>
                          </span>
                        </div>
                      </div>
                    </list-row-slot-host>
                    <span
                      v-else-if="isCellAwaitingSupplement(entry.row, column.key)"
                      class="sdk-object-list-cell-pending"
                      aria-busy="true"
                    >…</span>
                    <TypedValue
                      v-else-if="usesTypedValueCell(entry.row, column)"
                      :value="rawRecordField(entry.row, column.key)"
                      :field="column.key"
                      :kind="Array.isArray(rawRecordField(entry.row, column.key)) ? (column.kind === 'tags' ? 'tags' : 'list') : 'reference'"
                      :list-style="column.kind === 'tags' ? 'tags' : (column.listStyle ?? 'inline')"
                      :separator="column.listSeparator ?? ', '"
                      :empty-text="columnEmpty(column)"
                      @navigate="(ref) => navigateTo(ref, column.key)"
                      @navigate-child="(ref) => navigateToChild(ref, column.key)"
                    />
                    <button
                      v-else-if="column.kind !== 'text' && referenceField(entry.row, column.key)"
                      type="button"
                      class="sdk-object-ref-link"
                      @click.stop="navigateTo(toFieldReference(referenceField(entry.row, column.key)!), column.key)"
                    >
                      <template v-for="(part, index) in textSegmentsFor(entry.row, column.key, referenceDisplayLabel(referenceField(entry.row, column.key)!))" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </button>
                    <span v-else-if="Array.isArray(rawRecordField(entry.row, column.key)) || column.kind === 'tags'" class="sdk-object-list-item-tags">
                      <template v-for="(item, itemIndex) in recordFieldArrayItems(entry.row, column.key)" :key="itemIndex">
                        <button
                          v-if="isRecordChildReference(item)"
                          type="button"
                          class="sdk-object-ref-link"
                          @click.stop="navigateToChild(toChildFieldReference(item), column.key)"
                        >
                          {{ childReferenceDisplayLabel(item) }}
                        </button>
                        <button
                          v-else-if="isRecordReference(item)"
                          type="button"
                          class="sdk-object-ref-link"
                          @click.stop="navigateTo(toFieldReference(item), column.key)"
                        >
                          {{ referenceDisplayLabel(item) }}
                        </button>
                        <span
                          v-else
                          class="sdk-object-list-tag"
                          :data-tone="resolveTagArrayItem(item, column).tone"
                          :data-effect="column.tagEffect"
                        >
                          <component
                            :is="appIcon(resolveTagArrayItem(item, column).icon!)"
                            v-if="resolveTagArrayItem(item, column).icon"
                            :size="13"
                            :stroke-width="2"
                            class="sdk-object-list-tag-icon"
                            :data-icon="resolveTagArrayItem(item, column).icon"
                            aria-hidden="true"
                          />
                          <span>{{ resolveTagArrayItem(item, column).label }}</span>
                        </span>
                      </template>
                      <template v-if="!recordFieldArrayItems(entry.row, column.key).length">{{ columnEmpty(column) }}</template>
                    </span>
                    <span
                      v-else-if="columnIsTag(entry.row, column)"
                      class="sdk-object-list-tag"
                      :data-tone="columnTone(entry.row, column)"
                      :data-effect="column.tagEffect"
                    >
                      <component
                        :is="appIcon(columnTagIcon(entry.row, column)!)"
                        v-if="columnTagIcon(entry.row, column)"
                        :size="13"
                        :stroke-width="2"
                        class="sdk-object-list-tag-icon"
                        :data-icon="columnTagIcon(entry.row, column)"
                        aria-hidden="true"
                      />
                      <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <template v-else-if="column.kind === 'time'">{{ fieldValue(entry.row, column.key) !== '' ? timeText(fieldValue(entry.row, column.key), column.timeFormat) : columnEmpty(column) }}</template>
                    <div v-else class="sdk-object-list-cell" :class="{ 'has-icon': Boolean(columnIconName(entry.row, column)) }">
                      <span v-if="columnIconName(entry.row, column)" class="sdk-object-list-cell-icon" :data-icon="columnIconName(entry.row, column)" aria-hidden="true">
                        <component :is="appIcon(columnIconName(entry.row, column)!)" :size="16" :stroke-width="1.75" />
                      </span>
                      <div class="sdk-object-list-cell-text">
                        <button
                          v-if="isPinnedPrimaryColumn(colIndex) && rowActivatable && !isRowExpandActivation"
                          type="button"
                          class="sdk-object-list-primary-link"
                          @click.stop="choose(entry.row)"
                        >
                          <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                            <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                          </template>
                        </button>
                        <span v-else class="sdk-object-list-cell-main">
                          <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                            <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                          </template>
                        </span>
                        <span v-if="subtitleSegments(entry.row, column).length" class="sdk-object-list-cell-sub">
                          <template v-for="(part, index) in subtitleSegments(entry.row, column)" :key="index">
                            <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                          </template>
                        </span>
                      </div>
                    </div>
                    </div>
                  </td>
                  <td
                    v-if="hasActionColumn"
                    class="sdk-object-list-actions-col"
                    :class="{ 'sdk-object-list-actions-fixed': rowActions?.fixed === 'right' }"
                    :style="actionColumnStyle"
                    @click.stop
                  >
                    <list-row-slot-host
                      v-if="hasActionsSlot"
                      :list-slot="member.key"
                      :row-ref="rowObjectRef(entry.row)"
                      :index="entry.rowIndex"
                      :operations="rowOperationsFor(entry.row)"
                      :operation-results="rowResultsFor(entry.row)"
                      :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                      :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                      :render-slot="slots.actions!"
                      :slot-props="rowActionsSlotProps(entry.row, entry.rowIndex)"
                      :fallback-to-default="Boolean(rowActions && rowActions.items.length > 0)"
                    >
                      <ObjectListRowActions
                        :items="resolvedRowActionsFor(entry.row)"
                        :max-visible="rowActions?.maxVisible ?? 2"
                        :busy="isRowBusy(entry.row)"
                        :row-label="entry.row.label || entry.row.primaryKey"
                        :icon-variant="effectiveRowActionIconVariant"
                        @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                      />
                    </list-row-slot-host>
                    <ObjectListRowActions
                      v-else
                      :items="resolvedRowActionsFor(entry.row)"
                      :max-visible="rowActions?.maxVisible ?? 2"
                      :busy="isRowBusy(entry.row)"
                      :row-label="entry.row.label || entry.row.primaryKey"
                      :icon-variant="effectiveRowActionIconVariant"
                      @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                    />
                  </td>
                  <td v-if="showRowChevron" class="sdk-object-list-chevron-col" aria-hidden="true">
                    <svg class="sdk-object-list-row-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M6 3.5 10.5 8 6 12.5" />
                    </svg>
                  </td>
                  <td v-if="showTrailingExpandColumn" class="sdk-object-list-expand-trailing-col">
                    <button
                      type="button"
                      class="sdk-object-list-expand-btn sdk-object-list-expand-trailing-btn"
                      data-row-expand-indicator="true"
                      :aria-expanded="isRowExpanded(entry.row)"
                      :aria-label="rowExpandAriaLabel(entry.row)"
                      @click.stop="toggleRowExpanded(entry.row)"
                    >
                      <component
                        :is="curatedIcon(isRowExpanded(entry.row) ? 'chevron-up' : 'chevron-down')"
                        :size="16"
                        class="sdk-object-list-expand-chevron"
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                </tr>
                <tr
                  v-if="shouldShowRowDetail(entry.row)"
                  :ref="(el) => setDetailElement(entry.key, el)"
                  class="sdk-object-list-detail-row"
                >
                  <td :colspan="tableColumnCount" class="sdk-object-list-detail-cell sdk-object-list-detail-host">
                    <RowDetailFormScope
                      v-if="hasRowDetailSlot"
                      :row-key="entry.key"
                      :on-register="registerRowDetailForm"
                    >
                      <list-row-slot-host
                        :list-slot="member.key"
                        :row-ref="rowObjectRef(entry.row)"
                        :item-key="rowItemKey(entry.row)"
                        :index="entry.rowIndex"
                        :operations="rowOperationsFor(entry.row)"
                        :operation-results="rowResultsFor(entry.row)"
                        :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                        :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                        :render-slot="slots['row-detail']!"
                        :slot-props="{
                          ...rowRefSlotProps(entry.row, entry.rowIndex),
                          collapse: () => requestCollapseRow(entry.row),
                          operationResults: rowResultsFor(entry.row),
                          clearOperationResult: (opName?: string) => clearRowOperationResult(entry.key, opName),
                        }"
                      />
                    </RowDetailFormScope>
                    <div v-else class="sdk-object-list-row-result-panel">
                      <div class="sdk-object-list-row-result-header">
                        <button
                          type="button"
                          class="sdk-object-list-row-result-close"
                          :aria-label="t('platform.listRowResultClose')"
                          :title="t('platform.listRowResultClose')"
                          @click.stop="clearRowOperationResult(entry.key)"
                        >
                          {{ t("platform.listRowResultClose") }}
                        </button>
                      </div>
                      <div
                        v-for="item in rowOperationFeedbackEntries(entry.row)"
                        :key="item.operationName"
                        class="sdk-object-list-row-result-entry"
                        :data-operation="item.operationName"
                      >
                        <p v-if="item.state.error" class="sdk-object-list-op-alert" role="alert">{{ item.state.error }}</p>
                        <OperationResult
                          v-if="item.state.result"
                          :result="item.state.result"
                          :operation-slot="member.key"
                          :operation-name="item.operationName"
                        />
                        <template v-if="item.state.receipt && !(item.state.receipt.kind === 'dispatched' && item.state.receipt.outcome?.kind === 'success')">
                          <p v-if="item.state.receipt.kind === 'not-dispatched'" class="sdk-object-list-op-alert" role="alert">{{ item.state.receipt.message }}</p>
                          <p v-else-if="!item.state.receipt.outcome" class="sdk-object-list-op-alert" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
                          <OperationBatchReceipt v-else-if="item.state.receipt.outcome.kind === 'batch'" :items="item.state.receipt.outcome.items" :named="item.state.named ?? []" />
                          <p v-else class="sdk-object-list-op-alert" role="alert" :data-outcome="item.state.receipt.outcome.kind">{{ saidRowOp(item.state.receipt.outcome) }}</p>
                        </template>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
            </template>
            <tr v-if="isVirtualized && virtualBottomPadding > 0" class="sdk-object-list-virtual-spacer-row" aria-hidden="true">
              <td :colspan="tableColumnCount" class="sdk-object-list-virtual-spacer-cell" :style="{ height: `${virtualBottomPadding}px` }"></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="isTabs" class="sdk-object-list-tabs-bar" :class="{ 'is-pill': tabsVariant === 'pill' }">
        <button
          v-if="tabsCanScrollLeft"
          type="button"
          class="sdk-object-list-tabs-scroll-btn"
          data-testid="object-list-tabs-scroll-left"
          aria-label="Scroll tabs left"
          @click="scrollTabsBy(-1)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div
          ref="tabsScrollerRef"
          class="sdk-object-list-tabs-scroller"
          role="tablist"
          @scroll.passive="updateTabsOverflow"
        >
          <div
            v-for="(row, rowIndex) in rows"
            :key="rowIdentityKey(row)"
            :ref="(el) => setRowElement(rowIdentityKey(row), el)"
            role="tab"
            class="sdk-object-list-tab"
            :aria-selected="rowIdentityKey(row) === chosenIdentity"
            :tabindex="rowIdentityKey(row) === chosenIdentity || (chosenIdentity === null && rowIndex === 0) ? 0 : -1"
            :class="{
              chosen: rowIdentityKey(row) === chosenIdentity,
              'is-non-selectable': !rowActivatable,
              'has-actions': !isTabRenaming(row) && hasActionColumn && (Boolean(slots.actions) || resolvedRowActionsFor(row).length > 0),
              'is-menu-open': openTabMenuKey === rowIdentityKey(row),
              'is-renaming': isTabRenaming(row),
            }"
            @click="!isTabRenaming(row) && rowActivatable ? choose(row) : undefined"
            @keydown="onTabKeydown(row, rowIndex, $event)"
          >
            <input
              v-if="isTabRenaming(row)"
              :ref="setInlineRenameInput"
              v-model="inlineRenameDraft"
              type="text"
              class="sdk-object-list-tab-rename-input"
              data-testid="object-list-tab-rename-input"
              :aria-label="row.label"
              @click.stop
              @keydown="onInlineRenameKeydown(row, rowIndex, $event)"
              @blur="commitTabInlineRename(row, rowIndex)"
            />
            <template v-else>
              <StatusDot
                v-if="statusField && statusStyle === 'dot' && fieldValue(row, statusField) !== ''"
                :tone="statusFieldTone(row, statusField)"
                :title="fieldValue(row, statusField)"
              />
              <span
                v-if="hasRowDraft(row)"
                class="sdk-object-list-draft-dot"
                :title="t('platform.formDraftIndicator')"
                :aria-label="t('platform.formDraftIndicator')"
              ></span>
              <span class="sdk-object-list-tab-label" :title="row.label">
                <template v-for="(part, index) in textSegmentsFor(row, 'label', row.label)" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span
                v-if="statusField && statusStyle !== 'dot' && fieldValue(row, statusField) !== ''"
                class="sdk-object-list-tag"
                :data-tone="statusFieldTone(row, statusField)"
              >{{ fieldValue(row, statusField) }}</span>
              <div
                v-if="hasActionColumn && (slots.actions || resolvedRowActionsFor(row).length > 0)"
                class="sdk-object-list-tab-actions"
                @click.stop
              >
                <list-row-slot-host
                  v-if="slots.actions"
                  :list-slot="member.key"
                  :row-ref="rowObjectRef(row)"
                  :index="rowIndex"
                  :operations="rowOperationsFor(row)"
                  :operation-results="rowResultsFor(row)"
                  :run-operation="(opName, extra) => runRowOperation(row, opName, extra)"
                  :clear-operation-result="(opName) => clearRowOperationResult(rowIdentityKey(row), opName)"
                  :render-slot="slots.actions!"
                  :slot-props="rowActionsSlotProps(row, rowIndex)"
                />
                <ObjectListRowActions
                  v-else
                  :items="resolvedRowActionsFor(row)"
                  :max-visible="0"
                  :busy="isRowBusy(row)"
                  :row-label="row.label || row.primaryKey"
                  :icon-variant="effectiveRowActionIconVariant"
                  @menu-open-change="(open) => onTabMenuOpenChange(rowIdentityKey(row), open)"
                  @trigger="(item, ev) => triggerRowAction(row, rowIndex, item, ev)"
                />
              </div>
            </template>
          </div>
        </div>
        <button
          v-if="tabsCanScrollRight"
          type="button"
          class="sdk-object-list-tabs-scroll-btn"
          data-testid="object-list-tabs-scroll-right"
          aria-label="Scroll tabs right"
          @click="scrollTabsBy(1)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
        <div v-if="$slots['tabs-extra']" class="sdk-object-list-tabs-extra">
          <slot name="tabs-extra"></slot>
        </div>
      </div>

      <div v-else-if="isAccordion" class="sdk-object-list-accordion">
        <div
          v-for="(row, rowIndex) in rows"
          :key="rowIdentityKey(row)"
          :ref="(el) => setRowElement(rowIdentityKey(row), el)"
          class="sdk-object-list-accordion-item"
          :class="{ 'is-expanded': isRowExpanded(row) }"
          :data-row-key="rowIdentityKey(row)"
          :data-expanded="isRowExpanded(row) ? 'true' : undefined"
        >
          <div class="sdk-object-list-accordion-header">
            <button
              type="button"
              class="sdk-object-list-accordion-summary"
              :aria-expanded="isRowExpanded(row)"
              @click="toggleRowExpanded(row)"
            >
              <span v-if="!isRowExpandActivation" class="sdk-object-list-accordion-arrow" aria-hidden="true">
                <component :is="curatedIcon('chevron-right')" :size="14" aria-hidden="true" />
              </span>
              <span class="sdk-object-list-accordion-heading">
                <strong class="sdk-object-list-accordion-title">
                  <template v-for="(part, index) in textSegmentsFor(row, 'label', row.label || row.primaryKey)" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </strong>
                <code v-if="accordionSubtitleText(row)" class="sdk-object-list-accordion-code">{{ accordionSubtitleText(row) }}</code>
              </span>
              <span
                v-if="statusField && fieldValue(row, statusField) !== ''"
                class="sdk-object-list-tag"
                :data-tone="statusFieldTone(row, statusField)"
              >{{ fieldValue(row, statusField) }}</span>
              <span
                v-if="isRowExpandActivation"
                class="sdk-object-list-expand-chevron"
                data-row-expand-indicator="true"
                aria-hidden="true"
              >
                <component
                  :is="curatedIcon(isRowExpanded(row) ? 'chevron-up' : 'chevron-down')"
                  :size="16"
                  aria-hidden="true"
                />
              </span>
            </button>
            <div v-if="hasActionColumn" class="sdk-object-list-accordion-actions" @click.stop>
              <ObjectListRowActions
                :items="resolvedRowActionsFor(row)"
                :max-visible="rowActions?.maxVisible ?? 2"
                :row-label="row.label || row.primaryKey"
                :icon-variant="effectiveRowActionIconVariant"
                @trigger="(item, ev) => triggerRowAction(row, rowIndex, item, ev)"
              />
            </div>
          </div>
          <div v-if="isRowExpanded(row)" class="sdk-object-list-accordion-body">
            <div v-if="hasRowDetailSlot" class="sdk-object-list-detail-host">
              <RowDetailFormScope :row-key="rowIdentityKey(row)" :on-register="registerRowDetailForm">
                <list-row-slot-host
                  :list-slot="member.key"
                  :row-ref="rowObjectRef(row)"
                  :item-key="rowItemKey(row)"
                  :index="rowIndex"
                  :operations="rowOperationsFor(row)"
                  :operation-results="rowResultsFor(row)"
                  :run-operation="(opName, extra) => runRowOperation(row, opName, extra)"
                  :clear-operation-result="(opName) => clearRowOperationResult(rowIdentityKey(row), opName)"
                  :render-slot="slots['row-detail']!"
                  :slot-props="{
                    ...rowRefSlotProps(row, rowIndex),
                    collapse: () => requestCollapseRow(row),
                    operationResults: rowResultsFor(row),
                    clearOperationResult: (opName?: string) => clearRowOperationResult(rowIdentityKey(row), opName),
                  }"
                />
              </RowDetailFormScope>
            </div>
            <template v-else>
              <template v-for="field in accordionBodyFields(row)" :key="field.key">
                <div v-if="field.label" class="sdk-object-list-accordion-detail-label">
                  {{ field.label }}
                </div>
                <pre v-if="field.isPre" class="sdk-object-list-accordion-pre">{{ field.text }}</pre>
                <p v-else class="sdk-object-list-accordion-desc">{{ field.text }}</p>
              </template>
              <div
                v-if="effectiveRowResultDisplay === 'expand' && rowOperationFeedbackEntries(row).length > 0"
                class="sdk-object-list-row-result-panel"
              >
                <div class="sdk-object-list-row-result-header">
                  <button
                    type="button"
                    class="sdk-object-list-row-result-close"
                    :aria-label="t('platform.listRowResultClose')"
                    :title="t('platform.listRowResultClose')"
                    @click.stop="clearRowOperationResult(rowIdentityKey(row))"
                  >
                    {{ t("platform.listRowResultClose") }}
                  </button>
                </div>
                <div
                  v-for="item in rowOperationFeedbackEntries(row)"
                  :key="item.operationName"
                  class="sdk-object-list-row-result-entry"
                  :data-operation="item.operationName"
                >
                  <p v-if="item.state.error" class="sdk-object-list-op-alert" role="alert">{{ item.state.error }}</p>
                  <OperationResult
                    v-if="item.state.result"
                    :result="item.state.result"
                    :operation-slot="member.key"
                    :operation-name="item.operationName"
                  />
                  <template v-if="item.state.receipt && !(item.state.receipt.kind === 'dispatched' && item.state.receipt.outcome?.kind === 'success')">
                    <p v-if="item.state.receipt.kind === 'not-dispatched'" class="sdk-object-list-op-alert" role="alert">{{ item.state.receipt.message }}</p>
                    <p v-else-if="!item.state.receipt.outcome" class="sdk-object-list-op-alert" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
                    <OperationBatchReceipt v-else-if="item.state.receipt.outcome.kind === 'batch'" :items="item.state.receipt.outcome.items" :named="item.state.named ?? []" />
                    <p v-else class="sdk-object-list-op-alert" role="alert" :data-outcome="item.state.receipt.outcome.kind">{{ saidRowOp(item.state.receipt.outcome) }}</p>
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div
        v-else-if="isCards"
        ref="scrollContainerRef"
        :role="rowSelectable ? 'listbox' : undefined"
        class="sdk-object-list-cards"
        :data-virtualized="isVirtualized ? 'true' : undefined"
        @scroll="onContainerScroll"
      >
        <div
          v-if="isVirtualized && virtualTopPadding > 0"
          class="sdk-object-list-virtual-spacer sdk-object-list-card-spacer"
          aria-hidden="true"
          :style="{ height: `${virtualTopPadding}px` }"
        ></div>
        <template v-for="entry in renderedItems" :key="entry.key">
          <div
            v-if="entry.kind === 'group'"
            :ref="(el) => setGroupHeaderElement(entry.key, el)"
            role="presentation"
            class="sdk-object-list-group-header sdk-object-list-card-group-header"
            :data-group-key="entry.groupKey"
          >
            <button
              type="button"
              class="sdk-object-list-group-btn"
              :aria-expanded="!entry.collapsed"
              @click="toggleGroupCollapsed(entry.groupKey)"
            >
              <span class="sdk-object-list-expand-icon" :class="{ expanded: !entry.collapsed }" aria-hidden="true">▸</span>
              <span class="sdk-object-list-group-label">{{ entry.label }}</span>
              <span class="sdk-object-list-group-count">{{ entry.count }}</span>
            </button>
          </div>
          <article
            v-else
            :ref="(el) => setRowElement(entry.key, el)"
            :role="rowSelectable ? 'option' : ((rowActivatable || isRowExpandActivation) ? 'button' : undefined)"
            :tabindex="rowActivatable || isRowExpandActivation ? 0 : undefined"
            class="sdk-object-list-card"
            :data-expanded="isRowExpanded(entry.row) ? 'true' : undefined"
            :aria-selected="rowSelectable ? entry.key === chosenIdentity : undefined"
            :aria-expanded="isRowExpandActivation ? isRowExpanded(entry.row) : undefined"
            :class="{ chosen: entry.key === chosenIdentity, expanded: isRowExpandActivation && isRowExpanded(entry.row), 'is-non-selectable': !rowActivatable && !isRowExpandActivation }"
            @click="(rowActivatable || isRowExpandActivation) ? onCardClick(entry.row, $event) : undefined"
            @keydown="(rowActivatable || isRowExpandActivation) ? onCardKeydown(entry.row, $event) : undefined"
          >
            <list-row-slot-host
              v-if="slots.card"
              :list-slot="member.key"
              :row-ref="rowObjectRef(entry.row)"
              :item-key="rowItemKey(entry.row)"
              :index="entry.rowIndex"
              :operations="rowOperationsFor(entry.row)"
              :operation-results="rowResultsFor(entry.row)"
              :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
              :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
              :render-slot="slots.card!"
              :slot-props="cardSlotProps(entry.row, entry.rowIndex, entry.key)"
              :fallback-to-default="true"
            >
              <div class="sdk-object-list-card-head">
                <button
                  v-if="showLeadingExpandColumn"
                  type="button"
                  class="sdk-object-list-expand-btn"
                  :aria-expanded="isRowExpanded(entry.row)"
                  :aria-label="rowExpandAriaLabel(entry.row)"
                  @click.stop="toggleRowExpanded(entry.row)"
                >
                  <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(entry.row) }" aria-hidden="true">▸</span>
                </button>
                <input
                  v-if="canCheck"
                  type="checkbox"
                  class="sdk-object-list-card-check"
                  :aria-label="entry.row.label"
                  :checked="checkedIdentityKeys.has(rowCheckKey(entry.row))"
                  :disabled="isRowCheckDisabled(entry.row)"
                  @click.stop
                  @change="toggleChecked(entry.row, ($event.target as HTMLInputElement).checked)"
                />
                <span
                  v-if="hasRowDraft(entry.row)"
                  class="sdk-object-list-draft-dot"
                  :title="t('platform.formDraftIndicator')"
                  :aria-label="t('platform.formDraftIndicator')"
                ></span>
                <span class="sdk-object-list-card-title">
                  <template v-for="(part, index) in textSegmentsFor(entry.row, 'label', entry.row.label)" :key="index">
                    <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                  </template>
                </span>
                <span
                  v-if="statusField && fieldValue(entry.row, statusField) !== ''"
                  class="sdk-object-list-tag"
                  :data-tone="statusFieldTone(entry.row, statusField)"
                >{{ fieldValue(entry.row, statusField) }}</span>
              </div>
              <p
                v-if="fieldValue(entry.row, summaryKey) !== ''"
                class="sdk-object-list-card-sub"
                :class="{ 'sdk-object-list-item-sub-clamped': effectiveCardSubtitleLines !== undefined }"
                :style="{ WebkitLineClamp: effectiveCardSubtitleLines }"
              >
                <template v-for="(part, index) in textSegmentsFor(entry.row, summaryKey, fieldValue(entry.row, summaryKey))" :key="index">
                  <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                </template>
              </p>
            </list-row-slot-host>
            <template v-else>
              <div class="sdk-object-list-card-head">
                <button
                  v-if="showLeadingExpandColumn"
                  type="button"
                  class="sdk-object-list-expand-btn"
                  :aria-expanded="isRowExpanded(entry.row)"
                  :aria-label="rowExpandAriaLabel(entry.row)"
                  @click.stop="toggleRowExpanded(entry.row)"
                >
                  <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(entry.row) }" aria-hidden="true">▸</span>
                </button>
                <input
                  v-if="canCheck"
                  type="checkbox"
                  class="sdk-object-list-card-check"
                  :aria-label="entry.row.label"
                  :checked="checkedIdentityKeys.has(rowCheckKey(entry.row))"
                  :disabled="isRowCheckDisabled(entry.row)"
                  @click.stop
                  @change="toggleChecked(entry.row, ($event.target as HTMLInputElement).checked)"
                />
                <component
                  :is="rowActivatable ? 'button' : 'div'"
                  :type="rowActivatable ? 'button' : undefined"
                  :tabindex="rowActivatable ? -1 : undefined"
                  class="sdk-object-list-card-main"
                  :title="cardTooltip(entry.row)"
                >
                  <span
                    v-if="$slots['item-leading']"
                    class="sdk-object-list-card-leading"
                    aria-hidden="true"
                  >
                    <list-row-slot-host
                      :list-slot="member.key"
                      :row-ref="rowObjectRef(entry.row)"
                      :index="entry.rowIndex"
                      :operations="rowOperationsFor(entry.row)"
                      :operation-results="rowResultsFor(entry.row)"
                      :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                      :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                      :render-slot="slots['item-leading']!"
                      :slot-props="itemLeadingSlotProps(entry.row, entry.rowIndex)"
                    />
                  </span>
                  <span
                    v-else-if="showLeadingIcon"
                    class="sdk-object-list-card-leading is-app-icon"
                    :data-icon-size="resolvedLeadingIconSize()"
                    aria-hidden="true"
                  >
                    <component
                      :is="appIcon(rowLeadingIcon(entry.row) ?? 'app-window')"
                      :size="resolvedLeadingIconSize()"
                      class="sdk-object-list-card-app-icon"
                    />
                  </span>
                  <span class="sdk-object-list-card-content">
                    <span class="sdk-object-list-card-title-row">
                      <span
                        v-if="hasRowDraft(entry.row)"
                        class="sdk-object-list-draft-dot"
                        :title="t('platform.formDraftIndicator')"
                        :aria-label="t('platform.formDraftIndicator')"
                      ></span>
                      <span class="sdk-object-list-card-title">
                        <template v-for="(part, index) in textSegmentsFor(entry.row, 'label', entry.row.label)" :key="index">
                          <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                        </template>
                      </span>
                      <span
                        v-if="statusField && fieldValue(entry.row, statusField) !== ''"
                        class="sdk-object-list-tag"
                        :data-tone="statusFieldTone(entry.row, statusField)"
                      >{{ fieldValue(entry.row, statusField) }}</span>
                    </span>
                    <span
                      v-if="fieldValue(entry.row, summaryKey) !== ''"
                      class="sdk-object-list-card-sub sdk-object-list-item-sub-clamped"
                      :style="{ WebkitLineClamp: effectiveCardSubtitleLines }"
                    >
                      <template v-for="(part, index) in textSegmentsFor(entry.row, summaryKey, fieldValue(entry.row, summaryKey))" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                  </span>
                </component>
                <div v-if="hasActionColumn && cardHeaderActions" class="sdk-object-list-card-header-actions" @click.stop>
                  <ObjectListRowActions
                    :items="resolvedRowActionsFor(entry.row)"
                    :max-visible="rowActions?.maxVisible ?? 2"
                    :busy="isRowBusy(entry.row)"
                    :row-label="entry.row.label || entry.row.primaryKey"
                    :icon-variant="effectiveRowActionIconVariant"
                    @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                  />
                </div>
              </div>
              <dl v-if="visibleColumns.length" class="sdk-object-list-card-fields">
                <template v-for="column in visibleColumns" :key="column.key">
                  <dt class="sdk-object-list-card-field-label">{{ columnLabel(column) }}</dt>
                  <dd class="sdk-object-list-card-field-value" :title="columnCellSlot(column.key) ? undefined : cellTitle(entry.row, column)">
                    <list-row-slot-host
                      v-if="columnCellSlot(column.key)"
                      :list-slot="member.key"
                      :row-ref="rowObjectRef(entry.row)"
                      :index="entry.rowIndex"
                      :operations="rowOperationsFor(entry.row)"
                      :operation-results="rowResultsFor(entry.row)"
                      :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                      :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                      :render-slot="columnCellSlot(column.key)!"
                      :slot-props="cellSlotProps(entry.row, entry.rowIndex, column)"
                      :fallback-to-default="true"
                    >
                      <span
                        v-if="isCellAwaitingSupplement(entry.row, column.key)"
                        class="sdk-object-list-cell-pending"
                        aria-busy="true"
                      >…</span>
                      <template v-else>
                        <template v-for="(part, index) in cellSegments(entry.row, column.key, columnEmpty(column))" :key="index">
                          <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                        </template>
                      </template>
                    </list-row-slot-host>
                    <span
                      v-else-if="isCellAwaitingSupplement(entry.row, column.key)"
                      class="sdk-object-list-cell-pending"
                      aria-busy="true"
                    >…</span>
                    <TypedValue
                      v-else-if="usesTypedValueCell(entry.row, column)"
                      :value="rawRecordField(entry.row, column.key)"
                      :field="column.key"
                      :kind="Array.isArray(rawRecordField(entry.row, column.key)) ? (column.kind === 'tags' ? 'tags' : 'list') : 'reference'"
                      :list-style="column.kind === 'tags' ? 'tags' : (column.listStyle ?? 'inline')"
                      :separator="column.listSeparator ?? ', '"
                      :empty-text="columnEmpty(column)"
                      @navigate="(ref) => navigateTo(ref, column.key)"
                      @navigate-child="(ref) => navigateToChild(ref, column.key)"
                    />
                    <button
                      v-else-if="column.kind !== 'text' && referenceField(entry.row, column.key)"
                      type="button"
                      class="sdk-object-ref-link"
                      @click.stop="navigateTo(toFieldReference(referenceField(entry.row, column.key)!), column.key)"
                    >
                      <template v-for="(part, index) in textSegmentsFor(entry.row, column.key, referenceDisplayLabel(referenceField(entry.row, column.key)!))" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </button>
                    <span v-else-if="Array.isArray(rawRecordField(entry.row, column.key)) || column.kind === 'tags'" class="sdk-object-list-item-tags">
                      <template v-for="(item, itemIndex) in recordFieldArrayItems(entry.row, column.key)" :key="itemIndex">
                        <button
                          v-if="isRecordChildReference(item)"
                          type="button"
                          class="sdk-object-ref-link"
                          @click.stop="navigateToChild(toChildFieldReference(item), column.key)"
                        >
                          {{ childReferenceDisplayLabel(item) }}
                        </button>
                        <button
                          v-else-if="isRecordReference(item)"
                          type="button"
                          class="sdk-object-ref-link"
                          @click.stop="navigateTo(toFieldReference(item), column.key)"
                        >
                          {{ referenceDisplayLabel(item) }}
                        </button>
                        <span
                          v-else
                          class="sdk-object-list-tag"
                          :data-tone="resolveTagArrayItem(item, column).tone"
                          :data-effect="column.tagEffect"
                        >
                          <component
                            :is="appIcon(resolveTagArrayItem(item, column).icon!)"
                            v-if="resolveTagArrayItem(item, column).icon"
                            :size="13"
                            :stroke-width="2"
                            class="sdk-object-list-tag-icon"
                            :data-icon="resolveTagArrayItem(item, column).icon"
                            aria-hidden="true"
                          />
                          <span>{{ resolveTagArrayItem(item, column).label }}</span>
                        </span>
                      </template>
                      <template v-if="!recordFieldArrayItems(entry.row, column.key).length">{{ columnEmpty(column) }}</template>
                    </span>
                    <span
                      v-else-if="columnIsTag(entry.row, column)"
                      class="sdk-object-list-tag"
                      :data-tone="columnTone(entry.row, column)"
                      :data-effect="column.tagEffect"
                    >
                      <component
                        :is="appIcon(columnTagIcon(entry.row, column)!)"
                        v-if="columnTagIcon(entry.row, column)"
                        :size="13"
                        :stroke-width="2"
                        class="sdk-object-list-tag-icon"
                        :data-icon="columnTagIcon(entry.row, column)"
                        aria-hidden="true"
                      />
                      <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <template v-else-if="column.kind === 'time'">{{ fieldValue(entry.row, column.key) !== '' ? timeText(fieldValue(entry.row, column.key), column.timeFormat) : columnEmpty(column) }}</template>
                    <span v-else class="sdk-object-list-card-value">
                      <component
                        :is="appIcon(columnMapped(entry.row, column)!.icon!)"
                        v-if="columnMapped(entry.row, column)?.icon"
                        :size="13"
                        :stroke-width="1.85"
                        class="sdk-object-list-tag-icon"
                        :data-icon="columnMapped(entry.row, column)!.icon"
                        aria-hidden="true"
                      />
                      <template v-for="(part, index) in columnCellSegments(entry.row, column)" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                  </dd>
                </template>
              </dl>
              <div v-if="tagsField && recordFieldArrayItems(entry.row, tagsField).length" class="sdk-object-list-card-tags">
                <template v-for="(item, itemIndex) in recordFieldArrayItems(entry.row, tagsField)" :key="itemIndex">
                  <button
                    v-if="isRecordChildReference(item)"
                    type="button"
                    class="sdk-object-ref-link"
                    @click.stop="navigateToChild(toChildFieldReference(item), tagsField)"
                  >
                    {{ childReferenceDisplayLabel(item) }}
                  </button>
                  <button
                    v-else-if="isRecordReference(item)"
                    type="button"
                    class="sdk-object-ref-link"
                    @click.stop="navigateTo(toFieldReference(item), tagsField)"
                  >
                    {{ referenceDisplayLabel(item) }}
                  </button>
                  <span
                    v-else
                    class="sdk-object-list-tag"
                    :data-tone="resolveTagArrayItem(item).tone"
                  >
                    <component
                      :is="appIcon(resolveTagArrayItem(item).icon!)"
                      v-if="resolveTagArrayItem(item).icon"
                      :size="13"
                      :stroke-width="2"
                      class="sdk-object-list-tag-icon"
                      :data-icon="resolveTagArrayItem(item).icon"
                      aria-hidden="true"
                    />
                    <span>{{ resolveTagArrayItem(item).label }}</span>
                  </span>
                </template>
              </div>
              <div v-if="hasActionColumn && !cardHeaderActions" class="sdk-object-list-card-actions" @click.stop>
                <list-row-slot-host
                  v-if="hasActionsSlot"
                  :list-slot="member.key"
                  :row-ref="rowObjectRef(entry.row)"
                  :index="entry.rowIndex"
                  :operations="rowOperationsFor(entry.row)"
                  :operation-results="rowResultsFor(entry.row)"
                  :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                  :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                  :render-slot="slots.actions!"
                  :slot-props="rowActionsSlotProps(entry.row, entry.rowIndex)"
                  :fallback-to-default="Boolean(rowActions && rowActions.items.length > 0)"
                >
                  <ObjectListRowActions
                    :items="resolvedRowActionsFor(entry.row)"
                    :max-visible="rowActions?.maxVisible ?? 2"
                    :busy="isRowBusy(entry.row)"
                    :row-label="entry.row.label || entry.row.primaryKey"
                    :icon-variant="effectiveRowActionIconVariant"
                    @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                  />
                </list-row-slot-host>
                <ObjectListRowActions
                  v-else
                  :items="resolvedRowActionsFor(entry.row)"
                  :max-visible="rowActions?.maxVisible ?? 2"
                  :busy="isRowBusy(entry.row)"
                  :row-label="entry.row.label || entry.row.primaryKey"
                  :icon-variant="effectiveRowActionIconVariant"
                  @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                />
              </div>
            </template>
            <div
              v-if="shouldShowRowDetail(entry.row)"
              :ref="(el) => setDetailElement(entry.key, el)"
              class="sdk-object-list-card-detail sdk-object-list-detail-host"
              @click.stop
            >
              <RowDetailFormScope
                v-if="hasRowDetailSlot"
                :row-key="entry.key"
                :on-register="registerRowDetailForm"
              >
                <list-row-slot-host
                  :list-slot="member.key"
                  :row-ref="rowObjectRef(entry.row)"
                  :item-key="rowItemKey(entry.row)"
                  :index="entry.rowIndex"
                  :operations="rowOperationsFor(entry.row)"
                  :operation-results="rowResultsFor(entry.row)"
                  :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                  :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                  :render-slot="slots['row-detail']!"
                  :slot-props="{
                    ...rowRefSlotProps(entry.row, entry.rowIndex),
                    collapse: () => requestCollapseRow(entry.row),
                    operationResults: rowResultsFor(entry.row),
                    clearOperationResult: (opName?: string) => clearRowOperationResult(entry.key, opName),
                  }"
                />
              </RowDetailFormScope>
              <div v-else class="sdk-object-list-row-result-panel">
                <div class="sdk-object-list-row-result-header">
                  <button
                    type="button"
                    class="sdk-object-list-row-result-close"
                    :aria-label="t('platform.listRowResultClose')"
                    :title="t('platform.listRowResultClose')"
                    @click.stop="clearRowOperationResult(entry.key)"
                  >
                    {{ t("platform.listRowResultClose") }}
                  </button>
                </div>
                <div
                  v-for="item in rowOperationFeedbackEntries(entry.row)"
                  :key="item.operationName"
                  class="sdk-object-list-row-result-entry"
                  :data-operation="item.operationName"
                >
                  <p v-if="item.state.error" class="sdk-object-list-op-alert" role="alert">{{ item.state.error }}</p>
                  <OperationResult
                    v-if="item.state.result"
                    :result="item.state.result"
                    :operation-slot="member.key"
                    :operation-name="item.operationName"
                  />
                  <template v-if="item.state.receipt && !(item.state.receipt.kind === 'dispatched' && item.state.receipt.outcome?.kind === 'success')">
                    <p v-if="item.state.receipt.kind === 'not-dispatched'" class="sdk-object-list-op-alert" role="alert">{{ item.state.receipt.message }}</p>
                    <p v-else-if="!item.state.receipt.outcome" class="sdk-object-list-op-alert" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
                    <OperationBatchReceipt v-else-if="item.state.receipt.outcome.kind === 'batch'" :items="item.state.receipt.outcome.items" :named="item.state.named ?? []" />
                    <p v-else class="sdk-object-list-op-alert" role="alert" :data-outcome="item.state.receipt.outcome.kind">{{ saidRowOp(item.state.receipt.outcome) }}</p>
                  </template>
                </div>
              </div>
            </div>
          </article>
        </template>
        <div
          v-if="isVirtualized && virtualBottomPadding > 0"
          class="sdk-object-list-virtual-spacer sdk-object-list-card-spacer"
          aria-hidden="true"
          :style="{ height: `${virtualBottomPadding}px` }"
        ></div>
      </div>

      <ul
        v-else
        ref="scrollContainerRef"
        :role="rowSelectable ? 'listbox' : undefined"
        class="sdk-object-list-items"
        :data-row-density="listHasTwoLines ? 'two-line' : 'single'"
        :data-virtualized="isVirtualized ? 'true' : undefined"
        @scroll="onContainerScroll"
      >
        <li
          v-if="isVirtualized && virtualTopPadding > 0"
          class="sdk-object-list-virtual-spacer"
          aria-hidden="true"
          :style="{ height: `${virtualTopPadding}px` }"
        ></li>
        <template v-for="entry in renderedItems" :key="entry.key">
          <li
            v-if="entry.kind === 'group'"
            :ref="(el) => setGroupHeaderElement(entry.key, el)"
            role="presentation"
            class="sdk-object-list-group-header"
            :data-group-key="entry.groupKey"
          >
            <button
              type="button"
              class="sdk-object-list-group-btn"
              :aria-expanded="!entry.collapsed"
              @click="toggleGroupCollapsed(entry.groupKey)"
            >
              <span class="sdk-object-list-expand-icon" :class="{ expanded: !entry.collapsed }" aria-hidden="true">▸</span>
              <span class="sdk-object-list-group-label">{{ entry.label }}</span>
              <span class="sdk-object-list-group-count">{{ entry.count }}</span>
            </button>
          </li>
          <li
            v-else
            :ref="(el) => setRowElement(entry.key, el)"
            class="sdk-object-list-row"
            :data-expanded="isRowExpanded(entry.row) ? 'true' : undefined"
            :class="{ chosen: entry.key === chosenIdentity, expanded: isRowExpandActivation && isRowExpanded(entry.row), 'is-non-selectable': !rowSelectable && !isRowExpandActivation }"
          >
            <div class="sdk-object-list-row-main">
              <button
                v-if="showLeadingExpandColumn"
                type="button"
                class="sdk-object-list-expand-btn sdk-object-list-row-expand"
                :aria-expanded="isRowExpanded(entry.row)"
                :aria-label="rowExpandAriaLabel(entry.row)"
                @click.stop="toggleRowExpanded(entry.row)"
              >
                <span class="sdk-object-list-expand-icon" :class="{ expanded: isRowExpanded(entry.row) }" aria-hidden="true">▸</span>
              </button>
              <input
                v-if="canCheck"
                type="checkbox"
                class="sdk-object-list-row-check"
                :aria-label="entry.row.label"
                :checked="checkedIdentityKeys.has(rowCheckKey(entry.row))"
                :disabled="isRowCheckDisabled(entry.row)"
                @change="toggleChecked(entry.row, ($event.target as HTMLInputElement).checked)"
              />
              <component
                :is="(rowSelectable || isRowExpandActivation) ? 'button' : 'div'"
                :type="(rowSelectable || isRowExpandActivation) ? 'button' : undefined"
                :role="rowSelectable ? 'option' : undefined"
                class="sdk-object-list-item-btn"
                :data-row-density="listHasTwoLines ? 'two-line' : 'single'"
                :aria-selected="rowSelectable ? entry.key === chosenIdentity : undefined"
                :aria-expanded="isRowExpandActivation ? isRowExpanded(entry.row) : undefined"
                :class="{
                  chosen: entry.key === chosenIdentity,
                  'is-non-selectable': !rowSelectable && !isRowExpandActivation,
                  'sdk-object-list-item-two-line': listHasTwoLines,
                  'has-leading': Boolean($slots['item-leading'] || showLeadingIcon),
                  'has-chevron': showListChevron,
                }"
                @click="(rowSelectable || isRowExpandActivation) ? onListItemClick(entry.row, $event) : undefined"
                @keydown="(rowSelectable || isRowExpandActivation) ? onListItemKeydown(entry.row, $event) : undefined"
              >
                <span v-if="$slots['item-leading']" class="sdk-object-list-item-leading" aria-hidden="true">
                  <list-row-slot-host
                    :list-slot="member.key"
                    :row-ref="rowObjectRef(entry.row)"
                    :index="entry.rowIndex"
                    :operations="rowOperationsFor(entry.row)"
                    :operation-results="rowResultsFor(entry.row)"
                    :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                    :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                    :render-slot="slots['item-leading']!"
                    :slot-props="itemLeadingSlotProps(entry.row, entry.rowIndex)"
                  />
                </span>
                <span
                  v-else-if="showLeadingIcon"
                  class="sdk-object-list-item-leading is-app-icon"
                  :data-icon-size="resolvedLeadingIconSize()"
                  aria-hidden="true"
                >
                  <component
                    :is="appIcon(rowLeadingIcon(entry.row) ?? 'app-window')"
                    :size="resolvedLeadingIconSize()"
                    class="sdk-object-list-card-app-icon"
                  />
                </span>
                <span class="sdk-object-list-item-content">
                  <span class="sdk-object-list-item-head" :class="{ 'sdk-object-list-item-head-dot': statusStyle === 'dot' }">
                    <StatusDot
                      v-if="statusField && statusStyle === 'dot' && fieldValue(entry.row, statusField) !== ''"
                      :tone="statusFieldTone(entry.row, statusField)"
                      :title="fieldValue(entry.row, statusField)"
                      aria-hidden
                    />
                    <span
                      v-if="hasRowDraft(entry.row)"
                      class="sdk-object-list-draft-dot"
                      :title="t('platform.formDraftIndicator')"
                      :aria-label="t('platform.formDraftIndicator')"
                    ></span>
                    <span class="sdk-object-list-item-label">
                      <template v-for="(part, index) in textSegmentsFor(entry.row, 'label', entry.row.label)" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <span
                      v-if="statusField && statusStyle !== 'dot' && fieldValue(entry.row, statusField) !== ''"
                      class="sdk-object-list-tag"
                      :data-tone="statusFieldTone(entry.row, statusField)"
                    >{{ fieldValue(entry.row, statusField) }}</span>
                  </span>
                  <span
                    v-if="effectiveMetaField && (fieldValue(entry.row, summaryKey) !== '' || fieldValue(entry.row, effectiveMetaField) !== '')"
                    class="sdk-object-list-item-sub-row"
                  >
                    <span
                      class="sdk-object-list-item-sub"
                      :class="{ 'sdk-object-list-item-sub-clamped': subtitleLines !== undefined }"
                      :style="{ WebkitLineClamp: subtitleLines }"
                    >
                      <template v-for="(part, index) in textSegmentsFor(entry.row, summaryKey, fieldValue(entry.row, summaryKey))" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                    <span v-if="fieldValue(entry.row, effectiveMetaField) !== ''" class="sdk-object-list-item-meta">
                      <template v-for="(part, index) in textSegmentsFor(entry.row, effectiveMetaField, fieldValue(entry.row, effectiveMetaField))" :key="index">
                        <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                      </template>
                    </span>
                  </span>
                  <span
                    v-else-if="fieldValue(entry.row, summaryKey) !== ''"
                    class="sdk-object-list-item-sub"
                    :class="{ 'sdk-object-list-item-sub-clamped': subtitleLines !== undefined }"
                    :style="{ WebkitLineClamp: subtitleLines }"
                  >
                    <template v-for="(part, index) in textSegmentsFor(entry.row, summaryKey, fieldValue(entry.row, summaryKey))" :key="index">
                      <mark v-if="part.hit">{{ part.text }}</mark><template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                  <span v-if="tagsField && recordFieldArrayItems(entry.row, tagsField).length" class="sdk-object-list-item-tags">
                    <template v-for="(item, itemIndex) in recordFieldArrayItems(entry.row, tagsField)" :key="itemIndex">
                      <span
                        v-if="isRecordChildReference(item)"
                        role="link"
                        tabindex="0"
                        class="sdk-object-ref-link"
                        @click.stop="navigateToChild(toChildFieldReference(item), tagsField)"
                        @keydown.enter.stop.prevent="navigateToChild(toChildFieldReference(item), tagsField)"
                      >
                        {{ childReferenceDisplayLabel(item) }}
                      </span>
                      <span
                        v-else-if="isRecordReference(item)"
                        role="link"
                        tabindex="0"
                        class="sdk-object-ref-link"
                        @click.stop="navigateTo(toFieldReference(item), tagsField)"
                        @keydown.enter.stop.prevent="navigateTo(toFieldReference(item), tagsField)"
                      >
                        {{ referenceDisplayLabel(item) }}
                      </span>
                      <span
                        v-else
                        class="sdk-object-list-tag"
                        :data-tone="resolveTagArrayItem(item).tone"
                      >
                        <component
                          :is="appIcon(resolveTagArrayItem(item).icon!)"
                          v-if="resolveTagArrayItem(item).icon"
                          :size="13"
                          :stroke-width="2"
                          class="sdk-object-list-tag-icon"
                          :data-icon="resolveTagArrayItem(item).icon"
                          aria-hidden="true"
                        />
                        <span>{{ resolveTagArrayItem(item).label }}</span>
                      </span>
                    </template>
                  </span>
                </span>
                <span v-if="showListChevron" class="sdk-object-list-item-chevron" aria-hidden="true">›</span>
                <span
                  v-else-if="isRowExpandActivation && hasRowDetailSlot"
                  class="sdk-object-list-expand-chevron"
                  data-row-expand-indicator="true"
                  aria-hidden="true"
                >
                  <component
                    :is="curatedIcon(isRowExpanded(entry.row) ? 'chevron-up' : 'chevron-down')"
                    :size="16"
                    aria-hidden="true"
                  />
                </span>
              </component>
              <div v-if="hasActionColumn" class="sdk-object-list-row-inline-actions" @click.stop>
                <list-row-slot-host
                  v-if="hasActionsSlot"
                  :list-slot="member.key"
                  :row-ref="rowObjectRef(entry.row)"
                  :index="entry.rowIndex"
                  :operations="rowOperationsFor(entry.row)"
                  :operation-results="rowResultsFor(entry.row)"
                  :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                  :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                  :render-slot="slots.actions!"
                  :slot-props="rowActionsSlotProps(entry.row, entry.rowIndex)"
                  :fallback-to-default="Boolean(rowActions && rowActions.items.length > 0)"
                >
                  <ObjectListRowActions
                    :items="resolvedRowActionsFor(entry.row)"
                    :max-visible="rowActions?.maxVisible ?? 2"
                    :busy="isRowBusy(entry.row)"
                    :row-label="entry.row.label || entry.row.primaryKey"
                    :icon-variant="effectiveRowActionIconVariant"
                    @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                  />
                </list-row-slot-host>
                <ObjectListRowActions
                  v-else
                  :items="resolvedRowActionsFor(entry.row)"
                  :max-visible="rowActions?.maxVisible ?? 2"
                  :busy="isRowBusy(entry.row)"
                  :row-label="entry.row.label || entry.row.primaryKey"
                  :icon-variant="effectiveRowActionIconVariant"
                  @trigger="(item, ev) => triggerRowAction(entry.row, entry.rowIndex, item, ev)"
                />
              </div>
            </div>
            <div
              v-if="shouldShowRowDetail(entry.row)"
              :ref="(el) => setDetailElement(entry.key, el)"
              class="sdk-object-list-row-detail sdk-object-list-detail-host"
              @click.stop
            >
              <RowDetailFormScope
                v-if="hasRowDetailSlot"
                :row-key="entry.key"
                :on-register="registerRowDetailForm"
              >
                <list-row-slot-host
                  :list-slot="member.key"
                  :row-ref="rowObjectRef(entry.row)"
                  :item-key="rowItemKey(entry.row)"
                  :index="entry.rowIndex"
                  :operations="rowOperationsFor(entry.row)"
                  :operation-results="rowResultsFor(entry.row)"
                  :run-operation="(opName, extra) => runRowOperation(entry.row, opName, extra)"
                  :clear-operation-result="(opName) => clearRowOperationResult(entry.key, opName)"
                  :render-slot="slots['row-detail']!"
                  :slot-props="{
                    ...rowRefSlotProps(entry.row, entry.rowIndex),
                    collapse: () => requestCollapseRow(entry.row),
                    operationResults: rowResultsFor(entry.row),
                    clearOperationResult: (opName?: string) => clearRowOperationResult(entry.key, opName),
                  }"
                />
              </RowDetailFormScope>
              <div v-else class="sdk-object-list-row-result-panel">
                <div class="sdk-object-list-row-result-header">
                  <button
                    type="button"
                    class="sdk-object-list-row-result-close"
                    :aria-label="t('platform.listRowResultClose')"
                    :title="t('platform.listRowResultClose')"
                    @click.stop="clearRowOperationResult(entry.key)"
                  >
                    {{ t("platform.listRowResultClose") }}
                  </button>
                </div>
                <div
                  v-for="item in rowOperationFeedbackEntries(entry.row)"
                  :key="item.operationName"
                  class="sdk-object-list-row-result-entry"
                  :data-operation="item.operationName"
                >
                  <p v-if="item.state.error" class="sdk-object-list-op-alert" role="alert">{{ item.state.error }}</p>
                  <OperationResult
                    v-if="item.state.result"
                    :result="item.state.result"
                    :operation-slot="member.key"
                    :operation-name="item.operationName"
                  />
                  <template v-if="item.state.receipt && !(item.state.receipt.kind === 'dispatched' && item.state.receipt.outcome?.kind === 'success')">
                    <p v-if="item.state.receipt.kind === 'not-dispatched'" class="sdk-object-list-op-alert" role="alert">{{ item.state.receipt.message }}</p>
                    <p v-else-if="!item.state.receipt.outcome" class="sdk-object-list-op-alert" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
                    <OperationBatchReceipt v-else-if="item.state.receipt.outcome.kind === 'batch'" :items="item.state.receipt.outcome.items" :named="item.state.named ?? []" />
                    <p v-else class="sdk-object-list-op-alert" role="alert" :data-outcome="item.state.receipt.outcome.kind">{{ saidRowOp(item.state.receipt.outcome) }}</p>
                  </template>
                </div>
              </div>
            </div>
          </li>
        </template>
        <li
          v-if="isVirtualized && virtualBottomPadding > 0"
          class="sdk-object-list-virtual-spacer"
          aria-hidden="true"
          :style="{ height: `${virtualBottomPadding}px` }"
        ></li>
      </ul>
    </data-state>

    <nav v-if="showFooter" class="sdk-object-list-pagination sdk-object-list-footer" :class="{ 'is-paged-footer': showCursorPageControls }">
      <span v-if="showFooterTotal" class="sdk-object-list-count sdk-object-list-page-total" role="status">
        {{ t("platform.listTotal", { count: footerTotal }) }}
      </span>
      <ElSelect
        v-if="showPageSizeSelect"
        size="small"
        class="sdk-object-list-page-size"
        popper-class="sdk-object-list-page-size-popper"
        data-testid="object-list-page-size"
        :persistent="false"
        :model-value="effectivePageSize"
        :aria-label="t('platform.listPerPage', { size: effectivePageSize })"
        @update:model-value="onPageSizeChange"
      >
        <ElOption
          v-for="option in pageSizes"
          :key="option"
          :label="t('platform.listPerPage', { size: option })"
          :value="option"
        />
      </ElSelect>
      <template v-if="showPageControls">
        <button
          type="button"
          class="sdk-object-list-btn sdk-object-list-prev sdk-object-list-page-pill"
          :disabled="currentPage <= 1"
          @click="goPage(currentPage - 1)"
        >
          {{ t("platform.listPrevPage") }}
        </button>
        <template v-if="showNumericPages">
          <template v-for="(item, index) in paginationItems" :key="item === 'ellipsis' ? `ellipsis-${index}` : item">
            <span v-if="item === 'ellipsis'" class="sdk-object-list-page-ellipsis" aria-hidden="true">…</span>
            <button
              v-else
              type="button"
              class="sdk-object-list-btn sdk-object-list-page-num sdk-object-list-page-pill"
              :class="{ active: item === currentPage }"
              :aria-current="item === currentPage ? 'page' : undefined"
              @click="goPage(item)"
            >
              {{ item }}
            </button>
          </template>
        </template>
        <span v-else class="sdk-object-list-page-info">
          {{ footerHasTotal ? t("platform.listPagination", { page: currentPage, pages: totalPages }) : currentPage }}
        </span>
        <button
          type="button"
          class="sdk-object-list-btn sdk-object-list-next sdk-object-list-page-pill"
          :disabled="!footerHasTotal || currentPage >= totalPages"
          @click="goPage(currentPage + 1)"
        >
          {{ t("platform.listNextPage") }}
        </button>
        <span v-if="showPageJumperControl" class="sdk-object-list-page-jumper" data-testid="object-list-page-jumper">
          <span class="sdk-object-list-page-jumper-label">{{ t("platform.listGoTo") }}</span>
          <input
            v-model="jumperText"
            type="number"
            min="1"
            :max="totalPages"
            class="sdk-object-list-page-jumper-input"
            data-testid="object-list-page-jumper-input"
            :aria-label="t('platform.listGoToPage')"
            @keydown.enter="commitPageJump"
            @blur="commitPageJump"
          />
        </span>
      </template>
      <template v-else-if="showCursorPageControls">
        <button
          type="button"
          class="sdk-object-list-btn sdk-object-list-prev sdk-object-list-page-arrow"
          :disabled="currentPage <= 1"
          :aria-label="t('platform.listPrevPage')"
          @click="goCursorPrev"
        >
          ‹
        </button>
        <span class="sdk-object-list-page-current" aria-current="page">{{ currentPage }}</span>
        <button
          type="button"
          class="sdk-object-list-btn sdk-object-list-next sdk-object-list-page-arrow"
          :disabled="nextCursor === undefined"
          :aria-label="t('platform.listNextPage')"
          @click="goCursorNext"
        >
          ›
        </button>
      </template>
      <button
        v-else-if="showLoadMore"
        type="button"
        class="sdk-object-list-btn sdk-object-list-load-more"
        :disabled="loadingMore || nextCursor === undefined"
        :aria-busy="loadingMore ? 'true' : undefined"
        @click="loadMore"
      >
        {{ loadingMore ? t("platform.readerLoading") : t("platform.listLoadMore") }}
      </button>
    </nav>

    <operation-input-dialog
      v-if="rowOpPendingInputFields.length > 0"
      v-model="rowOpInputDialogOpen"
      :title="rowOpPendingDescriptor?.label"
      :fields="rowOpPendingInputFields"
      :initial-values="rowOpPendingInitialValues"
      :busy="rowOpPendingRow ? isRowBusy(rowOpPendingRow) : false"
      @confirm="confirmRowOpInput"
    ></operation-input-dialog>

    <div
      v-if="noneModeFeedbackState && ((actionErrorPlacement !== 'top' && (noneModeFeedbackState.error || (noneModeFeedbackState.receipt && !(noneModeFeedbackState.receipt.kind === 'dispatched' && noneModeFeedbackState.receipt.outcome?.kind === 'success')))) || (noneModeFeedbackState.receipt?.kind === 'dispatched' && noneModeFeedbackState.receipt.outcome?.kind === 'batch') || (noneModeFeedbackState.result && !lastNoneModeFeedbackConsumedByColumn))"
      class="sdk-object-list-op-feedback"
    >
      <p v-if="actionErrorPlacement !== 'top' && noneModeFeedbackState.error" class="sdk-object-list-op-alert" role="alert">{{ noneModeFeedbackState.error }}</p>
      <OperationResult
        v-if="noneModeFeedbackState.result && !lastNoneModeFeedbackConsumedByColumn"
        :result="noneModeFeedbackState.result"
        :operation-slot="member.key"
        :operation-name="lastNoneModeFeedback?.operationName"
      />
      <template v-if="noneModeFeedbackState.receipt && !(noneModeFeedbackState.receipt.kind === 'dispatched' && noneModeFeedbackState.receipt.outcome?.kind === 'success')">
        <OperationBatchReceipt v-if="noneModeFeedbackState.receipt.kind === 'dispatched' && noneModeFeedbackState.receipt.outcome?.kind === 'batch'" :items="noneModeFeedbackState.receipt.outcome.items" :named="noneModeFeedbackState.named ?? []" />
        <template v-else-if="actionErrorPlacement !== 'top'">
          <p v-if="noneModeFeedbackState.receipt.kind === 'not-dispatched'" class="sdk-object-list-op-alert" role="alert">{{ noneModeFeedbackState.receipt.message }}</p>
          <p v-else-if="!noneModeFeedbackState.receipt.outcome" class="sdk-object-list-op-alert" role="alert">{{ t("platform.operationUnknown", { message: "" }) }}</p>
          <p v-else-if="noneModeFeedbackState.receipt.outcome.kind !== 'batch'" class="sdk-object-list-op-alert" role="alert" :data-outcome="noneModeFeedbackState.receipt.outcome.kind">{{ saidRowOp(noneModeFeedbackState.receipt.outcome) }}</p>
        </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* The platform's design roles only (DESIGN.md): neutral fills for hover and selection, link colour for links, the
   shared spacing, type, radius and control scales. No value is written here. */
.sdk-object-list {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.sdk-object-list-compact {
  gap: 0;
}
.sdk-object-list-toolbar {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-list-toolbar-sticky {
  align-items: stretch;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--ui-divider);
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
}
.sdk-object-list-check-row {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
  justify-content: space-between;
  min-height: var(--control-height-sm);
}
.sdk-object-list-toolbar-sticky .sdk-object-list-batch-actions {
  border-top: 1px solid var(--ui-divider);
  padding-top: var(--spacing-xs);
}
.sdk-object-list-filters {
  align-items: center;
  display: inline-flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}
.sdk-object-list-toolbar-actions {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--spacing-xs);
  margin-left: auto;
}
.sdk-object-list-create-row {
  background: var(--ui-fill-quaternary);
  border: 1px solid var(--ui-divider);
  border-radius: var(--radius-md);
  flex: 0 0 auto;
  padding: var(--spacing-md);
}
.sdk-object-list-create-row :deep(.sdk-owner-form),
.sdk-object-list-create-row :deep(.sdk-owner-form-inner) {
  flex: 0 0 auto;
  height: auto;
}
.sdk-object-list-create-row :deep(.sdk-owner-form-body) {
  flex: 0 0 auto;
  overflow: visible;
}
.sdk-object-list-create-row :deep(.sdk-owner-form-actions) {
  background: transparent;
  position: static;
}
.sdk-object-list-search-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex: 0 1 260px;
  min-width: 160px;
  max-width: 100%;
}
.sdk-object-list-search-icon {
  position: absolute;
  left: 10px;
  color: var(--el-text-color-placeholder);
  pointer-events: none;
}
.sdk-object-list-search {
  background: var(--el-bg-color);
  border: 0;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--ui-divider) inset;
  box-sizing: border-box;
  color: var(--el-text-color-primary);
  width: 100%;
  font-size: var(--text-sm);
  height: var(--control-height);
  padding: 0 var(--spacing-md) 0 30px;
  transition: box-shadow var(--transition-fast);
}
.sdk-object-list-search::placeholder {
  color: var(--el-text-color-placeholder);
}
.sdk-object-list-search:hover {
  box-shadow: 0 0 0 1px var(--ui-border) inset;
}
.sdk-object-list-search:focus-visible {
  box-shadow: 0 0 0 1px var(--brand-link) inset, var(--focus-ring);
  outline: none;
}
/* Paging is a secondary command: neutral outline, quiet fill on hover and press. */
.sdk-object-list-btn {
  background: transparent;
  border: 1px solid var(--ui-border);
  border-radius: var(--radius-md);
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: var(--text-sm);
  height: var(--control-height-sm);
  padding: 0 var(--spacing-md);
  transition: background-color var(--transition-fast);
}
.sdk-object-list-btn:hover:not(:disabled) {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-btn:active:not(:disabled) {
  background: var(--ui-fill-quaternary);
}
.sdk-object-list-btn:disabled {
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
}
.sdk-object-list-toolbar-btn {
  align-items: center;
  display: inline-flex;
  gap: var(--spacing-xs);
  padding: 0 var(--spacing-sm);
  white-space: nowrap;
}
.sdk-object-list-count,
.sdk-object-list-selected-count,
.sdk-object-list-page-info {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-batch-actions {
  align-items: center;
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.sdk-object-list-link-btn,
.sdk-object-ref-link {
  background: none;
  border: 0;
  color: var(--brand-link);
  cursor: pointer;
  font-size: inherit;
  padding: 0;
  text-align: left;
}
.sdk-object-list-link-btn:hover,
.sdk-object-ref-link:hover {
  text-decoration: underline;
}
.sdk-object-list-table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--sdk-border-color, var(--ui-border));
  border-radius: var(--radius-md);
  background: var(--el-bg-color);
}
.sdk-object-list-table {
  border-collapse: collapse;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  width: 100%;
}
.sdk-object-list-table th,
.sdk-object-list-table td {
  border-bottom: 1px solid var(--ui-divider);
  box-sizing: border-box;
  padding: 0 var(--spacing-md);
  text-align: left;
  vertical-align: middle;
  /* A value stays on its line: a short column is as wide as its text, never two characters over two lines. */
  white-space: nowrap;
}
.sdk-object-list-table.is-bordered th,
.sdk-object-list-table.is-bordered td {
  border-right: 1px solid var(--el-table-border-color, var(--ui-divider));
}
.sdk-object-list-table.is-bordered th:last-child,
.sdk-object-list-table.is-bordered td:last-child {
  border-right: 0;
}
.sdk-object-list-table.is-striped tbody tr:not(.sdk-object-list-group-header-row):not(.sdk-object-list-detail-row):not(.sdk-object-list-empty-row):not(.sdk-object-list-virtual-spacer-row):nth-child(even) {
  background: var(--el-fill-color-lighter, #fafafa);
}
.sdk-object-list-table.is-striped tbody tr:not(.sdk-object-list-group-header-row):not(.sdk-object-list-detail-row):not(.sdk-object-list-empty-row):not(.sdk-object-list-virtual-spacer-row):nth-child(even):hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-table.is-striped tbody tr.chosen {
  background: var(--ui-fill-secondary);
}
.sdk-object-list-status-bar {
  flex: 0 0 auto;
  min-width: 0;
}
.sdk-object-list-preserved-error {
  flex: 0 0 auto;
}
.sdk-object-list-table th:not(.sdk-object-list-col-wrap),
.sdk-object-list-table td:not(.sdk-object-list-col-wrap) :is(.sdk-object-list-cell-main, .sdk-object-list-cell-sub, .sdk-object-ref-link) {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* A long text column truncates cleanly without crushing sibling columns to the right edge. */
.sdk-object-list-table .sdk-object-list-col-shrink {
  max-width: 28rem;
  min-width: 12em;
}
.sdk-object-list-col-shrink :is(.sdk-object-list-cell-main, .sdk-object-list-cell-sub, .sdk-object-ref-link) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sdk-object-list-table .sdk-object-list-col-wrap {
  padding-block: var(--spacing-sm);
  white-space: normal;
  min-width: 12em;
}
.sdk-object-list-table th {
  background: var(--sdk-fill-color, var(--ui-fill-tertiary));
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  height: var(--table-head-height, 36px);
  position: sticky;
  top: 0;
  z-index: 1;
}
.sdk-object-list-table td {
  height: var(--table-row-height, 40px);
  padding-block: 8px;
}
.sdk-object-list-table tbody tr:last-child td {
  border-bottom: 0;
}
.sdk-object-list-table tbody tr.sdk-object-list-empty-row {
  cursor: default;
}
.sdk-object-list-table tbody tr.sdk-object-list-empty-row:hover {
  background: transparent;
}
.sdk-object-list-empty-cell {
  padding: var(--spacing-2xl) var(--spacing-md);
  text-align: center;
  white-space: normal;
}
.sdk-object-list-chevron-col {
  width: 28px;
  padding-inline: 0 var(--spacing-sm) !important;
  text-align: right;
}
.sdk-object-list-actions-col {
  white-space: nowrap;
  text-align: right;
}
.sdk-object-list-actions-fixed {
  position: sticky;
  right: 0;
  background: var(--el-bg-color);
  box-shadow: -4px 0 8px -6px rgba(0, 0, 0, 0.12);
}
.sdk-object-list-table tbody tr:hover .sdk-object-list-actions-fixed {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-table tbody tr.chosen .sdk-object-list-actions-fixed {
  background: var(--ui-fill-secondary);
}
.sdk-object-list-card-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--spacing-xs);
  border-top: 1px solid var(--ui-divider);
}
.sdk-object-list-row-inline-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding-inline-end: var(--spacing-xs);
}
.sdk-object-list-op-feedback {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-object-list-op-alert {
  margin: 0;
  color: var(--el-color-danger);
  font-size: var(--text-xs);
}
.sdk-object-list-batch-receipt {
  padding: var(--spacing-sm);
  border: 1px solid var(--el-border-color);
  border-radius: var(--el-border-radius-base);
}
.sdk-object-list-row-chevron {
  display: inline-block;
  vertical-align: middle;
  color: var(--el-text-color-placeholder);
}
.sdk-object-list-table tbody tr {
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.sdk-object-list-table tbody tr.is-non-selectable {
  cursor: default;
}
.sdk-object-list-table tbody tr.is-non-selectable:hover {
  background: transparent;
}
.sdk-object-list-table tbody tr:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-table tbody tr.chosen {
  background: var(--ui-fill-secondary);
}
.sdk-object-list-table tbody tr.highlighted {
  background: var(--brand-primary-tint, var(--ui-fill-secondary));
}
.sdk-object-list-table tbody tr.highlighted:hover {
  background: var(--brand-primary-tint, var(--ui-fill-secondary));
}
.sdk-object-list-table tbody tr.is-tone-success {
  background: color-mix(in srgb, var(--el-color-success) 8%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-success:hover {
  background: color-mix(in srgb, var(--el-color-success) 14%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-danger {
  background: color-mix(in srgb, var(--el-color-danger) 8%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-danger:hover {
  background: color-mix(in srgb, var(--el-color-danger) 14%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-warning {
  background: color-mix(in srgb, var(--el-color-warning) 8%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-warning:hover {
  background: color-mix(in srgb, var(--el-color-warning) 14%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-info {
  background: color-mix(in srgb, var(--el-color-info) 8%, transparent);
}
.sdk-object-list-table tbody tr.is-tone-info:hover {
  background: color-mix(in srgb, var(--el-color-info) 14%, transparent);
}
.sdk-object-list-td-body {
  display: contents;
}
.sdk-object-list-td-body.has-draft-dot {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sdk-object-list-draft-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-warning);
  flex: 0 0 auto;
}
.sdk-object-list-row-result-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-object-list-row-result-header {
  display: flex;
  justify-content: flex-end;
}
.sdk-object-list-row-result-close {
  background: transparent;
  border: 1px solid var(--el-border-color);
  border-radius: var(--border-radius-sm, 4px);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  font-size: var(--text-xs);
  line-height: 1.4;
  padding: 2px var(--spacing-xs);
}
.sdk-object-list-row-result-close:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.sdk-object-list-row-result-entry {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}
.sdk-object-list-table tbody tr:focus-visible {
  outline: 2px solid var(--brand-link);
  outline-offset: -2px;
}
.sdk-object-list-check-col,
.sdk-object-list-expand-col,
.sdk-object-list-expand-trailing-col {
  width: var(--control-height);
}
.sdk-object-list-expand-trailing-col {
  text-align: right;
}
.sdk-object-list-expand-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
}
.sdk-object-list-table tbody tr.expanded {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-index-col {
  width: 50px;
  min-width: 50px;
  max-width: 50px;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-col-pinned-left {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--el-bg-color);
  box-shadow: 4px 0 8px -6px rgba(0, 0, 0, 0.12);
}
.sdk-object-list-table th.sdk-object-list-col-pinned-left {
  background: var(--sdk-fill-color, var(--ui-fill-tertiary));
  z-index: 3;
}
.sdk-object-list-table tbody tr:hover .sdk-object-list-col-pinned-left {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-table tbody tr.chosen .sdk-object-list-col-pinned-left {
  background: var(--ui-fill-secondary);
}
.sdk-object-list-table tbody tr.highlighted .sdk-object-list-col-pinned-left {
  background: var(--brand-primary-tint, var(--ui-fill-secondary));
}
.sdk-object-list-primary-link {
  background: none;
  border: 0;
  color: var(--el-color-primary);
  cursor: pointer;
  display: inline-block;
  font: inherit;
  font-weight: var(--font-medium);
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  text-align: left;
  text-overflow: ellipsis;
}
.sdk-object-list-primary-link:hover {
  text-decoration: underline;
}
.sdk-object-list-primary-link:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: var(--radius-xs);
}
.sdk-object-list-expand-btn {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: var(--control-height-sm);
  justify-content: center;
  padding: 0;
  transition: background-color var(--transition-fast), color var(--transition-fast);
  width: var(--control-height-sm);
}
.sdk-object-list-expand-btn:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-object-list-expand-btn:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
.sdk-object-list-expand-icon {
  display: inline-block;
  font-size: var(--text-xs);
  line-height: 1;
  transition: transform var(--transition-fast);
}
.sdk-object-list-expand-icon.expanded {
  transform: rotate(90deg);
}
.sdk-object-list-table tbody tr.sdk-object-list-detail-row {
  background: var(--ui-fill-quaternary);
  cursor: default;
}
.sdk-object-list-table tbody tr.sdk-object-list-detail-row:hover {
  background: var(--ui-fill-quaternary);
}
.sdk-object-list-table td.sdk-object-list-detail-cell {
  height: auto;
  padding: var(--spacing-md);
  white-space: normal;
}
.sdk-object-list-card-detail,
.sdk-object-list-row-detail {
  border-top: 1px solid var(--ui-divider);
  padding-top: var(--spacing-sm);
  width: 100%;
}
.sdk-object-list-row-detail {
  padding-inline-start: var(--spacing-lg);
}
.sdk-object-list-cell {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  min-width: 0;
}
.sdk-object-list-cell-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: var(--el-text-color-secondary);
}
.sdk-object-list-cell-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sdk-object-list-cell-main {
  color: var(--el-text-color-primary);
  font-weight: var(--font-medium);
}
.sdk-object-list-select-all {
  align-items: center;
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: inline-flex;
  font-size: var(--text-sm);
  gap: var(--spacing-xs);
}
.sdk-object-list-select-all.disabled {
  color: var(--el-disabled-text-color);
  cursor: not-allowed;
  opacity: 0.65;
}
.sdk-object-list-cell-sub,
.sdk-object-list-item-sub {
  color: var(--el-text-color-secondary);
  font-size: var(--text-xs);
}
.sdk-object-list-item-sub {
  line-height: 1.55;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}
.sdk-object-list-item-sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  width: 100%;
}
.sdk-object-list-item-sub-row > .sdk-object-list-item-sub {
  flex: 1 1 auto;
  width: auto;
}
.sdk-object-list-item-meta {
  flex-shrink: 0;
  font-size: var(--font-size-xs, 12px);
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
.sdk-object-list-th-with-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.sdk-object-list-th-help {
  display: inline-flex;
  align-items: center;
  color: var(--el-text-color-secondary);
  cursor: help;
}
.sdk-object-list-th-help:hover,
.sdk-object-list-th-help:focus-visible {
  color: var(--el-text-color-primary);
}
.sdk-object-list-item-sub-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.55;
  white-space: normal;
}
.sdk-object-list-items {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0;
  list-style: none;
  margin: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
}
.sdk-object-list-row {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--spacing-xs);
  border-bottom: 1px solid var(--ui-divider);
  transition: background-color var(--transition-fast);
}
.sdk-object-list-row:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-row.chosen {
  background: var(--brand-primary-tint, var(--ui-fill-secondary));
  box-shadow: inset 3px 0 0 var(--el-color-primary);
}
.sdk-object-list-row:last-child {
  border-bottom: 0;
}
.sdk-object-list-row-main {
  align-items: flex-start;
  box-sizing: border-box;
  display: flex;
  flex: 0 0 auto;
  gap: var(--spacing-sm);
  min-width: 0;
  padding: 0 var(--spacing-md);
  width: 100%;
}
.sdk-object-list-row-expand,
.sdk-object-list-row-check {
  flex: 0 0 auto;
}
.sdk-object-list-row-check {
  margin: calc(var(--spacing-sm) + 3px) 0 0;
}
.sdk-object-list-item-btn {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-xs);
  box-sizing: border-box;
  color: var(--el-text-color-primary);
  cursor: pointer;
  display: flex;
  flex: 1;
  font-size: var(--text-sm);
  gap: var(--spacing-sm);
  min-height: var(--list-row-height, 44px);
  min-width: 0;
  padding: var(--spacing-sm) 0;
  text-align: left;
  width: 100%;
}
.sdk-object-list-item-leading {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
}
.sdk-object-list-item-content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: calc(var(--spacing-xs) / 2);
  justify-content: center;
  min-width: 0;
}
.sdk-object-list-item-chevron {
  color: var(--el-text-color-placeholder);
  flex: 0 0 auto;
  font-size: var(--text-md, 16px);
  line-height: 1;
}
.sdk-object-list-item-btn.chosen .sdk-object-list-item-chevron {
  color: var(--brand-link, var(--el-color-primary));
}
.sdk-object-list-item-btn.sdk-object-list-item-two-line {
  min-height: var(--list-row-two-line-height, 60px);
}
.sdk-object-list-item-btn.is-non-selectable,
.sdk-object-list-card.is-non-selectable {
  cursor: default;
}
.sdk-object-list-item-btn.chosen {
  font-weight: var(--font-medium);
}
.sdk-object-list-item-btn.sdk-object-list-item-two-line .sdk-object-list-item-label {
  font-weight: var(--font-semibold);
}
.sdk-object-list-item-head {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
  justify-content: space-between;
  min-width: 0;
  width: 100%;
}
.sdk-object-list-item-head-dot {
  gap: var(--spacing-xs);
  justify-content: flex-start;
}
.sdk-object-list-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-object-list-item-head .sdk-object-list-tag {
  flex: 0 0 auto;
}
.sdk-object-list-item-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
/* Tags are light fills: neutral, or a status's soft fill with its readable text colour. */
.sdk-object-list-tag {
  align-items: center;
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--el-text-color-regular);
  display: inline-flex;
  font-size: var(--text-xs);
  gap: 4px;
  line-height: var(--leading-xs);
  padding: 0 var(--spacing-xs);
  white-space: nowrap;
}
.sdk-object-list-tag-icon {
  flex: none;
}
.sdk-object-list-card-value {
  align-items: center;
  display: inline-flex;
  gap: 4px;
}
.sdk-object-list-cell-pending {
  color: var(--sdk-text-color-secondary, var(--el-text-color-placeholder));
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-tag[data-tone="info"] {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info-text);
}
.sdk-object-list-tag[data-tone="success"] {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success-text);
}
.sdk-object-list-tag[data-tone="warning"] {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-text);
}
.sdk-object-list-tag[data-tone="danger"] {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger-text);
}
.sdk-object-list-tag[data-effect="plain"],
.sdk-object-list-tag[data-effect="plain"][data-tone="default"] {
  background: transparent;
  border: 1px solid var(--el-border-color);
  color: var(--el-text-color-regular);
}
.sdk-object-list-tag[data-effect="plain"][data-tone="info"] {
  background: transparent;
  border-color: var(--el-color-info-light-5, var(--el-color-info));
  color: var(--el-color-info-text, var(--el-color-info));
}
.sdk-object-list-tag[data-effect="plain"][data-tone="success"] {
  background: transparent;
  border-color: var(--el-color-success-light-5, var(--el-color-success));
  color: var(--el-color-success-text, var(--el-color-success));
}
.sdk-object-list-tag[data-effect="plain"][data-tone="warning"] {
  background: transparent;
  border-color: var(--el-color-warning-light-5, var(--el-color-warning));
  color: var(--el-color-warning-text, var(--el-color-warning));
}
.sdk-object-list-tag[data-effect="plain"][data-tone="danger"] {
  background: transparent;
  border-color: var(--el-color-danger-light-5, var(--el-color-danger));
  color: var(--el-color-danger-text, var(--el-color-danger));
}
.sdk-object-list-cards {
  align-content: start;
  display: grid;
  flex: 1 1 auto;
  gap: var(--spacing-md);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 256px), 1fr));
  min-height: 0;
  overflow-y: auto;
}
.sdk-object-list-card-skeleton {
  box-sizing: border-box;
  min-height: 108px;
  padding: var(--spacing-lg);
  border: 1px solid var(--el-border-color, var(--ui-border));
  border-radius: var(--radius-lg);
  background: var(--el-bg-color, var(--sdk-bg-color));
}
@media (prefers-reduced-motion: reduce) {
  .sdk-object-list-card-skeleton :deep(.el-skeleton__item) {
    animation: none;
  }
}
.sdk-object-list-card {
  background: var(--el-fill-color-blank, var(--sdk-bg-color));
  border: 1px solid var(--el-border-color-lighter, var(--ui-border));
  border-radius: var(--radius-lg);
  box-sizing: border-box;
  color: var(--sdk-text-color-primary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  min-height: 106px;
  padding: var(--spacing-lg);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast), background-color var(--transition-fast);
}
.sdk-object-list-card:hover {
  background: var(--el-bg-color, var(--sdk-bg-color));
  border-color: var(--el-border-color-dark, var(--ui-border));
  box-shadow: var(--elevation-panel);
}
.sdk-object-list-card.chosen {
  background: var(--ui-fill-secondary);
  border-color: var(--sdk-color-primary);
}
.sdk-object-list-card:focus-visible {
  outline: 2px solid var(--brand-link);
  outline-offset: 2px;
}
.sdk-object-list-card-head {
  align-items: flex-start;
  display: flex;
  gap: var(--spacing-sm);
  min-width: 0;
}
.sdk-object-list-card-main {
  align-items: flex-start;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: inherit;
  display: flex;
  flex: 1 1 auto;
  font: inherit;
  gap: var(--spacing-sm);
  min-width: 0;
  padding: 0;
  text-align: start;
}
.sdk-object-list-card-leading {
  align-items: center;
  color: var(--sdk-text-color-secondary);
  display: inline-flex;
  flex: 0 0 auto;
}
.sdk-object-list-card-leading.is-app-icon,
.sdk-object-list-item-leading.is-app-icon {
  color: var(--el-color-primary);
}
.sdk-object-list-card-leading.is-app-icon {
  margin-top: 3px;
}
.sdk-object-list-card-content {
  display: grid;
  flex: 1 1 auto;
  gap: var(--spacing-xs);
  min-width: 0;
}
.sdk-object-list-card-title-row {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
  min-width: 0;
}
.sdk-object-list-card-header-actions {
  flex: 0 0 auto;
  margin-inline-start: auto;
}
.sdk-object-list-card-check {
  flex: 0 0 auto;
}
.sdk-object-list-card-title {
  flex: 1 1 auto;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  line-height: var(--leading-sm);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-object-list-card-sub {
  color: var(--el-text-color-secondary, var(--sdk-text-color-secondary));
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  margin: 0;
  overflow-wrap: anywhere;
}
.sdk-object-list-accordion {
  background: var(--el-bg-color, var(--sdk-bg-color));
  border: 1px solid var(--el-border-color, var(--ui-border));
  border-radius: var(--radius-md);
  overflow: hidden;
}
.sdk-object-list-accordion-item {
  border-bottom: 1px solid var(--el-border-color-lighter, var(--ui-divider));
  padding: var(--spacing-md) var(--spacing-lg);
}
.sdk-object-list-accordion-item:last-child {
  border-bottom: 0;
}
.sdk-object-list-accordion-header {
  align-items: center;
  display: flex;
  gap: var(--spacing-sm);
}
.sdk-object-list-accordion-summary {
  align-items: center;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  font: inherit;
  gap: var(--spacing-sm);
  line-height: 28px;
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 0;
  text-align: left;
}
.sdk-object-list-accordion-summary:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
.sdk-object-list-accordion-arrow {
  color: var(--el-text-color-secondary);
  display: inline-flex;
  flex: 0 0 14px;
  transition: transform var(--transition-fast);
}
.sdk-object-list-accordion-item.is-expanded > .sdk-object-list-accordion-header > .sdk-object-list-accordion-summary > .sdk-object-list-accordion-arrow {
  transform: rotate(90deg);
}
.sdk-object-list-accordion-heading {
  align-items: baseline;
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-md);
  min-width: 0;
}
.sdk-object-list-accordion-title {
  color: var(--el-text-color-primary);
  font-weight: 500;
}
.sdk-object-list-accordion-code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 0;
}
.sdk-object-list-accordion-actions {
  flex: 0 0 auto;
  margin-inline-start: auto;
}
.sdk-object-list-accordion-body {
  padding-top: var(--spacing-xs);
}
.sdk-object-list-accordion-desc {
  color: var(--el-text-color-regular);
  font-size: var(--text-sm);
  line-height: 1.6;
  margin: 8px 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.sdk-object-list-accordion-detail-label {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  margin-bottom: var(--spacing-xs);
}
.sdk-object-list-accordion-pre {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  font-size: var(--text-mono, 12px);
  margin: 0;
  overflow-wrap: anywhere;
  padding: 12px;
  white-space: pre-wrap;
}
.sdk-object-list-card-fields {
  display: grid;
  font-size: var(--text-xs);
  gap: var(--spacing-xs) var(--spacing-md);
  grid-template-columns: auto 1fr;
  margin: 0;
}
.sdk-object-list-card-field-label {
  color: var(--sdk-text-color-secondary);
}
.sdk-object-list-card-field-value {
  color: var(--sdk-text-color-regular);
  margin: 0;
  min-width: 0;
  word-break: break-word;
}
.sdk-object-list-card-tags {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.sdk-object-list-range-bar {
  color: var(--el-text-color-secondary);
  flex: 0 0 auto;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-xs);
  padding: 0 var(--spacing-xs);
}
.sdk-object-list-pagination {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  padding-top: var(--spacing-xs);
}
.sdk-object-list-compact .sdk-object-list-pagination {
  background: var(--el-bg-color);
  border-top: 1px solid var(--ui-divider);
  padding: var(--spacing-sm) var(--spacing-md);
}
.sdk-object-list-page-total {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  margin-right: auto;
}
.sdk-object-list-pagination.is-paged-footer .sdk-object-list-page-total {
  margin-right: 0;
}
.sdk-object-list-page-size {
  width: 112px;
}
.sdk-object-list-page-arrow {
  min-width: 28px;
  height: 28px;
  padding: 0 var(--spacing-xs);
  background: var(--el-fill-color-light, #f0f2f5);
  border-color: transparent;
  font-size: var(--text-base);
}
.sdk-object-list-page-current {
  min-width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--sdk-color-primary);
  text-align: center;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--sdk-bg-color, #fff);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-page-pill {
  background: var(--el-fill-color-light, #f0f2f5);
  border-color: transparent;
  border-radius: var(--radius-sm);
  height: 28px;
  min-width: 28px;
  padding: 0 var(--spacing-sm);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.sdk-object-list-page-pill:hover:not(:disabled) {
  color: var(--el-color-primary);
  background: var(--el-fill-color, #ebeef5);
}
.sdk-object-list-page-num {
  min-width: 28px;
  padding: 0 6px;
}
.sdk-object-list-page-num.active {
  background: var(--sdk-color-primary);
  border-color: var(--sdk-color-primary);
  color: var(--sdk-bg-color, #fff);
  font-weight: var(--font-semibold);
}
.sdk-object-list-page-num.active:hover:not(:disabled) {
  background: var(--sdk-color-primary);
  color: var(--sdk-bg-color, #fff);
}
.sdk-object-list-page-ellipsis {
  color: var(--sdk-text-color-secondary);
  font-size: var(--text-sm);
  padding: 0 2px;
  user-select: none;
}
.sdk-object-list-page-jumper {
  align-items: center;
  color: var(--el-text-color-secondary);
  display: inline-flex;
  font-size: var(--text-xs);
  gap: 6px;
  margin-left: 4px;
}
.sdk-object-list-page-jumper-input {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color, var(--ui-border));
  border-radius: var(--radius-sm);
  color: var(--el-text-color-primary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  height: 28px;
  padding: 0 6px;
  text-align: center;
  width: 48px;
  -moz-appearance: textfield;
}
.sdk-object-list-page-jumper-input::-webkit-inner-spin-button,
.sdk-object-list-page-jumper-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.sdk-object-list-page-jumper-input:focus {
  border-color: var(--el-color-primary);
  outline: none;
}
.sdk-object-list-diagnostics {
  color: var(--el-color-warning-text);
  flex: 0 0 auto;
  font-size: var(--text-xs);
  line-height: var(--leading-xs);
  list-style: none;
  margin: 0;
  padding: 0 var(--spacing-xs);
}
.sdk-object-list-status {
  align-items: center;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-wrap: wrap;
  font-size: var(--text-xs);
  gap: var(--spacing-xs);
  margin: 0;
  padding: var(--spacing-md) var(--spacing-xs);
}
.sdk-object-list-status[data-status="refused"] {
  color: var(--el-color-warning-text);
}
.sdk-object-list-status[data-status="failed"] {
  color: var(--el-color-danger-text);
}
.sdk-object-list-status-reason {
  color: var(--el-text-color-secondary);
}
mark {
  background: var(--el-color-warning-light-7);
  border-radius: var(--radius-xs);
  color: inherit;
  padding: 0 calc(var(--spacing-xs) / 4);
}
.sdk-object-list-group-header {
  flex: 0 0 auto;
  list-style: none;
  margin-top: var(--spacing-xs);
}
.sdk-object-list-group-header:first-child {
  margin-top: 0;
}
.sdk-object-list-card-group-header {
  grid-column: 1 / -1;
}
.sdk-object-list-table tbody tr.sdk-object-list-group-row {
  background: var(--ui-fill-quaternary);
  cursor: default;
}
.sdk-object-list-table tbody tr.sdk-object-list-group-row:hover {
  background: var(--ui-fill-tertiary);
}
.sdk-object-list-table td.sdk-object-list-group-cell {
  height: auto;
  padding: var(--spacing-xs) var(--spacing-sm);
}
.sdk-object-list-group-btn {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--el-text-color-secondary);
  cursor: pointer;
  display: flex;
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  gap: var(--spacing-xs);
  min-height: var(--control-height-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  text-align: left;
  transition: background-color var(--transition-fast), color var(--transition-fast);
  width: 100%;
}
.sdk-object-list-group-btn:hover {
  background: var(--ui-fill-tertiary);
  color: var(--el-text-color-primary);
}
.sdk-object-list-group-btn:focus-visible {
  box-shadow: var(--focus-ring);
  outline: none;
}
.sdk-object-list-group-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sdk-object-list-group-count {
  background: var(--ui-fill-tertiary);
  border-radius: var(--radius-xs);
  color: var(--el-text-color-secondary);
  flex: 0 0 auto;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-xs);
  padding: 0 var(--spacing-xs);
}
.sdk-object-list-virtual-spacer {
  flex: 0 0 auto;
  list-style: none;
  margin: 0;
  padding: 0;
  pointer-events: none;
}
.sdk-object-list-card-spacer {
  grid-column: 1 / -1;
}
.sdk-object-list-table tbody tr.sdk-object-list-virtual-spacer-row,
.sdk-object-list-table tbody tr.sdk-object-list-virtual-spacer-row:hover {
  background: transparent;
  cursor: default;
}
.sdk-object-list-table td.sdk-object-list-virtual-spacer-cell {
  border-bottom: 0;
  padding: 0;
}
.sdk-object-list-tabs-mode {
  flex: none;
  min-height: 0;
}
.sdk-object-list-tabs-bar {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs, 4px);
  width: 100%;
  min-width: 0;
  min-height: 40px;
  border-bottom: 1px solid var(--ui-divider, var(--el-border-color-lighter));
  box-sizing: border-box;
}
.sdk-object-list-tabs-bar.is-pill {
  min-height: 32px;
  border-bottom: 0;
}
.sdk-object-list-tabs-bar.is-empty {
  justify-content: space-between;
  padding: var(--spacing-xs, 4px) 0;
}
.sdk-object-list-tabs-empty-text {
  color: var(--el-text-color-secondary);
  font-size: var(--font-size-sm, 13px);
}
.sdk-object-list-tabs-scroller {
  display: flex;
  align-items: stretch;
  gap: var(--spacing-xs, 4px);
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.sdk-object-list-tabs-scroller::-webkit-scrollbar {
  display: none;
}
.sdk-object-list-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs, 6px);
  flex: 0 0 auto;
  max-width: 240px;
  height: 38px;
  padding: 0 var(--spacing-md, 12px);
  border-radius: var(--border-radius-sm, 6px) var(--border-radius-sm, 6px) 0 0;
  color: var(--el-text-color-regular);
  font-size: var(--font-size-sm, 13px);
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.sdk-object-list-tab.has-actions {
  padding-inline-end: var(--spacing-xs, 6px);
}
.sdk-object-list-tab:hover:not(.is-non-selectable) {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}
.sdk-object-list-tab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.sdk-object-list-tab.chosen {
  color: var(--el-color-primary);
  font-weight: 600;
  background: var(--el-color-primary-light-9);
}
.sdk-object-list-tab.chosen::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--el-color-primary);
  border-radius: 2px 2px 0 0;
}
.sdk-object-list-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.sdk-object-list-tab-actions {
  display: inline-flex;
  align-items: center;
  flex: none;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--transition-fast, 0.15s ease);
}
.sdk-object-list-tab:hover .sdk-object-list-tab-actions,
.sdk-object-list-tab:focus-within .sdk-object-list-tab-actions,
.sdk-object-list-tab.is-menu-open .sdk-object-list-tab-actions,
.sdk-object-list-tab.chosen .sdk-object-list-tab-actions {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .sdk-object-list-tab-actions {
    opacity: 1;
    pointer-events: auto;
  }
}
.sdk-object-list-tab.is-renaming {
  padding: 0 2px;
  background: transparent;
}
.sdk-object-list-tab.is-renaming:hover:not(.is-non-selectable) {
  background: transparent;
}
.sdk-object-list-tab-rename-input {
  width: 160px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--el-color-primary);
  border-radius: var(--radius-sm, 4px);
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  font: inherit;
  font-size: var(--text-sm, 13px);
  font-weight: 400;
  line-height: 1;
  box-sizing: border-box;
  outline: none;
  box-shadow: var(--focus-ring, 0 0 0 2px var(--el-color-primary-light-8));
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tabs-scroller {
  align-items: center;
  gap: 4px;
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab {
  max-width: none;
  height: 32px;
  gap: 4px;
  padding: 0 12px;
  border-radius: var(--radius-md, 8px);
  font-size: var(--text-sm, 13px);
  font-weight: 400;
  color: var(--el-text-color-regular);
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab.has-actions {
  padding-inline-end: 0;
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab.is-renaming {
  padding: 0;
  background: transparent;
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab:hover:not(.is-non-selectable):not(.is-renaming):not(.chosen) {
  background: var(--el-fill-color);
  color: var(--el-text-color-regular);
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab.chosen:not(.is-renaming) {
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-primary);
  font-weight: 600;
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab.chosen::after {
  display: none;
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab-label {
  overflow: visible;
  text-overflow: clip;
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab.chosen:not(:hover):not(:focus-within):not(.is-menu-open) .sdk-object-list-tab-actions {
  opacity: 0;
  pointer-events: none;
}
@media (hover: none) {
  .sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab.chosen .sdk-object-list-tab-actions {
    opacity: 1;
    pointer-events: auto;
  }
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab-actions :deep(.sdk-object-list-action-more-btn) {
  width: 26px;
  min-width: 26px;
  height: 26px;
  margin-right: 3px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--el-text-color-tertiary, var(--el-text-color-placeholder));
}
.sdk-object-list-tabs-bar.is-pill .sdk-object-list-tab-actions :deep(.sdk-object-list-action-more-btn:hover:not(:disabled)) {
  background: transparent;
  color: var(--el-text-color-primary);
}
.sdk-object-list-tabs-scroll-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--el-text-color-secondary);
  cursor: pointer;
}
.sdk-object-list-tabs-scroll-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-text-color-primary);
}
.sdk-object-list-tabs-scroll-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: -2px;
}
.sdk-object-list-tabs-extra {
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-inline-start: auto;
  padding-inline-start: var(--spacing-xs, 4px);
}
</style>
