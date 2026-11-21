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
}
```

### PanelInstance

```ts
interface PanelInstance {
  readonly state: PanelStateStore;
  readonly pageContext: DeepReadonly<Ref<PageContext>>;
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

One datum of one member, kept current while the calling component is mounted.

```ts
function usePanelData(member: string, name: string, runtimeParams?: MaybeRefOrGetter<Readonly<Record<string, RuntimeJsonValue>>> | undefined): ComputedRef<MemberDataState>
```

`usePanelData` reads the way every member's data is read: by the projection's read and its mappings, through the
platform, as the reader. It answers `loading`, `awaiting` (an object or a required parameter has no value yet; nothing
is read), `ready` with `value`, `empty`, `forbidden` or `error` with `message`. It reads again when the panel state the
member binds changes, when the run-time values you pass change, and when an operation reports that what it shows
changed. Values you pass yourself are run-time parameters, which the platform checks against the catalogue and the
read.

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

## List paging

ObjectList's `data.rows` accepts `panelRecordList`, `panelRecordQuery` and supplies the declared parameters `search`, `cursor`, `size`, `page`.

| Prop | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `config.pageSize` | `number \| undefined` | no | `20` | How many items a page holds when the owner's read pages (a query's cursor, or page numbers); 20 by default. |

## State in an address

The `deepLink` flag is boolean and defaults to false. The capability-map type view uses
`{"mode":"type","selectedType":"platform:SDKComponent"}` as state. The address contract encodes it as `?state=%7B%22mode%22%3A%22type%22%2C%22selectedType%22%3A%22platform%3ASDKComponent%22%7D`.

### Child objects

- State field type `{ kind: "child-object"; parentType: string; collection: string }`.
- A value in that field `{ parent: { objectType: string; primaryKey: string }; primaryKey: string }`.
