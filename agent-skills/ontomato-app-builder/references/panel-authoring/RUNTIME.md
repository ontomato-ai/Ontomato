<!-- Generated from SDK declarations and panel contracts by pnpm --filter @ontomato/contracts generate:panel-runtime-reference. -->
# Panel runtime reference

## Imports

Direct panel modules can import `vue`, `@ontomato/sdk/panel`.

For a domain application, choose `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons` (all catalogue icons are available).
To show an application by its icon key, draw `<component :is="appIcon(key)" :size="16" />` with `appIcon` from
`@ontomato/sdk/panel`: it is the platform's own icon for the key, and an unknown key draws the platform's fallback.

## Vue setup

### usePanelContext

The panel context a panel module runs under.

```ts
function usePanelContext(): ResolvedPanelContext
```

### PanelContext

```ts
interface PanelContext {
  /** This instance: its state, page context, projections and operations. */
  readonly instance: PanelInstance;
  /** True while one or more refreshes triggered by `refreshObjects()` are in flight. */
  readonly refreshing?: ComputedRef<boolean>;
  /** Re-reads all mounted projections and data in this panel instance; resolves once they settle. */
  refreshObjects?: () => Promise<void>;
  /**
   * In an application's frame: the entry the reader opened (it follows the reader to another entry of the application),
   * and the menu the same resolution gave, to draw the frame's menu with and mark the entry. Null in any other panel.
   * Neither is the panel's state: they are the platform's, read only.
   */
  readonly currentEntry: ComputedRef<CurrentApplicationEntry | null>;
  readonly entryMenu: ComputedRef<ApplicationEntryMenu | null>;
  /** Current signed-in user's public display info; null in editions without sign-in. Platform-owned, read-only. */
  readonly currentUser: ComputedRef<PanelCurrentUser | null>;
  /**
   * Reactive read-only check for whether the given object currently has any unsaved local draft in this browser.
   * Exposes only the boolean indicator; draft values and storage keys remain platform-internal.
   */
  hasLocalDraft(ref: PanelObjectRef): boolean;
  /**
   * The panel's own words (its content's `messages`) in the platform's current language: the current language, else
   * the deployment's default, else the key. The panel's HTML reads the same function as `t(key, params)`.
   */
  readonly t: PanelText;
  /**
   * Opens one of the platform's addresses, such as `/agents/chat?agentId=…`. When it cannot — not the platform's own
   * address, a page the reader may not open — the platform says why on the page, and this rejects with that reason.
   */
  navigate(address: string): Promise<void>;
  /**
   * Tells the reader briefly how something the page did went — "Exported", "Deleted", why a call failed — in the
   * platform's own message at the top of the window, as its pages do. It fades by itself and is available in panels
   * that run directly on the platform.
   */
  notify(message: { kind: "success" | "info" | "warning" | "error"; text: string }): void;
  /**
   * Unified host confirmation for leaving unsaved edits (danger confirm button, Cancel focused by default). Resolves
   * `true` immediately when the panel has no unsaved changes or the reader confirms leaving; asks at most once per turn.
   */
  confirmLeaveUnsaved?: () => Promise<boolean>;
}
```

### PanelInstance

```ts
interface PanelInstance {
  readonly state: PanelStateStore;
  // A computed context, read only at its top: a deep read-only type of it recurses through the member paths' JSON values
  // (a nested panel's selection) without end.
  readonly pageContext: ComputedRef<PageContext>;
  /** The mounted form adapters its projections registered for live filling, submission, and visibility. */
  readonly forms: PanelFormAdapters;
  /**
   * Anything this panel shows may have changed: every datum it shows is read again, as the page header's refresh reads
   * it, and every component that reads its own data is told so. The page's own code calls it to keep what it shows
   * current (polling while a run goes on); an operation's reported changes need no call. Resolves once all triggered
   * refreshes settle.
   */
  refreshObjects(): Promise<void>;
  /** True while one or more refreshes triggered by `refreshObjects()` are in flight. */
  readonly refreshing: ComputedRef<boolean>;
  onObjectChanged(listener: (object: PanelObjectIdentity | null) => unknown): () => void;
  /** Reactive map of read-only outputs published by projection members (`outputs[member][name]`), separate from writable `state`. */
  readonly outputs: Readonly<Record<string, Readonly<Record<string, RuntimeJsonValue | null>>>>;
}
```

