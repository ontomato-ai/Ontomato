# Write a Vue panel

Write the Vue template and scoped panel styles in `panel.html`. Put the template inside `<div id="app">`. Place a
declared member with `<projection slot="detail"></projection>`. Use Vue attributes, events, `v-if` and `v-for` for
interactions. Panel CSS positions member containers. Design variables style components inside them.

Declare named projections and public typed state in `panel.json`. Keep page-local state in Vue. An object state
such as `selected` stores `{className, primaryKey}`. Enable `deepLink` when the address should restore the selection.
Use `recipes.md` for tasks the assistant needs to know how to do.

In `panel.mjs`, import the host runtime, read panel state from the current context and mount your component.

```js
import { computed } from "vue";
import { mountPanel, usePanelContext } from "@ontomato/sdk/panel";

await mountPanel({
  setup() {
    const { instance } = usePanelContext();
    return {
      selected: computed(() => instance.state.values.value.selected),
      selectRecord: value => instance.state.set("selected", value),
    };
  },
});
```

Use `@update:selected="selectRecord"` on the list and `v-if="selected"` on the detail. The standard form and list
components use the projection's range and fields. Keep the selected reference connected to the detail's declared input.

## Read declared data

Use an official component when it fits the view. Place its projection with `<projection slot="list"></projection>`.
For a custom Vue view, declare a projection with `componentId: "@ontomato/sdk:PanelData"` and `config: {}`. It supplies
data for your Vue template to render. Name each datum in `data` and use `usePanelData` in `setup()`.
The example's `detail` member declares `data.record`.

```js
import { usePanelData } from "@ontomato/sdk/panel";

const detail = usePanelData("detail", "record");
```

Use one call per datum. Pass runtime parameter values, such as pagination, in an optional reactive object, ref or
getter. Use parameter names accepted by the declared read. The SDK applies the projection's inputs and reads
under the reader's identity. State or runtime parameter changes trigger a new read. An `awaiting` result means a
required value is missing and the SDK waits to send the request.

Render `loading` while the read runs, `awaiting` as a prompt for the required input, `ready` with its `value`,
`empty` with an empty state, `forbidden` with an access message and `error` with the returned `message`.
After a successful write, the platform re-reads affected objects and types reported by the owner.

## Invoke declared owner operations

Put owner operation bindings in the projection's `operations` map. An `OperationButton` selects the local name
with `config.operation`. Its text comes from the owner's `label`. For a custom control, use the same operation
from `instance.operations.value`. Look it up by its placed ID, `<member key>.<local name>`.

```js
import { computed } from "vue";
import { usePanelContext } from "@ontomato/sdk/panel";

const { instance } = usePanelContext();
const approve = computed(() => instance.operations.value.find(op => op.id === "approve.approve"));
const approveSelected = () => instance.invoke("approve.approve");
```

Use the descriptor's `label` and `inputSchema` to display the control and supply its business inputs. Disable it
while the operation is absent. The platform updates the available operations as the selected object changes.
The host presents confirmation when required. Display the returned owner result or the reason the invocation throws.
A member with a checked-object list can invoke a batch when the owner declares support.

## Save a form or hand off a draft

An `ObjectForm` projection binds one owner operation whose kind is `form.save`. The component sends `call.input`
with `values`, the `revision` from the owner form when present, and `submittedFields` as JSON Pointer strings.
For a custom save control, pass the same current form values:

```js
await instance.invoke("form.save", {
  values: { name: "Review assistant" },
  revision: 4,
  submittedFields: ["/name"],
});
```

A populated object input edits that record. An empty input opens creation when the owner supports it and the
projection has the same type's `createForm` read. The successful create selects the returned object.

For an assistant draft, first read the owner form and copy `save.draftOperation` into the artifact's `operation`.
Use the application's `pageKey`, the owner's object ID and only the changed field values in `form`:

```json
{
  "pageKey": "example-vue-agent-directory-manage",
  "operation": "platform:AgentDefinition.save",
  "target": {"id": "<selected agent ID>"},
  "form": {"name": "Review assistant"}
}
```

Use an empty `target` for creation. Publish the draft as a run artifact, such as `outputs/drafts/edit.page-draft.json`.
Append these query values to the panel's use path in the `#/...` portion of its address:

```js
const query = new URLSearchParams({
  draftSessionId: sessionId,
  draftRunId: runId,
  draftPath: "outputs/drafts/edit.page-draft.json",
});
const draftRoute = `#${usePath}?${query}`;
```

Pass the raw artifact path once to `URLSearchParams`. Opening the link fills the owner form for the reader to save.

## Register and open

Write new projection definitions once, in each member's `target.projection`. Run `panel check <directory>` and
`panel register <directory>` with the same `registration.json` metadata. Registration writes the projection ID back
to `panel.json`. Keep it when rearranging or renaming the member. Use `target.projectionId` for an existing projection.

Give every application use a `pageKey` unique within its domain. Set the use's localized `names` for the display
title beside conversations. Use `panel.name` as its fallback. For an application delivery list, declare only extra
`packages`, `agents` and `skills`. The platform derives panel and projection dependencies from registered uses.

Use the [agent directory example](../../examples/vue-agent-directory/panel.html) for the complete layout and owner
form wiring. Give your own panel and use their own IDs. The example opens at `/applications/example-vue-agent-directory/manage`.
Exercise a read, an owner save and a draft from the registered use.
