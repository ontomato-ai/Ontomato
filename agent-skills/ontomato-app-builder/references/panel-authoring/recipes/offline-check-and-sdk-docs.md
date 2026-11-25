# Offline check and component reference

The installed release includes `docs/components.md` (the compact grouped component overview), per-component single
pages `docs/components/<ComponentId>.md`, `docs/components/ui-primitives.md`, `docs/components/theme-tokens.md`,
`components.json` (the machine-readable catalogue), and `docs/reference.md` (the full `@ontomato/sdk` API reference,
optional — do not read upfront). Open those files directly offline. Online, use
`node "$SKILL/scripts/ontomato.mjs" sdk read docs/components.md` and `sdk read docs/components/<ComponentId>.md`.

Save the author type table with `node "$SKILL/scripts/ontomato.mjs" panel type --all > type-table.json`.
With the installed SDK release matching the intended deployment, run:

```sh
node "$SKILL/scripts/panel-check.mjs" ./my-panel --sdk-dir "$SDK_RELEASE" --type-table ./type-table.json
```

`SDK_RELEASE` is the directory containing `sdk.json`. The command uses the installed check module and
component catalogue, reports unchecked references, and needs no running service. Use the online
`ontomato.mjs panel check` for already-registered references that need server lookup.

### Metric charts and single-member refresh

For a calculated MetricView chart from an existing dashboard card, declare `component: "MetricChart"` and
`sourceCard: { dashboardId, cardId }`, and connect its inputs in `state` (if unregistered, `panel check` lists it in
`unchecked` and `panel register` asks the card owner to register it and writes the projection ID). `MetricChart` also
supports binding its data directly without `sourceCard` when rendering a standalone or preview chart. To refresh a
single mounted projection in place (for example one dashboard card) without reloading the whole panel, attach a Vue
template `ref` to `<projection slot="...">` and call `memberRef.value?.refresh()`.
