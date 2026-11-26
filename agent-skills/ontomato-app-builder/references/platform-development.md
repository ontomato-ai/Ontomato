# Convert a platform page

Start with the [decomposition checklist](app-standard/references/decomposition.md). Read the existing page and its
business calls. For each read or action, identify the authoritative object type, the service that owns it, the inputs
from the page, the user permission, and what the page shows after success or refusal. Use those facts to look up the
current owner declarations and SDK catalogue. Extend the owner or SDK where a required capability is missing.

## Add a named owner read or operation

Task triggers are a platform resource with an owner-declared form. The owner supplies the `list`, `record` and
`form` reads and the `schedules.runNow` operation. The corresponding projections bind the list, selected task,
owner form and operation button.

1. At the business owner, identify the existing read or action and its request identity, permission and result.
2. Declare the stable type and read name, target source, required parameters, accepted input types and result shape.
   The platform resolves the actual placement and passes the viewer identity to the owner. Return the owner's
   read state and field errors in the shared result shape. When introducing a new fixed read parameter name, also add it
   to `PanelData.data["*"].runtimeParams` in `packages/apps-sdk/src/catalogue.ts` so `component-catalogue.node-test.mjs`
   stays green.
3. Declare the operation's ID, input/result shape, target (single `targetType`, or declarative `targetTypes: { platformTypes?, customerObjects? }`
   for multi-target platform operations — never non-serializable callbacks), effect and batch support. For every
   `form.save` write operation, reuse `panelFormSaveInputSchema` from `@ontomato/contracts/panel-projection` (rather than
   hand-writing a `.strict()` schema without `submittedFields`, which `ObjectForm` always sends), and include
   `submittedFields` in unit tests. Connect it to the same owner
   write and authorization for the browser and assistant. Report affected objects or types so relevant reads refresh.
   A create owner must return explicit `created: { objectType, primaryKey }` on its `kind: "success"` receipt
   when it creates an identifiable object. The platform forwards that identity as `operation.created` in the
   completion event. Consumers use it to open the new object. Success without `created` closes the create flow
   without an identity. `affected.objects` is for refresh.
4. Test actual registration, read, confirmation and dispatch through the platform. Cover an admitted target and an
   owner denial. Check the user-visible result and any field error or affected-object receipt.

The task list declares `component: "ObjectList"`, `type: "platform:ScheduledTask"`, `data: {rows: "list"}`
and `state: {selected: "selectedTask"}`. The summary declares `component: "ObjectSummary"`,
`target: "selectedTask"` and `data: {record: "record"}`. The form supplies `values` and `changedField` at
runtime through its component declaration. The selected state is typed once as
`{kind: "object", objectType: "platform:ScheduledTask"}`.

The button member `run` declares `component: "OperationButton"`, `operation: "schedules.runNow"` and
`target: "selectedTask"`. A single object target runs once. A list target runs a batch when the owner
declares batch support. The HTTP examples below use the formal inputs and operation IDs produced by registration.

Use a real selected task UUID for `<taskId>` in the following summary read. The reader's authentication and the
registered use determine whether this request can read the task.

```json
{
  "source": {
    "kind": "registered",
    "applicationId": "app-panels-trial-a",
    "useId": "use-trial-a-tasks"
  },
  "memberPath": [{ "member": "summary" }],
  "dataName": "record",
  "inputs": {
    "task": { "className": "platform:ScheduledTask", "primaryKey": "<taskId>" }
  }
}
```

The ready result includes `primaryKey`, `label`, `fields` and the owner's localized `fieldLabels`.
On the same read endpoint, send `operations: true` for the `run` member to get the owner descriptions keyed by
local operation name. Supply that member's inputs, including the selected task for this example.

For an agent run with the page skill loaded and the page open beside the conversation, invoke the same operation
through `page_action({ operation: "run.runNow" })`. The page prepares the intent through the same human operation
endpoint under the logged-in user's permissions, asks for confirmation in the conversation by default (returning
`awaiting_confirmation` without blocking), and dispatches once when the user confirms while verifying the live page
instance and target have not changed. In full-auto sessions it dispatches immediately. A repeated lookup by intent ID
reports the existing result without re-executing.

## Check built-in panels

Build the SDK release from the checkout, then run:

```sh
node "$SKILL/scripts/ontomato.mjs" panel check <panel-dir> --builtin --sdk-dir <built-sdk-dir>
```

Use the release directory containing `sdk.json`. In Vitest, call `checkBuiltinPanelSource(directory, checks)`
directly with the contracts checks and the owner draft-read operation IDs derived from the type table. Use
the SDK catalogue and platform type entries when testing projection expansion.
In an enterprise test, call `installContentLayout(...)` in `beforeAll`, then dynamically
`await import(...)` the modules exporting `readBuiltinProducts` and `platformTypeEntries` inside the test.
Their module initialization requires the installed layout.

For a component test mounted directly with `panelModuleFor`:

- The direct host routes `ctx.notify` to `ElMessage`. Assert the visible message where feedback is relevant.
- Mock `PanelFormDescription` with `valueSchema`. Select options supply both `disabled` and `disabledReason`.
- Put the form member key in `target: { source: "draft", slot: "form" }` for a `form.save` descriptor.
- For a successful create, set `outcome.created: { objectType, primaryKey }` in the mock response.
  `ObjectForm` takes the `@saved` key from `created`.

## Write the page skill's common tasks

In `recipes.md`, describe how to use the declared reads, forms and operations for common tasks. Use the business
owner's rules and actual operation descriptions for the page.

For Business Knowledge at `/ontology/knowledge`, the owner supplies these rules.

1. A record has a required title and body, tags, and a status. The body is the retrievable text. Use the owner's
   tag choices or create a new tag. Status `0` means pending review and `1` means approved, the default for manual creation.
2. Split a search on whitespace. A match contains every term somewhere in its title, body or tags.
3. Read the current record before editing. The owner uses last-write-wins updates.
4. In the default mode, fill the live form with `fill_form` and request saving or declared writes through `page_action`
   (which asks for confirmation in conversation by default, or executes immediately in full-auto sessions).
5. Approval sets the status to `1`. A delete confirmation names the titles and number of entries because deletion is
   permanent. For batch approvals or deletions, report each outcome and leave failed entries for review.
6. Use the Business Knowledge page for creating, editing, reviewing and deleting records. Use the existing
   `knowledge-governance` agent for extracting or organizing knowledge from conversations and documents.

For Business Knowledge search, connect `state.search` on the list, status counts and detail to the same
public state. The binding supplies the `search` parameter to `query`, `counts` and `record`. The counts read
also takes `{read: "counts", params: {by: {literal: "status"}}}`. Connect the list's `state.status` to the status state.
The detail receives the selected knowledge record. Use `ObjectSummary` to show
the full body as text with its original line breaks. The owner returns highlight ranges in the record for the current search.

## Add an official SDK component

Use an existing component if its ports already express the interaction. For a new component, record these five
parts beside its implementation so authors can compose it from the released catalogue.

| Part | What to declare |
| --- | --- |
| Meaning | What the component presents or lets someone do, and the role it plays on a page. |
| Needed data | The named owner results it consumes, their types and how it shows loading, empty, denied and failed reads. |
| Configuration | Display choices the projection can set, with their types and defaults. |
| Inputs | The typed values a placement supplies, such as the currently selected object. |
| Outputs and operations | Events that update panel state, and the owner operations the component can trigger. |

Use `ObjectSummary` as an example of a component with one required record datum and a declared label output.
For a new official component:

1. Expose the component through the SDK public entry, register its template name, and add its catalogue declaration.
   Give it a package-qualified ID for projection registration and declare each accepted datum, input and operation.
2. For a new public read result such as `annotatedCode`, register its schema with the read contract and update the
   catalogue entries and catalogue test fixtures that enumerate supported result IDs.
3. Document configuration in the component's `defineProps` JSDoc and declare events and slots on the component.
   The SDK build generates catalogue configuration and component docs from those declarations. For each read-only
   output, declare the port in `readOnlyOutputs` and publish it with `useMemberOutput`. When a component declares both a
   parent `record` datum and a `rows` datum (with `rowType`), type row-oriented ports with `objectType: "@data:rows"` so
   expansion does not fall back to the parent type.
4. Run the SDK catalogue/release checks and a host-level Vue test that mounts a real projection. Verify input and
   output types, loading and owner refusal, declared operations, and the released component reference.