### PanelStateStore

```ts
interface PanelStateStore {
  /** Every declared field, by name, as the panel's template and script read them. */
  readonly values: Readonly<Ref<Readonly<Record<string, PanelFieldValue>>>>;
  /** Field names explicitly named by the most recent `set` or `setState` call (empty before any update). */
  readonly lastPatchedKeys: ReadonlySet<string>;
  /** One field; the same value `values` holds. */
  field(name: string): Readonly<Ref<PanelFieldValue>>;
  /** What the reader or a state operation set. A value of the wrong type for the field is refused here. */
  set(name: string, value: PanelFieldValue): void;
  /**
   * Atomically updates multiple declared fields in one state assignment (for example changing a parent object while
   * clearing its child selection, or switching mutually exclusive selections). Every entry is validated before any
   * field changes, so reactive watchers and the host bridge never see a half-updated state.
   */
  setState(patch: Readonly<Record<string, PanelFieldValue>>): void;
  /** The fields an address or an open request may carry, with the values they hold now. */
  deepLinkable(): Record<string, PanelDeepLinkStateValue>;
}
```

### usePanelOutput

Read one read-only output published by a projection member (e.g. `ObjectList`'s `total`, `loadedCount`,
`filteredCount`, `checkedCount`, `selectedLabel`, `activeLabel`; `ObjectSummary`/`ObjectHeader`/`ObjectForm`'s
`label`; `ObjectForm`'s `dirty` and `draft`; or named typed scalar outputs declared by the bound read's owner).
Read-only outputs stay separate from the panel's writable public `manifest.state`.

```ts
function usePanelOutput<T extends RuntimeJsonValue = RuntimeJsonValue>(member: string, name: string): ComputedRef<T | null>
```

`usePanelOutput` reads from `instance.outputs`. Outputs are published by mounted projections. Subscribing never mounts a
member or starts its reads. The component requests its named data when it mounts. An output with no
published value is `null`. Use an `inputs` binding such as `{ output: { member, name, path } }` to connect
the output directly to another member. Omit `path` for the whole value or use a JSON Pointer for a nested value.

### usePanelOutputs

Read all read-only outputs published by a projection member as a reactive map (`{ total, filteredCount, ... }`).

```ts
function usePanelOutputs(member: string): ComputedRef<Readonly<Record<string, RuntimeJsonValue>>>
```

### usePanelFormDraft

Binds one mounted `ObjectForm` slot to `<page-header :draft="draft">`: returns `null` while the form slot is absent
(or `when` is false), and otherwise exposes the header's draft controls and `refreshDraft()` wired straight to
`instance.forms.handle(slot)`.

```ts
function usePanelFormDraft(slot: MaybeRefOrGetter<string | null | undefined>, options?: UsePanelFormDraftOptions | undefined): ComputedRef<PanelFormDraftControls | null>
```

### UsePanelFormDraftOptions

```ts
interface UsePanelFormDraftOptions {
  /**
   * Optional reactive guard controlling whether the draft controls are shown (for example `() => detail.value.status === "ready"`).
   * Defaults to `true` whenever the form slot is mounted.
   */
  when?: MaybeRefOrGetter<boolean>;
  /**
   * Whether clicking Discard asks the platform's confirmation dialog before restoring the owner baseline.
   * Defaults to `true`.
   */
  confirmDiscard?: boolean;
}
```

### PageHeaderDraft

Save/Discard draft state displayed by `<page-header>`: without changes only a disabled Save button renders; with
changes the unsaved notice, Discard and Save render together.

```ts
interface PageHeaderDraft {
  /** Whether there are unsaved changes to save or discard. */
  readonly dirty: boolean;
  /** Whether a save operation is currently in flight. */
  readonly saving?: boolean;
  /** Optional explicit save-enabled override; defaults to `dirty && !saving`. */
  readonly canSave?: boolean;
  /** Whether clicking Discard asks for a confirmation dialog before invoking `discard` and emitting `discard`. */
  readonly confirmDiscard?: boolean;
  /** Optional handler invoked when Save is clicked (alternative to listening for `@save`). */
  readonly save?: () => void;
  /** Optional handler invoked when Discard is clicked (alternative to listening for `@discard`); returning `false` suppresses the `discard` event. */
  readonly discard?: () => void | boolean | Promise<void | boolean>;
}
```

