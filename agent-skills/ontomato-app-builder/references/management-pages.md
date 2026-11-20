# Start a management page

The [agent management example](../examples/agent-management/panel.html) uses the existing `platform:AgentDefinition`
list, record, edit form and create form. Its [manifest](../examples/agent-management/panel.json) and
[registration material](../examples/agent-management/registration.json) are ready to check and register.

```sh
example="$SKILL/examples/agent-management"
node "$SKILL/ontomato.mjs" panel check "$example" --material "$example/registration.json"
node "$SKILL/ontomato.mjs" panel register "@$example/registration.json"
```

Open the example's application entry at `/applications/example-agent-management/manage`. Select an agent to edit it.
The New control clears that selection and the owner supplies the create form. After a successful create, the host
uses the object returned by the owner as the form's selection.

Start your own page by choosing the registered platform type and your intended application ID.

```sh
node "$SKILL/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id my-agent-management
```

The starter writes `panel.html`, `panel.json` and `registration.json` into a new directory. It reads owner declarations
from the platform's type table. The generated material includes an application entry. Review its access before registration.
When editing the generated layout or manifest, carry the updated `html` and `manifest` into the panel's registration
input. The starter includes the owner save when the type declares a form and a `form.save` operation.
Use `--operation <owner operation ID>` for a button targeting the selected record and `--batch <owner operation ID>`
for a button targeting checked records. Repeat either flag to add more buttons. The starter takes the target input
name and batch support from the type table. For operations with extra required inputs, wire the owner form or
operation inputs. The starter places these controls above the list. Online `panel check` uses the same type table
to check targets before registration. Declare a local name in `operations` and use that name in `config.operation`
on a button. Use the projection's `target.input` name in the member's state binding, for either the selected object
or the checked list. The placed operation ID is `<member key>.<local name>`.

## Effect and wiring

| Effect | What to write |
| --- | --- |
| Search this list | Declare `data.rows` using an owner read with a `search` parameter. The list shows the search field and supplies the value at runtime. |
| Share the search keyword or put it in the address | Bind the list member's `outputs.search` to scalar panel state. This single binding supplies the same-named input and read parameter. Bind other members' `search` inputs to the same state when their reads need it. |
| Status tabs with counts | Use `SegmentedControl` with `data.counts` and bind its `outputs.value` to scalar status state. The owner supplies the ordered `[{key, label, count}]` options. Bind the list member's `inputs.status` to that state. Its same-named read parameter uses the binding, and counts and rows share the search state. |
| Pagination | Use an owner read that declares its pagination parameters. The list supplies page or cursor values at runtime. The default page size is 20. Set `config.pageSize` when the page needs a different size. |
| Select a row and show details | Bind `outputs.selected` to object-reference state. Pass that state to the summary's object input. Its `data.record.source` is `{object: {input: "<object input name>"}}`. |
| New and edit in one form | Put `data.form`, `data.createForm` and one owner `form.save` binding on an `ObjectForm` projection. Connect the edit object's input to the selection. A New event clears that selection. When the owner supports creation and the projection declares the matching `createForm`, the empty input opens the create form. |
| Single operation | In an `OperationButton` projection, set `operations.approve = {operation: {kind: "PlatformOperation", id: "<owner operation ID>"}, target: {input: "record"}}` and `config.operation = "approve"`. Connect the `record` member input to the selected object. |
| Batch operation | Bind `ObjectList.outputs.checked` to a list of object references. Bind the button's target input to that list. A list target invokes a batch for an owner operation that declares batch support. |
| Highlight search hits | Bind the detail's `inputs.search` to the list's search state when the owner record read declares `search`. The owner returns highlight ranges, and ObjectList and ObjectSummary render them. |
| Carry state in the address | Mark the state fields to restore with `deepLink: true` in the manifest. Keep transient multi-selection in panel state. |

Bind a member's same-named input and output through `outputs` once. Same-named state bindings supply read parameters.
Use `params` for literals or to name a different input. Components declare the parameters they supply at runtime. ObjectForm
supplies `values` and `changedField`, so the projection names the edited object and the owner form read.

Write layout with `div`, `section` and `panel-member`. A member uses `ref`; its containers arrange members with
`flow` and `gap` and can display conditionally using `when`, `eq` or `ne`. The SDK layout checker reports invalid
tags and attributes. Put page instructions in `recipes.md`. The platform derives the page skill from the registered
application use and its panel material.
