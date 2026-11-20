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
The New control clears that selection and the owner supplies the create form.

Start your own page by choosing the registered platform type and your intended application ID.

```sh
node "$SKILL/ontomato.mjs" panel scaffold platform:AgentDefinition ./agents-panel --id my-agent-management
```

The starter writes `panel.html`, `panel.json` and `registration.json` into a new directory. It reads owner declarations
from the current SDK. The generated material includes an application entry. Review its access before registration.
When editing the generated layout or manifest, carry the updated `html` and `manifest` into the panel's registration
input. The starter includes the owner save when the type declares a form and save operation. Additional operation
buttons require their owner descriptions, including the target input name and batch support.

## Effect and wiring

| Effect | What to write |
| --- | --- |
| Search this list | Declare `data.rows` using an owner read with a `search` parameter. The list shows the search field and supplies the value at runtime. |
| Share the search keyword or put it in the address | Declare a scalar `search` input and output on the list projection, map `data.rows.params.search` to `{input: "search"}`, and bind the list member's `outputs.search` to panel state. That binding supplies its matching input. Give other members that need the keyword an input bound to the same state. |
| Status tabs with counts | Use `SegmentedControl` with `data.counts` and bind its `outputs.value` to a scalar status state. The owner supplies the ordered `[{key, label, count}]` options. Bind the list member's status input to that state and map `data.rows.params.status` to `{input: "status"}`. Use the same search state for counts and rows. |
| Pagination | Use an owner read that declares its pagination parameters. The list supplies page or cursor values at runtime. The default page size is 20. Set `config.pageSize` when the page needs a different size. |
| Select a row and show details | Bind `outputs.selected` to object-reference state. Pass that state to the summary's object input. Its `data.record.source` is `{object: {input: "<object input name>"}}`. |
| New and edit in one form | Put `data.form` and `data.createForm` on one `ObjectForm` projection and bind the object input named by `form.source.object.input` to the selected state. A null selection shows the create form. A New event sets the selected state to `{literal: null}`. |
| Single operation | Read `data.operation = {source: {operation: {kind: "PlatformOperation", id: "<owner operation ID>"}}, read: "describe", params: {}}` in an `OperationButton` projection. Bind the member input named by the description's `target.input` to the selected object. The operation ID is `<member key>.<last segment of owner operation ID>`. |
| Batch operation | Bind `ObjectList.outputs.checked` to a list of object references. Bind the button's owner-named target input to that list. A list target invokes a batch for an owner operation that declares batch support. |
| Highlight search hits | Share the list's search state with the detail's `data.record.params.search` when the owner declares it. The owner returns highlight ranges in its records, and ObjectList and ObjectSummary render them. |
| Carry state in the address | Mark the state fields to restore with `deepLink: true` in the manifest. Keep transient multi-selection in panel state. |

Bind a member's same-named input and output through `outputs` once. Components declare the parameters they supply at
runtime. Author `params` entries for values bound to panel state or supplied as literals. For example, ObjectForm
supplies `values` and `changedField`, so the projection names the edited object and the owner form read.

Write layout with `div`, `section` and `panel-member`. A member uses `ref`; its containers arrange members with
`flow` and `gap` and can display conditionally using `when`, `eq` or `ne`. The SDK layout checker reports invalid
tags and attributes. Put page instructions in `recipes.md`. The platform derives the page skill from the registered
application use and its panel material.