### AppMenuGroup

A group of entries in an application menu column; omit `label` for an untitled section.

```ts
interface AppMenuGroup {
  /** Stable group key. */
  key: string;
  /** Optional section heading shown above the group's entries. */
  label?: string;
  /** Entries in display order. */
  items: readonly AppMenuItem[];
}
```

### AppMenuItem

One entry in an application menu column.

```ts
interface AppMenuItem {
  /** Stable identifier of the entry (typically its route path). */
  id: string;
  /** Localized display label shown on the row. */
  label: string;
  /** Optional icon key from the platform's curated icon set or a Vue icon component. */
  icon?: AppMenuIcon;
  /** When set, renders the row disabled with this tooltip hint instead of clickable. */
  unavailableHint?: string;
}
```

### PanelFormHandle

What one form holds, as the projections placed in its `#field-*` Vue slots read and write it: the owner's
fields, the values, the field errors and changed marks by path, and whether the form is busy. Every one of them is the
form's own; a field projection never keeps a copy.

```ts
interface PanelFormHandle {
  readonly fields: Readonly<Ref<readonly PanelFormField[]>>;
  readonly values: Readonly<Ref<PanelFormValues>>;
  readonly errors: Readonly<Ref<Readonly<Record<string, string>>>>;
  readonly changed: Readonly<Ref<ReadonlySet<string>>>;
  readonly busy: Readonly<Ref<boolean>>;
  /** Whether this form currently holds unsaved edits or explicitly modified fields. */
  readonly dirty: Readonly<Ref<boolean>>;
  /** Distinct top-level field paths currently modified relative to the opened baseline. */
  readonly dirtyFields: Readonly<Ref<ReadonlySet<string>>>;
  /** Whether a save is currently in flight (alias of `busy`). */
  readonly submitting: Readonly<Ref<boolean>>;
  /** Whether the form is ready and has unsaved edits that can currently be submitted. */
  readonly canSubmit: Readonly<Ref<boolean>>;
  /** Sets one field's value; a field the owner marks `refreshOnChange` has the owner asked again. */
  set(path: string, value: RuntimeJsonValue): void;
  /** Refreshes the owner's fields and validation for the current values, preserving unsaved edits. */
  refreshDraft(): Promise<void>;
  /** Submits the form through its owner. */
  submit(): Promise<unknown>;
  /**
   * Discards unsaved edits and restores the owner baseline. Pass `{ confirm: true }` to ask the platform's
   * confirmation dialog first; resolves `true` when discarded, `false` when cancelled.
   */
  reset(options?: { confirm?: boolean }): Promise<boolean>;
}
```

`PanelFormHandle.refreshDraft()` refreshes the owner's fields, options and errors in place while the form is dirty,
preserving the unsaved draft and its baseline. A clean form adopts the new description and baseline.

On `<object-form-fields>`, use either `:parent` or `:fields`. Setting `:parent` makes the component ignore `:fields`.
Use `:parent="activeClassParent" :exclude="['/rowPermission']"` to omit a child of that parent, or omit `:parent`
and pass full absolute JSON pointers in `:fields`.

### usePanelNarrow

Observes a panel container element's own inline width via `ResizeObserver` and reports whether it is narrow
(`width > 0` and `width <= breakpoint`), resolving the breakpoint from a CSS design token on that element
(default `--pane-narrow-breakpoint`). Never reads `window.innerWidth`.

```ts
function usePanelNarrow(element: MaybeRefOrGetter<HTMLElement | null | undefined>, options?: UsePanelNarrowOptions): ComputedRef<boolean>
```

### UsePanelNarrowOptions

```ts
interface UsePanelNarrowOptions {
  /** Design token CSS variable defining the narrow breakpoint (default `"--pane-narrow-breakpoint"`). */
  readonly token?: `--${string}`;
}
```

### usePanelBack

