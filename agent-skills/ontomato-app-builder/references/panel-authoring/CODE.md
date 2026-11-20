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

## Read and invoke owner operations

Official projection components use their declared reads and forms. For a custom Vue view, read a declared datum
through the panel context. This example runs in `setup()`. The `records` member targets a projection with
`data.rows` and a `search` input used by its owner query.

```js
const { readPanelData } = usePanelContext();
const loadRows = search => readPanelData({
  memberPath: [{ member: "records" }],
  dataName: "rows",
  inputs: { search },
});
```

The host supplies the panel source and calls the platform's read entry under the reader's identity.
Render `ready` with its `value`, `empty` with an empty state, `forbidden` with an access message and `error`
with the returned `message`. Keep loading in the Vue view while the promise is pending. Use the owner's
registered operations for writes.

Put owner operation bindings in the projection's `operations` map. An `OperationButton` selects the local name
explicitly with `config.operation`. Its text comes from the owner description's `label`. For a custom control,
call `readPanelData` with `operations: true`, the same `memberPath` and its `inputs`. Use the returned
`ready.value[localName]` for the label and input description. The placed operation ID used for invocation is
`<member key>.<local name>`. A member with a checked-object list can invoke a batch when the owner declares support.

## Save a form or hand off a draft

An `ObjectForm` projection binds one owner operation whose kind is `form.save`. The component sends `call.input`
with `values`, the `revision` from the owner form when present, and `submittedFields` as JSON Pointer strings.
For example, editing an agent's name can send `{"values":{"name":"Review assistant"},"revision":4,"submittedFields":["/name"]}`.
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
