# Start a management page

The [agent management example](../examples/agent-management/panel.html) uses the existing `platform:AgentDefinition`
list, record, edit form and create form. Its [manifest](../examples/agent-management/panel.json) and
[registration material](../examples/agent-management/registration.json) are ready to check and register.

```sh
example="$SKILL/examples/agent-management"
node "$SKILL/ontomato.mjs" panel check "$example"
node "$SKILL/ontomato.mjs" panel register "$example"
```

Open the example's application entry at `/applications/app-example-agent-management/manage`. Select an agent to edit it.
The **New** command in the page header sets public state `creating: true` and clears `selected`, so the owner supplies the
create form and the page assistant can open the same state. After a successful create, the host uses the object returned
by the owner as the form's selection.

Start your own page by choosing the registered platform type and your intended application ID.

```sh
node "$SKILL/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id app-my-agent-management
```

The starter writes `panel.html`, `panel.mjs`, `panel.json` and `registration.json` into a new directory.
It reads owner declarations from the platform's type table. Review the generated application entry and access
before registration. Use `panel type <type-id>` to inspect the same reads and operations.

Use `--operation <owner operation ID>` for a button targeting the selected record and `--batch <owner operation ID>`
for a button targeting checked records. Repeat either flag to add more buttons. When an operation needs additional
required inputs, connect the form or supply those values in Vue. The starter includes an owner save when the type
declares both the form read and a `form.save` operation.

## Effect and wiring

| Effect | What to write |
| --- | --- |
| Search this list | Set `data.rows` to a read with a `search` parameter. The list shows the search field and supplies the value at runtime. |
| Share the search keyword or put it in the address | Connect `state.search` to a scalar panel state. Use the same connection on other members whose reads need it. |
| Status tabs with counts | Use a `SegmentedControl` with `data.counts` and `state.value` connected to status. Connect `state.status` on the list. Counts and rows can share the search state. The owner supplies the ordered `[{key, label, count}]` options. |
| Pagination | Use an owner read with pagination parameters. The list supplies the values at runtime, with `config.pageSize` for a different page size. |
| Select a row and show details | Connect the list's `state.selected` and the summary's `target` to the same object state. Set the summary's `data.record` to the owner read. |
| New and edit in one form | Set `component` to `ObjectForm`, declare `data.form`, `data.createForm` and the owner save in `operation`, and connect `target` to the selected state. Declare a `deepLink: true` boolean `creating` state and a primary `manifest.commands.create` header command (`do.set` with `creating: true`, `selected: null`); keep the form mounted with `v-show` and clear `creating` on select, save, or discard. |
| Detail header with actions | Use `ObjectHeader` with `target` bound to the selected state, `data.record` bound to the record read, and declared `operations`. Pair it with `ObjectSummary` (`config.showTitle: false`) when showing fields beneath the header. |
| Single operation | Set `component` to `OperationButton` and put the owner ID in `operation`. Set `target` to the selected object state. |
| Batch operation | Connect the list's `state.checked` and the button's `target` to the same list of object references. Use an owner operation that supports batch execution. |
| Highlight search hits | Connect `state.search` on the detail when its record read declares `search`. The owner returns highlight ranges that ObjectList and ObjectSummary render. |
| Carry state in the address | Mark the state fields to restore with `deepLink: true` in the manifest. |

For server-side paging, choose a paginated read from `panel type` for the `ObjectList.rows` datum and let
the list supply the paging inputs. See the [generated paging configuration](panel-authoring/RUNTIME.md#list-paging).

Use a read object `{read, params}` for explicit state or literal bindings. Components supply their own runtime
parameters. For example, ObjectForm supplies `values` and `changedField` to the owner form read.

Write the Vue template inside `<div id="app">` in `panel.html`, and place each member with `<projection slot="name"></projection>`.
Write layout in normal HTML, CSS, and Vue (not layout components) using platform design tokens, without CSS viewport units.
In `panel.mjs`, call `mountPanel` and use `usePanelContext` for public state, `usePanelNarrow` to switch between split and
single-column views by container width, and `usePanelBack` to wire browser Back, Escape, and the host's unsaved-changes guard.
Put page instructions in `recipes.md`.
