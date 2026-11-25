# Open a panel with flat named URL parameters

Mark **only** view-restoration state (`selected`, `tab`, `search`, `filter`, `sort`, view mode) with `deepLink: true` in
`manifest.state`. **Never** mark dialog toggles (`creating`, `grantDialog`, `dialog`, `compose`) or active-edit trackers
(`editingEntryId`) with `deepLink: true` — keep them as normal public state so agents can still open and inspect them.

Use `node "$SKILL/scripts/ontomato.mjs" panel uses <app-id>` to confirm the destination entry's registered `path`, and
build addresses with `panelAddress(path, state)` from `@ontomato/sdk/panel`:

```js
import { panelAddress, usePanelContext } from "@ontomato/sdk/panel";

const { navigate } = usePanelContext();
// Fixed single-type object state -> "/ontology/relations/detail?selected=belongs_to"
await navigate(panelAddress("/ontology/relations/detail", { selected: ref.primaryKey }));
// Multi-type object-union state -> "/ontology/map?selected=platform:ObjectType~Student&tab=relations"
await navigate(panelAddress("/ontology/map", {
  selected: { className: "platform:ObjectType", primaryKey: "Student" },
  tab: "relations",
}));
```

| State type / scope | Flat query encoding | Example |
| --- | --- | --- |
| Scalar (`string`, `number`, `boolean`) | `<name>=<value>` (omitted when empty or default) | `?tab=entries&sort=updated` |
| Single-type `object` | `<name>=<primaryKey>` | `?selected=my-app` |
| Multi-type `object-union` | `<name>=<className>~<primaryKey>` | `?selected=platform:ObjectType~Student` |
| `child-object` | `<name>=<parentPk>~<childPk>` (or `<parentType>~<parentPk>~<childPk>`) | `?field=Student~name` |
| `list` | Repeated `<name>` parameters | `?tag=a&tag=b` |
| Application frame `deepLink` field | `frame.<name>=<value>` | `?frame.term=2026-fall` |

Shell-reserved query parameters (`standalone`, `from`, `navigationContext`)
and `frame.*` parameters are preserved automatically by `panelAddress`; do not use them as panel state names. See
[State in an address](../RUNTIME.md#state-in-an-address) and the
[object reference shapes table](../RUNTIME.md#object-reference-shapes-quick-reference).
