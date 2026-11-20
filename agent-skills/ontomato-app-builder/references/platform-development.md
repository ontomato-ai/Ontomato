# Convert a platform page

Start with the [decomposition checklist](app-standard/references/decomposition.md). Read the existing page and its
business calls. For each read or action, identify the authoritative object type, the service that owns it, the inputs
from the page, the user permission, and what the page shows after success or refusal. Use those facts to look up the
current owner declarations and SDK catalogue. Extend the owner or SDK where a required capability is missing.

## Add a named owner read or operation

Scheduled tasks are a platform resource with an owner-declared form. The owner separates `list`, `record`, `form` and
`schedules.runNow.describe`. The corresponding projections bind the list, selected task, owner form and operation
button. Use `packages/apps-sdk/examples/panels/schedules-trial/definitions.mjs` and `p/panel.json` in that
directory for the registered definitions and wiring.

1. Find the existing business interface. For scheduled tasks, Workbench calls it in
   `packages/workbench-server/src/services/scheduling/panel-reads.ts`. The result adapter in
   `packages/platform-schedules/src/panel-reads.ts` supplies the read functions. Keep the viewer's permission, language,
   business validation and test-data rules in the owner calls. Return the shared result, including any form field
   errors or per-relation result the component needs to render.
2. Register the read with the public contract owner. Give the stable type or operation ID, read name,
   `type`, `object` or `operation` source, parameter schemas and required parameters, and the result schema. Give a
   projection declaration using `data.<name> = { source, read, params }`. A matching member binding supplies a
   same-named parameter. Use `params` for literals or different input names. A component supplies the runtime
   parameters named in its SDK declaration. The named read adapter is mounted in
   `packages/workbench-server/src/services/product-panels/data-reads.ts`. This dispatcher resolves the actual
   placement and source and returns the result to the component under the reader's identity. The read request carries
   `source`, `memberPath`, `dataName` and `inputs`. A ready result carries `value`; loading belongs to the
   member while its read runs.
3. Give a write its own registered server operation. In
   `packages/platform-schedules/src/panel-server-operations.ts`, `platform:ScheduledTask.save` receives a form
   submission. `schedules.runNow` has a read-only description and a separate write handler.
   Declare the target, input and result schemas, effect and batch capability. Use the existing confirmation and
   dispatch flow and the owner's authorization. Both the person's form or button and the agent use the registered
   operation. Report affected objects on success so the host refreshes the appropriate data.
4. Test the full route. Use
   `packages/workbench-server/src/api/__tests__/panel-pilot-current.integration.test.ts` as the sample.
   Register definitions with a test owner, read named data through `POST /api/product-panels/read`, then submit and
   dispatch a declared operation. Verify the actual target, permission and business result. Use an empty and a denied
   read when the page needs to tell those cases apart. The dedicated test command is
   `pnpm --filter @ontomato/workbench-server exec vitest run src/api/__tests__/panel-pilot-current.integration.test.ts`
   with `RUNTIME_TEST_DATABASE_URL` set to a disposable PostgreSQL database. The agent confirmation cases are in
   `packages/workbench-server/src/services/product-panels/__tests__/operations.test.ts`.

The task-list projection uses `data.rows = { source: { type: { kind: "PlatformObjectType", id: "platform:ScheduledTask" } }, read: "list", params: {} }`.
The summary uses `data.record = { source: { object: { input: "task" } }, read: "record", params: {} }`.
ObjectForm supplies `values` and `changedField` at runtime.
The list's `selected` output and the summary, form and button inputs share a panel state of type
`{ kind: "object", objectType: "platform:ScheduledTask" }`. The member wiring maps the values through `{ state: "selectedTask" }`.
The button reads `data.operation = { source: { operation: { kind: "PlatformOperation", id: "schedules.runNow" } }, read: "describe", params: {} }`.
Its owner description names the write effect and targets the `task` input. In that placement the operation is
`run.runNow`, with writes going through the operation dispatcher.

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
Read the `run` member's `operation` data to discover the button's owner description.

