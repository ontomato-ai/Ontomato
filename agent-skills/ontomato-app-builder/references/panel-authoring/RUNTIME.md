<!-- Generated from SDK declarations and panel contracts by pnpm --filter @ontomato/contracts generate:panel-runtime-reference. -->
# Panel runtime reference

## Imports and application icons

Direct panel modules can import `vue`, `@ontomato/sdk/panel`.

For a domain application, choose `declaration.icon` from `node "$SKILL/ontomato.mjs" sdk icons`.
The built-in icons identify the platform's own entries.
To show an application by its icon key, draw `<component :is="appIcon(key)" :size="16" />` with `appIcon` from
`@ontomato/sdk/panel`: it is the platform's own icon for the key, and an unknown key draws the platform's fallback.

## Vue setup

### usePanelContext

The panel context a panel module runs under.

```ts
function usePanelContext(): PanelContext
```

### PanelContext

```ts
interface PanelContext {
  /** This instance: its state, page context, projections and operations. */
  readonly instance: PanelInstance;
  /**
   * In an application's frame: the entry the reader opened (it follows the reader to another entry of the application),
   * and the menu the same resolution gave, to draw the frame's menu with and mark the entry. Null in any other panel.
   * Neither is the panel's state: they are the platform's, read only.
   */
  readonly currentEntry: ComputedRef<CurrentApplicationEntry | null>;
  readonly entryMenu: ComputedRef<ApplicationEntryMenu | null>;
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
}
```

### PanelInstance

```ts
interface PanelInstance {
  readonly state: PanelStateStore;
  // A computed context, read only at its top: a deep read-only type of it recurses through the member paths' JSON values
  // (a nested panel's selection) without end.
  readonly pageContext: ComputedRef<PageContext>;
  /** The form adapters its projections registered, for the draft its address names. */
  readonly forms: PanelFormAdapters;
  /** Set once a form accepts a draft with changed fields. Cleared when the reader saves or discards it. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
  /**
   * Anything this panel shows may have changed: every datum it shows is read again, as the page header's refresh reads
   * it, and every component that reads its own data is told so. The page's own code calls it to keep what it shows
   * current (polling while a run goes on); an operation's reported changes need no call.
   */
  refreshObjects(): void;
  onObjectChanged(listener: (object: PanelObjectIdentity | null) => void): () => void;
}
```

### PanelStateStore

```ts
interface PanelStateStore {
  /** Every declared field, by name, as the panel's template and script read them. */
  readonly values: DeepReadonly<Ref<Record<string, PanelFieldValue>>>;
  /** One field; the same value `values` holds. */
  field(name: string): DeepReadonly<Ref<PanelFieldValue>>;
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

### usePanelBack

Registers a panel-local back/close layer with the enclosing host (LIFO). While `active` is truthy:
- Browser Back (when `pushHistory` is true, the default) runs `onBack` after the host's unified unsaved-changes guard.
- Pressing Escape (when no modal dialog, drawer, dropdown, or popover is open) runs `onBack` after the same guard.
- Calling the returned `back()` runs the same guard and then `onBack`, keeping UI back buttons and browser Back in sync.

```ts
function usePanelBack(active: MaybeRefOrGetter<boolean>, onBack: () => void, options?: UsePanelBackOptions | undefined): PanelBackHandle
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

### usePanelDetailHeader

Publishes a full-width detail view's heading and actions to the enclosing platform page header so the page renders
one unified bar (back to catalog, object title, and actions) rather than stacking a second titlebar inside the panel.
Returns `true` when the enclosing host owns the page header, or `false` in nested/headerless previews so the panel
can render a local fallback bar when needed.

```ts
function usePanelDetailHeader(header: () => PanelDetailHeader | null): boolean
```

### PanelDetailHeader

What a panel displaying a single object's full-width detail view hands to the enclosing platform header so the page
shows one unified bar (back to catalog, object title, and actions) rather than stacking two headers.

```ts
interface PanelDetailHeader {
  backLabel: string;
  title: string;
  onBack(): void;
  actions?: readonly PanelDetailHeaderAction[];
}
```

### PanelDetailHeaderAction

One action a panel or its member hands to the enclosing page header in full-width detail mode.

```ts
interface PanelDetailHeaderAction {
  id: string;
  label: string;
  icon?: "plus" | "save" | "trash" | "sliders" | "table" | "book-open";
  primary?: boolean;
  danger?: boolean;
  inline?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onClick(): void;
}
```

### usePanelNarrow

Observes a panel container element's own inline width via `ResizeObserver` and reports whether it is narrow
(`width > 0` and `width <= breakpoint`), resolving the breakpoint from a CSS design token on that element
(default `--pane-narrow-breakpoint`). Never reads `window.innerWidth`.

```ts
function usePanelNarrow(element: MaybeRefOrGetter<HTMLElement | null | undefined>, options?: UsePanelNarrowOptions): ComputedRef<boolean>
```

