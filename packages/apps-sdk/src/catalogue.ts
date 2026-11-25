import {
  SDK_UI_COMPONENTS,
  SDK_UI_DIRECTIVES,
  SDK_UI_ENTRY_SPECIFIER,
  sdkThemeTokenCatalogueEntries,
} from "@ontomato/contracts/sdk-ui-map";
import type {
  AppsSdkThemeTokenEntry,
  AppsSdkUiDirectiveEntry,
} from "@ontomato/contracts/apps-sdk";
import { defineComponentMeta, type ComponentMetadata } from "./components";

export const uiPrimitiveEntries = SDK_UI_COMPONENTS.map(({ sdkTag, sdkExport }) => ({
  tag: sdkTag,
  exportName: sdkExport,
  module: SDK_UI_ENTRY_SPECIFIER,
}));

export const uiDirectives: readonly AppsSdkUiDirectiveEntry[] = SDK_UI_DIRECTIVES.map((directive) => ({
  name: directive.sdkName,
  exportName: directive.sdkExport,
  module: SDK_UI_ENTRY_SPECIFIER,
  description: directive.description,
}));

export const themeTokens: readonly AppsSdkThemeTokenEntry[] = sdkThemeTokenCatalogueEntries();

/*
 * Semantic metadata of the components this SDK version exports (overall design 3.1): what each means, its applicable
 * object types, the data it reads and the parameters it takes, and the state it hands over. The build generates
 * `components.json` and the catalogue document from this list. What a projection can do is the operations it names, not
 * its component's.
 *
 * Only components this version actually exports may be declared, and the build checks that: a declaration for something
 * absent, or a public component with no declaration, fails it rather than shipping an undescribed component.
 */
