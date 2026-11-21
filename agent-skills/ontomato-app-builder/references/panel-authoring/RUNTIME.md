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
   * platform's own message at the top of the window, as its pages do; it fades by itself. A note that belongs on the
   * page and stays is `<el-alert>` in the template. A panel the platform runs has it; a frame has none.
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
  /** Set once a mounted form accepts a draft with changed fields. Cleared when the reader saves or discards it. */
  readonly draft: Readonly<Ref<ReceivedPanelDraft<Record<string, unknown>> | null>>;
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

## Reads and operations

### usePanelData

One datum of one member, kept current while the calling component is mounted. Call it in a component's setup,
before any `await`.

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
| `forbidden` |  |
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

Declare each page-header command under `manifest.commands` with a localized `labelKey` and a `do` action; at most one
is `primary: true`, the header's main button. `manifest.commands` is required; use `commands: {}` when the panel has no
header commands. A command's values are literals or state fields. A `do.set` field must be a `deepLink: true` state
field, so the changed address reproduces the page. Handle component-driven interactions (a selection, an output) in Vue.
`do.open` with `mode: "entry"` describes a `platform:ApplicationPanelUse` reference and optional destination state inputs.
In the current direct runtime, an open command reports that the SDK opens no entry or member from a command.
For a browser button or component output that should navigate, call `usePanelContext().navigate` with the registered path
from `panel uses <application-id>` and, when needed, the destination's deep-linkable state.

The generated page skill's Panel commands section gives the assistant the address or operation for each command.
`do.set` opens the current entry with the changed deep-linkable fields in `state`. `do.invoke` calls the listed
owner operation. `do.open` follows the indicated destination address. Use a declared operation ID for `/operate`.

## Draft links and instance state

Copy the registered entry path, including its initial slash, and keep any existing entry parameters.
Use the producing session and run IDs. Give `draftPath` only the run-relative artifact path
`outputs/drafts/<name>.page-draft.json`. Encode that value once.

The agent directory example opens at `#/applications/app-example-vue-agent-directory/manage?draftSessionId=SESSION_ID&draftRunId=RUN_ID&draftPath=outputs%2Fdrafts%2Fedit.page-draft.json`.

A raw `draftPath` of `/outputs/drafts/edit.page-draft.json` starts with a slash and is invalid.
The encoded query value `draftPath=%2Foutputs%2Fdrafts%2Fedit.page-draft.json` still starts with that slash after decoding.

The SDK reads the artifact, verifies it was written for the entry's `pageKey`, and offers it to the mounted forms.
The target identifies the object type and, for an edit, the owner's object ID. A form of that type matches
`save.draftOperation` and gives the owner's form read the proposed field values to check. If the owner accepts
changed fields, the SDK fills the form and sets `instance.draft`.
Keep the form projection mounted with `v-show` so it can receive the draft before the editor is visible.
Watch `instance.draft` to reveal the editor. It is null while waiting or when the draft changes nothing.
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