### savePanelFile

Saves one file for the reader, under its own name, and says what was saved.

```ts
function savePanelFile(file: { mime: "image/png" | "text/csv" | "application/zip"; bytes: ArrayBuffer | Uint8Array<ArrayBuffer> | Blob; suggestedName: string; }): { kind: "file"; name: string; mime: "image/png" | "text/csv" | "application/zip"; }
```

## Reads and operations

### usePanelData

One datum of one member, kept current while the calling component is mounted. Call it in a component's setup,
before any `await`.

- Use this hook for panel coordination (such as deciding visibility, navigation or follow-up state when no component
  output already carries the value). Do not use it to render business fields in the panel template; render business
  data through an official component, its configuration, or a dedicated component.
- `member` is a member the panel declares; `name` is a datum its projection names under `data.<name>`. The read, its
  mappings and the object it needs are the projection's: nothing about the read is written in the page.
- The member's inputs come from the panel state its placement binds; the datum is read again whenever that state
  changes. A datum whose object or required parameter has no value is `awaiting`, and nothing is read.
- `runtimeParams` are the page's own run-time values for the member (a page, a cursor, a keyword), as an object, a
  ref or a getter: set, they reach every read of the member that takes them, and a change reads again. The platform
  checks each against the component catalogue and the owner's read.
