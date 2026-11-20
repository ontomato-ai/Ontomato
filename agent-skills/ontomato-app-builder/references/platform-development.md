# Convert a platform page

Start with the [decomposition checklist](app-standard/references/decomposition.md). Read the existing page and its
business calls. For each read or action, identify the authoritative object type, the service that owns it, the inputs
from the page, the user permission, and what the page shows after success or refusal. Use those facts to look up the
current owner declarations and SDK catalogue. Extend the owner or SDK where a required capability is missing.

## Add a named owner read or operation

Scheduled tasks show the full path. The owner separates `list`, `record`, `form` and
`schedules.runNow.describe`. The corresponding projections bind the list, selected task, owner form and operation
button. A panel member supplies the current selection as a typed input.

1. Find the existing business interface. For scheduled tasks, Workbench calls it in
   `packages/workbench-server/src/services/scheduling/panel-reads.ts`. The result adapter in
   `packages/platform-schedules/src/panel-reads.ts` supplies the read functions. Keep the viewer's permission, language,
   business validation and test-data rules in the owner calls. Return the shared result, including any form field
   errors or per-relation result the component needs to render.
2. Register the read with the public contract owner. Give the stable type or operation ID, read name,
   `type`, `object` or `operation` source, parameter schemas and required parameters, and the result schema. Give a
   projection declaration using `data.<name> = { source, read, params }`. Bind each parameter to a declared input
   or literal. The named read adapter is mounted in
   `packages/workbench-server/src/services/product-panels/data-reads.ts`. This dispatcher resolves the actual
   placement and source and returns the result to the component under the reader's identity.
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
   with `RUNTIME_TEST_DATABASE_URL` set to a disposable PostgreSQL database.

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

Use `packages/apps-sdk/src/base/ObjectForm.vue` as a component example. It renders the owner's form descriptor and
uses the host to request field recalculation and saving. Its public export is in
`packages/apps-sdk/src/entries/base.ts`. The `ObjectForm` declaration in `packages/apps-sdk/src/catalogue.ts`
uses `defineComponentMeta` for its meaning, binding, and the form save operation. Declare props and events in the
component source. The build reads those ports and generates both `components.json` and the reference alongside
the code. Put new shared data, port or operation shapes in the public contract with its owner.

Verify the component in a projection with the real owner result. Check that its input and emitted values match the
catalogue and that writes go through the declared operation. Reuse the host's loading, error, empty and forbidden
states. A component may render or collect a value and request a declared action, while the owner decides what data
and actions are available.