Registers a panel-local back/close layer with the enclosing host (LIFO). While `active` is truthy:
- Browser Back (when `pushHistory` is true, the default) runs `onBack` after the host's unified unsaved-changes guard.
- Pressing Escape (when no modal dialog, drawer, dropdown, or popover is open) runs `onBack` after the same guard.
- Calling the returned `back()` runs the same guard and then `onBack`, keeping UI back buttons and browser Back in sync.

```ts
function usePanelBack(active: MaybeRefOrGetter<boolean>, onBack: () => void, options?: UsePanelBackOptions | undefined): PanelBackHandle
```

Back layers close last-in first-out. `<sdk-dialog>` and `<sdk-drawer>` automatically guard dirty forms registered
through `useProjectionForm` before closing via the close button, backdrop, Escape, or `handleClose()`. Discarding
clears only the dirty forms inside that overlay. For a form dialog with a Back layer, bind `:model-value` and
`:before-close`. Call `done()` only when `await dialogBack.back()` returns true. Drive a custom Save button with
`usePanelFormDraft`. Use the same Back layer for the dialog's Cancel button.

### UsePanelBackOptions

```ts
interface UsePanelBackOptions {
  /**
   * Whether activating this back layer pushes a browser history entry so browser Back invokes `onBack`.
   * Defaults to `true`.
   */
  pushHistory?: MaybeRefOrGetter<boolean>;
  /**
   * Form slot(s) owned by this back layer (for example `"attributeForm"` when closing an inline sub-editor while
   * another form on the same panel stays open). When provided, only those form slots are checked for unsaved changes
   * and discarded on confirmation, leaving other forms on the panel untouched. Pass `[]` for a purely local view layer
   * that owns no forms. Omit to guard and discard all dirty forms in the panel.
   */
  forms?: MaybeRefOrGetter<string | readonly string[] | undefined>;
}
```

### PanelBackHandle

```ts
interface PanelBackHandle {
  /**
   * Runs the same guarded back step as Escape or browser Back (for example from a "Back to list" button): asks the
   * host's unified unsaved-changes confirmation first and calls `onBack` only if allowed. Resolves `true` when `onBack`
   * ran, `false` when cancelled or when `active` is currently `false`.
   */
  back: () => Promise<boolean>;
}
```

### savePanelFile

Saves one file for the reader, under its own name, and says what was saved.

```ts
function savePanelFile(file: { mime: "image/png" | "text/csv" | "application/zip"; bytes: ArrayBuffer | Uint8Array<ArrayBuffer> | Blob; suggestedName: string; }): { kind: "file"; name: string; mime: "image/png" | "text/csv" | "application/zip"; }
```

## Projection outputs and operations

A mounted `ObjectList` or `ObjectHeader` exposes its datum status as `ready`, `empty`, `error`, `forbidden`, `loading`. Before the member
publishes, its status output is `null`. Keep the header mounted for a selected record so the component can
display the owner's missing, forbidden, or error state in place. Owner-declared read outputs pass through to
`usePanelOutput`, alongside the header's own `label`, `status`, and `errorMessage`.

For the current list batch, read `usePanelOutput("list", "listed")`. It returns typed references when ready,
`[]` when empty, and `null` when unavailable or before the first result. Keep the output separate from public
state. Searches, filters, sorting, and paging preserve the selection. Only default-select when there was no
selection on open. Keep a specified missing or forbidden selection in place. Use `v-show` to retain a list across
tab switches. `total` is owner-reported, `loadedCount` counts loaded rows, and `filteredCount` counts local matches
only for a complete unpaged list without server search. Unavailable counts are `null`.

Before refreshing for `affected.removed`, `letGo(removed)` discards drafts targeting removed objects or bound to
parent state about to be cleared. It then clears matching object state and removes deleted references from checked lists.

### usePanelOperation

Binds a declared member operation (`operations.<name>`) to the calling component's synchronous `setup()`.

By default (`options.entry !== false`), this also registers the calling component as a mounted page action entry so
human clicks and agent `page_action` calls share the exact same availability guards, input filtering, preparation,
4-tuple confirmation verification, dispatch, and `onSettled` callback, unregistering automatically on unmount.
Pass `{ entry: false }` for background flows or to subscribe to an operation with its own UI entry.