- When an operation the panel runs reports what it changed (the owner's `affected`), a datum read from an object is
  read again when that object is among the affected objects, and one read from a type when that type is among the
  affected types; nothing is to be refreshed by hand.
- It answers `loading`, `awaiting`, `ready` with `value` (the owner's result, checked against the result its read
  declares), `empty`, `forbidden`, or `error` with `message` (the read failed, or the platform could not answer it).

```ts
function usePanelData(member: string, name: string, runtimeParams?: MaybeRefOrGetter<Readonly<Record<string, RuntimeJsonValue>>> | undefined): ComputedRef<MemberDataState>
```

The result type is `type MemberDataState =
  | Exclude<PanelDataState, { status: "error" }>
  | { status: "error"; message: string; unreachable?: true; retry?: () => void }
  | { status: "awaiting" };`.

| Status in PanelDataState | Additional fields |
| --- | --- |
| `ready` | `value` |
| `empty` |  |
| `error` | `message` |
| `forbidden` | `reason` |
| `loading` |  |

A datum in `error` also carries `retry()`, which reads it again: offer it beside the message. When the platform never
answered (the request reached nothing), `unreachable` is `true` and `message` already says so in the reader's language;
show `message` as it is.

### usePanelOperation

```ts
function usePanelOperation(member: string, name: string): PanelOperationHandle
```

### PanelOperationHandle

One member's operation, as the page's code holds it.

```ts
interface PanelOperationHandle {
  /** The owner's description while it admits the operation now — its label, kind and target — else null. */
  readonly operation: ComputedRef<PanelOperationBinding | null>;
  /** Runs it with the page's own input; a read answers what it read (or the file the reader saved). */
  run(input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}
```

### Operation IDs and write results

The member declaration's `operation` is the owner's full ID. Invoke using the member-qualified ID from the page
skill's Declared operations. For a member `opRunNow` declaring `schedules.runNow`, send `opRunNow.runNow`
as `operationId` to `/operate`. In Vue, the same binding is `usePanelOperation("opRunNow", "runNow")`.

For an assistant call on an existing object, send a typed `call.target`, for example:

```json
{ "target": { "kind": "object", "objectType": "platform:ScheduledTask", "primaryKey": "<task-id>" }, "input": {} }
```

The corresponding panel selection stores `{className, primaryKey}`. On the wire, map `className` to `objectType` and add
`kind: "object"`. In Vue, call the hook’s `run(input)`. The SDK obtains the target from the binding and the host
handles confirmation and requests. For an action write, the hook resolves to a receipt. Read these fields before
updating the editor or announcing a successful write.

- `decision: "cancel"` means the user cancelled. Keep the editor open.
- On `decision: "confirm"`, read `response`. If its kind is `not-dispatched`, show its message.
- For a single dispatched call, `response.outcome.kind === "success"` confirms the write. Use its `data` and then
  show success. On `refusal` or `failure`, keep the edits and show the owner's message and any named field errors.
- A null or `unknown` outcome leaves the result unconfirmed. A batch receipt reports one outcome per item.

## Header commands and navigation

Declare each page-header command under `manifest.commands` with a localized `labelKey`, optional `icon` (`"plus"`),
and a `do` action; at most one is `primary: true`, the header's main button. `manifest.commands` is required; use
`commands: {}` when the panel has no header commands. A command's values are literals or state fields. A `do.set` field
must be a `deepLink: true` state field, so the changed address reproduces the page; when every `do.set` field sets a
literal and the panel state already holds those exact values (such as `creating: true`), the host automatically
disables the command button until state changes. Handle component-driven interactions (a selection, an output) in Vue.
`do.open` with `mode: "entry"` describes a `platform:ApplicationPanelUse` reference and optional destination state inputs.
In the current direct runtime, an open command reports that the SDK opens no entry or member from a command.
For a browser button or component output that should navigate, call `usePanelContext().navigate` with the registered path
from `panel uses <application-id>` and, when needed, the destination's deep-linkable state.

For a full-width detail view, call `usePanelDetailHeader` to replace the catalog header with one unified platform bar
(back to catalog, object title, and inline actions such as Save via `instance.forms.submit("form")`); it returns
`false` in headerless or nested previews so the panel can draw a local fallback bar. Mount `OperationButton` with
`config.placement: "header"` (and optional `type: "danger"`, `plain: true`, `icon: "trash"`) to place a member's
trigger button into the same platform header while keeping its confirmation dialog and error feedback mounted in the
panel. On `ObjectForm`, set `config.actions` to `"footer"` (default, non-overlapping document-flow bar), `"header"`
(Save/Discard/unsaved indicator in the host header), `"create-only"` (Cancel/Create bar only in create mode when edit
Save lives in the detail header), or `"none"` (omit the bar in both modes). `ObjectForm` automatically shows word
counters for schema `maxLength` fields and disables cascading select fields whose owner declares `disabledWhenEmpty`.

The host renders the page header solely from declared metadata (title, description, back control, `manifest.commands`,
and Refresh) and never places business data there; render counts and summaries inside panel content via the owning
component. Below the header to the bottom edge of the page, every entry (full page, beside a conversation, or inside a
custom frame's current-entry slot) receives a definite-height content box with no host padding or outer card frame; the
bottom composer floats over the page without occupying content-box height (reserve bottom scroll room such as
`calc(var(--page-content-gap) + 56px)` on scrollable views). Style panels against that box with normal HTML, CSS, and
Vue (natural stacking, or filling the box with inner scrolling and a `rem`/`px` `min-height`) rather than layout
components or CSS viewport units (`vh`, `vw`, `dvh`, etc.), and use `<sdk-dialog>` / `<sdk-drawer>` for overlays.
Wire `usePanelBack` so browser Back, Escape, and in-page back buttons share the host's unified unsaved-changes guard.

The generated page skill's Panel commands section gives the assistant the address or operation for each command.
`do.set` opens the current entry with the changed deep-linkable fields in `state`. `do.invoke` calls the listed
owner operation. `do.open` follows the indicated destination address. Use a declared operation ID for `/operate`.

## Draft links and instance state

Give readers a site-relative Markdown draft link. Use the registered entry path with its initial slash and keep
any existing query parameters. Omit the scheme, hostname and port, including `localhost`. The destination
starts with one slash and contains no `http://`, `https://`, or `//host` prefix.
Use the producing session and run IDs. Give `draftPath` only the run-relative artifact path
`outputs/drafts/<name>.page-draft.json`. Encode that value once.

For the catalog-detail template, the reply is `[Open the draft](/applications/app-template-catalog-detail/manage?draftSessionId=SESSION_ID&draftRunId=RUN_ID&draftPath=outputs%2Fdrafts%2Fedit.page-draft.json)`.

A raw `draftPath` of `/outputs/drafts/edit.page-draft.json` starts with a slash and is invalid.
The encoded query value `draftPath=%2Foutputs%2Fdrafts%2Fedit.page-draft.json` still starts with that slash after decoding.

The SDK reads the artifact, verifies it was written for the entry's `pageKey`, and evaluates it against the panel's
declared form members (even before the form mounts). The target identifies the object type and, for an edit, the
owner's object ID (plus optional `itemKey` for a row-attached form). A form of that type matches `save.draftOperation`
and gives the owner's form read the proposed field values to check. If the owner accepts changed fields, the SDK sets
`instance.draft` and fills the form once mounted. Watch `instance.draft` to open the target detail view or create
dialog. It is null while waiting or when the draft changes nothing.
Use [`draftTarget(draft)`](CODE.md#save-a-form-or-hand-off-a-draft) to get the accepted draft's effective create or update target.
The reader saves or discards the proposed change in the form.

## List paging

ObjectList's `data.rows` accepts `panelRecordList`, `panelRecordQuery` and supplies the declared parameters `search`, `cursor`, `size`, `page`.

| Prop | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `config.pageSize` | `number \| undefined` | no | `20` | How many items a page holds when the owner's read pages (a query's cursor, or page numbers); 20 by default. |

## State in an address

The `deepLink` flag is boolean and defaults to false. The capability-map type view uses
`{"mode":"type","selectedType":"platform:SDKComponent"}` as state. The address contract encodes it as `?state=%7B%22mode%22%3A%22type%22%2C%22selectedType%22%3A%22platform%3ASDKComponent%22%7D`.

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
