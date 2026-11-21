<!-- Generated from SDK declarations and panel contracts by pnpm --filter @ontomato/contracts generate:panel-runtime-reference. -->
# Panel runtime reference

## Imports and application icons

Direct panel modules can import `vue`, `@ontomato/sdk/panel`.

The supported application icon IDs are `app-window`, `users`, `microscope`, `presentation`, `graduation-cap`, `briefcase`, `shopping-cart`, `package`, `clipboard-list`, `chart`, `wallet`, `heart-pulse`, `building`, `globe`, `calendar`, `book`, `folder`, `workflow`, `database`, `shield`, `home`, `agents`, `diagnosis`, `knowledge`, `objects`, `ontology`, `schedule`, `dashboards`, `permissions`, `settings`, `governance`, `builder`, `pages`, `gallery`, `agent-builder`.

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
  /**
   * Runs a write as the reader, the way an agent's runs: one intent freezes the calls, the host confirms it where the
   * owner or a batch asks and dispatches it once. What the owner reports changed comes back through the host's refresh
   * port, not from here. A cancelled confirmation writes nothing. With the answer come the targets the owner named
   * when it prepared the write (each by its own label, as the confirmation shows them), for a receipt to name them too.
   */
  writeOperation(operationId: string, invocation: PanelWriteInvocation): Promise<PanelWriteResult>;
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

The result type is `type MemberDataState = PanelDataState | { status: "awaiting" };`.

| Status in PanelDataState | Additional fields |
| --- | --- |
| `ready` | `value` |
| `empty` |  |
| `error` | `message` |
| `forbidden` |  |
| `loading` |  |

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

A custom editor that supplies an explicit target and input can use `instance.writeOperation(id, { call: { target, input } })`.
It resolves to a receipt. Read these fields before updating the editor or announcing a save.

- `decision: "cancel"` means the user cancelled. Keep the editor open.
- On `decision: "confirm"`, read `response`. If its kind is `not-dispatched`, show its message.
- For a single dispatched call, `response.outcome.kind === "success"` confirms the write. Use its `data` and then
  show success. On `refusal` or `failure`, keep the edits and show the owner's message and any named field errors.
- A null or `unknown` outcome leaves the result unconfirmed. A batch receipt reports one outcome per item.

## Open events and navigation

A `manifest.events` event with `labelKey` and no `on` is a page-header operation. An event with `on` runs from that member's output.
`do.open` with `mode: "entry"` describes a `platform:ApplicationPanelUse` reference and optional destination state inputs.
In the current direct runtime, an open event reports that the SDK opens no entry or member from an event.
For a browser button or component output that should navigate, call `usePanelContext().navigate` with the registered path
from `panel uses <application-id>` and, when needed, the destination's deep-linkable state.

For the assistant, the generated page skill's Panel events section describes how to repeat each shortcut.
`do.set` opens the current entry with the changed deep-linkable fields in `state`. `do.invoke` calls the listed
owner operation. `do.open` follows the indicated destination address. Use a declared operation ID for `/operate`.

## Draft links and instance state

A draft link uses the destination entry path and the query keys `draftSessionId`, `draftRunId`, `draftPath`.
Use the session and run that wrote the artifact and the original relative `outputs/drafts/<name>.page-draft.json` path.
The SDK reads the artifact, verifies it was written for the entry's `pageKey`, and offers it to the mounted forms.
A form asks its owner for the target's description, matches `save.draftOperation`, then gives the owner's form read
the proposed field values to check. If the owner accepts changed fields, the SDK fills the form and sets `instance.draft`.
Keep the form projection mounted with `v-show` so it can receive the draft before the editor is visible.
Watch `instance.draft` to reveal the editor. It is null while waiting or when the draft changes nothing.
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