```ts
function usePanelOperation(member: string, name: string, options?: UsePanelOperationOptions): PanelOperationHandle
```

### UsePanelOperationOptions

Options for `usePanelOperation(member, name, options?)`.

```ts
interface UsePanelOperationOptions {
  /**
   * Whether this handle represents a mounted page UI entry reachable by `page_action` (default `true`).
   * Pass `false` for background flows or when another control provides the page action entry.
   */
  entry?: boolean;
  /**
   * Whether the UI entry is currently visible and available for the user.
   * Return `false` or `{ ok: false, message }` to refuse agent invocation and invalidate pending confirmations.
   */
  available?: MaybeRefOrGetter<boolean | PanelOperationAvailability>;
  /**
   * Whether the UI entry is currently disabled. A non-empty string disables the entry with that reason.
   */
  disabled?: MaybeRefOrGetter<boolean | string>;
  /**
   * Additional external busy guard (combined with this handle's own `running` state).
   */
  busy?: MaybeRefOrGetter<boolean>;
  /**
   * Optional synchronous input normalizer shared by human clicks and agent calls.
   * For agent calls, `provided` has already been filtered to unbound interactive schema fields.
   * Bound projection parameters always take precedence over the returned values.
   */
  prepareInput?: (
    provided: Readonly<Record<string, RuntimeJsonValue>>,
  ) => Readonly<Record<string, RuntimeJsonValue>>;
  /**
   * Panel-owned settlement callback (notifications, navigation, state updates, etc.) run on the exact same path
   * for human clicks, full-auto agent calls, and user-approved conversation confirmations.
   */
  onSettled?: (
    receipt: PanelWriteResult | PanelReadOperationResult,
    context: PanelOperationContext,
  ) => void | Promise<void>;
  /**
   * Optional error callback invoked when execution fails before dispatch (e.g. prepare failure).
   * Not invoked for deferred confirmation or stale-submission errors.
   */
  onError?: (
    error: Error,
    context: { readonly operationId: string; readonly input: Readonly<Record<string, RuntimeJsonValue>> },
  ) => void;
}
```

### PanelOperationHandle

One member's operation, as the page's code holds it.

```ts
interface PanelOperationHandle {
  /** The owner's description while it admits the operation now — its label, kind and target — else null. */
  readonly operation: ComputedRef<PanelOperationBinding | null>;
  /** Live member operations read state (`loading`, `ready`, `forbidden`, `error`, `empty`). */
  readonly state: ComputedRef<MemberOperationsState>;
  /** True while this operation is preparing, awaiting confirmation, or dispatching. */
  readonly running: ComputedRef<boolean>;
  /** True only while the operation is actively dispatching on the server. */
  readonly dispatching: ComputedRef<boolean>;
  /** Runs the operation with the page's own input; a read answers what it read (or the file saved), a write answers its receipt. */
  run(input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}
```

### Operation IDs and write results

The member declaration's `operation` is the owner's full ID. Invoke using the member-qualified ID from the page
skill's Declared operations. For a member `opRunNow` declaring `schedules.runNow`, pass `opRunNow.runNow`
as `operation` to `page_action`. In Vue, the same binding is `usePanelOperation("opRunNow", "runNow", options?)`,
which registers a mounted page action entry automatically. Pass `{ entry: false }` for a background flow or
to subscribe ahead of time to an operation behind a dialog. For example,
`usePanelOperation("submit", "apply", { entry: false })` exposes the operation read through `state`. Once
`state.value.status === "ready"`, use `state.value.value.apply?.unavailable?.reason` in the outer toolbar.
Only the dialog's `OperationButton` registers a `page_action`.

In Vue, call the hook’s `run(input)`. The SDK obtains the target from the binding and the host
handles confirmation and requests. For an action write, the hook resolves to a receipt. Read these fields before
updating the editor or announcing a successful write.

- `decision: "cancel"` means the user cancelled. Keep the editor open.
- On `decision: "confirm"`, read `response`. If its kind is `not-dispatched`, show its message.
- For a single dispatched call, `response.outcome.kind === "success"` confirms the write. Use its `data` and then
  show success. On `refusal` or `failure`, keep the edits and show the owner's message and any named field errors.
