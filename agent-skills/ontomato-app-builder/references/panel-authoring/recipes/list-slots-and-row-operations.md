# Custom list columns, row detail, and per-row operations

Use `ObjectList`'s built-in `config.rowActions` for per-row operation buttons and local buttons (dialog/navigation),
and standard Vue slots (`#cell-<key>`, `#cell`, `#actions`, `#row-detail`, `#card`, `#empty`) to customize a piece of
the list without replacing the whole table.

- **Action layout:** `rowActions.items` holds operations (`kind: "operation"`, `operation`) or local actions
  (`kind: "local"`, `id`, optional `to`). Items accept `labelKey` or `label`, `tone`
  (`"default" | "primary" | "success" | "warning" | "danger"`), `icon`, `iconOnly`, `when`
  and `disabledWhen`. Conditions match owner fields against `equals`, `notEquals`, `in`, `notIn` or `truthy`.
  Operation items also accept `hideWhenUnavailable`. The action column accepts `labelKey` or `label`,
  `maxVisible` (overflow after two by default), `fixed: "right" | false`, `align`, `width` and `minWidth`.
- **Rowless slots & events:** `ObjectList` never passes raw `row` objects to panel slots or events.
  - `#cell-<columnKey>` and `#cell` receive `{ ref, index, column, value, displayText, tone, operations, runOperation }`
    — pass only `value` / `displayText` / `tone` to your display component; never read raw row record fields or calculate in the
    template.
  - `#actions` receives `{ ref, index, operations, runOperation }`.
  - `#row-detail` receives `{ ref, index, collapse }` — pass `:inputs="{ target: ref }"` to a nested projection whose
    `target` is `{ "fromSlot": true }`.
  - `#row-detail` expansion supports `rowActivation: "click" | "dblclick" | "expand"` (with `"expand"` toggling inline
    detail on whole-row click or `Enter`/`Space` with a trailing chevron and dirty-form leave confirmation) and
    controlled `expandedKeys` (`v-model:expandedKeys` or `state.expandedKeys` via `inputs`/`outputs.expandedKeys`,
    which can be bound to public state for deep links or `present`). Use a drawer or detail projection bound to public
    selection when a separate full-detail editor is preferred.
  - Set `minContainerWidth` (pixels) on table columns to automatically hide lower-priority columns when the list
    container narrows below that threshold (always keeping at least one column visible).
  - `runOperation(localName, overrides?)` only accepts parameters declared on that row operation's allowlist.

```json
{
  "manifest": {
    "state": {
      "selected": {
        "type": { "kind": "object", "objectType": "platform:Application" },
        "deepLink": true
      }
    },
    "components": {
      "status-pill-cell": "domain-component:11111111-1111-4111-8111-111111111111"
    },
    "members": {
      "apps": {
        "component": "ObjectList",
        "type": "platform:Application",
        "data": { "rows": "query" },
        "state": { "selected": "selected" },
        "config": {
          "columns": [
            { "key": "label", "labelKey": "col.app", "width": "240px" },
            { "key": "status", "labelKey": "col.status", "kind": "tag", "width": 120 }
          ],
          "rowActions": {
            "maxVisible": 2,
            "items": [
              { "kind": "local", "id": "edit", "labelKey": "action.edit" },
              { "kind": "operation", "operation": "disable", "when": { "field": "status", "equals": "active" } }
            ]
          }
        },
        "operations": {
          "disable": { "operation": "applications.disable", "target": { "row": true } }
        }
      },
      "rowDetail": {
        "component": "ObjectSummary",
        "type": "platform:Application",
        "target": { "fromSlot": true },
        "data": { "record": "record" }
      }
    }
  }
}
```

```html
<projection slot="apps" @row-action="onRowAction">
  <template #cell-status="{ value, displayText, tone }">
    <status-pill-cell :value="value" :text="displayText" :tone="tone"></status-pill-cell>
  </template>
  <template #row-detail="{ ref }">
    <projection slot="rowDetail" :inputs="{ target: ref }"></projection>
  </template>
</projection>
```

For `ObjectForm`, place field-level pickers or custom inputs inside `#field-<dotPath>` (for example `#field-skills`,
`#field-modelSelection.modelId`, or `#field-items.*.skillId` for array rows). `ReferencePicker` and `RecordGraph`
connect automatically to the enclosing form field; `ReferencePicker` also provides in-place Retry on choice-read
failure and optional `refreshable: true` for manual choice refresh.

Prepare the domain component and check the application source. Publish through Application Builder after preview and confirmation.

```sh
node "$SKILL/scripts/ontomato.mjs" component register ./status-pill-cell
node "$SKILL/scripts/ontomato.mjs" panel check ./apps-panel
```