export const components: readonly ComponentMetadata[] = [
  defineComponentMeta({
    componentId: "MetricViewData",
    module: "@ontomato/sdk",
    exportName: "MetricViewData",
    role: "presentation",
    meaning:
      "Reads one published MetricView and hands its result to the page's own template; the loading state and a failed read reach it as values, and it draws nothing itself.",
    effects: "Reads the MetricView through the data engine as the reader; it computes no metric of its own.",
    bindsElement: ["MetricView:*"],
  }),
  defineComponentMeta({
    componentId: "ProductAsset",
    module: "@ontomato/sdk",
    exportName: "ProductAsset",
    role: "presentation",
    meaning:
      "Embeds an existing product asset as the application's pinned release draws it; an unavailable asset or an unsupported host is reported instead of drawing another page.",
  }),
  defineComponentMeta({
    componentId: "EChart",
    module: "@ontomato/sdk/chart",
    exportName: "EChart",
    role: "presentation",
    meaning:
      "Draws one ECharts option in the platform's chart theme, following its light and dark modes; it computes no value and reads nothing itself. In a panel, write `<e-chart>` in the template, without an import; the import is for an application page outside a panel.",
    bindsElement: ["MetricView:*", "Definition:*"],
  }),
  defineComponentMeta({
    componentId: "FormFields",
    module: "@ontomato/sdk/form",
    exportName: "FormFields",
    role: "control",
    meaning:
      "Draws a form exactly as its owner declares it — a choice as a select whose unavailable options stay listed with the reason, a text as an input or a large text box — in the owner's order and limits. In a panel, write `<form-fields>` in the template, without an import; the import is for an application page outside a panel.",
    bindsElement: ["Action:*"],
  }),
  defineComponentMeta({
    componentId: "CodeEditor",
    module: "@ontomato/sdk/code",
    exportName: "CodeEditor",
    role: "control",
    meaning: "Edits code or structured text such as JSON, in the page's light or dark theme; it validates nothing. In a panel, write `<code-editor>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "MarkdownView",
    module: "@ontomato/sdk/markdown",
    exportName: "MarkdownView",
    role: "presentation",
    meaning: "Draws a text as the platform reads Markdown, in the page's light or dark theme. In a panel, write `<markdown-view>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "TablePreview",
    module: "@ontomato/sdk/preview",
    exportName: "TablePreview",
    role: "presentation",
    meaning: "Draws text cells as a table with paging; it reads no business meaning out of them. In a panel, write `<table-preview>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "HtmlPreview",
    module: "@ontomato/sdk/preview",
    exportName: "HtmlPreview",
    role: "presentation",
    meaning: "Draws a whole HTML document in a sandboxed frame; the document runs nothing outside that frame. In a panel, write `<html-preview>` in the template, without an import; the import is for an application page outside a panel.",
  }),
  defineComponentMeta({
    componentId: "AgentChatPanel",
    module: "@ontomato/sdk/chat",
    exportName: "AgentChatPanel",
    role: "control",
    meaning:
      "Holds one conversation with one of the platform's agents and reports its session; the agent's own skills decide what it can do.",
    effects: "Sends the reader's messages to the agent service as the signed-in user and shows the run as it streams.",
  }),
  defineComponentMeta({
    componentId: "AgentShell",
    module: "@ontomato/sdk/chat",
    exportName: "AgentShell",
    role: "control",
    meaning:
      "The whole conversation surface of one agent: its column, the conversation and the page beside it. A panel that talks to an agent composes it rather than drawing a conversation of its own.",
    effects: "Sends the reader's messages to the agent service as the signed-in user.",
  }),
  defineComponentMeta({
    componentId: "ShellComposer",
    module: "@ontomato/sdk/chat",
    exportName: "ShellComposer",
    role: "control",
    meaning: "The input a reader types a message into, with what the message would carry; it sends nothing itself.",
  }),
  defineComponentMeta({
    componentId: "PageComposer",
    module: "@ontomato/sdk/chat",
    exportName: "PageComposer",
    role: "control",
    meaning: "The composer of a page shown full beside the conversation, with the page the message will carry.",
  }),
  defineComponentMeta({
    componentId: "ShellColumn",
    module: "@ontomato/sdk/chat",
    exportName: "ShellColumn",
    role: "presentation",
    meaning: "The conversation's own column: its agents and sessions, as the host lists them.",
  }),
  defineComponentMeta({
    componentId: "ShellNavBody",
    module: "@ontomato/sdk/chat",
    exportName: "ShellNavBody",
    role: "presentation",
    meaning: "The rows of the conversation column, with their counts and their state.",
  }),
  defineComponentMeta({
    componentId: "ShellDockRoom",
    module: "@ontomato/sdk/chat",
    exportName: "ShellDockRoom",
    role: "presentation",
    meaning: "The room the shell's own controls cover at the foot of a page, so the page's end scrolls clear.",
  }),
  defineComponentMeta({
    componentId: "AgentPicker",
    module: "@ontomato/sdk/chat",
    exportName: "AgentPicker",
    role: "control",
    meaning: "Chooses one of the agents the host serves; it grants nothing: the server decides what the reader may use.",
  }),
  defineComponentMeta({
    componentId: "AgentAvatar",
    module: "@ontomato/sdk/chat",
    exportName: "AgentAvatar",
    role: "presentation",
    meaning: "An agent's avatar, from its stored image or colour and its initial.",
  }),
  defineComponentMeta({
    componentId: "ToolStep",
    module: "@ontomato/sdk/chat",
    exportName: "ToolStep",
    role: "presentation",
    meaning: "One tool call of a run: what was called, what it answered, and whether it failed.",
  }),
  defineComponentMeta({
    componentId: "Projection",
    module: "@ontomato/sdk/panel",
    exportName: "Projection",
    role: "presentation",
    meaning:
      "Stands where one projection of a panel is drawn: it reads that projection's current record by ID, draws the component the record names in this version's catalogue, and registers the ports the projection offers. A panel places and sizes the member container via CSS (including `class` and `style` on `<Projection>`), and the official component fills that box or uses its default height when none is given; it never draws a projection itself.",
    effects: "Reads the projection's current definition through the platform as the reader, and again when that definition changes.",
  }),
  defineComponentMeta({
    componentId: "ObjectList",
    module: "@ontomato/sdk/base",
    exportName: "ObjectList",
    role: "control",
    meaning:
      "Lists the owner's records of the projection's type (or the read's declared `rowType` when listing child objects of a different ontology type) in a compact list (single-line or two-line row height), multi-column table (`columns`, with optional `width`/`minWidth`, fixed head and row heights, single-line ellipsis unless `wrap: true`, horizontal scroll inside the table; or `dynamicColumns: true` when no static `columns` are given, deriving table columns from owner `fieldLabels` and record `fields` while excluding array-valued fields and preserving the last derived headers in an empty state within the same scope), or responsive card grid (`layout: 'cards'`), or single-row horizontal tab strip (`layout: 'tabs'`, with automatic left/right overflow scroll buttons, compact per-tab row action menu, and trailing `#tabs-extra` slot; default `'auto'` draws a table when `columns` or `dynamicColumns` is given and a compact list otherwise), from its `rows` datum (an owner's list or query read) or `objects` (ontology objects of a chosen type). Built-in row action column (`rowActions`) renders declared projection row operations (using per-row availability returned with the list read to avoid N+1 requests) alongside local buttons (`kind: 'local'`, emitting `row-action` with `{ id, ref, index }`), per-row visibility conditions (`when`), `hideWhenUnavailable` for operations unavailable on that row, and overflow into a 'More' dropdown menu beyond `maxVisible`. Customize cells, row actions, expanded row details, decorative leading marks, cards, toolbars, or empty states with standard Vue slots (`#cell-<columnKey>` and `#cell` receiving `{ ref, index, column, value, displayText, tone, operations, runOperation }`, `#actions` receiving `{ ref, index, operations, runOperation }`, `#row-detail` receiving `{ ref, index, collapse }` to drive child projections, `#item-leading` receiving no row data, `#card`, `#filters`, `#batch-actions`, `#toolbar-actions`, `#tabs-extra`, `#create-row`, `#empty`); raw row records are never handed to panel slots or events. The top toolbar stays fixed with search on the left (server search when the owner's read declares `search`; zero-request local search across `label`, `primaryKey`, `subtitle`, tags, and all typed/nested field values when the read is unpaged without server `search` and either `searchable: true` or `search` state is bound), optional `#filters`, batch actions (`#batch-actions`) when rows are checked, and `#toolbar-actions` on the right alongside optional built-in table controls: `showColumnToggle` (a local column-visibility popover with Select all and Reset that keeps at least one column visible and resets automatically when the column set changes) and `exportable` (an `Export current page (CSV)` button that downloads only the currently loaded rows in visible-column order with display headers as UTF-8 BOM RFC 4180 CSV using `exportFileName`, defaulting to `records-YYYY-MM-DD.csv`, disabled when empty); `#create-row` expands an inline create block at the top of the list. Unpaged reads also support zero-request local field-equality filtering via `localFilters` or non-read panel inputs, optional collapsible grouping (`groupBy` and `groupEmptyLabel`) with live filtered counts per group (omitting empty groups) across list, table, and card layouts, and automatic windowed rendering when more than 60 items are visible. The bottom footer stays fixed with the total count on the left whenever the owner returns `total` or local filtering is enabled on a complete list, numeric page buttons on the right in `page` mode (scrolling the list back to top on page change), and a Load more button that appends the next batch in `cursor` mode. Changing search or any filter resets paging to page 1; when the selected object reference changes and is present in the current list it expands its group if collapsed and scrolls into view (including jumping the virtual window). With `fallbackToFirst`, the first row is selected only on first showing (or after switching parent target) when nothing is selected, or after server or local search/filters change and the previously selected item is no longer listed (clearing to null when empty); selection cleared elsewhere is never re-selected automatically. Clicking an item or pressing Enter/Space on a focused table row or card selects its full typed object reference (`selected`), and arrow keys move focus between rows or cards without interfering with interactive controls inside; search matches are highlighted, typed record fields render natively, time columns support `timeFormat` (`relative`, `datetime`, `date`), and a reference field is a link the page hears as `navigate`. `listed` outputs the object references of the currently matching batch, both as a bindable output and as a read-only output. Other read-only outputs (`status`, `total` — complete-list length, owner-reported total for a query, or `null` when unknown, `loadedCount` — rows currently loaded in this batch/page, `filteredCount` — local text-match count only for complete unpaged lists else `null`, `checkedCount`, `selectedLabel`, `activeLabel`) are available to the panel without polluting writable public state. Three empty states distinguish no data (`emptyText` and optional `emptyHint`), narrowed no-match (with a Clear filters action that resets search, server/local filters and paging), and forbidden (showing the owner's reason when supplied). Missing required inputs show the waiting state. An optional `supplement` (`panelRecordList`) datum may be declared alongside `rows` or `objects` to merge supplementary per-row fields, labels, and tones in parallel without blocking primary rows; missing cells show `…` while loading, and a failed or forbidden supplement leaves primary rows usable with the failure reason available on hover.",
    effects: "Reads the bound type's list, query or ontology objects datum as the reader; runs declared row operations through the platform coordinator and writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    // Either list shape draws the table, and an ontology type lists its declared objects instead: no single one of these
    // is what a placement must declare, so none is required.
    data: {
      // The list supplies unbound search and paging values at runtime; authored state bindings take precedence.
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false, runtimeParams: ["search", "cursor", "size", "page"] },
      objects: { results: ["panelOntologyObjects"], required: false, runtimeParams: ["search", "page"] },
      supplement: { results: ["panelRecordList"], required: false },
    },
    outputs: {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      // References of the current batch: current page when paged, or all matching rows when unpaged.
      listed: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      search: { kind: "scalar", type: "string" },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      listed: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      total: { kind: "scalar", type: "number" },
      loadedCount: { kind: "scalar", type: "number" },
      filteredCount: { kind: "scalar", type: "number" },
      checkedCount: { kind: "scalar", type: "number" },
      selectedLabel: { kind: "scalar", type: "string" },
      activeLabel: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "GroupedGrid",
    module: "@ontomato/sdk/base",
    exportName: "GroupedGrid",
    role: "control",
    meaning:
      "Arranges either records from its `rows` (`panelRecordList`) datum (optionally preserving empty groups and group order from a parent container `record` datum's `groupsField`) or fixed static items from `items` (with optional `groups` and typed `layout` state) into collapsible groups on a responsive CSS grid (`columns`, `rowHeight`, `gap`) with optional stacked section tracks (`sectionField`, `sectionOrder`), drag-and-drop group and item reordering (within or across groups), pointer-driven cell resizing (`colSpanField`, `rowSpanField`, or per-item span bounds), optional item hiding (`allowHide`) and header toggles (`showGroupHeaders`, `showItemHeaders`), selection highlight and scroll-into-view (`selected`), and built-in per-item `rowActions`. Renders each cell body via the scoped `#item` slot (alongside `#item-header-actions`, `#group-header-actions`, `#group-empty`, and `#empty`) and never fetches cell body content itself. Writes `layout` state and emits `layout-change` only when the reader finishes a drag, resize, or hide interaction, never on initial load or restore.",
    effects:
      "In record mode, reads its `rows` list and optional container `record` datum as the reader, writes the panel's `selected` state, and runs declared per-item operations through the platform coordinator. In fixed-member mode, reads and writes the panel's typed `layout` state without querying any datum.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      rows: { results: ["panelRecordList"], required: false },
    },
    inputs: {
      selected: { kind: "object", objectType: "@data:rows" },
      layout: { kind: "grid-layout" },
    },
    outputs: {
      selected: { kind: "object", objectType: "@data:rows" },
      layout: { kind: "grid-layout" },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      groupCount: { kind: "scalar", type: "number" },
      itemCount: { kind: "scalar", type: "number" },
      hiddenCount: { kind: "scalar", type: "number" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectCount",
    module: "@ontomato/sdk/base",
    exportName: "ObjectCount",
    role: "presentation",
    meaning:
      "Draws a compact, inline tabular-numeral count strip from its `rows` (`panelRecordList` or `panelRecordQuery`, including customer ontology class `query` reads) or `objects` (`panelOntologyObjects`) datum, suitable for canvas headers, workbench toolbars, and compact trailing badges. Configure `label`, `labelKey`, or `labels` (localized label map), or `items` for multiple labels on the same count. Set `appearance` to `\"badge\"` for a bare compact numeral that omits rendering any node whenever no finite count is available (`omitWhenUnavailable` defaults to `true` for `\"badge\"` and `false` for `\"default\"`). Complete unpaged lists (`panelRecordList`) display `rows.length` (`0` when empty); paged queries (`panelRecordQuery`) and `panelOntologyObjects` display strictly the owner-returned `total` (never falling back to loaded row counts or inventing `0` on an empty response without `total`; shows `—` when unknown in default appearance). Shows `…` while loading, and a muted `—` with an explanatory tooltip when forbidden, awaiting inputs, or unreachable. Exposes `total` (`number | null`) as a read-only output.",
    effects: "Reads the bound platform or customer object type's list, query, or ontology objects datum as the reader; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    // Either `rows` (list/query) or `objects` (ontology objects) supplies the counted collection; at least one is declared.
    data: {
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false },
      objects: { results: ["panelOntologyObjects"], required: false },
    },
    readOnlyOutputs: {
      total: { kind: "scalar", type: "number" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectSummary",
    module: "@ontomato/sdk/base",
    exportName: "ObjectSummary",
    role: "presentation",
    meaning:
      "Shows the few facts of one object a reader recognises it by, including owner-supplied highlight ranges, status tags, clickable object references, and optional one-click copy buttons (`config.copyableFields`, resolving `#/...` hash links against the current browser origin and pathname). Which facts and in what order is the projection's display; what each holds is the object's own owner's. Set `config.showTitle` to `false` (default `true`) to hide the `record.label` heading when an `ObjectHeader` or section heading already introduces the object. Exposes `label` and `status` as read-only outputs.",
    effects: "Reads one object of the type the projection binds, as the reader.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: { record: { results: ["panelRecord"], required: true } },
    readOnlyOutputs: {
      label: { kind: "scalar", type: "string" },
      status: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectHeader",
    module: "@ontomato/sdk/base",
    exportName: "ObjectHeader",
    role: "presentation",
    meaning:
      "Draws a detail header with object name (`record.label` or `title`), one-line subtitle (`subtitleField` or `subtitle`), status badge (`statusField` paired with `record.tones`, or `status` + `statusTone`), and right-side actions. When mounted as a projection member with declared `operations`, exposes up to `maxVisibleOperations` (default 2, configurable without upper cap) operations inline via `OperationButton` in declared order (styling destructive operations as plain danger buttons inline when within the visible limit) and moves remaining overflow operations into an SDK dropdown More menu (whose accessible name automatically includes the current record title) using the shared operation dispatch, parameter dialog, and confirmation path. Also works standalone with `title`/`subtitle` and `#actions` (such as create-mode headers). Set `fallbackTitle` to keep a quiet single-line fallback while loading or missing. Exposes `label`, `status`, and `errorMessage` as read-only outputs (plus any named, typed scalar outputs explicitly declared by the bound read's owner).",
    effects: "Reads the bound object's `record` datum when declared and runs projection operations through the platform coordinator.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: { record: { results: ["panelRecord"], required: false } },
    readOnlyOutputs: {
      label: { kind: "scalar", type: "string" },
      status: { kind: "scalar", type: "string" },
      errorMessage: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectForm",
    module: "@ontomato/sdk/base",
    exportName: "ObjectForm",
    role: "control",
    meaning:
      "Draws one object's form exactly as its owner declares it (fields, values, read-only rules, defaults, non-blocking warnings; single-line `text` fields with `secret: true` render as password inputs with reveal toggle), from its `form` datum for the object its edited input holds, or, with nothing chosen and a `createForm` datum, a new object's. It asks the owner again when a field the form depends on changes, saves through the owner's form save its projection names (only the fields the reader set), marks the fields the owner refuses, offers a retry button when a form read fails, and supports live assistant field filling and saving. Hidden owner fields have no control. Fields declaring `defaultValue` (including `null`) show a Reset to default control that restores a deep copy of the default into the draft without saving immediately, disabled while already at default, read-only, or saving. Fields declaring `warning` render non-blocking warning guidance under the control without blocking Save. Set `config.layout` to `rows` (default `stacked`) for a settings-row layout (label and help left, control/error/warning middle, Reset to default right, stacking cleanly in narrow containers). Set `config.presentation` to `cards` (1 or 2 columns via `cardColumns` or group `column: 'main' | 'side' | 'full'`), `tabs`, or `steps` alongside `config.groups` (or owner `sections`), or supply a `#default` slot containing `<object-form-fields>` slices inside arbitrary panel cards, tabs, or steps — all sharing the same single form state, validation, dirty tracking, `usePanelFormDraft`, `usePanelBack`, and live assistant form filling. Set `config.actions` to `header` (default `footer`) to hide the bottom action bar and hand Save, Discard, and the unsaved marker to the enclosing page header (falling back to the footer when no header host is present), `create-only` to show Cancel/Create only in create mode while the panel places its own edit Save button, or `none` to omit the bar in both modes. With footer actions, an edit form hides the save bar while clean or when all non-hidden fields are read-only, and reveals it pinned at the foot once edited with a count of modified fields alongside Discard and Save; a create form keeps Cancel and Create pinned at the foot and emits `cancel` after resetting (confirming first if edited). Customize any field or array row item field by placing a component or nested `<Projection>` (such as `ReferencePicker` or `ObjectGraph`) inside the form's Vue slot `#field-<dotPath>` (e.g. `#field-skills`, `#field-modelSelection.modelId`, `#field-items.*.skillId`) or `#field`: the form draws it in that field's place so the owner's order and sections hold; a reference without a slot is shown as unavailable to edit. Customize footer controls with `#actions` or `#after-fields`. An owner may group its fields into `sections` (each a title and a hint, in order); the form draws them one after another with a list of them beside. It asks before Discard throws unsaved changes away. A page that opens it under a parent fixes the fields the parent decides with `fixedFields` (each from a panel state field or a literal): they show read-only and every save submits them. It exposes `label`, `dirty`, and `draft` as read-only outputs without requiring writable panel state, tells the page `saved` (with the object), `discarded`, and `cancel`, and asks the reader before the panel moves it off unsaved changes.",
    effects: "Reads the owner's form and saves through the owner's own interface; it saves through the owner's form save its projection names.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "Action:*"],
    // A form edits an existing record or creates a new one; which of the two a placement shows is its own choice.
    data: {
      // The form asks its owner again with the values it holds and the field that changed.
      form: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] },
      createForm: { results: ["panelFormDescription"], required: false, runtimeParams: ["values", "changedField"] },
    },
    readOnlyOutputs: {
      label: { kind: "scalar", type: "string" },
      dirty: { kind: "scalar", type: "boolean" },
      draft: { kind: "json" },
    },
  }),
  defineComponentMeta({
    componentId: "OperationButton",
    module: "@ontomato/sdk/base",
    exportName: "OperationButton",
    role: "control",
    meaning:
      "The button of one operation its projection names (`config.operation`, the projection's local name for it): it shows the owner's label and runs it on the object, or the checked objects, its target input holds. When the owner declares editable `inputSchema.properties` (and the operation is neither a file upload nor a read bound to a form draft or `readOperationInputs`), clicking the button opens a parameter dialog to collect and validate those inputs before running; operations without editable parameters run directly. A single write done is said in the platform's message in the owner's words, naming what it acted on (the button often goes with what it deleted); a batch is reported beside the button item by item; a refusal or failure stays beside it. The page hears every outcome as the `done` event. What a write removed is let go of by the panel: a selection holding it is cleared and a checked list drops it.",
    effects: "Runs the named operation as the reader, as its owner admits it now.",
    bindsElement: ["PlatformOperation:*"],
    // The button reads no datum: its operation is the projection's, described by its owner as admitted now.
    data: {},
  }),
  defineComponentMeta({
    componentId: "OperationResult",
    module: "@ontomato/sdk/base",
    exportName: "OperationResult",
    role: "presentation",
    meaning:
      "Displays the result returned by a read-only panel operation (`markdown`, `json`, `file`, or multi-section `sections` with tabbed `records` tables, language-tagged `code`, and `json` panes). Pure presentation: reads and writes nothing itself.",
  }),
  defineComponentMeta({
    componentId: "FileUploadControl",
    module: "@ontomato/sdk/base",
    exportName: "FileUploadControl",
    role: "control",
    meaning:
      "The control of one operation its projection names (`config.operation`) whose owner takes a file (it declares an `upload`, such as `skills.import`): it opens the file picker for the declared kinds, checks the file's kind and size, uploads it and runs the operation once with it, and shows the owner's answer with the file's name and size. Optional `intro` and `rules` are shown before the picker. With `overwrite-on` set to the owner's refusal code for an existing item (for `skills.import`, `SKILL_EXISTS`), it sends the same file again with `overwrite: true`, and the platform's confirmation, naming the file and what it replaces, is the one question the reader answers.",
    effects: "Uploads the picked file for the named operation and runs it as the reader, as its owner admits it now.",
    bindsElement: ["PlatformOperation:*"],
    // The control reads no datum: its operation is the projection's, described by its owner as admitted now.
    data: {},
  }),
  defineComponentMeta({
    componentId: "ReferencePicker",
    module: "@ontomato/sdk/base",
    exportName: "ReferencePicker",
    role: "control",
    meaning:
      "Chooses a reference from the bound type's records or option catalogue in either of two modes. In form-field mode (when placed inside an `ObjectForm` field Vue slot such as `#field-skills`, `#field-modelSelection.modelId`, `#field-items.*.skillId`, or `#field`), it connects automatically to the enclosing form field and writes the owner's own value (a skill's whole reference, a model's key) into the form so the choice is saved and discarded with it; `options` finds choices, `selected` resolves the values already in the form, descriptions and empty defaults are shown, and unavailable values remain listed with the owner's reason. In standalone inline mode (when rendered outside a form field slot), it renders a compact, filterable single-select dropdown directly at the `<Projection>` site (suited for workbench toolbars such as path start/target pickers), reading either `data.rows` (`panelRecordList` filtered locally in memory with zero extra requests, or paged `panelRecordQuery` whose `search` parameter is forwarded to the owner's read, and optionally grouped by a record field via `groupBy`) or `data.options` (`panelOptionList`), and syncing the chosen `{ className, primaryKey }` (or `null` when cleared) through the `selected` output/member parameter; when the selected object is absent from the loaded choices, `data.selected` can read the owner's `resolve` (`panelOptionList`) or `record` (`panelRecord`, sourced from the selected object input). When the choices are forbidden or unreachable, the dropdown is disabled with a readable tooltip. Both modes expose an `#option` Vue slot to customize option rows.",
    effects: "Reads the bound type's options or records as the reader; writes only the target form field in form-field mode, or the panel's `selected` state in standalone inline mode.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    // A standalone picker can read a selected object outside the current page through the owner's record read.
    data: {
      // The reader's search and page of choices, and the values already held.
      options: { results: ["panelOptionList"], required: false, runtimeParams: ["keyword", "page"] },
      selected: { results: ["panelOptionList", "panelRecord"], required: false, runtimeParams: ["values"] },
      // Complete lists filter locally; paged queries pass search to the owner.
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false, runtimeParams: ["search"] },
    },
    outputs: {
      selected: { kind: "object", objectType: "@binding" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectGraph",
    module: "@ontomato/sdk/base",
    exportName: "ObjectGraph",
    role: "control",
    meaning:
      "Draws the records its `nodes` datum reads as a graph joined by the records its `edges` datum reads, each edge between the node keys its fields name at `edgeEnds`. Placed inside an `ObjectForm` field Vue slot (`#field-<path>` or `#field`), it chooses that field's list of node keys in the field's place: a choice adds or removes a node, the nodes one edge away from a chosen one are marked, and one action adds them all; a line sums the choice up, a legend names the three looks, and a list offers the same choice by name. Otherwise it is the page's graph canvas on the platform's G6 canvas, shared by the ontology graph and visual modeling (with `#toolbar` and `#overlay` Vue slots): a chosen node or edge is the panel's state of the type its datum reads (`selectedNode`, `selectedEdge`), a click on empty canvas lets both go, where the reader puts the nodes is kept per person (`positions`, a personal `json` state) and drawn again from there, a node never placed is placed by its relations (the most connected first, each node one relation on in the next column) and nothing is written for it, and with `editable` a line drawn with Shift from one node to another hands the panel its two ends (`connectFrom`, `connectTo`) for the owner's new-edge form. When `nodes` are readable and `edges` are forbidden, all readable nodes are still drawn with a non-blocking notice explaining that relations cannot be viewed; when `nodes` are forbidden the graph shows the access refusal. Each edge is drawn with its record's label; edges between the same two nodes fan out. Given `pathFrom` and `pathTo` bound to panel state, the canvas finds the shortest directed path along visible edges, highlights it distinctly from search matches (`highlightedNodes`, `highlightedEdges`), displays the path trail and hop count on the canvas, and reports what is highlighted — search matches vs a directed path with start, target, outcome and hops — into `pageContext.highlights`; when edges are partially or fully forbidden, 'no path found in the visible graph' and the hidden-relations permission notice are reported separately. What the panel highlights stands out and the rest fades, without being chosen. The view opens on the chosen node, else the most connected, never smaller than names can be read at; a larger graph is panned. The canvas carries zoom in and out, fit, centring the chosen node, relayout (which lets the reader's places go) and a PNG of the view; names keep their size however far the reader zooms out, a name with no room being hidden until there is; the graph is fitted again once its container settles at a new size; and its zoom is a port (`zoom`), read and set by the page. The canvas fills the height of the box its member is placed in and falls back to its own default minimum height (420px) when that box has no definite height. Each node takes its category's colour of the platform palette when `nodeCategory` (a JSON Pointer into each node record's fields) and `categories` (the order of the colours) are configured; `nodeSize` and `labelSize` (screen pixels) draw the nodes and their names larger or smaller than the platform's own, and the placement leaves rows to fit them. It decides nothing about what the nodes stand for or who may read them.",
    effects: "Reads the node and edge types' lists as the reader; it writes the enclosing form field when placed inside an `ObjectForm` field slot, or the panel state its outputs bind, never the owner.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      nodes: { results: ["panelRecordList"], required: true },
      edges: { results: ["panelRecordList"], required: true },
    },
    // What the panel marks on the graph for the reader: search hits or a directed path query, never chosen.
    inputs: {
      highlightedNodes: { kind: "list", items: { kind: "object", objectType: "@data:nodes" } },
      highlightedEdges: { kind: "list", items: { kind: "object", objectType: "@data:edges" } },
      // Start and target of a directed shortest-path query on the visible graph, bound to panel state.
      pathFrom: { kind: "object", objectType: "@data:nodes" },
      pathTo: { kind: "object", objectType: "@data:nodes" },
      // The zoom the page sets: the canvas zooms to it.
      zoom: { kind: "scalar", type: "number" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "@data:nodes" },
      selectedEdge: { kind: "object", objectType: "@data:edges" },
      connectFrom: { kind: "scalar", type: "string" },
      connectTo: { kind: "scalar", type: "string" },
      positions: { kind: "json" },
      // The zoom the canvas shows, to two decimals, as the reader zooms.
      zoom: { kind: "scalar", type: "number" },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      error: { kind: "scalar", type: "string" },
      pathStatus: { kind: "scalar", type: "string" },
      pathMessage: { kind: "scalar", type: "string" },
      pathHops: { kind: "scalar", type: "number" },
      nodeCount: { kind: "scalar", type: "number" },
      edgeCount: { kind: "scalar", type: "number" },
    },
  }),
  defineComponentMeta({
    componentId: "MetricChart",
    module: "@ontomato/sdk/base",
    exportName: "MetricChart",
    role: "presentation",
    meaning:
      "Draws one chart as its source card draws it: the card's chart file (`template`) filled with a MetricView's output (`result`) for the card's saved parameters and the values the panel binds over them. The platform supplies both, and an output with no rows is the owner's empty answer. It fills the height of the box its member is placed in and falls back to a 320px default height when that box has no definite height. The projection keeps no drawing, query or data of its own.",
    effects: "Sends no request of its own: the platform reads the source card's template and the MetricView's output, both as the reader.",
    bindsElement: ["MetricView:*"],
    // The chart file and the output it is filled with: drawn once both are read.
    data: {
      template: { results: ["chartTemplate"], required: true },
      result: { results: ["metricOutput"], required: true },
    },
  }),
  defineComponentMeta({
    componentId: "GraphCanvas",
    module: "@ontomato/sdk/base",
    exportName: "GraphCanvas",
    role: "control",
    meaning:
      "Draws the nodes and edges it is given as a light SVG graph, each node in the tone its caller gives it and marked when its ID is among the selected ones, and hands back the selection a reader's choice results in and the part of the graph in view. What the nodes are, which may be chosen and what a choice implies are its caller's: it reads nothing and decides nothing about them.",
  }),
  defineComponentMeta({
    componentId: "InteractiveGraphCanvas",
    module: "@ontomato/sdk/graph",
    exportName: "InteractiveGraphCanvas",
    role: "control",
    meaning:
      "Draws the nodes and edges it is given as an interactive canvas that a reader pans, zooms and drags: each node coloured by its category from the edition's palette, edges labelled, dashed or weighted as given, and invisible anchors for aggregated edges. It hands back the selection a reader's choice results in, the part of the graph in view, a double-click, a dragged node's new place and a click on empty canvas, and gives its caller the current positions and an image of the view. What the nodes are, what a choice means, and where positions and images are kept are its caller's: it reads and stores nothing.",
  }),
  defineComponentMeta({
    componentId: "OntologyGraph",
    module: "@ontomato/sdk/graph",
    exportName: "OntologyGraph",
    role: "control",
    meaning:
      "Draws an interactive G6 graph from the bound resource's graph source port: type mode arranges declared types and relation kinds by layer with per-type readable counts and access statuses; sampled overview mode (`overview` and optional deferred `connections` ports) arranges nodes into grouped clusters with obstacle-avoiding group headings, aggregated inter-group edges (which fade behind a selected node's direct edges), generation/empty/truncation notices, and version-conflict recovery; instance mode expands one-hop neighbors with optional paginated loading (`offset`, `limit`) and direction/target-group/relation filtering. Preserves complete object identities, highlights drawn query matches, syncs `visibleLayers`, `visibleRelationKinds`, `expandedNodes`, and per-person `positions` (`json`) bidirectionally with panel state, distinguishes no-neighbors, owner-refused and read-failed outcomes, provides toolbar controls (aggregated edges, edge labels, zoom, fit, relayout, refresh, PNG export) plus `#toolbar` and `#overlay` slots, and publishes read-only summary outputs. The graph fills the height of the box its member is placed in and falls back to a 420px canvas height when that box has no definite height.",
    effects: "Reads the bound graph source's schema, counts, starting node, sampled overview, deferred connections, and paginated one-hop neighbors as the reader; writes only the panel's own selection, layer filter, relation-kind filter, expanded-nodes, and personal positions state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    // Expanding from a node is what the graph does; optional overview, deferred connections, and schema/counts/start reads activate when a placement supplies them.
    data: {
      schema: { results: ["panelGraphSchema"], required: false },
      counts: { results: ["panelGraphCounts"], required: false },
      start: { results: ["panelGraphStart"], required: false },
      overview: { results: ["panelGraphOverview"], required: false },
      connections: { results: ["panelGraphConnections"], required: false, runtimeParams: ["version", "sampleToken"] },
      // The node the reader expands, plus optional layers, relation kinds, target group, direction, and paging parameters.
      neighbors: {
        results: ["panelGraphNeighbors"],
        required: true,
        runtimeParams: ["node", "layers", "relationKinds", "targetClass", "direction", "limit", "offset"],
      },
    },
    // What a placement hands the graph: how it draws, where instance mode starts, what is selected, what to highlight,
    // which layers are visible, which nodes are expanded, and saved per-person node coordinates.
    inputs: {
      mode: { kind: "scalar", type: "string" },
      start: { kind: "object", objectType: "@any" },
      selected: { kind: "object", objectType: "@any" },
      selectedType: { kind: "scalar", type: "string" },
      query: { kind: "scalar", type: "string" },
      visibleLayers: { kind: "list", items: { kind: "scalar", type: "string" } },
      expandedNodes: { kind: "list", items: { kind: "object", objectType: "@any" } },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "@any" },
      selected: { kind: "object", objectType: "@any" },
      selectedType: { kind: "scalar", type: "string" },
      // The relation kinds drawn, read as well as written: a page's own kind filter and the graph follow one choice.
      visibleRelationKinds: { kind: "list", items: { kind: "object", objectType: "platform:OntologyRelationKind" } },
      visibleLayers: { kind: "list", items: { kind: "scalar", type: "string" } },
      expandedNodes: { kind: "list", items: { kind: "object", objectType: "@any" } },
      positions: { kind: "json" },
    },
    readOnlyOutputs: {
      startLabel: { kind: "scalar", type: "string" },
      startDetail: { kind: "scalar", type: "string" },
      visibleRelationKindLabels: { kind: "list", items: { kind: "scalar", type: "string" } },
      activeMode: { kind: "scalar", type: "string" },
      graphStatus: { kind: "scalar", type: "string" },
      graphVersion: { kind: "scalar", type: "string" },
      sampleToken: { kind: "scalar", type: "string" },
      nodeCount: { kind: "scalar", type: "number" },
      edgeCount: { kind: "scalar", type: "number" },
      hasMoreNeighbors: { kind: "scalar", type: "boolean" },
      versionChanged: { kind: "scalar", type: "boolean" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectRelations",
    module: "@ontomato/sdk/base",
    exportName: "ObjectRelations",
    role: "control",
    meaning:
      "Lists one-hop relations of the selected node from the bound resource's graph neighbors port, grouped by relation kind with distinct no-neighbors, owner-refused, read-failed and unavailable states, showing edge direction, stored/derived line semantics, and optional edge binding details (`reads`, `operations`, `viaInput`). Supports filtering by relation kind (`visibleRelationKinds` and optional `showRelationFilter` multi-select), optional header summary (`showSummary`) and empty-group collapsing (`collapseEmptyGroups`), moving selection to a clicked peer node (`selected`), and promoting a peer node as graph start (`allowSetStart` / `start`). Exposes `status`, `edgeCount`, and `label` as read-only outputs. `edgeCount` is null when the result is truncated. For a customer relationship, set `data.neighbors.type` to the relationship ID.",
    effects: "Reads the bound graph source's one-hop neighbors as the reader; writes only the panel's own selection, start, and visible relation kinds state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "Relationship:*"],
    // The node a reader moved to, when no state the author bound holds it.
    data: { neighbors: { results: ["panelGraphNeighbors", "panelRelationNeighbors"], required: true, runtimeParams: ["node"] } },
    inputs: {
      selected: { kind: "object", objectType: "@any" },
      visibleRelationKinds: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    outputs: {
      selected: { kind: "object", objectType: "@any" },
      start: { kind: "object", objectType: "@any" },
      visibleRelationKinds: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      edgeCount: { kind: "scalar", type: "number" },
      label: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "SegmentedControl",
    module: "@ontomato/sdk/base",
    exportName: "SegmentedControl",
    role: "control",
    meaning:
      "Switches one declared scalar panel state between mutually exclusive options supplied by the owner's `counts` datum (`[{key, label, count}]`) or static configuration. It binds no ontology element.",
    data: { counts: { results: ["panelGroupCounts"], required: false } },
    outputs: { value: { kind: "scalar", type: "string" } },
  }),
  defineComponentMeta({
    componentId: "TwoPaneLayout",
    module: "@ontomato/sdk/base",
    exportName: "TwoPaneLayout",
    role: "presentation",
    meaning:
      "List-detail layout in one bordered block: side-by-side (`mode: 'split'`, left pane at `--pane-list-width`) or full-width alternating (`mode: 'switch'`), automatically switching to full-width alternating when its own container width is at or below `--pane-narrow-breakpoint` (680px). Fills definite container height with independent pane scrolling, keeps `#aside` DOM alive across switches to preserve scroll position and filters, scrolls `#default` back to top when `selectionKey` changes, provides fixed `#header`, `#tabs`, and `#footer` regions plus `#empty` placeholder, and omits `selected` to preserve legacy always-visible two-pane usage. It binds nothing.",
  }),
  defineComponentMeta({
    componentId: "WorkbenchLayout",
    module: "@ontomato/sdk/base",
    exportName: "WorkbenchLayout",
    role: "presentation",
    meaning:
      "Three-pane workbench layout for graph and canvas pages: collapsible left `#aside` (`--workbench-aside-width`), full-height center canvas (`#default`), and selection-driven right detail pane (`--workbench-detail-width`) with fixed `#detail-header`, `#detail-tabs`, scrollable `#detail` (resets scroll to top on `selectionKey` change), and `#detail-footer`. Below `--workbench-narrow-breakpoint` (880px), the canvas stays full width while both side panes become mutually exclusive floating overlays (at most one open at a time). It binds nothing.",
  }),
  defineComponentMeta({
    componentId: "SectionGroup",
    module: "@ontomato/sdk/base",
    exportName: "SectionGroup",
    role: "presentation",
    meaning:
      "One titled group of a page's content, with one line of what it is for and the platform's spacing and hairline between groups that follow one another. It binds nothing.",
  }),
  defineComponentMeta({
    componentId: "PageHeader",
    module: "@ontomato/sdk/base",
    exportName: "PageHeader",
    role: "presentation",
    meaning:
      "Pure presentational page header rendered by a panel at the top of its content: optional leading visual, explicit back link, single-line title (plain text or a projection-bound component in `#title`), optional description, flexible right-side actions/controls (`#actions` or default slot), and optional Save/Discard draft controls (`draft`). It asks nothing from the platform host and adapts to its own container width.",
  }),
  defineComponentMeta({
    componentId: "AppMenu",
    module: "@ontomato/sdk/base",
    exportName: "AppMenu",
    role: "control",
    meaning:
      "Official application navigation menu column shared by the platform shell and application frame panels. Inside an application frame panel, `<app-menu>` automatically renders the admitted entries from `usePanelContext().entryMenu`, highlights `usePanelContext().currentEntry.path`, adapts to a compact selector on narrow screens, and navigates via `usePanelContext().navigate(id)` unless a custom `@select` handler is provided. Use the `#item-trailing` slot (`{ item }`) to place trailing projections or indicators per row, `:item-trailing-text` for plain-text option suffixes in the compact mobile selector, and `:icons` for curated platform icon keys.",
    effects: "Navigates within the platform through the panel host when the reader selects a menu entry; reads no business data itself.",
  }),
  defineComponentMeta({
    componentId: "TypedValue",
    module: "@ontomato/sdk/base",
    exportName: "TypedValue",
    role: "presentation",
    meaning:
      "Displays one typed field value according to its owner-declared type — text, tabular number (`numberFormat`), localized date/datetime/relative-time, localized boolean, semantic status tag (`tone` or `record.tones`), tag list, clickable object reference (`navigate`), multi-language name, list, or code/JSON — with optional exact-match `valueMap` (`{ [rawValue]: { label?, labelKey?, labels?, tone?, icon? } }`) mapping raw scalar values to localized labels, semantic tones, and platform icons without computing new values or evaluating range/threshold expressions. Reads from its projection's `record` (`panelRecord`) or metric `result` (`metricOutput`, scalar/first-row or named column at `rowIndex`) datum, or renders a direct `value` prop standalone or inside a slot.",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
  }),
  defineComponentMeta({
    componentId: "RecordTemplate",
    module: "@ontomato/sdk/base",
    exportName: "RecordTemplate",
    role: "presentation",
    meaning:
      "Fills already-provided values from one record (`record`) or one metric result row (`result` at `rowIndex`) into a fixed `{fieldKey}` sentence template (`template`, `templateKey`, or locale-keyed `templates`), with optional per-field `fieldFormats` (including exact-match `valueMap`). Pure display with no expressions, calculation, or conditional sentence branching — derived values and business conditions belong in a MetricView, Action, or owner read. Each placeholder renders via `TypedValue`, keeping references clickable (`navigate`), booleans/names localized, tones tinted, and numbers tabular.",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
  }),
  defineComponentMeta({
    componentId: "InfoBanner",
    module: "@ontomato/sdk/base",
    exportName: "InfoBanner",
    role: "presentation",
    meaning:
      "Standardized informational, reminder, warning, success, or danger callout banner (`tone`, `toneField`, exact-match `toneMap`/`valueMap`, or platform `icon`) for detail cards and guidance notices. Renders static or localized copy (`title`/`text`, `titleKey`/`textKey`, `titles`/`texts`), custom slot content (`#default`, `#actions`), or already-provided values bound from a `record` (`panelRecord`) or metric `result` (`metricOutput`) datum via `field` or a fixed `{fieldKey}` `template` (with optional `fieldFormats`; no calculation, range thresholds, or conditional branching).",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectRefCard",
    module: "@ontomato/sdk/base",
    exportName: "ObjectRefCard",
    role: "presentation",
    meaning:
      "Displays one clickable object reference card — leading icon or monogram, optional role caption (such as Source or Target), primary localized display name, secondary monospace API name / primary key, and optional status badge — emitting `navigate` (and writing declared navigation output) on click. Reads a reference field (`field`) or the object itself from `record` (`panelRecord`) or metric `result` (`metricOutput`), or renders a direct `reference` / `record` prop standalone.",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
    outputs: {
      navigate: {
        kind: "object-union",
        layers: ["fact", "capability", "governance", "product"],
        objectTypes: ["platform:OntologyType"],
      },
    },
  }),
  defineComponentMeta({
    componentId: "MetricCard",
    module: "@ontomato/sdk/base",
    exportName: "MetricCard",
    role: "presentation",
    meaning:
      "Displays one or more statistical metric cards (label + tabular numeral + optional unit, description, and semantic tone) in `card`, `compact`, or `inline` variants for ontology headers, dashboards, and catalog summaries. Directly consumes a MetricView's `result` (`metricOutput`, extracting a scalar or named column from the first or `rowIndex` row, and surfacing truncation hints), a single `record` (`panelRecord`), `rows` (`panelRecordList` uses list length; `panelRecordQuery` uses strictly the owner-returned `total`, never loaded row counts), or `objects` (`panelOntologyObjects` owner `total`), or standalone `value`/`items` props. Pure presentation: never computes aggregations on the client.",
    effects: "Reads the bound MetricView `result`, `record`, `rows`, or `objects` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      result: { results: ["metricOutput"], required: false },
      record: { results: ["panelRecord"], required: false },
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false },
      objects: { results: ["panelOntologyObjects"], required: false },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectFormFields",
    module: "@ontomato/sdk/base",
    exportName: "ObjectFormFields",
    role: "presentation",
    meaning:
      "Renders a selected subset of an enclosing `ObjectForm`'s fields (`fields`, `parent`, `section`, `group`, or `rest`) inside panel-authored layouts, including field slots. Absolute field paths and `parent` can select active object sub-fields. Every slice shares form state, validation, dirty tracking, `usePanelFormDraft`, `usePanelBack`, and live assistant form filling. It reads nothing itself and binds no ontology element.",
  }),
  defineComponentMeta({
    componentId: "PathTree",
    module: "@ontomato/sdk/base",
    exportName: "PathTree",
    role: "control",
    meaning:
      "Arranges a flat list of slash-separated paths into a folder-first, name-sorted, default-expanded tree; clicking a folder only collapses or expands it, while clicking a file emits its key and highlights the active row. It reads nothing and carries no business rules.",
  }),
  defineComponentMeta({
    componentId: "SegmentedTextReader",
    module: "@ontomato/sdk/base",
    exportName: "SegmentedTextReader",
    role: "control",
    meaning:
      "Displays offset-paged plain-text segments for a selected source with a close control and a More button when another offset exists, coordinating shared activeAnchor state so multiple placements on one page expand only one reader at a time.",
  }),
  defineComponentMeta({
    componentId: "ObjectTree",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTree",
    role: "control",
    meaning:
      "Shows one object's files — a skill package's, say — as a folder/file tree, from its `files` datum (an owner's records, one per file, at the path `pathField` gives, else the record's own key). Clicking a file selects it: `selected` is the file's key, which the placement can bind to the panel's state so another member (an ObjectTextReader's `record`) reads that file. When `searchable` is enabled, a local filter box filters the tree and binds its keyword to `search` public state. When nothing is selected (`selected` is null), `defaultKey` selects that file if present, otherwise `fallbackToFirst` selects the first file in tree order; an explicit selection is kept intact even if absent from `files` so a paired reader can report it in place. Folders open and close; they are not selected.",
    effects: "Reads the owner's files as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*"],
    data: { files: { results: ["panelRecordList"], required: true } },
    outputs: {
      selected: { kind: "scalar", type: "string" },
      search: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "ObjectTextReader",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTextReader",
    role: "presentation",
    meaning:
      "Shows an object's text read only, through its owner's reads. Sources read page by page: `sources` lists them as chips (one owner record per source), and `page` reads the chosen source's text one page at a time (an owner's query whose rows are the text's segments, `fields.text`, with `nextCursor` for the next page); the reader opens one source at a time and \"More\" reads the next page. One object's whole text: `record` reads it and the field `textField` names (`content` by default) is shown according to `format` (`auto` by default, inferring Markdown with optional YAML frontmatter separation, CSV/TSV table preview, or a read-only code viewer from `pathField`, `record.label`, or `record.primaryKey`, and falling back to preformatted text when no extension is present; `plain`, `markdown`, `table`, `code`, and `diff` override auto-detection, with `diff` parsing standard unified diffs into file summaries, per-file change cards, binary notices, and line-numbered hunks). Clicking a relative `.md` link inside Markdown normalizes the path against the current document and writes it to `activePath`. Its outputs `activeSourceId`, `activeAnchor`, and `activePath`, bound to the panel's state, are read as well as written: the page opens a source by writing it (and, for a reader with an `anchor`, that anchor), and readers sharing them on one page have only one open. Which sources it lists is the `sources` read's: an owner read of one issue's cited sources lists only those.",
    effects: "Reads the owner's sources, pages and records as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: {
      sources: { results: ["panelRecordList"], required: false },
      // The chosen source and the page's cursor are the reader's own, unless the placement binds them.
      page: { results: ["panelRecordQuery"], required: false, runtimeParams: ["source", "cursor"] },
      record: { results: ["panelRecord"], required: false },
    },
    outputs: {
      activeSourceId: { kind: "scalar", type: "string" },
      activeAnchor: { kind: "scalar", type: "string" },
      activePath: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "AnnotatedCode",
    module: "@ontomato/sdk/base",
    exportName: "AnnotatedCode",
    role: "presentation",
    meaning:
      "Displays line-numbered source code alongside hierarchical line-range annotation segments from its `content` (`annotatedCode`) datum, with bidirectional line/segment highlighting and scrolling (including automatically scrolling both panes when `activeSegmentId` changes externally and clearing highlights when it is cleared to `null`), a deduplicated kind legend, expandable structured detail rows with clickable reference buttons (`refKey`), an optional outdated-code notice when the `currentCode` input differs from `content.code`, and optional summary blocks. Emits `select-ref` and `select-segment`, accepts optional `currentCode` and `activeSegmentId` inputs (with `activeSegmentId` also writable to bound panel state), and exposes `status`, `activeSegmentId`, and `selectedRef` as read-only outputs.",
    effects: "Reads the bound object's annotatedCode datum as the reader; writes only the panel's own segment selection state and read-only outputs.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      content: { results: ["annotatedCode"], required: true },
    },
    inputs: {
      currentCode: { kind: "scalar", type: "string" },
      activeSegmentId: { kind: "scalar", type: "string" },
    },
    outputs: {
      activeSegmentId: { kind: "scalar", type: "string" },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      activeSegmentId: { kind: "scalar", type: "string" },
      selectedRef: { kind: "scalar", type: "string" },
    },
  }),
  defineComponentMeta({
    componentId: "ConversationEntry",
    module: "@ontomato/sdk/base",
    exportName: "ConversationEntry",
    role: "control",
    meaning:
      "Renders a conversation entry for a projection: in its default button presentation, clicking asks the platform host to expand the page's composer with the projection's declared conversationEntry without sending a message; in presentation='inline', renders the platform's inline composer (agent selector and prompt input) directly inside the page and serves sibling ConversationEntry triggers while mounted (typically paired with pageComposer: 'none' on the application entry).",
    effects: "In button mode, requests the host to expand the page's composer without sending; in inline mode, submits the reader's typed prompt to the platform agent counter.",
    bindsElement: ["PlatformObjectType:platform:AgentDefinition"],
    // A button the host acts on: it reads nothing from the platform, and says so, so a placement may carry it as a member.
    data: {},
  }),
  defineComponentMeta({
    componentId: "CurrentEntry",
    module: "@ontomato/sdk/base",
    exportName: "CurrentEntry",
    role: "presentation",
    meaning:
      "Where an application's frame panel shows the entry the reader opened: write <current-entry member=\"content\"> in the frame's template for its member whose target is {fromPlatform: \"currentEntry\", candidates: {rule: \"applicationEntry\"}}. The content drawn there is the one the platform already admitted and runs, never started again here; the frame chooses where it goes, not which panel or with what inputs. The frame's code reads the entry shown and the menu the same resolution gave through usePanelContext().currentEntry and .entryMenu, to draw its menu and mark the entry; opening another entry goes through navigate. Outside an application's frame the place says it shows nothing; a member that is not the current entry is refused in its place.",
    effects: "Reads nothing and writes nothing: the platform places the admitted content.",
  }),
  defineComponentMeta({
    componentId: "PanelData",
    module: "@ontomato/sdk/base",
    exportName: "PanelData",
    role: "presentation",
    meaning:
      "Draws nothing: a non-rendering member strictly for declaring non-UI operations invoked through usePanelOperation(member, name, options?) (which registers a mounted page action entry by default; pass { entry: false } for non-UI background flows). Do not use PanelData to read or render business fields in a panel; use an official component, configure it, or write a component for that slot.",
    // Any datum the projection names, under the author's own name, with any read result and the run-time values the
    // other components give; the read's own signature still bounds them. The catalogue test keeps these lists whole.
    data: {
      "*": {
        results: [
          "panelRecordList", "panelRecord", "panelRecordQuery", "panelGroupCounts", "panelApplicationMenu",
          "productProjectionList", "productPanelList", "productProjectionRecord", "productPanelRecord", "productProjectionUsedBy",
          "productPanelUsedBy", "productPanelMembers", "productCatalogueGrants", "applicationEntries",
          "panelFormDescription", "panelOperationDescriptor", "panelOptionList", "panelGraphSchema", "panelGraphConnections",
          "panelGraphCounts", "panelGraphOverview", "panelGraphStart", "panelGraphNeighbors", "panelOntologyObjects",
          "panelRelationNeighbors", "chartTemplate", "metricOutput",
          "sdkComponentDefinition", "actionDefinition", "actionExplanation", "annotatedCode",
          "scheduledTaskRunPage", "scheduledTaskRun",
        ],
        required: false,
        // What another component gives itself, and every parameter an owner's read declares in a fixed signature: the
        // page's own code may give any of them (a datum read for a class takes `className`).
        runtimeParams: [
          "business", "by", "category", "changedField", "className", "cursor", "defaultAppId", "direction", "editMode",
          "entryId", "favoritesOnly", "filters", "keyword", "layers", "limit", "node", "object", "objectType", "offset",
          "operation", "orgId", "origin", "page", "parentId", "path", "primaryKey", "rating", "relationKinds",
          "runId", "sampleToken", "scope", "search", "section", "size", "sort", "source", "sourceType", "status",
          "targetClass", "targetGroup", "template", "type", "values", "verdict", "version",
        ],
      },
    },
  }),
];
