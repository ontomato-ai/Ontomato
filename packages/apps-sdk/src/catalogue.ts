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
    group: "chart",
    meaning:
      "Reads one published MetricView and hands its result to the page's own template; the loading state and a failed read reach it as values, and it draws nothing itself.",
    effects: "Reads the MetricView through the data engine as the reader; it computes no metric of its own.",
    bindsElement: ["MetricView:*"],
  }),
  defineComponentMeta({
    componentId: "EChart",
    module: "@ontomato/sdk/chart",
    exportName: "EChart",
    role: "presentation",
    group: "chart",
    meaning:
      "Draws one ECharts option in the platform's chart theme, following its light and dark modes; it computes no value and reads nothing itself. In a panel, write `<e-chart>` in the template, without an import; the import is for an application page outside a panel.",
    bindsElement: ["MetricView:*", "Definition:*"],
    configProps: ["option", "theme", "height"],
  }),
  defineComponentMeta({
    componentId: "FormFields",
    module: "@ontomato/sdk/form",
    exportName: "FormFields",
    role: "control",
    group: "form",
    meaning:
      "Draws owner-declared form fields in owner order and limits; use `<form-fields>` for custom non-projection forms (`ObjectForm` for projections). In a panel, write `<form-fields>` in the template, without an import; the import is for an application page outside a panel.",
    bindsElement: ["Action:*"],
    configProps: ["fields", "values", "errors", "disabled", "choosePlaceholder", "readOnly"],
  }),
  defineComponentMeta({
    componentId: "CodeEditor",
    module: "@ontomato/sdk/code",
    exportName: "CodeEditor",
    role: "control",
    group: "content",
    meaning: "Edits code or structured text such as JSON, in the page's light or dark theme; it validates nothing. In a panel, write `<code-editor>` in the template, without an import; the import is for an application page outside a panel.",
    configProps: ["modelValue", "language", "placeholder", "minHeight", "readonly", "contentEndSpace"],
  }),
  defineComponentMeta({
    componentId: "MarkdownView",
    module: "@ontomato/sdk/markdown",
    exportName: "MarkdownView",
    role: "presentation",
    group: "content",
    meaning: "Draws a text as the platform reads Markdown, in the page's light or dark theme. In a panel, write `<markdown-view>` in the template, without an import; the import is for an application page outside a panel.",
    configProps: ["content", "final", "nodes"],
  }),
  defineComponentMeta({
    componentId: "TablePreview",
    module: "@ontomato/sdk/preview",
    exportName: "TablePreview",
    role: "presentation",
    group: "content",
    meaning: "Draws text cells as a table with paging; it reads no business meaning out of them. In a panel, write `<table-preview>` in the template, without an import; the import is for an application page outside a panel.",
    configProps: ["table", "pageSize", "arrange"],
  }),
  defineComponentMeta({
    componentId: "HtmlPreview",
    module: "@ontomato/sdk/preview",
    exportName: "HtmlPreview",
    role: "presentation",
    group: "content",
    meaning: "Draws a whole HTML document in a sandboxed frame; the document runs nothing outside that frame. In a panel, write `<html-preview>` in the template, without an import; the import is for an application page outside a panel.",
    configProps: ["html", "sandbox", "referrerpolicy", "title"],
  }),
  defineComponentMeta({
    componentId: "AppPreview",
    module: "@ontomato/sdk/preview",
    exportName: "AppPreview",
    role: "presentation",
    group: "content",
    meaning:
      "Embeds an application preview (candidate panel, live panel, or legacy hosted preview) through the platform host; use to show another application inside a page. The platform host holds the frame's credentials, so no preview token or raw iframe URL ever reaches the page.",
    effects:
      "Loads the target application preview through the platform host under server-enforced authorization; writes no business data itself.",
    data: {},
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      activePage: { kind: "scalar", type: "string" },
      selection: { kind: "json" },
    },
    configProps: ["appId", "revision", "entryId", "reloadKey"],
  }),
  defineComponentMeta({
    componentId: "AgentChat",
    module: "@ontomato/sdk/chat",
    exportName: "AgentChat",
    role: "control",
    group: "conversation",
    meaning:
      "Holds a live conversation with one declared platform agent, inside a panel member or in a standalone page; use for an embedded chat where `AgentShell` is the platform's own.\n\n- The member's `agent` declaration says who the chat talks to (`'page-default'`, `{ kind: 'id', id }` or `{ kind: 'preset', agentKind }`); the component grants nothing, so the reader's own agent grants and business gates decide what the conversation may reach.\n- Sessions and history stay on the agent platform and are never duplicated per panel: binding `sessionId` is how two placements, or a page reopened later, land in one conversation.\n- While the chat owns that surface the host suppresses its default composer, so the reader types in one place only.\n- `sessionContext` is opaque creation input the platform passes through untouched.",
    effects: "Sends the reader's messages to the agent platform as the signed-in user, shares its session history, and writes only the panel's optional `sessionId` state.",
    bindsElement: ["PlatformObjectType:platform:AgentDefinition"],
    data: {},
    inputs: {
      sessionId: { kind: "scalar", type: "string" },
    },
    outputs: {
      sessionId: { kind: "scalar", type: "string" },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      sessionId: { kind: "scalar", type: "string" },
      busy: { kind: "scalar", type: "boolean" },
    },
    configProps: [
      "showHeader", "placeholderKey", "sessionContext", "collapsed", "greeting", "greetingKey", "description",
      "descriptionKey", "feedback",
    ],
  }),
  defineComponentMeta({
    componentId: "AgentShell",
    module: "@ontomato/sdk/chat",
    exportName: "AgentShell",
    role: "control",
    group: "conversation",
    meaning:
      "Platform-owned full conversation shell (sidebar, conversation stream, and side page dock) for the platform host itself — not a panel projection member. Inside a panel, place `AgentChat` for an embedded conversation or `ConversationEntry` to open/hand off to the platform shell.",
    effects: "Sends the reader's messages to the agent service as the signed-in user.",
  }),
  defineComponentMeta({
    componentId: "ShellComposer",
    module: "@ontomato/sdk/chat",
    exportName: "ShellComposer",
    role: "control",
    group: "conversation",
    meaning: "The input a reader types a message into, with what the message would carry; it sends nothing itself.",
  }),
  defineComponentMeta({
    componentId: "PageComposer",
    module: "@ontomato/sdk/chat",
    exportName: "PageComposer",
    role: "control",
    group: "conversation",
    meaning: "The composer of a page shown full beside the conversation, with the page the message will carry.",
  }),
  defineComponentMeta({
    componentId: "ShellColumn",
    module: "@ontomato/sdk/chat",
    exportName: "ShellColumn",
    role: "presentation",
    group: "conversation",
    meaning: "The conversation's own column: its agents and sessions, as the host lists them.",
  }),
  defineComponentMeta({
    componentId: "ShellNavBody",
    module: "@ontomato/sdk/chat",
    exportName: "ShellNavBody",
    role: "presentation",
    group: "conversation",
    meaning: "The rows of the conversation column, with their counts and their state.",
  }),
  defineComponentMeta({
    componentId: "ShellDockRoom",
    module: "@ontomato/sdk/chat",
    exportName: "ShellDockRoom",
    role: "presentation",
    group: "conversation",
    meaning: "The room the shell's own controls cover at the foot of a page, so the page's end scrolls clear.",
  }),
  defineComponentMeta({
    componentId: "AgentPicker",
    module: "@ontomato/sdk/chat",
    exportName: "AgentPicker",
    role: "control",
    group: "conversation",
    // The platform's own picker: a panel writes it as a tag when its composer skin differs from the standard one. Not an
    // author-facing component of its own — the generic conversation entry already carries the default picker.
    panelUsable: false,
    meaning:
      "Chooses one of the agents the host serves; it grants nothing: the server decides what the reader may use. The generic conversation entry draws the standard picker itself; a platform page whose composer skin differs writes `<agent-picker variant=\"home\" :agents=\"…\" :agent-id=\"…\" :label=\"…\" @select=\"…\">` through the entry's `#agent-picker` slot.",
  }),
  defineComponentMeta({
    componentId: "AgentAvatar",
    module: "@ontomato/sdk/chat",
    exportName: "AgentAvatar",
    role: "presentation",
    group: "conversation",
    meaning: "An agent's avatar, from its stored image or colour and its initial; a page writes it as a tag wherever it draws its own prefix or header.",
    configProps: ["icon", "size"],
  }),
  defineComponentMeta({
    componentId: "ToolStep",
    module: "@ontomato/sdk/chat",
    exportName: "ToolStep",
    role: "presentation",
    group: "conversation",
    meaning: "One tool call of a run: what was called, what it answered, and whether it failed.",
  }),
  defineComponentMeta({
    componentId: "Projection",
    module: "@ontomato/sdk/panel",
    exportName: "Projection",
    role: "presentation",
    group: "layout",
    meaning:
      "Stands where one projection of a panel is drawn: it reads that projection's current record by ID, draws the component it names, and registers its ports. A panel places and sizes the member container via CSS (including `class` and `style` on `<Projection>`), and the official component fills that box or uses its default height when none is given; it never draws a projection itself. What it draws has one owner per value: the projection's `config` holds its fixed presentation, and a value that follows the page is passed as `:values=\"{ … }\"` where the member is placed (the member's declared inputs carry the same values from the panel's state or outputs). No other attribute on `<Projection>` configures the component; the panel's `@event` listeners still reach it.",
    effects: "Reads the projection's current definition through the platform as the reader, and again when that definition changes.",
  }),
  defineComponentMeta({
    componentId: "ObjectList",
    module: "@ontomato/sdk/base",
    exportName: "ObjectList",
    role: "control",
    group: "list",
    meaning:
      "Lists an owner's records or an ontology type's objects as a compact list, table, card grid, tab strip or collapsible list, with search, paging, selection and row actions; use for catalogue views.\n\n- The owner decides what a list holds and how far the reader may go: search and filters run on the owner's read when it declares them, an unpaged read is searched and filtered in the browser without a request, and a new search or filter returns paging to page one.\n- Row actions carry the availability that came with the list read, so a page makes no request per row; two lists on one panel writing the same object through the same operation queue instead of running twice.\n- A failed reread keeps the rows already shown and offers a retry in place instead of emptying the list.\n- Raw row records never reach slots or events: a slot receives the reference, the index and the column, and a selection is a typed object reference.\n- Three empty states stay apart: no data, a narrowed no-match with a Clear filters action, and an owner refusal. `fallbackToFirst` takes a first row only on showing, after a target switch, or once the chosen row leaves the set; a selection cleared elsewhere is never retaken.",
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
    inputs: {
      expandedKeys: { kind: "list", items: { kind: "scalar", type: "string" } },
    },
    outputs: {
      selected: { kind: "object", objectType: "@binding" },
      checked: { kind: "list", items: { kind: "object", objectType: "@binding" } },
      search: { kind: "scalar", type: "string" },
      expandedKeys: { kind: "list", items: { kind: "scalar", type: "string" } },
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
    configProps: [
      "layout", "columns", "statusField", "statusStyle", "tagsField", "subtitleField", "subtitleLines", "pageSize",
      "fallbackToFirst", "toggleable", "emptyText", "emptyHint", "noMatchText", "searchPlaceholder", "pagination",
      "pageSizes", "showChevron", "showHeader", "showFooter", "creatingRow", "searchable", "searchFields", "groupBy",
      "groupEmptyLabel", "localFilters", "rowActions", "leadingIconField", "openOutput", "dynamicColumns",
      "showColumnToggle", "exportable", "exportFileName", "actionErrorPlacement", "border", "stripe", "showRowIndex",
      "pinPrimaryColumn", "rowActivation", "showPageJumper", "showRangeBar", "inlineRenameOperation",
      "inlineRenameField", "renamingKey", "rowExpandMode", "rowResultDisplay", "showDraftIndicator", "rowToneField",
      "checkDisabledWhen", "metaField",
    ],
  }),
  defineComponentMeta({
    componentId: "GroupedGrid",
    module: "@ontomato/sdk/base",
    exportName: "GroupedGrid",
    role: "control",
    group: "list",
    meaning:
      "Arranges records or fixed items into collapsible, drag-reorderable grid groups with resizable cells and per-item actions; use for a dashboard the reader shapes rather than a list that sorts itself.\n\n- Each cell body is whatever the `#item` slot draws: the grid fetches no content of its own and knows only the placement it was given.\n- A rearrangement is written when the reader finishes it and not before: a drag, a resize or a hide stores `layout` and says so, while a first load or a restore writes nothing.\n- Its two modes read differently: records from its `rows` datum, grouped and ordered as the owner or the parent container returns them, or fixed `items` with no read at all.\n- Where a rearrangement is kept is the panel's decision, not the grid's: the owner hears about it only through the operation the placement names.",
    effects:
      "In record mode, reads its `rows` list and optional container `record` datum as the reader, writes the panel's `selected` state, and runs declared per-item operations through the platform coordinator. In fixed-member mode, reads and writes the panel's typed `layout` state without querying any datum.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false, runtimeParams: ["page", "size"] },
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
    configProps: [
      "columns", "rowHeight", "gap", "groupKeyField", "groupTitleField", "groupsField", "sectionField", "sections",
      "colSpanField", "rowSpanField", "orderField", "minColSpan", "maxColSpan", "minRowSpan", "maxRowSpan",
      "editable", "locked", "lockReason", "collapsible", "groupSurface", "itemSurface", "rowSizing",
      "itemHeaderDivider", "controlsVisibility", "items", "groups", "showGroupHeaders", "showItemHeaders",
      "allowHide", "rowActions", "emptyText", "emptyGroupText", "emptyGroupTitle", "highlightedIds", "saveOperation",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectCount",
    module: "@ontomato/sdk/base",
    exportName: "ObjectCount",
    role: "presentation",
    group: "list",
    meaning:
      "Shows one count from a list, query or objects read as an inline strip or a bare badge; use in headers, toolbars and menu badges.\n\n- The count is the owner's own: a complete unpaged list shows its length, a paged query and an objects read show strictly the total the owner returned, and an unknown total is shown as unknown rather than as `0`.\n- A badge appearance renders no node at all when no finite count is available, so a header never carries a placeholder.\n- Loading, forbidden, awaiting inputs and unreachable each keep their own quiet state instead of a number.",
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
    configProps: ["label", "labelKey", "items", "appearance", "omitWhenUnavailable"],
  }),
  defineComponentMeta({
    componentId: "ObjectSummary",
    module: "@ontomato/sdk/base",
    exportName: "ObjectSummary",
    role: "presentation",
    group: "detail",
    meaning:
      "Displays the few facts a reader recognises one object by — status tags, references, owner-supplied highlight ranges — or preformatted text; use for a read-only detail summary.\n\n- Which facts, and in what order, is the projection's display; what each holds is the object's own owner's. The component computes no value.\n- A copyable field resolves `#/...` hash links against the current browser origin and pathname, so a copied link opens the page it was copied from.\n- Its presentation outside the summary — a bordered description table, a key-value grid, or focusable preformatted text — changes only how the same facts are laid out.",
    effects: "Reads one object of the type the projection binds, as the reader.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: { record: { results: ["panelRecord"], required: true } },
    readOnlyOutputs: {
      label: { kind: "scalar", type: "string" },
      status: { kind: "scalar", type: "string" },
    },
    configProps: [
      "fields", "showTitle", "layout", "statusField", "tagsField", "bodyField", "bodyEmptyText", "emptyText", "missingText",
      "copyableFields", "presentation", "density", "keyValueFields", "bordered", "columns",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectTitle",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTitle",
    role: "presentation",
    group: "detail",
    meaning:
      "Renders an inline object display title (`label`) for drawer headers and compact headings. Resolves from its bound `record` datum, a sibling projection `slot`'s published label output, or a `target` reference (`{ className, primaryKey }`) in the panel's object name registry, with explicit `fallback` / `fallbackKey` support so headers never show raw primary keys.",
    effects: "Reads the bound object's `record` datum when mounted as a projection member; otherwise reads only the panel's reactive label outputs and object name registry.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: { record: { results: ["panelRecord"], required: false } },
    readOnlyOutputs: {
      label: { kind: "scalar", type: "string" },
    },
    configProps: ["slot", "target", "fallback", "fallbackKey", "tag"],
  }),
  defineComponentMeta({
    componentId: "ObjectHeader",
    module: "@ontomato/sdk/base",
    exportName: "ObjectHeader",
    role: "presentation",
    group: "detail",
    meaning:
      "Draws a detail header with a title, one-line subtitle, status badge and bound operations; use at the top of a detail view or inside `<page-header #title>`.\n\n- Its actions are the projection's own declared operations, taken in the owner's order through the platform's shared dispatch, parameter dialog and confirmation path; the rest go to a More menu whose accessible name carries the current record's title.\n- It also stands alone with a title, a subtitle and `#actions`, which is how a create-mode header is written.\n- `fallbackTitle` keeps a quiet single-line placeholder while the record loads or is missing, so the page below does not jump.\n- Named scalar outputs the bound read's owner declares pass through it beside its own, without the page having to read them elsewhere.",
    effects: "Reads the bound object's `record` datum when declared and runs projection operations through the platform coordinator.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: { record: { results: ["panelRecord"], required: false } },
    readOnlyOutputs: {
      label: { kind: "scalar", type: "string" },
      status: { kind: "scalar", type: "string" },
      errorMessage: { kind: "scalar", type: "string" },
    },
    configProps: [
      "title", "subtitle", "subtitleField", "statusField", "status", "statusTone", "statusStyle", "operations",
      "maxVisibleOperations", "fallbackTitle",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectForm",
    module: "@ontomato/sdk/base",
    exportName: "ObjectForm",
    role: "control",
    group: "form",
    meaning:
      "Renders an owner-declared create or edit form with validation, dirty tracking, assistant filling and Save/Discard; use to create or edit one object.\n\n- The owner declares the form and the component asks it again whenever a field the form depends on changes. What it saves is the owner's own form save, and only the fields the reader set.\n- A hidden owner field has no control, a refused field is marked, a failed read offers a retry, and a declared default gets a Reset that restores a copy without saving. A field the owner marks with `submitOn` to save on blur or change saves itself, and the assistant's filling of one goes through the reader's own confirmation.\n- It registers with the panel's form protocol, so drafts, back-navigation and assistant filling act on one form state wherever the page slices its fields.\n- Slot content replaces a field in that field's own place, keeping the owner's order and sections; a reference with no slot is shown as unavailable to edit rather than guessed at.\n- Unsaved work is protected before it can be lost: Discard asks first, a switch away from a dirty form confirms, and the pinned bar stays hidden while the form is clean.",
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
    configProps: [
      "fixedFields", "layout", "labelPosition", "labelWidth", "actions", "presentation", "groups", "cardColumns",
      "activeGroup", "allowStepJump", "unassignedFields", "showToc", "columns", "showChangeSummary",
      "changeSummaryTitle", "persistDraft", "unsavedSwitchMode",
    ],
  }),
  defineComponentMeta({
    componentId: "TestcaseWorkbench",
    module: "@ontomato/sdk/base",
    exportName: "TestcaseWorkbench",
    role: "control",
    group: "form",
    panelUsable: false,
    meaning:
      "Platform-dedicated editor for ops diagnosis test case sets (`platform:AutotestCaseSet`): a resizable case list beside one structured case form and a collapsible JSON pane kept in step with it. It binds the standard projection form protocol and registers with `instance.forms`, so drafts, back-navigation and unsaved-edit handling behave as an official form does.",
    effects: "Reads the test case set form and saves through the projection's declared save operation.",
    bindsElement: ["PlatformObjectType:platform:AutotestCaseSet"],
    data: {
      form: { results: ["panelFormDescription"], required: true, runtimeParams: ["values", "changedField"] },
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
    group: "action",
    meaning:
      "Runs one declared platform operation or customer business Action on an object, on a checked list, or with no target; use for writes and batch actions.\n\n- It shows and runs the operation as its owner admits it now, never a copy of what the page knew when the panel was written.\n- When the owner declares editable inputs, a click collects and validates them in a parameter dialog first; an operation without editable parameters runs straight away.\n- The outcome is reported where the reader is looking: one message for a single write, item by item beside a batch, and a refusal or failure beside the button. A read that answers with a top-level message is said in the owner's words too.\n- What a write removed is let go of by the panel: a selection holding it is cleared and a checked list drops it.",
    effects: "Runs the named operation as the reader, as its owner admits it now.",
    bindsElement: ["PlatformOperation:*", "Action:*"],
    // The button reads no datum: its operation is the projection's, described by its owner as admitted now.
    data: {},
    configProps: [
      "operation", "type", "plain", "text", "showBatchCount", "icon", "parameters", "label", "labelKey", "size",
      "disabled", "hideWhenUnavailable", "showResult", "notifySuccess",
    ],
  }),
  defineComponentMeta({
    componentId: "OperationResult",
    module: "@ontomato/sdk/base",
    exportName: "OperationResult",
    role: "presentation",
    group: "action",
    meaning:
      "Draws what a read-only panel operation returned, as a conclusion banner over sections, Markdown, JSON or a file; use to show a run, test or preflight outcome.\n\n- The banner states the outcome the operation reached — a test passed, a preflight found warnings — in the platform's field tones; an operation that was refused, threw or timed out is an operation error, not a banner.\n- Bound to an operation descriptor it draws the owner's declared sections before the operation has run, so a page shows its shape early and an empty tab says so until execution fills it.\n- Pure presentation: it reads and writes nothing itself.",
    configProps: ["result", "operationSlot", "operationName", "emptyText", "layout"],
  }),
  defineComponentMeta({
    componentId: "FileUploadControl",
    module: "@ontomato/sdk/base",
    exportName: "FileUploadControl",
    role: "control",
    group: "action",
    meaning:
      "Validates, uploads and runs a declared file-upload operation on the file the reader picks; use for file imports.\n\n- The operation is the projection's and its owner must declare an upload: the control checks the picked file's kind and size against that declaration, uploads it, and runs the operation once with it.\n- An owner refusal is the panel's to follow up: the control hands back the host's response and the staged file's receipt and stops there.\n- It reads no datum: the operation's owner describes it as admitted now.",
    effects: "Uploads the picked file for the named operation and runs it as the reader, as its owner admits it now.",
    bindsElement: ["PlatformOperation:*"],
    // The control reads no datum: its operation is the projection's, described by its owner as admitted now.
    data: {},
    configProps: ["operation", "params", "label", "type", "dialogTitle", "intro", "rules", "chooseLabel", "disabled"],
  }),
  defineComponentMeta({
    componentId: "ReferencePicker",
    module: "@ontomato/sdk/base",
    exportName: "ReferencePicker",
    role: "control",
    group: "form",
    meaning:
      "Chooses one object reference from the bound type's records or option catalogue, in either of two modes; use in toolbars, or inside an `ObjectForm` field slot.\n\n- Inside a form field slot it is not a control of its own: it connects to the enclosing field and writes the owner's own value into the form, so the choice is saved, validated and discarded with the form.\n- Outside one it is a compact filterable dropdown at the `<Projection>` site, writing its choice through the panel's `selected` state; the workbench path start and target pickers are this mode.\n- A complete list is filtered in memory with no request; a paged query passes the reader's search to the owner's read.\n- Choices already loaded keep their labels while a reload runs or fails, with a retry in place (`MemberDataState` keeps them, and `refreshable` adds a refresh button); a value the owner no longer offers stays listed with the owner's reason, and forbidden or unreachable choices disable the dropdown rather than emptying it.",
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
    configProps: [
      "placeholder", "placeholderKey", "clearable", "disabled", "size", "groupBy", "metaField", "showDraftIndicator",
      "fallbackToFirst", "refreshable",
    ],
  }),
  defineComponentMeta({
    componentId: "RecordGraph",
    module: "@ontomato/sdk/base",
    exportName: "RecordGraph",
    role: "control",
    group: "graph",
    meaning:
      "Draws two record reads as an interactive graph whose edges join at the fields the placement names; use for a graph of your own records, where `InstanceGraph` explores the ontology itself.\n\n- Inside an `ObjectForm` field slot it is that field's chooser: a choice adds or removes a node in the form's own value, the neighbours one edge away from a chosen node are marked, and one action adds them all.\n- Outside one it is a canvas the page drives: the chosen node and edge are the panel's state, a reader's places are kept per person, and a node never placed is placed by its relations with nothing written for it.\n- What the owner marks shows on the drawing: a node takes its category's colour when `nodeCategory` and `categories` are configured, `showCategoryLegend` adds a legend whose click folds a category and its edges away, and an edge is drawn dashed when the record's `edgeDashedField` holds `true`, so a derived relation reads differently from a stored one.\n- The canvas fills the height of the box its member is placed in and falls back to its own default minimum height (420px) when that box has no definite height, and its zoom is a port the page reads and sets.\n- A partial refusal is not the whole failure: readable nodes still draw under a notice that relations cannot be shown, while forbidden nodes show the access refusal.\n- Highlighting is not choosing: what the page marks \u2014 search matches, or a directed path between two bound nodes with its trail and hop count \u2014 stands out and the rest fades. It decides nothing about what a node stands for or who may read it.",

    effects: "Reads the node and edge types' lists as the reader; it writes the enclosing form field when placed inside an `ObjectForm` field slot, or the panel state its outputs bind, never the owner.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: {
      nodes: { results: ["panelRecordList", "panelRecordQuery"], required: true, runtimeParams: ["page", "size"] },
      edges: { results: ["panelRecordList", "panelRecordQuery"], required: true, runtimeParams: ["page", "size"] },
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
    configProps: [
      "edgeEnds", "editable", "categories", "nodeCategory", "categoryLabels", "edgeDashedField", "showCategoryLegend",
      "layout", "hint",
    ],
  }),
  defineComponentMeta({
    componentId: "MetricChart",
    module: "@ontomato/sdk/base",
    exportName: "MetricChart",
    role: "presentation",
    group: "chart",
    meaning:
      "Draws one dashboard chart from a source card's chart file filled with a MetricView's output; use for a chart the card already defines, where `EChart` is an option you write yourself.\n\n- The card's saved parameters are what it draws with, and a value the panel binds over one of them wins.\n- It fills the box its member is placed in, falling back to its own 320px default height where that box has none.\n- The projection keeps no drawing, query or data of its own: the platform reads the template and the output, both as the reader.",
    effects: "Sends no request of its own: the platform reads the source card's template and the MetricView's output, both as the reader.",
    bindsElement: ["MetricView:*"],
    // The chart file and the output it is filled with: drawn once both are read.
    data: {
      template: { results: ["chartTemplate"], required: true },
      result: { results: ["metricOutput"], required: true },
    },
    configProps: [
      "title", "fileOverride", "metricOverride", "viewMode", "allowViewToggle", "allowZoom", "zoomed",
      "tableMaxRows", "truncationDisplay", "minHeight",
    ],
  }),
  defineComponentMeta({
    componentId: "GraphCanvas",
    module: "@ontomato/sdk/base",
    exportName: "GraphCanvas",
    role: "control",
    group: "graph",
    meaning:
      "Draws caller-supplied nodes and edges as a lightweight SVG graph; use `<graph-canvas>` for simple static graphs. It reads nothing and decides nothing about what the nodes stand for: each is drawn in the tone its caller gives it, and a reader's choice comes back as a selection and as the part of the graph in view.",
    configProps: ["label", "nodes", "edges", "selected", "selection", "layout", "maxHeight"],
  }),
  defineComponentMeta({
    componentId: "InteractiveGraphCanvas",
    module: "@ontomato/sdk/graph",
    exportName: "InteractiveGraphCanvas",
    role: "control",
    group: "graph",
    meaning:
      "Draws caller-supplied nodes and edges on a canvas a reader pans, zooms and drags, and exports as a PNG; use `<interactive-graph-canvas>` for a graph outside a projection.\n\n- What the nodes are, what a choice means, and where positions and images are kept are its caller's: it reads and stores nothing.\n- Each node takes its category's colour from the edition's palette, and an edge carries the label, the dashes and the weight it is given.\n- Nothing a reader does is kept here: the selection, the part in view, a double-click, a dragged node's new place and a click on empty canvas all come back to the caller to act on.",
    configProps: [
      "label", "nodes", "edges", "selected", "selectedEdges", "selection", "layout", "maxHeight", "categories",
      "labelWidth", "nodeSize", "labelSize", "readableLabels", "editable",
    ],
  }),
  defineComponentMeta({
    componentId: "InstanceGraph",
    module: "@ontomato/sdk/graph",
    exportName: "InstanceGraph",
    role: "control",
    group: "graph",
    meaning:
      "Draws the bound graph source as an interactive ontology graph in three modes — declared types by layer, a sampled overview, and paginated one-hop expansion; use for an instance explorer.\n\n- The modes are one component and what a placement binds decides which it shows: type mode draws declared types and relation kinds with per-type counts and access, overview mode draws a sampled dot-grid panorama that polls while the sample generates and recovers from a version conflict, and instance mode expands a node at a time from an anchored action bar.\n- Every edge of the drawing is a read the owner admits now: no neighbours, an owner refusal and a failed read are told apart rather than all drawn as an empty graph.\n- What the reader arranged and chose — layers, relation kinds, expanded nodes, group, neighbour filter and per-person positions — is the panel's state, read and written both ways so a page's own filter and the graph follow one choice.\n- Complete object identities are preserved and query matches are highlighted, so a drawn node is the same reference the rest of the page uses.",
    effects: "Reads the bound graph source's schema, counts, starting node, sampled overview, deferred connections, and paginated one-hop neighbors as the reader; writes only the panel's own selection, group filter, layer filter, relation-kind filter, neighbor filter, expanded-nodes, and personal positions state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "Relationship:*"],
    // Expanding from a node is what the graph does; optional overview, deferred connections, and schema/counts/start reads activate when a placement supplies them.
    data: {
      schema: { results: ["panelGraphSchema"], required: false },
      counts: { results: ["panelGraphCounts"], required: false },
      start: { results: ["panelGraphStart"], required: false },
      overview: { results: ["panelGraphOverview"], required: false },
      connections: { results: ["panelGraphConnections"], required: false, runtimeParams: ["version", "sampleToken"] },
      // The node the reader expands, plus optional layers, relation kinds, target group, direction, and paging parameters.
      neighbors: {
        results: ["panelGraphNeighbors", "panelRelationNeighbors"],
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
      selectedGroup: { kind: "scalar", type: "string" },
      query: { kind: "scalar", type: "string" },
      visibleLayers: { kind: "list", items: { kind: "scalar", type: "string" } },
      expandedNodes: { kind: "list", items: { kind: "object", objectType: "@any" } },
      neighborFilter: { kind: "json" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "@any" },
      selected: { kind: "object", objectType: "@any" },
      selectedType: { kind: "scalar", type: "string" },
      selectedGroup: { kind: "scalar", type: "string" },
      // The relation kinds drawn, read as well as written: a page's own kind filter and the graph follow one choice.
      visibleRelationKinds: { kind: "list", items: { kind: "object", objectType: "platform:OntologyRelationKind" } },
      visibleLayers: { kind: "list", items: { kind: "scalar", type: "string" } },
      expandedNodes: { kind: "list", items: { kind: "object", objectType: "@any" } },
      neighborFilter: { kind: "json" },
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
      drawnNodeCount: { kind: "scalar", type: "number" },
      drawnEdgeCount: { kind: "scalar", type: "number" },
      overviewEdgesTruncated: { kind: "scalar", type: "boolean" },
      complete: { kind: "scalar", type: "boolean" },
      failures: { kind: "list", items: { kind: "scalar", type: "string" } },
      groups: { kind: "json" },
      relationKinds: { kind: "json" },
      hasMoreNeighbors: { kind: "scalar", type: "boolean" },
      neighborProgress: { kind: "json" },
      drawingProgress: { kind: "json" },
      versionChanged: { kind: "scalar", type: "boolean" },
    },
    configProps: [
      "label", "fitMode", "expandOn", "showLegend", "showToolbar", "aggregateEdges", "showEdgeLabels",
      "showNeighborControls", "neighborPageSize", "maxHeight",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectRelations",
    module: "@ontomato/sdk/base",
    exportName: "ObjectRelations",
    role: "control",
    group: "graph",
    meaning:
      "Lists the one-hop relations of one selected object, grouped by relation kind with direction and line semantics; use beside a detail view or an `InstanceGraph`.\n\n- It reads the same neighbours port a graph does and writes only the reader's choice of peer, of graph start and of visible kinds.\n- No neighbours, an owner refusal, a failed read and an unavailable source are four different states, not one empty list.\n- A peer can become the graph's start when the placement allows it, which is how a relation list walks a chain of objects.\n- A truncated result reports no count at all rather than the count of what fitted, so a page never reads a partial number as the whole.",
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
    configProps: ["input", "emptyText", "showRelationFilter", "allowSetStart", "showSummary", "collapseEmptyGroups"],
  }),
  defineComponentMeta({
    componentId: "SegmentedControl",
    module: "@ontomato/sdk/base",
    exportName: "SegmentedControl",
    role: "control",
    group: "form",
    meaning:
      "Switches one declared scalar panel state between mutually exclusive options — the owner's own counts, or a fixed set; use for a compact filter or view switch. A set larger than the visible limit collapses the rest into a More dropdown whose trigger shows the selected one, and it binds no ontology element.",
    data: { counts: { results: ["panelGroupCounts"], required: false } },
    outputs: { value: { kind: "scalar", type: "string" } },
    configProps: ["options", "state", "modelValue", "defaultValue", "ariaLabel", "ariaLabelKey", "maxVisible", "disabled"],
  }),
  defineComponentMeta({
    componentId: "TwoPaneLayout",
    module: "@ontomato/sdk/base",
    exportName: "TwoPaneLayout",
    role: "presentation",
    group: "layout",
    meaning:
      "Lays a list beside its detail in one bordered block, side by side or as full-width alternating views; use for split list-detail panels.\n\n- The switch follows the container's width, not the viewport's: at or below the narrow breakpoint it becomes alternating views on its own.\n- The list pane stays mounted across the switch, so its scroll position and filters survive a reader going back; the detail pane returns to the top when the selection key changes.\n- It binds nothing: no read, no panel state, no owner.",
    configProps: ["mode", "selected", "creating", "selectionKey", "backLabel", "emptyLabel"],
  }),
  defineComponentMeta({
    componentId: "WorkbenchLayout",
    module: "@ontomato/sdk/base",
    exportName: "WorkbenchLayout",
    role: "presentation",
    group: "layout",
    meaning:
      "Lays out three panes — a collapsible sidebar, a full-height canvas and a selection-driven detail pane — for graph and canvas pages.\n\n- In a narrow container the canvas keeps the whole width and the two side panes become floating overlays, at most one open at a time.\n- The detail pane follows a selection key: a new selection brings it back to the top of its own scroll.\n- It binds nothing: what each pane holds and when it opens are the panel's.",
    configProps: ["detailOpen", "asideOpen", "selectionKey", "asideLabel", "detailLabel"],
  }),
  defineComponentMeta({
    componentId: "SectionGroup",
    module: "@ontomato/sdk/base",
    exportName: "SectionGroup",
    role: "presentation",
    group: "layout",
    meaning:
      "One titled group of a page's content, with one line of what it is for and the platform's spacing and hairline between groups that follow one another. It binds nothing.",
    configProps: ["title", "description"],
  }),
  defineComponentMeta({
    componentId: "PageHeader",
    module: "@ontomato/sdk/base",
    exportName: "PageHeader",
    role: "presentation",
    group: "layout",
    meaning:
      "Draws a page header \u2014 a back link, an optional leading visual, a title, a description and right-side actions, with the page's own draft controls; use at the top of a panel's content.\n\n- The title is plain text, a locale map or a projection-bound component, so a header can name the record the page follows without the page assembling it.\n- It asks nothing of the platform host and lays itself out by its own width, so a panel places it and a narrow column still reads.\n- Save and Discard appear only when the page hands it a draft; a header without one is a title bar.\n- When another panel embeds it, only the actions and the draft controls are drawn, in one compact row, and a header with neither draws nothing.",
    configProps: ["title", "description", "backLabel", "density", "draft", "labels"],
  }),
  defineComponentMeta({
    componentId: "AppMenu",
    module: "@ontomato/sdk/base",
    exportName: "AppMenu",
    role: "control",
    group: "layout",
    meaning:
      "Draws an application's navigation menu from the entries its frame admits, marking the one the reader is on; use inside an application frame panel.\n\n- It reads the admitted entries and the current entry from the panel host, and navigates through the host too, unless the placement takes the selection over itself.\n- On a narrow screen the same menu becomes a compact selector, where a per-row suffix is plain text and nothing else.\n- What a row shows beside its label is the page's to place, not the menu's: trailing projections keep their own members.",
    effects: "Navigates within the platform through the panel host when the reader selects a menu entry; reads no business data itself.",
    configProps: ["title", "groups", "itemTrailingText", "icons", "foot", "activeId", "ariaLabel", "autoNavigate"],
  }),
  defineComponentMeta({
    componentId: "TypedValue",
    module: "@ontomato/sdk/base",
    exportName: "TypedValue",
    role: "presentation",
    group: "detail",
    meaning:
      "Draws one typed field value — text, number, date, tag, reference, name, list or JSON — as its owner declared the type; use inside detail views and slots.\n\n- The type is the owner's, not the placement's: the drawing follows the declared type, and the component computes no value of it.\n- A tone travels on the value or with the record; mapping a raw value to a label and an icon is exact match only — a range, a threshold or an expression belongs in the owner's MetricView or read.\n- Standalone it draws a value the page already has; bound it reads the projection's record, or a metric result's first row or named column.",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
    configProps: [
      "value", "field", "rowIndex", "kind", "tone", "valueMap", "unit", "numberFormat", "separator", "listStyle",
      "emptyText", "emptyKey", "truncate",
    ],
  }),
  defineComponentMeta({
    componentId: "RecordTemplate",
    module: "@ontomato/sdk/base",
    exportName: "RecordTemplate",
    role: "presentation",
    group: "detail",
    meaning:
      "Fills a fixed `{fieldKey}` sentence with values from one record or one metric row; use for summary text a page must not compute itself.\n\n- Each placeholder is drawn by `TypedValue`, so a reference stays clickable, a name is localized and a number is tabular; the sentence is all the placement writes.\n- No expressions, no calculation and no conditional branching: a derived value or a business condition belongs in the owner's MetricView, action or read.\n- A per-field format applies to that field alone; a field left unformatted keeps its own type's drawing.\n- One read per display: a template told its `record` or `values` by a parent draws that snapshot alone and its placeholders do not read the member again; only a template with nothing passed reads its own `record` or `result` datum. Never add the second read back, since two reads of one datum can disagree.",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
    configProps: [
      "template", "templateKey", "values", "rowIndex", "fieldFormats", "emptyPlaceholder", "emptyText", "emptyKey",
      "inline",
    ],
  }),
  defineComponentMeta({
    componentId: "InfoBanner",
    module: "@ontomato/sdk/base",
    exportName: "InfoBanner",
    role: "presentation",
    group: "detail",
    meaning:
      "Draws one callout — information, reminder, warning, success or danger — from the page's own copy, a record, or a metric result; use for a notice in a detail card or a block of guidance.\n\n- Its tone is the placement's, a field of the record, or an exact-match mapping of the value: nothing is inferred from the wording.\n- The words are static or localized, or already-provided values filled into a fixed `{fieldKey}` sentence — no calculation, thresholds or branching.\n- When the banner relies on a record field (`field` for the body, or `toneField` when there is no body field), an empty field hides the entire banner, including any static title. Banners containing only static content still render.\n- For other banners, `hideWhenEmpty` can hide an empty frame.",
    effects: "Reads the bound object's `record` or MetricView `result` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      record: { results: ["panelRecord"], required: false },
      result: { results: ["metricOutput"], required: false },
    },
    configProps: [
      "tone", "toneField", "valueMap", "icon", "title", "titleKey", "text", "textKey", "field", "template",
      "templateKey", "fieldFormats", "rowIndex", "compact", "hideIcon", "hideWhenEmpty",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectRefCard",
    module: "@ontomato/sdk/base",
    exportName: "ObjectRefCard",
    role: "presentation",
    group: "detail",
    meaning:
      "Draws one object reference as a bordered card or as a compact button and navigates when the reader picks it; use to point at another object from a detail view.\n\n- A click is the panel's to act on: the card says which object was picked and writes the navigation output its placement declares, and writes nothing to an owner.\n- The same reference can be a card or a button and nothing about the object changes between them; only how much of it is shown does.",
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
    configProps: [
      "reference", "field", "caption", "captionKey", "title", "titleField", "subtitle", "subtitleField", "icon",
      "iconField", "badge", "badgeField", "badgeTone", "classNameField", "targetClassName", "rowIndex", "appearance",
      "buttonType", "buttonSize", "buttonLabel", "buttonLabelKey", "clickable", "compact", "emptyText", "emptyKey",
    ],
  }),
  defineComponentMeta({
    componentId: "MetricCard",
    module: "@ontomato/sdk/base",
    exportName: "MetricCard",
    role: "presentation",
    group: "chart",
    meaning:
      "Draws one or more statistical metrics — a label, a tabular number, an optional unit, a description and a tone — as cards, compact rows or inline numbers; use for KPI summaries.\n\n- A count taken from a list, a query or an objects read is the owner's own number: a complete list counts its rows, a paged query takes strictly the total the owner returned, and nothing is summed here.\n- Pure presentation: it never aggregates on the client, so a number its owner did not compute does not appear.\n- A bare surface lets it sit inside an outer dashboard card without nesting one card in another.",
    effects: "Reads the bound MetricView `result`, `record`, `rows`, or `objects` datum as the reader when declared; writes nothing.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*", "MetricView:*"],
    data: {
      result: { results: ["metricOutput"], required: false },
      record: { results: ["panelRecord"], required: false },
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false },
      objects: { results: ["panelOntologyObjects"], required: false },
    },
    configProps: [
      "label", "labelKey", "value", "field", "rowIndex", "unit", "unitKey", "description", "descriptionKey", "tone",
      "numberFormat", "formats", "items", "variant", "surface", "showLabel", "truncationDisplay", "columns",
      "emptyText",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectFormFields",
    module: "@ontomato/sdk/base",
    exportName: "ObjectFormFields",
    role: "presentation",
    group: "form",
    meaning:
      "Renders a chosen slice of an enclosing `ObjectForm`'s fields inside a layout the panel authors, field slots included; absolute field paths and `parent` reach into an active object's sub-fields. Every slice shares one form state, validation, dirty tracking and assistant filling, and it reads nothing itself.",
    configProps: ["fields", "parent", "section", "group", "rest", "exclude", "inlineAdvanced", "columns"],
  }),
  defineComponentMeta({
    componentId: "PathTree",
    module: "@ontomato/sdk/base",
    exportName: "PathTree",
    role: "control",
    group: "content",
    meaning:
      "Arranges a flat list of slash-separated paths into a folder-first, name-sorted, expanded tree; use `<path-tree>` for a list the page already holds, where `ObjectTree` reads a projection's own. Clicking a folder only folds it while clicking a file emits its key and marks the active row; it reads nothing and carries no business rules.",
    configProps: [
      "items", "mode", "selectedKey", "label", "defaultExpandAll", "emptyText", "searchable", "search",
      "searchPlaceholder", "noMatchText", "directoryIndexFile", "selectableFolders",
    ],
  }),
  defineComponentMeta({
    componentId: "SegmentedTextReader",
    module: "@ontomato/sdk/base",
    exportName: "SegmentedTextReader",
    role: "control",
    group: "content",
    meaning:
      "Displays offset-paged plain-text segments with a More button; use `<segmented-text-reader>` standalone (`ObjectTextReader` for projections). Displays offset-paged plain-text segments for a selected source with a close control and a More button when another offset exists, coordinating shared activeAnchor state so multiple placements on one page expand only one reader at a time.",
    configProps: [
      "sources", "anchor", "activeAnchor", "activeSourceId", "page", "loading", "error", "moreLabel", "closeLabel",
      "emptyText", "loadingText",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectTree",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTree",
    role: "control",
    group: "content",
    meaning:
      "Shows a searchable tree of slash-separated paths or parent-linked records and writes the reader's choice to panel state; use for a file or hierarchy navigator on a projection.\n\n- The two shapes read differently: paths are folders and files, where a folder only folds unless the placement lets it be chosen; records are linked by their parent field, keeping the order the owner returned.\n- Whatever is selectable, the chevron stays the chevron: folding a node is independent of choosing it.\n- An explicit choice is never overwritten: falling back to a default or first node applies only while nothing is selected.",
    effects: "Reads the owner's records or files as the reader; it writes only the panel's own state.",
    bindsElement: ["PlatformObjectType:*", "ObjectType:*"],
    data: {
      files: { results: ["panelRecordList", "panelRecordQuery"], required: false, runtimeParams: ["page", "size"] },
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false, runtimeParams: ["page", "size"] },
    },
    outputs: {
      selected: { kind: "scalar", type: "string" },
      search: { kind: "scalar", type: "string" },
    },
    configProps: [
      "pathField", "parentField", "selectableFolders", "defaultKey", "fallbackToFirst", "emptyText", "label",
      "searchable", "searchPlaceholder", "noMatchText", "directoryIndexFile",
    ],
  }),
  defineComponentMeta({
    componentId: "ObjectTextReader",
    module: "@ontomato/sdk/base",
    exportName: "ObjectTextReader",
    role: "presentation",
    group: "content",
    meaning:
      "Shows one object's text — Markdown, code, a CSV or TSV table, a diff, or paged segments of a longer file — as its owner's reads return it; use for a file or text viewer on a projection.\n\n- One source at a time and one page at a time: a list of sources is drawn as chips, and each More reads the next page of the chosen one.\n- What the text is drawn as follows its own name unless the placement says otherwise; without a recognisable extension it is drawn as preformatted text rather than guessed at.\n- Its active source, anchor and path are read as well as written, so two readers on one page keep one open and a relative Markdown link opens in place.\n- Which sources exist is the owner's read's decision: an issue's cited sources lists only those.",
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
    configProps: ["textField", "format", "pathField", "anchor", "moreLabel", "closeLabel", "emptyText"],
  }),
  defineComponentMeta({
    componentId: "AnnotatedCode",
    module: "@ontomato/sdk/base",
    exportName: "AnnotatedCode",
    role: "presentation",
    group: "content",
    meaning:
      "Draws line-numbered source code beside the annotation segments that explain it, with the two panes kept in step; use to show why an action or query reads as it does.\n\n- Highlighting is token-based and only where the language is known; nothing is executed and nothing is inferred from the code's meaning.\n- A segment and a line select each other: a choice in one pane scrolls and marks the other, and clearing the choice clears both.\n- Code that no longer matches what is annotated is said so in place rather than silently reconciled.\n- A reference inside an annotation is handed to the page as a selection; it is not navigated from here.",
    effects: "Reads the bound object's annotatedCode datum as the reader; writes only the panel's own segment selection state and read-only outputs.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      content: { results: ["annotatedCode"], required: true },
    },
    inputs: {
      currentCode: { kind: "scalar", type: "string" },
      activeSegmentId: { kind: "scalar", type: "string" },
      language: { kind: "scalar", type: "string" },
    },
    outputs: {
      activeSegmentId: { kind: "scalar", type: "string" },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      activeSegmentId: { kind: "scalar", type: "string" },
      selectedRef: { kind: "scalar", type: "string" },
    },
    configProps: ["emptyText", "refActionLabel", "language"],
  }),
  defineComponentMeta({
    componentId: "ConversationEntry",
    module: "@ontomato/sdk/base",
    exportName: "ConversationEntry",
    role: "control",
    group: "conversation",
    meaning:
      "Places a way into a conversation with a platform agent — a button, or an embedded prompt box — from a panel member; use to start or hand off an agent chat.\n\n- As a button it asks the platform host to open the page's composer with what the member declares, so the conversation itself stays the shell's; embedded, it draws the platform's inline composer and serves the page's other triggers while mounted.\n- Nothing is sent that the reader did not mean: an empty prefill is not submitted, and a fresh conversation is a choice the member declares rather than a default.\n- The composer's agent choice is the platform's standard picker; a page whose composer skin differs supplies its own through a slot.",
    effects: "Applies the declared conversation behavior on click. In inline mode, sends the reader's typed prompt to the platform agent counter.",
    bindsElement: ["PlatformObjectType:platform:AgentDefinition"],
    // A button the host acts on: it reads nothing from the platform, and says so, so a placement may carry it as a member.
    data: {},
    configProps: [
      "presentation", "labelKey", "placeholderKey", "minLines", "attachPage", "type", "icon", "disabled", "prefill",
    ],
  }),
  defineComponentMeta({
    componentId: "ScheduledTaskSummaryList",
    module: "@ontomato/sdk/base",
    exportName: "ScheduledTaskSummaryList",
    role: "control",
    group: "list",
    panelUsable: false,
    meaning:
      "Platform-dedicated list of scheduled tasks, as workspace attention counters with a Resolve action or as full task cards carrying an application's schedule and latest run.",
    effects: "Reads its bound `rows` datum as the reader and writes `selected` / `resolveTarget` when the reader opens or resolves a task. Cards dispatch the declared row operation `setEnabled` with enabled and the observed revision, and dispatch other named row operations through the panel instance.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      rows: { results: ["panelRecordList", "panelRecordQuery"], required: false },
    },
    inputs: {
      selected: { kind: "object", objectType: "@data:rows" },
    },
    outputs: {
      selected: { kind: "object", objectType: "@data:rows" },
      resolveTarget: { kind: "object", objectType: "@data:rows" },
    },
    readOnlyOutputs: {
      issueCount: { kind: "scalar", type: "number" },
      resultCount: { kind: "scalar", type: "number" },
      runningCount: { kind: "scalar", type: "number" },
    },
  }),
  defineComponentMeta({
    componentId: "EffectivePermissionsView",
    module: "@ontomato/sdk/base",
    exportName: "EffectivePermissionsView",
    role: "presentation",
    group: "detail",
    panelUsable: false,
    meaning:
      "Governance-domain effective permissions view shared by Organization Management and Member Detail. Renders a bordered description table (direct roles, organization role grants, indented shared-data sources with row-rule popovers, app-grouped menus, collapsible searchable API list) and three-tab data permission tables.",
    effects: "Reads bound permission summary and list data as the reader; writes nothing.",
    bindsElement: ["PlatformObjectType:platform:User"],
    data: {
      record: { results: ["panelRecord"], required: true },
      orgShares: { results: ["panelRecordList"], required: false },
      apiPermissions: { results: ["panelRecordList"], required: false },
      subjectData: { results: ["panelRecordList"], required: false },
      managedData: { results: ["panelRecordList"], required: false },
      effectiveData: { results: ["panelRecordList"], required: false },
    },
  }),
  defineComponentMeta({
    componentId: "ProductAssetGraph",
    module: "@ontomato/sdk/base",
    exportName: "ProductAssetGraph",
    role: "control",
    group: "graph",
    panelUsable: false,
    meaning:
      "Platform-dedicated layered graph of a product asset's references, drawn as category columns of cards joined by arrows; several product pages share it.\n\n- Hovering, focusing or selecting an asset highlights the edges and relation labels that touch it and dims the rest, so one reference is read without leaving the page.\n- Activating an asset is the panel's to act on: the graph says which real asset was opened and writes only the navigation output its placement declares.",
    effects: "Reads its bound `graph` datum as the reader when declared and writes the optional `navigate` output state on asset activation; writes nothing to any owner.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      graph: { results: ["panelRecord"], required: false },
    },
    outputs: {
      navigate: {
        kind: "object-union",
        layers: ["product"],
        objectTypes: ["platform:AgentDefinition"],
      },
    },
    readOnlyOutputs: {
      status: { kind: "scalar", type: "string" },
      nodeCount: { kind: "scalar", type: "number" },
      edgeCount: { kind: "scalar", type: "number" },
    },
  }),
  defineComponentMeta({
    componentId: "OntologyTypeGraph",
    module: "@ontomato/sdk/base",
    exportName: "OntologyTypeGraph",
    role: "control",
    group: "graph",
    panelUsable: false,
    meaning:
      "Platform-dedicated ontology type graph canvas built on the shared `ObjectGraphCanvas` engine, carrying the ontology graph's fixed visual language.\n\n- Its drawing is fixed rather than configurable: node and edge strokes, selection and path emphasis, non-match dimming and a radial force layout are the ontology page's own.\n- A platform page places it; it writes only the panel state its outputs bind and never an owner, and its exported image keeps a solid background and carries the date.",
    effects: "Reads its bound `nodes` and `edges` lists as the reader and writes the panel state its outputs bind; never writes to any owner.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      nodes: { results: ["panelRecordList"], required: true },
      edges: { results: ["panelRecordList"], required: true },
    },
    inputs: {
      highlightedNodes: { kind: "list", items: { kind: "object", objectType: "@data:nodes" } },
      highlightedEdges: { kind: "list", items: { kind: "object", objectType: "@data:edges" } },
      pathFrom: { kind: "object", objectType: "@data:nodes" },
      pathTo: { kind: "object", objectType: "@data:nodes" },
      zoom: { kind: "scalar", type: "number" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "@data:nodes" },
      selectedEdge: { kind: "object", objectType: "@data:edges" },
      positions: { kind: "json" },
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
    componentId: "ModelingGraphEditor",
    module: "@ontomato/sdk/base",
    exportName: "ModelingGraphEditor",
    role: "control",
    group: "graph",
    panelUsable: false,
    meaning:
      "Platform-dedicated visual modeling graph canvas built on the shared `ObjectGraphCanvas` engine, carrying the gestures a model is edited with.\n\n- Its connection ports are the editor's own: four directions per node, a live drag preview and a pending edge that shows a connection the reader has not committed — never written to an owner.\n- Selection keeps its own halo, edge labels are capsules, and the view toolbar carries zoom, fit and relayout beside whatever the page adds.\n- A double-click activates a node or edge rather than only selecting it.",
    effects: "Reads its bound `nodes` and `edges` lists as the reader and writes selection, position, and pending connection endpoint state (`connectFrom`, `connectTo`); temporary visual edges are never written to any owner.",
    bindsElement: ["PlatformObjectType:*"],
    data: {
      nodes: { results: ["panelRecordList"], required: true },
      edges: { results: ["panelRecordList"], required: true },
    },
    inputs: {
      highlightedNodes: { kind: "list", items: { kind: "object", objectType: "@data:nodes" } },
      highlightedEdges: { kind: "list", items: { kind: "object", objectType: "@data:edges" } },
      pathFrom: { kind: "object", objectType: "@data:nodes" },
      pathTo: { kind: "object", objectType: "@data:nodes" },
      zoom: { kind: "scalar", type: "number" },
    },
    outputs: {
      selectedNode: { kind: "object", objectType: "@data:nodes" },
      selectedEdge: { kind: "object", objectType: "@data:edges" },
      connectFrom: { kind: "scalar", type: "string" },
      connectTo: { kind: "scalar", type: "string" },
      positions: { kind: "json" },
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
    componentId: "CurrentEntry",
    module: "@ontomato/sdk/base",
    exportName: "CurrentEntry",
    role: "presentation",
    group: "layout",
    meaning:
      "Renders the application entry the reader opened, in the member of a frame panel that belongs to it; use only in a custom frame panel.\n\n- The frame chooses where the entry goes, not which panel it is or what inputs it gets: what is drawn is the content the platform already admitted and runs, never started again here.\n- Write `<current-entry member=\"content\">` for the member whose target resolves the current entry.\n- The frame's own code reads the entry and the menu the same resolution gave through `usePanelContext()`, to draw its menu and mark the entry; opening another entry goes through `navigate`.\n- Outside an application's frame the place says it shows nothing, and a member that is not the current entry is refused in its place.",
    effects: "Reads nothing and writes nothing: the platform places the admitted content.",
    configProps: ["member"],
  }),
  defineComponentMeta({
    componentId: "PanelData",
    module: "@ontomato/sdk/base",
    exportName: "PanelData",
    role: "presentation",
    group: "action",
    meaning:
      "Draws nothing: it is a projection member that exists only so a panel can declare the operations it runs from code; never use it to read or render business fields.\n\n- Its operations are reached through `usePanelOperation`, which registers a mounted page action by default; a background flow passes `{ entry: false }` and gets no entry.\n- It reads whatever datum the placement names, under the author's own name and with any read result, and the read's own signature still bounds what may be given to it.\n- For business fields, use an official component, configure it, or write one for that slot.",
    // Any datum the projection names, under the author's own name, with any read result and the run-time values the
    // other components give; the read's own signature still bounds them. The catalogue test keeps these lists whole.
    data: {
      "*": {
        results: [
          "panelRecordList", "panelRecord", "panelRecordQuery", "panelGroupCounts", "panelApplicationMenu",
          "productProjectionList", "productPanelList", "productProjectionRecord", "productPanelRecord", "productProjectionUsedBy",
          "productPanelUsedBy", "productPanelMembers", "productObjectAccess", "agentObjectAccess", "applicationEntries",
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
          "agentId", "agentKind", "agentTarget", "business", "by", "category", "changedField", "className", "commit", "componentId", "cursor", "defaultAppId", "defaultCommit", "direction", "editMode",
          "entryId", "favoritesOnly", "filters", "keyword", "layers", "limit", "node", "object", "objectType", "offset",
          "operation", "orgId", "origin", "page", "parentId", "path", "primaryKey", "rating", "relationKinds",
          "runId", "sampleToken", "scope", "search", "section", "size", "sort", "source", "sourceType", "status",
          "target", "targetClass", "targetGroup", "template", "type", "values", "verdict", "version",
        ],
      },
    },
    configProps: [],
  }),
];