- A successful create carries the owner-reported `created: { objectType, primaryKey }`, also available as
  `operation.created` on completion. Without it, the success has no key to navigate to. Use `affected` for refresh.
- A null or `unknown` outcome leaves the result unconfirmed. A batch receipt reports one outcome per item.

`OperationInputDialog` uses password inputs for owner fields with `secret: true`. `PanelHost` mounts
`SecretDeliveryDialog` once per panel and delivers one-time secrets from all write entries, including
`ObjectForm`, `OperationButton`, `ObjectList` row actions and `usePanelOperation`. The operator receives the
secret. Assistant observation hides the plaintext, and the assistant leaves secret entry and delivery to the person.

## Page header and navigation

Place the official presentational `<page-header>` component at the top of a panel's content when the page needs a
header, and omit it for headerless pages. Pass `title` (or a `#title` slot with a projection-bound component such as
`<projection>` / `ObjectSummary`), optional `description`, optional `back-label` + `@back` wired to `usePanelBack`
or `navigate`, right-side controls in `#actions` (such as ordinary `<sdk-button>`, `<OperationButton>`, inline counts,
or search inputs), and optional `:draft` from `usePanelFormDraft` for Save/Discard/unsaved feedback. Buttons in
`<page-header>` change declared panel state or call declared owner operations, so skills continue to produce valid
deep-link addresses and `page_action` calls.

For a browser button or component output that should navigate, call `usePanelContext().navigate` with the registered path
from `panel uses <application-id>` and, when needed, the destination's deep-linkable state.

On `ObjectForm`, set `config.actions` to `"footer"` (default, non-overlapping document-flow bar), `"create-only"`
(Cancel/Create bar only in create mode when edit Save/Discard lives in `<page-header>` via `usePanelFormDraft`), or
`"none"` (omit the bar in both modes). To split one form's fields across multiple cards (1 or 2 columns), tabs, or
wizard steps while sharing one form state, validation, dirty tracking, `usePanelFormDraft`, `usePanelBack`, and agent
drafts, set `config.presentation` (`"cards" | "tabs" | "steps"`) with `config.groups` (or owner `sections`), or place
`<object-form-fields :fields="..." />` / `<object-form-fields rest />` slices inside `ObjectForm`'s `#default` slot.
`ObjectForm` automatically shows word counters for schema `maxLength` fields and
disables cascading select fields whose owner declares `disabledWhenEmpty`.

## General display components and MetricView `result` binding

Use the five official general display components (available both as projection components and as `<kebab-case>` tags
in panel templates / slots) instead of formatting business fields in panel HTML:

- `<typed-value>` (`TypedValue`): formats one typed field value (text, number, date/datetime/relative-time, boolean,
  status tag, tags, clickable object reference, localized map, list, code/JSON) from `data.record`, `data.result`
  (`metricOutput` scalar/first-row or named column), or a direct `value` prop. Supports exact-match `valueMap`
  (`{ [rawValue]: { label?, labelKey?, labels?, tone?, icon? } }`) for mapping raw codes/booleans/enums to localized
  text, semantic tones, and platform icons (pure exact match; no calculation or range/threshold expressions).
- `<record-template>` (`RecordTemplate`): fills already-provided values from `data.record` or one row of
  `data.result` (`metricOutput`) into a fixed `{fieldKey}` sentence template (`template`, `templateKey`, or
  locale-keyed `templates`, with per-field `fieldFormats` including `valueMap`). Strictly presentation-only: no
  expressions, calculation, or conditional sentence branching.
- `<info-banner>` (`InfoBanner`): standardized `info`/`success`/`warning`/`danger` callout banner supporting static/
  localized copy, slots, or already-provided `data.record` / `data.result` fields and fixed templates, plus exact-match
  `toneMap`/`valueMap` and platform `icon`.
- `ObjectList` columns also accept `column.valueMap` with the same exact-match `{ label?, labelKey?, labels?, tone?, icon? }`
  shape (or use `<typed-value :value="value" :value-map="..." />` inside `#cell-<columnKey>` slots).