For an agent run with the page skill loaded, the same operation is requested through
`POST $ONTOMATO_PANEL_OPERATIONS_URL/operate` with the run's callback credential and run ID. The request contains
a new intent UUID, the same application and use, `operationId: "run.runNow"`, and a `call` with
`target: { kind: "object", objectType: "platform:ScheduledTask", primaryKey: "<taskId>" }` and `input: {}`.
A `confirmation-required` result ends that tool call without a write. After the initiating person confirms,
the answering run uses its own credentials to dispatch that intent. The owner write starts the run and returns
the result and affected task. A repeated dispatch reports the existing result.

## Write the page skill's common tasks

In `recipes.md`, describe how to use the declared reads, forms and operations for common tasks. Use the business
owner's rules and actual operation descriptions for the page.

Page selection identifies the object. When a page task needs current attributes, make the owner's named `record`
read available through the selected reference. Use recipes for rules specific to that owner.

For Business Knowledge at `/ontology/knowledge`, the owner supplies these rules.

1. A record has a required title and body, tags, and a status. The body is the retrievable text. Use the owner's
   tag choices or create a new tag. Status `0` means pending review and `1` means approved, the default for manual creation.
2. Split a search on whitespace. A match contains every term somewhere in its title, body or tags.
3. Use the selected object's ID to read `record` before reporting its status or editing it. The owner uses last-write-wins updates.
4. In the default mode, hand a draft to the user for form saves. Execute declared writes after the user's confirmation
   or when the application allows automatic execution.
5. Approval sets the status to `1`. A delete confirmation names the titles and number of entries because deletion is
   permanent. For batch approvals or deletions, report each outcome and leave failed entries for review.
6. Use the Business Knowledge page for creating, editing, reviewing and deleting records. Use the existing
   `knowledge-governance` agent for extracting or organizing knowledge from conversations and documents.

For Business Knowledge search, bind the list's `outputs.search` to the `search` state. Bind the status counts and
detail members' `inputs.search` to that same state. The `query`, `counts` and `record` reads receive it by name.
The counts read also takes `params.by: { literal: "status" }`. Bind the selected tab's `status` state to the
list's `inputs.status`. The detail receives the selected knowledge record. Use `ObjectSummary` to show
the full body as text with its original line breaks. The owner returns highlight ranges in the record for the current search.

## Switch a built-in page to its panel

Find the built-in preset agents that selected the old page skill. At the built-in entry's cutover, update each
preset's bundled declaration to select the new built-in panel by its fixed ID. The platform resolves that panel
to the corresponding skill in each domain. Keep the entry's default agent unchanged unless the product calls for
a change. For Business Knowledge, restore the `knowledge-governance` preset as a candidate and keep the general
assistant as the main entry's default. This step applies to built-in cutovers.

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

Use `packages/apps-sdk/src/base/ObjectSummary.vue` as a component example. In a directly rendered panel it consumes
`useMemberData("record")`. A projection's `config.fields` controls which fields appear and in what order.
The component declares the optional `fields` and `input` props and the `navigate` event. Its public export is in
`packages/apps-sdk/src/entries/base.ts`, with the template binding in `packages/apps-sdk/src/base-components.ts`.
The `ObjectSummary` entry in `packages/apps-sdk/src/catalogue.ts` uses `defineComponentMeta` to declare its meaning,
binding, output and required datum `data: { record: { results: ["panelRecord"], required: true } }`.
Controls add operations. For example, `ObjectForm` declares the owner form save
with `client: "@binding"` and `kind: "form.save"`.

Write the catalogue declaration alongside the component. Give it a package-qualified component ID for projection
registration, such as `@ontomato/sdk:ObjectSummary`. Declare the accepted result types and whether each datum is
required. Keep display configuration separate from the inputs supplied by a placement.
Write JSDoc for props and events in the component source. The SDK build checks the public export against the
catalogue, then generates `components.json`, `docs/components.md` and `docs/reference.md`. Registration uses the
current release catalogue to check the component exists and the projection supplies the declared data keys and types.

Verify the component in a projection with the real owner result. Check that its input and emitted values match the
catalogue and that writes go through the declared operation. Reuse the host's loading, error, empty and forbidden
states. A component may render or collect a value and request a declared action, while the owner decides what data
and actions are available.

Use `apps/workbench/web/src/__tests__/panel-direct-list-summary.test.ts` for a direct-rendering example.
Run the Workbench web tests and `pnpm --filter @ontomato/apps-sdk test` for the catalogue and release.
