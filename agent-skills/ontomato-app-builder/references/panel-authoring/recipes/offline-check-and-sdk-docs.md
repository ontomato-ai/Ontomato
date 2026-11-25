# Offline check and component reference

The installed SDK release includes `docs/components.md` (the compact grouped component overview), per-component single
pages `docs/components/<ComponentId>.md`, `docs/components/ui-primitives.md`, `docs/components/theme-tokens.md`,
`components.json` (the machine-readable catalogue), and `docs/reference.md` (the full `@ontomato/sdk` API reference,
optional — do not read upfront). Open those files directly offline. Online, use
`node "$SKILL/scripts/ontomato.mjs" sdk read docs/components.md` and `sdk read docs/components/<ComponentId>.md`.

### Fetch offline check materials from a connected environment

An installed SDK release directory (`$SDK_RELEASE`) only needs three files to run offline checks: `sdk.json`,
`components.json`, and `node/panel-check.mjs`. Download them from the target deployment (plus the author type table so
owner reads, parameters, operations, and Actions are verified):

```sh
mkdir -p "$SDK_RELEASE/node"
node "$SKILL/scripts/ontomato.mjs" sdk read sdk.json > "$SDK_RELEASE/sdk.json"
node "$SKILL/scripts/ontomato.mjs" sdk read components.json > "$SDK_RELEASE/components.json"
node "$SKILL/scripts/ontomato.mjs" sdk read node/panel-check.mjs > "$SDK_RELEASE/node/panel-check.mjs"
node "$SKILL/scripts/ontomato.mjs" panel type --all > ./type-table.json
```

### Run offline checks (with vs. without a type table)

- **Full offline check (recommended — verifies reads, operations, and Actions against `type-table.json`):**

```sh
node "$SKILL/scripts/ontomato.mjs" panel check ./my-app --sdk-dir "$SDK_RELEASE" --type-table ./type-table.json
# or directly via the standalone script (requires --type-table):
node "$SKILL/scripts/panel-check.mjs" ./my-app --sdk-dir "$SDK_RELEASE" --type-table ./type-table.json
```

- **Structure-only offline check (when `--type-table` is omitted):**

```sh
node "$SKILL/scripts/ontomato.mjs" panel check ./my-app --sdk-dir "$SDK_RELEASE"
```

  Omitting `--type-table` checks `application.json` (including required `declaration.icon` — list valid icon names with
  `node "$SKILL/scripts/ontomato.mjs" sdk icons`), `panel.json` / `projections/*.json` schemas (including `"data": {}`
  on ordinary projections with no data reads such as `OperationButton`), allowed imports, CSS/UI guardrails, and
  component ports, **but does not verify owner reads, parameters, operations, or customer `Action` IDs against a type
  table**. Check the output's `typeTableChecked` field (or pass `--type-table`) to confirm whether a type table was
  checked.

Use the online `node "$SKILL/scripts/ontomato.mjs" panel check ./my-app` when you also need server lookup for
already-registered platform/domain projections or panels.

### Metric charts and single-member refresh

For a calculated MetricView chart from an existing dashboard card, declare `component: "MetricChart"` and
`sourceCard: { dashboardId, cardId }`, and connect its inputs in `state` (if unregistered, `panel check` lists it in
`unchecked`. Ask the card owner to register it, then reference the projection by ID). `MetricChart` also
supports binding its data directly without `sourceCard` when rendering a standalone or preview chart. To refresh a
single mounted projection in place (for example one dashboard card) without reloading the whole panel, attach a Vue
template `ref` to `<projection slot="...">` and call `memberRef.value?.refresh()`.