- `<object-ref-card>` (`ObjectRefCard`): clickable object reference card (icon/monogram, caption, localized name,
  monospace identifier, optional badge) from `data.record` (via `field` or the record itself), `data.result`, or a
  direct `reference` prop — ideal for composing relationship `Source → Target` blocks. Declares output `navigate`
  (bindable via `state: { navigate: "..." }`, typed by `config.targetClassName`, the bound record type, or an
  ontology `object-union`) in addition to emitting `@navigate`.
- `<metric-card>` (`MetricCard`): single or multi-KPI statistic cards (`card`, `compact`, or `inline` variants) bound
  directly to `data.result` (`metricOutput`), `data.record`, `data.rows`, `data.objects`, or standalone `value`/`items`.
- `<grouped-grid>` (`GroupedGrid`): responsive CSS grid arranging `data.rows` (`panelRecordList`) into collapsible
  groups (optionally ordered/preserving empty groups from a parent `data.record` via `groupsField`) with stacked
  sections (`sectionField`, `sectionOrder`, per-section `rowHeight`), drag-and-drop reordering, pointer cell resizing,
  `selected`, built-in per-item `rowActions`, and scoped slots (`#item`, `#item-header-actions`, `#group-header-actions`,
  `#group-empty`, `#empty`). Emits `layout-change` only when the reader finishes a drag or resize interaction.
- `<operation-result>` (`OperationResult`): renders a read-only panel operation's result (`markdown`, `json`, `file`,
  or multi-section `sections` with tabbed `records` tables, language-tagged `code`, and `json` panes).
- `<object-list>` (`ObjectList`) also supports `layout: "tabs"` (horizontal tab strip with overflow buttons, per-tab
  `rowActions`, and `#tabs-extra`), `dynamicColumns: true` (derives table columns from owner `fieldLabels` and record
  `fields` when no static `columns` are set), `showColumnToggle`, and `exportable` (current-page UTF-8 BOM CSV export).
  For customer `ObjectType` `query` reads, bind `data.rows.params.filters` (`[{ field, operator, value? }]` with
  `eq|ne|contains|gt|lt|gte|lte|null|notnull`) and `data.rows.params.sort` (`{ field, order: "asc" | "desc" }`) to
  `json` state (`default: null`) for whole-class server filtering and sorting before `total` and paging.
- `<object-text-reader>` (`ObjectTextReader`) supports `format: "auto" | "plain" | "markdown" | "table" | "code" | "diff"`
  (parsing standard unified diffs into file summaries and line-numbered hunks) and writes clicked relative `.md` links
  to `activePath`.
- `<conversation-entry>` (`ConversationEntry`) defaults to `presentation="button"` (expands the page composer) and
  also supports `presentation="inline"` (embeds the platform's inline composer and serves sibling `ConversationEntry`
  buttons; pair with `pageComposer: "none"` on the application entry to suppress the bottom floating composer).
- Calling `.refresh()` on a `<projection ref="...">` template ref refreshes that single mounted member in place
  without reloading the rest of the panel.

Every entry (full page or beside a conversation) receives a content box with no host page header, host padding, or
outer card frame. Style panels with normal HTML, CSS, and Vue (prefer container-relative sizing and CSS `@container`
rather than `window.innerWidth` or viewport units so the layout stays comfortable when hosted beside a conversation),
and use `<sdk-dialog>` / `<sdk-drawer>` for overlays. When a single panel hosts an editable in-panel sub-view (rather
than navigating to a separate detail entry), wire `usePanelBack` so browser Back, Escape, and in-page back buttons
share the host's unified unsaved-changes guard.

`SdkPopover`, `SdkDialog` and `SdkDrawer` mount inside the panel's `[data-panel-overlay-root][data-panel-instance]`.
Panel `<style>` is native browser CSS and applies to these overlays directly. The host scopes it to the panel
instance. Use ordinary descendant selectors and omit the Vue SFC selectors `:deep` and `::v-deep`.

## Live remote control by assistants

Assistants beside a displayed panel operate directly through four live tools on the real-time presentation channel:
- `observe_display`: read the latest live public state and open form values (including unsaved user edits).
- `present`: navigate to a site-relative entry path or update declared public state in place (including non-`deepLink` state such as dialogs, tabs, and selections).
- `fill_form`: fill explicit fields into a mounted live `ObjectForm` through its own edit entry, highlighting changed fields and keeping the form unsaved (refuses to overwrite fields with unsaved user edits unless the user confirms and the agent passes `overwriteUnsaved: true`).
- `page_action`: execute a declared operation (including form save, button actions, row actions with `rowKey` in the exact `<ClassName>:<primaryKey>` format copied verbatim from the snapshot row, batch actions on checked items, nested panel actions, `page.refresh`, or `<form>.discard`) through the exact same UI entry a user clicks, under the logged-in user's permissions.

The mounted `ObjectForm` owns its live values and submission. When an agent's same-page `present` would switch
a dirty form's target or unmount it, the host returns `blocked_unsaved`. Unrelated state updates succeed while
the dirty form stays mounted on the same target. Human controls that switch, close, or cancel a form use the
panel's unsaved confirmation. `ObjectForm` also guards changes to both its `requestedTarget` and
`requestedFixedValues` before taking up the new target or fixed values.

When a selection watcher resets related fields, use `instance.state.lastPatchedKeys` to preserve fields explicitly
set in the same state patch, such as a trial dialog and its parameters supplied together by `present`.

Use `v-if` or operation availability/disabled conditions when an entry cannot be used now. Use `v-show` for
stateful content the reader could still use after switching a tab, expanding a section, or returning to a list.

## List paging

ObjectList's `data.rows` accepts `panelRecordList`, `panelRecordQuery` and supplies the declared parameters `search`, `cursor`, `size`, `page`.

| Prop | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `config.pageSize` | `number \| undefined` | no | `20` | How many items a page holds when the owner's read pages (a query's cursor, or page numbers); 20 by default. |

## State in an address

The `deepLink` flag is boolean and defaults to false. Only state needed for another
reader to land on the same view (selected object, tab, view mode, list search/filter/sort) may set `deepLink: true`;
dialog toggles (such as `creating`, `grantDialog`) and active-edit trackers (such as `editingEntryId`) must remain
public state without `deepLink: true`.

Each `deepLink: true` field has its own flat query parameter. Single-type `object` fields use bare
`primaryKey` (`?selected=my-app`), `object-union` fields use `className~primaryKey`, and list fields repeat
the parameter (`?tag=a&tag=b`). An empty list uses `?tag=`. Frame fields use the `frame.` prefix
(`?frame.term=2026-fall`). Build in-app links with `panelAddress(path, state)` from `@ontomato/sdk/panel`.
The shell owns `standalone`, `from`, `navigationContext`.
The capability-map type view uses `{"mode":"type","selectedType":"platform:SDKComponent"}` as state; the address contract encodes it as `?mode=type&selectedType=platform:SDKComponent`.

### Graph selection

The capability map uses this declaration for its public `selected` state:

```json
{
  "type": {
    "kind": "object-union",
    "layers": [
      "fact",
      "capability",
      "governance",
      "product"
    ],
    "objectTypes": [
      "platform:OntologyType"
    ]
  },
  "personal": false,
  "deepLink": true,
  "external": false
}
```

An `object-union` admits one object reference of a type in the selected ontology layers, the explicit `objectTypes`, or both.
The value has `className` and `primaryKey`. Linking the graph and relation list to this same state keeps their selection in sync.

### Child objects

- State field type `{ kind: "child-object"; parentType: string; collection: string }`.
- A value in that field `{ parent: { objectType: string; primaryKey: string }; primaryKey: string }`.

### Object reference shapes quick reference

| Where | Shape |
| --- | --- |
| Panel state, `@saved` event | `{ className, primaryKey }` |
| URL query parameter (`deepLink: true`) | `primaryKey` (fixed `object`) or `className~primaryKey` (`object-union`) |
| `instance.pageContext.value.selection` item | `{ id, label, ... }` |

## Application icons

Choose an application's `declaration.icon` from `node "$SKILL/scripts/ontomato.mjs" sdk icons`.
To render an application icon by key in a catalog panel, draw `<component :is="appIcon(key)" :size="16" />` with
`appIcon` from `@ontomato/sdk/panel`.
